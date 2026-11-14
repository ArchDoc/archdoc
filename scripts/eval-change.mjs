// The everyday-loop eval: does an agent keep the model true while it changes
// code? Each scenario in evals/change starts from a fixture with its golden
// model sealed on main, asks Claude Code headless (with the ArchDoc skill, MCP
// server, and CLI from this checkout) to make a code change on a branch, and
// scores what it leaves, deterministically: the scenario's facts about the
// model and code, archdoc check against main (nothing introduced that's an
// error, drift, or an unsealed change), and from the transcript whether it
// asked archdoc context before changing code, changed the model with archdoc
// edit rather than by hand, checked, and sealed.
//
//   pnpm build
//   pnpm eval:change                      # every scenario, once
//   node scripts/eval-change.mjs [scenario...] [--runs 1] [--parallel 2] [--model <id>]
//        [--max-turns 60] [--max-budget-usd 1.5] [--out evals/results/change-<time>]
//        [--claude claude] [--keep]
//
// It calls a model, so it costs money and runs by hand, with the claude CLI
// signed in. The free half, each scenario's reference solution scored the same
// way, runs in pnpm test (packages/analyzers/test/change-evals.test.ts).
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
  loadScenario,
  scenarioNames,
  scoreRepo,
  scoreSession,
  startRepo,
} from "./eval-change-lib.mjs";

const here = new URL("..", import.meta.url).pathname;
const cli = join(here, "packages/cli/dist/bin.js");
const BUILTIN = ["Read", "Glob", "Grep", "Edit", "Write", "Bash", "Skill"];
const TOOLS = [
  "Skill",
  "Read",
  "Glob",
  "Grep",
  "Edit",
  "Write",
  "mcp__archdoc",
  "Bash(archdoc:*)",
  "Bash(npx -y @archdoc/cli:*)",
  "Bash(npx @archdoc/cli:*)",
  "Bash(git status:*)",
  "Bash(git diff:*)",
  "Bash(git log:*)",
  "Bash(ls:*)",
  "Bash(mkdir:*)",
  "Bash(rm:*)",
  "Bash(git rm:*)",
  "Bash(git mv:*)",
];

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(name);
  if (i < 0) return fallback;
  const [v] = argv.splice(i, 2).slice(1);
  return v;
};
const keep = argv.includes("--keep");
const runs = Number(flag("--runs", "1"));
const parallel = Number(flag("--parallel", "2"));
const model = flag("--model", undefined);
const maxTurns = flag("--max-turns", "60");
const budget = flag("--max-budget-usd", "1.5");
const claude = flag("--claude", "claude");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const out = resolve(flag("--out", join(here, "evals/results", `change-${stamp}`)));
const promptFor = (scenario) =>
  [
    scenario.task.trim(),
    "",
    "(This is an automated run on a branch of main: nobody will answer questions, so don't ask, and don't open the explorer.",
    "Stop when the change is done and the repository checks clean against main.)",
  ].join("\n");

const names = argv.filter((a) => !a.startsWith("--"));
const all = scenarioNames();
for (const n of names) {
  if (!all.includes(n)) throw new Error(`No scenario ${n}. There are: ${all.join(", ")}`);
}
const chosen = names.length ? names : all;
if (!existsSync(cli)) throw new Error("Run pnpm build first.");
const { loadModel } = await import(join(here, "packages/core/dist/index.js"));
const { checkRepository, editAnswer, sealAnswer } = await import(
  join(here, "packages/analyzers/dist/index.js")
);
const api = { loadModel, checkRepository, editAnswer, sealAnswer };

// What Claude Code gets: the skill as a plugin, and the MCP server and CLI from this build.
const kit = mkdtempSync(join(tmpdir(), "archdoc-change-eval-kit-"));
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
writeFileSync(join(kit, "bin/archdoc"), `#!/bin/sh\nexec node "${cli}" "$@"\n`);
// The skill runs npx @archdoc/cli: run this checkout's, not the one on npm.
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
function runAgent(cwd, prompt, transcript) {
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

const pct = (x) => (x === undefined ? "–" : `${Math.round(x * 100)}%`);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);

