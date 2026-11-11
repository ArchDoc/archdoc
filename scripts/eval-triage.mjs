// The triage eval: handed a bug report, does an agent find the root cause and
// record it the way ArchDoc asks? Each scenario in evals/triage seeds a bug
// in a fixture (its golden model as .archdoc/, the bug in one commit, so the
// history doesn't give it away), hands Claude Code headless, with the ArchDoc
// skill, MCP server, and CLI from this checkout, the bug report as a person
// would write it, and scores the Triage record it writes (scoreRecord in
// scripts/eval-triage-lib.mjs): whether its cause step is in the right
// element and file, whether it ruled out the lead that isn't the cause, its
// evidence is honest, its hops are ones the model has, and it stopped at
// root-caused instead of fixing the code.
//
//   pnpm build
//   pnpm eval:triage                       # every scenario, once
//   node scripts/eval-triage.mjs [scenario...] [--runs 1] [--parallel 2] [--model <id>]
//        [--max-turns 40] [--max-budget-usd 1] [--out evals/results/triage-<time>]
//        [--claude claude] [--keep]
//   node scripts/eval-triage.mjs --rescore <results dir>   # score its records again, for free
//
// It calls a model, so it costs money, and runs by hand with the claude CLI
// signed in, like eval-diff.mjs. The free half (the scenarios load, a careful
// record scores full marks, a wrong one fails, and archdoc triage start places
// each report on a journey it shows up in) runs in pnpm test
// (packages/analyzers/test/triage-evals.test.ts).
//
// The agent may read files, write and edit them (to write the record), use
// the archdoc MCP tools and CLI, and run git status, diff, log, and ls. It
// can't run the code, so a step that says reproduced isn't honest.
import { spawn } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  bugRepo,
  loadScenario,
  scenarioNames,
  scoreRecord,
  touchedFiles,
} from "./eval-triage-lib.mjs";

const here = new URL("..", import.meta.url).pathname;
const cli = join(here, "packages/cli/dist/bin.js");
const BUILTIN = ["Read", "Glob", "Grep", "Bash", "Skill", "Edit", "Write"];
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
const maxTurns = flag("--max-turns", "40");
const budget = flag("--max-budget-usd", "1");
const claude = flag("--claude", "claude");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
// Score an earlier run's records again, in its directory, without calling a model.
const again = flag("--rescore", undefined);
const out = resolve(again ?? flag("--out", join(here, "evals/results", `triage-${stamp}`)));
const promptFor = (symptom) =>
  [
    "Support sent this bug over. Find its root cause, but don't fix it yet.",
    "",
    symptom.trimEnd(),
    "",
    "(This is an automated run: nobody will answer questions, so don't ask, and don't wait on anything you start. You can read the code but not run it.)",
  ].join("\n");

const names = argv.filter((a) => !a.startsWith("--"));
const all = scenarioNames();
for (const n of names) {
  if (!all.includes(n)) throw new Error(`No scenario ${n}. There are: ${all.join(", ")}`);
}
const chosen = names.length ? names : all;
if (!existsSync(cli)) throw new Error("Run pnpm build first.");
const core = await import(join(here, "packages/core/dist/index.js"));

// What Claude Code gets: the skill as a plugin, and the MCP server and CLI from this build.
const kit = mkdtempSync(join(tmpdir(), "archdoc-triage-eval-kit-"));
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

/** How the agent went about it: whether it started the record with ArchDoc, and what it asked ArchDoc. */
function approach(lines) {
  const out = { skill: false, started: false, context: 0, show: 0, check: 0, tools: 0 };
  for (const m of lines) {
    if (m.type !== "assistant") continue;
    for (const c of m.message?.content ?? []) {
      if (c.type !== "tool_use") continue;
      out.tools++;
      if (c.name === "Skill" && /archdoc/.test(String(c.input?.skill ?? ""))) out.skill = true;
      if (c.name === "mcp__archdoc__archdoc_triage" && c.input?.symptom) out.started = true;
      if (c.name === "mcp__archdoc__archdoc_context") out.context++;
      if (c.name === "mcp__archdoc__archdoc_show") out.show++;
      if (c.name === "mcp__archdoc__archdoc_check") out.check++;
      if (c.name === "mcp__archdoc__archdoc_triage" && c.input?.id && !c.input?.symptom)
        out.check++;
      if (c.name !== "Bash") continue;
      const command = String(c.input?.command ?? "");
      const sub = /(?:^|[\s;&|])(?:archdoc|npx\s+(?:-y\s+)?@archdoc\/cli)\s+(\w+)\s*(\w*)/.exec(
        command,
      );
      if (!sub) continue;
      if (sub[1] === "triage" && sub[2] === "start") out.started = true;
      if (sub[1] === "context") out.context++;
      if (sub[1] === "show") out.show++;
      if (sub[1] === "check") out.check++;
    }
  }
  return out;
}

