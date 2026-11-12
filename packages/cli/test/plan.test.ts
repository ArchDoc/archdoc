import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { planEditAnswer } from "@archdoc/analyzers";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { createProgram } from "../src/index.js";

// archdoc plan through every stage: the agent starts it, the person draws and
// sends it (as the explorer does, through planEditAnswer), the agent waits,
// reads, and answers, the person agrees, and the agent carries it out.

let cwd: string;
const ID = "email-the-shopper-a-receipt";
const spec = async () => parse(await readFile(join(cwd, ".archdoc/plans", `${ID}.yaml`), "utf8"));
const person = (ops: unknown[]) =>
  planEditAnswer({ cwd }, { id: ID, by: "human:@dana", track: true, ops: ops as never });

async function run(...args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const program = createProgram({ cwd, out: (t) => out.push(t), err: (t) => err.push(t) });
  program.exitOverride();
  await program.parseAsync(["node", "archdoc", ...args]);
  return { code: program.exitCode ?? 0, out: out.join("\n"), err: err.join("\n") };
}

beforeAll(async () => {
  cwd = await mkdtemp(join(tmpdir(), "archdoc-cli-plan-"));
  await mkdir(join(cwd, ".archdoc"), { recursive: true });
  await writeFile(
    join(cwd, ".archdoc", "archdoc.yaml"),
    [
      'archdoc: "2.0"',
      "namespace: shop",
      "actors:",
      "  shopper: { kind: person }",
      "elements:",
      "  web: { kind: container, description: The storefront, uses: { api: Places orders } }",
      "  api: { kind: container, description: Takes orders and charges for them }",
      "journeys:",
      "  checkout:",
      "    actor: shopper",
      "    goal: Buy what's in the cart",
      "    steps:",
      "      - { from: shopper, to: web, action: Checks out }",
      "      - { from: web, to: api, action: Places the order }",
      "",
    ].join("\n"),
  );
});

afterAll(() => rm(cwd, { recursive: true, force: true }));

