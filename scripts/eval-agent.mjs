// The agent half of the evals in evals/: copies each fixture repo to a
// scratch directory, has Claude Code model it with the ArchDoc skill and MCP
// server built from this checkout (the start-a-model journey), and scores the
// .archdoc/ it writes against the fixture's golden.yaml, next to what archdoc
// init alone scores. Calls a model, so it costs money and isn't run in CI;
// the init half runs in `pnpm test` (packages/analyzers/test/evals.test.ts).
//
//   pnpm build
//   node scripts/eval-agent.mjs [fixture...] [--runs 1] [--parallel 2] [--model <id>]
//        [--max-turns 80] [--out evals/results/<time>] [--claude claude] [--keep]
//        [--set fixtures|real-world] [--judge | --no-judge] [--judge-passes 1]
//        [--no-judge-cache] [--max-budget-usd <per run>] [--init-only [--print-floor]]
//
// Without --runs, each fixture runs once, except those in NOISY, which run
// twice: their score moves a few points between runs.
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
// --init-only runs archdoc init alone, with no model calls, and holds each
// repository to the initFloor in its repo.yaml (pnpm eval:init).
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
import { dirname, join, resolve } from "node:path";
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
const initOnly = argv.includes("--init-only");
const set = flag("--set", "fixtures");
if (!["fixtures", "real-world"].includes(set)) throw new Error("--set is fixtures or real-world.");
const real = set === "real-world";
const judging = argv.includes("--no-judge") || initOnly ? false : real || argv.includes("--judge");
const judgePasses = Number(flag("--judge-passes", "1"));
const judgeCache = !argv.includes("--no-judge-cache");
const budget = flag("--max-budget-usd", undefined);
const fixtures = join(here, real ? "evals/real-world" : "evals/fixtures");
const cache = join(here, "evals/.cache/repos");
const runsFlag = flag("--runs", undefined);
/** Fixtures whose score moves a few points between runs (93–97%, 95–98% in 0.7.0): two runs by default. */
const NOISY = new Set(real ? [] : ["ts-monorepo", "go-service"]);
const runsFor = (name) => Number(runsFlag ?? (NOISY.has(name) ? 2 : 1));
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

const {
  buildModel,
  formatDiscoveryScore,
  formatScore,
  listRepoFiles,
  loadModel,
  scoreDiscovery,
  scoreModel,
} = await import(join(here, "packages/core/dist/index.js"));
const { FLOW_KINDS, contextFor, findEntryPoints, inferModel } = await import(
  join(here, "packages/analyzers/dist/index.js")
);

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
const repoFiles = async (root) =>
  (await listRepoFiles(root)).filter((f) => !f.startsWith(".archdoc/"));
const sourceFiles = async (root) => (await repoFiles(root)).filter((f) => SOURCE.test(f));

/** Where the repository's flows start (routes, consumers, schedules, commands, pages), for scoreDiscovery. */
const flows = async (root) => {
  const files = await repoFiles(root);
  const found = await findEntryPoints(contextFor(root, files)).catch(() => []);
  return { entryPoints: found.filter((e) => FLOW_KINDS.has(e.kind)) };
};

