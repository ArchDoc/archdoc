import {
  checkTrace,
  type Diagnostic,
  type JourneyNode,
  loadTraces,
  type Model,
  nodeKey,
  type TraceCheck,
  type TraceEnd,
  type TraceStepView,
  type TraceView,
} from "@archdoc/core/browser";
import { type FieldInfo, type Interaction, stepData } from "../graph/data.js";
import { type Lane, type LaneRow, type Lanes, repoName, repoOf, targetLabel } from "./stories.js";
import type { LandscapeInfo } from "./useModel.js";

type TriageStatus = TraceView["status"];
type JourneySpec = JourneyNode["spec"];

/** The traces beside a model, checked against it. */
export interface Traces {
  checks: TraceCheck[];
  /** Files that aren't traces the explorer can read: YAML and schema problems, duplicate IDs. */
  problems: Diagnostic[];
}

/** Reads and checks the trace files the server sends. Code is checked against the repository's files. */
export function readTraces(
  model: Model,
  sources: readonly { path: string; text: string }[],
  files?: readonly string[],
): Traces {
  const { traces, diagnostics } = loadTraces(sources);
  return {
    checks: traces.map((t) => checkTrace(model, t, files?.length ? { files } : {})),
    problems: diagnostics,
  };
}

/** How a trace's end is named: the model's name for it, or as the trace wrote it. */
export function endLabel(model: Model, end: TraceEnd): string {
  if (end.target && (end.status === "resolved" || end.status === "external")) {
    const name = targetLabel(model, end.target);
    // Parts are named with their parent, as traces write them (core.loader), unless they have a name.
    if (end.target.type === "element") {
      const e = model.elements.get(end.target.id);
      const parent = e?.parentId ? model.elements.get(e.parentId) : undefined;
      if (e && !e.spec.name && parent && parent.spec.kind !== "system") {
        return `${parent.key}.${e.key}`;
      }
    }
    return name;
  }
  return end.written;
}

/** Where a trace's end is: its repo, an actor's kind, or that the model doesn't know it. */
function endSub(model: Model, end: TraceEnd, landscape?: LandscapeInfo): string | undefined {
  if (end.status === "unknown") return "not in the model";
  if (end.status === "ambiguous") return "ambiguous";
  if (end.status === "not-synced") return `${end.namespace ?? "another repo"}, not synced`;
  if (!end.target) return undefined;
  if (end.target.type === "actor") return model.actors.get(end.target.id)?.spec.kind;
  const repo = repoOf(model, end.target, landscape);
  return repo ? repoName(model, repo, landscape) : undefined;
}

const keyOf = (end: TraceEnd) => (end.target ? nodeKey(end.target) : `written:${end.written}`);

/** The anchor as a chip: "on review-ai-change · step 4 · critical". */
export function anchorChip(view: TraceView): string | undefined {
  const a = view.anchor;
  if (!a) return view.goal ? `no journey · ${view.goal}` : undefined;
  if (a.status !== "found") return `on ${a.written} · ${a.status.replace("-", " ")}`;
  return [`on ${a.journey}`, `step ${a.step}`, a.importance].filter(Boolean).join(" · ");
}

/** The chips beside the diagnosis: the anchor, "reproduced", and hops the model doesn't declare. */
export function traceChips(
  view: TraceView,
): { label: string; kind: "anchor" | "reproduced" | "undeclared" }[] {
  const out: { label: string; kind: "anchor" | "reproduced" | "undeclared" }[] = [];
  const anchor = anchorChip(view);
  if (anchor) out.push({ label: anchor, kind: "anchor" });
  if (view.steps.some((s) => s.evidence === "reproduced"))
    out.push({ label: "reproduced", kind: "reproduced" });
  const n = view.undeclared.length;
  if (n)
    out.push({
      label: `${n} hop${n === 1 ? "" : "s"} the model doesn't declare`,
      kind: "undeclared",
    });
  return out;
}

