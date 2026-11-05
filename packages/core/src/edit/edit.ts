import {
  type Document,
  isMap,
  isScalar,
  isSeq,
  type Node,
  type Pair,
  parseDocument,
  type Scalar,
  YAMLMap,
  type YAMLSeq,
} from "yaml";
import type { ModelSource } from "../load/build.js";
import { Resolver } from "../load/resolve.js";
import { parseForEdit, patchYaml, stringify } from "./patch.js";

/** What an edit adds, sets, or renames. */
export type EditType = "element" | "actor" | "journey" | "data" | "environment";

/**
 * One change to the model, by ID, so an agent never has to find the right
 * lines in the YAML. IDs are found the way references are: `orders.api`,
 * `shop.orders.api`, or `api` when only one element ends that way.
 */
export type EditOp =
  /** A new element (inside the element its ID names), actor, journey, data entry, environment, or deployment node. */
  | { op: "add"; type: EditType; id: string; spec?: Record<string, unknown> | undefined }
  /** Merges fields into one thing (a JSON merge patch: null removes a field, objects merge, lists replace). */
  | { op: "set"; id: string; type?: EditType | undefined; spec: Record<string, unknown> }
  /** Removes one thing; for an element, its children and the uses that point at it too. */
  | { op: "remove"; id: string; type?: EditType | undefined }
  /**
   * Renames or moves one thing, and rewrites what refers to it. For an
   * element, `to` without a dot renames it in place, and a dotted `to` moves
   * it inside that parent.
   */
  | { op: "rename"; id: string; to: string; type?: EditType | undefined }
  /** Adds, changes, or (remove: true) removes a use from an element or actor. */
  | {
      op: "use";
      from: string;
      to: string;
      spec?: string | Record<string, unknown> | undefined;
      remove?: boolean | undefined;
    }
  /**
   * A journey step: with spec and no `at`, appended; with `at` (1-based) and
   * insert: true, inserted there; with `at`, merged into that step; with
   * remove: true, removed.
   */
  | {
      op: "step";
      journey: string;
      at?: number | undefined;
      insert?: boolean | undefined;
      spec?: Record<string, unknown> | undefined;
      remove?: boolean | undefined;
    };

export interface EditOptions {
  /** Marks what's added (elements, actors, data, journeys, uses) as suggested by this author, such as agent:claude-code. */
  by?: string | undefined;
  /** Where a new journey's file goes, such as .archdoc/journeys/<id>.yaml. Without it, journeys go in the root file. */
  journeyFile?: ((id: string) => string) | undefined;
  /** The root file's path. Defaults to the source named archdoc.yaml, else the first. */
  root?: string | undefined;
}

export interface EditedFile {
  path: string;
  /** The new text; empty when the file is removed. */
  text: string;
  created?: boolean | undefined;
  removed?: boolean | undefined;
}

export interface EditResult {
  /** The files that changed. Empty when an operation failed: then nothing changes. */
  files: EditedFile[];
  /** One line per operation: what it did, and where. */
  done: string[];
  /** Operations that couldn't be done, each with why. */
  problems: string[];
  /** IDs that now name something else: old ID to new. */
  renamed: Map<string, string>;
}

interface FileState {
  path: string;
  text: string;
  before: Document;
  after: Document;
  created?: boolean;
  removed?: boolean;
}

/** Where one thing is written: its file and the YAML path to its map. */
interface Site {
  file: FileState;
  path: (string | number)[];
}

interface UseSite {
  owner: string;
  actor: boolean;
  map: YAMLMap;
  key: string;
  /** The element it resolves to now. */
  target: string | undefined;
}

interface Index {
  namespace: string;
  root: FileState;
  elements: Map<string, Site>;
  actors: Map<string, Site>;
  journeys: Map<string, Site & { own: boolean }>;
  data: Map<string, Site>;
  environments: Map<string, Site>;
  /** Deployment nodes, such as production.aws.lambda. */
  nodes: Map<string, Site>;
}

class EditError extends Error {}

/**
 * Applies edits to model sources and returns the files that change. Pure: it
 * reads and writes nothing, so the caller decides whether to write, after
 * checking the model it makes. Each file changes only where an edit touched
 * it; everything else keeps its text and comments.
 */
