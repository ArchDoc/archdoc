import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import {
  checkPlan,
  context,
  editPlan,
  formatPlan,
  formatPlanList,
  type LoadedModel,
  loadModel,
  loadPlans,
  PLAN_DIR,
  type Plan,
  type PlanCheck,
  type PlanEditOp,
  type PlanStatus,
  planId,
  planStatusOf,
  readModelSources,
  readPlanSources,
} from "@archdoc/core";
import { stringify } from "yaml";
import type { Answer, Where } from "./answers.js";
import { indexRepository } from "./symbols.js";
import { modelDir } from "./triage.js";

const NO_MODEL =
  "No ArchDoc model here. Expected .archdoc/archdoc.yaml. Run archdoc init to start one.";

interface Loaded {
  model: LoadedModel;
  sources: Awaited<ReturnType<typeof readModelSources>> & object;
  plans: Plan[];
  dir: string;
}

async function load(where: Where): Promise<Loaded | undefined> {
  const target = where.model ?? ".";
  const model = await loadModel(target, { cwd: where.cwd });
  if (model.diagnostics.some((d) => d.code === "model/not-found")) return undefined;
  const sources = await readModelSources(target, { cwd: where.cwd });
  if (!sources) return undefined;
  const plans = loadPlans(await readPlanSources(target, { cwd: where.cwd })).plans;
  return { model, sources, plans, dir: join(modelDir(model), PLAN_DIR) };
}

function checkOne(l: Loaded, plan: Plan): PlanCheck {
  return checkPlan(l.model, l.sources.sources, plan, { root: l.sources.root });
}

function unknownPlan(l: Loaded, id: string): Answer {
  return {
    ok: false,
    text: `No plan "${id}".${l.plans.length ? ` Plans: ${l.plans.map((p) => p.id).join(", ")}.` : " Start one with archdoc plan start."}`,
  };
}

export interface PlanStartInput {
  /** The idea, as the person put it. */
  goal: string;
  title?: string | undefined;
  id?: string | undefined;
  /** Who it's for: human:@handle. */
  by?: string | undefined;
  /** Files the change will likely touch, to find its scope. */
  paths?: string[] | undefined;
  dryRun?: boolean | undefined;
}

/**
 * Starts a plan from the person's idea: writes `.archdoc/plans/<id>.yaml`
 * as drafting, with the goal and the parts of the model it touches (from
 * archdoc context) as its scope. Says how the person adds what they want on the map.
 */
