import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { context } from "../src/commands/context.js";
import { createProgram } from "../src/index.js";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
let scratch: string;

beforeAll(async () => {
  scratch = await mkdtemp(join(tmpdir(), "archdoc-cli-trace-"));
});
afterAll(() => rm(scratch, { recursive: true, force: true }));

async function run(cwd: string, ...args: string[]) {
  const out: string[] = [];
  const err: string[] = [];
  const program = createProgram({ cwd, out: (t) => out.push(t), err: (t) => err.push(t) });
  program.exitOverride();
  await program.parseAsync(["node", "archdoc", ...args]);
  return { code: program.exitCode ?? 0, out: out.join("\n"), err: err.join("\n") };
}

const STACK = [
  'Error: "main" is not a commit, branch, or tag in this repository.',
  "    at readModelSourcesAtRef (file:///home/runner/work/archdoc/archdoc/packages/core/dist/load/git.js:93:15)",
  "    at async loadModelAtRef (file:///home/runner/work/archdoc/archdoc/packages/core/dist/load/git.js:131:16)",
  "    at async report (file:///home/runner/work/archdoc/archdoc/packages/cli/dist/commands/report.js:42:7)",
].join("\n");

describe("archdoc triage list and show", () => {
  it("lists Triage records, and archdoc trace is gone", async () => {
    const line =
      "report-false-data-changes · fixed (high) · The PR report says data changed when it didn't · review-ai-change#5 (.archdoc/triage/report-false-data-changes.yaml)";
    expect((await run(repo, "triage", "list")).out).toContain(line);
    expect((await run(repo, "triage", "list", "--status", "open-all")).out).not.toContain(line);
    await expect(run(repo, "trace", "list")).rejects.toThrow(/unknown command/);
  });

  it("shows a trace through archdoc show", async () => {
    const r = await run(repo, "show", "report-false-data-changes");
    expect(r.code).toBe(0);
    expect(r.out).toContain("Opens up review-ai-change step 5 (critical)");
    expect(r.out).toContain(
      "missing: toolchain.cli → toolchain.analyzers (applySchemas), never called",
    );
  });
});

describe("archdoc context --error", () => {
  it("ranks journey steps for a stack trace and suggests a trace", async () => {
    const file = join(scratch, "err.txt");
    await writeFile(file, STACK);
    const r = await run(repo, "context", "--error", file);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^This reads like a bug\. Start its Triage record first/);
    expect(r.out).toMatch(
      /\n\nWhere this error belongs, best first:\n {2}1\. review-ai-change#5 \(critical\)/,
    );
    expect(r.out).toContain(
      "toolchain.core.loader · packages/core/src/load/git.ts:93 (frame 1, in readModelSourcesAtRef)",
    );
    expect(r.out).toContain("triage: error-main-is-not-commit");
    expect(r.out).toContain("status: investigating");
    expect(r.out).toContain("    code: packages/cli/src/commands/report.ts:42");
  });

  it("reads the error from stdin, and says when nothing in it maps", async () => {
    const out: string[] = [];
    const code = await context(
      [],
      { error: "-" },
      { cwd: repo, out: (t) => out.push(t), err: () => {} },
      async () => "Error at packages/core/src/diff/diff.ts:10",
    );
    expect(code).toBe(0);
    expect(out.join("\n")).toContain("toolchain.core.differ");
    const none = join(scratch, "none.txt");
    await writeFile(none, "nothing here maps");
    expect((await run(repo, "context", "--error", none)).out).toContain(
      "Nothing in the error maps to the model",
    );
  });

  it("says --format json doesn't work with --error", async () => {
    const file = join(scratch, "err2.txt");
    await writeFile(file, STACK);
    const r = await run(repo, "context", "--error", file, "--format", "json");
    expect(r.code).toBe(2);
    expect(r.err).toContain("--format json works with a task or paths");
  });
});

describe("archdoc triage start and migrate", () => {
  const shop = async () => {
    const dir = await mkdtemp(join(scratch, "shop-"));
    await mkdir(join(dir, ".archdoc"), { recursive: true });
    await mkdir(join(dir, "src/api"), { recursive: true });
    await writeFile(join(dir, "src/api/save.ts"), "export function save() {}\n");
    await writeFile(
      join(dir, ".archdoc/archdoc.yaml"),
      [
        'archdoc: "2.0"',
        "namespace: shop",
        "actors: { shopper: { kind: person } }",
        "elements:",
        "  api: { kind: container, code: [src/api/**], uses: { db: Saves orders } }",
        "  db: { kind: datastore }",
        "journeys:",
        "  checkout:",
        "    actor: shopper",
        "    goal: Buy",
        "    steps:",
        "      - { from: shopper, to: api, action: Places the order }",
        "      - { from: api, to: db, action: Saves the order }",
        "",
      ].join("\n"),
    );
    return dir;
  };

  it("starts a record from a bug report, and never writes over one", async () => {
    const dir = await shop();
    const bug = join(dir, "bug.txt");
    await writeFile(bug, "Error: duplicate key\n    at save (src/api/save.ts:1:1)\n");
    const args = ["triage", "start", bug, "-t", "Orders save twice", "--link", "https://x/1"];
    const r = await run(dir, ...args, "--by", "support");
    expect(r.code).toBe(0);
    expect(r.out).toContain(
      "Started .archdoc/triage/orders-save-twice.yaml (status: investigating).",
    );
    const text = await readFile(join(dir, ".archdoc/triage/orders-save-twice.yaml"), "utf8");
    expect(text).toContain("triage: orders-save-twice");
    expect(text).toContain("  by: support");
    expect(text).toContain("  link: https://x/1");
    expect(text).toContain("  - claim: The cause is in api");
    // A second report with the same title gets its own record.
    expect((await run(dir, ...args)).out).toContain("orders-save-twice-2.yaml");
    const listed = await run(dir, "triage", "list");
    expect(listed.out.split("\n")).toHaveLength(2);
    expect(listed.out).toContain("orders-save-twice · investigating · Orders save twice");
    // What it wrote checks: only the TODOs it left are open.
    const check = await run(dir, "check");
    expect(check.out).not.toContain("schema/invalid");
  });

  it("moves traces from before 0.8, keeping comments", async () => {
    const dir = await shop();
    await mkdir(join(dir, ".archdoc/traces"));
    await writeFile(
      join(dir, ".archdoc/traces/old.yaml"),
      "# kept\ntrace: old\ntitle: Old\nsymptom: s\nexpands: checkout#2 # api → db\ndiagnosis: |\n  Two lines\n  of why.\nsteps: [{ from: api, to: db, role: cause, evidence: read }]\n",
    );
    expect((await run(dir, "triage", "migrate", "--dry-run")).out).toContain("Would move 1:");
    const r = await run(dir, "triage", "migrate");
    expect(r.out).toContain(".archdoc/traces/old.yaml → .archdoc/triage/old.yaml");
    expect(await readdir(join(dir, ".archdoc"))).not.toContain("traces");
    const text = await readFile(join(dir, ".archdoc/triage/old.yaml"), "utf8");
    expect(text).toBe(
      "# kept\ntriage: old\ntitle: Old\nsymptom: s\nexpands: checkout#2 # api → db\nroot-cause:\n  summary: |\n    Two lines\n    of why.\nsteps: [ { from: api, to: db, role: cause, evidence: read } ]\n",
    );
    expect((await run(dir, "show", "old")).out).toContain("Root cause (step 1): Two lines");
    expect((await run(dir, "triage", "migrate")).out).toBe("No traces to move.");
  });
});
