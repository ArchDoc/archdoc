import type { PlanChangeSpec, PlanStatus } from "@archdoc/spec";
import { check } from "../check/check.js";
import type { Diagnostic, Severity, SourceLocation } from "../diagnostics.js";
import { type EditedFile, type EditOp, editModel } from "../edit/edit.js";
import { buildModel, type ModelSource } from "../load/build.js";
import { Resolver } from "../load/resolve.js";
import type { Model } from "../model.js";
import { impact } from "../query/impact.js";
import {
  changeKind,
  changeOp,
  changeTarget,
  describeChange,
  isAgreed,
  type Plan,
  planItemIds,
  planStatusOf,
  sequenceOp,
} from "./plan.js";

export interface PlanFinding extends Diagnostic {
  plan: string;
  /** The item it's about: a change, sequence, step (s1#2), note, or task. */
  item?: string | undefined;
}

export interface ApplyPlanOptions {
  /** The root model file. Defaults to the source named archdoc.yaml. */
  root?: string | undefined;
  /** Where a new journey's file goes. Without it, journeys go in the root file. */
  journeyFile?: ((id: string) => string) | undefined;
  /** Apply the agent's suggestions too, as if accepted. */
  suggestions?: boolean | undefined;
  /** Changes to leave out: those the model already shows, once the plan is carried out. */
  skip?: ((id: string) => boolean) | undefined;
}

export interface AppliedPlan {
  /** The model's sources with the plan's changes made. */
  sources: ModelSource[];
  /** What each item did, in order. */
  applied: { item: string; op: EditOp; done: string }[];
  /** Items that couldn't be applied, each with why. The rest still apply. */
  problems: { item: string; op: EditOp; message: string }[];
}

/**
 * Makes a plan's agreed changes and sequences on a copy of the model's
 * sources, one item at a time, in order, so one that can't be made (it names
 * something that isn't there) doesn't stop the rest. Pure: writes nothing.
 */
export function applyPlan(
  sources: readonly ModelSource[],
  model: Model,
  plan: Plan,
  options: ApplyPlanOptions = {},
): AppliedPlan {
  const take = (s: { status?: string | undefined }) =>
    isAgreed(s) || (options.suggestions === true && s.status === "suggested");
  const items: { item: string; op: EditOp }[] = [];
  for (const c of plan.spec.changes)
    if (take(c) && !options.skip?.(c.id)) items.push({ item: c.id, op: changeOp(c) });
  for (const s of plan.spec.sequences) {
    if (!take(s) || !s.steps.some(isAgreed)) continue;
    items.push({ item: s.id, op: sequenceOp(s, model.journeys.has(s.journey)) });
  }
  let current: ModelSource[] = [...sources];
  const applied: AppliedPlan["applied"] = [];
  const problems: AppliedPlan["problems"] = [];
  for (const { item, op } of items) {
    const r = editModel(current, [op], {
      root: options.root,
      journeyFile: options.journeyFile,
    });
    if (r.problems.length) {
      problems.push({ item, op, message: r.problems.join("; ") });
      continue;
    }
    current = withFiles(current, r.files);
    applied.push({ item, op, done: r.done.join("; ") });
  }
  return { sources: current, applied, problems };
}

/** Sources with an edit's files written over them. */
export function withFiles(
  sources: readonly ModelSource[],
  files: readonly EditedFile[],
): ModelSource[] {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const out: ModelSource[] = [];
  for (const s of sources) {
    const f = byPath.get(s.path);
    if (f?.removed) continue;
    out.push(f ? { path: s.path, text: f.text } : s);
  }
  for (const f of files)
    if (f.created && !sources.some((s) => s.path === f.path))
      out.push({ path: f.path, text: f.text });
  return out;
}

/** A journey the plan touches. */
export interface PlanJourney {
  id: string;
  name?: string | undefined;
  importance: "critical" | "high" | "normal";
  /** The plan changes its steps (a sequence names it), rather than only touching an element on it. */
  changed: boolean;
  /** Whether the plan adds it. */
  added: boolean;
}

