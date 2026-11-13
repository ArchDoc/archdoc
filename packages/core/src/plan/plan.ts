import {
  type PlanChangeSpec,
  type PlanFile,
  PlanFileSchema,
  type PlanSequenceSpec,
  type PlanStatus,
  type PlanStepSpec,
} from "@archdoc/spec";
import type { Diagnostic, SourceLocation } from "../diagnostics.js";
import type { EditOp, EditType } from "../edit/edit.js";
import { schemaDiagnostics } from "../load/build.js";
import { parseYaml, type YamlPath } from "../load/yaml.js";

/** A plan as written, without the editor fields, with its lists always there. */
export type PlanSpec = Omit<
  PlanFile,
  "$schema" | "archdoc" | "intents" | "changes" | "sequences" | "notes" | "tasks"
> & {
  intents: NonNullable<PlanFile["intents"]>;
  changes: NonNullable<PlanFile["changes"]>;
  sequences: NonNullable<PlanFile["sequences"]>;
  notes: NonNullable<PlanFile["notes"]>;
  tasks: NonNullable<PlanFile["tasks"]>;
};

/**
 * A plan read from `.archdoc/plans/<id>.yaml`: a change designed before it's
 * built, as changes to the model, sequences, and notes, each with the
 * person's intent. Never part of the model.
 */
export interface Plan {
  id: string;
  /** The file it was read from, as given to {@link parsePlan}. */
  file: string;
  spec: PlanSpec;
  /** Where things are written, by dotted path such as `changes.0` or `sequences.1.steps.2`. */
  locations: Record<string, SourceLocation>;
}

export interface ParsedPlans {
  plans: Plan[];
  /** YAML and schema problems, and duplicate IDs. */
  diagnostics: Diagnostic[];
}

/** Parses one plan file. Returns no plan when the YAML or the schema doesn't hold. */
export function parsePlan(
  file: string,
  text: string,
): { plan?: Plan | undefined; diagnostics: Diagnostic[] } {
  const { parsed, diagnostics } = parseYaml(file, text);
  if (!parsed) return { diagnostics };
  if (parsed.value === null || typeof parsed.value !== "object") {
    return {
      diagnostics: [
        ...diagnostics,
        {
          severity: "error",
          code: "plan/not-a-plan",
          message: 'A plan needs "plan" (its ID) and "title".',
          location: { file, line: 1, column: 1 },
        },
      ],
    };
  }
  const result = PlanFileSchema.safeParse(parsed.value);
  if (!result.success) {
    return { diagnostics: [...diagnostics, ...schemaDiagnostics(result.error, parsed)] };
  }
  const {
    $schema: _s,
    archdoc: _a,
    intents,
    changes,
    sequences,
    notes,
    tasks,
    ...rest
  } = result.data;
  const spec: PlanSpec = {
    ...rest,
    intents: intents ?? [],
    changes: changes ?? [],
    sequences: sequences ?? [],
    notes: notes ?? [],
    tasks: tasks ?? [],
  };
  const locations: Record<string, SourceLocation> = {};
  const at = (path: YamlPath) => {
    locations[path.join(".")] = parsed.locate(path);
  };
  for (const key of ["plan", "title", "status"]) at([key]);
  for (const [i] of spec.intents.entries()) at(["intents", i]);
  for (const [i] of spec.changes.entries()) at(["changes", i]);
  for (const [i, s] of spec.sequences.entries()) {
    at(["sequences", i]);
    for (const [j] of s.steps.entries()) at(["sequences", i, "steps", j]);
  }
  for (const [i] of spec.notes.entries()) at(["notes", i]);
  for (const [i] of spec.tasks.entries()) at(["tasks", i]);
  return { plan: { id: spec.plan, file, spec, locations }, diagnostics };
}

/** Parses plan files, and reports two plans with the same ID. */
export function loadPlans(sources: readonly { path: string; text: string }[]): ParsedPlans {
  const plans: Plan[] = [];
  const diagnostics: Diagnostic[] = [];
  const seen = new Map<string, Plan>();
  for (const source of sources) {
    const r = parsePlan(source.path, source.text);
    diagnostics.push(...r.diagnostics);
    if (!r.plan) continue;
    const before = seen.get(r.plan.id);
    if (before) {
      diagnostics.push({
        severity: "error",
        code: "plan/duplicate",
        message: `Plan "${r.plan.id}" is also in ${before.file}.`,
        location: r.plan.locations.plan,
      });
      continue;
    }
    seen.set(r.plan.id, r.plan);
    plans.push(r.plan);
  }
  return { plans, diagnostics };
}

/** Where a plan stands, with the default. */
export function planStatusOf(spec: Pick<PlanSpec, "status">): PlanStatus {
  return spec.status ?? "drafting";
}

/** Plans that are still being designed or carried out. */
export const OPEN_PLAN_STATUSES: readonly PlanStatus[] = [
  "drafting",
  "reviewing",
  "ready",
  "executing",
];

/** Whether an item is part of the plan: not a suggestion still waiting, and not dismissed. */
export function isAgreed(item: { status?: string | undefined }): boolean {
  return item.status === undefined || item.status === "proposed";
}

/** What a change does, as one word. */
export type PlanChangeKind = "add" | "set" | "remove" | "rename" | "use";

/** Which of add, set, remove, rename, or use a change is. */
export function changeKind(c: PlanChangeSpec): PlanChangeKind {
  if (c.add) return "add";
  if (c.set) return "set";
  if (c.remove !== undefined) return "remove";
  if (c.rename) return "rename";
  return "use";
}