export async function planStartAnswer(
  where: Where,
  input: PlanStartInput,
): Promise<Answer & { id?: string | undefined }> {
  let goal = input.goal.trim();
  if (!goal) return { ok: false, text: "Give the idea: what the change should do, in a sentence." };
  // A title on a line of its own, then the idea: the first line is the title.
  let title = input.title?.trim();
  const rest = goal.split("\n").slice(1).join("\n").trim();
  if (!title && rest) {
    title = firstLine(goal);
    goal = rest;
  }
  const l = await load(where);
  if (!l) return { ok: false, text: NO_MODEL };
  const index = await indexRepository(l.model.baseDir).catch(() => undefined);
  const brief = context(l.model, goal, { index, paths: input.paths });
  const base = input.id ?? planId(title ?? firstLine(goal));
  const taken = new Set(l.plans.map((p) => p.id));
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
  const scope: Record<string, string[]> = {};
  if (brief.elements.length) scope.elements = brief.elements.map((e) => e.id).slice(0, 8);
  const journeys = [...brief.journeys.map((j) => j.id), ...brief.journeysThrough.map((j) => j.id)];
  if (journeys.length) scope.journeys = [...new Set(journeys)].slice(0, 6);
  if (brief.data.length) scope.data = brief.data.map((d) => d.id).slice(0, 6);
  const spec: Record<string, unknown> = {
    plan: id,
    title: title || firstLine(goal),
    status: "drafting",
    goal,
  };
  if (input.by) spec.by = input.by;
  if (Object.keys(scope).length) spec.scope = scope;
  const yaml = stringify(spec, { lineWidth: 0 });
  const file = join(l.dir, `${id}.yaml`);
  const shown = relative(where.cwd, file).replace(/\\/g, "/") || file;
  const out: string[] = [];
  if (input.dryRun) out.push(`Would write ${shown}:`, "", yaml.trimEnd());
  else {
    await mkdir(l.dir, { recursive: true });
    await writeFile(file, yaml);
    out.push(`Started ${shown} (status: drafting).`);
  }
  if (Object.keys(scope).length) {
    out.push("", "Where the goal lands in the model (its scope):");
    for (const [k, v] of Object.entries(scope)) out.push(`  ${k}: ${v.join(", ")}`);
  }
  out.push(
    "",
    "Next (this is the whole workflow):",
    "  1. Open the explorer for the person yourself, now: run archdoc view --detach --watch --open (it starts in the background, opens their browser, and prints the URL), and give them the URL and the Plan tab under Build. Don't leave the command for them to run. Tell them to click on the map where they want something: a small menu adds a box there (New element) or a note on what they want (New note), and clicking an arrow or dragging from one box to another says how two connect. Each comes to you as they add it (an intent, in their words). They drive the design: you turn what they wrote into the model, a turn each, as in a chat. Don't suggest changes or sequences before they've written and sent an intent (respond refuses them); a note with what you found in the code is fine.",
    `  2. Wait for it: archdoc plan wait ${id} (or archdoc_plan with action wait). It returns their intents and what they changed.`,
    "  3. For each intent, check it against the code (archdoc_context on what it touches) and carry out what it says, no more: the elements, arrows, data, and sequences it asks for, as suggested changes and sequences, each with for: [the intent's ID] and its own intent. An intent with to is about how its two boxes connect (on → to): answer with a use, or a new element between them. Where it leaves a design choice open (which store, sync or queued, a new element or an existing one), don't choose for them: ask with a question on the intent (a note on i1) with options, each a few words and what it costs, which they tap to answer, and suggest once they answer. Add insights and risks you find in the code as notes. Answer with archdoc plan respond. Never edit the person's items: suggest, and they accept or dismiss.",
    "  4. Repeat 2 and 3 until nothing's open and they mark it ready. Then write the tasks that carry it out, each with the changes it makes, files, and tests, and carry them out in order.",
  );
  return { ok: true, text: out.join("\n"), id };
}

function firstLine(text: string): string {
  const line = text.split("\n")[0]?.trim() ?? text;
  return line.length > 80 ? `${line.slice(0, 77)}…` : line;
}

export interface PlanListInput {
  status?: PlanStatus | "open" | undefined;
}

/** The plans, with what's open in each. */
export async function planListAnswer(where: Where, input: PlanListInput = {}): Promise<Answer> {
  const l = await load(where);
  if (!l) return { ok: false, text: NO_MODEL };
  let plans = l.plans;
  if (input.status === "open")
    plans = plans.filter((p) => !["done", "abandoned"].includes(planStatusOf(p.spec)));
  else if (input.status) plans = plans.filter((p) => planStatusOf(p.spec) === input.status);
  return { ok: true, text: formatPlanList(plans.map((p) => checkOne(l, p))) };
}

export interface PlanReadInput {
  id: string;
  /** Leave unread as it is: look without marking it read. */
  peek?: boolean | undefined;
}

/**
 * One plan, as the agent reads it: what the person changed since the last
 * read first, then every item with its intent, what it reaches, what the
 * check found, and what to do next. Clears `unread` unless peeking.
 */
export async function planReadAnswer(where: Where, input: PlanReadInput): Promise<Answer> {
  const l = await load(where);
  if (!l) return { ok: false, text: NO_MODEL };
  const plan = l.plans.find((p) => p.id === input.id);
  if (!plan) return unknownPlan(l, input.id);
  const check = checkOne(l, plan);
  const unread = plan.spec.unread ?? [];
  const behind = (plan.spec.sent ?? 0) > (plan.spec.seen ?? 0);
  if ((unread.length || behind) && !input.peek) await editFile(where, plan, [{ op: "read" }], {});
  const status = planStatusOf(plan.spec);
  return {
    ok: true,
    text: `${formatPlan(check, { unread })}${status === "reviewing" || status === "ready" ? `\n\n${RESPOND_OPS}` : ""}`,
    failing: check.findings.some((f) => f.severity === "error"),
  };
}

