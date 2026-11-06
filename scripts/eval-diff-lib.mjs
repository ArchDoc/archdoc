// What the branch diff eval (scripts/eval-diff.mjs) and its free half
// (packages/analyzers/test/diff-evals.test.ts) share: the paths that decide
// whether it runs, the scenarios in evals/diff, the branch each one makes on a
// fixture, and how an answer is scored against what the branch changed.
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
export const SCENARIOS = join(here, "evals/diff");
const FIXTURES = join(here, "evals/fixtures");
// Read when needed, so diffEvalReasons runs before pnpm install.
const parseYaml = (text) =>
  createRequire(join(here, "packages/cli/package.json"))("yaml").parse(text);

/**
 * The code behind the branch diff: the differ and the code map it places files
 * with, what reads a branch's change, the compare API and the commands that
 * serve it, the Diff tab, and the eval itself. A change elsewhere can't change
 * what the eval measures, so it doesn't run. For the skills, only changed
 * lines about the diff count: most skill edits are about modeling.
 */
export const DIFF_PATHS = [
  { path: "packages/core/src/diff/" },
  { path: "packages/core/src/codemap/" },
  { path: "packages/analyzers/src/code-change.ts" },
  { path: "packages/cli/src/server.ts" },
  { path: "packages/cli/src/commands/diff.ts" },
  { path: "packages/cli/src/commands/view.ts" },
  { path: "packages/cli/src/commands/site.ts" },
  { path: "apps/web/src/model/compare.ts" },
  { path: "apps/web/src/model/useCompare.ts" },
  { path: "integrations/claude-plugin/skills/", lines: /\bdiff\b|--base|#diff|\bcompare/i },
  { path: "evals/diff/" },
  { path: "scripts/eval-diff" },
];

const git = (cwd, ...args) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

/**
 * Why the change since `base` needs the diff eval: each changed file in
 * DIFF_PATHS (for the skills, with a changed line about the diff). Empty when
 * it doesn't. Compares the merge base with `base` to the working tree, so it
 * sees uncommitted work too.
 */
export function diffEvalReasons(base, cwd = here) {
  const from = git(cwd, "merge-base", base, "HEAD").trim();
  const files = git(cwd, "diff", "--name-only", from).split("\n").filter(Boolean);
  const untracked = git(cwd, "ls-files", "--others", "--exclude-standard")
    .split("\n")
    .filter(Boolean);
  const reasons = [];
  for (const file of [...new Set([...files, ...untracked])].sort()) {
    const rule = DIFF_PATHS.find((p) => file.startsWith(p.path));
    if (!rule) continue;
    if (rule.lines) {
      const changed = files.includes(file)
        ? git(cwd, "diff", "-U0", from, "--", file)
            .split("\n")
            .filter((l) => /^[+-][^+-]/.test(l))
        : readFileSync(join(cwd, file), "utf8").split("\n");
      if (!changed.some((l) => rule.lines.test(l))) continue;
    }
    reasons.push(file);
  }
  return reasons;
}

/** The scenarios in evals/diff, by name. */
export function scenarioNames() {
  return readdirSync(SCENARIOS, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(SCENARIOS, d.name, "scenario.yaml")))
    .map((d) => d.name)
    .sort();
}

/** A scenario: the fixture it branches from, the files it deletes, and what the branch changed. */
export function loadScenario(name) {
  const s = parseYaml(readFileSync(join(SCENARIOS, name, "scenario.yaml"), "utf8"));
  return { name, ...s, delete: s.delete ?? [] };
}

/**
 * A scratch repository for a scenario: the fixture with its golden model as
 * .archdoc/, committed on main, then the scenario's change committed on a
 * branch named for it, which is checked out. Returns its directory; remove
 * the directory above it when done.
 */
export function branchRepo(scenario) {
  const dir = join(mkdtempSync(join(tmpdir(), "archdoc-diff-eval-")), scenario.fixture);
  cpSync(join(FIXTURES, scenario.fixture, "repo"), dir, { recursive: true });
  mkdirSync(join(dir, ".archdoc"));
  cpSync(join(FIXTURES, scenario.fixture, "golden.yaml"), join(dir, ".archdoc/archdoc.yaml"));
  const run = (...a) => git(dir, ...a);
  const commit = (message) =>
    run("-c", "user.name=eval", "-c", "user.email=eval@archdoc.invalid", "commit", "-qm", message);
  run("init", "-q", "-b", "main");
  run("add", "-A");
  commit("init");
  run("checkout", "-q", "-b", scenario.name);
  for (const f of scenario.delete) rmSync(join(dir, f));
  const overlay = join(SCENARIOS, scenario.name, "branch");
  if (existsSync(overlay)) cpSync(overlay, dir, { recursive: true });
  run("add", "-A");
  commit(scenario.name);
  return dir;
}

