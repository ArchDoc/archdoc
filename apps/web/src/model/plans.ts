import {
  applyPlan,
  changeTarget,
  checkPlan,
  type Diagnostic,
  describeChange,
  diffModels,
  loadPlans,
  type Model,
  type ModelDiff,
  type ModelSource,
  openIntents,
  type Plan,
  type PlanCheck,
  type PlanEditOp,
  planStatusOf,
} from "@archdoc/core/browser";

/** The plans beside a model, each checked against it. */
export interface Plans {
  plans: Plan[];
  /** Files the explorer couldn't read as plans. */
  problems: Diagnostic[];
}

export function readPlans(texts: readonly { path: string; text: string }[]): Plans {
  const { plans, diagnostics } = loadPlans(texts);
  return { plans, problems: diagnostics };
}

/** A plan drawn on the map: the model with its changes made, and what's whose. */
export interface PlanMap {
  plan: Plan;
  check: PlanCheck;
  /** The model with the plan's changes and the agent's suggestions made: what the map draws. */
  after: Model;
  /** What the plan changes, against the model as it is. */
  diff: ModelDiff;
  /** Node IDs (element:…, actor:…) the agent suggested and the person hasn't accepted. */
  suggested: Set<string>;
  /** Arrows the agent suggested, as "source|target" node IDs. */
  suggestedEdges: Set<string>;
  /** Node IDs with notes on them, and how many. */
  notes: Map<string, number>;
  /** Plan item IDs by the node they're about, for the details panel. */
  items: Map<string, string[]>;
  /** The person's intents, each with the box it's pinned in. */
  pins: IntentPin[];
}

/** An intent on the map: the box it's in (none for the map itself), and where in it. */
export interface IntentPin {
  id: string;
  /** Node ID (element:…, actor:…) of the box it's in. */
  node?: string | undefined;
  /** Where in that box, as percentages of its width and height. */
  at?: { x: number; y: number } | undefined;
  /** For how two boxes connect: the other box's node ID; the pin sits between them. */
  to?: string | undefined;
  text: string;
  /** Nothing in the plan carries it out yet. */
  open: boolean;
  resolved: boolean;
  /** The changes and sequences that carry it out. */
  carried: string[];
}

/**
 * Makes a plan on a copy of the model's sources, suggestions included, and
 * rebuilds the model the way the explorer builds it (schemas and other
 * repos' models with it), so the map draws the plan as if it were done.
 */
export function planMap(
  model: Model,
  sources: { root: string; sources: ModelSource[] },
  plan: Plan,
  build: (sources: ModelSource[]) => Model,
): PlanMap {
  const check = checkPlan(model, sources.sources, plan, { root: sources.root });
  const applied = applyPlan(sources.sources, model, plan, {
    root: sources.root,
    suggestions: true,
  });
  const after = applied.applied.length ? build(applied.sources) : model;
  const diff = diffModels(model, after);
  const node = (ref: string) => nodeOf(after, ref);
  const suggested = new Set<string>();
  const suggestedEdges = new Set<string>();
  const items = new Map<string, string[]>();
  const about = (key: string | undefined, id: string) => {
    if (!key) return;
    items.set(key, [...(items.get(key) ?? []), id]);
  };
  for (const c of plan.spec.changes) {
    if (c.status === "dismissed") continue;
    if (c.use) {
      const from = node(c.use.from);
      const to = node(c.use.to);
      if (c.status === "suggested" && from && to) suggestedEdges.add(`${from}|${to}`);
      about(from, c.id);
      about(to, c.id);
      continue;
    }
    const key = node(changeTarget(c));
    if (c.status === "suggested" && key && c.add) suggested.add(key);
    about(key, c.id);
  }
  const notes = new Map<string, number>();
  for (const n of plan.spec.notes) {
    if (!n.on || n.resolved) continue;
    const change = plan.spec.changes.find((c) => c.id === n.on);
    const intent = plan.spec.intents.find((i) => i.id === n.on);
    const key = change
      ? node(changeTarget(change))
      : intent
        ? intent.on && node(intent.on)
        : node(n.on);
    if (key) notes.set(key, (notes.get(key) ?? 0) + 1);
  }
  const open = new Set(openIntents(plan.spec).map((n) => n.id));
  const pins = plan.spec.intents.map((n) => ({
    id: n.id,
    node: n.on ? node(n.on) : undefined,
    to: n.to ? node(n.to) : undefined,
    at: n.at,
    text: n.text,
    open: open.has(n.id),
    resolved: n.resolved === true,
    carried: [...plan.spec.changes, ...plan.spec.sequences]
      .filter((x) => x.status !== "dismissed" && x.for?.includes(n.id))
      .map((x) => x.id),
  }));
  for (const p of pins) {
    about(p.node, p.id);
    if (p.to) about(p.to, p.id);
  }
  return { plan, check, after, diff, suggested, suggestedEdges, notes, items, pins };
}