/** How to answer, shown with a plan to review: the respond ops, one line each. */
const RESPOND_OPS = [
  "Respond with these ops (archdoc plan respond <id> '<ops as JSON>', or archdoc_plan with action respond). Each intent (i1) is what the person wants: carry it out with suggested changes and sequences that name it in for. An intent with to is about how its two boxes connect (on → to): answer with a use, or a new element between them. An intent on a box the person drew (their own add change) is what that box is for: keep their box and its ID, and suggest what it needs beside it (uses, a set with its description and code). Answer in turns, as in a chat: what's new since your last answer (the unread items) first, briefly, then wait again; one question at a time, with options, beats a list of them.",
  '  {"op":"put","list":"notes","item":{"on":"i1","kind":"question","text":"…","options":["Headless Chromium (150 MB)","Our own SVG renderer"]}}  options: the choices, each a few words with its cost, which the person taps to answer',
  '  {"op":"put","list":"notes","item":{"on":"c1","kind":"insight","text":"…"}}  kind: insight, question, risk, or note; on: an intent, a change, s1, s1#2, or a model ID',
  '  {"op":"reply","note":"n1","text":"…","kind":"answer"}',
  '  {"op":"put","list":"changes","item":{"for":["i1"],"intent":"…","add":{"id":"web.pdf-export","kind":"component","description":"…"}}}  or set, remove, rename, use: {"from":"a","to":"b","description":"…"}; for: the intents it carries out',
  '  {"op":"step","sequence":"s1","at":2,"insert":true,"step":{"from":"a","to":"b","action":"…","sends":"Entry","intent":"…"}}',
  '  {"op":"put","list":"sequences","item":{"for":["i1"],"journey":"export-a-journey","actor":"developer","goal":"…","intent":"…","steps":[…]}}',
  '  {"op":"put","list":"tasks","item":{"title":"…","from":["c1","s1"],"files":["…"],"tests":["…"],"after":["t1"]}}',
  '  {"op":"resolve","note":"n1"}  {"op":"drop","id":"c3"}  (only your own items)',
].join("\n");

export interface PlanWaitInput {
  id: string;
  /** Seconds to wait before giving up. Default 600. */
  timeout?: number | undefined;
  /** How often to look, in milliseconds. Default 1000. */
  interval?: number | undefined;
}

/**
 * Waits until the person sends the plan to the agent (Send to agent in the
 * explorer), then reads it. Returns early when the plan is ready or done.
 */
export async function planWaitAnswer(where: Where, input: PlanWaitInput): Promise<Answer> {
  const l = await load(where);
  if (!l) return { ok: false, text: NO_MODEL };
  const plan = l.plans.find((p) => p.id === input.id);
  if (!plan) return unknownPlan(l, input.id);
  const startSent = plan.spec.sent ?? 0;
  const startStatus = planStatusOf(plan.spec);
  // Sent before the agent started waiting: what changed is already there to
  // read. Past the conversation (marked ready, or further), there's nothing
  // to wait for.
  const behind = startSent > (plan.spec.seen ?? 0);
  const talking = startStatus === "drafting" || startStatus === "reviewing";
  if (!talking || (startStatus !== "drafting" && (plan.spec.unread?.length || behind))) {
    const read = await planReadAnswer(where, { id: input.id });
    return { ...read, text: `The person sent ${input.id} (${startStatus}).\n\n${read.text}` };
  }
  const deadline = Date.now() + (input.timeout ?? 600) * 1000;
  const file = resolve(where.cwd, plan.file);
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, input.interval ?? 1000));
    const text = await readFile(file, "utf8").catch(() => undefined);
    if (text === undefined) return { ok: false, text: `${plan.file} is gone.` };
    const now = loadPlans([{ path: plan.file, text }]).plans[0];
    if (!now) continue; // Mid-write, or not valid yet: look again.
    const status = planStatusOf(now.spec);
    if ((now.spec.sent ?? 0) > startSent || (status !== startStatus && status !== "drafting")) {
      const read = await planReadAnswer(where, { id: input.id });
      return { ...read, text: `The person sent ${input.id} (${status}).\n\n${read.text}` };
    }
  }
  return {
    ok: true,
    text: `Still waiting: the person hasn't sent ${input.id} yet. Run archdoc plan wait ${input.id} again, or ask them in the chat.`,
  };
}

export interface PlanRespondInput {
  id: string;
  ops: PlanEditOp[];
  /** The agent: agent:<name>. */
  by?: string | undefined;
}

/**
 * The agent's answer to a plan: notes, replies, suggested changes and
 * sequences, tasks, and status. A new change or sequence from the agent is a
 * suggestion until the person accepts it, and the agent can't change or
 * accept the person's items, only suggest beside them.
 */
