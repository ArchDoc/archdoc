import {
  type ChangeSummary,
  CODE_DIFF_BY,
  type CodeChange,
  type MarkedFinding,
  type Model,
  type ModelDiff,
  projectCodeChange,
  type RelationshipView,
  summarizeChange,
  toReview,
} from "@archdoc/core/browser";

/**
 * What the Diff tab shows: a branch's code change since it left another
 * branch, read into the branch's own model. Never the other branch's model.
 */
export interface Compare {
  /** The branch the change is since, such as main. */
  ref: string;
  /** The branch with the change, or undefined for the working tree. */
  head?: string | undefined;
  /** The head's model, as written. */
  base: Model;
  /** The head's model with what its code change says applied: what the canvas draws. */
  after: Model;
  diff: ModelDiff;
  code: CodeChange;
  /** IDs of journeys the changes affect. */
  journeys: Set<string>;
  groups: ChangeGroups;
  /** The same summary the PR comment renders: verdict, headline, concerns, people to ask. */
  summary: ChangeSummary;
  /** How many things changed, for the tab's badge. */
  count: number;
}

/** What the server read from the code changed between the two branches. */
export interface ChangeFindings {
  /** The branch the change is since. */
  base: string;
  /** The branch with the change; undefined for the working tree. */
  head?: string | undefined;
  /** Their merge base. */
  commit: string;
  /** check's findings on the head, marked with whether the change introduced them. */
  findings: MarkedFinding[];
  changedFiles: string[];
  /** The code change in the model's terms. */
  code: CodeChange;
}

export interface ChangeItem {
  /** What to select on the canvas: element:<id>, actor:<id>, journey:<id>, or data:<entry>. */
  key: string;
  kind: "added" | "removed" | "changed" | "moved" | "error" | "warning";
  label: string;
  hint: string;
  detail?: string | undefined;
  /** For a journey in another repo: its namespace. */
  repo?: string | undefined;
}

export interface ChangeGroups {
  /** Findings the head has that the base didn't: rules it breaks, references it loses. */
  breaks: ChangeItem[];
  journeys: ChangeItem[];
  elements: ChangeItem[];
  data: ChangeItem[];
  /** Routes, consumers, jobs, and commands the code added or removed. */
  entries: ChangeItem[];
  /** What the code says that the head's model doesn't, yet. */
  unmodeled: ChangeItem[];
  /** Facts an agent suggested, waiting for a person to review. */
  suggested: ChangeItem[];
}

/**
 * Reads a branch's code change into its model: what the code added, changed,
 * and removed, as elements, uses, and entry points, each marked with whether
 * the model already says it, and the same summary the PR comment renders.
 */
export function compareCode(model: Model, change: ChangeFindings): Compare {
  const { model: after, diff } = projectCodeChange(model, change.code);
  const summary = summarizeChange({
    model: after,
    base: model,
    changedFiles: change.changedFiles,
    diff,
    findings: change.findings,
    diagrams: false,
  });
  const concern = (kind: "error" | "warning") => (c: ChangeSummary["blocking"][number]) => ({
    key: c.element ? `element:${c.element}` : "",
    kind,
    label: c.detail,
    hint: c.rule ? `rule ${c.rule}` : (c.code.split("/").pop() ?? c.code),
  });
  const groups: ChangeGroups = {
    breaks: [
      ...summary.blocking.map(concern("error")),
      ...summary.attention
        .filter(
          (c) =>
            c.code !== "data/sensitive" &&
            c.code !== "model/suggested" &&
            // The code change lists these itself, by whether the model has them.
            c.code !== UNDECLARED,
        )
        .map(concern("warning")),
    ],
    journeys: journeyItems(summary, diff),
    elements: elementItems(diff, change.code),
    data: dataItems(after, summary, diff),
    entries: entryItems(change.code),
    unmodeled: unmodeledItems(change.code, blockingUses(change.findings)),
    suggested: suggestedItems(diff),
  };
  return {
    ref: change.base,
    head: change.head,
    base: model,
    after,
    diff,
    code: change.code,
    journeys: new Set(summary.journeys.filter((j) => !j.namespace).map((j) => j.id)),
    groups,
    summary,
    count:
      groups.breaks.length +
      groups.journeys.length +
      groups.elements.length +
      groups.data.length +
      groups.entries.length,
  };
}