/** The model ID a change is about: what it adds, sets, removes, or renames, or a use's from. */
export function changeTarget(c: PlanChangeSpec): string {
  if (c.add) return c.add.id;
  if (c.set) return c.set.id;
  if (c.remove !== undefined) return typeof c.remove === "string" ? c.remove : c.remove.id;
  if (c.rename) return c.rename.id;
  return c.use?.from ?? "";
}

/** A change in a few words, such as "add web.pdf-export" or "use web → pdf-export". */
export function describeChange(c: PlanChangeSpec): string {
  if (c.use) return `${c.use.remove ? "remove use" : "use"} ${c.use.from} → ${c.use.to}`;
  if (c.rename) return `rename ${c.rename.id} → ${c.rename.to}`;
  return `${changeKind(c)} ${changeTarget(c)}`;
}

/** The `archdoc edit` op a change becomes. */
export function changeOp(c: PlanChangeSpec): EditOp {
  if (c.add) {
    const { id, type, ...spec } = c.add;
    return {
      op: "add",
      id,
      type: type as EditType | undefined,
      spec: Object.keys(spec).length ? spec : undefined,
    };
  }
  if (c.set) {
    const { id, type, ...spec } = c.set;
    return { op: "set", id, type: type as EditType | undefined, spec };
  }
  if (c.remove !== undefined) {
    return typeof c.remove === "string"
      ? { op: "remove", id: c.remove }
      : { op: "remove", id: c.remove.id, type: c.remove.type as EditType | undefined };
  }
  if (c.rename) {
    return {
      op: "rename",
      id: c.rename.id,
      to: c.rename.to,
      type: c.rename.type as EditType | undefined,
    };
  }
  const { from, to, remove, ...spec } = c.use as NonNullable<PlanChangeSpec["use"]>;
  return {
    op: "use",
    from,
    to,
    remove: remove || undefined,
    spec: Object.keys(spec).length ? spec : undefined,
  };
}

/** A sequence's steps as journey steps: the agreed ones, without the plan's own fields. */
export function journeySteps(seq: PlanSequenceSpec): Record<string, unknown>[] {
  return seq.steps.filter(isAgreed).map((s: PlanStepSpec) => {
    const { intent: _i, by: _b, status: _s, ...step } = s;
    return step;
  });
}

/**
 * The `archdoc edit` op a sequence becomes: the new steps of a journey the
 * model has (`existing`), or a new journey.
 */
export function sequenceOp(seq: PlanSequenceSpec, existing: boolean): EditOp {
  const steps = journeySteps(seq);
  if (existing) {
    const spec: Record<string, unknown> = { steps };
    if (seq.name) spec.name = seq.name;
    if (seq.goal) spec.goal = seq.goal;
    if (seq.actor) spec.actor = seq.actor;
    return { op: "set", id: seq.journey, type: "journey", spec };
  }
  return {
    op: "add",
    id: seq.journey,
    type: "journey",
    spec: {
      ...(seq.name ? { name: seq.name } : {}),
      actor: seq.actor,
      goal: seq.goal ?? seq.intent ?? seq.name ?? seq.journey,
      steps,
    },
  };
}

/** Every item ID in a plan: intents, changes, sequences, steps (s1#2), notes, and tasks. */
export function planItemIds(spec: PlanSpec): Set<string> {
  const ids = new Set<string>();
  for (const i of spec.intents) ids.add(i.id);
  for (const c of spec.changes) ids.add(c.id);
  for (const s of spec.sequences) {
    ids.add(s.id);
    for (const [i] of s.steps.entries()) ids.add(`${s.id}#${i + 1}`);
  }
  for (const n of spec.notes) ids.add(n.id);
  for (const t of spec.tasks) ids.add(t.id);
  return ids;
}

/** A plan's ID from words: lowercase, dashes, at most six words. */
export function planId(text: string): string {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter(Boolean)
    .slice(0, 6);
  return words.join("-") || "plan";
}

/**
 * The person's intents nothing in the plan carries out yet: not settled, and
 * no change or sequence (other than a dismissed one) names them in `for`.
 */
export function openIntents(spec: PlanSpec): PlanSpec["intents"] {
  const answered = new Set<string>();
  for (const item of [...spec.changes, ...spec.sequences]) {
    if (item.status === "dismissed") continue;
    for (const f of item.for ?? []) answered.add(f);
  }
  return spec.intents.filter((i) => !i.resolved && !answered.has(i.id));
}

/**
 * What a plan touches, for a map that shows only that. `touched`: where the
 * person put intents (both ends of one about a connection), and what each
 * change and sequence is about. `scope`: what the idea landed on when the
 * plan started. Model IDs and actor IDs, as the plan writes them, each once.
 */
export function planFocus(spec: PlanSpec): { touched: string[]; scope: string[] } {
  const out = new Set<string>();
  for (const n of spec.intents) {
    if (n.on) out.add(n.on);
    if (n.to) out.add(n.to);
  }
  for (const c of spec.changes) {
    if (c.status === "dismissed") continue;
    if (c.use) {
      out.add(c.use.from);
      out.add(c.use.to);
    } else if (changeTarget(c)) out.add(changeTarget(c));
    if (c.rename) out.add(c.rename.to);
  }
  for (const q of spec.sequences) {
    if (q.status === "dismissed") continue;
    for (const st of q.steps) {
      out.add(st.from);
      out.add(st.to);
    }
  }
  const touched = [...out].filter(Boolean);
  return { touched, scope: (spec.scope?.elements ?? []).filter((x) => !out.has(x)) };
}