export function editModel(
  sources: readonly ModelSource[],
  ops: readonly EditOp[],
  options: EditOptions = {},
): EditResult {
  const files: FileState[] = sources.map((s) => ({
    path: s.path,
    text: s.text,
    ...parseForEdit(s.text),
  }));
  const rootPath =
    options.root ??
    sources.find((s) => /(^|[/\\])archdoc\.ya?ml$/.test(s.path))?.path ??
    sources[0]?.path;
  const done: string[] = [];
  const problems: string[] = [];
  const renamed = new Map<string, string>();
  const broken = files.find((f) => f.before.errors.length);
  if (broken) {
    return {
      files: [],
      done,
      problems: [
        `${broken.path} isn't valid YAML: ${broken.before.errors[0]?.message.split("\n")[0]}. Fix it first.`,
      ],
      renamed,
    };
  }
  const editor = new Editor(files, rootPath, options, renamed);
  for (const [i, op] of ops.entries()) {
    try {
      done.push(editor.apply(op));
    } catch (err) {
      if (!(err instanceof EditError)) throw err;
      problems.push(`${ops.length > 1 ? `#${i + 1} ` : ""}${describe(op)}: ${err.message}`);
    }
  }
  if (problems.length) return { files: [], done: [], problems, renamed };
  const changed: EditedFile[] = [];
  for (const f of editor.files) {
    if (f.removed) {
      if (!f.created) changed.push({ path: f.path, text: "", removed: true });
      continue;
    }
    if (f.created) {
      const text = f.text ? patchYaml(f.text, f.before, f.after) : stringify(f.after);
      changed.push({ path: f.path, text, created: true });
      continue;
    }
    const text = patchYaml(f.text, f.before, f.after);
    if (text !== f.text) changed.push({ path: f.path, text });
  }
  return { files: changed, done, problems, renamed };
}

function describe(op: EditOp): string {
  switch (op.op) {
    case "use":
      return `${op.remove ? "unuse" : "use"} ${op.from} -> ${op.to}`;
    case "step":
      return `step ${op.journey}${op.at ? `#${op.at}` : ""}`;
    case "rename":
      return `rename ${op.id} -> ${op.to}`;
    case "add":
      return `add ${op.type} ${op.id}`;
    default:
      return `${op.op} ${op.id}`;
  }
}

class Editor {
  private index: Index;

  constructor(
    public files: FileState[],
    private rootPath: string | undefined,
    private options: EditOptions,
    private renamed: Map<string, string>,
  ) {
    this.index = this.reindex();
  }

  apply(op: EditOp): string {
    const line = this.run(op);
    this.index = this.reindex();
    return line;
  }

  private run(op: EditOp): string {
    const needs: Record<string, string[]> = {
      add: ["type", "id"],
      set: ["id", "spec"],
      remove: ["id"],
      rename: ["id", "to"],
      use: ["from", "to"],
      step: ["journey"],
    };
    const missing = (needs[op.op] ?? []).filter(
      (k) =>
        (op as Record<string, unknown>)[k] === undefined ||
        (op as Record<string, unknown>)[k] === "",
    );
    if (missing.length) throw new EditError(`${op.op} needs ${missing.join(" and ")}.`);
    switch (op.op) {
      case "add":
        return this.add(op.type, op.id, op.spec ?? {});
      case "set":
        return this.set(op.id, op.type, op.spec);
      case "remove":
        return this.remove(op.id, op.type);
      case "rename":
        return this.rename(op.id, op.to, op.type);
      case "use":
        return this.use(op.from, op.to, op.spec, op.remove);
      case "step":
        return this.step(op);
      default:
        throw new EditError(
          `Unknown op "${(op as { op: string }).op}". Use add, set, remove, rename, use, or step.`,
        );
    }
  }

  // ---------------------------------------------------------------- index

  private reindex(): Index {
    const live = this.files.filter((f) => !f.removed);
    const root = live.find((f) => f.path === this.rootPath) ?? live[0];
    if (!root) throw new EditError("There are no model files.");
    const index: Index = {
      namespace: String(plain(root.after).namespace ?? ""),
      root,
      elements: new Map(),
      actors: new Map(),
      journeys: new Map(),
      data: new Map(),
      environments: new Map(),
      nodes: new Map(),
    };
    for (const file of live) {
      const value = plain(file.after);
      if (typeof value.journey === "string") {
        index.journeys.set(value.journey, { file, path: [], own: true });
        continue;
      }
      const walk = (specs: unknown, parent: string | undefined, path: (string | number)[]) => {
        for (const [key, spec] of Object.entries(asRecord(specs))) {
          const id = parent ? `${parent}.${key}` : key;
          if (!index.elements.has(id)) index.elements.set(id, { file, path: [...path, key] });
          walk(asRecord(spec).elements, id, [...path, key, "elements"]);
        }
      };
      walk(value.elements, undefined, ["elements"]);
      for (const id of Object.keys(asRecord(value.actors))) {
        if (!index.actors.has(id)) index.actors.set(id, { file, path: ["actors", id] });
      }
      for (const id of Object.keys(asRecord(value.journeys))) {
        if (!index.journeys.has(id)) {
          index.journeys.set(id, {
            file,
            path: ["journeys", id],
            own: Object.keys(asRecord(value.journeys)).length === 1 && onlyKey(value, "journeys"),
          });
        }
      }
      for (const id of Object.keys(asRecord(value.data))) {
        if (!index.data.has(id)) index.data.set(id, { file, path: ["data", id] });
      }
      for (const [env, spec] of Object.entries(asRecord(value.environments))) {
        if (!index.environments.has(env))
          index.environments.set(env, { file, path: ["environments", env] });
        const nodes = (specs: unknown, parent: string, path: (string | number)[]) => {
          for (const [key, n] of Object.entries(asRecord(specs))) {
            const id = `${parent}.${key}`;
            if (!index.nodes.has(id)) index.nodes.set(id, { file, path: [...path, key] });
            nodes(asRecord(n).nodes, id, [...path, key, "nodes"]);
          }
        };
        nodes(asRecord(spec).nodes, env, ["environments", env, "nodes"]);
      }
    }
    return index;
  }

  private resolver(elementIds: Iterable<string> = this.index.elements.keys()): Resolver {
    const imports = Object.keys(asRecord(plain(this.index.root.after).imports));
    return new Resolver(
      this.index.namespace,
      new Set(imports),
      new Set(elementIds),
      new Set(this.index.actors.keys()),
    );
  }

  /** An element's ID from a reference, as the model resolves it. */
  private elementId(ref: string): string {
    const r = this.resolver().element(ref);
    if (r.status === "resolved") return r.target.id;
    if (r.status === "ambiguous") {
      const shallowest = preferShallow(r.candidates);
      if (shallowest) return shallowest;
      throw new EditError(`"${ref}" could be ${r.candidates.join(", ")}. Give the full ID.`);
    }
    if (r.status === "external") {
      throw new EditError(
        `"${ref}" is in another repository (${r.target.namespace}); edit it there.`,
      );
    }
    throw new EditError(`No element "${ref}".${this.near(ref, this.index.elements.keys())}`);
  }

  private stripNamespace(id: string): string {
    const ns = this.index.namespace;
    return ns && id.startsWith(`${ns}.`) && !this.index.elements.has(id)
      ? id.slice(ns.length + 1)
      : id;
  }

  /** What an ID names, when the op doesn't say. */
  private find(id: string, type?: EditType): { type: EditType | "node"; id: string; site: Site } {
    const own = this.stripNamespace(id);
    const found: { type: EditType | "node"; id: string; site: Site }[] = [];
    const tryMap = (t: EditType | "node", map: Map<string, Site>, key = own) => {
      const site = map.get(key);
      if (site) found.push({ type: t, id: key, site });
    };
    if (!type || type === "element") {
      const r = this.resolver().element(id);
      if (r.status === "resolved") tryMap("element", this.index.elements, r.target.id);
      else if (r.status === "ambiguous" || type === "element") {
        tryMap("element", this.index.elements, this.elementId(id));
      }
    }
    if (!type || type === "actor") tryMap("actor", this.index.actors);
    if (!type || type === "journey") tryMap("journey", this.index.journeys);
    if (!type || type === "data") tryMap("data", this.index.data);
    if (!type || type === "environment") {
      tryMap("environment", this.index.environments);
      tryMap("node", this.index.nodes);
    }
    // A name that is exactly something beats an element it's only the end of.
    const exact = found.filter((f) => f.type !== "element" || f.id === own);
    if (exact.length && exact.length < found.length) found.splice(0, found.length, ...exact);
    if (found.length === 1) return found[0] as (typeof found)[number];
    if (found.length > 1) {
      throw new EditError(
        `"${id}" names ${found.map((f) => `${article(f.type)} ${f.type}`).join(" and ")}. Say which with type.`,
      );
    }
    const all = [
      ...this.index.elements.keys(),
      ...this.index.actors.keys(),
      ...this.index.journeys.keys(),
      ...this.index.data.keys(),
      ...this.index.environments.keys(),
      ...this.index.nodes.keys(),
    ];
    throw new EditError(
      `Nothing is called "${id}"${type ? ` (${type})` : ""}.${this.near(id, all)}`,
    );
  }

  private near(id: string, ids: Iterable<string>): string {
    const last = (id.split(".").pop() ?? id).toLowerCase();
    const close = [...ids].filter((x) => x.toLowerCase().includes(last)).slice(0, 5);
    return close.length ? ` Did you mean ${close.join(", ")}?` : " archdoc_find lists IDs.";
  }

  // ----------------------------------------------------------------- add

  private add(type: EditType, rawId: string, spec: Record<string, unknown>): string {
    const id = rawId.trim();
    if (!id) throw new EditError("Give an ID.");
    const value = { ...spec };
    if (this.options.by && value.provenance === undefined) {
      value.provenance = { source: "suggested", by: this.options.by };
    }
    switch (type) {
      case "element": {
        const own = this.stripNamespace(id);
        const dot = own.lastIndexOf(".");
        const key = dot === -1 ? own : own.slice(dot + 1);
        checkKey(key);
        const parent = dot === -1 ? undefined : this.elementId(own.slice(0, dot));
        const full = parent ? `${parent}.${key}` : key;
        if (this.index.elements.has(full))
          throw new EditError(`${full} already exists. Use set to change it.`);
        if (value.kind === undefined)
          value.kind = childKind(parent ? this.kindOf(parent) : undefined);
        const site = parent ? this.index.elements.get(parent) : this.sectionFile("elements");
        const file = (site as Site).file;
        const path = parent ? [...(site as Site).path, "elements"] : ["elements"];
        ensureMap(file.after, path).set(
          key,
          tidy(file.after.createNode(order(value, ELEMENT_ORDER))),
        );
        return `Added ${value.kind} ${full} in ${where(file, [...path, key])}${spec.kind === undefined ? ` (kind ${value.kind}: say kind to change it)` : ""}.`;
      }
      case "actor":
      case "data": {
        checkKey(id);
        const map = type === "actor" ? this.index.actors : this.index.data;
        if (map.has(id))
          throw new EditError(
            `${type === "actor" ? "Actor" : "Data entry"} ${id} already exists. Use set to change it.`,
          );
        const section = type === "actor" ? "actors" : "data";
        const file = this.sectionFile(section).file;
        ensureMap(file.after, [section]).set(
          id,
          tidy(file.after.createNode(order(value, type === "actor" ? ACTOR_ORDER : DATA_ORDER))),
        );
        return `Added ${type === "actor" ? "actor" : "data entry"} ${id} in ${where(file, [section, id])}.`;
      }
      case "journey": {
        checkKey(id);
        // Journeys don't carry provenance; the steps' code says where they come from.
        if (spec.provenance === undefined) delete value.provenance;
        if (this.index.journeys.has(id))
          throw new EditError(`Journey ${id} already exists. Use set or step to change it.`);
        const journey = order(value, JOURNEY_ORDER);
        const path = this.options.journeyFile?.(id);
        if (path && !this.files.some((f) => f.path === path && !f.removed)) {
          const doc = parseDocument("journeys: {}\n");
          const node = tidy(doc.createNode(journey)) as YAMLMap;
          flowSteps(node);
          const map = doc.get("journeys", true) as YAMLMap;
          map.flow = false;
          map.set(id, node);
          this.files.push({ path, text: "", before: doc, after: doc, created: true });
          return `Added journey ${id} in ${path} (new file).`;
        }
        const file = this.sectionFile("journeys").file;
        const node = tidy(file.after.createNode(journey)) as YAMLMap;
        flowSteps(node);
        ensureMap(file.after, ["journeys"]).set(id, node);
        return `Added journey ${id} in ${where(file, ["journeys", id])}.`;
      }
      case "environment": {
        const dot = id.indexOf(".");
        if (dot === -1) {
          checkKey(id);
          if (this.index.environments.has(id))
            throw new EditError(`Environment ${id} already exists.`);
          const file = this.sectionFile("environments").file;
          ensureMap(file.after, ["environments"]).set(id, file.after.createNode(value));
          return `Added environment ${id} in ${where(file, ["environments", id])}.`;
        }
        const parent = id.slice(0, id.lastIndexOf("."));
        const key = id.slice(id.lastIndexOf(".") + 1);
        checkKey(key);
        if (this.index.nodes.has(id)) throw new EditError(`Node ${id} already exists.`);
        const site = this.index.nodes.get(parent) ?? this.index.environments.get(parent);
        if (!site)
          throw new EditError(
            `No environment or node "${parent}" to add ${key} inside. Add it first.`,
          );
        delete value.provenance;
        if (spec.provenance) value.provenance = spec.provenance;
        if (value.kind === undefined)
          throw new EditError(
            "A deployment node needs a kind, such as cloud, cluster, or service.",
          );
        ensureMap(site.file.after, [...site.path, "nodes"]).set(
          key,
          site.file.after.createNode(value),
        );
        return `Added node ${id} in ${where(site.file, [...site.path, "nodes", key])}.`;
      }
      default:
        throw new EditError(
          `Can't add a ${type as string}. Add an element, actor, journey, data entry, or environment.`,
        );
    }
  }

  private kindOf(id: string): string | undefined {
    const site = this.index.elements.get(id);
    return site ? String(asRecord(plainAt(site)).kind ?? "") || undefined : undefined;
  }

  /** The file that already has this section, else the root file. */
  private sectionFile(section: string): Site {
    const live = this.files.filter((f) => !f.removed && !f.created);
    const has = live.filter((f) => isMap(f.after.get(section, true)));
    // Prefer a file that's mostly this section (data.yaml), then the root.
    const file =
      has.find((f) => f !== this.index.root && onlyKey(plain(f.after), section)) ??
      has.find((f) => f === this.index.root) ??
      has[0] ??
      this.index.root;
    return { file, path: [section] };
  }

  // ----------------------------------------------------------------- set

  private set(id: string, type: EditType | undefined, spec: Record<string, unknown>): string {
    if (!spec || typeof spec !== "object" || Array.isArray(spec))
      throw new EditError("spec is an object of fields to set.");
    const found = this.find(id, type);
    for (const key of ["elements", "nodes"]) {
      if (key in spec && found.type !== "journey" && found.type !== "data") {
        throw new EditError(`Add children with add, not set ${key}.`);
      }
    }
    const node = this.mapAt(found.site);
    const keys = {
      element: ELEMENT_ORDER,
      actor: ACTOR_ORDER,
      data: DATA_ORDER,
      journey: JOURNEY_ORDER,
    };
    mergePatch(found.site.file.after, node, spec, keys[found.type as keyof typeof keys]);
    tidy(node);
    if (found.type === "journey") flowSteps(node);
    const fields = Object.keys(spec);
    return `Set ${fields.join(", ")} on ${found.type} ${found.id} (${where(found.site.file, found.site.path)}).`;
  }

  private mapAt(site: Site): YAMLMap {
    const node = site.path.length
      ? site.file.after.getIn(site.path, true)
      : site.file.after.contents;
    if (isMap(node)) return node;
    // A bare key (`orders:` with nothing under it) becomes a map.
    const map = new YAMLMap();
    site.file.after.setIn(site.path, map);
    return map;
  }

  // -------------------------------------------------------------- remove

  private remove(id: string, type: EditType | undefined): string {
    const found = this.find(id, type);
    const { file, path } = found.site;
    const extra: string[] = [];
    if (found.type === "element") {
      const gone = (x: string) => x === found.id || x.startsWith(`${found.id}.`);
      const steps = this.stepsReferring((ref) => {
        const r = this.resolver().endpoint(ref);
        return r.status === "resolved" && r.target.type === "element" && gone(r.target.id);
      });
      if (steps.length) {
        throw new EditError(
          `Journey steps go through it: ${steps.slice(0, 8).join(", ")}${steps.length > 8 ? `, and ${steps.length - 8} more` : ""}. Change or remove those steps in the same edit, before this one.`,
        );
      }
      const removed = this.dropUses((target) => gone(target));
      if (removed) extra.push(`, and ${removed} use${removed === 1 ? "" : "s"} of it`);
    }
    if (found.type === "journey" && (found.site as Site & { own?: boolean }).own) {
      file.removed = true;
      return `Removed journey ${found.id} and its file ${file.path}.`;
    }
    if (found.type === "element") {
      const inside = [...this.index.elements.keys()].filter((x) =>
        x.startsWith(`${found.id}.`),
      ).length;
      if (inside) extra.unshift(` with the ${inside} element${inside === 1 ? "" : "s"} inside it`);
    }
    deletePath(file.after, path);
    return `Removed ${found.type} ${found.id}${extra.join("")}.`;
  }

  /** Removes uses whose target matches; returns how many. */
  private dropUses(match: (elementId: string) => boolean): number {
    let n = 0;
    for (const site of this.useSites()) {
      if (site.target && match(site.target)) {
        site.map.delete(site.key);
        n++;
      }
    }
    return n;
  }

  /** Every `uses` entry, with the element it resolves to now. */
  private useSites(): UseSite[] {
    const resolver = this.resolver();
    const out: UseSite[] = [];
    const visit = (owner: string, scope: string | undefined, site: Site, actor: boolean) => {
      const uses = site.file.after.getIn([...site.path, "uses"], true);
      if (!isMap(uses)) return;
      for (const p of uses.items) {
        const key = keyOf(p);
        const r = actor ? resolver.element(key) : resolver.element(key, scope);
        out.push({
          owner,
          actor,
          map: uses,
          key,
          target: r.status === "resolved" ? r.target.id : undefined,
        });
      }
    };
    for (const [id, site] of this.index.elements) visit(id, parentOf(id), site, false);
    for (const [id, site] of this.index.actors) visit(id, undefined, site, true);
    return out;
  }

  /** Steps (journey#n) with an endpoint that matches. */
  private stepsReferring(match: (ref: string) => boolean): string[] {
    const out: string[] = [];
    for (const [id, site] of this.index.journeys) {
      const steps = asArray(asRecord(plainAt(site)).steps);
      for (const [i, s] of steps.entries()) {
        const step = asRecord(s);
        if ([step.from, step.to].some((r) => typeof r === "string" && match(r)))
          out.push(`${id}#${i + 1}`);
      }
    }
    return out;
  }

  // -------------------------------------------------------------- rename

  private rename(id: string, to: string, type: EditType | undefined): string {
    const found = this.find(id, type);
    const target = to.trim();
    if (!target) throw new EditError("Give the new ID in to.");
    switch (found.type) {
      case "element":
        return this.moveElement(found.id, target);
      case "actor":
        return this.renameActor(found.id, target);
      case "data":
        return this.renameData(found.id, target);
      case "journey":
        return this.renameJourney(found.id, target);
      default:
        throw new EditError(
          "Rename elements, actors, data entries, and journeys. Remove and add an environment instead.",
        );
    }
  }

  private moveElement(from: string, to: string): string {
    const own = this.stripNamespace(to);
    let parent: string | undefined;
    let key: string;
    const absolute =
      this.index.namespace && to.startsWith(`${this.index.namespace}.`) && !own.includes(".");
    if (!own.includes(".") && !absolute) {
      parent = parentOf(from);
      key = own;
    } else {
      const dot = own.lastIndexOf(".");
      key = dot === -1 ? own : own.slice(dot + 1);
      parent = dot === -1 ? undefined : this.elementId(own.slice(0, dot));
    }
    checkKey(key);
    const next = parent ? `${parent}.${key}` : key;
    if (next === from) throw new EditError(`It's already ${from}.`);
    if (parent === from || parent?.startsWith(`${from}.`))
      throw new EditError(`Can't move ${from} inside itself.`);
    if (this.index.elements.has(next)) throw new EditError(`${next} already exists.`);

    const map = (x: string) =>
      x === from ? next : x.startsWith(`${from}.`) ? next + x.slice(from.length) : x;
    const oldIds = [...this.index.elements.keys()];
    const newIds = oldIds.map(map);
    const after = this.resolver(newIds);
    let rewritten = 0;

    // References first, at their old places; then the element moves.
    for (const site of this.useSites()) {
      if (!site.target) continue;
      const want = map(site.target);
      const scope = site.actor ? undefined : parentOf(map(site.owner));
      const now = after.element(site.key, scope);
      if (now.status === "resolved" && now.target.id === want) continue;
      renameKey(
        site.map,
        site.key,
        rewriteRef(site.key, site.target, want, after, scope, this.index.namespace),
      );
      rewritten++;
    }
    rewritten += this.rewriteSteps((ref) => {
      const r = this.resolver().endpoint(ref);
      if (r.status !== "resolved" || r.target.type !== "element") return undefined;
      const want = map(r.target.id);
      const now = after.endpoint(ref);
      if (now.status === "resolved" && now.target.id === want) return undefined;
      return rewriteRef(ref, r.target.id, want, after, undefined, this.index.namespace);
    });
    rewritten += this.rewriteLists(
      ["elements"],
      (v) => {
        const r = this.resolver().element(v);
        return r.status === "resolved" && map(r.target.id) !== r.target.id
          ? map(r.target.id)
          : undefined;
      },
      ["domains"],
    );

    const site = this.index.elements.get(from) as Site;
    if (parent === parentOf(from)) {
      renameKey(
        site.file.after.getIn(site.path.slice(0, -1), true) as YAMLMap,
        String(site.path.at(-1)),
        key,
      );
      this.renamed.set(from, next);
      return `Renamed element ${from} to ${next}${rewritten ? `, and ${rewritten} reference${rewritten === 1 ? "" : "s"} to it` : ""}.`;
    }
    const node = site.file.after.getIn(site.path, true) as Node;
    const target = parent
      ? (this.index.elements.get(parent) as Site)
      : this.sectionFile("elements");
    const targetPath = parent ? [...target.path, "elements"] : ["elements"];
    const moved = (node as Node).clone();
    deletePath(site.file.after, site.path);
    ensureMap(target.file.after, targetPath).set(key, moved);
    this.renamed.set(from, next);
    return `Renamed element ${from} to ${next}${rewritten ? `, and ${rewritten} reference${rewritten === 1 ? "" : "s"} to it` : ""}.`;
  }

  private renameActor(from: string, to: string): string {
    checkKey(to);
    if (this.index.actors.has(to)) throw new EditError(`Actor ${to} already exists.`);
    const fix = (v: string) =>
      v === from || v === `${this.index.namespace}.${from}` ? to : undefined;
    let n = this.rewriteSteps(fix);
    for (const [, site] of this.index.journeys)
      n += setIfString(site.file.after, [...site.path, "actor"], fix);
    n += this.rewriteLists(["owners"], fix);
    const site = this.index.actors.get(from) as Site;
    renameKey(site.file.after.getIn(["actors"], true) as YAMLMap, from, to);
    this.renamed.set(from, to);
    return `Renamed actor ${from} to ${to}${n ? `, and ${n} reference${n === 1 ? "" : "s"} to it` : ""}.`;
  }

  private renameData(from: string, to: string): string {
    checkKey(to);
    if (this.index.data.has(to)) throw new EditError(`Data entry ${to} already exists.`);
    const fix = (v: string): string | undefined => {
      for (const prefix of [from, `${this.index.namespace}.${from}`]) {
        if (v === prefix) return to;
        if (v.startsWith(`${prefix}.`)) return to + v.slice(prefix.length);
        if (v === `${prefix}[]`) return `${to}[]`;
      }
      return undefined;
    };
    let n = 0;
    // Steps: sends, creates (a name, names, or a map by name), changes (Entry.field keys).
    for (const [, site] of this.index.journeys) {
      const steps = site.file.after.getIn([...site.path, "steps"], true);
      if (!isSeq(steps)) continue;
      for (const step of steps.items) {
        if (!isMap(step)) continue;
        n +=
          fixValues(step, "sends", fix) +
          fixValues(step, "creates", fix) +
          fixKeys(step, "creates", fix) +
          fixKeys(step, "changes", fix);
        const branches = step.get("branches", true);
        if (isMap(branches)) {
          for (const b of branches.items) {
            if (isMap(b.value))
              n +=
                fixValues(b.value, "creates", fix) +
                fixKeys(b.value, "creates", fix) +
                fixKeys(b.value, "changes", fix);
          }
        }
      }
    }
    // Uses' sends, stores' entities, and provides' contracts.
    for (const [, site] of [...this.index.elements, ...this.index.actors]) {
      const spec = site.file.after.getIn(site.path, true);
      if (!isMap(spec)) continue;
      const uses = spec.get("uses", true);
      if (isMap(uses))
        for (const u of uses.items) if (isMap(u.value)) n += fixValues(u.value, "sends", fix);
      const stores = spec.get("stores", true);
      if (isMap(stores))
        for (const s of stores.items) if (isMap(s.value)) n += fixValues(s.value, "entity", fix);
      const provides = spec.get("provides", true);
      if (isSeq(provides)) {
        for (const p of provides.items) {
          if (isMap(p))
            for (const k of ["accepts", "returns", "carries"]) n += fixValues(p, k, fix);
        }
      }
    }
    // Other entries' fields: a type or a reference that names it.
    for (const [, site] of this.index.data) {
      const fields = site.file.after.getIn([...site.path, "fields"], true);
      if (!isMap(fields)) continue;
      for (const f of fields.items)
        if (isMap(f.value))
          n += fixValues(f.value, "type", fix) + fixValues(f.value, "references", fix);
    }
    // Mappings and logic name their inputs' entries.
    for (const file of this.files.filter((f) => !f.removed)) {
      for (const section of ["mappings", "logic"]) {
        const map = file.after.get(section, true);
        if (!isMap(map)) continue;
        for (const m of map.items) {
          if (!isMap(m.value)) continue;
          for (const k of ["from", "input"]) {
            const inputs = m.value.get(k, true);
            if (isMap(inputs)) for (const i of inputs.items) n += fixScalar(i, fix);
          }
          n += fixValues(m.value, "to", fix);
        }
      }
    }
    const site = this.index.data.get(from) as Site;
    renameKey(site.file.after.getIn(["data"], true) as YAMLMap, from, to);
    this.renamed.set(from, to);
    return `Renamed data entry ${from} to ${to}${n ? `, and ${n} reference${n === 1 ? "" : "s"} to it` : ""}.`;
  }

  private renameJourney(from: string, to: string): string {
    checkKey(to);
    if (this.index.journeys.has(to)) throw new EditError(`Journey ${to} already exists.`);
    const site = this.index.journeys.get(from) as Site & { own: boolean };
    let n = 0;
    for (const [, s] of this.index.journeys) {
      const steps = s.file.after.getIn([...s.path, "steps"], true);
      if (!isSeq(steps)) continue;
      for (const step of steps.items) {
        const branches = isMap(step) ? step.get("branches", true) : undefined;
        if (isMap(branches)) {
          for (const b of branches.items) {
            if (isMap(b.value))
              n += fixValues(b.value, "next", (v) => (v === from ? to : undefined));
          }
        }
      }
    }
    if (site.path.length === 0) {
      (site.file.after.contents as YAMLMap).set("journey", to);
    } else {
      renameKey(site.file.after.getIn(["journeys"], true) as YAMLMap, from, to);
    }
    // A journey in its own file named for it moves to a file named for the new ID.
    const newPath = this.options.journeyFile?.(to);
    const base = site.file.path.replace(/\\/g, "/").split("/").pop();
    if (
      site.own &&
      newPath &&
      base?.replace(/\.ya?ml$/, "") === from &&
      !this.files.some((f) => f.path === newPath)
    ) {
      const { text, before, after } = site.file;
      this.files.push({ path: newPath, text, before, after, created: true });
      site.file.removed = true;
    }
    this.renamed.set(from, to);
    return `Renamed journey ${from} to ${to}${n ? `, and ${n} reference${n === 1 ? "" : "s"} to it` : ""}. Traces that expand it still name ${from}.`;
  }

  /** Rewrites journey step endpoints; returns how many changed. */
  private rewriteSteps(fix: (ref: string) => string | undefined): number {
    let n = 0;
    for (const [, site] of this.index.journeys) {
      const steps = site.file.after.getIn([...site.path, "steps"], true);
      if (!isSeq(steps)) continue;
      for (const step of steps.items) {
        if (!isMap(step)) continue;
        for (const k of ["from", "to"]) n += fixValues(step, k, fix);
      }
    }
    return n;
  }

  /** Rewrites strings in lists under these keys anywhere in the model (owners, domains' elements). */
  private rewriteLists(
    keys: string[],
    fix: (v: string) => string | undefined,
    sections?: string[],
  ): number {
    let n = 0;
    const visit = (node: unknown, depth: number, section: string | undefined) => {
      if (isMap(node)) {
        for (const p of node.items) {
          const k = keyOf(p);
          const s = depth === 0 ? k : section;
          if (keys.includes(k) && (!sections || (s && sections.includes(s))) && isSeq(p.value)) {
            for (const item of p.value.items) n += fixScalarNode(item, fix);
          } else visit(p.value, depth + 1, s);
        }
      } else if (isSeq(node)) for (const i of node.items) visit(i, depth + 1, section);
    };
    for (const f of this.files.filter((x) => !x.removed)) visit(f.after.contents, 0, undefined);
    return n;
  }

  // ----------------------------------------------------------------- use

  private use(
    fromRef: string,
    toRef: string,
    spec: string | Record<string, unknown> | undefined,
    remove: boolean | undefined,
  ): string {
    const own = this.stripNamespace(fromRef);
    const actor = this.index.elements.has(own) ? undefined : this.index.actors.get(own);
    const isActor = actor !== undefined;
    const fromId = isActor ? own : this.elementId(fromRef);
    const site = (actor ?? this.index.elements.get(fromId)) as Site;
    const scope = isActor ? undefined : parentOf(fromId);
    const resolver = this.resolver();
    const r = resolver.element(toRef, scope);
    let key: string;
    let target: string;
    if (r.status === "resolved") {
      target = r.target.id;
      key = shortestRef(resolver, target, scope, this.index.namespace);
    } else if (r.status === "external") {
      target = r.target.ref;
      key = toRef;
    } else {
      target = this.elementId(toRef);
      key = shortestRef(resolver, target, scope, this.index.namespace);
    }
    if (target === fromId) throw new EditError("An element can't use itself.");
    const usesPath = [...site.path, "uses"];
    const uses = site.file.after.getIn(usesPath, true);
    const existing = isMap(uses)
      ? uses.items.find((p) => {
          const k = keyOf(p);
          const x = resolver.element(k, scope);
          return (
            k === key ||
            (x.status === "resolved" && x.target.id === target) ||
            (x.status === "external" && x.target.ref === target)
          );
        })
      : undefined;
    const label = `${fromId} -> ${target}`;
    if (remove) {
      if (!existing || !isMap(uses)) throw new EditError(`${fromId} doesn't use ${target}.`);
      uses.delete(existing.key);
      if (!uses.items.length) deletePath(site.file.after, usesPath);
      return `Removed the use ${label}.`;
    }
    const value: Record<string, unknown> =
      typeof spec === "string" ? { description: spec } : { ...(spec ?? {}) };
    if (existing && isMap(uses)) {
      if (!Object.keys(value).length) return `${label} is already there.`;
      const current = existing.value;
      if (isMap(current)) {
        mergePatch(site.file.after, current, value, USE_ORDER);
        tidy(current);
      } else {
        const base =
          isScalar(current) && typeof current.value === "string"
            ? { description: current.value }
            : {};
        existing.value = site.file.after.createNode(dropNulls({ ...base, ...value }));
      }
      return `Updated the use ${label}.`;
    }
    if (this.options.by && value.provenance === undefined)
      value.provenance = { source: "suggested", by: this.options.by };
    ensureMap(site.file.after, usesPath).set(
      key,
      tidy(site.file.after.createNode(order(value, USE_ORDER))),
    );
    return `Added the use ${label}${key !== target ? ` (as ${key})` : ""}.`;
  }

  // ---------------------------------------------------------------- step

  private step(op: Extract<EditOp, { op: "step" }>): string {
    const { site, id } = this.find(op.journey, "journey");
    const steps = site.file.after.getIn([...site.path, "steps"], true);
    const doc = site.file.after;
    const count = isSeq(steps) ? steps.items.length : 0;
    const at = op.at;
    if (at !== undefined && (!Number.isInteger(at) || at < 1 || at > count + (op.insert ? 1 : 0))) {
      throw new EditError(
        `${id} has ${count} step${count === 1 ? "" : "s"}; at is 1 to ${count + (op.insert ? 1 : 0)}.`,
      );
    }
    const flow = isSeq(steps)
      ? steps.items.some((s) => isMap(s) && s.flow) || !steps.items.length
      : true;
    const make = (spec: Record<string, unknown>) => {
      const node = doc.createNode(order(spec, STEP_ORDER)) as YAMLMap;
      node.flow = flow;
      return node;
    };
    if (op.remove) {
      if (at === undefined || !isSeq(steps))
        throw new EditError("Say which step to remove with at.");
      steps.items.splice(at - 1, 1);
      return `Removed step ${at} of ${id}; ${count - 1} left.`;
    }
    if (!op.spec) throw new EditError("Give the step's fields in spec.");
    if (at === undefined || op.insert) {
      if (typeof op.spec.from !== "string" || typeof op.spec.to !== "string") {
        throw new EditError("A new step needs from and to.");
      }
      const seq = isSeq(steps) ? steps : (ensureSeq(doc, [...site.path, "steps"]) as YAMLSeq);
      const i = at === undefined ? seq.items.length : at - 1;
      seq.items.splice(i, 0, make(op.spec));
      return `Added step ${i + 1} to ${id}: ${op.spec.from} -> ${op.spec.to}.`;
    }
    const step = (steps as YAMLSeq).items[at - 1];
    if (!isMap(step)) throw new EditError(`Step ${at} of ${id} isn't a map.`);
    mergePatch(doc, step, op.spec, STEP_ORDER);
    return `Set ${Object.keys(op.spec).join(", ")} on step ${at} of ${id}.`;
  }
}

// ------------------------------------------------------------------ helpers

const ELEMENT_ORDER = [
  "kind",
  "name",
  "technology",
  "description",
  "code",
  "owners",
  "tags",
  "status",
  "deploy",
  "stores",
  "provides",
  "uses",
  "elements",
  "provenance",
];
const ACTOR_ORDER = ["kind", "name", "description", "uses", "provenance"];
const DATA_ORDER = ["kind", "name", "description", "source", "fields", "provenance"];
const JOURNEY_ORDER = ["name", "actor", "goal", "description", "importance", "steps"];
const STEP_ORDER = ["from", "to", "action", "code", "sends", "creates", "changes", "description"];
const USE_ORDER = ["description", "sends", "technology", "transport", "provenance"];

/** The keys in the order a person reads them, then the rest as given. */
function order(value: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (value[k] !== undefined && value[k] !== null) out[k] = value[k];
  for (const [k, v] of Object.entries(value))
    if (!(k in out) && v !== undefined && v !== null) out[k] = v;
  return out;
}

/** Of elements a reference could name, the one nearest the top, when only one is. */
function preferShallow(candidates: string[]): string | undefined {
  const depth = (id: string) => id.split(".").length;
  const min = Math.min(...candidates.map(depth));
  const top = candidates.filter((c) => depth(c) === min);
  return top.length === 1 ? top[0] : undefined;
}

function childKind(parent: string | undefined): string {
  switch (parent) {
    case "system":
      return "container";
    case "container":
      return "component";
    case "component":
    case "code":
      return "code";
    default:
      return "container";
  }
}

function checkKey(key: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(key)) {
    throw new EditError(
      `"${key}" isn't a valid key: letters, digits, - and _, with no dots or spaces.`,
    );
  }
}