function journeyItems(report: ChangeSummary, diff: ModelDiff): ChangeItem[] {
  // Journeys in other repos too: their teams need to know.
  const items: ChangeItem[] = report.journeys.map((j) => {
    const change = j.namespace ? undefined : diff.journeys.find((c) => c.id === j.id);
    return {
      key: j.namespace ? "" : `journey:${j.id}`,
      kind: change?.kind ?? "changed",
      label: j.goal || j.id,
      hint: j.importance,
      repo: j.namespace,
      detail: j.steps.length
        ? `step${j.steps.length === 1 ? "" : "s"} ${j.steps.join(", ")}`
        : change?.kind === "added"
          ? "new journey"
          : undefined,
    };
  });
  // Removed journeys are gone from the head, so the report doesn't list them.
  for (const c of diff.journeys) {
    if (c.kind === "removed") {
      items.push({ key: "", kind: "removed", label: c.id, hint: "removed" });
    }
  }
  return items;
}

function elementItems(diff: ModelDiff, code: CodeChange): ChangeItem[] {
  const files = new Map(code.elements.map((e) => [e.id, e]));
  return [
    ...diff.elements.map((c) => ({
      key: `element:${c.id}`,
      kind: c.kind,
      label: c.id,
      hint: files.get(c.id)?.modeled === false ? "new code, not in the model" : "element",
      detail: filesDetail(files.get(c.id)?.files) ?? detail(c),
    })),
    ...diff.actors.map((c) => ({
      key: c.kind === "removed" ? "" : `actor:${c.id}`,
      kind: c.kind,
      label: c.id,
      hint: "actor",
      detail: detail(c),
    })),
    ...code.uses.map((u) => ({
      key: `element:${u.from}`,
      kind: u.kind,
      label: `${u.from} → ${u.to}`,
      hint: u.typeOnly ? "uses (types only)" : "uses",
      detail: u.evidence[0],
    })),
  ];
}

function filesDetail(list: { status: string }[] | undefined): string | undefined {
  if (!list?.length) return undefined;
  const count = (status: string) => list.filter((f) => f.status === status).length;
  return (
    [
      ["added", count("added")],
      ["modified", count("modified")],
      ["deleted", count("deleted")],
    ] as const
  )
    .filter(([, n]) => n > 0)
    .map(([what, n]) => `${n} file${n === 1 ? "" : "s"} ${what}`)
    .join(", ");
}

function entryItems(code: CodeChange): ChangeItem[] {
  return code.entries.map((e) => ({
    key: e.element ? `element:${e.element}` : "",
    kind: e.kind,
    label: `${e.entry.kind} ${e.entry.label}`,
    hint: e.element ?? e.entry.file,
    detail:
      e.kind === "removed"
        ? undefined
        : e.journeys.length
          ? `through ${e.journeys.join(", ")}`
          : "no journey follows it",
  }));
}

/**
 * What the code says that the head's model doesn't: new code no element maps,
 * uses the code added that the model lacks, uses the code dropped that the
 * model still has, and elements whose code is gone.
 */
function unmodeledItems(code: CodeChange, blocking: Set<string>): ChangeItem[] {
  const items: ChangeItem[] = [];
  for (const p of code.proposed) {
    items.push({
      key: `element:${p.id}`,
      kind: "warning",
      label: p.id,
      hint: `new ${p.kind}`,
      detail: `${p.code} has no element`,
    });
  }
  for (const e of code.elements) {
    if (e.modeled && e.kind === "removed") {
      items.push({
        key: "",
        kind: "warning",
        label: e.id,
        hint: "code removed",
        detail: "the model still has it",
      });
    }
  }
  for (const u of code.uses) {
    if (u.kind === "added" && !u.modeled) {
      const blocks = blocking.has(`${u.from} ${u.to}`);
      items.push({
        key: `element:${u.from}`,
        kind: blocks ? "error" : "warning",
        label: `${u.from} → ${u.to}`,
        hint: blocks ? "use not in the model, blocks the merge" : "use not in the model",
        detail: u.evidence[0],
      });
    }
    if (u.kind === "removed" && u.modeled) {
      items.push({
        key: `element:${u.from}`,
        kind: "warning",
        label: `${u.from} → ${u.to}`,
        hint: "the code no longer uses it",
        detail: "the model still has it",
      });
    }
  }
  return items;
}

