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
//        [--set fixtures|real-world] [--judge | --no-judge] [--judge-passes 3]
//        [--max-budget-usd <per run>]
//
// --set real-world runs the open-source repositories in evals/real-world
// instead: each is cloned once into evals/.cache/repos at its pinned commit,
// scored for recall against its partial reference.yaml, and judged by Claude
// (scripts/eval-judge.mjs) for how well decomposed and digestible it is,
// with the onboarding questions in its questions.yaml. --judge judges the
// fixtures too.
//
// Needs the claude CLI signed in (or ANTHROPIC_API_KEY). The agent gets the
// file tools, the archdoc MCP tools, and Bash for archdoc, git, and ls only,
// in a scratch copy of the fixture: nothing else is allowed, so it can't ask.
// Claude Code still lets read-only shell commands (cat, grep, head, wc, git
// ls-files) through, which read no more than the file tools can.
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
import { JUDGE_MODEL, judge, parseYaml } from "./eval-judge.mjs";

const here = new URL("..", import.meta.url).pathname;
const cli = join(here, "packages/cli/dist/bin.js");
const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs|go|py|rs|java|kt|kts|rb|sql|cs|razor|php|swift)$/;
// The built-in tools the agent has at all (--tools); TOOLS are the ones it may use without asking.
const BUILTIN = ["Read", "Glob", "Grep", "Edit", "Write", "Bash"];
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
const set = flag("--set", "fixtures");
if (!["fixtures", "real-world"].includes(set)) throw new Error("--set is fixtures or real-world.");
const real = set === "real-world";
const judging = argv.includes("--no-judge") ? false : real || argv.includes("--judge");
const judgePasses = Number(flag("--judge-passes", "3"));
const budget = flag("--max-budget-usd", undefined);
const fixtures = join(here, real ? "evals/real-world" : "evals/fixtures");
const cache = join(here, "evals/.cache/repos");
const runs = Number(flag("--runs", "3"));
const parallel = Number(flag("--parallel", "2"));
const model = flag("--model", undefined);
const maxTurnsFlag = flag("--max-turns", undefined);
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
  if (!all.includes(n))
    throw new Error(
      `No ${real ? "repository" : "fixture"} ${n} in ${set}. There are: ${all.join(", ")}`,
    );
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

// A fixture's golden.yaml, or a real-world repository's partial reference.yaml.
const goldenFile = real ? "reference.yaml" : "golden.yaml";
const goldenText = (name) => readFileSync(join(fixtures, name, goldenFile), "utf8");
const golden = (name) =>
  buildModel([{ path: goldenFile, text: goldenText(name) }], { root: goldenFile });
/** A real-world repository's repo.yaml: url, commit, and its own maxTurns and maxBudgetUsd. */
const spec = (name) =>
  real ? parseYaml(readFileSync(join(fixtures, name, "repo.yaml"), "utf8")) : {};
const questions = (name) => {
  const p = join(fixtures, name, "questions.yaml");
  return existsSync(p) ? parseYaml(readFileSync(p, "utf8")) : undefined;
};
const maxTurns = (name) => String(maxTurnsFlag ?? spec(name).maxTurns ?? 80);
const maxBudget = (name) => budget ?? spec(name).maxBudgetUsd;

/** The pinned checkout of a real-world repository, cloned into evals/.cache/repos the first time. */
function cached(name) {
  const { url, commit } = spec(name);
  const dir = join(cache, name);
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "ignore" });
  if (!existsSync(dir)) {
    mkdirSync(cache, { recursive: true });
    execFileSync("git", ["clone", "-q", "--filter=blob:none", "--no-checkout", url, dir], {
      stdio: "inherit",
    });
  }
  try {
    git("cat-file", "-e", `${commit}^{commit}`);
  } catch {
    git("fetch", "-q", "--depth=1", "origin", commit);
  }
  git("-c", "advice.detachedHead=false", "checkout", "-q", commit);
  return dir;
}
const sourceFiles = async (root) =>
  (await listRepoFiles(root)).filter((f) => SOURCE.test(f) && !f.startsWith(".archdoc/"));

/** A fresh copy of a fixture's repository, committed, the way an agent would find one. */
function scratchRepo(name) {
  const dir = mkdtempSync(join(tmpdir(), `archdoc-eval-${name}-`));
  if (real) {
    // The pinned commit's files, without the upstream history: an agent's git log can't leak the answer.
    const src = cached(name);
    execFileSync("sh", [
      "-c",
      `git -C "${src}" archive "${spec(name).commit}" | tar -x -C "${dir}"`,
    ]);
  } else {
    cpSync(join(fixtures, name, "repo"), dir, { recursive: true });
  }
  const git = (...a) => execFileSync("git", a, { cwd: dir, stdio: "ignore" });
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("-c", "user.name=eval", "-c", "user.email=eval@archdoc.invalid", "commit", "-qm", "init");
  return dir;
}