/** JSON merge patch onto a YAML map: null removes, maps merge, everything else replaces. */
function mergePatch(
  doc: Document,
  map: YAMLMap,
  patch: Record<string, unknown>,
  keys: string[] = [],
): void {
  for (const [k, v] of Object.entries(patch)) {
    if (v === null || v === undefined) {
      map.delete(k);
      continue;
    }
    const current = map.get(k, true);
    if (isPlainObject(v) && isMap(current)) {
      mergePatch(doc, current, v);
      continue;
    }
    const node = doc.createNode(isPlainObject(v) ? dropNulls(v) : v) as Node;
    // Keep a flow list or map flow, as written.
    if ((isMap(current) || isSeq(current)) && current.flow && (isMap(node) || isSeq(node)))
      node.flow = true;
    if (
      isScalar(current) &&
      isScalar(node) &&
      current.type &&
      typeof node.value === "string" &&
      !node.value.includes("\n")
    ) {
      // Keep plain or quoted style for one-line strings.
      if (current.type === "QUOTE_DOUBLE" || current.type === "QUOTE_SINGLE")
        node.type = current.type;
    }
    if (map.has(k) || !keys.includes(k)) {
      map.set(k, node);
      continue;
    }
    // A new key goes where a person would put it: before the first key that reads after it.
    const later = keys.slice(keys.indexOf(k) + 1);
    const at = map.items.findIndex((p) => later.includes(keyOf(p)));
    const pair = doc.createPair(k, node);
    if (at === -1) map.items.push(pair);
    else map.items.splice(at, 0, pair);
  }
}

