import {
  applyPlan,
  changeTarget,
  checkPlan,
  type Diagnostic,
  diffModels,
  loadPlans,
  type Model,
  type ModelDiff,
  type ModelSource,
  type Plan,
  type PlanCheck,
  type PlanEditOp,
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
    const key = change ? node(changeTarget(change)) : node(n.on);
    if (key) notes.set(key, (notes.get(key) ?? 0) + 1);
  }
  return { plan, check, after, diff, suggested, suggestedEdges, notes, items };
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

/** Starts a plan from the explorer: its title and the idea. */
export async function startPlan(
  title: string,
  goal: string,
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  try {
    const res = await fetch("api/plans", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, goal }),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
    if (!res.ok || !body.id) return { ok: false, error: body.error ?? "Couldn't start the plan." };
    return { ok: true, id: body.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** An ID for a new element from its name: lowercase words joined with dashes. */
export function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "new"
  );
}

/** The kind a new element gets inside a parent of this kind. */
export function childKind(parentKind: string | undefined): string {
  switch (parentKind) {
    case undefined:
      return "container";
    case "system":
      return "container";
    case "container":
      return "component";
    case "component":
      return "code";
    default:
      return "component";
  }
}
