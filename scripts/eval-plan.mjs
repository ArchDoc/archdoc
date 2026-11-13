// The plan eval: does an agent plan a change with a person the way ArchDoc
// asks, at each stage? Each scenario in evals/plan is a fixture (its golden
// model as .archdoc/) and a stage of a plan:
//
//   start   The person has an idea and asks to plan it. The agent should start
//           a plan with its scope, open the explorer, and leave the sketch to
//           the person: no markdown plan, no code, no model edits.
//   answer  The person drew on the map and sent it (plan.yaml, status
//           reviewing): intents in a box, between two boxes, on a box of
//           their own, and one that leaves a choice open. The agent should
//           answer every intent in one short turn, ask (with options) where
//           the choice is open instead of picking, keep the person's box, and
//           wait again. A scripted person then taps the first option and
//           sends it, and the agent should pick the turn up and carry out
//           what they chose. Rule-scored, with minutes per turn.
//   carry   The plan is agreed and ready (plan.yaml). The agent should write
//           the tasks, build them, edit the model as each lands, and mark
//           them, so the plan ends done and the model shows every change.
//
// Claude Code runs headless with the ArchDoc skill, MCP server, and CLI from
// this checkout. Each stage runs on its own, from its own starting state.
//
//   pnpm build
//   pnpm eval:plan                         # every scenario, once
//   pnpm eval:plan --stage answer          # one stage
//   node scripts/eval-plan.mjs [scenario...] [--stage start,answer,carry] [--runs 1]
//        [--parallel 2] [--model <id>] [--max-turns n] [--max-budget-usd n]
//        [--claude claude] [--keep]
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
const stringifyYaml = (value) =>
  createRequire(join(here, "packages/cli/package.json"))("yaml").stringify(value);
const STAGES = ["start", "answer", "carry"];
const BUILTIN = ["Read", "Glob", "Grep", "Bash", "Skill", "Edit", "Write"];
// The shell is open, as a person at their computer would allow it: a denied
// `cat` or `env` reads to an agent as "commands are blocked", and it stops
// opening the explorer. What a run writes is scored instead (Clean).
const READ_TOOLS = ["Skill", "Read", "Glob", "Grep", "mcp__archdoc", "Bash"];
/** What each stage may do without asking: only carrying a plan out edits files. */
const TOOLS = {
  start: READ_TOOLS,
  answer: READ_TOOLS,
  carry: [...READ_TOOLS, "Edit", "Write"],
};
/** Carrying a plan out takes longer than starting one or answering it. */
const LIMITS = {
  start: { turns: "30", budget: "1" },
  answer: { turns: "60", budget: "2" },
  carry: { turns: "80", budget: "3" },
};

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
const maxTurns = flag("--max-turns", undefined);
const budget = flag("--max-budget-usd", undefined);
const claude = flag("--claude", "claude");
const stages = flag("--stage", STAGES.join(",")).split(",");
for (const s of stages)
  if (!STAGES.includes(s)) throw new Error(`No stage ${s}. There are: ${STAGES.join(", ")}`);
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const out = resolve(flag("--out", join(here, "evals/results", `plan-${stamp}`)));
const readScenario = (name) =>
  parseYaml(readFileSync(join(SCENARIOS, name, "scenario.yaml"), "utf8"));
const stageOf = (name) => readScenario(name).stage;
const all = readdirSync(SCENARIOS, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(SCENARIOS, d.name, "scenario.yaml")))
  .map((d) => d.name)
  .sort();
const names = argv.filter((a) => !a.startsWith("--"));
for (const n of names)
  if (!all.includes(n)) throw new Error(`No scenario ${n}. There are: ${all.join(", ")}`);
const chosen = (names.length ? names : all).filter((n) => stages.includes(stageOf(n)));
if (!chosen.length) throw new Error("No scenario in that stage.");
if (!existsSync(cli)) throw new Error("Run pnpm build first.");

const AUTOMATED =
  "(This is an automated run: nobody will answer questions, so don't ask, and don't wait on anything you start.";