/** The Triage records in the repository, checked: the one with the most to say first. */
async function records(dir) {
  const m = await core.loadModel(".", { cwd: dir });
  const { traces } = core.loadTraces(await core.readTraceSources(".", { cwd: dir }));
  const files = await core.listRepoFiles(dir);
  const inRepo = new Set(files);
  const read = (p) => (inRepo.has(p) ? readFileSync(join(dir, p), "utf8") : undefined);
  return traces
    .map((t) => core.checkTrace(m, t, { files, read }))
    .sort((a, b) => b.view.steps.length - a.view.steps.length);
}

const pct = (x) => (x === undefined ? "–" : `${Math.round(x * 100)}%`);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);

async function oneRun(name, i) {
  const scenario = loadScenario(name);
  const dir = bugRepo(scenario);
  const runDir = join(out, name, `run-${i + 1}`);
  mkdirSync(runDir, { recursive: true });
  const started = Date.now();
  const { lines, result, error } = await runAgent(
    dir,
    promptFor(scenario.symptom),
    join(runDir, "transcript.jsonl"),
  );
  const answer = String(result?.result ?? "");
  const checked = await records(dir);
  const [best] = checked;
  const score = best ? scoreRecord(best, scenario) : undefined;
  const touched = touchedFiles(dir);
  const run = {
    scenario: name,
    run: i + 1,
    ms: Date.now() - started,
    turns: result?.num_turns,
    cost: result?.total_cost_usd,
    ...approach(lines),
    records: checked.length,
    // Code it changed, and the model: it was asked not to fix anything.
    codeTouched: touched.filter((f) => !f.startsWith(".archdoc/")),
    modelTouched: touched.filter((f) => f.startsWith(".archdoc/")),
    score,
    error:
      error ??
      (result?.is_error ? (result.subtype ?? "error") : undefined) ??
      (best ? undefined : "no Triage record"),
  };
  writeFileSync(join(runDir, "answer.md"), `${answer}\n`);
  if (best) {
    writeFileSync(join(runDir, "record.yaml"), readFileSync(join(dir, best.trace.file), "utf8"));
    writeFileSync(join(runDir, "score.json"), `${JSON.stringify(score, null, 2)}\n`);
  }
  if (keep) run.repo = dir;
  else rmSync(dirname(dir), { recursive: true, force: true });
  console.log(
    `${name} #${i + 1}: ${score ? (score.pass ? "pass" : "fail") : "no record"}${run.error ? ` (${run.error})` : ""}`,
  );
  return run;
}

/** A run from an earlier report, scored again with this scorer: for when the scoring changes. */
async function rescore(run) {
  const runDir = join(out, run.scenario, `run-${run.run}`);
  const file = join(runDir, "record.yaml");
  if (!existsSync(file)) return run;
  const scenario = loadScenario(run.scenario);
  const dir = bugRepo(scenario);
  try {
    mkdirSync(join(dir, ".archdoc/triage"));
    writeFileSync(join(dir, ".archdoc/triage/record.yaml"), readFileSync(file, "utf8"));
    const [best] = await records(dir);
    const score = best ? scoreRecord(best, scenario) : undefined;
    if (score) writeFileSync(join(runDir, "score.json"), `${JSON.stringify(score, null, 2)}\n`);
    return { ...run, score };
  } finally {
    rmSync(dirname(dir), { recursive: true, force: true });
  }
}

mkdirSync(out, { recursive: true });
const jobs = chosen.flatMap((name) => Array.from({ length: runs }, (_, i) => [name, i]));
const results = [];
if (again) {
  const before = JSON.parse(readFileSync(join(out, "results.json"), "utf8")).results;
  for (const r of before) if (chosen.includes(r.scenario)) results.push(await rescore(r));
} else {
  await Promise.all(
    Array.from({ length: Math.max(1, parallel) }, async () => {
      for (let job = jobs.shift(); job; job = jobs.shift()) results.push(await oneRun(...job));
    }),
  );
}
rmSync(kit, { recursive: true, force: true });