// A Bash command that runs a script the agent wrote: a heredoc, or an inline program.
const SCRIPT = /<<-?\s*['"]?\w+|\b(?:python3?|node|ruby|perl)\s+(?:-[ce]\b|-\s|-$)|\bbash\s+-c\b/;

/** How the agent spent its session: tool calls, Bash calls, scripts it wrote to explore, and how it found and changed the model (archdoc find and edit, or reading and editing the YAML by hand). */
function effort(transcript) {
  const out = { tools: 0, bash: 0, scripts: 0, find: 0, edit: 0, handEdits: 0, yamlReads: 0 };
  for (const line of transcript.split("\n")) {
    let m;
    try {
      m = JSON.parse(line);
    } catch {
      continue;
    }
    if (m?.type !== "assistant") continue;
    for (const c of m.message?.content ?? []) {
      if (c.type !== "tool_use") continue;
      out.tools++;
      const file = String(c.input?.file_path ?? "");
      const model = /(^|\/)\.archdoc\//.test(file);
      if (c.name === "mcp__archdoc__archdoc_find") out.find++;
      else if (c.name === "mcp__archdoc__archdoc_edit") out.edit++;
      else if ((c.name === "Edit" || c.name === "Write") && model) out.handEdits++;
      else if (c.name === "Read" && model) out.yamlReads++;
      if (c.name !== "Bash") continue;
      out.bash++;
      const command = String(c.input?.command ?? "");
      if (/\barchdoc\s+find\b/.test(command)) out.find++;
      if (/\barchdoc\s+edit\b/.test(command)) out.edit++;
      if (SCRIPT.test(command)) out.scripts++;
    }
  }
  return out;
}

/**
 * A fresh copy of a fixture's repository, committed, the way an agent would
 * find one. It's named for the fixture, inside a unique scratch directory, so
 * init names the model the same way every time (its namespace comes from the
 * directory) and the judge's cache recognizes init's model on the next run.
 */
function scratchRepo(name) {
  const dir = join(mkdtempSync(join(tmpdir(), "archdoc-eval-")), name);
  mkdirSync(dir);
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
      const spent = effort(text);
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
      done({ ...(result ?? { is_error: true, error: err.trim() || `exited ${code}` }), spent });
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

/** scoreDiscovery's parts, flat, for the report: journey recall only when the golden model has journeys. */
const discovered = (d) => ({
  overall: d.overall,
  journeys: d.journeys.expected ? d.journeys.recall : undefined,
  found: d.journeys.found,
  journeyDepth: d.journeyDepth,
  stepDetail: d.stepDetail,
  stepDepth: d.stepPrecision,
  tests: d.testExclusion,
  mapped: d.mapped,
  connected: d.connected,
  described: d.described,
  system: d.system,
  stepData: d.stepData,
  storeData: d.storeData,
  dataFields: d.dataFields,
  journeyFlow: d.journeyFlow,
  deployed: d.deployed,
  entryPoints: d.entryPoints,
  usesShape: d.usesShape,
  codeShape: d.codeShape,
  deploymentMapped: d.deploymentMapped,
  dataDistinct: d.dataDistinct,
  codeNames: d.codeNames,
  codePrecision: d.codePrecision,
  keyCode: d.keyCode,
  gaps: d.gaps,
});

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
    cache: judgeCache,
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
    ...result.spent,
    error: result.is_error ? (result.error ?? result.result ?? result.subtype) : undefined,
  };
  if (existsSync(join(dir, ".archdoc"))) {
    cpSync(join(dir, ".archdoc"), join(runDir, "archdoc"), { recursive: true });
    const found = await loadModel(".", { cwd: dir });
    const g = golden(name);
    const s = scoreModel(found, g, await sourceFiles(dir));
    const d = scoreDiscovery(found, g, await repoFiles(dir), s, await flows(dir));
    writeFileSync(
      join(runDir, "score.txt"),
      `${formatScore(s, true)}\n\n${formatDiscoveryScore(d, true)}\n`,
    );
    run.score = summary(s);
    run.discovery = discovered(d);
    run.detail = s;
    try {
      run.judge = await judged(name, dir, join(dir, ".archdoc"), found);
    } catch (e) {
      run.error ??= `judge failed: ${e}`;
    }
    if (run.judge) writeFileSync(join(runDir, "judge.json"), JSON.stringify(run.judge, null, 2));
  } else {
    run.error ??= "wrote no .archdoc/";
  }
  if (keep) run.repo = dir;
  else rmSync(dirname(dir), { recursive: true, force: true });
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
  const g = golden(name);
  const s = scoreModel(found, g, await sourceFiles(dir));
  const out = {
    ...summary(s),
    ms,
    discovery: discovered(scoreDiscovery(found, g, await repoFiles(dir), s, await flows(dir))),
  };
  if (judging) {
    for (const f of r.files) {
      mkdirSync(join(dir, f.path, ".."), { recursive: true });
      writeFileSync(join(dir, f.path), f.text);
    }
    out.judge = await judged(name, dir, join(dir, ".archdoc"), found);
  }
  rmSync(dirname(dir), { recursive: true, force: true });
  return out;
}