/**
 * New parts written the way the skill shows them: provenance and data
 * fields on one line each. Only touches what an edit made.
 */
function tidy<T>(node: T): T {
  const visit = (n: unknown, key: string | undefined, parent: string | undefined) => {
    if (isMap(n)) {
      if (
        !n.range &&
        (key === "provenance" || parent === "fields") &&
        n.items.every((p) => !isMap(p.value))
      ) {
        n.flow = true;
      }
      for (const p of n.items) visit(p.value, keyOf(p), key);
    } else if (isSeq(n)) {
      for (const i of n.items) visit(i, undefined, key);
    }
  };
  visit(node, undefined, undefined);
  return node;
}

function dropNulls(v: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v)) {
    if (x === null || x === undefined) continue;
    out[k] = isPlainObject(x) ? dropNulls(x) : x;
  }
  return out;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The map at a path, made if it's missing or empty. */
function ensureMap(doc: Document, path: (string | number)[]): YAMLMap {
  const node = doc.getIn(path, true);
  if (isMap(node)) {
    if (!node.items.length) node.flow = false;
    return node;
  }
  if (path.length === 0 || doc.contents === null) {
    const map = new YAMLMap();
    doc.contents = map;
    return map;
  }
  const map = new YAMLMap();
  doc.setIn(path, map);
  return map;
}

