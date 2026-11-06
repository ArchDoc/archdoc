// The branch diff eval: can an agent help a person see what their branch
// changes in the architecture? Each scenario in evals/diff makes a branch on a
// fixture (its golden model committed on main, then a code change on the
// branch), asks Claude Code headless, with the ArchDoc skill, MCP server, and
// CLI from this checkout, to show what the branch changes, and scores the
// change it reports against what the branch changed, next to what the Diff tab
// (codeChange, served by /api/compare) reads from the code.
//
//   pnpm build
//   pnpm eval:diff                        # every scenario, once
//   pnpm eval:diff --changed origin/main  # only if the change since main touches the diff
//   node scripts/eval-diff.mjs [scenario...] [--runs 1] [--parallel 2] [--model <id>]
//        [--max-turns 30] [--max-budget-usd 0.75] [--out evals/results/diff-<time>]
//        [--claude claude] [--keep] [--changed <ref> [--check-only]]
//
// It calls a model, so it costs money: with --changed it runs only when the
// change since that ref touches DIFF_PATHS in scripts/eval-diff-lib.mjs (the
// differ, the code map, the compare API, the Diff tab, the skills' lines about
// the diff, and this eval), and otherwise exits 0 having spent nothing. CI
// runs it that way (.github/workflows/eval-diff.yml). The free half, the Diff
// tab on the same scenarios, runs in pnpm test
// (packages/analyzers/test/diff-evals.test.ts).
//
// The agent may read files, use the archdoc MCP tools and CLI (npx
// @archdoc/cli runs this checkout's), and run git status, diff, log, and
// branch, and ls. It can't edit anything: seeing a diff changes nothing.
import { spawn } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  answerChange,
  branchRepo,
  changeFacts,
  diffEvalReasons,
  diffTabChange,
  loadScenario,
  scenarioNames,
  scoreChange,
} from "./eval-diff-lib.mjs";

const here = new URL("..", import.meta.url).pathname;
const cli = join(here, "packages/cli/dist/bin.js");
// Skill, so the agent can load the archdoc skill, where the diff guidance is.
const BUILTIN = ["Read", "Glob", "Grep", "Bash", "Skill"];
const TOOLS = [
  "Skill",
  "Read",
  "Glob",
  "Grep",
  "mcp__archdoc",
  "Bash(archdoc:*)",
  "Bash(npx -y @archdoc/cli:*)",
  "Bash(npx @archdoc/cli:*)",
  "Bash(git status:*)",
  "Bash(git diff:*)",
  "Bash(git log:*)",
  "Bash(git branch:*)",
  "Bash(ls:*)",
];

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(name);
  if (i < 0) return fallback;
  const [v] = argv.splice(i, 2).slice(1);
  return v;
};
const keep = argv.includes("--keep");
const changedSince = flag("--changed", undefined);
// With --changed: say whether it would run, and stop there.
const checkOnly = argv.includes("--check-only");
const runs = Number(flag("--runs", "1"));
const parallel = Number(flag("--parallel", "2"));
const model = flag("--model", undefined);
const maxTurns = flag("--max-turns", "30");
const budget = flag("--max-budget-usd", "0.75");
const claude = flag("--claude", "claude");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const out = resolve(flag("--out", join(here, "evals/results", `diff-${stamp}`)));
const prompt = flag(
  "--prompt",
  [
    "I'm on a branch. Show me what it changes in this repository's architecture, compared with main.",
    "",
    "(This is an automated run: nobody will answer questions, so don't ask, and don't wait on anything you start.",
    "End your reply with a ```json block of the change, in the model's element IDs:",
    '{"elements": {"added": [], "changed": [], "removed": []}, "uses": {"added": ["from -> to"], "removed": ["from -> to"]}}.',
    "An element is added when the branch adds code no element has yet, removed when all its code is gone, and changed when some of its code changed;",
    "a use is a dependency between two elements that the branch's code added or dropped.)",
  ].join("\n"),
);