const pct = (x) => (x === undefined ? "–" : `${Math.round(x * 100)}%`);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);

// --init-only: archdoc init alone on each repository, scored, and held to the initFloor in its
// repo.yaml. No model calls, so it's free: run it after changing init or the analyzers.
if (initOnly) {
  const shown = ["overall", "containers", "components", "datastores", "uses", "nesting", "code"];
  let low = 0;
  for (const name of chosen) {
    const s = await initScore(name);
    if (argv.includes("--print-floor")) {
      const f = Object.fromEntries(
        shown.filter((m) => s[m] !== undefined).map((m) => [m, Math.floor(s[m] * 100) / 100]),
      );
      console.log(
        `${name} initFloor: ${JSON.stringify(f).replace(/"/g, "").replace(/,/g, ", ").replace(/:/g, ": ")}`,
      );
    }
    const under = Object.entries(spec(name).initFloor ?? {}).filter(
      ([m, min]) => (s[m] ?? 0) + 1e-9 < min,
    );
    if (under.length) low++;
    console.log(
      `${name}: ${shown.map((m) => `${m} ${pct(s[m])}`).join(", ")}${under.length ? `; below its floor on ${under.map(([m, min]) => `${m} (${pct(min)})`).join(", ")}` : ""}`,
    );
  }
  rmSync(kit, { recursive: true, force: true });
  if (low)
    console.log(
      "Fix what init lost, or lower that floor in the repository's repo.yaml if it's meant.",
    );
  process.exit(low ? 1 : 0);
}

// Every fixture × run, `parallel` at a time.
mkdirSync(out, { recursive: true });
const jobs = chosen.flatMap((name) => Array.from({ length: runsFor(name) }, (_, i) => [name, i]));
const results = [];
await Promise.all(
  Array.from({ length: Math.max(1, parallel) }, async () => {
    for (let job = jobs.shift(); job; job = jobs.shift()) results.push(await oneRun(...job));
  }),
);
rmSync(kit, { recursive: true, force: true });

const metrics = ["overall", "containers", "components", "datastores", "uses", "nesting", "code"];
const discoveryMetrics = [
  "overall",
  "journeys",
  "found",
  "journeyDepth",
  "stepDetail",
  "stepDepth",
  "tests",
  "mapped",
  "connected",
  "described",
  "system",
  "stepData",
  "storeData",
  "dataFields",
  "journeyFlow",
  "deployed",
  "entryPoints",
  "usesShape",
  "codeShape",
  "deploymentMapped",
  "dataDistinct",
  "codeNames",
  "codePrecision",
  "keyCode",
  "gaps",
];
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
    discovery: Object.fromEntries(
      discoveryMetrics.map((m) => [
        m,
        mean(scored.map((r) => r.discovery?.[m]).filter((x) => x !== undefined)),
      ]),
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
    minutes: mean(mine.map((r) => r.ms / 60000)),
    bash: mean(mine.map((r) => r.bash).filter((t) => t !== undefined)),
    scripts: mean(mine.map((r) => r.scripts).filter((t) => t !== undefined)),
    find: mean(mine.map((r) => r.find).filter((t) => t !== undefined)),
    edit: mean(mine.map((r) => r.edit).filter((t) => t !== undefined)),
    handEdits: mean(mine.map((r) => r.handEdits).filter((t) => t !== undefined)),
    yamlReads: mean(mine.map((r) => r.yamlReads).filter((t) => t !== undefined)),
  });
}

