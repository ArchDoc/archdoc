import { INIT_DESCRIPTION } from "../check/discovery.js";
import { locate } from "../codemap/codemap.js";
import type { SourceLocation } from "../diagnostics.js";
import { Resolver } from "../load/resolve.js";
import type { ElementNode, Model } from "../model.js";
import { search } from "./search.js";

export type FindType = "element" | "actor" | "journey" | "data" | "environment";

/** What a thing still lacks, for find's `missing`. */
export type FindGap = "description" | "code" | "uses" | "deploy" | "fields" | "journey";

export const FIND_GAPS: readonly FindGap[] = [
  "description",
  "code",
  "uses",
  "deploy",
  "fields",
  "journey",
];

export interface FindQuery {
  /** Words, ranked by how well they match IDs, names, descriptions, and code paths. */
  words?: string | undefined;
  type?: FindType | undefined;
  /** An element, actor, or data kind, or a journey's importance. */
  kind?: string | undefined;
  /** Only what's inside this element. */
  under?: string | undefined;
  /** Elements whose code covers this file or directory, the one that owns it first. */
  path?: string | undefined;
  /** Only things that lack all of these. */
  missing?: readonly FindGap[] | undefined;
  limit?: number | undefined;
}

export interface FindRow {
  type: FindType | "node";
  id: string;
  kind: string;
  description?: string | undefined;
  code: string[];
  /** Elements: what it uses. Journeys: actor and step count. */
  detail?: string | undefined;
  location?: SourceLocation | undefined;
}

export interface FindResult {
  rows: FindRow[];
  /** How many matched before the limit. */
  total: number;
  /** Why the query couldn't run as asked, such as an unknown element in `under`. */
  problem?: string | undefined;
}

/**
 * Finds parts of the model by words and by what they are, for an agent
 * building or changing it: the elements under one, the element that owns a
 * file, or everything still missing a description, a use, or a deploy. Each
 * row has the ID to pass to archdoc_edit and where it's written.
 */
export function find(model: Model, q: FindQuery): FindResult {
  // Words rank, so the best few say it; a filter lists what it finds.
  const limit = q.limit ?? (q.words?.trim() ? 12 : 40);
  const resolver = new Resolver(
    model.namespace,
    new Set(Object.keys(model.imports)),
    new Set(model.elements.keys()),
    new Set(model.actors.keys()),
  );
  let under: string | undefined;
  if (q.under) {
    const r = resolver.element(q.under);
    if (r.status !== "resolved") {
      return {
        rows: [],
        total: 0,
        problem:
          r.status === "ambiguous"
            ? `"${q.under}" could be ${r.candidates.join(", ")}.`
            : `No element "${q.under}".`,
      };
    }
    under = r.target.id;
  }

  const connected = connections(model);
  const inJourney = new Set<string>();
  for (const j of model.journeys.values()) {
    if (j.actor?.type === "actor") inJourney.add(j.actor.id);
    for (const s of j.steps) {
      if (s.from?.type === "actor") inJourney.add(s.from.id);
    }
  }
  const hasEnvironments = model.environments.size > 0;
  const deployed = new Set(model.deployments.map((d) => d.element));
  const gaps = q.missing ?? [];
  const lacks = (row: FindRow): boolean =>
    gaps.every((g) => {
      switch (g) {
        case "description":
          return !row.description?.trim() || INIT_DESCRIPTION.test(row.description.trim());
        case "code":
          return (
            row.type === "element" &&
            ["container", "component", "code"].includes(row.kind) &&
            row.code.length === 0
          );
        case "uses":
          return row.type === "element" && !connected.has(row.id);
        case "deploy":
          return (
            row.type === "element" &&
            hasEnvironments &&
            ["container", "datastore", "queue"].includes(row.kind) &&
            !deployed.has(row.id) &&
            !deployedAbove(model, row.id, deployed)
          );
        case "fields": {
          const d = row.type === "data" ? model.data.get(row.id) : undefined;
          return !!d && !Object.keys(d.spec.fields ?? {}).length && !d.spec.source;
        }
        case "journey":
          return row.type === "actor" && !inJourney.has(row.id);
        default:
          return false;
      }
    });

  let rows: FindRow[];
  if (q.path) {
    rows = locate(model, q.path).matches.map((m) => elementRow(model, m.element));
  } else if (q.words?.trim()) {
    rows = search(model, q.words, 500).flatMap((h) => {
      if (h.type === "element") {
        const e = model.elements.get(h.id);
        return e ? [elementRow(model, e)] : [];
      }
      return everything(model).filter((r) => r.type === h.type && r.id === h.id);
    });
    // Environments aren't searched by words; match their IDs and descriptions.
    const words = q.words.toLowerCase().split(/\s+/).filter(Boolean);
    for (const r of everything(model)) {
      if (r.type !== "environment" && r.type !== "node") continue;
      const text = `${r.id} ${r.kind} ${r.description ?? ""}`.toLowerCase();
      if (words.some((w) => text.includes(w))) rows.push(r);
    }
  } else {
    rows = everything(model);
  }

  const filtered = rows.filter(
    (r) =>
      (!q.type || r.type === q.type || (q.type === "environment" && r.type === "node")) &&
      (!q.kind || r.kind === q.kind) &&
      (!under || (r.type === "element" && r.id.startsWith(`${under}.`))) &&
      lacks(r),
  );
  return { rows: filtered.slice(0, limit), total: filtered.length };
}