if (changedSince) {
  const reasons = diffEvalReasons(changedSince);
  // For CI: whether to install, build, and run, as a step output.
  if (process.env.GITHUB_OUTPUT)
    writeFileSync(process.env.GITHUB_OUTPUT, `run=${reasons.length > 0}\n`, { flag: "a" });
  if (!reasons.length) {
    console.log(`Skipped: nothing the branch diff depends on changed since ${changedSince}.`);
    process.exit(0);
  }
  console.log(`Changed since ${changedSince}:\n${reasons.map((r) => `  ${r}`).join("\n")}`);
  if (checkOnly) process.exit(0);
}

const names = argv.filter((a) => !a.startsWith("--"));
const all = scenarioNames();
for (const n of names) {
  if (!all.includes(n)) throw new Error(`No scenario ${n}. There are: ${all.join(", ")}`);
}
const chosen = names.length ? names : all;
if (!existsSync(cli)) throw new Error("Run pnpm build first.");
const { codeChange } = await import(join(here, "packages/analyzers/dist/index.js"));

// What Claude Code gets: the skill as a plugin, and the MCP server and CLI from this build.
const kit = mkdtempSync(join(tmpdir(), "archdoc-diff-eval-kit-"));
cpSync(join(here, "integrations/claude-plugin/skills"), join(kit, "plugin/skills"), {
  recursive: true,
});
mkdirSync(join(kit, "plugin/.claude-plugin"), { recursive: true });
cpSync(
  join(here, "integrations/claude-plugin/.claude-plugin/plugin.json"),
  join(kit, "plugin/.claude-plugin/plugin.json"),
);
writeFileSync(
  join(kit, "mcp.json"),
  JSON.stringify({ mcpServers: { archdoc: { command: "node", args: [cli, "mcp"] } } }),
);
mkdirSync(join(kit, "bin"));
// The explorer an agent starts in the background stops after five minutes, so no run leaves one behind.
writeFileSync(
  join(kit, "bin/archdoc"),
  [
    "#!/bin/sh",
    'if [ "$1" = view ] && command -v timeout >/dev/null; then',
    `  exec timeout 300 node "${cli}" "$@"`,
    "fi",
    `exec node "${cli}" "$@"`,
    "",
  ].join("\n"),
);
// The skill starts the explorer with npx @archdoc/cli: run this checkout's, not the one on npm.
writeFileSync(
  join(kit, "bin/npx"),
  [
    "#!/bin/sh",
    'while [ "$1" = -y ] || [ "$1" = --yes ]; do shift; done',
    'case "$1" in',
    `  @archdoc/cli|@archdoc/cli@*) shift; exec "${join(kit, "bin/archdoc")}" "$@" ;;`,
    "esac",
    'echo "npx: only @archdoc/cli in this eval" >&2',
    "exit 1",
    "",
  ].join("\n"),
);
chmodSync(join(kit, "bin/archdoc"), 0o755);
chmodSync(join(kit, "bin/npx"), 0o755);

/** Claude Code, headless, in `cwd`; resolves with the stream-json lines. */
function runAgent(cwd, transcript) {
  const args = [
    "-p",
    prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--plugin-dir",
    join(kit, "plugin"),
    "--mcp-config",
    join(kit, "mcp.json"),
    "--strict-mcp-config",
    "--setting-sources",
    "",
    "--tools",
    BUILTIN.join(","),
    "--permission-mode",
    "dontAsk",
    "--allowedTools",
    ...TOOLS,
    "--max-turns",
    maxTurns,
    "--max-budget-usd",
    budget,
    ...(model ? ["--model", model] : []),
  ];
  return new Promise((done) => {
    const child = spawn(claude, args, {
      cwd,
      env: { ...process.env, PATH: `${join(kit, "bin")}:${process.env.PATH}` },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let text = "";
    let err = "";
    child.stdout.on("data", (d) => {
      text += d;
    });
    child.stderr.on("data", (d) => {
      err += d;
    });
    child.on("error", (e) => done({ lines: [], error: String(e) }));
    child.on("close", (code) => {
      writeFileSync(transcript, text);
      const lines = text
        .split("\n")
        .filter(Boolean)
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return undefined;
          }
        })
        .filter(Boolean);
      const result = lines.findLast((m) => m.type === "result");
      done({ lines, result, error: result ? undefined : err.trim() || `exited ${code}` });
    });
  });
}

