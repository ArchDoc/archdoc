import type { EntryPoint } from "../check/discovery.js";
import { isVerificationCode } from "../check/discovery.js";
import { evidenceOf, isDevTooling, type ObservedDependency } from "../check/observed.js";
import { locate } from "../codemap/codemap.js";
import type { ElementNode, Model, Relationship } from "../model.js";
import type { ModelDiff, RelationshipView } from "./diff.js";

// A branch's change read from its code, not from its model files: the files
// changed since the merge base, mapped onto the branch's model and turned into
// the model's own terms (elements, uses, entry points), each marked with
// whether the model already says it.

/** One end of a code change: the repository's files, and what the analyzers saw in them. */
export interface CodeSide {
  files: readonly string[];
  observed: readonly ObservedDependency[];
  /** Entry points in the changed files at this end. */
  entries?: readonly EntryPoint[] | undefined;
}

export type FileStatus = "added" | "modified" | "deleted";

export interface FileChange {
  path: string;
  status: FileStatus;
  /** The element that owns it in the branch's model. */
  element?: string | undefined;
  /** The new element proposed for it, when no element owns it. */
  proposed?: string | undefined;
}

/** An element whose code the change touched. */
export interface ElementCodeChange {
  id: string;
  /** added: all its code is new. removed: all its code is gone. changed: otherwise. */
  kind: "added" | "changed" | "removed";
  /** False for an element the model doesn't have yet (a proposed one). */
  modeled: boolean;
  files: { path: string; status: FileStatus }[];
}

/** New code no element covers, as the element it would be. */
export interface ProposedElement {
  id: string;
  key: string;
  parent?: string | undefined;
  kind: "container" | "component" | "code";
  /** The code path it would map, such as `packages/billing/**`. */
  code: string;
  files: string[];
}

/** A dependency between elements that the change added or removed. */
export interface UseChange {
  from: string;
  to: string;
  kind: "added" | "removed";
  /** Whether the model declares it (for an addition) or still declares it (for a removal). */
  modeled: boolean;
  /** Only type imports: a compile-time dependency, not a runtime call. */
  typeOnly: boolean;
  /** Where the code says it, such as `src/a.ts:3 (@acme/b)`. */
  evidence: string[];
}

/** A route, consumer, job, or command the change added or removed. */
export interface EntryChange {
  kind: "added" | "removed";
  entry: EntryPoint;
  element?: string | undefined;
  /** Journeys that pass through its element. None means no journey follows it yet. */
  journeys: string[];
}

export interface CodeChange {
  files: FileChange[];
  elements: ElementCodeChange[];
  proposed: ProposedElement[];
  uses: UseChange[];
  entries: EntryChange[];
}

/** Who marks the facts the code change proposes. */
export const CODE_DIFF_BY = "archdoc:code-diff";

const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs|go|py|rs|java|kt|kts|rb|cs|php|swift|scala|ex|exs)$/;
const NOT_CODE = /(^|\/)(node_modules|dist|build|out|vendor|\.archdoc|coverage)\//;

/**
 * Turns the code changed between two ends of a branch into the model's terms,
 * against the branch's model. `changed` is the changed paths (git's list);
 * each is added, modified, or deleted by which end has it.
 */
