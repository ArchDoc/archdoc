import type {
  PlanChangeSpec,
  PlanNoteKind,
  PlanNoteSpec,
  PlanSequenceSpec,
  PlanStatus,
  PlanStepSpec,
  PlanTaskSpec,
  PlanUnreadSpec,
} from "@archdoc/spec";
import { type Document, isMap, isSeq, type YAMLMap, type YAMLSeq } from "yaml";
import { formatDiagnostic } from "../diagnostics.js";
import { parseForEdit, patchYaml } from "../edit/patch.js";
import { type Plan, parsePlan } from "./plan.js";

/** A list of items in a plan. */
export type PlanList = "changes" | "sequences" | "notes" | "tasks";

/**
 * One change to a plan file, by item ID, as the explorer and the agent make
 * them. Every op changes only its own lines.
 */
export type PlanEditOp =
  /** Adds an item, or replaces the one with its ID. Without an ID, it gets the next free one (c3, s2, n4, t1). */
  | {
      op: "put";
      list: PlanList;
      item: Partial<PlanChangeSpec | PlanSequenceSpec | PlanNoteSpec | PlanTaskSpec> &
        Record<string, unknown>;
    }
  /** Removes an item, or a step (s1#2). */
  | { op: "drop"; id: string }
  /** Adds a step to a sequence (at the end, or before `at` with insert), or replaces step `at` (1-based). */
  | {
      op: "step";
      sequence: string;
      at?: number | undefined;
      insert?: boolean | undefined;
      step: Partial<PlanStepSpec> & Record<string, unknown>;
    }
  /** Accepts an agent's suggestion: a change, a sequence, or a step. */
  | { op: "accept"; id: string }
  /** Dismisses an agent's suggestion, keeping it so it isn't suggested again. */
  | { op: "dismiss"; id: string }
  /** Replies to a note. */
  | { op: "reply"; note: string; text: string; kind?: PlanNoteKind | undefined }
  /** Resolves (or reopens) a note. */
  | { op: "resolve"; note: string; resolved?: boolean | undefined }
  /** Moves an item on the map. Not counted as a change to review. */
  | { op: "move"; id: string; at: { x: number; y: number } }
  /** Sets the plan's title, goal, or status. */
  | {
      op: "set";
      title?: string | undefined;
      goal?: string | undefined;
      status?: PlanStatus | undefined;
    }
  /** Sends the plan to the agent: status reviewing, one more round. */
  | { op: "send" }
  /** The agent has read what changed: clears unread. */
  | { op: "read" };

export interface EditPlanOptions {
  /** Who's making the edit: human:@handle or agent:<name>. Stamped on new items and replies. */
  by?: string | undefined;
  /**
   * Record what changed in `unread`, for the agent's next read. The explorer
   * sets it for the person's edits; the agent's own edits don't.
   */
  track?: boolean | undefined;
}

export interface EditPlanResult {
  /** The new text; undefined when an op failed, and then nothing changes. */
  text?: string | undefined;
  plan?: Plan | undefined;
  /** One line per op. */
  done: string[];
  problems: string[];
  /** The IDs ops gave new items, in order. */
  ids: string[];
}

class PlanEditError extends Error {}

const PREFIX: Record<PlanList, string> = { changes: "c", sequences: "s", notes: "n", tasks: "t" };

/**
 * Applies edits to a plan file and returns its new text, changing only the
 * lines the edits touch. All ops are made, or none. Pure: it reads and
 * writes nothing.
 */
