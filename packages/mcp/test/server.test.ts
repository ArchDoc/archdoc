import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createArchdocServer, INSTRUCTIONS } from "../src/index.js";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
let client: Client;

beforeAll(async () => {
  const server = createArchdocServer({ cwd: repo });
  const [a, b] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
});

afterAll(() => client.close());

async function call(name: string, args: Record<string, unknown> = {}) {
  const r = await client.callTool({ name, arguments: args });
  const content = r.content as { type: string; text: string }[];
  return { text: content[0]?.text ?? "", isError: r.isError === true };
}

describe("archdoc MCP server", () => {
  it("tells agents to start with context and end with check and seal", () => {
    expect(client.getInstructions()).toBe(INSTRUCTIONS);
    expect(INSTRUCTIONS).toMatch(
      /before you grep[\s\S]*archdoc_context[\s\S]*archdoc_show[\s\S]*archdoc_check[\s\S]*archdoc_seal/,
    );
    // 0.8.1: triage says to start the record before the code, even for a fix. 0.9: plan.
    expect(INSTRUCTIONS.length).toBeLessThan(1500);
  });

  it("has one tool per question, read-only except edit, seal, triage, plan, and init", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "archdoc_check",
      "archdoc_context",
      "archdoc_edit",
      "archdoc_find",
      "archdoc_init",
      "archdoc_paths",
      "archdoc_plan",
      "archdoc_seal",
      "archdoc_show",
      "archdoc_triage",
    ]);
    const writers = tools.filter((t) => t.annotations?.readOnlyHint !== true).map((t) => t.name);
    expect(writers.sort()).toEqual([
      "archdoc_edit",
      "archdoc_init",
      "archdoc_plan",
      "archdoc_seal",
      "archdoc_triage",
    ]);
    expect(tools.find((t) => t.name === "archdoc_seal")?.annotations?.destructiveHint).toBe(false);
    expect(tools.find((t) => t.name === "archdoc_edit")?.annotations?.destructiveHint).toBe(true);
    // Every agent session reads this list, so it stays small. find and edit
    // take most of it: they replace reading and hand-editing the YAML. triage
    // (0.8) added about 500, what a step needs (0.8.1) about 100, and plan
    // (0.9) about 1,450: the op shapes come with the plan it reads instead.
    // Edit's rules and model types (1.0) about 60: one less reason to hand-edit.
    expect(JSON.stringify(tools).length).toBeLessThan(12900);
  });

  it("finds parts of the model, and outlines it", async () => {
    const r = await call("archdoc_find", { path: "packages/core/src/load/fs.ts" });
    expect(r.text).toMatch(
      /whose code covers packages\/core\/src\/load\/fs\.ts:\n {2}toolchain\.core\.loader \(component\)/,
    );
    const outline = await call("archdoc_find", {
      outline: true,
      under: "toolchain.core",
      depth: 1,
    });
    expect(outline.text).toContain("toolchain.core (container)");
    expect((await call("archdoc_find", { under: "nope" })).isError).toBe(true);
  });

  it("edits only with ops that make sense, and a dry run writes nothing", async () => {
    const r = await call("archdoc_edit", {
      ops: [{ op: "set", id: "toolchain.mcp", spec: { technology: "Node.js" } }],
      dryRun: true,
    });
    expect(r.isError).toBe(false);
    expect(r.text).toContain("Would change .archdoc/model/toolchain.yaml:");
    const bad = await call("archdoc_edit", { ops: [{ op: "set", id: "nope", spec: {} }] });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain('Nothing is called "nope"');
  });

  // These read the whole repository, the first of them cold, which takes a few
  // seconds on a busy CI runner: more than the default 5.
  it("lists where flows start, and follows one through its calls", async () => {
    const all = await call("archdoc_paths", {});
    expect(all.isError).toBe(false);
    expect(all.text).toMatch(/command\s+init\s+packages\/cli\/src\/program\.ts/);
    const one = await call("archdoc_paths", { entry: "nothing-matches-this" });
    expect(one.isError).toBe(true);
    expect(one.text).toContain('No entry point matches "nothing-matches-this"');
  }, 30_000);

  it("finds where an area lives, by its words, file names, and tool names", async () => {
    const r = await call("archdoc_context", { task: "cli command" });
    expect(r.text).toMatch(/Start here\n {2}packages\/cli\/src\/[^\n]+\(toolchain\.cli/);
    const tool = await call("archdoc_context", { task: "archdoc_check" });
    expect(tool.text).toMatch(/Start here\n {2}packages\/mcp\/src\/server\.ts:\d+/);
  }, 30_000);

  it("briefs a task from words or paths, with who uses it", async () => {
    const byPath = await call("archdoc_context", {
      paths: ["packages/cli/src/commands/report.ts"],
    });
    expect(byPath.isError).toBe(false);
    expect(byPath.text).toMatch(
      /^Context for "packages\/cli\/src\/commands\/report\.ts"\n\nStart here\n {2}packages\/cli\/src\/commands\/report\.ts:\d+ report — you named it/,
    );
    // Other callers of what it uses: the bug class where surfaces load revisions differently.
    expect(byPath.text).toMatch(
      /\(toolchain\.(core\.[a-z]+|analyzers)\) is also called from .*packages\/(mcp|analyzers)\/src\/[a-z-]+\.ts:\d+/,
    );
    // What impact said: who uses it.
    expect(byPath.text).toMatch(/Used by: [^\n]*toolchain\.github-action/);
    expect(byPath.text).toContain("Next: after editing, run archdoc check --base main");

    const byWords = await call("archdoc_context", { task: "pr report" });
    expect(byWords.text).toMatch(
      /Start here\n {2}packages\/core\/src\/report\/pr-report\.ts:\d+ prReport/,
    );
    expect(byWords.text).toMatch(
      /review-ai-change \(critical\) · step \d+ names packages\/core\/src\/report\/pr-report\.ts/,
    );
    expect(byWords.text).toContain("packages/core/test/pr-report.test.ts — same name");
  }, 30_000);

  it("takes absolute paths too", async () => {
    const r = await call("archdoc_context", { paths: [`${repo}apps/web/src/graph/graph.ts`] });
    expect(r.text).toMatch(/apps\/web\/src\/graph\/graph\.ts:\d+ [^\n]+\(toolchain\.web\.graph\)/);
  });

  it("gives an overview with nothing to go on", async () => {
    expect((await call("archdoc_context")).text).toMatch(/^ArchDoc \(namespace archdoc\)/);
  });

  it("says to start a Triage record first when the task reads like a bug", async () => {
    const bug = await call("archdoc_context", { task: "shipped emails stopped after the deploy" });
    expect(bug.text).toMatch(
      /^This reads like a bug\. Start its Triage record first: archdoc_triage/,
    );
    const change = await call("archdoc_context", { task: "add a refund rounding option" });
    expect(change.text).not.toContain("This reads like a bug");
  }, 30_000);

  it("places an error and starts a trace", async () => {
    const r = await call("archdoc_context", {
      error:
        "TypeError: x is undefined\n    at diffModels (/ci/repo/packages/core/dist/diff/diff.js:12:3)\n    at report (/ci/repo/packages/cli/dist/commands/report.js:50:20)",
    });
    expect(r.isError).toBe(false);
    expect(r.text).toMatch(/^This reads like a bug\. Start its Triage record first/);
    expect(r.text).toMatch(/\n\nWhere this error belongs, best first:\n {2}1\. review-ai-change#5/);
    expect(r.text).toContain("toolchain.core.differ · packages/core/src/diff/diff.ts:12");
    expect(r.text).toContain("  - from: toolchain.cli.commands\n    to: toolchain.core.differ");
  });

  it("shows an element, its code, an actor, a journey, a trace, and a fact", async () => {
    const code = (await call("archdoc_show", { id: "toolchain.core.codemap", code: true })).text;
    expect(code).toContain(
      "packages/core/src/codemap/codemap.ts (locate) · Which element owns a path",
    );
    expect(code).toMatch(/\d+ \| export function locate\(model: Model, path: string\): Located \{/);
    expect((await call("archdoc_show", { id: "core" })).text).toContain(
      "toolchain.core (container)",
    );
    expect((await call("archdoc_show", { id: "coding-agent" })).text).toContain(
      "coding-agent (agent)",
    );
    expect((await call("archdoc_show", { id: "check-model" })).text).toContain(
      "1. developer → toolchain.cli",
    );
    const trace = await call("archdoc_show", { id: "report-false-data-changes" });
    expect(trace.text).toContain("2. ✗ cause  toolchain.cli → toolchain.core.loader");
    const fact = await call("archdoc_show", { id: "step:keep-the-model-true#3" });
    expect(fact.text).toMatch(/^journey keep-the-model-true, step 3 \(\.archdoc\/journeys\//);
    expect(fact.text).toContain("Points at packages/analyzers/src/seals.ts");
  }, 30_000);

  it("checks the model, the code, traces, and seals, and with a base, gives the verdict", async () => {
    const r = await call("archdoc_check");
    expect(r.isError).toBe(false);
    expect(r.text).not.toMatch(/✗ trace\//);
    const change = await call("archdoc_check", { base: "HEAD" });
    expect(change.isError).toBe(false);
    expect(change.text).toMatch(/^(⛔|⚠️|ℹ️|✓) .+ \(since HEAD\)/);
    const comment = await call("archdoc_check", { base: "HEAD", format: "markdown" });
    expect(comment.text).toMatch(/^(⛔|⚠️|ℹ️|✅) \*\*ArchDoc:\*\* /);
    expect(comment.text).not.toContain("<!--");
  }, 60_000);

  it("never starts a model over one", async () => {
    const r = await call("archdoc_init");
    expect(r.isError).toBe(true);
    expect(r.text).toContain("already has .archdoc/");
  });

  it("returns unknown IDs as tool errors, with what's close", async () => {
    const r = await call("archdoc_show", { id: "nope" });
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/^Nothing is called "nope"\./);
    const near = await call("archdoc_show", { id: "cli-commands" });
    expect(near.text).toContain("Did you mean toolchain.cli.commands");
  });
});
