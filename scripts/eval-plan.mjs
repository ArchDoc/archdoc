// The plan eval: handed a plan a person sketched in the explorer, with flaws
// seeded in it, does an agent review it the way ArchDoc asks? Each scenario
// in evals/plan is a fixture (its golden model as .archdoc/) and a plan the
// person has sent (plan.yaml, status reviewing). Claude Code runs headless
// with the ArchDoc skill, MCP server, and CLI from this checkout, is told the
// plan was sent, and the plan it leaves behind is scored: each seeded flaw is
// caught when the agent pinned a note to the item (or suggested the fix), a
// sound item drawing a risk or question is a false alarm, and the person's
// items, the code, and the model must be left as they were.
//
//   pnpm build
//   pnpm eval:plan                         # every scenario, once
//   node scripts/eval-plan.mjs [scenario...] [--runs 1] [--parallel 2] [--model <id>]
//        [--max-turns 40] [--max-budget-usd 1] [--claude claude] [--keep]
//
// It calls a model, so it costs money, and runs by hand.
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
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const here = new URL("..", import.meta.url).pathname;
const cli = join(here, "packages/cli/dist/bin.js");
const SCENARIOS = join(here, "evals/plan");
const FIXTURES = join(here, "evals/fixtures");
const parseYaml = (text) =>
  createRequire(join(here, "packages/cli/package.json"))("yaml").parse(text);
const BUILTIN = ["Read", "Glob", "Grep", "Bash", "Skill", "Edit", "Write"];
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
const out = resolve(flag("--out", join(here, "evals/results", `plan-${stamp}`)));
const all = readdirSync(SCENARIOS, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(SCENARIOS, d.name, "scenario.yaml")))
  .map((d) => d.name)
  .sort();
const names = argv.filter((a) => !a.startsWith("--"));
for (const n of names)
  if (!all.includes(n)) throw new Error(`No scenario ${n}. There are: ${all.join(", ")}`);
const chosen = names.length ? names : all;
if (!existsSync(cli)) throw new Error("Run pnpm build first.");

const promptFor = (id) =>
  [
    `I sketched a change in ArchDoc's Plan tab and pressed Send to agent: the plan is ${id}. Review it and answer on the plan.`,
    "",
    "(This is an automated run: nobody will answer questions, so don't ask, and don't wait on anything you start. Don't build anything yet.)",
  ].join("\n");

// What Claude Code gets: the skill as a plugin, and the MCP server and CLI from this build.
const kit = mkdtempSync(join(tmpdir(), "archdoc-plan-eval-kit-"));
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

/** Claude Code, headless, in `cwd`; resolves with the result line. */
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
    child.on("error", (e) => done({ error: String(e) }));
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
      const used = lines.some(
        (m) =>
          m.type === "assistant" &&
          (m.message?.content ?? []).some(
            (c) =>
              c.type === "tool_use" &&
              (c.name === "mcp__archdoc__archdoc_plan" ||
                (c.name === "Bash" && /archdoc\s+plan\s+respond/.test(String(c.input?.command)))),
          ),
      );
      done({ result, used, error: result ? undefined : err.trim() || `exited ${code}` });
    });
  });
}

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" });

/** The fixture with its golden model and the sent plan, in one commit. */
function planRepo(name, scenario) {
  const dir = join(mkdtempSync(join(tmpdir(), "archdoc-plan-eval-")), scenario.fixture);
  cpSync(join(FIXTURES, scenario.fixture, "repo"), dir, { recursive: true });
  mkdirSync(join(dir, ".archdoc/plans"), { recursive: true });
  cpSync(join(FIXTURES, scenario.fixture, "golden.yaml"), join(dir, ".archdoc/archdoc.yaml"));
  cpSync(join(SCENARIOS, name, "plan.yaml"), join(dir, `.archdoc/plans/${name}.yaml`));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "add", "-A");
  git(
    dir,
    "-c",
    "user.name=eval",
    "-c",
    "user.email=eval@archdoc.invalid",
    "commit",
    "-qm",
    "init",
  );
  return dir;
}

const names_ = (id, want) => id === want || id.endsWith(`.${want}`) || want.endsWith(`.${id}`);
const isAgent = (by) => String(by ?? "").startsWith("agent:");

/** Scores the plan the agent left against the scenario's seeded flaws. */
export function scorePlan(before, after, scenario) {
  const notes = (after.notes ?? []).filter((n) => isAgent(n.by));
  const replies = (after.notes ?? []).flatMap((n) =>
    (n.replies ?? []).filter((r) => isAgent(r.by)).map((r) => ({ ...r, on: n.on })),
  );
  const said = [...notes, ...replies];
  const suggested = (after.changes ?? []).filter((c) => isAgent(c.by));
  const caught = scenario.expected.flaws.map((f) => {
    const pinned = said.some(
      (n) => n.on && f.on.some((o) => n.on === o || n.on.startsWith(`${o}#`)),
    );
    const worded = f.words
      ? said.some(
          (n) =>
            n.on &&
            f.on.some((o) => n.on.split("#")[0] === o.split("#")[0]) &&
            new RegExp(f.words, "i").test(n.text),
        )
      : pinned;
    const fixed =
      !!f.fix?.use &&
      suggested.some(
        (c) =>
          c.use &&
          f.fix.use.from.some((x) => names_(c.use.from, x)) &&
          f.fix.use.to.some((x) => names_(c.use.to, x)),
      );
    return { id: f.id, caught: pinned || fixed, worded: worded || fixed, fixed };
  });
  const falseAlarms = said.filter(
    (n) => (scenario.expected.sound ?? []).includes(n.on) && /risk|question/.test(n.kind ?? ""),
  ).length;
  // The person's items, as they were: the agent may only add beside them.
  const own = (list) => (list ?? []).filter((x) => !isAgent(x.by));
  const strip = ({ status: _s, ...x }) => x;
  const kept =
    JSON.stringify(own(before.changes).map(strip)) ===
      JSON.stringify(own(after.changes).map(strip)) &&
    JSON.stringify(own(before.sequences)) === JSON.stringify(own(after.sequences));
  const recall = caught.filter((c) => c.caught).length / caught.length;
  return {
    caught,
    recall,
    worded: caught.filter((c) => c.worded).length / caught.length,
    falseAlarms,
    kept,
    notes: notes.length,
    suggestions: suggested.length,
    statusLeft: after.status,
    unreadCleared: !(after.unread ?? []).length,
  };
}