writeFileSync(
  join(out, "results.json"),
  JSON.stringify(
    {
      set,
      prompt,
      model,
      judge: judging ? JUDGE_MODEL : undefined,
      judgePasses: judging ? judgePasses : undefined,
      runs: Object.fromEntries(chosen.map((name) => [name, runsFor(name)])),
      fixtures: rows,
      results,
    },
    null,
    2,
  ),
);
const title = (m) => m[0].toUpperCase() + m.slice(1);
const cell = (f, m) => `${pct(f.init[m])} → **${pct(f.agent[m])}**`;
const what = real ? "repository" : "fixture";
const runCounts = [...new Set(chosen.map(runsFor))];
const runsLabel =
  runCounts.length === 1
    ? `${runCounts[0]} run${runCounts[0] === 1 ? "" : "s"} per ${what}`
    : chosen.map((name) => `${name} ×${runsFor(name)}`).join(", ");
const lines = [
  real ? "# ArchDoc agent evals: real-world repositories" : "# ArchDoc agent evals",
  "",
  `${new Date().toISOString()} · ${runsLabel}${model ? ` · ${model}` : ""}${judging ? ` · judged by ${JUDGE_MODEL}, ${judgePasses} pass${judgePasses === 1 ? "" : "es"}` : ""}`,
  "",
  real
    ? "Each cell is init → agent: what archdoc init alone scores, then the agent's mean over its runs. Scored against each repository's partial reference.yaml, so containers, components, datastores, and uses are recall (a model may go further and isn't marked down); nesting and code are the share right; overall is their mean."
    : "Each cell is init → agent: what archdoc init alone scores, then the agent's mean over its runs. Containers, components, datastores, and uses are F1; nesting and code are the share right.",
  "",
  `| ${title(what)} | ${metrics.map(title).join(" | ")} | Range | Errors | Minutes | Turns | Bash | Scripts | Find | Edit | Hand edits | YAML reads | Cost |`,
  `|---|${metrics.map(() => "---").join("|")}|---|---|---|---|---|---|---|---|---|---|---|`,
  ...rows.map(
    (f) =>
      [
        `| ${f.fixture}${f.scored < f.runs ? ` (${f.scored}/${f.runs} scored)` : ""}`,
        ...metrics.map((m) => cell(f, m)),
        f.range ? `${pct(f.range[0])}–${pct(f.range[1])}` : "–",
        f.errors ?? "–",
        f.minutes === undefined ? "–" : f.minutes.toFixed(1),
        f.turns === undefined ? "–" : Math.round(f.turns),
        f.bash === undefined ? "–" : Math.round(f.bash),
        f.scripts === undefined ? "–" : Math.round(f.scripts),
        ...["find", "edit", "handEdits", "yamlReads"].map((k) =>
          f[k] === undefined ? "–" : Math.round(f[k]),
        ),
        f.cost === undefined ? "–" : `$${f.cost.toFixed(2)}`,
      ].join(" | ") + " |",
  ),
  "",
  "Minutes is the agent's wall time; turns, its turns; Bash, its Bash calls; scripts, the Bash calls that ran a program it wrote (a heredoc, python -c, node -e) to explore the repository, which init and archdoc paths should make unnecessary. Find and edit are its archdoc_find and archdoc_edit calls (MCP or CLI); hand edits, its Edit and Write calls on .archdoc/ files; YAML reads, its Read calls on them. Each is a mean over runs.",
  "",
  `Overall, mean over ${real ? "repositories" : "fixtures"}: init ${pct(mean(rows.map((f) => f.init.overall)))} → agent ${pct(mean(rows.map((f) => f.agent.overall).filter((x) => x !== undefined)))}.`,
];
{
  const n = (x) => (x === undefined ? "–" : (Math.round(x * 10) / 10).toString());
  const col = {
    overall: ["Discovery", pct],
    journeys: ["Journeys found", pct],
    found: ["Journeys", n],
    journeyDepth: ["Journey depth", pct],
    stepDetail: ["Step detail", pct],
    stepDepth: ["Step depth", pct],
    tests: ["Tests left out", pct],
    mapped: ["Mapped", pct],
    connected: ["Connected", pct],
    described: ["Described", pct],
    system: ["System", pct],
    stepData: ["Step data", pct],
    storeData: ["Store data", pct],
    dataFields: ["Data fields", pct],
    journeyFlow: ["Journey flow", pct],
    deployed: ["Deployed", pct],
    entryPoints: ["Entry points", pct],
    usesShape: ["Uses shape", pct],
    codeShape: ["Code shape", pct],
    deploymentMapped: ["Deploy mapped", pct],
    dataDistinct: ["Data distinct", pct],
    codeNames: ["Code names", pct],
    codePrecision: ["Code precision", pct],
    keyCode: ["Key code", pct],
    gaps: ["Left to do", n],
  };
  lines.push(
    "",
    "## Discovery",
    "",
    "How well the model was discovered beyond its structure (scoreDiscovery in @archdoc/core), init → agent. Journeys found is the share of the golden model's journeys one of the model's journeys follows (half their hops or more; – when it has none); journeys is how many the model has, and journey depth the share of them long enough to follow that reach the datastore, queue, or external their elements use. Step detail is the share of steps with an action and code that exists; step depth, of steps on the most specific element. Tests left out is the share of test and verification files not modeled as elements of their own. Mapped is the share of source files (not tests, vendored, or generated) some element covers. Connected and described are shares of the model's elements. System is the share of containers, datastores, and queues inside a system element, the box the C4 context draws (0% without one). Step data is the share of steps that cross into another container, datastore, queue, or external that say what they carry; store data, the share of datastores that say what they store and queues something sends through. Data fields is the share of data entries with fields or a schema source; journey flow, the share of steps after a journey's first that start where the flow already is. Deployed is the share of deployable elements an environment places (– when the repository has no deployment files). Entry points is the share of routes, consumers, schedules, commands, and pages a journey step starts at. Uses shape is the share of uses that point the right way (not from a queue or datastore to its consumers), leave their own element's family, and aren't listed again to a part of their target; code shape, the share of elements whose code sits in their parent's, isn't claimed by a sibling too, and isn't one helper file in a big container or generated; deploy mapped, the share of deployment files an environment or element maps (– without environments); data distinct, the share of data entries that aren't numbered copies of another. Code names is the share of containers and components named the way their code is (a directory, package, or file), or, when their code goes by several names, given a plain name:; code precision, the share of code elements and journey steps' code that point at a function, class, or lines rather than a whole file; key code, the share of components and lean containers with a code element at one. Left to do is how many lines archdoc check --done still lists.",
    "",
    `| ${title(what)} | ${discoveryMetrics.map((m) => col[m][0]).join(" | ")} |`,
    `|---|${discoveryMetrics.map(() => "---").join("|")}|`,
    ...rows.map(
      (f) =>
        [
          `| ${f.fixture}`,
          ...discoveryMetrics.map(
            (m) => `${col[m][1](f.init.discovery?.[m])} → **${col[m][1](f.discovery[m])}**`,
          ),
        ].join(" | ") + " |",
    ),
    "",
    `Discovery, mean over ${real ? "repositories" : "fixtures"}: init ${pct(mean(rows.map((f) => f.init.discovery?.overall).filter((x) => x !== undefined)))} → agent ${pct(mean(rows.map((f) => f.discovery.overall).filter((x) => x !== undefined)))}.`,
  );
}
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
  // What judging cost this time, init's models included, and how much the cache saved.
  const initVerdicts = rows.map((f) => f.init.judge).filter(Boolean);
  const verdicts = [...results.map((r) => r.judge).filter(Boolean), ...initVerdicts];
  const spent = (js) => js.reduce((a, j) => a + (j.cost ?? 0), 0);
  lines.push(
    "",
    `Judge cost is the mean per agent run, $0 when its verdict came from the cache (evals/.cache/judge/). Judging spent $${spent(verdicts).toFixed(2)} in all, $${spent(initVerdicts).toFixed(2)} of it on init's models; ${verdicts.filter((j) => j.cached).length} of ${verdicts.length} verdicts came from the cache.`,
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