async function oneRun(name, i) {
  const scenario = loadScenario(name);
  const dir = await startRepo(scenario, api);
  const runDir = join(out, name, `run-${i + 1}`);
  mkdirSync(runDir, { recursive: true });
  const started = Date.now();
  const { lines, result, error } = await runAgent(
    dir,
    promptFor(scenario),
    join(runDir, "transcript.jsonl"),
  );
  const repo = await scoreRepo(dir, scenario, api).catch((e) => ({
    model: 0,
    missed: [],
    clean: false,
    left: [`archdoc check failed: ${e instanceof Error ? e.message : e}`],
  }));
  const run = {
    scenario: name,
    run: i + 1,
    ms: Date.now() - started,
    turns: result?.num_turns,
    cost: result?.total_cost_usd,
    ...repo,
    ...scoreSession(lines),
    error: error ?? (result?.is_error ? (result.subtype ?? "error") : undefined),
  };
  writeFileSync(join(runDir, "answer.md"), `${String(result?.result ?? "")}\n`);
  writeFileSync(
    join(runDir, "score.txt"),
    [
      `Model ${pct(repo.model)}, ${repo.clean ? "checks clean" : "doesn't check clean"}`,
      ...repo.missed.map((f) => `missed: ${f}`),
      ...repo.left.map((f) => `left: ${f}`),
      "",
    ].join("\n"),
  );
  if (keep) run.repo = dir;
  else rmSync(dirname(dir), { recursive: true, force: true });
  console.log(
    `${name} #${i + 1}: model ${pct(repo.model)}, ${repo.clean ? "clean" : "not clean"}${run.error ? ` (${run.error})` : ""}`,
  );
  return run;
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

const rows = chosen.map((name) => {
  const mine = results.filter((r) => r.scenario === name);
  const avg = (k) => mean(mine.map((r) => Number(r[k] ?? 0)));
  const share = (k) => mean(mine.map((r) => (r[k] ? 1 : 0)));
  return {
    scenario: name,
    runs: mine.length,
    model: avg("model"),
    clean: share("clean"),
    contextFirst: share("contextFirst"),
    edit: avg("edit"),
    handEdits: avg("handEdits"),
    yamlReads: avg("yamlReads"),
    check: avg("check"),
    seal: avg("seal"),
    turns: mean(mine.map((r) => r.turns).filter((t) => t !== undefined)),
    minutes: mean(mine.map((r) => r.ms / 60000)),
    cost: mean(mine.map((r) => r.cost).filter((c) => c !== undefined)),
  };
});

writeFileSync(
  join(out, "results.json"),
  JSON.stringify({ model, runs, scenarios: rows, results }, null, 2),
);
const n = (x) => (x === undefined ? "–" : (Math.round(x * 10) / 10).toString());
const lines = [
  "# ArchDoc agent evals: the everyday loop",
  "",
  `${new Date().toISOString()} · ${runs} run${runs === 1 ? "" : "s"} per scenario${model ? ` · ${model}` : ""}`,
  "",
  "Model is the share of the scenario's facts about the model and code that hold after the run (mean over runs); clean, the share of runs where archdoc check against main finds nothing the change introduced that's an error, drift, or a sealed fact changed and not sealed again. Context first is the share of runs that asked archdoc context before changing code. Edit, hand edits, YAML reads, check, and seal count its archdoc edit calls, its Edit and Write calls on .archdoc/ files, its Read calls on them, and its archdoc check and seal calls.",
  "",
  "| Scenario | Model | Clean | Context first | Edit | Hand edits | YAML reads | Check | Seal | Minutes | Turns | Cost |",
  "|---|---|---|---|---|---|---|---|---|---|---|---|",
  ...rows.map(
    (r) =>
      [
        `| ${r.scenario}`,
        `**${pct(r.model)}**`,
        `**${pct(r.clean)}**`,
        pct(r.contextFirst),
        n(r.edit),
        n(r.handEdits),
        n(r.yamlReads),
        n(r.check),
        n(r.seal),
        r.minutes === undefined ? "–" : r.minutes.toFixed(1),
        r.turns === undefined ? "–" : Math.round(r.turns),
        r.cost === undefined ? "–" : `$${r.cost.toFixed(2)}`,
      ].join(" | ") + " |",
  ),
  "",
  `Mean over scenarios: model ${pct(mean(rows.map((r) => r.model)))}, clean ${pct(mean(rows.map((r) => r.clean)))}. Spent $${results.reduce((a, r) => a + (r.cost ?? 0), 0).toFixed(2)} in all.`,
  "",
  "Each run's answer, transcript, and score (what it missed and left) are in its run-N/ directory.",
];
const failed = results.filter((r) => r.error);
if (failed.length) {
  lines.push("", "## Runs with problems", "");
  for (const r of failed) lines.push(`- ${r.scenario} #${r.run}: ${r.error}`);
}
writeFileSync(join(out, "report.md"), `${lines.join("\n")}\n`);
console.log(`\n${lines.join("\n")}\n\nWrote ${join(out, "report.md")} and results.json.`);