export function editPlan(
  file: string,
  text: string,
  ops: readonly PlanEditOp[],
  options: EditPlanOptions = {},
): EditPlanResult {
  const { before, after } = parseForEdit(text);
  if (before.errors.length) {
    return {
      done: [],
      ids: [],
      problems: [`${file} isn't valid YAML: ${before.errors[0]?.message.split("\n")[0]}`],
    };
  }
  const editor = new PlanEditor(after, options);
  const done: string[] = [];
  const problems: string[] = [];
  for (const [i, op] of ops.entries()) {
    try {
      done.push(editor.apply(op));
    } catch (err) {
      if (!(err instanceof PlanEditError)) throw err;
      problems.push(`${ops.length > 1 ? `#${i + 1} ` : ""}${op.op}: ${err.message}`);
    }
  }
  if (problems.length) return { done: [], ids: [], problems };
  const out = patchYaml(text, before, after);
  const parsed = parsePlan(file, out);
  const errors = parsed.diagnostics.filter((d) => d.severity === "error");
  if (!parsed.plan || errors.length) {
    return {
      done: [],
      ids: [],
      problems: errors.length
        ? errors.map((d) => `The plan wouldn't be valid: ${formatDiagnostic(d)}`)
        : ["The plan wouldn't be valid."],
    };
  }
  return { text: out, plan: parsed.plan, done, problems, ids: editor.ids };
}

class PlanEditor {
  readonly ids: string[] = [];

  constructor(
    private readonly doc: Document,
    private readonly options: EditPlanOptions,
  ) {}

  apply(op: PlanEditOp): string {
    switch (op.op) {
      case "put":
        return this.put(op.list, op.item);
      case "drop":
        return this.drop(op.id);
      case "step":
        return this.step(op);
      case "accept":
      case "dismiss":
        return this.decide(op.id, op.op);
      case "reply": {
        const note = this.find("notes", op.note);
        if (!note) throw new PlanEditError(`No note ${op.note}.`);
        if (!op.text.trim()) throw new PlanEditError("A reply needs text.");
        const reply: Record<string, unknown> = {};
        if (this.options.by) reply.by = this.options.by;
        if (op.kind) reply.kind = op.kind;
        reply.text = op.text;
        const replies = note.map.get("replies");
        if (isSeq(replies)) replies.add(this.doc.createNode(reply));
        else note.map.set("replies", this.doc.createNode([reply]));
        this.track(op.note, "replied");
        return `replied to ${op.note}`;
      }
      case "resolve": {
        const note = this.find("notes", op.note);
        if (!note) throw new PlanEditError(`No note ${op.note}.`);
        if (op.resolved === false) note.map.delete("resolved");
        else note.map.set("resolved", true);
        this.track(op.note, "edited");
        return `${op.resolved === false ? "reopened" : "resolved"} ${op.note}`;
      }
      case "move": {
        const [seqId] = op.id.split("#");
        const item =
          this.find("changes", op.id) ??
          this.find("notes", op.id) ??
          (seqId ? this.find("sequences", seqId) : undefined);
        if (!item) throw new PlanEditError(`No item ${op.id}.`);
        item.map.set("at", this.doc.createNode({ x: Math.round(op.at.x), y: Math.round(op.at.y) }));
        return `moved ${op.id}`;
      }
      case "set": {
        const parts: string[] = [];
        for (const key of ["title", "goal", "status"] as const) {
          const v = op[key];
          if (v === undefined) continue;
          this.doc.set(key, v);
          parts.push(`${key} ${key === "goal" ? "updated" : v}`);
        }
        if (!parts.length) throw new PlanEditError("Give a title, goal, or status.");
        return `set ${parts.join(", ")}`;
      }
      case "send": {
        const sent = Number(this.doc.get("sent") ?? 0);
        this.doc.set("status", "reviewing");
        this.doc.set("sent", sent + 1);
        return `sent to the agent (round ${sent + 1})`;
      }
      case "read": {
        if (this.doc.has("unread")) this.doc.delete("unread");
        return "marked read";
      }
      default:
        throw new PlanEditError(`Unknown op ${(op as { op: string }).op}.`);
    }
  }

  private list(name: PlanList, create = false): YAMLSeq | undefined {
    const seq = this.doc.get(name);
    if (isSeq(seq)) return seq;
    if (!create) return undefined;
    const fresh = this.doc.createNode([]) as YAMLSeq;
    this.doc.set(name, fresh);
    return fresh;
  }

  private find(name: PlanList, id: string): { map: YAMLMap; index: number } | undefined {
    const seq = this.list(name);
    if (!seq) return undefined;
    for (const [index, item] of seq.items.entries()) {
      if (isMap(item) && String(item.get("id")) === id) return { map: item, index };
    }
    return undefined;
  }

  private nextId(name: PlanList): string {
    const prefix = PREFIX[name];
    const taken = new Set<string>();
    for (const item of this.list(name)?.items ?? [])
      if (isMap(item)) taken.add(String(item.get("id")));
    let n = 1;
    while (taken.has(`${prefix}${n}`)) n++;
    return `${prefix}${n}`;
  }

  private put(name: PlanList, item: Record<string, unknown>): string {
    if (!PREFIX[name]) throw new PlanEditError(`list is one of changes, sequences, notes, tasks.`);
    const given = typeof item.id === "string" && item.id ? item.id : undefined;
    const existing = given ? this.find(name, given) : undefined;
    const id = given ?? this.nextId(name);
    const value: Record<string, unknown> = { id };
    if (!existing && this.options.by && name !== "tasks" && item.by === undefined)
      value.by = this.options.by;
    for (const [k, v] of Object.entries(item)) if (k !== "id" && v !== undefined) value[k] = v;
    const seq = this.list(name, true) as YAMLSeq;
    if (existing) {
      // Keep who wrote it, and where it sits, unless the edit says otherwise.
      const was = existing.map.toJSON() as Record<string, unknown>;
      for (const keep of ["by", "at"])
        if (value[keep] === undefined && was[keep] !== undefined) value[keep] = was[keep];
      seq.items[existing.index] = this.doc.createNode(value);
      this.track(id, "edited");
      return `changed ${id}`;
    }
    seq.add(this.doc.createNode(value));
    this.ids.push(id);
    this.track(id, "added");
    return `added ${id}`;
  }

  private drop(id: string): string {
    const [seqId, stepNo] = id.split("#");
    if (stepNo !== undefined) {
      const seq = seqId ? this.find("sequences", seqId) : undefined;
      const steps = seq?.map.get("steps");
      const i = Number(stepNo) - 1;
      if (!isSeq(steps) || !steps.items[i]) throw new PlanEditError(`No step ${id}.`);
      steps.items.splice(i, 1);
      this.track(id, "removed");
      return `removed ${id}`;
    }
    for (const name of ["changes", "sequences", "notes", "tasks"] as const) {
      const found = this.find(name, id);
      if (!found) continue;
      (this.list(name) as YAMLSeq).items.splice(found.index, 1);
      if (!(this.list(name) as YAMLSeq).items.length) this.doc.delete(name);
      // Notes on it go with it.
      if (name !== "notes") {
        const notes = this.list("notes");
        if (notes)
          notes.items = notes.items.filter(
            (n) => !(isMap(n) && String(n.get("on") ?? "").split("#")[0] === id),
          );
      }
      this.track(id, "removed");
      return `removed ${id}`;
    }
    throw new PlanEditError(`No item ${id}.`);
  }

  private step(op: Extract<PlanEditOp, { op: "step" }>): string {
    const seq = this.find("sequences", op.sequence);
    if (!seq) throw new PlanEditError(`No sequence ${op.sequence}.`);
    let steps = seq.map.get("steps");
    if (!isSeq(steps)) {
      steps = this.doc.createNode([]) as YAMLSeq;
      seq.map.set("steps", steps);
    }
    const list = steps as YAMLSeq;
    // Changing a step merges into it (null removes a field); adding one takes it whole.
    const replacing = op.at !== undefined && !op.insert ? list.items[op.at - 1] : undefined;
    const value: Record<string, unknown> = isMap(replacing)
      ? (replacing.toJSON() as Record<string, unknown>)
      : {};
    for (const [k, v] of Object.entries(op.step)) {
      if (v === null) delete value[k];
      else if (v !== undefined) value[k] = v;
    }
    if (!value.from || !value.to) throw new PlanEditError("A step needs from and to.");
    if (op.at === undefined) {
      if (this.options.by && value.by === undefined) value.by = this.options.by;
      list.add(this.doc.createNode(value));
      const id = `${op.sequence}#${list.items.length}`;
      this.track(id, "added");
      return `added ${id}`;
    }
    const i = op.at - 1;
    if (i < 0 || i > list.items.length || (!op.insert && i === list.items.length))
      throw new PlanEditError(`${op.sequence} has ${list.items.length} steps; no step ${op.at}.`);
    if (op.insert) {
      if (this.options.by && value.by === undefined) value.by = this.options.by;
      list.items.splice(i, 0, this.doc.createNode(value));
      this.track(`${op.sequence}#${op.at}`, "added");
      return `inserted ${op.sequence}#${op.at}`;
    }
    list.items[i] = this.doc.createNode(value);
    this.track(`${op.sequence}#${op.at}`, "edited");
    return `changed ${op.sequence}#${op.at}`;
  }

  private decide(id: string, how: "accept" | "dismiss"): string {
    const [seqId, stepNo] = id.split("#");
    let map: YAMLMap | undefined;
    if (stepNo !== undefined) {
      const steps = seqId ? this.find("sequences", seqId)?.map.get("steps") : undefined;
      const s = isSeq(steps) ? steps.items[Number(stepNo) - 1] : undefined;
      map = isMap(s) ? s : undefined;
    } else {
      map = (this.find("changes", id) ?? this.find("sequences", id))?.map;
    }
    if (!map) throw new PlanEditError(`No change, sequence, or step ${id}.`);
    if (map.get("status") !== "suggested")
      throw new PlanEditError(`${id} isn't a suggestion waiting for an answer.`);
    if (how === "accept") map.delete("status");
    else map.set("status", "dismissed");
    this.track(id, how === "accept" ? "accepted" : "dismissed");
    return `${how === "accept" ? "accepted" : "dismissed"} ${id}`;
  }

  private track(id: string, what: PlanUnreadSpec["what"]): void {
    if (!this.options.track) return;
    let seq = this.doc.get("unread");
    if (!isSeq(seq)) {
      seq = this.doc.createNode([]) as YAMLSeq;
      this.doc.set("unread", seq);
    }
    const list = seq as YAMLSeq;
    const at = list.items.findIndex((u) => isMap(u) && String(u.get("id")) === id);
    const was = at >= 0 ? String((list.items[at] as YAMLMap).get("what")) : undefined;
    if (was === "added" && what === "removed") {
      list.items.splice(at, 1);
      if (!list.items.length) this.doc.delete("unread");
      return;
    }
    // An edit after an add or a reply doesn't hide it: the agent still sees what's new.
    if ((was === "added" || was === "replied") && what === "edited") return;
    const entry = this.doc.createNode({ id, what });
    if (at >= 0) list.items[at] = entry;
    else list.add(entry);
  }
}