const KINDS = ["added", "changed", "removed"];
const USE_KINDS = ["added", "removed"];

/** "a -> b", or ["a", "b"], as "a -> b". */
const useKey = (u) => {
  const [from, to] = Array.isArray(u)
    ? u
    : typeof u === "object" && u
      ? [u.from, u.to]
      : String(u).split(/\s*->\s*/);
  return `${String(from).trim()} -> ${String(to).trim()}`;
};

/**
 * A change as the set of facts scored: `element <kind> <id>` and
 * `use <kind> <from> -> <to>`. Takes the shape the agent answers with (and
 * scenario.yaml's `expected`): { elements: { added, changed, removed },
 * uses: { added, removed } }.
 */
export function changeFacts(change) {
  const facts = new Set();
  for (const k of KINDS)
    for (const id of change?.elements?.[k] ?? []) facts.add(`element ${k} ${id}`);
  for (const k of USE_KINDS)
    for (const u of change?.uses?.[k] ?? []) facts.add(`use ${k} ${useKey(u)}`);
  return facts;
}

/** What the scenario expects, and what it doesn't mind either way. */
export function expectedFacts(scenario) {
  const e = scenario.expected ?? {};
  const optional = new Set([
    ...KINDS.flatMap((k) => (e.elements?.optional ?? []).map((id) => `element ${k} ${id}`)),
    ...USE_KINDS.flatMap((k) => (e.uses?.optional ?? []).map((u) => `use ${k} ${useKey(u)}`)),
  ]);
  return { facts: changeFacts(e), optional };
}

/** What the Diff tab shows, from @archdoc/analyzers' codeChange: its CodeChange in the answer's shape. */
export function diffTabChange(code) {
  return {
    elements: Object.fromEntries(
      KINDS.map((k) => [k, code.elements.filter((e) => e.kind === k).map((e) => e.id)]),
    ),
    uses: Object.fromEntries(
      USE_KINDS.map((k) => [
        k,
        code.uses.filter((u) => u.kind === k).map((u) => `${u.from} -> ${u.to}`),
      ]),
    ),
  };
}

/** The last ```json block in an answer, parsed; undefined when there's none or it isn't JSON. */
export function answerChange(text) {
  const blocks = [...String(text ?? "").matchAll(/```json\s*\n([\s\S]*?)```/g)];
  const last = blocks.at(-1)?.[1];
  if (!last) return undefined;
  try {
    return JSON.parse(last);
  } catch {
    return undefined;
  }
}

/**
 * Scores found facts against a scenario's. An ID matches the expected one it
 * names or ends (`billing` or `api.payments` for `shop.api.payments`), since
 * an answer may leave out the namespace. Optional facts count neither way.
 */
export function scoreChange(found, scenario) {
  const { facts, optional } = expectedFacts(scenario);
  const ids = new Set();
  for (const f of [...facts, ...optional]) {
    const parts = f.split(" ");
    for (const p of parts.slice(2)) if (p !== "->") ids.add(p);
  }
  const canon = (id) => {
    if (ids.has(id)) return id;
    const hits = [...ids].filter((x) => x.endsWith(`.${id}`));
    return hits.length === 1 ? hits[0] : id;
  };
  const normal = new Set(
    [...found].map((f) => {
      const [what, kind, ...rest] = f.split(" ");
      return [what, kind, ...rest.map((p) => (p === "->" ? p : canon(p)))].join(" ");
    }),
  );
  const hit = [...facts].filter((f) => normal.has(f));
  const missed = [...facts].filter((f) => !normal.has(f));
  const wrong = [...normal].filter((f) => !facts.has(f) && !optional.has(f));
  const recall = facts.size ? hit.length / facts.size : 1;
  const precision = hit.length + wrong.length ? hit.length / (hit.length + wrong.length) : 1;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision, recall, f1, hit, missed, wrong };
}
