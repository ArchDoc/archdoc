// What the everyday-loop eval (scripts/eval-change.mjs) and its free half
// (packages/analyzers/test/change-evals.test.ts) share: the scenarios in
// evals/change, the repository each one starts from, its reference solution,
// and how a finished repository and the agent's session are scored. Scoring is
// deterministic: the model and code on disk, archdoc check, and the tool calls
// in the transcript, with no judge.
import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const here = new URL("..", import.meta.url).pathname;
export const SCENARIOS = join(here, "evals/change");
const FIXTURES = join(here, "evals/fixtures");
const parseYaml = (text) =>
  createRequire(join(here, "packages/cli/package.json"))("yaml").parse(text);

const git = (cwd, ...args) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

/** The scenarios in evals/change, by name. */
export function scenarioNames() {
  return readdirSync(SCENARIOS, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(SCENARIOS, d.name, "scenario.yaml")))
    .map((d) => d.name)
    .sort();
}

/** A scenario: the fixture it starts from, the task, what it expects, and its reference solution. */
export function loadScenario(name) {
  const s = parseYaml(readFileSync(join(SCENARIOS, name, "scenario.yaml"), "utf8"));
  return { name, ...s, expect: s.expect ?? {}, solution: s.solution ?? {} };
}

/**
 * A scratch repository for a scenario: the fixture with its golden model as
 * .archdoc/, sealed (`seal`, the api's sealAnswer, records every fact) and
 * committed on main, then a branch named for the scenario, checked out and
 * empty, for the agent's change. Returns its directory; remove the directory
 * above it when done.
 */
export async function startRepo(scenario, api) {
  const dir = join(mkdtempSync(join(tmpdir(), "archdoc-change-eval-")), scenario.fixture);
  cpSync(join(FIXTURES, scenario.fixture, "repo"), dir, { recursive: true });
  mkdirSync(join(dir, ".archdoc"));
  cpSync(join(FIXTURES, scenario.fixture, "golden.yaml"), join(dir, ".archdoc/archdoc.yaml"));
  const run = (...a) => git(dir, ...a);
  run("init", "-q", "-b", "main");
  run("add", "-A");
  commit(dir, "init");
  const sealed = await api.sealAnswer({ cwd: dir }, { all: true, by: "eval" });
  if (!sealed.ok) throw new Error(`Sealing ${scenario.fixture} failed: ${sealed.text}`);
  run("add", "-A");
  commit(dir, "seal");
  run("checkout", "-q", "-b", scenario.name);
  return dir;
}

function commit(dir, message) {
  git(
    dir,
    "-c",
    "user.name=eval",
    "-c",
    "user.email=eval@archdoc.invalid",
    "commit",
    "-qm",
    message,
  );
}

/**
 * Carries out the scenario's reference solution, the way an agent following
 * the skill would: the code change (files deleted, then evals/change/<name>/
 * solution/ copied over), the model change (its edit ops, through the api's
 * editAnswer), then a seal of every fact the change touched.
 */
export async function applySolution(dir, scenario, api) {
  for (const f of scenario.solution.delete ?? []) rmSync(join(dir, f), { force: true });
  const overlay = join(SCENARIOS, scenario.name, "solution");
  if (existsSync(overlay)) cpSync(overlay, dir, { recursive: true });
  if (scenario.solution.ops?.length) {
    const edited = await api.editAnswer(
      { cwd: dir },
      { ops: scenario.solution.ops, by: "agent:eval" },
    );
    if (!edited.ok) throw new Error(`The solution's edit was refused:\n${edited.text}`);
  }
  const sealed = await api.sealAnswer({ cwd: dir }, { all: true, by: "agent:eval" });
  if (!sealed.ok) throw new Error(`Sealing the solution failed: ${sealed.text}`);
}

/** "a|b -> c" as the alternatives on each side: [["a", "b"], ["c"]]. */
const sides = (use) =>
  String(use)
    .split(/\s*->\s*/)
    .map((s) => s.split("|").map((x) => x.trim()));