/** The map's node ID for a model reference: element:<full id> or actor:<id>. */
export function nodeOf(model: Model, ref: string): string | undefined {
  if (model.actors.has(ref)) return `actor:${ref}`;
  if (model.elements.has(ref)) return `element:${ref}`;
  const own = ref.startsWith(`${model.namespace}.`) ? ref.slice(model.namespace.length + 1) : ref;
  if (model.elements.has(own)) return `element:${own}`;
  const ends = [...model.elements.keys()].filter((id) => id.endsWith(`.${ref}`));
  return ends.length === 1 ? `element:${ends[0]}` : undefined;
}

/** A model reference for a map node: its element or actor ID. */
export function refOf(key: string): string | undefined {
  if (key.startsWith("element:")) return key.slice(8);
  if (key.startsWith("actor:")) return key.slice(6);
  return undefined;
}

/** What the server answered a plan edit with. */
export type PlanWrite = { ok: true; ids: string[] } | { ok: false; error: string; stale?: boolean };

/** Sends edit ops for a plan to `archdoc view`, against the text the page last read. */
export async function writePlan(
  id: string,
  ops: PlanEditOp[],
  base: string | undefined,
): Promise<PlanWrite> {
  try {
    const res = await fetch(`api/plans/${encodeURIComponent(id)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ops, base }),
    });
    const body = (await res.json().catch(() => ({}))) as { ids?: string[]; error?: string };
    if (!res.ok)
      return {
        ok: false,
        error: body.error ?? `The server answered ${res.status}.`,
        stale: res.status === 409,
      };
    return { ok: true, ids: body.ids ?? [] };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Starts a plan from the explorer: the idea (its first line is the title). */
export async function startPlan(
  goal: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const res = await fetch("api/plans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ goal }),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
    if (!res.ok || !body.id) return { ok: false, error: body.error ?? "Couldn't start the plan." };
    return { ok: true, id: body.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

type PlanNote = Plan["spec"]["notes"][number];

/** Whose turn it is in the conversation with the agent. */
export type PlanTurn = "you" | "unsent" | "sent" | "agent" | "none";

/** What the map calls a model ID. */
export function nameOf(model: Model, ref: string): string {
  return model.elements.get(ref)?.spec.name ?? model.actors.get(ref)?.spec.name ?? ref;
}

/** Where a new box goes when the person clicks in `node` (none: the map itself), and what kind. */
export function newElementPlace(
  model: Model,
  node: string | undefined,
): { parent?: string | undefined; kind: string } {
  const systems = [...model.elements.values()].filter((e) => e.spec.kind === "system");
  const top = systems.length === 1 ? systems[0]?.id : undefined;
  const inside = (parent: string | undefined) => {
    const kind = parent ? model.elements.get(parent)?.spec.kind : undefined;
    return {
      parent,
      kind: kind === "container" ? "component" : kind === "component" ? "code" : "container",
    };
  };
  const el = node?.startsWith("element:") ? model.elements.get(node.slice(8)) : undefined;
  if (!el) return inside(top);
  // A system or a container holds the new box; anything else gets a sibling.
  if (el.spec.kind === "system" || el.spec.kind === "container") return inside(el.id);
  if (el.parentId) return inside(el.parentId);
  return inside(top);
}

/** A model ID from a name: lowercase words joined by dashes, made unique beside its siblings. */
export function newElementId(model: Model, parent: string | undefined, name: string): string {
  const slug =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "new-element";
  const at = (s: string) => (parent ? `${parent}.${s}` : s);
  let id = at(slug);
  for (let n = 2; model.elements.has(id) || model.actors.has(id); n++) id = at(`${slug}-${n}`);
  return id;
}

/** One turn of the conversation: what the person said, and the agent's answer to it. */
export interface Turn {
  intent: Plan["spec"]["intents"][number];
  pin?: IntentPin | undefined;
  /** The box the person drew for it: their own add change on the box it's in. */
  drew?: Plan["spec"]["changes"][number] | undefined;
  /** The changes and sequences that carry it out. */
  items: (Plan["spec"]["changes"][number] | Plan["spec"]["sequences"][number])[];
  /** The agent's notes on it, or on what carries it out. */
  notes: PlanNote[];
  /** Nothing waits on the person here: no suggestion to answer, no question open. */
  settled: boolean;
}

/** The plan as a conversation: each intent the person sent, with the agent's answer, and the notes on nothing. */
export function turnsOf(map: PlanMap): { turns: Turn[]; rest: PlanNote[] } {
  const s = map.plan.spec;
  const used = new Set<string>();
  const turns = s.intents
    .filter((i) => !i.by?.startsWith("agent:"))
    .map((intent): Turn => {
      const items = [...s.changes, ...s.sequences].filter((x) => x.for?.includes(intent.id));
      const drew = s.changes.find(
        (c) => c.add && c.add.id === intent.on && !c.by?.startsWith("agent:"),
      );
      const about = new Set([intent.id, ...items.map((x) => x.id), ...(drew ? [drew.id] : [])]);
      const notes = s.notes.filter((n) => n.on && about.has(n.on.split("#")[0] ?? n.on));
      for (const n of notes) used.add(n.id);
      const waiting =
        items.some((x) => x.status === "suggested") ||
        notes.some(
          (n) =>
            (n.kind ?? "note") === "question" &&
            !n.resolved &&
            !(n.replies ?? []).some((r) => r.kind === "answer"),
        );
      const pin = map.pins.find((p) => p.id === intent.id);
      return {
        intent,
        pin,
        drew,
        items,
        notes,
        settled: intent.resolved === true || (!waiting && !pin?.open),
      };
    });
  const rest = s.notes.filter((n) => !used.has(n.id));
  return { turns, rest };
}

/** A change in a few words, with the names the map shows. */
export function changeLine(map: PlanMap, c: Plan["spec"]["changes"][number]): string {
  const name = (ref: string) => nameOf(map.after, ref);
  const said = (v: unknown) => (typeof v === "string" && v ? `: ${v}` : "");
  if (c.use)
    return `${c.use.remove ? "No longer " : ""}${name(c.use.from)} → ${name(c.use.to)}${said(c.use.description)}`;
  if (c.add)
    return `New ${typeof c.add.kind === "string" ? c.add.kind : "element"}: ${name(c.add.id)}`;
  return describeChange(c);
}

/**
 * Whose turn it is: the agent's from when the person sends until it answers
 * that round (sent: it hasn't picked it up yet; agent: it read it and is
 * working), the person's otherwise (unsent: they've changed things without
 * sending them).
 */
export function planTurn(spec: Plan["spec"]): PlanTurn {
  const status = planStatusOf(spec);
  if (status !== "drafting" && status !== "reviewing") return "none";
  const sent = spec.sent ?? 0;
  if (sent > (spec.answered ?? 0)) return sent > (spec.seen ?? 0) ? "sent" : "agent";
  return spec.unread?.length ? "unsent" : "you";
}

/** The question the person's next message answers: the agent's latest, still open. */
export function openQuestion(map: PlanMap): PlanNote | undefined {
  return [...map.plan.spec.notes]
    .reverse()
    .find(
      (n) =>
        (n.kind ?? "note") === "question" &&
        n.by?.startsWith("agent:") &&
        !n.resolved &&
        !(n.replies ?? []).some((r) => r.kind === "answer"),
    );
}