/** Elements with a use in or out, or a journey step at them. */
function connections(model: Model): Set<string> {
  const out = new Set<string>();
  for (const r of model.relationships) {
    if (r.from.type === "element") out.add(r.from.id);
    if (r.to.type === "element") out.add(r.to.id);
  }
  for (const j of model.journeys.values()) {
    for (const s of j.steps) {
      if (s.from?.type === "element") out.add(s.from.id);
      if (s.to?.type === "element") out.add(s.to.id);
    }
  }
  // A use of a container reaches what's inside it, and a use from inside counts for it.
  for (const id of [...out]) {
    for (let p = id; p.includes("."); ) {
      p = p.slice(0, p.lastIndexOf("."));
      out.add(p);
    }
  }
  return out;
}

function deployedAbove(model: Model, id: string, deployed: Set<string>): boolean {
  for (let e = model.elements.get(id); e?.parentId; e = model.elements.get(e.parentId)) {
    if (deployed.has(e.parentId)) return true;
  }
  return false;
}

function everything(model: Model): FindRow[] {
  const rows: FindRow[] = [];
  for (const e of model.elements.values()) rows.push(elementRow(model, e));
  for (const a of model.actors.values()) {
    const uses = model.relationships
      .filter((r) => r.from.type === "actor" && r.from.id === a.id)
      .map((r) => (r.to.type === "external" ? r.to.ref : r.to.id));
    rows.push({
      type: "actor",
      id: a.id,
      kind: a.spec.kind,
      description: a.spec.description,
      code: [],
      detail: uses.length ? `uses ${uses.join(", ")}` : undefined,
      location: a.location,
    });
  }
  for (const j of model.journeys.values()) {
    rows.push({
      type: "journey",
      id: j.id,
      kind: j.spec.importance ?? "normal",
      description: j.spec.goal,
      code: [],
      detail: `${j.spec.actor} · ${j.steps.length} step${j.steps.length === 1 ? "" : "s"}`,
      location: j.location,
    });
  }
  for (const d of model.data.values()) {
    const fields = Object.keys(d.spec.fields ?? {});
    rows.push({
      type: "data",
      id: d.id,
      kind: d.spec.kind,
      description: d.spec.description,
      code: Object.values(d.spec.source ?? {}).map(String),
      detail: fields.length
        ? `fields ${fields.slice(0, 8).join(", ")}${fields.length > 8 ? `, +${fields.length - 8}` : ""}`
        : undefined,
      location: d.location,
    });
  }
  for (const env of model.environments.values()) {
    rows.push({
      type: "environment",
      id: env.id,
      kind: "environment",
      description: env.spec.description,
      code: [],
      location: env.location,
    });
  }
  for (const n of model.deploymentNodes.values()) {
    const here = model.deployments.filter((d) => d.node === n.id).map((d) => d.element);
    rows.push({
      type: "node",
      id: n.id,
      kind: n.spec.kind ?? "node",
      description: n.spec.description,
      code: n.code.map((c) => c.path),
      detail: here.length ? `runs ${here.join(", ")}` : undefined,
      location: n.location,
    });
  }
  return rows;
}

function elementRow(model: Model, e: ElementNode): FindRow {
  const uses = model.relationships
    .filter((r) => r.from.type === "element" && r.from.id === e.id)
    .map((r) => (r.to.type === "external" ? r.to.ref : r.to.id));
  return {
    type: "element",
    id: e.id,
    kind: e.spec.kind,
    description: e.spec.description,
    code: e.code.map((c) => (c.symbol ? `${c.path}#${c.symbol}` : c.path)),
    detail: uses.length ? `uses ${uses.join(", ")}` : undefined,
    location: e.location,
  };
}