/** The step a trace opens on: its first cause, or its first step. */
export function firstCause(view: TraceView): number {
  const i = view.steps.findIndex((s) => s.role === "cause");
  return i < 0 ? 0 : i;
}

/**
 * A trace as lanes: the modeled step it opens up as a grey band, then each hop
 * of the failing run as a row (cause, spreads, symptom, hops the model doesn't
 * declare, and calls that should have happened but didn't), then where the
 * same job works as a green band. Rows are by 0-based step.
 */
export function traceLanes(model: Model, view: TraceView, landscape?: LandscapeInfo): Lanes {
  const lanes: Lane[] = [];
  const index = new Map<string, number>();
  const lane = (end: TraceEnd) => {
    const key = keyOf(end);
    let i = index.get(key);
    if (i === undefined) {
      i = lanes.length;
      index.set(key, i);
      lanes.push({
        key,
        label: endLabel(model, end),
        sub: endSub(model, end, landscape),
        actor: end.target?.type === "actor",
      });
    }
    return i;
  };
  // Columns in the order the run goes, with the modeled step's ends where they first come.
  const modeled = view.anchor?.modeled;
  if (view.actor) lane(view.actor);
  for (const s of view.steps) {
    lane(s.from);
    lane(s.to);
    if (s.missing) lane(s.missing.to);
  }
  if (modeled) {
    lane(modeled.from);
    lane(modeled.to);
  }

  const rows: LaneRow[] = [];
  const a = view.anchor;
  if (a && modeled) {
    rows.push({
      kind: "band",
      key: "modeled",
      tone: "modeled",
      text: `As modeled, step ${a.step}: ${endLabel(model, modeled.from)} → ${endLabel(model, modeled.to)}${modeled.action ? ` "${modeled.action}"` : ""}. The bug opens it up:`,
      from: lane(modeled.from),
      to: lane(modeled.to),
    });
  } else if (a) {
    rows.push({
      kind: "band",
      key: "modeled",
      tone: "modeled",
      text: `Opens up ${a.written}, which the model can't show (${a.status.replace("-", " ")}).`,
    });
  }
  for (const [i, s] of view.steps.entries()) rows.push(...stepRows(model, s, i, lane));
  if (view.worksIn) {
    rows.push({
      kind: "band",
      key: "works",
      tone: "works",
      text: `Same job, done right: ${endLabel(model, view.worksIn.element)}${view.worksIn.note ? ` ${view.worksIn.note}` : ""}${view.worksIn.code.length ? ` (${view.worksIn.code.map((c) => c.label).join(", ")})` : ""}.`,
    });
  }
  return { lanes, rows };
}

function stepRows(
  model: Model,
  s: TraceStepView,
  at: number,
  lane: (end: TraceEnd) => number,
): LaneRow[] {
  const tags: NonNullable<Extract<LaneRow, { kind: "step" }>["tags"]> = [];
  if (s.role === "cause") tags.push({ label: "cause", kind: "cause" });
  if (s.role === "spreads") tags.push({ label: "spreads", kind: "spreads" });
  if (s.role === "symptom") tags.push({ label: "matches your log", kind: "symptom" });
  if (s.hop.kind === "undeclared") tags.push({ label: "not in the model", kind: "undeclared" });
  const data = [s.spec.sends ?? []].flat().map((entry) => ({
    entry,
    label: entry.slice(entry.lastIndexOf(".") + 1),
    marks: [],
  }));
  const rows: LaneRow[] = [
    {
      kind: "step",
      at,
      step: at,
      label: String(s.step),
      from: lane(s.from),
      to: lane(s.to),
      action: s.action ?? `${endLabel(model, s.from)} → ${endLabel(model, s.to)}`,
      data,
      stores: false,
      tone: s.role === "ok" ? undefined : s.role,
      tags,
      dashed: s.hop.kind === "undeclared",
    },
  ];
  if (s.missing) {
    rows.push({
      kind: "step",
      key: `missing${at}`,
      at,
      step: at,
      label: "",
      from: lane(s.missing.from),
      to: lane(s.missing.to),
      action: `missing: ${s.missing.call ?? `${endLabel(model, s.missing.from)} → ${endLabel(model, s.missing.to)}`}`,
      data: [],
      stores: false,
      tone: "missing",
      dashed: true,
    });
  }
  return rows;
}

