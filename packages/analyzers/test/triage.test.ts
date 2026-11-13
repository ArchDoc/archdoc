import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { triageSendAnswer, triageStartAnswer, triageWaitAnswer } from "../src/index.js";

let cwd: string;
const where = () => ({ cwd });
const record = async (id: string) =>
  parse(await readFile(join(cwd, ".archdoc", "triage", `${id}.yaml`), "utf8"));

beforeAll(async () => {
  cwd = await mkdtemp(join(tmpdir(), "archdoc-triage-"));
  await mkdir(join(cwd, ".archdoc"), { recursive: true });
  await writeFile(
    join(cwd, ".archdoc", "archdoc.yaml"),
    [
      'archdoc: "2.0"',
      "namespace: shop",
      "elements:",
      "  api: { kind: container, description: Takes orders }",
      "",
    ].join("\n"),
  );
});

afterAll(() => rm(cwd, { recursive: true, force: true }));

describe("sending a bug to the agent", () => {
  let id = "";

  it("starts a record sent from the explorer, with what the person asked", async () => {
    const r = await triageStartAnswer(where(), {
      symptom: "Checkout fails with a 500",
      send: { ask: "Find the root cause" },
    });
    expect(r.ok).toBe(true);
    id = r.id ?? "";
    expect(await record(id)).toMatchObject({ sent: 1, ask: "Find the root cause" });
  });

  it("picks up a sent record at once, and marks it received", async () => {
    const r = await triageWaitAnswer(where(), { timeout: 1 });
    expect(r.text).toMatch(new RegExp(`sent ${id} from the explorer, asking: Find the root cause`));
    expect((await record(id)).received).toBe(1);
  });

  it("waits past a record it has, and picks it up when it's sent again", async () => {
    const quiet = await triageWaitAnswer(where(), { id, timeout: 0.2, interval: 50 });
    expect(quiet.text).toMatch(/Still waiting/);
    expect((await triageSendAnswer(where(), { id, ask: "Fix it" })).ok).toBe(true);
    const r = await triageWaitAnswer(where(), { id, timeout: 1, interval: 50 });
    expect(r.text).toMatch(/asking: Fix it/);
    expect(await record(id)).toMatchObject({ sent: 2, received: 2, ask: "Fix it" });
  });

  it("says so for a record that isn't there", async () => {
    expect((await triageSendAnswer(where(), { id: "nope" })).ok).toBe(false);
    expect((await triageWaitAnswer(where(), { id: "nope", timeout: 0 })).ok).toBe(false);
  });
});