export function deriveCodeChange(input: {
  model: Model;
  base: CodeSide;
  head: CodeSide;
  changed: readonly string[];
}): CodeChange {
  const { model, base, head } = input;
  const baseFiles = new Set(base.files);
  const headFiles = new Set(head.files);
  const changed = [...new Set(input.changed)]
    .filter((p) => baseFiles.has(p) || headFiles.has(p))
    .sort();
  const statusOf = (p: string): FileStatus =>
    !baseFiles.has(p) ? "added" : !headFiles.has(p) ? "deleted" : "modified";

  const proposed = proposeElements(
    model,
    changed.filter((p) => statusOf(p) === "added"),
    baseFiles,
    head.files,
  );
  const proposedOf = (path: string) =>
    proposed.find((e) => path === e.code || inDir(path, dirOfCode(e.code)));
  const located = new Map<string, string | undefined>();
  const owner = (path: string): string | undefined => {
    if (!located.has(path)) {
      located.set(path, locate(model, path).element?.id ?? proposedOf(path)?.id);
    }
    return located.get(path);
  };

  const files: FileChange[] = changed.map((path) => {
    const element = locate(model, path).element?.id;
    return {
      path,
      status: statusOf(path),
      element,
      proposed: element ? undefined : proposedOf(path)?.id,
    };
  });

  // Elements: what each one's code did. An element whose code is all new is added; all gone, removed.
  const byElement = new Map<string, { path: string; status: FileStatus }[]>();
  for (const f of files) {
    const id = f.element ?? f.proposed;
    if (!id) continue;
    const list = byElement.get(id) ?? [];
    list.push({ path: f.path, status: f.status });
    byElement.set(id, list);
  }
  const owned = (list: readonly string[]) => new Set(list.map(owner));
  const ownedBefore = owned(base.files);
  const ownedAfter = owned(head.files);
  const elements: ElementCodeChange[] = [...byElement]
    .map(([id, list]) => {
      const modeled = model.elements.has(id);
      const before = ownedBefore.has(id);
      const after = ownedAfter.has(id);
      const kind = !before && after ? "added" : before && !after ? "removed" : "changed";
      return { id, kind, modeled, files: list } as ElementCodeChange;
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  // Uses: element-level dependencies at each end, mapped onto the same model.
  const changedSet = new Set(changed);
  const before = edges(base.observed, owner);
  const after = edges(head.observed, owner);
  const uses: UseChange[] = [];
  for (const [key, e] of after) {
    if (before.has(key)) continue;
    uses.push({
      from: e.from,
      to: e.to,
      kind: "added",
      modeled: declares(model, e.from, e.to),
      typeOnly: e.typeOnly,
      evidence: e.deps.filter((d) => changedSet.has(d.from)).map(evidenceOf),
    });
  }
  for (const [key, e] of before) {
    if (after.has(key)) continue;
    uses.push({
      from: e.from,
      to: e.to,
      kind: "removed",
      modeled: declares(model, e.from, e.to),
      typeOnly: e.typeOnly,
      evidence: e.deps.filter((d) => changedSet.has(d.from)).map(evidenceOf),
    });
  }
  uses.sort(
    (a, b) =>
      a.from.localeCompare(b.from) || a.to.localeCompare(b.to) || a.kind.localeCompare(b.kind),
  );

  // Entry points: by what starts them, so moving a handler isn't a new one.
  const entryKey = (e: EntryPoint) => `${e.kind}\u0000${e.label}`;
  const beforeEntries = new Map((base.entries ?? []).map((e) => [entryKey(e), e]));
  const afterEntries = new Map((head.entries ?? []).map((e) => [entryKey(e), e]));
  const entryChange = (kind: EntryChange["kind"], entry: EntryPoint): EntryChange => {
    const element = owner(entry.file);
    return { kind, entry, element, journeys: element ? journeysThrough(model, element) : [] };
  };
  const entries: EntryChange[] = [
    ...[...afterEntries]
      .filter(([k]) => !beforeEntries.has(k))
      .map(([, e]) => entryChange("added", e)),
    ...[...beforeEntries]
      .filter(([k]) => !afterEntries.has(k))
      .map(([, e]) => entryChange("removed", e)),
  ];

  return { files, elements, proposed, uses, entries };
}

/**
 * The branch's model with the code change applied: proposed elements and the
 * uses the code added that the model lacks are in it (marked inferred by
 * {@link CODE_DIFF_BY}), and elements whose code is gone and the uses the code
 * dropped are out of it. The diff says what the code change did to the model,
 * modeled or not, so a branch whose model already says it all still shows its change.
 */
export function projectCodeChange(
  model: Model,
  change: CodeChange,
): { model: Model; diff: ModelDiff } {
  const elements = new Map(model.elements);
  const relationships = [...model.relationships];
  const diff: ModelDiff = {
    actors: [],
    elements: [],
    relationships: [],
    journeys: [],
    data: [],
    mappings: [],
    logic: [],
    rules: [],
  };
  const provenance = { source: "inferred" as const, by: CODE_DIFF_BY };

  for (const p of change.proposed) {
    const parent = p.parent ? elements.get(p.parent) : undefined;
    const spec = {
      kind: p.kind,
      description: `New code in ${dirOfCode(p.code) || p.files[0]}, not in the model yet.`,
      code: [p.code],
      provenance,
    };
    const node: ElementNode = {
      type: "element",
      id: p.id,
      key: p.key,
      parentId: parent?.id,
      childIds: [],
      depth: parent ? parent.depth + 1 : 0,
      spec: spec as ElementNode["spec"],
      code: [{ path: p.code }] as ElementNode["code"],
    };
    elements.set(p.id, node);
    if (parent) elements.set(parent.id, { ...parent, childIds: [...parent.childIds, p.id] });
  }

  for (const c of change.elements) {
    if (!c.modeled) {
      diff.elements.push({ kind: "added", id: c.id, after: elements.get(c.id)?.spec, fields: [] });
      continue;
    }
    const spec = model.elements.get(c.id)?.spec;
    if (c.kind === "removed") {
      diff.elements.push({ kind: "removed", id: c.id, before: spec, fields: [] });
      removeElement(elements, c.id);
    } else {
      diff.elements.push({
        kind: c.kind === "added" ? "added" : "changed",
        id: c.id,
        before: c.kind === "added" ? undefined : spec,
        after: spec,
        fields: c.kind === "added" ? [] : ["code"],
      });
    }
  }
  diff.elements.sort((a, b) => a.id.localeCompare(b.id));

  const viewOf = (r: Relationship): RelationshipView => ({
    from: r.from,
    to: r.to,
    description: r.description,
    status: r.status,
    ...(r.provenance ? { provenance: r.provenance } : {}),
  });
  const exact = (u: UseChange) => (r: Relationship) =>
    r.from.type === "element" &&
    r.from.id === u.from &&
    r.to.type === "element" &&
    r.to.id === u.to;
  for (const u of change.uses) {
    if (u.kind === "added") {
      let r = relationships.find(exact(u));
      if (!r && !u.modeled) {
        r = {
          from: { type: "element", id: u.from },
          to: { type: "element", id: u.to },
          ref: u.to,
          description: u.typeOnly ? "Types only" : undefined,
          status: "active",
          sends: [],
          provenance,
        };
        relationships.push(r);
      }
      if (r) diff.relationships.push({ kind: "added", id: key(u), after: viewOf(r), fields: [] });
    } else {
      const i = relationships.findIndex(exact(u));
      const r = relationships[i];
      if (!r) continue;
      relationships.splice(i, 1);
      diff.relationships.push({ kind: "removed", id: key(u), before: viewOf(r), fields: [] });
    }
  }
  // Uses to or from an element whose code is gone go with it.
  const kept = relationships.filter(
    (r) =>
      (r.from.type !== "element" || elements.has(r.from.id)) &&
      (r.to.type !== "element" || elements.has(r.to.id)),
  );
  return { model: { ...model, elements, relationships: kept }, diff };
}

function key(u: UseChange): string {
  return `element:${u.from}->element:${u.to}`;
}

function removeElement(elements: Map<string, ElementNode>, id: string) {
  const node = elements.get(id);
  if (!node) return;
  for (const c of node.childIds) removeElement(elements, c);
  elements.delete(id);
  const parent = node.parentId ? elements.get(node.parentId) : undefined;
  if (parent) {
    elements.set(parent.id, { ...parent, childIds: parent.childIds.filter((c) => c !== id) });
  }
}

/**
 * New source files no element covers, grouped by the new directory they're
 * in, each as the element it would be, under the element that owns the code
 * around it.
 */
function proposeElements(
  model: Model,
  added: readonly string[],
  baseFiles: ReadonlySet<string>,
  headFiles: readonly string[],
): ProposedElement[] {
  const baseDirs = new Set<string>();
  for (const f of baseFiles) for (let d = dirOf(f); d; d = dirOf(d)) baseDirs.add(d);
  const groups = new Map<string, string[]>();
  for (const f of added) {
    if (!SOURCE.test(f) || NOT_CODE.test(f) || isVerificationCode(f)) continue;
    if (locate(model, f).element) continue;
    // The top-most directory the change created, or the file's own directory if it existed.
    let dir = dirOf(f);
    while (dir && dirOf(dir) && !baseDirs.has(dirOf(dir))) dir = dirOf(dir);
    // A new file in a directory that was already there is proposed on its own.
    const group = dir && !baseDirs.has(dir) ? dir : f;
    const list = groups.get(group) ?? [];
    list.push(f);
    groups.set(group, list);
  }
  const out: ProposedElement[] = [];
  const taken = new Set(model.elements.keys());
  const owners = new Map<string, string>();
  for (const f of headFiles) {
    const e = locate(model, f).element;
    if (e) owners.set(f, e.id);
  }
  for (const [group, files] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    const isFile = files.length === 1 && files[0] === group;
    const parent = ownerAround(model, dirOf(group), owners);
    const parentKind = parent?.spec.kind;
    const kind: ProposedElement["kind"] =
      parentKind === "container" ? "component" : parentKind === "component" ? "code" : "container";
    const base = sanitize(isFile ? stem(group) : (group.split("/").pop() ?? group)) || "new-code";
    let k = base;
    for (let n = 2; taken.has(parent ? `${parent.id}.${k}` : k); n++) k = `${base}-${n}`;
    const id = parent ? `${parent.id}.${k}` : k;
    taken.add(id);
    out.push({
      id,
      key: k,
      parent: parent?.id,
      kind,
      code: isFile ? group : `${group}/**`,
      files: files.sort(),
    });
  }
  return out;
}

/**
 * The element the code around a directory belongs to: the one every element
 * mapping files under it is inside, from the nearest directory that has any.
 * Undefined when that's nothing (the new code is a top-level part).
 */
function ownerAround(
  model: Model,
  dir: string,
  owners: ReadonlyMap<string, string>,
): ElementNode | undefined {
  for (let d = dir; ; d = dirOf(d)) {
    const ids = new Set<string>();
    for (const [f, id] of owners) if (!d || inDir(f, d)) ids.add(id);
    if (ids.size) {
      let common: string | undefined = commonAncestor([...ids]);
      // Code is a leaf: new code next to it goes beside it, in its component.
      while (common && model.elements.get(common)?.spec.kind === "code") {
        common = model.elements.get(common)?.parentId;
      }
      return common ? model.elements.get(common) : undefined;
    }
    if (!d) return undefined;
  }
}

function commonAncestor(ids: string[]): string | undefined {
  const parts = ids.map((id) => id.split("."));
  const first = parts[0] ?? [];
  let n = 0;
  while (n < first.length && parts.every((p) => p[n] === first[n])) n++;
  return n ? first.slice(0, n).join(".") : undefined;
}

interface Edge {
  from: string;
  to: string;
  typeOnly: boolean;
  deps: ObservedDependency[];
}

function edges(
  observed: readonly ObservedDependency[],
  owner: (path: string) => string | undefined,
): Map<string, Edge> {
  const out = new Map<string, Edge>();
  for (const d of observed) {
    if (isDevTooling(d)) continue;
    const from = owner(d.from);
    const to = owner(d.to);
    if (!from || !to || from === to || inside(from, to) || inside(to, from)) continue;
    const k = `${from}->${to}`;
    const e = out.get(k) ?? { from, to, typeOnly: true, deps: [] };
    e.deps.push(d);
    e.typeOnly &&= d.typeOnly === true;
    out.set(k, e);
  }
  return out;
}

/** Whether the model declares a use from one element to another, as check reads declarations. */
function declares(model: Model, from: string, to: string): boolean {
  const fromChain = chain(model, from);
  const toChain = chain(model, to);
  return model.relationships.some(
    (r) =>
      r.from.type === "element" &&
      r.to.type === "element" &&
      fromChain.has(r.from.id) &&
      (toChain.has(r.to.id) || inside(r.to.id, to)),
  );
}

function chain(model: Model, id: string): Set<string> {
  const out = new Set<string>([id]);
  for (let p = model.elements.get(id)?.parentId; p; p = model.elements.get(p)?.parentId) out.add(p);
  return out;
}

/** Journeys with a step at an element, or inside it, or at what it's inside. */
function journeysThrough(model: Model, element: string): string[] {
  const ids = chain(model, element);
  const hit = (id: string) => ids.has(id) || inside(id, element);
  return [...model.journeys.values()]
    .filter((j) =>
      j.steps.some((s) => [s.from, s.to].some((t) => t?.type === "element" && hit(t.id))),
    )
    .map((j) => j.id)
    .sort();
}

function inside(id: string, ancestor: string): boolean {
  return id.startsWith(`${ancestor}.`);
}

function inDir(path: string, dir: string): boolean {
  return !!dir && path.startsWith(`${dir}/`);
}

function dirOfCode(code: string): string {
  return code.endsWith("/**") ? code.slice(0, -3) : "";
}

function dirOf(path: string): string {
  const i = path.lastIndexOf("/");
  return i < 0 ? "" : path.slice(0, i);
}

function stem(path: string): string {
  return (path.split("/").pop() ?? path).replace(/\.[^.]+$/, "");
}

function sanitize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