/** How the agent went about it: whether it opened the explorer on the change, and what it read the change with. */
function approach(lines) {
  const out = { shown: false, check: 0, report: 0, modelDiff: 0, gitDiff: 0, tools: 0 };
  for (const m of lines) {
    if (m.type !== "assistant") continue;
    for (const c of m.message?.content ?? []) {
      if (c.type !== "tool_use") continue;
      out.tools++;
      if (c.name === "mcp__archdoc__archdoc_check" && c.input?.base) out.check++;
      if (c.name !== "Bash") continue;
      const command = String(c.input?.command ?? "");
      const archdoc = /(?:^|[\s;&|])(?:archdoc|npx\s+(?:-y\s+)?@archdoc\/cli)\s+(\w+)(.*)/.exec(
        command,
      );
      if (archdoc) {
        const [, sub, rest] = archdoc;
        if (/^(view|site)$/.test(sub) && /(?:--base|-b)[\s=]/.test(rest)) out.shown = true;
        if (sub === "check" && /--base/.test(rest)) out.check++;
        if (sub === "report") out.report++;
        if (sub === "diff") out.modelDiff++;
      }
      if (/\bgit\s+diff\b/.test(command)) out.gitDiff++;
    }
  }
  return out;
}

const pct = (x) => (x === undefined ? "–" : `${Math.round(x * 100)}%`);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);

async function oneRun(name, i) {
  const scenario = loadScenario(name);
  const dir = branchRepo(scenario);
  const runDir = join(out, name, `run-${i + 1}`);
  mkdirSync(runDir, { recursive: true });
  const started = Date.now();
  const { lines, result, error } = await runAgent(dir, join(runDir, "transcript.jsonl"));
  const answer = String(result?.result ?? "");
  const found = answerChange(answer);
  const score = found ? scoreChange(changeFacts(found), scenario) : undefined;
  const run = {
    scenario: name,
    run: i + 1,
    ms: Date.now() - started,
    turns: result?.num_turns,
    cost: result?.total_cost_usd,
    ...approach(lines),
    link: /#diff\b/.test(answer),
    score,
    error:
      error ??
      (result?.is_error ? (result.subtype ?? "error") : undefined) ??
      (found ? undefined : "no json block in the answer"),
  };
  writeFileSync(join(runDir, "answer.md"), `${answer}\n`);
  if (score)
    writeFileSync(
      join(runDir, "score.txt"),
      [
        `F1 ${pct(score.f1)} (precision ${pct(score.precision)}, recall ${pct(score.recall)})`,
        ...score.missed.map((f) => `missed: ${f}`),
        ...score.wrong.map((f) => `wrong: ${f}`),
        "",
      ].join("\n"),
    );
  if (keep) run.repo = dir;
  else rmSync(dirname(dir), { recursive: true, force: true });
  console.log(
    `${name} #${i + 1}: ${score ? `${pct(score.f1)} F1` : "no score"}${run.shown ? ", opened the diff" : ""}${run.error ? ` (${run.error})` : ""}`,
  );
  return run;
}

/** What the Diff tab reads from the same branch, scored the same way: what the agent can lean on. */
async function diffTab(name) {
  const scenario = loadScenario(name);
  const dir = branchRepo(scenario);
  try {
    const read = await codeChange({ cwd: dir, base: "main" });
    return scoreChange(changeFacts(diffTabChange(read.change)), scenario);
  } finally {
    rmSync(dirname(dir), { recursive: true, force: true });
  }
}

mkdirSync(out, { recursive: true });
const jobs = chosen.flatMap((name) => Array.from({ length: runs }, (_, i) => [name, i]));
const results = [];
await Promise.all(
  Array.from({ length: Math.max(1, parallel) }, async () => {
    for (let job = jobs.shift(); job; job = jobs.shift()) results.push(await oneRun(...job));
  }),
);
rmSync(kit, { recursive: true, force: true });