/** Claude Code, headless, in `cwd`; resolves with the stream-json result line. */
function runAgent(name, cwd, transcript) {
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
    // Only these settings and tools: nothing the calling session allows leaks in.
    "--setting-sources",
    "",
    "--tools",
    BUILTIN.join(","),
    "--permission-mode",
    "dontAsk",
    "--allowedTools",
    ...TOOLS,
    "--max-turns",
    maxTurns(name),
    ...(maxBudget(name) ? ["--max-budget-usd", String(maxBudget(name))] : []),
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

// Against a partial reference, precision means little: score recall, and an
// overall that's the mean of the recalls, nesting, and code that apply.
const summary = (s) => {
  const pick = (c) => (c.expected ? (real ? c.recall : c.f1) : undefined);
  const out = {
    containers: pick(s.containers),
    components: pick(s.components),
    datastores: pick(s.datastores),
    uses: pick(s.relationships),
    nesting: s.nesting.checked ? s.nesting.ratio : undefined,
    code: s.code.total ? s.code.accuracy : undefined,
    errors: s.errors,
  };
  const parts = ["containers", "components", "datastores", "uses", "nesting", "code"]
    .map((m) => out[m])
    .filter((x) => x !== undefined);
  out.overall = real ? parts.reduce((a, b) => a + b, 0) / parts.length : s.overall;
  return out;
};

async function judged(name, repoDir, modelDir, found) {
  if (!judging) return undefined;
  const j = await judge({
    repoDir,
    modelDir,
    found,
    reference: real ? goldenText(name) : undefined,
    questions: questions(name),
    passes: judgePasses,
    claude,
    core: await import(join(here, "packages/core/dist/index.js")),
  });
  return j;
}

async function oneRun(name, i) {
  const dir = scratchRepo(name);
  const runDir = join(out, name, `run-${i + 1}`);
  mkdirSync(runDir, { recursive: true });
  const started = Date.now();
  const result = await runAgent(name, dir, join(runDir, "transcript.jsonl"));
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
    run.judge = await judged(name, dir, join(dir, ".archdoc"), found);
    if (run.judge) writeFileSync(join(runDir, "judge.json"), JSON.stringify(run.judge, null, 2));
  } else {
    run.error ??= "wrote no .archdoc/";
  }
  if (keep) run.repo = dir;
  else rmSync(dir, { recursive: true, force: true });
  const score = run.score
    ? `${pct(run.score.overall)} overall${run.judge ? `, ${pct(run.judge.digestibility)} digestible` : ""}`
    : "no score";
  console.log(`${name} #${i + 1}: ${score}${run.error ? ` (${run.error})` : ""}`);
  return run;
}

