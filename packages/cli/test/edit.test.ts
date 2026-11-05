import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { createProgram } from "../src/index.js";

// An agent models a repository by ID: find what's missing, edit, and read
// what the edit fixed, without opening the YAML.
let repo: string;
const write = async (path: string, text: string) => {
  await mkdir(dirname(join(repo, path)), { recursive: true });
  await writeFile(join(repo, path), text);
};

async function run(...args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const program = createProgram({ cwd: repo, out: (t) => out.push(t), err: (t) => err.push(t) });
  program.exitOverride();
  await program.parseAsync(["node", "archdoc", ...args]);
  return { code: program.exitCode ?? 0, out: out.join("\n"), err: err.join("\n") };
}

const MODEL = [
  'archdoc: "2.0"',
  "namespace: shop",
  "elements:",
  "  api:",
  "    kind: container",
  "    code: api/**",
  "  worker:",
  "    kind: container",
  "    description: Sends receipts.",
  "    code: worker/**",
  "",
].join("\n");

beforeEach(async () => {
  repo = await mkdtemp(join(tmpdir(), "archdoc-edit-"));
  await write(".archdoc/archdoc.yaml", MODEL);
  await write("api/server.ts", "export const app = 1;\n");
  await write("worker/main.ts", "export const run = 1;\n");
});

describe("archdoc find and edit", () => {
  it("finds what's missing, by ID", async () => {
    const r = await run("find", "--missing", "description");
    expect(r.code).toBe(0);
    expect(r.out).toContain("1 match in the model missing description:\n  api (container)");
    expect((await run("find", "--missing", "nope")).code).toBe(2);
  });

  it("edits by ID, writes only those lines, and says what it fixed", async () => {
    const r = await run(
      "edit",
      JSON.stringify([
        { op: "set", id: "api", spec: { description: "Takes orders over HTTP." } },
        { op: "use", from: "api", to: "worker", spec: "Queues receipts" },
      ]),
      "--by",
      "agent:test",
    );
    expect(r.err).toBe("");
    expect(r.code).toBe(0);
    expect(r.out).toContain("✓ Changed .archdoc/archdoc.yaml:");
    expect(r.out).toContain("Added the use api -> worker.");
    const text = await readFile(join(repo, ".archdoc/archdoc.yaml"), "utf8");
    expect(text).toBe(
      MODEL.replace(
        "    code: api/**\n",
        [
          "    description: Takes orders over HTTP.",
          "    code: api/**",
          "    uses:",
          "      worker:",
          "        description: Queues receipts",
          "        provenance: { source: suggested, by: agent:test }",
          "",
        ].join("\n"),
      ),
    );
  });

  it("writes nothing when the edit would add errors, or a dry run", async () => {
    const bad = await run(
      "edit",
      JSON.stringify({
        op: "add",
        type: "journey",
        id: "checkout",
        spec: { actor: "nobody", goal: "Buy", steps: [{ from: "nobody", to: "api" }] },
      }),
    );
    expect(bad.code).toBe(1);
    expect(bad.err).toContain("Nothing written: this edit would add");
    await expect(stat(join(repo, ".archdoc/journeys/checkout.yaml"))).rejects.toThrow();

    const dry = await run("edit", '{"op":"set","id":"api","spec":{"code":"src/**"}}', "--dry-run");
    expect(dry.out).toContain("Would change .archdoc/archdoc.yaml:");
    expect(dry.out).toContain("api: code src/** matches no file in the repository.");
    expect(await readFile(join(repo, ".archdoc/archdoc.yaml"), "utf8")).toBe(MODEL);
  });

  it("reads ops from a file", async () => {
    await write("ops.json", '{"op":"rename","id":"worker","to":"mailer"}');
    const r = await run("edit", "--file", "ops.json");
    expect(r.out).toContain("Renamed element worker to mailer.");
    expect((await run("edit", "not json")).err).toContain("The ops aren't valid JSON");
  });
});