/** What a plan reaches, from the elements and journeys it changes. */
export interface PlanReach {
  /** Model elements the plan adds, changes, removes, or connects. */
  elements: string[];
  journeys: PlanJourney[];
  actors: string[];
  owners: string[];
  /** Other repos that use what the plan changes. */
  elsewhere: string[];
}

/** Counts a person reads at a glance: what's still open in the plan. */
export interface PlanOpen {
  questions: number;
  suggestions: number;
  missingIntent: number;
  unread: number;
  tasks: { total: number; done: number };
}

export interface PlanCheck {
  plan: Plan;
  status: PlanStatus;
  findings: PlanFinding[];
  reach: PlanReach;
  open: PlanOpen;
  /** The model with the plan's agreed changes made, for showing it. Undefined when nothing applies. */
  after?: Model | undefined;
  applied: AppliedPlan;
}

export interface CheckPlanOptions extends ApplyPlanOptions {}

/**
 * Checks a plan against the model: every change and step has an intent,
 * everything it names exists (or the plan adds it first), what it would
 * break (rules, journeys, and other checks the model would newly fail), what
 * it reaches (journeys, actors, owners, other repos), and what's still open
 * (questions, suggestions, tasks). While a plan is being designed its
 * findings are warnings, so a half-drawn plan never fails a check; once it's
 * ready, they're errors. Done and abandoned plans aren't checked.
 */