/** A step's observed and expected values, side by side, by key. */
export function observedExpected(
  s: TraceStepView,
): { key: string; observed?: string | undefined; expected?: string | undefined }[] {
  const show = (v: unknown) =>
    v === undefined ? undefined : typeof v === "string" ? v : JSON.stringify(v);
  const keys = [...new Set([...Object.keys(s.observed ?? {}), ...Object.keys(s.expected ?? {})])];
  return keys.map((key) => ({
    key,
    observed: s.observed && key in s.observed ? show(s.observed[key]) : undefined,
    expected: s.expected && key in s.expected ? show(s.expected[key]) : undefined,
  }));
}

/** One record a step of the bug carries or writes, with the fields the record has values for. */
export interface TraceData {
  entry: string;
  label: string;
  kind?: string | undefined;
  fields: FieldInfo[];
  /** Fields the record observed or expected a value for. */
  changed: Set<string>;
}

/**
 * What step `at` of a bug carries across its hop, and what it writes: as the
 * record says (sends, creates, changes), or else as the model says the use it
 * follows carries. `written` says which.
 */
export function traceData(
  model: Model,
  view: TraceView,
  at: number,
): { sends: TraceData[]; writes: TraceData[]; written: boolean } {
  const s = view.steps[at];
  if (!s?.from.target || !s.to.target) return { sends: [], writes: [], written: false };
  const d = stepData(model, traceJourney(view), at);
  const named = new Set([...Object.keys(s.observed ?? {}), ...Object.keys(s.expected ?? {})]);
  // observed: { Order.status: x } names Order's field; { status: x } names a field of any of them.
  const changedOf = (entry: string, label: string, fields: { name: string }[]) =>
    new Set(
      fields
        .map((f) => f.name)
        .filter((f) => named.has(f) || named.has(`${label}.${f}`) || named.has(`${entry}.${f}`)),
    );
  const ns = `${model.namespace}.`;
  const sends = (d.message?.how === "writes" ? [] : (d.message?.entries ?? [])).map((e) => ({
    entry: e.entry,
    label: e.label,
    kind: e.kind,
    fields: e.fields,
    changed: changedOf(e.entry, e.label, e.fields),
  }));
  const writes = d.writes.map((w) => {
    const label = w.entry.startsWith(ns) ? w.entry.slice(ns.length) : w.entry;
    const node = model.data.get(label);
    const fields: FieldInfo[] = Object.entries(node?.spec.fields ?? {}).map(([name, f]) => ({
      name,
      type: f.type,
      classification: f.classification,
      value: w.values.get(name),
    }));
    const changed = changedOf(w.entry, label, fields);
    for (const k of w.values.keys()) changed.add(k);
    return { entry: w.entry, label, kind: node?.spec.kind, fields, changed };
  });
  const spec = s.spec;
  return {
    sends,
    writes,
    written: spec.sends !== undefined || spec.creates !== undefined || spec.changes !== undefined,
  };
}

/** How a hop relates to the model, in words. */
export function hopText(model: Model, s: Pick<TraceStepView, "hop" | "from" | "to">): string {
  const r = s.hop.relationship;
  const uses = r ? `${r.from} → ${r.to}${r.description ? ` (${r.description})` : ""}` : "";
  switch (s.hop.kind) {
    case "same":
      return `Inside ${endLabel(model, s.from)}.`;
    case "inside":
      return "Between an element and one of its parts.";
    case "uses":
      return s.hop.lifted
        ? `The model draws it coarser: ${uses}.`
        : `Follows a use the model declares: ${uses}.`;
    case "returns":
      return `An answer to a use the model declares: ${uses}.`;
    case "subscribed":
      return `Follows a subscription the model declares: ${uses}.`;
    case "undeclared":
      return "Not in the model: no use between these. If the code really does this, add it to the model or fix the code.";
    case "unverified":
      return "Goes into a repo that isn't synced, so it can't be checked.";
    default:
      return "One of its ends isn't in the model.";
  }
}

