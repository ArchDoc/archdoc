// The agent half of the evals in evals/: copies each fixture repo to a
// scratch directory, has Claude Code model it with the ArchDoc skill and MCP
// server built from this checkout (the start-a-model journey), and scores the
// .archdoc/ it writes against the fixture's golden.yaml, next to what archdoc
// init alone scores. Calls a model, so it costs money and isn't run in CI;
// the init half runs in `pnpm test` (packages/analyzers/test/evals.test.ts).
//
//   pnpm build
//   node scripts/eval-agent.mjs [fixture...] [--runs 3] [--parallel 2] [--model <id>]
//        [--max-turns 80] [--out evals/results/<time>] [--claude claude] [--keep]
//
// Needs the claude CLI signed in (or ANTHROPIC_API_KEY). The agent gets the
// file tools, the archdoc MCP tools, and Bash for archdoc, git, and ls only,
// in a scratch copy of the fixture: nothing else is allowed, so it can't ask.
// Writes results.json and report.md to --out, and each run's .archdoc/,
// transcript, and score under it. --keep keeps the scratch repositories.
// --claude swaps the agent for another command that takes the same flags,
// such as a stub for testing the runner.
import { execFileSync, spawn } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const here = new URL("..", import.meta.url).pathname;
const cli = join(here, "packages/cli/dist/bin.js");
const fixtures = join(here, "evals/fixtures");
const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs|go|py|rs|java|kt|rb|sql)$/;
const TOOLS = [
  "Read",
  "Glob",
  "Grep",
  "Edit",
  "Write",
  "mcp__archdoc",
  "Bash(archdoc:*)",
  "Bash(git status:*)",
  "Bash(git diff:*)",
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
const runs = Number(flag("--runs", "3"));
const parallel = Number(flag("--parallel", "2"));
const model = flag("--model", undefined);
const maxTurns = flag("--max-turns", "80");
const claude = flag("--claude", "claude");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const out = resolve(flag("--out", join(here, "evals/results", stamp)));
const prompt = flag(
  "--prompt",
  [
    "Model this repository's architecture with ArchDoc. It has no .archdoc/ yet.",
    "Follow the archdoc skill's workflow for a repository with no model, through archdoc check.",
    "Nobody is here to answer questions or review it: don't ask, and don't open the explorer. Stop when the model is done.",
  ].join(" "),
);
const names = argv.filter((a) => !a.startsWith("--"));
const all = readdirSync(fixtures, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .sort();
const chosen = names.length ? names : all;
for (const n of chosen) {
  if (!all.includes(n)) throw new Error(`No fixture ${n}. There are: ${all.join(", ")}`);
}
if (!existsSync(cli)) throw new Error("Run pnpm build first.");

const { buildModel, formatScore, listRepoFiles, loadModel, scoreModel } = await import(
  join(here, "packages/core/dist/index.js")
);
const { inferModel } = await import(join(here, "packages/analyzers/dist/index.js"));

// What Claude Code gets: the skill as a plugin, the MCP server and the CLI from this build.
const kit = mkdtempSync(join(tmpdir(), "archdoc-eval-kit-"));
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
chmodSync(join(kit, "bin/archdoc"), 0o755);

const golden = (name) => {
  const text = readFileSync(join(fixtures, name, "golden.yaml"), "utf8");
  return buildModel([{ path: "golden.yaml", text }], { root: "golden.yaml" });
};
const sourceFiles = async (root) =>
  (await listRepoFiles(root)).filter((f) => SOURCE.test(f) && !f.startsWith(".archdoc/"));

/** A fresh copy of a fixture's repository, committed, the way an agent would find one. */
function scratchRepo(name) {
  const dir = mkdtempSync(join(tmpdir(), `archdoc-eval-${name}-`));
  cpSync(join(fixtures, name, "repo"), dir, { recursive: true });
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "ignore" });
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("-c", "user.name=eval", "-c", "user.email=eval@archdoc.invalid", "commit", "-qm", "init");
  return dir;
}

/** Claude Code, headless, in `cwd`; resolves with the stream-json result line. */
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
    "--permission-mode",
    "dontAsk",
    "--allowedTools",
    ...TOOLS,
    "--max-turns",
    maxTurns,
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
    child.on("error", (e) => done({ is_error: true, error: String(e) }));
    child.on("close", (code) => {
      writeFileSync(transcript, text);
      const result = text
        .split("\n")
        .filter(Boolean)
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return undefined;
          }
        })
        .findLast((m) => m?.type === "result");
      done(result ?? { is_error: true, error: err.trim() || `exited ${code}` });
    });
  });
}

const summary = (s) => ({
  overall: s.overall,
  containers: s.containers.f1,
  components: s.components.f1,
  datastores: s.datastores.f1,
  uses: s.relationships.f1,
  nesting: s.nesting.ratio,
  code: s.code.accuracy,
  errors: s.errors,
});