const rows = chosen.map((name) => {
  const mine = results.filter((r) => r.scenario === name);
  const scored = mine.filter((r) => r.score);
  const share = (f) => mean(mine.map((r) => (f(r) ? 1 : 0)));
  return {
    scenario: name,
    runs: mine.length,
    pass: share((r) => r.score?.pass && !r.codeTouched.length),
    record: share((r) => r.score),
    cause: share((r) => r.score?.cause),
    specific: share((r) => r.score?.specific),
    code: share((r) => r.score?.code),
    journey: share((r) => r.score?.journey),
    ruledOut: mean(scored.map((r) => r.score.ruledOut).filter((x) => x !== undefined)),
    wrongBlame: share((r) => r.score?.wrongBlame),
    honest: share((r) => r.score?.honest),
    inModel: mean(scored.map((r) => r.score.inModel).filter((x) => x !== undefined)),
    stopped: share((r) => r.score?.stopped && !r.codeTouched.length),
    started: share((r) => r.started),
    skill: share((r) => r.skill),
    turns: mean(mine.map((r) => r.turns).filter((t) => t !== undefined)),
    minutes: mean(mine.map((r) => r.ms / 60000)),
    cost: mean(mine.map((r) => r.cost).filter((c) => c !== undefined)),
  };
});

writeFileSync(
  join(out, "results.json"),
  JSON.stringify({ model, runs, scenarios: rows, results }, null, 2),
);
const lines = [
  "# ArchDoc agent evals: triage",
  "",
  `${new Date().toISOString()} · ${runs} run${runs === 1 ? "" : "s"} per scenario${model ? ` · ${model}` : ""}`,
  "",
  "Each column is the share of runs. Pass: the record's cause step is in the right element and file, it stopped at root-caused without changing code, says nothing was reproduced, and checks clean. Record: it wrote a Triage record. Cause and code: its cause step's element (or what that's part of) and file. Specific: on the element itself, as specific as the model goes. Journey: it opens up a journey the bug shows up in. Ruled out: the share of misleading leads it ruled out. Wrong blame: a cause step on a misleading lead instead. In model: the share of its steps the model declares. Stopped: root-caused, no code changed. Started: it began with archdoc_triage or archdoc triage start.",
  "",
  "| Scenario | Pass | Record | Cause | Specific | Code | Journey | Ruled out | Wrong blame | Honest | In model | Stopped | Started | Skill | Minutes | Turns | Cost |",
  "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|",
  ...rows.map(
    (r) =>
      [
        `| ${r.scenario}`,
        `**${pct(r.pass)}**`,
        pct(r.record),
        pct(r.cause),
        pct(r.specific),
        pct(r.code),
        pct(r.journey),
        pct(r.ruledOut),
        pct(r.wrongBlame),
        pct(r.honest),
        pct(r.inModel),
        pct(r.stopped),
        pct(r.started),
        pct(r.skill),
        r.minutes === undefined ? "–" : r.minutes.toFixed(1),
        r.turns === undefined ? "–" : Math.round(r.turns),
        r.cost === undefined ? "–" : `$${r.cost.toFixed(2)}`,
      ].join(" | ") + " |",
  ),
  "",
  `Pass, mean over scenarios: ${pct(mean(rows.map((r) => r.pass)))}. Spent $${results.reduce((a, r) => a + (r.cost ?? 0), 0).toFixed(2)} in all.`,
  "",
  "Each run's answer, transcript, record, and score are in its run-N/ directory.",
];
const notes = results.filter(
  (r) => r.error || r.codeTouched.length || r.score?.errors.length || (r.score && !r.score.pass),
);
if (notes.length) {
  lines.push("", "## Runs that didn't pass", "");
  for (const r of notes) {
    const why = [
      r.error,
      r.score && !r.score.cause ? "cause step not in the right element" : undefined,
      r.score && !r.score.code ? "cause step not in the right file" : undefined,
      r.score && !r.score.stopped ? `status ${r.score.status}` : undefined,
      r.score && !r.score.honest ? "says it reproduced it" : undefined,
      r.codeTouched.length ? `changed ${r.codeTouched.join(", ")}` : undefined,
      ...(r.score?.errors ?? []),
    ].filter(Boolean);
    lines.push(`- ${r.scenario} #${r.run}: ${why.join("; ")}`);
  }
}
writeFileSync(join(out, "report.md"), `${lines.join("\n")}\n`);
console.log(`\n${lines.join("\n")}\n\nWrote ${join(out, "report.md")} and results.json.`);