function ensureSeq(doc: Document, path: (string | number)[]): YAMLSeq {
  const node = doc.getIn(path, true);
  if (isSeq(node)) return node;
  const seq = doc.createNode([]) as YAMLSeq;
  doc.setIn(path, seq);
  return seq;
}

/** Deletes a key, and the maps above it that it leaves empty (elements:, nodes:, uses:). */
function deletePath(doc: Document, path: (string | number)[]): void {
  doc.deleteIn(path);
  for (let i = path.length - 1; i > 0; i--) {
    const up = path.slice(0, i);
    const node = doc.getIn(up, true);
    const key = up[up.length - 1];
    if (
      isMap(node) &&
      !node.items.length &&
      (key === "elements" || key === "nodes" || key === "uses")
    ) {
      doc.deleteIn(up);
    } else break;
  }
}

/** Journey steps written as one-line maps, the way the skill shows them. */
function flowSteps(journey: YAMLMap): void {
  const steps = journey.get("steps", true);
  if (!isSeq(steps)) return;
  const flow =
    steps.items.some((s) => isMap(s) && s.flow) || steps.items.every((s) => isMap(s) && !s.range);
  for (const s of steps.items) {
    if (isMap(s) && !s.range && flow) s.flow = true;
  }
}

function renameKey(map: YAMLMap, from: string, to: string): void {
  const pair = map.items.find((p) => keyOf(p) === from);
  if (!pair) return;
  if (isScalar(pair.key)) (pair.key as Scalar).value = to;
  else pair.key = to;
}