const pct = (x) => (x === undefined ? "–" : `${Math.round(x * 100)}%`);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined);

async function oneRun(name, i) {
  const scenario = parseYaml(readFileSync(join(SCENARIOS, name, "scenario.yaml"), "utf8"));
  const dir = planRepo(name, scenario);
  const file = join(dir, `.archdoc/plans/${name}.yaml`);
  const before = parseYaml(readFileSync(file, "utf8"));
  const runDir = join(out, name, `run-${i + 1}`);
  mkdirSync(runDir, { recursive: true });
  const started = Date.now();
  const { result, used, error } = await runAgent(
    dir,
    promptFor(name),
    join(runDir, "transcript.jsonl"),
  );
  const after = parseYaml(readFileSync(file, "utf8"));
  writeFileSync(join(runDir, "plan.yaml"), readFileSync(file, "utf8"));
  writeFileSync(join(runDir, "answer.md"), `${String(result?.result ?? "")}\n`);
  const touched = git(dir, "status", "--porcelain", "--untracked-files=all")
    .split("\n")
    .filter(Boolean)
    .map((l) => l.slice(3).trim())
    .filter((f) => !f.startsWith(".archdoc/plans/"));
  const score = scorePlan(before, after, scenario);
  writeFileSync(join(runDir, "score.json"), `${JSON.stringify(score, null, 2)}\n`);
  if (!keep) rmSync(dirname(dir), { recursive: true, force: true });
  const run = {
    scenario: name,
    run: i + 1,
    ms: Date.now() - started,
    turns: result?.num_turns,
    cost: result?.total_cost_usd,
    used,
    touched,
    score,
    error: error ?? (result?.is_error ? (result.subtype ?? "error") : undefined),
  };
  console.log(
    `${name} #${i + 1}: caught ${pct(score.recall)}${run.error ? ` (${run.error})` : ""}`,
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
  const share = (f) => mean(mine.map((r) => (f(r) ? 1 : 0)));
  return {
    scenario: name,
    runs: mine.length,
    caught: mean(mine.map((r) => r.score.recall)),
    worded: mean(mine.map((r) => r.score.worded)),
    falseAlarms: mean(mine.map((r) => r.score.falseAlarms)),
    kept: share((r) => r.score.kept),
    clean: share((r) => !r.touched.length),
    used: share((r) => r.used),
    read: share((r) => r.score.unreadCleared),
    notes: mean(mine.map((r) => r.score.notes)),
    suggestions: mean(mine.map((r) => r.score.suggestions)),
    minutes: mean(mine.map((r) => r.ms / 60000)),
    cost: mean(mine.map((r) => r.cost).filter((c) => c !== undefined)),
  };
});
writeFileSync(
  join(out, "results.json"),
  JSON.stringify({ model, runs, scenarios: rows, results }, null, 2),
);
const lines = [
  "# ArchDoc agent evals: plan review",
  "",
  `${new Date().toISOString()} · ${runs} run${runs === 1 ? "" : "s"} per scenario${model ? ` · ${model}` : ""}`,
  "",
  "Caught: the share of seeded flaws with a note from the agent pinned to the item, or the fix suggested. Worded: and the note says what's wrong. False alarms: risks or questions on items that are sound. Kept: the person's items left as they were. Clean: no code or model changed. Used: answered through archdoc_plan respond. Read: what the person changed is marked read.",
  "",
  "| Scenario | Caught | Worded | False alarms | Kept | Clean | Used | Read | Notes | Suggestions | Minutes | Cost |",
  "|---|---|---|---|---|---|---|---|---|---|---|---|",
  ...rows.map(
    (r) =>
      `| ${r.scenario} | **${pct(r.caught)}** | ${pct(r.worded)} | ${r.falseAlarms?.toFixed(1) ?? "–"} | ${pct(r.kept)} | ${pct(r.clean)} | ${pct(r.used)} | ${pct(r.read)} | ${r.notes?.toFixed(1) ?? "–"} | ${r.suggestions?.toFixed(1) ?? "–"} | ${r.minutes?.toFixed(1) ?? "–"} | ${r.cost === undefined ? "–" : `$${r.cost.toFixed(2)}`} |`,
  ),
  "",
  ...results.filter((r) => r.error).map((r) => `- ${r.scenario} #${r.run}: ${r.error}`),
];
writeFileSync(join(out, "report.md"), `${lines.join("\n")}\n`);
console.log(`\n${lines.join("\n")}\n\nWrote ${join(out, "report.md")}.`);