/** The rows, one or two lines each: the ID first, so it can go straight into archdoc_edit. */
export function formatFind(r: FindResult, q: FindQuery): string {
  if (r.problem) return r.problem;
  const what = describeQuery(q);
  if (!r.rows.length) {
    return q.missing?.length && !q.words && !q.path
      ? `Nothing ${what}.`
      : `Nothing ${what}. Try fewer filters, or other words.`;
  }
  const out = [
    `${r.total} ${r.total === 1 ? "match" : "matches"} ${what}${r.total > r.rows.length ? `, the first ${r.rows.length}` : ""}:`,
  ];
  for (const row of r.rows) {
    const label = row.type === "element" ? row.kind : `${row.type}, ${row.kind}`;
    const desc = row.description ? `: ${clip(row.description.trim(), 120)}` : "";
    out.push(`  ${row.id} (${label})${desc}`);
    const extra = [
      row.code.length ? `code ${clip(row.code.join(", "), 100)}` : "",
      row.detail ? clip(row.detail, 140) : "",
      row.location ? `${row.location.file}:${row.location.line}` : "",
    ].filter(Boolean);
    if (extra.length) out.push(`    ${extra.join(" · ")}`);
  }
  if (r.total > r.rows.length)
    out.push(`  … ${r.total - r.rows.length} more: narrow it, or raise limit.`);
  return out.join("\n");
}

function describeQuery(q: FindQuery): string {
  const parts = [
    q.words ? `for "${q.words}"` : "",
    q.type ? `of type ${q.type}` : "",
    q.kind ? `of kind ${q.kind}` : "",
    q.under ? `inside ${q.under}` : "",
    q.path ? `whose code covers ${q.path}` : "",
    q.missing?.length ? `missing ${q.missing.join(" and ")}` : "",
  ].filter(Boolean);
  return parts.length ? `in the model ${parts.join(", ")}` : "in the model";
}

function clip(s: string, n: number): string {
  const one = s.replace(/\s+/g, " ");
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
}

/**
 * The element tree from the top (or from one element), a line per element
 * with its kind, code, and uses, to read the model's shape without opening
 * its YAML.
 */
export function formatOutline(
  model: Model,
  options: { under?: string; depth?: number } = {},
): string {
  const depth = options.depth ?? 3;
  let roots: ElementNode[];
  if (options.under) {
    const r = new Resolver(
      model.namespace,
      new Set(Object.keys(model.imports)),
      new Set(model.elements.keys()),
      new Set(model.actors.keys()),
    ).element(options.under);
    if (r.status !== "resolved") {
      return r.status === "ambiguous"
        ? `"${options.under}" could be ${r.candidates.join(", ")}.`
        : `No element "${options.under}".`;
    }
    roots = [model.elements.get(r.target.id) as ElementNode];
  } else {
    roots = [...model.elements.values()].filter((e) => !e.parentId);
  }
  const out = [
    `${model.name ?? model.namespace}: ${count(model.elements.size, "element")}, ${count(model.actors.size, "actor")}, ${count(model.journeys.size, "journey")}, ${count(model.data.size, "data entry", "data entries")}`,
  ];
  const visit = (e: ElementNode, level: number) => {
    const pad = "  ".repeat(level + 1);
    const uses = model.relationships
      .filter((r) => r.from.type === "element" && r.from.id === e.id)
      .map((r) => r.ref);
    const code = e.code.map((c) => (c.symbol ? `${c.path}#${c.symbol}` : c.path));
    out.push(
      `${pad}${e.id} (${e.spec.kind})${e.spec.description ? `: ${clip(e.spec.description.trim(), 90)}` : ""}`,
    );
    const extra = [
      code.length ? `code ${clip(code.join(", "), 80)}` : "",
      uses.length ? `uses ${clip(uses.join(", "), 100)}` : "",
    ].filter(Boolean);
    if (extra.length) out.push(`${pad}  ${extra.join(" · ")}`);
    if (level + 1 >= depth) {
      const hidden = countInside(model, e);
      if (hidden)
        out.push(
          `${pad}  … ${hidden} element${hidden === 1 ? "" : "s"} inside (raise depth, or under: ${e.id})`,
        );
      return;
    }
    for (const c of e.childIds) {
      const child = model.elements.get(c);
      if (child) visit(child, level + 1);
    }
  };
  for (const r of roots) visit(r, 0);
  const actors = [...model.actors.values()];
  if (!options.under && actors.length) {
    out.push("", "Actors");
    for (const a of actors) {
      const uses = model.relationships
        .filter((r) => r.from.type === "actor" && r.from.id === a.id)
        .map((r) => r.ref);
      out.push(`  ${a.id} (${a.spec.kind})${uses.length ? ` · uses ${uses.join(", ")}` : ""}`);
    }
  }
  if (!options.under && model.journeys.size) {
    out.push("", "Journeys");
    for (const j of model.journeys.values()) {
      out.push(`  ${j.id} (${j.spec.actor}, ${j.steps.length} steps): ${clip(j.spec.goal, 90)}`);
    }
  }
  return out.join("\n");
}

function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function countInside(model: Model, e: ElementNode): number {
  return [...model.elements.keys()].filter((id) => id.startsWith(`${e.id}.`)).length;
}