/**
 * A Triage record's steps as a journey, so the map walks through the bug the
 * way it walks through a journey. Steps whose ends the model doesn't know
 * have no targets, and no arrow.
 */
export function traceJourney(view: TraceView): JourneyNode {
  const spec = {
    journey: `triage:${view.id}`,
    actor: view.anchor?.actor ?? view.actor?.written ?? "",
    goal: view.title,
    // Code here is a trace's (path:line or a list); the map doesn't read a step's code.
    steps: view.steps.map(({ spec: { code: _c, ...rest } }) => rest),
  } as unknown as JourneySpec;
  return {
    id: `triage:${view.id}`,
    spec,
    steps: view.steps.map((s, index) => ({
      index,
      spec: (spec.steps as JourneySpec["steps"])[index] as JourneySpec["steps"][number],
      from: s.from.target,
      to: s.to.target,
    })),
  };
}

/** One arrow per step the model knows both ends of, numbered as the record numbers them. */
export function traceInteractions(view: TraceView): Interaction[] {
  return view.steps.flatMap((s, index) =>
    s.from.target && s.to.target
      ? [
          {
            step: index,
            label: String(index + 1),
            from: s.from.target,
            to: s.to.target,
            action: s.action,
            writes: [],
          },
        ]
      : [],
  );
}

/** What each step did in the failing run, by 0-based step, for the map's colours. */
export function traceRoles(view: TraceView): string[] {
  return view.steps.map((s) => s.role);
}

/** The statuses in the order the list shows them, with how each reads. */
export const STATUS_GROUPS: readonly { status: TriageStatus; label: string }[] = [
  { status: "investigating", label: "Investigating" },
  { status: "open", label: "Open" },
  { status: "root-caused", label: "Root cause found" },
  { status: "fixed", label: "Fixed" },
  { status: "wont-fix", label: "Won't fix" },
  { status: "cannot-reproduce", label: "Can't reproduce" },
];

/** A status in words. */
export function statusLabel(status: TriageStatus): string {
  return STATUS_GROUPS.find((g) => g.status === status)?.label ?? status;
}

/** Records grouped by status, in list order, leaving out empty groups. */
export function groupByStatus(
  checks: readonly TraceCheck[],
): { status: TriageStatus; label: string; checks: TraceCheck[] }[] {
  return STATUS_GROUPS.map((g) => ({
    ...g,
    checks: checks.filter((c) => c.view.status === g.status),
  })).filter((g) => g.checks.length);
}

/** The prompt and command to hand a pasted bug to an agent. */
export function startPrompt(text: string): { prompt: string; command: string } {
  const bug = text.trim();
  return {
    prompt: `Triage this bug with ArchDoc (archdoc_triage): find its root cause and record it in .archdoc/triage/.\n\n${bug}`,
    command: "archdoc triage start -   # then paste the bug, and end with Ctrl-D",
  };
}

/** What the server answered a bug sent to the agent with. */
export type TriageSend = { ok: true; id: string } | { ok: false; error: string };

/**
 * Sends a bug to the agent from the explorer (archdoc view): a new record
 * from the pasted bug, or (with `id`) one sent again with what's asked now.
 * The agent picks it up with archdoc triage wait.
 */
export async function sendToAgent(
  input: { symptom: string; ask?: string | undefined } | { id: string; ask?: string | undefined },
): Promise<TriageSend> {
  const again = "id" in input;
  try {
    const res = await fetch(again ? `api/triage/${encodeURIComponent(input.id)}` : "api/triage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(again ? { ask: input.ask } : { symptom: input.symptom, ask: input.ask }),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
    if (!res.ok || !body.id)
      return { ok: false, error: body.error ?? `The server answered ${res.status}.` };
    return { ok: true, id: body.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