export function checkPlan(
  model: Model,
  sources: readonly ModelSource[],
  plan: Plan,
  options: CheckPlanOptions = {},
): PlanCheck {
  const spec = plan.spec;
  const status = planStatusOf(spec);
  const findings: PlanFinding[] = [];
  const settled = status === "ready" || status === "executing";
  const closed = status === "done" || status === "abandoned";
  const push = (
    severity: Severity,
    code: string,
    message: string,
    item?: string,
    location?: SourceLocation,
  ) => {
    const sev: Severity = severity === "error" && !settled ? "warning" : severity;
    findings.push({
      severity: sev,
      code,
      message,
      plan: plan.id,
      item,
      location: location ?? plan.locations.plan,
    });
  };
  const loc = (path: string) => plan.locations[path];

  let missingIntent = 0;
  if (!closed) {
    for (const [i, c] of spec.changes.entries()) {
      if (c.status === "dismissed") continue;
      if (!c.intent?.trim()) {
        missingIntent++;
        push(
          "error",
          "plan/missing-intent",
          `${c.id} (${describeChange(c)}) has no intent: say what it's for.`,
          c.id,
          loc(`changes.${i}`),
        );
      }
    }
    for (const [i, s] of spec.sequences.entries()) {
      if (s.status === "dismissed") continue;
      for (const [j, step] of s.steps.entries()) {
        if (step.status === "dismissed") continue;
        if (!step.intent?.trim()) {
          missingIntent++;
          push(
            "error",
            "plan/missing-intent",
            `${s.id}#${j + 1} (${step.from} → ${step.to}) has no intent: say what this hop is for.`,
            `${s.id}#${j + 1}`,
            loc(`sequences.${i}.steps.${j}`),
          );
        }
      }
      if (!s.steps.length) {
        push(
          "error",
          "plan/empty-sequence",
          `${s.id} has no steps yet.`,
          s.id,
          loc(`sequences.${i}`),
        );
      } else if (!model.journeys.has(s.journey) && (!s.actor || !s.goal)) {
        push(
          "error",
          "plan/sequence-incomplete",
          `${s.id} adds journey ${s.journey}, which needs ${[!s.actor && "an actor", !s.goal && "a goal"].filter(Boolean).join(" and ")}.`,
          s.id,
          loc(`sequences.${i}`),
        );
      }
    }
  }

  const ids = planItemIds(spec);
  const resolver = new Resolver(
    model.namespace,
    new Set(Object.keys(model.imports)),
    new Set(model.elements.keys()),
    new Set(model.actors.keys()),
  );
  const known = (ref: string) =>
    ids.has(ref) ||
    model.journeys.has(ref) ||
    model.data.has(ref.split(".")[0] ?? ref) ||
    resolver.endpoint(ref).status === "resolved" ||
    resolver.endpoint(ref).status === "external" ||
    spec.changes.some((c) => c.add?.id === ref || c.add?.id.endsWith(`.${ref}`));
  for (const [i, n] of spec.notes.entries()) {
    if (n.on && !known(n.on)) {
      push(
        "warning",
        "plan/unknown-item",
        `Note ${n.id} is on ${n.on}, which isn't in the plan or the model.`,
        n.id,
        loc(`notes.${i}`),
      );
    }
  }
  for (const [i, t] of spec.tasks.entries()) {
    for (const f of t.from ?? []) {
      if (!ids.has(f)) {
        push(
          "error",
          "plan/unknown-item",
          `Task ${t.id} carries out ${f}, which isn't in the plan.`,
          t.id,
          loc(`tasks.${i}`),
        );
      }
    }
  }

  // Make the plan on a copy of the model, and see what that would newly fail.
  // Once it's agreed, a change the model already shows has been made: making it again would fail.
  const shown = settled ? shownIn(model, spec) : undefined;
  const applied = applyPlan(sources, model, plan, {
    ...options,
    skip: shown && ((id) => shown(id) === true),
  });
  let after: Model | undefined;
  if (!closed) {
    for (const p of applied.problems) {
      push(
        "error",
        "plan/cannot-apply",
        `${p.item} can't be made on the model: ${p.message}`,
        p.item,
        itemLocation(plan, p.item),
      );
    }
  }
  if (applied.applied.length) {
    const root = options.root;
    const before = buildModel(sources, { root });
    after = buildModel(applied.sources, { root });
    if (!closed && status !== "executing") {
      const key = (f: { code: string; message: string }) => `${f.code}\u0000${f.message}`;
      const had = new Set(check(before).findings.map(key));
      for (const f of check(after).findings) {
        if (f.severity === "info" || had.has(key(f))) continue;
        if (f.code === "model/orphan-element") continue; // a new element is connected by later work
        const journey = /Journey "([^"]+)"/.exec(f.message)?.[1];
        const item = f.element
          ? itemFor(spec.changes, f.element)
          : spec.sequences.find((q) => q.journey === journey)?.id;
        push(
          f.severity,
          "plan/would-break",
          `With this plan, ${f.code}: ${f.message}`,
          item,
          item ? itemLocation(plan, item) : undefined,
        );
      }
    }
  }

  let questions = 0;
  for (const [i, n] of spec.notes.entries()) {
    if (n.resolved || n.kind !== "question") continue;
    if ((n.replies ?? []).some((r) => r.kind === "answer")) continue;
    questions++;
    if (!closed)
      push(
        settled ? "error" : "warning",
        "plan/open-question",
        `Open question${n.on ? ` on ${n.on}` : ""}: ${n.text}`,
        n.id,
        loc(`notes.${i}`),
      );
  }
  const waiting = [
    ...spec.changes.filter((c) => c.status === "suggested").map((c) => c.id),
    ...spec.sequences.filter((s) => s.status === "suggested").map((s) => s.id),
    ...spec.sequences.flatMap((s) =>
      s.steps.flatMap((st, j) => (st.status === "suggested" ? [`${s.id}#${j + 1}`] : [])),
    ),
  ];
  if (!closed && waiting.length) {
    push(
      settled ? "error" : "warning",
      "plan/open-suggestion",
      `${waiting.length} suggestion${waiting.length === 1 ? "" : "s"} still to accept or dismiss: ${waiting.join(", ")}.`,
    );
  }

  const done = spec.tasks.filter((t) => t.status === "done" || t.status === "skipped").length;
  if (settled && !spec.tasks.length) {
    push(
      "warning",
      "plan/no-tasks",
      `${plan.id} is ${status} but has no tasks: write the tasks that carry it out (archdoc plan respond, putting them in tasks).`,
    );
  }
  if (status === "executing" || status === "done") {
    findings.push(...drift(model, plan, status));
  }

  return {
    plan,
    status,
    findings,
    reach: reachOf(model, after, plan),
    open: {
      questions,
      suggestions: waiting.length,
      missingIntent,
      unread: spec.unread?.length ?? 0,
      tasks: { total: spec.tasks.length, done },
    },
    after,
    applied,
  };
}