async function initScore(name) {
  const dir = scratchRepo(name);
  const started = Date.now();
  const r = await inferModel(dir);
  const ms = Date.now() - started;
  const found = buildModel(r.files, { root: ".archdoc/archdoc.yaml" });
  const s = scoreModel(found, golden(name), await sourceFiles(dir));
  const out = { ...summary(s), ms };
  if (judging) {
    for (const f of r.files) {
      mkdirSync(join(dir, f.path, ".."), { recursive: true });
      writeFileSync(join(dir, f.path), f.text);
    }
    out.judge = await judged(name, dir, join(dir, ".archdoc"), found);
  }
  rmSync(dir, { recursive: true, force: true });
  return out;
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
const dims = [
  "fidelity",
  "granularity",
  "coverage",
  "relationships",
  "infrastructure",
  "descriptions",
  "journeys",
];
const rows = [];
for (const name of chosen) {
  const mine = results.filter((r) => r.fixture === name).sort((a, b) => a.run - b.run);
  const scored = mine.filter((r) => r.score);
  const overall = scored.map((r) => r.score.overall);
  const judgedRuns = scored.filter((r) => r.judge);
  rows.push({
    fixture: name,
    runs: mine.length,
    scored: scored.length,
    init: await initScore(name),
    agent: Object.fromEntries(
      metrics.map((m) => [m, mean(scored.map((r) => r.score[m]).filter((x) => x !== undefined))]),
    ),
    judge: judgedRuns.length
      ? {
          digestibility: mean(
            judgedRuns.map((r) => r.judge.digestibility).filter((x) => x !== undefined),
          ),
          scores: Object.fromEntries(
            dims.map((d) => [
              d,
              mean(judgedRuns.map((r) => r.judge.scores[d]).filter(Number.isFinite)),
            ]),
          ),
          hits: mean(
            judgedRuns.filter((r) => r.judge.onboarding).map((r) => r.judge.onboarding.hits),
          ),
          questions: judgedRuns.find((r) => r.judge.onboarding)?.judge.onboarding.total,
          files: mean(judgedRuns.map((r) => r.judge.onboarding?.files).filter(Number.isFinite)),
          cost: mean(judgedRuns.map((r) => r.judge.cost)),
        }
      : undefined,
    range: overall.length ? [Math.min(...overall), Math.max(...overall)] : undefined,
    errors: mean(scored.map((r) => r.score.errors)),
    cost: mean(mine.map((r) => r.cost).filter((c) => c !== undefined)),
    turns: mean(mine.map((r) => r.turns).filter((t) => t !== undefined)),
  });
}

writeFileSync(
  join(out, "results.json"),
  JSON.stringify(
    { set, prompt, model, judge: judging ? JUDGE_MODEL : undefined, runs, fixtures: rows, results },
    null,
    2,
  ),
);
const title = (m) => m[0].toUpperCase() + m.slice(1);
const cell = (f, m) => `${pct(f.init[m])} → **${pct(f.agent[m])}**`;
const what = real ? "repository" : "fixture";
const lines = [
  real ? "# ArchDoc agent evals: real-world repositories" : "# ArchDoc agent evals",
  "",
  `${new Date().toISOString()} · ${runs} run${runs === 1 ? "" : "s"} per ${what}${model ? ` · ${model}` : ""}${judging ? ` · judged by ${JUDGE_MODEL}, ${judgePasses} passes` : ""}`,
  "",
  real
    ? "Each cell is init → agent: what archdoc init alone scores, then the agent's mean over its runs. Scored against each repository's partial reference.yaml, so containers, components, datastores, and uses are recall (a model may go further and isn't marked down); nesting and code are the share right; overall is their mean."
    : "Each cell is init → agent: what archdoc init alone scores, then the agent's mean over its runs. Containers, components, datastores, and uses are F1; nesting and code are the share right.",
  "",
  `| ${title(what)} | ${metrics.map(title).join(" | ")} | Range | Errors | Turns | Cost |`,
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
  `Overall, mean over ${real ? "repositories" : "fixtures"}: init ${pct(mean(rows.map((f) => f.init.overall)))} → agent ${pct(mean(rows.map((f) => f.agent.overall).filter((x) => x !== undefined)))}.`,
];
if (judging) {
  const n = (x) => (x === undefined ? "–" : (Math.round(x * 10) / 10).toString());
  lines.push(
    "",
    "## Judged",
    "",
    "Digestibility is the mean of the rubric's dimensions (scripts/eval-judge.mjs), 1 to 5 mapped onto 0 to 100%; each dimension is the median of the judge's passes, then the mean over runs. Onboarding is how many of the newcomer questions the judge answered with an element that covers the answer, using only the model; files is how many files that element covers (fewer is less to read).",
    "",
    `| ${title(what)} | Digestibility | ${dims.map(title).join(" | ")} | Onboarding | Files | Judge cost |`,
    `|---|---|${dims.map(() => "---").join("|")}|---|---|---|`,
    ...rows.map(
      (f) =>
        [
          `| ${f.fixture}`,
          `${pct(f.init.judge?.digestibility)} → **${pct(f.judge?.digestibility)}**`,
          ...dims.map((d) => `${n(f.init.judge?.scores[d])} → **${n(f.judge?.scores[d])}**`),
          f.judge?.questions
            ? `${f.init.judge?.onboarding?.hits ?? "–"} → **${n(f.judge.hits)}** of ${f.judge.questions}`
            : "–",
          `${n(f.init.judge?.onboarding?.files)} → **${n(f.judge?.files)}**`,
          f.judge ? `$${f.judge.cost.toFixed(2)}` : "–",
        ].join(" | ") + " |",
    ),
  );
}
lines.push(
  "",
  "Each run's model, transcript, score (with what it missed), and judge.json are in its run-N/ directory.",
);
const failed = results.filter((r) => r.error);
if (failed.length) {
  lines.push("", "## Runs with problems", "");
  for (const r of failed) lines.push(`- ${r.fixture} #${r.run}: ${r.error}`);
}
writeFileSync(join(out, "report.md"), `${lines.join("\n")}\n`);
console.log(`\n${lines.join("\n")}\n\nWrote ${join(out, "report.md")} and results.json.`);