describe("archdoc plan, stage by stage", () => {
  it("start: writes a drafting plan with its scope, and says to open the explorer", async () => {
    const dry = await run("plan", "start", "Email the shopper a receipt", "--dry-run");
    expect(dry.code).toBe(0);
    expect(await readdir(join(cwd, ".archdoc")).catch(() => [])).not.toContain("plans");

    // The goal in words, as a shell passes it; the ID comes from the title.
    const r = await run(
      "plan",
      "start",
      "Email the shopper a receipt once checkout charges the order",
      "--title",
      "Email the shopper a receipt",
      "--by",
      "human:@dana",
    );
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/archdoc view/);
    expect(r.out).toMatch(/archdoc plan wait/);
    const s = await spec();
    expect(s).toMatchObject({ plan: ID, status: "drafting", by: "human:@dana" });
    expect(s.scope).toMatchObject({ elements: ["api"], journeys: ["checkout"] });
  });

  it("wait: returns what the person drew once they send it", async () => {
    await person([
      {
        op: "put",
        list: "changes",
        item: { intent: "Sends the receipt", add: { id: "mailer", kind: "container" } },
      },
      {
        op: "put",
        list: "changes",
        item: { intent: "The API sends it once paid", use: { from: "api", to: "mailer" } },
      },
    ]);
    const early = await run("plan", "wait", ID, "--timeout", "0.1");
    expect(early.out).toMatch(/Still waiting/);
    await person([{ op: "send" }]);
    const r = await run("plan", "wait", ID, "--timeout", "1");
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/added c1/);
    expect(r.out).toMatch(/Respond with these ops/);
    expect((await spec()).status).toBe("reviewing");
    expect((await spec()).unread).toBeUndefined();
  });

  it("read: --peek leaves what changed unread", async () => {
    await person([{ op: "put", list: "notes", item: { on: "c1", text: "Plain text is fine" } }]);
    expect((await run("plan", "read", ID, "--peek")).out).toMatch(/since your last read \(1\)/);
    expect((await spec()).unread).toHaveLength(1);
    expect((await run("plan", "read", ID)).out).toMatch(/since your last read \(1\)/);
    expect((await spec()).unread).toBeUndefined();
  });

  it("respond: refuses to change or accept the person's items, and suggests beside them", async () => {
    const refused = await run(
      "plan",
      "respond",
      ID,
      '{"op":"accept","id":"c1"}',
      "--by",
      "agent:claude",
    );
    expect(refused.code).toBe(2);
    expect(refused.err).toMatch(/only the person accepts/);
    const theirs = await run(
      "plan",
      "respond",
      ID,
      JSON.stringify({ op: "drop", id: "c2" }),
      "--by",
      "agent:claude",
    );
    expect(theirs.code).toBe(2);
    expect((await spec()).changes).toHaveLength(2);

    const ops = join(cwd, "ops.json");
    await writeFile(
      ops,
      JSON.stringify([
        {
          op: "put",
          list: "notes",
          item: { on: "c1", kind: "question", text: "SMTP or a provider?" },
        },
        {
          op: "put",
          list: "changes",
          item: { intent: "Shoppers see it was sent", use: { from: "mailer", to: "web" } },
        },
      ]),
    );
    const r = await run("plan", "respond", ID, "--file", ops, "--by", "agent:claude");
    expect(r.code).toBe(0);
    const s = await spec();
    expect(s.changes[2]).toMatchObject({ id: "c3", status: "suggested", by: "agent:claude" });
    expect(s.notes.at(-1)).toMatchObject({ kind: "question", by: "agent:claude" });
    const list = await run("plan", "list");
    expect(list.out).toMatch(/1 open question/);
    expect(list.out).toMatch(/1 suggestion/);
  });

  it("ready: shows each agreed change as the archdoc edit op that makes it", async () => {
    const q = (await spec()).notes.at(-1).id;
    await person([
      { op: "dismiss", id: "c3" },
      { op: "reply", note: q, text: "A provider", kind: "answer" },
      { op: "resolve", note: q },
      { op: "set", status: "ready" },
    ]);
    const r = await run("plan", "read", ID);
    expect(r.out).toContain('archdoc edit: {"op":"add","id":"mailer","spec":{"kind":"container"}}');
    expect(r.out).not.toContain('"from":"mailer","to":"web"}');
    expect(r.out).toMatch(/no tasks/);
  });

  it("task: moves the plan to executing, then done, and the check holds it to the model", async () => {
    const tasks = await run(
      "plan",
      "respond",
      ID,
      JSON.stringify({
        op: "put",
        list: "tasks",
        item: { title: "Add the mailer", from: ["c1", "c2"], files: ["api/mail.ts"] },
      }),
      "--by",
      "agent:claude",
    );
    expect(tasks.code).toBe(0);
    expect((await run("plan", "task", ID, "t9")).code).toBe(2);
    expect((await run("plan", "task", ID, "t1", "--status", "doing")).code).toBe(0);
    expect((await spec()).status).toBe("executing");

    // Done before the model shows it: the check says so.
    await run("plan", "task", ID, "t1", "--status", "doing");
    const edit = await run(
      "edit",
      JSON.stringify([
        { op: "add", id: "mailer", spec: { kind: "container", description: "Sends email" } },
        { op: "use", from: "api", to: "mailer", spec: "Sends the receipt" },
      ]),
    );
    expect(edit.code).toBe(0);
    const check = await run("check", "--all", "--fail-on", "never", "--format", "json");
    expect(JSON.parse(check.out).map((f: { code: string }) => f.code)).not.toContain(
      "plan/cannot-apply",
    );
    expect((await run("plan", "task", ID, "t1")).code).toBe(0);
    expect((await spec()).status).toBe("done");
  });
});