/** The change that's about an element, by its target or a use's from or to. */
function itemFor(changes: readonly PlanChangeSpec[], element: string): string | undefined {
  const same = (a: string) =>
    a === element || element.endsWith(`.${a}`) || a.endsWith(`.${element}`);
  return changes.find((c) => same(changeTarget(c)) || (c.use !== undefined && same(c.use.to)))?.id;
}

/** Where an item is written in the plan file. */
export function itemLocation(plan: Plan, item: string): SourceLocation | undefined {
  const spec = plan.spec;
  const ci = spec.changes.findIndex((c) => c.id === item);
  if (ci >= 0) return plan.locations[`changes.${ci}`];
  const [seq, step] = item.split("#");
  const si = spec.sequences.findIndex((s) => s.id === seq);
  if (si >= 0)
    return step
      ? plan.locations[`sequences.${si}.steps.${Number(step) - 1}`]
      : plan.locations[`sequences.${si}`];
  const ni = spec.notes.findIndex((n) => n.id === item);
  if (ni >= 0) return plan.locations[`notes.${ni}`];
  const ti = spec.tasks.findIndex((t) => t.id === item);
  if (ti >= 0) return plan.locations[`tasks.${ti}`];
  return undefined;
}

/**
 * While a plan is carried out: the tasks marked done whose changes the model
 * doesn't show yet. A done plan whose tasks aren't all done.
 */
/**
 * Whether the model already shows a plan item: an add whose target is there,
 * a removal whose target is gone, a use that's declared, a sequence whose
 * journey has its steps. Undefined for items it can't tell, or not agreed.
 */
function shownIn(model: Model, spec: Plan["spec"]): (id: string) => boolean | undefined {
  const resolver = new Resolver(
    model.namespace,
    new Set(Object.keys(model.imports)),
    new Set(model.elements.keys()),
    new Set(model.actors.keys()),
  );
  const resolved = (ref: string): string | undefined => {
    const r = resolver.endpoint(ref);
    return r.status === "resolved" ? r.target.id : undefined;
  };
  const has = (ref: string) => resolved(ref) !== undefined;
  const inModel = (id: string): boolean | undefined => {
    const c = spec.changes.find((x) => x.id === id);
    if (c) {
      if (!isAgreed(c)) return undefined;
      switch (changeKind(c)) {
        case "add":
          return (
            has(changeTarget(c)) ||
            model.journeys.has(changeTarget(c)) ||
            model.data.has(changeTarget(c))
          );
        case "remove":
          return !has(changeTarget(c)) && !model.journeys.has(changeTarget(c));
        case "rename":
          return !has(changeTarget(c));
        case "use": {
          const u = c.use as NonNullable<PlanChangeSpec["use"]>;
          const from = resolved(u.from);
          const to = resolved(u.to);
          const there = model.relationships.some(
            (r) =>
              from !== undefined &&
              to !== undefined &&
              r.from.id === from &&
              r.to.type !== "external" &&
              r.to.id === to,
          );
          return u.remove ? !there : there;
        }
        default:
          return undefined;
      }
    }
    const s = spec.sequences.find((x) => x.id === id);
    if (s) {
      const j = model.journeys.get(s.journey);
      return j !== undefined && j.steps.length === s.steps.filter(isAgreed).length;
    }
    return undefined;
  };
  return inModel;
}