/**
 * Scores a finished repository against the scenario, deterministically:
 *
 * - model: the share of `expect` facts that hold. Elements present or absent
 *   by ID (`a|b` for any of them); uses present (one of the alternatives each side names) or absent;
 *   files present or absent, for the code change itself.
 * - clean: archdoc check against main finds nothing the change introduced
 *   that's an error, a stale path or undeclared dependency (drift/), or a
 *   sealed fact whose code changed and wasn't sealed again (seal/changed).
 *
 * `api` is { loadModel, checkRepository } from @archdoc/core and
 * @archdoc/analyzers (src in tests, dist in the eval).
 */
export async function scoreRepo(dir, scenario, api) {
  const e = scenario.expect;
  const model = await api.loadModel(".", { cwd: dir });
  const ids = new Set(model.elements.keys());
  const uses = model.relationships
    .filter((r) => r.to.type !== "external")
    .map((r) => [r.from.id, r.to.id]);
  const facts = [];
  // "a|b": any of them, for a name the task leaves to the agent.
  const has = (id) =>
    String(id)
      .split("|")
      .some((x) => ids.has(x.trim()));
  for (const id of e.elements?.present ?? []) facts.push([`element ${id}`, has(id)]);
  for (const id of e.elements?.absent ?? []) facts.push([`no element ${id}`, !has(id)]);
  const holds = (use) => {
    const [from, to] = sides(use);
    return uses.some(([f, t]) => from.includes(f) && to.includes(t));
  };
  for (const u of e.uses?.present ?? []) facts.push([`use ${u}`, holds(u)]);
  for (const u of e.uses?.absent ?? []) facts.push([`no use ${u}`, !holds(u)]);
  for (const f of e.files?.present ?? []) facts.push([`file ${f}`, existsSync(join(dir, f))]);
  for (const f of e.files?.absent ?? []) facts.push([`no file ${f}`, !existsSync(join(dir, f))]);
  const checked = await api.checkRepository({ cwd: dir, base: "main" });
  const left = checked.findings.filter(
    (f) =>
      f.introduced &&
      (f.severity === "error" || f.code.startsWith("drift/") || f.code === "seal/changed"),
  );
  return {
    model: facts.length ? facts.filter(([, ok]) => ok).length / facts.length : 1,
    missed: facts.filter(([, ok]) => !ok).map(([f]) => f),
    clean: left.length === 0,
    left: left.map((f) => `${f.code}: ${f.message}`),
  };
}

const ARCHDOC = /(?:^|[\s;&|])(?:archdoc|npx\s+(?:-y\s+)?@archdoc\/cli(?:@\S+)?)\s+(\w+)/;

/**
 * How the agent went about the change, from its transcript's tool calls: did
 * it ask archdoc context before changing code, change the model with
 * archdoc edit rather than by hand, check against main, and seal.
 */
export function scoreSession(lines) {
  const out = {
    contextFirst: false,
    context: 0,
    edit: 0,
    handEdits: 0,
    yamlReads: 0,
    check: 0,
    seal: 0,
    tools: 0,
  };
  let codeEdited = false;
  for (const m of lines) {
    if (m.type !== "assistant") continue;
    for (const c of m.message?.content ?? []) {
      if (c.type !== "tool_use") continue;
      out.tools++;
      const tool = String(c.name).replace(/^mcp__archdoc__archdoc_/, "archdoc:");
      const command = c.name === "Bash" ? String(c.input?.command ?? "") : "";
      const sub = tool.startsWith("archdoc:") ? tool.slice(8) : ARCHDOC.exec(command)?.[1];
      if (sub === "context") {
        out.context++;
        if (!codeEdited) out.contextFirst = true;
      }
      if (sub === "edit") out.edit++;
      if (sub === "check") out.check++;
      if (sub === "seal") out.seal++;
      const path = String(c.input?.file_path ?? c.input?.path ?? "");
      const model = /(^|\/)\.archdoc\//.test(path);
      if ((c.name === "Edit" || c.name === "Write" || c.name === "MultiEdit") && path) {
        if (model) out.handEdits++;
        else codeEdited = true;
      }
      if (c.name === "Read" && model) out.yamlReads++;
    }
  }
  return out;
}
