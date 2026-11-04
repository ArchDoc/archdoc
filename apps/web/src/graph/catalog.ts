import {
  DataRegistry,
  dataFlows,
  dataStores,
  type FieldReference,
  fieldReferences,
  type Model,
  qualifyData,
  type Target,
} from "@archdoc/core/browser";
import { journeyInteractions, stepData } from "./data.js";

/** One way an entry moves: a step or a use that sends it, or a step that writes it. */
export interface EntryMove {
  from: Target;
  to: Target;
  /** writes: a step creates or changes it; the rest are the data flow's kinds. */
  how: "writes" | "sends" | "accepts" | "returns" | "carries" | "step";
  /** The contract it goes through. */
  via?: string | undefined;
}

/** A journey step that sends or writes an entry, to open the journey there. */
export interface EntryStep {
  journey: string;
  /** The interaction to open the journey at. */
  at: number;
  /** As the explorer numbers it, such as "3" or "3.1". */
  label: string;
  action?: string | undefined;
  how: "sends" | "writes";
}

/** Everything the model says about one data entry, beyond its own fields. */
export interface EntrySheet {
  /** Qualified, such as payments.Refund. */
  entry: string;
  /** Tables or collections it's stored in. */
  stores: { element: string; namespace: string; table: string; key?: string | undefined }[];
  /** Field names that are a store's key. */
  keys: Set<string>;
  /** Who makes it and who receives it, one line per pair and way. */
  moves: EntryMove[];
  /** The journey steps that send or write it. */
  steps: EntryStep[];
  /** Its fields that point at other entries, and other entries' fields that point at it. */
  refersTo: FieldReference[];
  referredBy: FieldReference[];
}

const keyOf = (t: Target) => (t.type === "external" ? `x:${t.ref}` : `${t.type}:${t.id}`);

/** What the model says about an entry: where it's stored, who makes and gets it, and its journeys. */
export function entrySheet(model: Model, entry: string): EntrySheet {
  const registry = new DataRegistry(model);
  const ns = model.namespace;
  const same = (data: string, at = ns) => qualifyData(data, at) === entry;
  const stored = registry.storedIn(entry);
  const stores = stored.map((s) => {
    const el = registry.models.get(s.namespace)?.elements.get(s.element);
    return {
      element: s.element,
      namespace: s.namespace,
      table: s.table,
      key: el?.spec.stores?.[s.table]?.key,
    };
  });
  const keys = new Set(stores.flatMap((s) => (s.key ? [s.key] : [])));

  const moves: EntryMove[] = [];
  const seen = new Set<string>();
  const add = (m: EntryMove) => {
    const k = `${keyOf(m.from)}>${keyOf(m.to)}>${m.how === "step" ? "sends" : m.how}`;
    if (seen.has(k)) return;
    seen.add(k);
    moves.push(m);
  };
  for (const f of dataFlows(model)) {
    if (same(f.data)) add({ from: f.from, to: f.to, how: f.how, via: f.via });
  }

  const steps: EntryStep[] = [];
  for (const j of model.journeys.values()) {
    const interactions = journeyInteractions(model, j);
    interactions.forEach((x, at) => {
      const d = stepData(model, j, x.step);
      const writes = x.writes.includes(entry);
      const sends = !x.store && (d.message?.entries ?? []).some((e) => e.entry === entry);
      if (!writes && !sends) return;
      steps.push({
        journey: j.id,
        at,
        label: x.label,
        action: x.action,
        how: writes ? "writes" : "sends",
      });
      if (writes) add({ from: x.from, to: x.to, how: "writes" });
    });
  }

  const refs = fieldReferences(model, registry);
  return {
    entry,
    stores,
    keys,
    moves,
    steps,
    refersTo: refs.filter((r) => r.entry === entry && r.to.entry !== entry),
    referredBy: refs.filter((r) => r.to.entry === entry && r.entry !== entry),
  };
}