function dataItems(model: Model, report: ChangeSummary, diff: ModelDiff): ChangeItem[] {
  const items: ChangeItem[] = diff.data.map((c) => ({
    key: c.kind === "removed" ? "" : `data:${model.namespace}.${c.id}`,
    kind: c.kind,
    label: c.id,
    hint: "data",
    detail: detail(c),
  }));
  const key = (ref: string) => (model.data.has(ref) ? `data:${model.namespace}.${ref}` : "");
  const fields = (list: { field: string; classification: string }[]) =>
    list.map((f) => `${f.field} (${f.classification})`).join(", ");
  for (const { flow, fields: sensitive, external } of report.data.flows) {
    items.push({
      key: key(flow.data),
      kind: "warning",
      label: `${flow.data}: ${end(flow.from)} → ${end(flow.to)}`,
      hint: external ? "sent outside" : "new path",
      detail: fields(sensitive),
    });
  }
  for (const s of report.data.stores) {
    items.push({
      key: key(s.data),
      kind: "warning",
      label: `${s.element} stores ${s.data}`,
      hint: "new store",
      detail: fields(s.fields),
    });
  }
  return items;
}

/** The uses check blocks on because the model doesn't declare them, as `from to`. */
function blockingUses(findings: MarkedFinding[]): Set<string> {
  const out = new Set<string>();
  for (const f of findings) {
    if (f.code !== UNDECLARED || f.severity !== "error" || !f.introduced || !f.element) continue;
    const to = new RegExp(`^${escapeRegExp(f.element)} depends on (\\S+), but`).exec(
      f.message,
    )?.[1];
    if (to) out.add(`${f.element} ${to}`);
  }
  return out;
}

/** A finding the Diff lists under "Not in the model yet", with the code that says it. */
export const UNDECLARED = "drift/undeclared-dependency";

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function suggestedItems(diff: ModelDiff): ChangeItem[] {
  // What the code change itself proposes is listed as not in the model, not as suggested.
  const suggested = (c: { kind: string; after?: unknown }) =>
    c.kind !== "removed" &&
    toReview(c.after) !== undefined &&
    (c.after as { provenance?: { by?: string } }).provenance?.by !== CODE_DIFF_BY;
  return [
    ...diff.elements.filter(suggested).map((c) => ({
      key: `element:${c.id}`,
      kind: c.kind,
      label: c.id,
      hint: "element",
      detail: by(c.after),
    })),
    ...diff.actors.filter(suggested).map((c) => ({
      key: `actor:${c.id}`,
      kind: c.kind,
      label: c.id,
      hint: "actor",
      detail: by(c.after),
    })),
    ...diff.relationships.filter(suggested).map((c) => {
      const r = c.after as RelationshipView;
      return {
        key: `${r.from.type}:${r.from.id}`,
        kind: c.kind,
        label: `${end(r.from)} → ${end(r.to)}`,
        hint: "uses",
        detail: by(c.after),
      };
    }),
  ];
}

function detail(c: { kind: string; from?: string | undefined; fields: string[] }) {
  if (c.kind === "moved") return `from ${c.from}`;
  if (c.kind === "changed") return c.fields.join(", ");
  return undefined;
}

function by(spec: unknown): string | undefined {
  const who = (spec as { provenance?: { by?: string } } | undefined)?.provenance?.by;
  return who ? `by ${who}` : undefined;
}

function end(t: RelationshipView["from"] | RelationshipView["to"]): string {
  return t.type === "external" ? t.ref : t.id;
}