function drift(model: Model, plan: Plan, status: PlanStatus): PlanFinding[] {
  const out: PlanFinding[] = [];
  const spec = plan.spec;
  const inModel = shownIn(model, spec);
  for (const [i, t] of spec.tasks.entries()) {
    if (t.status !== "done") continue;
    const missing = (t.from ?? []).filter((f) => inModel(f) === false);
    if (missing.length) {
      out.push({
        severity: "warning",
        code: "plan/drift",
        message: `Task ${t.id} is done, but the model doesn't show ${missing.join(", ")} yet: make the change with archdoc edit, or reopen the task.`,
        plan: plan.id,
        item: t.id,
        location: plan.locations[`tasks.${i}`],
      });
    }
  }
  if (status === "done") {
    const left = spec.tasks.filter((t) => t.status !== "done" && t.status !== "skipped");
    if (left.length) {
      out.push({
        severity: "warning",
        code: "plan/tasks-left",
        message: `${plan.id} is done, but ${left.map((t) => t.id).join(", ")} ${left.length === 1 ? "isn't" : "aren't"}: finish or skip them.`,
        plan: plan.id,
        location: plan.locations.status,
      });
    }
  }
  return out;
}

const IMPORTANCE = { critical: 0, high: 1, normal: 2 } as const;

/** What the plan reaches: elements, journeys, actors, owners, other repos. */
function reachOf(model: Model, after: Model | undefined, plan: Plan): PlanReach {
  const spec = plan.spec;
  const targets = new Set<string>();
  for (const c of spec.changes) {
    if (c.status === "dismissed") continue;
    targets.add(changeTarget(c));
    if (c.use) targets.add(c.use.to);
  }
  for (const s of spec.sequences)
    for (const st of s.steps) {
      targets.add(st.from);
      targets.add(st.to);
    }
  const elements = new Set<string>();
  const journeys = new Map<string, PlanJourney>();
  const actors = new Set<string>();
  const owners = new Set<string>();
  const elsewhere = new Set<string>();
  for (const t of targets) {
    // An actor's journeys aren't what a plan reaches: only what it changes is.
    if (model.actors.has(t) || after?.actors.has(t)) {
      actors.add(t);
      continue;
    }
    const r = impact(model, t, 2);
    const inAfter = !r.ok && after ? impact(after, t, 2) : undefined;
    const hit = r.ok ? r : inAfter?.ok ? inAfter : undefined;
    if (!hit) continue;
    const imp = hit.impact;
    if (imp.element) elements.add(imp.element.id);
    else if (imp.target.type === "actor") actors.add(imp.target.id);
    for (const a of r.ok ? imp.actors : []) actors.add(a.id);
    for (const o of imp.owners) owners.add(o);
    // A new element is in no journey yet but its parent's; its sequences say where it's used.
    for (const j of r.ok ? imp.journeys : []) {
      if (j.journey.spec.actor) actors.add(j.journey.spec.actor);
      if (!journeys.has(j.journey.id))
        journeys.set(j.journey.id, {
          id: j.journey.id,
          name: j.journey.spec.name,
          importance: j.journey.spec.importance ?? "normal",
          changed: false,
          added: false,
        });
    }
    for (const c of imp.elsewhere.consumers) elsewhere.add(c.namespace);
    for (const j of imp.elsewhere.journeys) elsewhere.add(j.namespace);
  }
  for (const s of spec.sequences) {
    if (s.status === "dismissed") continue;
    const existing = model.journeys.get(s.journey);
    journeys.set(s.journey, {
      id: s.journey,
      name: s.name ?? existing?.spec.name,
      importance: existing?.spec.importance ?? "normal",
      changed: true,
      added: !existing,
    });
    if (s.actor) actors.add(s.actor);
  }
  return {
    elements: [...elements].sort(),
    journeys: [...journeys.values()].sort(
      (a, b) => IMPORTANCE[a.importance] - IMPORTANCE[b.importance] || a.id.localeCompare(b.id),
    ),
    actors: [...actors].sort(),
    owners: [...owners].sort(),
    elsewhere: [...elsewhere].sort(),
  };
}