/** A datastore or queue, with what it holds and who reaches it. */
export interface StoreCard {
  id: string;
  name: string;
  kind: "datastore" | "queue";
  technology?: string | undefined;
  description?: string | undefined;
  /** Its tables or collections, each with the entry it holds. */
  tables: {
    table: string;
    /** Qualified. */
    entry: string;
    key?: string | undefined;
    /** How many fields the entry has; undefined when it has none to show. */
    fields?: number | undefined;
    /** The entry has a schema source the fields come from. */
    sourced: boolean;
  }[];
  /** For a queue: the messages sent through it. */
  carries: string[];
  /** Who writes to it (a journey step creates or changes something there). */
  writers: Target[];
  /** Everything with a use of it, and what the use says. */
  users: { from: Target; description?: string | undefined }[];
}

/** The model's datastores and queues, in the order the model declares them. */
export function storeCards(model: Model): StoreCard[] {
  const registry = new DataRegistry(model);
  const ns = model.namespace;
  const flows = dataFlows(model);
  const stores = dataStores(model);
  const writers = new Map<string, Map<string, Target>>();
  for (const j of model.journeys.values()) {
    for (const x of journeyInteractions(model, j)) {
      if (x.to.type !== "element" || !x.writes.length) continue;
      const m = writers.get(x.to.id) ?? new Map<string, Target>();
      m.set(keyOf(x.from), x.from);
      writers.set(x.to.id, m);
    }
  }
  const inside = (id: string, el: string) => id === el || id.startsWith(`${el}.`);
  const out: StoreCard[] = [];
  for (const el of model.elements.values()) {
    const kind = el.spec.kind;
    if (kind !== "datastore" && kind !== "queue") continue;
    const tables = stores
      .filter((s) => s.element === el.id)
      .map((s) => {
        const entry = qualifyData(s.data, ns);
        const node = registry.entry(entry)?.node;
        const n = Object.keys(node?.spec.fields ?? {}).length;
        return {
          table: s.table,
          entry,
          key: el.spec.stores?.[s.table]?.key,
          fields: n || undefined,
          sourced: !!node?.spec.source,
        };
      });
    const carries = [
      ...new Set(
        flows
          .filter((f) => [f.from, f.to].some((t) => t.type === "element" && inside(t.id, el.id)))
          .map((f) => qualifyData(f.data, ns)),
      ),
    ].filter((e) => !tables.some((t) => t.entry === e));
    const users = model.relationships
      .filter((r) => r.to.type === "element" && inside(r.to.id, el.id))
      .map((r) => ({ from: r.from as Target, description: r.description }));
    out.push({
      id: el.id,
      name: el.spec.name ?? el.key,
      kind,
      technology: el.spec.technology,
      description: el.spec.description,
      tables,
      carries,
      writers: [...(writers.get(el.id)?.values() ?? [])],
      users,
    });
  }
  return out;
}

/** Entries no datastore holds: the requests, responses, and messages that travel between parts. */
export function travellingEntries(model: Model): {
  entry: string;
  kind: string;
  description?: string | undefined;
  fields: number;
  sourced: boolean;
  moves: EntryMove[];
}[] {
  const ns = model.namespace;
  const stored = new Set(dataStores(model).map((s) => qualifyData(s.data, ns)));
  const flows = dataFlows(model);
  return [...model.data.values()]
    .filter((d) => !stored.has(`${ns}.${d.id}`))
    .map((d) => {
      const entry = `${ns}.${d.id}`;
      const seen = new Set<string>();
      const moves: EntryMove[] = [];
      for (const f of flows) {
        if (qualifyData(f.data, ns) !== entry) continue;
        const k = `${keyOf(f.from)}>${keyOf(f.to)}`;
        if (seen.has(k)) continue;
        seen.add(k);
        moves.push({ from: f.from, to: f.to, how: f.how, via: f.via });
      }
      return {
        entry,
        kind: d.spec.kind,
        description: d.spec.description,
        fields: Object.keys(d.spec.fields ?? {}).length,
        sourced: !!d.spec.source,
        moves,
      };
    });
}