function fixValues(map: YAMLMap, key: string, fix: (v: string) => string | undefined): number {
  const v: unknown = map.get(key, true);
  if (isScalar(v)) return fixScalarNode(v, fix);
  if (isSeq(v)) return v.items.reduce<number>((n, i) => n + fixScalarNode(i, fix), 0);
  return 0;
}

function fixKeys(map: YAMLMap, key: string, fix: (v: string) => string | undefined): number {
  const v = map.get(key, true);
  if (!isMap(v)) return 0;
  let n = 0;
  for (const p of v.items) {
    const next = fix(keyOf(p));
    if (next !== undefined) {
      renameKey(v, keyOf(p), next);
      n++;
    }
  }
  return n;
}

function fixScalar(pair: Pair, fix: (v: string) => string | undefined): number {
  return fixScalarNode(pair.value, fix);
}

function fixScalarNode(node: unknown, fix: (v: string) => string | undefined): number {
  if (!isScalar(node) || typeof node.value !== "string") return 0;
  const next = fix(node.value);
  if (next === undefined || next === node.value) return 0;
  node.value = next;
  return 1;
}

function setIfString(
  doc: Document,
  path: (string | number)[],
  fix: (v: string) => string | undefined,
): number {
  if (!path.length) return 0;
  const node = doc.getIn(path, true);
  return fixScalarNode(node, fix);
}