const prompts = {
  start: (scenario) =>
    [
      `I'd like to plan a change with you before we build it: ${scenario.idea}.`,
      "",
      "(This is an automated run: nobody will answer questions or sketch during it, so don't ask, and don't wait for my sketch. Set everything up for me as you would for a person at their computer, then stop.)",
    ].join("\n"),
  answer: (_scenario, id) =>
    [
      `I drew a change on ArchDoc's Plan tab and sent it to you: the plan is ${id}. Answer me there, and keep going as I answer in the Plan tab.`,
      "",
      "(This is an automated run: I answer in the Plan tab, not in this chat, so don't ask me here. Don't build anything; once I mark the plan ready, stop.)",
    ].join("\n"),
  carry: (_scenario, id) =>
    [
      `We agreed the plan ${id} and I marked it ready in ArchDoc's Plan tab. Carry it out.`,
      "",
      `${AUTOMATED} The repository has no node_modules, so don't install packages or run its build; read the code instead.)`,
    ].join("\n"),
};

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
// The explorer an agent starts stops after five minutes and opens no browser.
// A detached one is found by its state file under the run's TMPDIR and
// stopped when the run ends.
writeFileSync(
  join(kit, "bin/archdoc"),
  [
    "#!/bin/sh",
    'if [ "$1" = view ]; then',
    '  for a; do shift; [ "$a" = --open ] || set -- "$@" "$a"; done',
    `  command -v timeout >/dev/null && exec timeout 300 node "${cli}" "$@"`,
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

/** Stops the explorers a run left behind: each detached one wrote its pid under `tmp`. */
function stopExplorers(tmp) {
  const dir = join(tmp, "archdoc-view");
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    try {
      const { pid } = JSON.parse(readFileSync(join(dir, f), "utf8"));
      if (pid) process.kill(pid);
    } catch {
      // Gone already.
    }
  }
}

// The agent runs as if on the person's own machine, where the explorer it starts is theirs to open.
const { CLAUDE_CODE_REMOTE: _r, SSH_CONNECTION: _c, SSH_TTY: _t, ...local } = process.env;

/** Claude Code, headless, in `cwd`; resolves with the result line and the tools it called. */
function runAgent(cwd, stage, prompt, transcript, during) {
  const limits = LIMITS[stage];
  const tmp = mkdtempSync(join(tmpdir(), "archdoc-plan-eval-tmp-"));
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
    ...TOOLS[stage],
    "--max-turns",
    maxTurns ?? limits.turns,
    "--max-budget-usd",
    budget ?? limits.budget,
    ...(model ? ["--model", model] : []),
  ];
  return new Promise((done) => {
    const child = spawn(claude, args, {
      cwd,
      env: { ...local, TMPDIR: tmp, PATH: `${join(kit, "bin")}:${process.env.PATH}` },
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
    child.on("error", (e) => done({ error: String(e), calls: [] }));
    during?.(child);
    child.on("close", (code) => {
      stopExplorers(tmp);
      rmSync(tmp, { recursive: true, force: true });
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
      const calls = lines
        .filter((m) => m.type === "assistant")
        .flatMap((m) => (m.message?.content ?? []).filter((c) => c.type === "tool_use"))
        .map((c) => ({ name: c.name, input: c.input ?? {} }));
      done({ result, calls, error: result ? undefined : err.trim() || `exited ${code}` });
    });
  });
}

/** Whether the agent called archdoc_plan with this action, through MCP or the CLI. */
const calledPlan = (calls, action) =>
  calls.some(
    (c) =>
      (c.name === "mcp__archdoc__archdoc_plan" && c.input.action === action) ||
      (c.name === "Bash" && new RegExp(`archdoc\\s+plan\\s+${action}\\b`).test(c.input.command)),
  );
const ranBash = (calls, re) => calls.some((c) => c.name === "Bash" && re.test(c.input.command));

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" });

/** The fixture with its golden model and, past the start, the plan, in one commit. */
function planRepo(name, scenario) {
  const dir = join(mkdtempSync(join(tmpdir(), "archdoc-plan-eval-")), scenario.fixture);
  cpSync(join(FIXTURES, scenario.fixture, "repo"), dir, { recursive: true });
  mkdirSync(join(dir, ".archdoc/plans"), { recursive: true });
  cpSync(join(FIXTURES, scenario.fixture, "golden.yaml"), join(dir, ".archdoc/archdoc.yaml"));
  const plan = join(SCENARIOS, name, "plan.yaml");
  if (existsSync(plan)) cpSync(plan, join(dir, `.archdoc/plans/${name}.yaml`));
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

/** The files a run changed or added, outside the plans. */
const touchedIn = (dir) =>
  git(dir, "status", "--porcelain", "--untracked-files=all")
    .split("\n")
    .filter(Boolean)
    .map((l) => l.slice(3).trim())
    .filter((f) => !f.startsWith(".archdoc/plans/"));

const planFiles = (dir) =>
  readdirSync(join(dir, ".archdoc/plans")).filter((f) => /\.ya?ml$/.test(f));
const readPlan = (dir, file) => parseYaml(readFileSync(join(dir, ".archdoc/plans", file), "utf8"));

const names_ = (id, want) => id === want || id.endsWith(`.${want}`) || want.endsWith(`.${id}`);
const isAgent = (by) => String(by ?? "").startsWith("agent:");
/** The person's items, as they were: the agent may only add beside them. */
function keptOwn(before, after) {
  const own = (list) => (list ?? []).filter((x) => !isAgent(x.by));
  const strip = ({ status: _s, ...x }) => x;
  return (
    JSON.stringify(own(before.changes).map(strip)) ===
      JSON.stringify(own(after.changes).map(strip)) &&
    JSON.stringify(own(before.sequences)) === JSON.stringify(own(after.sequences))
  );
}

/** Scores the start: a plan set up for the person to sketch, and nothing else. */
export function scoreStart({ dir, calls, answer, scenario, added }) {
  const plan = added.length === 1 ? readPlan(dir, added[0]) : undefined;
  const scope = plan?.scope ?? {};
  const scoped = Object.values(scope).flat();
  const touched = touchedIn(dir);
  return {
    started: !!plan && (plan.status ?? "drafting") === "drafting",
    plans: added.length,
    used: calledPlan(calls, "start"),
    scoped: (scenario.expected.scope ?? []).some((s) => scoped.some((x) => names_(x, s))),
    opened: ranBash(calls, /archdoc(\/cli(@\S+)?)?\s+view\b/),
    // Items the agent drew itself: the sketch is the person's to make.
    drew: (plan?.changes?.length ?? 0) + (plan?.sequences?.length ?? 0),
    clean: !touched.length,
    markdown: touched.filter((f) => f.endsWith(".md")).length,
    toldHow: /plan tab|send to agent/i.test(answer),
  };
}

/** How long the person waits on each of the agent's turns before giving up. */
const TURN_MS = 10 * 60_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const words = (text) =>
  String(text ?? "")
    .split(/\s+/)
    .filter(Boolean).length;
const openQuestions = (plan) =>
  (plan.notes ?? []).filter(
    (n) =>
      isAgent(n.by) &&
      n.kind === "question" &&
      !n.resolved &&
      !(n.replies ?? []).some((r) => r.kind === "answer"),
  );

/**
 * The person, in the Plan tab: waits for the agent's first answer, taps the
 * first option on its open question (or, with none, says what they want on
 * the open intent) and sends it, waits for the second answer, then marks the
 * plan ready. Edits go through the explorer's own path (tracked as unread).
 */
async function playPerson({ dir, name, scenario, child, started }) {
  const file = join(dir, `.archdoc/plans/${name}.yaml`);
  const log = {};
  let exited = false;
  child.on("close", () => {
    exited = true;
  });
  const read = () => {
    try {
      return parseYaml(readFileSync(file, "utf8"));
    } catch {
      return undefined; // Mid-write: look again.
    }
  };
  const until = async (ok) => {
    const end = Date.now() + TURN_MS;
    while (Date.now() < end && !exited) {
      const p = read();
      if (p && ok(p)) return p;
      await sleep(2000);
    }
    return undefined;
  };
  const { planEditAnswer } = await import(join(here, "packages/analyzers/dist/index.js"));
  const edit = (ops) =>
    planEditAnswer({ cwd: dir }, { id: name, ops, by: "human:@dana", track: true });

  const first = await until((p) => (p.answered ?? 0) >= 1);
  if (!first) return log;
  log.first = first;
  log.turn1 = (Date.now() - started) / 60000;
  const q = openQuestions(first).at(-1);
  log.tapped = q?.options?.[0];
  const said = await edit([
    ...(q
      ? [
          { op: "reply", note: q.id, text: q.options?.[0] ?? "Queue it", kind: "answer" },
          { op: "resolve", note: q.id },
        ]
      : [
          {
            op: "put",
            list: "notes",
            item: {
              on: scenario.expected.open,
              text: "Queue it, so checkout never waits on email",
            },
          },
        ]),
    { op: "send" },
  ]);
  if (!said.ok) {
    log.error = said.text;
    return log;
  }
  const sentAt = Date.now();
  const second = await until((p) => (p.answered ?? 0) >= 2);
  if (second) {
    log.second = second;
    log.turn2 = (Date.now() - sentAt) / 60000;
  }
  // Done talking: the person marks it ready, which ends the agent's wait.
  await edit([{ op: "set", status: "ready" }]);
  const end = Date.now() + 120_000;
  while (!exited && Date.now() < end) await sleep(1000);
  if (!exited) {
    log.stopped = true;
    child.kill("SIGTERM");
  }
  return log;
}

/**
 * Scores the conversation: the first answer (every intent answered, the
 * clear ones carried out, a question with options on the open one, the
 * person's box kept, brief) and the second (picked up, and what the person
 * chose carried out).
 */
export function scoreAnswer({ before, after, scenario, person, calls }) {
  const first = person.first ?? after;
  const { clear = [], open, box } = scenario.expected;
  const live = (x) => isAgent(x.by) && x.status !== "dismissed";
  const forIt = (plan, id) =>
    [...(plan.changes ?? []), ...(plan.sequences ?? [])].filter(
      (x) => live(x) && x.for?.includes(id),
    );
  const notesOn = (plan, id) => {
    const intent = (plan.intents ?? []).find((i) => i.id === id);
    const drew = (plan.changes ?? []).find((c) => !isAgent(c.by) && c.add?.id === intent?.on);
    const about = new Set([id, ...forIt(plan, id).map((x) => x.id), ...(drew ? [drew.id] : [])]);
    return (plan.notes ?? []).filter((n) => isAgent(n.by) && n.on && about.has(n.on.split("#")[0]));
  };
  const mine = (before.intents ?? []).map((i) => i.id);
  const answered = mine.filter((id) => forIt(first, id).length || notesOn(first, id).length);
  const asked = notesOn(first, open).some(
    (n) => n.kind === "question" && (n.options?.length ?? 0) >= 2,
  );
  const said = (first.notes ?? []).filter((n) => isAgent(n.by));
  const touchedBox = [...(after.changes ?? [])].some(
    (c) =>
      isAgent(c.by) &&
      ((c.add && c.add.id === box.id) ||
        (c.rename && c.rename.id === box.id) ||
        c.remove === box.id ||
        c.remove?.id === box.id),
  );
  const ownBox = (after.changes ?? []).find((c) => c.id === box.change);
  const order = calls.map(
    (c) =>
      (c.name === "mcp__archdoc__archdoc_plan" && c.input.action) ||
      (c.name === "Bash" && /archdoc\s+plan\s+(\w+)/.exec(c.input.command)?.[1]) ||
      undefined,
  );
  const responded = order.indexOf("respond");
  return {
    answered: answered.length / (mine.length || 1),
    carried: clear.filter((id) => forIt(first, id).length).length / (clear.length || 1),
    asked,
    picked: !asked && forIt(first, open).length > 0,
    kept: keptOwn(before, after) && !touchedBox && ownBox?.add?.id === box.id,
    questions: said.filter((n) => n.kind === "question").length,
    words: mean(said.map((n) => words(n.text))) ?? 0,
    read: (first.seen ?? 0) >= 1,
    used: responded >= 0,
    waited: responded >= 0 && order.slice(responded + 1).includes("wait"),
    tapped: person.tapped,
    pickedUp: (after.seen ?? 0) >= 2,
    secondAnswered: !!person.second,
    carriedChoice: !!person.second && forIt(person.second, open).length > 0,
    turn1: person.turn1,
    turn2: person.turn2,
    stopped: person.stopped === true,
    error: person.error,
  };
}

/** What `archdoc check` says about the repository, as JSON findings. */
const checkJson = (dir) =>
  JSON.parse(
    execFileSync("node", [cli, "check", "--all", "--fail-on", "never", "--format", "json"], {
      cwd: dir,
      encoding: "utf8",
    }),
  );

/**
 * Which of the plan's items the model doesn't show: ArchDoc's own drift check,
 * run on a copy of the plan as it was agreed with one done task carrying them all.
 */
function notBuilt(dir, before, ids) {
  const id = "zz-eval-built";
  const file = join(dir, `.archdoc/plans/${id}.yaml`);
  writeFileSync(
    file,
    stringifyYaml({
      plan: id,
      title: "What the model should show",
      status: "executing",
      changes: before.changes,
      sequences: before.sequences,
      tasks: [{ id: "t1", title: "All of it", from: ids, status: "done" }],
    }),
  );
  try {
    const drift = checkJson(dir).find(
      (f) => f.code === "plan/drift" && (f.files ?? []).includes(`.archdoc/plans/${id}.yaml`),
    );
    const m = drift?.message.match(/doesn't show (.+) yet/);
    return m ? m[1].split(", ") : [];
  } finally {
    rmSync(file, { force: true });
  }
}

/** Whether the code the change needs is there: a file, or a file in a directory, with its words. */
function hasCode(dir, { path, words }) {
  const at = join(dir, path);
  if (!existsSync(at)) return false;
  const files = path.endsWith("/")
    ? readdirSync(at, { recursive: true }).map((f) => join(at, String(f)))
    : [at];
  const re = new RegExp(words, "i");
  return files.some((f) => {
    try {
      return re.test(readFileSync(f, "utf8"));
    } catch {
      return false;
    }
  });
}

/** Scores carrying the plan out: tasks written and done, code and model built, the check clean. */
export function scoreCarry({ dir, calls, before, after, scenario }) {
  const tasks = after.tasks ?? [];
  const want = scenario.expected.built ?? [];
  const from = new Set(tasks.flatMap((t) => t.from ?? []));
  const missing = notBuilt(dir, before, want);
  const findings = checkJson(dir);
  const handEdited = calls.some(
    (c) =>
      (c.name === "Edit" || c.name === "Write") &&
      /\.archdoc\/(?!plans\/)[^/]+\.ya?ml$/.test(String(c.input.file_path)),
  );
  return {
    tasks: tasks.length,
    described: tasks.length
      ? mean(tasks.map((t) => (t.from?.length && t.files?.length ? 1 : 0)))
      : 0,
    covered: want.filter((w) => from.has(w)).length / (want.length || 1),
    tasksDone:
      tasks.length > 0 && tasks.every((t) => t.status === "done" || t.status === "skipped"),
    status: after.status,
    done: after.status === "done",
    built: (want.length - missing.length) / (want.length || 1),
    missing,
    coded: mean((scenario.expected.code ?? []).map((c) => (hasCode(dir, c) ? 1 : 0))) ?? 1,
    errors: findings.filter((f) => f.severity === "error").length,
    warnings: findings.filter((f) => f.severity === "warning").length,
    kept: keptOwn(before, after),
    marked: calledPlan(calls, "task"),
    viaEdit: calls.some(
      (c) =>
        c.name === "mcp__archdoc__archdoc_edit" ||
        (c.name === "Bash" && /archdoc\s+edit\b/.test(c.input.command)),
    ),
    handEdited,
  };
}

const pct = (x) => (x === undefined ? "–" : `${Math.round(x * 100)}%`);
const num = (x) => (x === undefined ? "–" : x.toFixed(1));
function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined;
}

async function oneRun(name, i) {
  const scenario = readScenario(name);
  const stage = scenario.stage;
  const dir = planRepo(name, scenario);
  const had = new Set(planFiles(dir));
  const file = join(dir, `.archdoc/plans/${name}.yaml`);
  const before = existsSync(file) ? parseYaml(readFileSync(file, "utf8")) : undefined;
  const runDir = join(out, name, `run-${i + 1}`);
  mkdirSync(runDir, { recursive: true });
  const started = Date.now();
  let playing;
  const { result, calls, error } = await runAgent(
    dir,
    stage,
    prompts[stage](scenario, name),
    join(runDir, "transcript.jsonl"),
    stage === "answer"
      ? (child) => {
          playing = playPerson({ dir, name, scenario, child, started });
        }
      : undefined,
  );
  const person = (await playing) ?? {};
  if (person.first) writeFileSync(join(runDir, "first-answer.yaml"), stringifyYaml(person.first));
  const answer = String(result?.result ?? "");
  writeFileSync(join(runDir, "answer.md"), `${answer}\n`);
  const added = planFiles(dir).filter((f) => !had.has(f));
  for (const f of [...(before ? [`${name}.yaml`] : []), ...added])
    writeFileSync(join(runDir, f), readFileSync(join(dir, ".archdoc/plans", f), "utf8"));
  if (stage === "carry") writeFileSync(join(runDir, "diff.patch"), git(dir, "diff"));
  const after = existsSync(file) ? parseYaml(readFileSync(file, "utf8")) : undefined;
  const touched = touchedIn(dir);
  let score;
  if (stage === "start") score = scoreStart({ dir, calls, answer, scenario, added });
  else if (stage === "answer") score = scoreAnswer({ before, after, scenario, person, calls });
  else score = scoreCarry({ dir, calls, before, after, scenario });
  writeFileSync(join(runDir, "score.json"), `${JSON.stringify(score, null, 2)}\n`);
  if (!keep) rmSync(dirname(dir), { recursive: true, force: true });
  const run = {
    scenario: name,
    stage,
    run: i + 1,
    ms: Date.now() - started,
    turns: result?.num_turns,
    cost: result?.total_cost_usd,
    touched,
    score,
    // Stopped by the person once the conversation was over: not an error.
    error: person.stopped
      ? undefined
      : (person.error ?? error ?? (result?.is_error ? (result.subtype ?? "error") : undefined)),
  };
  const headline =
    stage === "start"
      ? `started ${score.started ? "yes" : "no"}`
      : stage === "answer"
        ? `answered ${pct(score.answered)}, picked up ${score.pickedUp ? "yes" : "no"}`
        : `built ${pct(score.built)}, ${score.status}`;
  console.log(`${name} #${i + 1}: ${headline}${run.error ? ` (${run.error})` : ""}`);
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

/** One table per stage: what each stage asks of the agent differs. */
const TABLES = {
  start: {
    title: "Start",
    legend:
      "Started: one plan written, drafting. Used: through archdoc_plan start. Scoped: its scope reaches the part of the model the idea touches. Opened: the explorer started. Told how: the answer tells the person to sketch it in the Plan tab and send it. Drew: items the agent sketched itself (the sketch is the person's). Clean: no code, model, or markdown plan written.",
    cols: [
      ["Started", (_m, s) => pct(s((r) => r.score.started))],
      ["Used", (_m, s) => pct(s((r) => r.score.used))],
      ["Scoped", (_m, s) => pct(s((r) => r.score.scoped))],
      ["Opened", (_m, s) => pct(s((r) => r.score.opened))],
      ["Told how", (_m, s) => pct(s((r) => r.score.toldHow))],
      ["Drew", (m) => num(mean(m.map((r) => r.score.drew)))],
      ["Clean", (_m, s) => pct(s((r) => r.score.clean))],
    ],
  },
  answer: {
    title: "Answer",
    legend:
      "First turn: Answered: the share of the person's intents with a suggestion for it (for) or a note on it. Carried: the clear intents with a suggestion for each. Asked: a question with options on the intent that leaves a choice open; Picked: suggestions for it with no question (choosing for the person). Kept: the person's box kept, with its ID. Questions: how many the agent asked (one at a time is best). Words: per note. Waited: waited again after answering. Second turn, after the person taps the first option and sends it: Picked up: the agent read it; Carried choice: a suggestion for the open intent. Minutes: to the first answer, and from the person's send to the second.",
    cols: [
      ["Answered", (m) => `**${pct(mean(m.map((r) => r.score.answered)))}**`],
      ["Carried", (m) => pct(mean(m.map((r) => r.score.carried)))],
      ["Asked", (_m, s) => pct(s((r) => r.score.asked))],
      ["Picked", (_m, s) => pct(s((r) => r.score.picked))],
      ["Kept", (_m, s) => pct(s((r) => r.score.kept))],
      ["Questions", (m) => num(mean(m.map((r) => r.score.questions)))],
      ["Words", (m) => num(mean(m.map((r) => r.score.words)))],
      ["Clean", (_m, s) => pct(s((r) => !r.touched.length))],
      ["Waited", (_m, s) => pct(s((r) => r.score.waited))],
      ["Picked up", (_m, s) => `**${pct(s((r) => r.score.pickedUp))}**`],
      ["Carried choice", (_m, s) => pct(s((r) => r.score.carriedChoice))],
      ["Turn 1 min", (m) => num(mean(m.map((r) => r.score.turn1).filter((x) => x !== undefined)))],
      ["Turn 2 min", (m) => num(mean(m.map((r) => r.score.turn2).filter((x) => x !== undefined)))],
    ],
  },
  carry: {
    title: "Carry out",
    legend:
      "Built: the share of the plan's changes and sequences the model shows after the run (ArchDoc's own drift check). Coded: the code the change needs is there. Done: the plan ended done, every task done. Tasks: how many it wrote; Described: each with the changes it carries out and its files; Covered: the plan's items some task carries out. Marked: tasks set through archdoc_plan task. Via edit: the model changed through archdoc edit, not by hand. Errors: archdoc check errors left. Kept: the person's items left as they were.",
    cols: [
      ["Built", (m) => `**${pct(mean(m.map((r) => r.score.built)))}**`],
      ["Coded", (m) => pct(mean(m.map((r) => r.score.coded)))],
      ["Done", (_m, s) => pct(s((r) => r.score.done && r.score.tasksDone))],
      ["Tasks", (m) => num(mean(m.map((r) => r.score.tasks)))],
      ["Described", (m) => pct(mean(m.map((r) => r.score.described)))],
      ["Covered", (m) => pct(mean(m.map((r) => r.score.covered)))],
      ["Marked", (_m, s) => pct(s((r) => r.score.marked))],
      ["Via edit", (_m, s) => pct(s((r) => r.score.viaEdit && !r.score.handEdited))],
      ["Errors", (m) => num(mean(m.map((r) => r.score.errors)))],
      ["Kept", (_m, s) => pct(s((r) => r.score.kept))],
    ],
  },
};

const summary = [];
const lines = [
  "# ArchDoc agent evals: planning a change",
  "",
  `${new Date().toISOString()} · ${runs} run${runs === 1 ? "" : "s"} per scenario${model ? ` · ${model}` : ""}`,
];
for (const stage of STAGES) {
  const mine = chosen.filter((n) => stageOf(n) === stage);
  if (!mine.length) continue;
  const t = TABLES[stage];
  lines.push(
    "",
    `## ${t.title}`,
    "",
    t.legend,
    "",
    `| Scenario | ${t.cols.map(([h]) => h).join(" | ")} | Minutes | Cost |`,
    `|---|${t.cols.map(() => "---").join("|")}|---|---|`,
  );
  for (const name of mine) {
    const m = results.filter((r) => r.scenario === name);
    const share = (f) => mean(m.map((r) => (f(r) ? 1 : 0)));
    const minutes = mean(m.map((r) => r.ms / 60000));
    const cost = mean(m.map((r) => r.cost).filter((c) => c !== undefined));
    summary.push({ scenario: name, stage, runs: m.length, minutes, cost });
    lines.push(
      `| ${name} | ${t.cols.map(([, f]) => f(m, share)).join(" | ")} | ${num(minutes)} | ${cost === undefined ? "–" : `$${cost.toFixed(2)}`} |`,
    );
  }
}
const failed = results.filter((r) => r.error);
if (failed.length) lines.push("", ...failed.map((r) => `- ${r.scenario} #${r.run}: ${r.error}`));
writeFileSync(
  join(out, "results.json"),
  JSON.stringify({ model, runs, scenarios: summary, results }, null, 2),
);
writeFileSync(join(out, "report.md"), `${lines.join("\n")}\n`);
console.log(`\n${lines.join("\n")}\n\nWrote ${join(out, "report.md")}.`);