/**
 * Why the agent can't suggest a change or sequence yet: the person drives
 * the design, so a suggestion answers an intent they wrote and sent (`for`),
 * never stands on its own.
 */
function unanswerable(spec: Plan["spec"], wanted: unknown): string | undefined {
  const mine = spec.intents.filter((n) => !n.by?.startsWith("agent:"));
  if (!mine.length || !spec.sent)
    return "the person hasn't said what they want yet. They drive the design: wait for them to click on the map and say what they want there (archdoc plan wait). Until then, only a note with what you found in the code.";
  const ids = Array.isArray(wanted) ? wanted.filter((x): x is string => typeof x === "string") : [];
  if (!ids.length)
    return `say which of the person's intents it carries out, with for: [${mine[0]?.id}]. A suggestion only answers what they asked for; if you think something else is needed, say so in a note.`;
  const unknown = ids.filter((x) => !mine.some((n) => n.id === x));
  if (unknown.length)
    return `for: ${unknown.join(", ")} isn't an intent the person wrote (they have ${mine.map((n) => n.id).join(", ")}).`;
  return undefined;
}

export async function planRespondAnswer(where: Where, input: PlanRespondInput): Promise<Answer> {
  if (!input.ops?.length) return { ok: false, text: "Give at least one op." };
  const l = await load(where);
  if (!l) return { ok: false, text: NO_MODEL };
  const plan = l.plans.find((p) => p.id === input.id);
  if (!plan) return unknownPlan(l, input.id);
  const by = input.by ?? "agent:unknown";
  const refused: string[] = [];
  const ops: PlanEditOp[] = [];
  const human = (author: string | undefined) => !author?.startsWith("agent:");
  for (const op of input.ops) {
    if (op.op === "accept" || op.op === "dismiss" || op.op === "send") {
      refused.push(
        `${op.op}: only the person ${op.op === "send" ? "sends a plan" : `${op.op}s a suggestion`}.`,
      );
      continue;
    }
    if (op.op === "put" && op.list === "intents") {
      refused.push(
        "put intents: intents are the person's. Carry one out with suggested changes and sequences (for: [i1]), or ask about it with a note on it.",
      );
      continue;
    }
    if (op.op === "resolve" && plan.spec.intents.some((n) => n.id === op.note)) {
      refused.push(`resolve ${op.note}: only the person settles an intent.`);
      continue;
    }
    if (op.op === "put" && (op.list === "changes" || op.list === "sequences")) {
      const id = typeof op.item.id === "string" ? op.item.id : undefined;
      const list = op.list === "changes" ? plan.spec.changes : plan.spec.sequences;
      const existing = id ? list.find((x) => x.id === id) : undefined;
      if (existing && human(existing.by)) {
        refused.push(
          `put ${id}: that's the person's. Suggest a change beside it (a new item with status suggested), or add a note on ${id}.`,
        );
        continue;
      }
      const why = unanswerable(plan.spec, op.item.for ?? existing?.for);
      if (why) {
        refused.push(`put ${id ?? op.list}: ${why}`);
        continue;
      }
      ops.push({
        ...op,
        item: { ...op.item, status: op.item.status ?? "suggested" },
      });
      continue;
    }
    if (op.op === "step") {
      const seq = plan.spec.sequences.find((s) => s.id === op.sequence);
      const at = op.at !== undefined && !op.insert ? seq?.steps[op.at - 1] : undefined;
      if (at && human(at.by)) {
        refused.push(
          `step ${op.sequence}#${op.at}: that's the person's. Insert a suggested step, or add a note on it.`,
        );
        continue;
      }
      ops.push({ ...op, step: { ...op.step, status: op.step.status ?? "suggested" } });
      continue;
    }
    if (op.op === "drop") {
      const [head] = op.id.split("#");
      const owner =
        plan.spec.intents.find((n) => n.id === op.id)?.by ??
        plan.spec.changes.find((c) => c.id === op.id)?.by ??
        plan.spec.sequences.find((s) => s.id === head)?.by ??
        plan.spec.notes.find((n) => n.id === op.id)?.by;
      if (!plan.spec.tasks.some((t) => t.id === op.id) && human(owner)) {
        refused.push(`drop ${op.id}: that's the person's. Add a note saying why it should go.`);
        continue;
      }
    }
    ops.push(op);
  }
  if (refused.length) {
    return {
      ok: false,
      text: ["Nothing changed:", ...refused.map((r) => `  ✗ ${r}`)].join("\n"),
    };
  }
  // Answering hands the turn back: the explorer shows the person it's theirs again.
  if (plan.spec.sent && ops.length) ops.push({ op: "answered" });
  const r = await editFile(where, plan, ops, { by });
  if (!r.ok) return r;
  const after = await load(where);
  const now = after?.plans.find((p) => p.id === input.id);
  const check = after && now ? checkOne(after, now) : undefined;
  return {
    ok: true,
    text: [
      r.text,
      ...(check
        ? [
            "",
            `Open: ${check.open.intents} intent${check.open.intents === 1 ? "" : "s"} to work out, ${check.open.questions} question${check.open.questions === 1 ? "" : "s"}, ${check.open.suggestions} suggestion${check.open.suggestions === 1 ? "" : "s"}, ${check.open.missingIntent} without intent.`,
            "Tell the person what you found in a sentence or two; the detail is on the map. Then wait for their next turn (archdoc plan wait) right away: the plan is a conversation, a turn each.",
          ]
        : []),
    ].join("\n"),
  };
}