/**
 * A reference to a renamed element, written the way the old one was: a full
 * ID stays full, a namespaced one stays namespaced, and a short one stays as
 * short as still resolves.
 */
function rewriteRef(
  old: string,
  oldTarget: string,
  target: string,
  resolver: Resolver,
  scope: string | undefined,
  namespace: string,
): string {
  const resolves = (ref: string) => {
    const r = resolver.element(ref, scope);
    return r.status === "resolved" && r.target.id === target;
  };
  if (namespace && old === `${namespace}.${oldTarget}`) return `${namespace}.${target}`;
  const segments = old.split(".").length;
  const same = target.split(".").slice(-segments).join(".");
  if (old === oldTarget && resolves(target)) return target;
  if (resolves(same)) return same;
  return shortestRef(resolver, target, scope, namespace);
}

/** The shortest reference that resolves to `id` from `scope`, as a person would write it. */
function shortestRef(
  resolver: Resolver,
  id: string,
  scope: string | undefined,
  namespace: string,
): string {
  const parts = id.split(".");
  for (let i = parts.length - 1; i >= 0; i--) {
    const ref = parts.slice(i).join(".");
    const r = resolver.element(ref, scope);
    if (r.status === "resolved" && r.target.id === id) return ref;
  }
  return namespace ? `${namespace}.${id}` : id;
}

function keyOf(p: Pair): string {
  return String(isScalar(p.key) ? p.key.value : p.key);
}

function parentOf(id: string): string | undefined {
  const dot = id.lastIndexOf(".");
  return dot === -1 ? undefined : id.slice(0, dot);
}

function plain(doc: Document): Record<string, unknown> {
  return asRecord(doc.toJS());
}

function plainAt(site: Site): unknown {
  const node = site.path.length ? site.file.after.getIn(site.path) : site.file.after.toJS();
  return node && typeof node === "object" && "toJSON" in node
    ? (node as { toJSON(): unknown }).toJSON()
    : node;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function onlyKey(value: Record<string, unknown>, key: string): boolean {
  const keys = Object.keys(value).filter((k) => k !== "$schema" && k !== "archdoc");
  return keys.length === 1 && keys[0] === key;
}

function article(type: string): string {
  return /^[aeiou]/.test(type) ? "an" : "a";
}

/** A place in a file, for the answer: file and the path inside it. */
function where(file: FileState, _path: (string | number)[]): string {
  return file.path;
}