const rows = [];
for (const name of chosen) {
  const mine = results.filter((r) => r.scenario === name);
  const scored = mine.filter((r) => r.score);
  const share = (k) => mean(mine.map((r) => (r[k] ? 1 : 0)));
  rows.push({
    scenario: name,
    runs: mine.length,
    scored: scored.length,
    tab: await diffTab(name),
    f1: mean(scored.map((r) => r.score.f1)),
    precision: mean(scored.map((r) => r.score.precision)),
    recall: mean(scored.map((r) => r.score.recall)),
    shown: share("shown"),
    link: share("link"),
    check: mean(mine.map((r) => r.check)),
    report: mean(mine.map((r) => r.report)),
    modelDiff: mean(mine.map((r) => r.modelDiff)),
    gitDiff: mean(mine.map((r) => r.gitDiff)),
    turns: mean(mine.map((r) => r.turns).filter((t) => t !== undefined)),
    minutes: mean(mine.map((r) => r.ms / 60000)),
    cost: mean(mine.map((r) => r.cost).filter((c) => c !== undefined)),
  });
}

writeFileSync(
  join(out, "results.json"),
  JSON.stringify({ prompt, model, runs, scenarios: rows, results }, null, 2),
);
const n = (x) => (x === undefined ? "–" : (Math.round(x * 10) / 10).toString());
const lines = [
  "# ArchDoc agent evals: the branch diff",
  "",
  `${new Date().toISOString()} · ${runs} run${runs === 1 ? "" : "s"} per scenario${model ? ` · ${model}` : ""}`,
  "",
  "F1 is Diff tab → agent: what the Diff tab reads from the branch's code, then the change the agent reported (mean over runs), each against what the scenario says the branch added, changed, and removed, and the uses it added and dropped. Opened is the share of runs that started the explorer or wrote the site with --base; link, the share whose answer links to #diff. Check, report, model diff, and git diff count its archdoc check --base (or archdoc_check with base), archdoc report, archdoc diff, and git diff calls.",
  "",
  "| Scenario | F1 | Precision | Recall | Opened | Link | Check | Report | Model diff | Git diff | Minutes | Turns | Cost |",
  "|---|---|---|---|---|---|---|---|---|---|---|---|---|",
  ...rows.map(
    (r) =>
      [
        `| ${r.scenario}${r.scored < r.runs ? ` (${r.scored}/${r.runs} scored)` : ""}`,
        `${pct(r.tab.f1)} → **${pct(r.f1)}**`,
        `${pct(r.tab.precision)} → **${pct(r.precision)}**`,
        `${pct(r.tab.recall)} → **${pct(r.recall)}**`,
        pct(r.shown),
        pct(r.link),
        n(r.check),
        n(r.report),
        n(r.modelDiff),
        n(r.gitDiff),
        r.minutes === undefined ? "–" : r.minutes.toFixed(1),
        r.turns === undefined ? "–" : Math.round(r.turns),
        r.cost === undefined ? "–" : `$${r.cost.toFixed(2)}`,
      ].join(" | ") + " |",
  ),
  "",
  `F1, mean over scenarios: Diff tab ${pct(mean(rows.map((r) => r.tab.f1)))} → agent ${pct(mean(rows.map((r) => r.f1).filter((x) => x !== undefined)))}. Spent $${results.reduce((a, r) => a + (r.cost ?? 0), 0).toFixed(2)} in all.`,
  "",
  "Each run's answer, transcript, and score (with what it missed and got wrong) are in its run-N/ directory.",
];
const tabMisses = rows.filter((r) => r.tab.missed.length || r.tab.wrong.length);
if (tabMisses.length) {
  lines.push("", "## What the Diff tab got wrong", "");
  for (const r of tabMisses)
    lines.push(
      ...r.tab.missed.map((f) => `- ${r.scenario}: missed ${f}`),
      ...r.tab.wrong.map((f) => `- ${r.scenario}: wrong ${f}`),
    );
}
const failed = results.filter((r) => r.error);
if (failed.length) {
  lines.push("", "## Runs with problems", "");
  for (const r of failed) lines.push(`- ${r.scenario} #${r.run}: ${r.error}`);
}
writeFileSync(join(out, "report.md"), `${lines.join("\n")}\n`);
console.log(`\n${lines.join("\n")}\n\nWrote ${join(out, "report.md")} and results.json.`);
if (process.env.GITHUB_STEP_SUMMARY)
  writeFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`, { flag: "a" });