async function oneRun(name, i) {
  const dir = scratchRepo(name);
  const runDir = join(out, name, `run-${i + 1}`);
  mkdirSync(runDir, { recursive: true });
  const started = Date.now();
  const result = await runAgent(dir, join(runDir, "transcript.jsonl"));
  const run = {
    fixture: name,
    run: i + 1,
    ms: Date.now() - started,
    turns: result.num_turns,
    cost: result.total_cost_usd,
    error: result.is_error ? (result.error ?? result.result ?? result.subtype) : undefined,
  };
  if (existsSync(join(dir, ".archdoc"))) {
    cpSync(join(dir, ".archdoc"), join(runDir, "archdoc"), { recursive: true });
    const found = await loadModel(".", { cwd: dir });
    const s = scoreModel(found, golden(name), await sourceFiles(dir));
    writeFileSync(join(runDir, "score.txt"), `${formatScore(s, true)}\n`);
    run.score = summary(s);
    run.detail = s;
  } else {
    run.error ??= "wrote no .archdoc/";
  }
  if (keep) run.repo = dir;
  else rmSync(dir, { recursive: true, force: true });
  const score = run.score ? `${pct(run.score.overall)} overall` : "no score";
  console.log(`${name} #${i + 1}: ${score}${run.error ? ` (${run.error})` : ""}`);
  return run;
}

async function initScore(name) {
  const dir = scratchRepo(name);
  const r = await inferModel(dir);
  const found = buildModel(r.files, { root: ".archdoc/archdoc.yaml" });
  const s = scoreModel(found, golden(name), await sourceFiles(dir));
  rmSync(dir, { recursive: true, force: true });
  return summary(s);
}

const pct = (x) => (x === undefined ? "–" : `${Math.round(x * 100)}%`);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);

// Every fixture × run, `parallel` at a time.
mkdirSync(out, { recursive: true });
const jobs = chosen.flatMap((name) => Array.from({ length: runs }, (_, i) => [name, i]));
const results = [];
await Promise.all(
  Array.from({ length: Math.max(1, parallel) }, async () => {
    for (let job = jobs.shift(); job; job = jobs.shift()) results.push(await oneRun(...job));
  }),
);
rmSync(kit, { recursive: true, force: true });

const metrics = ["overall", "containers", "components", "datastores", "uses", "nesting", "code"];
const rows = [];
for (const name of chosen) {
  const mine = results.filter((r) => r.fixture === name).sort((a, b) => a.run - b.run);
  const scored = mine.filter((r) => r.score);
  const overall = scored.map((r) => r.score.overall);
  rows.push({
    fixture: name,
    runs: mine.length,
    scored: scored.length,
    init: await initScore(name),
    agent: Object.fromEntries(metrics.map((m) => [m, mean(scored.map((r) => r.score[m]))])),
    range: overall.length ? [Math.min(...overall), Math.max(...overall)] : undefined,
    errors: mean(scored.map((r) => r.score.errors)),
    cost: mean(mine.map((r) => r.cost).filter((c) => c !== undefined)),
    turns: mean(mine.map((r) => r.turns).filter((t) => t !== undefined)),
  });
}

writeFileSync(
  join(out, "results.json"),
  JSON.stringify({ prompt, model, runs, fixtures: rows, results }, null, 2),
);
const title = (m) => m[0].toUpperCase() + m.slice(1);
const cell = (f, m) => `${pct(f.init[m])} → **${pct(f.agent[m])}**`;
const lines = [
  "# ArchDoc agent evals",
  "",
  `${new Date().toISOString()} · ${runs} run${runs === 1 ? "" : "s"} per fixture${model ? ` · ${model}` : ""}`,
  "",
  "Each cell is init → agent: what archdoc init alone scores, then the agent's mean over its runs. Containers, components, datastores, and uses are F1; nesting and code are the share right.",
  "",
  `| Fixture | ${metrics.map(title).join(" | ")} | Range | Errors | Turns | Cost |`,
  `|---|${metrics.map(() => "---").join("|")}|---|---|---|---|`,
  ...rows.map(
    (f) =>
      [
        `| ${f.fixture}${f.scored < f.runs ? ` (${f.scored}/${f.runs} scored)` : ""}`,
        ...metrics.map((m) => cell(f, m)),
        f.range ? `${pct(f.range[0])}–${pct(f.range[1])}` : "–",
        f.errors ?? "–",
        f.turns === undefined ? "–" : Math.round(f.turns),
        f.cost === undefined ? "–" : `$${f.cost.toFixed(2)}`,
      ].join(" | ") + " |",
  ),
  "",
  `Overall, mean over fixtures: init ${pct(mean(rows.map((f) => f.init.overall)))} → agent ${pct(mean(rows.map((f) => f.agent.overall).filter((x) => x !== undefined)))}.`,
  "",
  "Each run's model, transcript, and score (with what it missed) are in its run-N/ directory.",
];
const failed = results.filter((r) => r.error);
if (failed.length) {
  lines.push("", "## Runs with problems", "");
  for (const r of failed) lines.push(`- ${r.fixture} #${r.run}: ${r.error}`);
}
writeFileSync(join(out, "report.md"), `${lines.join("\n")}\n`);
console.log(`\n${lines.join("\n")}\n\nWrote ${join(out, "report.md")} and results.json.`);