export interface PlanTaskInput {
  id: string;
  task: string;
  status: "todo" | "doing" | "done" | "skipped";
  note?: string | undefined;
}

/** Sets a task's status while the plan is carried out; the first one started sets the plan executing. */
export async function planTaskAnswer(where: Where, input: PlanTaskInput): Promise<Answer> {
  const l = await load(where);
  if (!l) return { ok: false, text: NO_MODEL };
  const plan = l.plans.find((p) => p.id === input.id);
  if (!plan) return unknownPlan(l, input.id);
  const task = plan.spec.tasks.find((t) => t.id === input.task);
  if (!task) return { ok: false, text: `${input.id} has no task ${input.task}.` };
  const ops: PlanEditOp[] = [
    {
      op: "put",
      list: "tasks",
      item: { ...task, status: input.status, ...(input.note ? { note: input.note } : {}) },
    },
  ];
  const status = planStatusOf(plan.spec);
  const rest = plan.spec.tasks.filter((t) => t.id !== input.task);
  const allDone =
    input.status === "done" || input.status === "skipped"
      ? rest.every((t) => t.status === "done" || t.status === "skipped")
      : false;
  if (allDone) ops.push({ op: "set", status: "done" });
  else if (status === "ready" && input.status !== "todo")
    ops.push({ op: "set", status: "executing" });
  const r = await editFile(where, plan, ops, {});
  if (!r.ok) return r;
  return {
    ok: true,
    text: `${r.text}${allDone ? "\nEvery task is done: the plan is done. Run archdoc check to confirm the model shows it." : ""}`,
  };
}

/**
 * Edits a plan file on disk, by ID. The explorer's edits pass `track` so the
 * agent's next read sees them.
 */
export async function planEditAnswer(
  where: Where,
  input: { id: string; ops: PlanEditOp[]; by?: string | undefined; track?: boolean | undefined },
): Promise<Answer & { plan?: Plan | undefined; ids?: string[] | undefined }> {
  const l = await load(where);
  if (!l) return { ok: false, text: NO_MODEL };
  const plan = l.plans.find((p) => p.id === input.id);
  if (!plan) return unknownPlan(l, input.id);
  return editFile(where, plan, input.ops, { by: input.by, track: input.track });
}

async function editFile(
  where: Where,
  plan: Plan,
  ops: readonly PlanEditOp[],
  options: { by?: string | undefined; track?: boolean | undefined },
): Promise<Answer & { plan?: Plan | undefined; ids?: string[] | undefined }> {
  const file = resolve(where.cwd, plan.file);
  const text = await readFile(file, "utf8");
  const r = editPlan(plan.file, text, ops, options);
  if (r.problems.length || r.text === undefined) {
    return {
      ok: false,
      text: ["Nothing changed:", ...r.problems.map((p) => `  ✗ ${p}`)].join("\n"),
    };
  }
  if (r.text !== text) await writeFile(file, r.text);
  return {
    ok: true,
    text: [`✓ ${plan.file}:`, ...r.done.map((d) => `  ${d}`)].join("\n"),
    plan: r.plan,
    ids: r.ids,
  };
}
