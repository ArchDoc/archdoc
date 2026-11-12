import {
  changeKind,
  type Diagnostic,
  describeChange,
  formatDiagnostic,
  type Model,
  type Plan,
  type PlanCheck,
  type PlanEditOp,
  planStatusOf,
} from "@archdoc/core/browser";
import { useState } from "react";
import { childKind, type PlanMap, refOf, slug, startPlan } from "../model/plans.js";

/** The ID that opens the start panel instead of a plan. */
export const NEW_PLAN = "new";

type PlanNote = Plan["spec"]["notes"][number];
type PlanStatus = ReturnType<typeof planStatusOf>;

const STATUS_LABEL: Record<PlanStatus, string> = {
  drafting: "Drafting",
  reviewing: "With the agent",
  ready: "Ready",
  executing: "Being built",
  done: "Done",
  abandoned: "Abandoned",
};

const ORDER: PlanStatus[] = ["reviewing", "drafting", "ready", "executing", "done", "abandoned"];

/** What the person is drawing that isn't saved yet: it needs an intent first. */
export type PlanDraft =
  | { kind: "element"; parent?: string | undefined }
  | { kind: "use"; from: string; to: string }
  | { kind: "change"; element: string; how: "set" | "remove" }
  | {
      kind: "sequence";
      /** An existing journey whose steps it replaces, or none for a new one. */
      journey?: string | undefined;
      steps: DraftStep[];
      /** Where the next click starts from: the last box clicked. */
      cursor?: string | undefined;
    };

export interface DraftStep {
  from: string;
  to: string;
  action: string;
  intent: string;
}

/** The plans, by where each stands. */
export function PlanList(props: {
  plans: Plan[];
  problems: Diagnostic[];
  planId?: string | undefined;
  onPlan: (id: string) => void;
}) {
  return (
    <nav className="side-list" aria-label="Plans">
      <h2 className="side-title">Plan</h2>
      <button
        type="button"
        className={`side-item triage-start-item${props.planId === NEW_PLAN ? " is-active" : ""}`}
        aria-current={props.planId === NEW_PLAN ? "true" : undefined}
        onClick={() => props.onPlan(NEW_PLAN)}
      >
        <span className="side-item-label">
          + Start a plan
          <span className="side-item-sub">
            Sketch a change on the map, then refine it with your agent
          </span>
        </span>
      </button>
      {ORDER.map((status) => {
        const plans = props.plans.filter((p) => planStatusOf(p.spec) === status);
        if (!plans.length) return null;
        return (
          <div key={status} className="triage-group">
            <h3 className={`triage-group-title plan-status-${status}`}>
              {STATUS_LABEL[status]} <span className="muted">{plans.length}</span>
            </h3>
            {plans.map((p) => (
              <button
                key={p.id}
                type="button"
                className={`side-item${props.planId === p.id ? " is-active" : ""}`}
                aria-current={props.planId === p.id ? "true" : undefined}
                onClick={() => props.onPlan(p.id)}
              >
                <span className="side-item-label">
                  {p.spec.title}
                  <span className="side-item-sub">
                    {p.spec.changes.length} change{p.spec.changes.length === 1 ? "" : "s"} ·{" "}
                    {p.spec.sequences.length} sequence{p.spec.sequences.length === 1 ? "" : "s"}
                    {p.spec.unread?.length ? " · unsent edits" : ""}
                  </span>
                </span>
              </button>
            ))}
          </div>
        );
      })}
      {props.problems.length ? (
        <div className="trace-problems">
          <p className="muted small">Files the explorer couldn't read as plans:</p>
          <ul>
            {props.problems.map((d) => (
              <li key={formatDiagnostic(d)}>
                <code>{formatDiagnostic(d)}</code>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </nav>
  );
}

/** Starting a plan: the idea in a sentence, then the map. */
export function PlanStart(props: { editable: boolean; onStarted: (id: string) => void }) {
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  return (
    <section className="story triage-start" aria-label="Start a plan">
      <header className="story-head">
        <div className="story-title">
          <h1>Start a plan</h1>
          <p className="muted">
            Say what you want to change. You sketch it on the map, with what each part is for; your
            agent reviews it against the code, asks, and suggests, until it's solid. Then it builds
            it.
          </p>
        </div>
      </header>
      <div className="triage-start-body plan-start">
        {props.editable ? (
          <form
            className="plan-form"
            onSubmit={(e) => {
              e.preventDefault();
              setBusy(true);
              setError(undefined);
              void startPlan(title.trim(), goal.trim()).then((r) => {
                setBusy(false);
                if (r.ok) props.onStarted(r.id);
                else setError(r.error);
              });
            }}
          >
            <label className="field">
              <span>The change, in a line</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Export a journey as a PDF"
                required
              />
            </label>
            <label className="field">
              <span>The idea</span>
              <textarea
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                rows={4}
                placeholder="Reviewers want to attach a journey to a design review, so…"
              />
            </label>
            {error ? <p className="form-error">{error}</p> : null}
            <div className="form-actions">
              <button type="submit" className="btn primary" disabled={busy || !title.trim()}>
                Start the plan
              </button>
            </div>
          </form>
        ) : (
          <p className="muted">
            This explorer is read-only. Plans are drawn in <code>archdoc view</code>, or started by
            your agent with <code>archdoc plan start</code>.
          </p>
        )}
      </div>
    </section>
  );
}

/** What blocks marking a plan ready. */
function blockers(check: PlanCheck): string[] {
  const o = check.open;
  return [
    o.missingIntent ? `${o.missingIntent} without intent` : "",
    o.questions ? `${o.questions} open question${o.questions === 1 ? "" : "s"}` : "",
    o.suggestions ? `${o.suggestions} suggestion${o.suggestions === 1 ? "" : "s"} to answer` : "",
    check.findings.some((f) => f.code === "plan/cannot-apply") ? "changes that can't be made" : "",
  ].filter(Boolean);
}

/** The plan's header over the map: what it is, where it stands, and the hand-offs. */
export function PlanHead(props: {
  map: PlanMap;
  editable: boolean;
  busy: boolean;
  onEdit: (ops: PlanEditOp[]) => void;
  hint?: string | undefined;
}) {
  const { plan, check } = props.map;
  const status = planStatusOf(plan.spec);
  const blocked = blockers(check);
  const unread = plan.spec.unread?.length ?? 0;
  const designing = status === "drafting" || status === "reviewing";
  return (
    <header className="story-head plan-head">
      <div className="story-title">
        <h1>{plan.spec.title}</h1>
        <p className="muted">
          <span className={`triage-status plan-status-${status}`}>{STATUS_LABEL[status]}</span>{" "}
          {plan.id}
          {plan.spec.sent ? ` · sent ${plan.spec.sent}×` : ""}
          {blocked.length ? ` · ${blocked.join(", ")}` : designing ? " · nothing open" : ""}
        </p>
        {props.hint ? <p className="plan-hint">{props.hint}</p> : null}
      </div>
      {props.editable && designing ? (
        <div className="plan-actions">
          <button
            type="button"
            className="btn"
            disabled={props.busy}
            title={
              unread
                ? `Hand your ${unread} edit${unread === 1 ? "" : "s"} to the agent to review`
                : "Ask the agent to review the plan"
            }
            onClick={() => props.onEdit([{ op: "send" }])}
          >
            Send to agent{unread ? ` (${unread})` : ""}
          </button>
          <button
            type="button"
            className="btn primary"
            disabled={props.busy || blocked.length > 0}
            title={
              blocked.length
                ? `Settle these first: ${blocked.join(", ")}`
                : "The plan is agreed: the agent writes the tasks and builds it"
            }
            onClick={() => props.onEdit([{ op: "set", status: "ready" }, { op: "send" }])}
          >
            Mark ready
          </button>
        </div>
      ) : null}
    </header>
  );
}

const KINDS = ["container", "component", "code", "datastore", "queue", "external"];

/** The panel beside the map: a draft to finish, the selected box, or the plan as a whole. */
export function PlanPanel(props: {
  map: PlanMap;
  model: Model;
  editable: boolean;
  busy: boolean;
  error?: string | undefined;
  draft?: PlanDraft | undefined;
  onDraft: (draft: PlanDraft | undefined) => void;
  selected?: string | undefined;
  onSelect: (key: string | undefined) => void;
  sequence?: string | undefined;
  onSequence: (id: string | undefined) => void;
  at: number;
  onAt: (at: number) => void;
  onEdit: (ops: PlanEditOp[]) => Promise<boolean>;
  /** The element new top-level parts go in: the system, when the model has one. */
  top?: string | undefined;
}) {
  const { map, draft } = props;
  const error = props.error ? <p className="form-error">{props.error}</p> : null;
  if (draft?.kind === "element")
    return (
      <div className="details plan-panel">
        <ElementDraft {...props} parent={draft.parent ?? props.top} />
        {error}
      </div>
    );
  if (draft?.kind === "use")
    return (
      <div className="details plan-panel">
        <UseDraft {...props} from={draft.from} to={draft.to} />
        {error}
      </div>
    );
  if (draft?.kind === "change")
    return (
      <div className="details plan-panel">
        <ChangeDraft {...props} element={draft.element} how={draft.how} />
        {error}
      </div>
    );
  if (draft?.kind === "sequence")
    return (
      <div className="details plan-panel">
        <SequenceDraft {...props} draft={draft} />
        {error}
      </div>
    );
  const seq = props.sequence
    ? map.plan.spec.sequences.find((s) => s.id === props.sequence)
    : undefined;
  if (seq)
    return (
      <div className="details plan-panel">
        <SequenceView {...props} id={seq.id} />
        {error}
      </div>
    );
  const ref = props.selected ? refOf(props.selected) : undefined;
  if (ref && props.selected)
    return (
      <div className="details plan-panel">
        <BoxPanel {...props} nodeKey={props.selected} reference={ref} />
        {error}
      </div>
    );
  return (
    <div className="details plan-panel">
      <PlanOverview {...props} />
      {error}
    </div>
  );
}

type PanelProps = Parameters<typeof PlanPanel>[0];

function nameOf(model: Model, ref: string): string {
  return model.elements.get(ref)?.spec.name ?? model.actors.get(ref)?.spec.name ?? ref;
}

function Intent(props: {
  value: string;
  onChange: (v: string) => void;
  label?: string | undefined;
  placeholder?: string | undefined;
}) {
  return (
    <label className="field">
      <span>
        {props.label ?? "Intent"} <span className="muted small">(required)</span>
      </span>
      <textarea
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        rows={3}
        required
        placeholder={props.placeholder ?? "What this is for, and why it's needed"}
      />
    </label>
  );
}

function ElementDraft(props: PanelProps & { parent?: string | undefined }) {
  const parentEl = props.parent ? props.map.after.elements.get(props.parent) : undefined;
  const [name, setName] = useState("");
  const [kind, setKind] = useState(childKind(parentEl?.spec.kind));
  const [description, setDescription] = useState("");
  const [intent, setIntent] = useState("");
  const id = `${props.parent ? `${props.parent}.` : ""}${slug(name)}`;
  const taken = props.map.after.elements.has(id);
  return (
    <form
      className="plan-form"
      onSubmit={(e) => {
        e.preventDefault();
        const add: Record<string, unknown> = { id, kind, name: name.trim() };
        if (description.trim()) add.description = description.trim();
        void props
          .onEdit([{ op: "put", list: "changes", item: { intent: intent.trim(), add } }])
          .then((ok) => ok && props.onDraft(undefined));
      }}
    >
      <p className="step-where">
        New element{parentEl ? ` in ${parentEl.spec.name ?? parentEl.id}` : ""}
      </p>
      <label className="field">
        <span>Name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <p className="muted small">
        ID <code>{id}</code>
        {taken ? " is taken: pick another name." : ""}
      </p>
      <label className="field">
        <span>Kind</span>
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>What it is</span>
        <input value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <Intent value={intent} onChange={setIntent} />
      <div className="form-actions">
        <button
          type="submit"
          className="btn primary"
          disabled={props.busy || !name.trim() || !intent.trim() || taken}
        >
          Add to the plan
        </button>
        <button type="button" className="btn" onClick={() => props.onDraft(undefined)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function UseDraft(props: PanelProps & { from: string; to: string }) {
  const [description, setDescription] = useState("");
  const [intent, setIntent] = useState("");
  const from = refOf(props.from) ?? props.from;
  const to = refOf(props.to) ?? props.to;
  return (
    <form
      className="plan-form"
      onSubmit={(e) => {
        e.preventDefault();
        const use: Record<string, unknown> = { from, to };
        if (description.trim()) use.description = description.trim();
        void props
          .onEdit([{ op: "put", list: "changes", item: { intent: intent.trim(), use } }])
          .then((ok) => ok && props.onDraft(undefined));
      }}
    >
      <p className="step-where">New arrow</p>
      <h2 className="step-title">
        {nameOf(props.map.after, from)} <span className="arrow">→</span>{" "}
        {nameOf(props.map.after, to)}
      </h2>
      <label className="field">
        <span>What it does</span>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Sends the journey's steps to render"
        />
      </label>
      <Intent value={intent} onChange={setIntent} />
      <div className="form-actions">
        <button type="submit" className="btn primary" disabled={props.busy || !intent.trim()}>
          Add to the plan
        </button>
        <button type="button" className="btn" onClick={() => props.onDraft(undefined)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function ChangeDraft(props: PanelProps & { element: string; how: "set" | "remove" }) {
  const el = props.model.elements.get(props.element);
  const [description, setDescription] = useState(el?.spec.description ?? "");
  const [intent, setIntent] = useState("");
  return (
    <form
      className="plan-form"
      onSubmit={(e) => {
        e.preventDefault();
        const item: Record<string, unknown> =
          props.how === "remove"
            ? { intent: intent.trim(), remove: props.element }
            : {
                intent: intent.trim(),
                set: { id: props.element, description: description.trim() || null },
              };
        void props
          .onEdit([{ op: "put", list: "changes", item }])
          .then((ok) => ok && props.onDraft(undefined));
      }}
    >
      <p className="step-where">{props.how === "remove" ? "Remove" : "Change"}</p>
      <h2 className="step-title">{el?.spec.name ?? props.element}</h2>
      {props.how === "set" ? (
        <label className="field">
          <span>What it is, after the change</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
        </label>
      ) : (
        <p className="muted small">
          Removing it removes its parts and the arrows to it too, when the plan is built.
        </p>
      )}
      <Intent
        value={intent}
        onChange={setIntent}
        label={props.how === "remove" ? "Why it goes" : "Intent"}
      />
      <div className="form-actions">
        <button type="submit" className="btn primary" disabled={props.busy || !intent.trim()}>
          Add to the plan
        </button>
        <button type="button" className="btn" onClick={() => props.onDraft(undefined)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function SequenceDraft(props: PanelProps & { draft: Extract<PlanDraft, { kind: "sequence" }> }) {
  const { draft, model } = props;
  const existing = draft.journey ? model.journeys.get(draft.journey) : undefined;
  const [name, setName] = useState(existing?.spec.name ?? "");
  const [goal, setGoal] = useState(existing?.spec.goal ?? "");
  const [intent, setIntent] = useState("");
  const set = (i: number, patch: Partial<DraftStep>) =>
    props.onDraft({
      ...draft,
      steps: draft.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)),
    });
  const first = draft.steps[0]?.from ?? draft.cursor;
  const actor = first && model.actors.has(first) ? first : undefined;
  const complete =
    draft.steps.length > 0 &&
    draft.steps.every((s) => s.intent.trim() && s.action.trim()) &&
    (existing || (actor && goal.trim()));
  return (
    <form
      className="plan-form"
      onSubmit={(e) => {
        e.preventDefault();
        const journey = draft.journey ?? slug(name || goal);
        void props
          .onEdit([
            {
              op: "put",
              list: "sequences",
              item: {
                journey,
                ...(name.trim() ? { name: name.trim() } : {}),
                ...(existing ? {} : { actor, goal: goal.trim() }),
                ...(intent.trim() ? { intent: intent.trim() } : {}),
                steps: draft.steps.map((s) => ({
                  from: s.from,
                  to: s.to,
                  action: s.action.trim(),
                  intent: s.intent.trim(),
                })),
              },
            },
          ])
          .then((ok) => ok && props.onDraft(undefined));
      }}
    >
      <p className="step-where">
        {existing ? `New steps for ${existing.spec.name ?? existing.id}` : "New sequence"}
      </p>
      <p className="plan-hint">
        {draft.cursor
          ? `Click the next box after ${nameOf(props.map.after, draft.cursor)}.`
          : "Click who starts it on the map (a person or a system), then each box it goes to, in order."}
      </p>
      {existing ? null : (
        <>
          <label className="field">
            <span>Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Export a journey"
            />
          </label>
          <label className="field">
            <span>
              Their goal <span className="muted small">(required)</span>
            </span>
            <input value={goal} onChange={(e) => setGoal(e.target.value)} />
          </label>
          {first && !actor ? (
            <p className="form-error">
              A new journey starts at an actor: click a person or system first.
            </p>
          ) : null}
        </>
      )}
      <ol className="plan-steps">
        {draft.steps.map((s, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a step is its place in the sequence
          <li key={i} className="plan-step">
            <p className="step-ends">
              {nameOf(props.map.after, s.from)} <span className="arrow">→</span>{" "}
              {nameOf(props.map.after, s.to)}
              <button
                type="button"
                className="link small plan-remove"
                onClick={() =>
                  props.onDraft({
                    ...draft,
                    steps: draft.steps.filter((_, j) => j !== i),
                    cursor: i === draft.steps.length - 1 ? s.from : draft.cursor,
                  })
                }
              >
                remove
              </button>
            </p>
            <label className="field">
              <span className="sr-only">Action</span>
              <input
                value={s.action}
                onChange={(e) => set(i, { action: e.target.value })}
                placeholder="What happens: Clicks Export"
              />
            </label>
            <label className="field">
              <span className="sr-only">Intent</span>
              <textarea
                value={s.intent}
                onChange={(e) => set(i, { intent: e.target.value })}
                rows={2}
                placeholder="Intent (required): why this hop, and what it carries"
              />
            </label>
          </li>
        ))}
      </ol>
      <label className="field">
        <span>What the sequence is for</span>
        <input value={intent} onChange={(e) => setIntent(e.target.value)} />
      </label>
      <div className="form-actions">
        <button type="submit" className="btn primary" disabled={props.busy || !complete}>
          Add to the plan
        </button>
        <button type="button" className="btn" onClick={() => props.onDraft(undefined)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** A sequence already in the plan, stepped through on the map like a journey. */
function SequenceView(props: PanelProps & { id: string }) {
  const { plan } = props.map;
  const seq = plan.spec.sequences.find((s) => s.id === props.id);
  if (!seq) return null;
  return (
    <>
      <button type="button" className="link back" onClick={() => props.onSequence(undefined)}>
        ← Back to the plan
      </button>
      <p className="step-where">
        Sequence {seq.id} · journey {seq.journey}
        {props.model.journeys.has(seq.journey) ? " (changed)" : " (new)"}
      </p>
      <h2 className="step-title">{seq.name ?? seq.goal ?? seq.journey}</h2>
      {seq.intent ? <p className="lede">{seq.intent}</p> : null}
      <Suggestion {...props} item={seq} id={seq.id} />
      <ol className="plan-steps">
        {seq.steps.map((s, i) => (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: a step is its place in the sequence
            key={i}
            className={`plan-step${props.at === i ? " is-current" : ""}`}
          >
            <button type="button" className="link" onClick={() => props.onAt(i)}>
              {i + 1}. {s.action ?? `${s.from} → ${s.to}`}
            </button>
            <p className="muted small">
              {nameOf(props.map.after, s.from)} → {nameOf(props.map.after, s.to)}
            </p>
            <p className={s.intent ? "plan-intent" : "form-error"}>
              {s.intent ?? "No intent yet: say what this hop is for."}
            </p>
            <Suggestion {...props} item={s} id={`${seq.id}#${i + 1}`} />
            <Notes {...props} on={`${seq.id}#${i + 1}`} compact />
          </li>
        ))}
      </ol>
      <Notes {...props} on={seq.id} />
      {props.editable && seq.by?.startsWith("agent:") !== true ? (
        <button
          type="button"
          className="link small"
          onClick={() =>
            void props
              .onEdit([{ op: "drop", id: seq.id }])
              .then((ok) => ok && props.onSequence(undefined))
          }
        >
          Remove the sequence from the plan
        </button>
      ) : null}
    </>
  );
}

/** Accept or dismiss an agent's suggestion. */
function Suggestion(
  props: PanelProps & {
    item: { status?: string | undefined; by?: string | undefined };
    id: string;
  },
) {
  if (props.item.status === "dismissed")
    return <span className="chip plan-chip plan-dismissed">dismissed</span>;
  if (props.item.status !== "suggested") return null;
  return (
    <div className="plan-suggestion">
      <span className="chip plan-chip plan-suggested">
        suggested by {props.item.by ?? "the agent"}
      </span>
      {props.editable ? (
        <>
          <button
            type="button"
            className="btn small primary"
            disabled={props.busy}
            onClick={() => void props.onEdit([{ op: "accept", id: props.id }])}
          >
            Accept
          </button>
          <button
            type="button"
            className="btn small"
            disabled={props.busy}
            onClick={() => void props.onEdit([{ op: "dismiss", id: props.id }])}
          >
            Dismiss
          </button>
        </>
      ) : null}
    </div>
  );
}

/** One change, with its intent and what can be done with it. */
function ChangeItem(props: PanelProps & { change: Plan["spec"]["changes"][number] }) {
  const c = props.change;
  return (
    <li className={`plan-change plan-kind-${changeKind(c)}${c.status ? ` is-${c.status}` : ""}`}>
      <button
        type="button"
        className="link"
        onClick={() => {
          const key = [...props.map.items.entries()].find(([, ids]) => ids.includes(c.id))?.[0];
          if (key) props.onSelect(key);
        }}
      >
        {c.id} · {describeChange(c)}
      </button>
      <p className={c.intent ? "plan-intent" : "form-error"}>
        {c.intent ?? "No intent yet: say what it's for."}
      </p>
      <Suggestion {...props} item={c} id={c.id} />
      <Notes {...props} on={c.id} compact />
      {props.editable && !c.by?.startsWith("agent:") ? (
        <button
          type="button"
          className="link small"
          title="Take this change out of the plan"
          onClick={() => void props.onEdit([{ op: "drop", id: c.id }])}
        >
          remove from the plan
        </button>
      ) : null}
    </li>
  );
}

/** A box selected on the map: what the plan does to it, its notes, and what to do next. */
function BoxPanel(props: PanelProps & { nodeKey: string; reference: string }) {
  const { map, reference } = props;
  const ids = map.items.get(props.nodeKey) ?? [];
  const changes = map.plan.spec.changes.filter((c) => ids.includes(c.id));
  const el = map.after.elements.get(reference);
  const actor = map.after.actors.get(reference);
  const inModel = props.model.elements.has(reference) || props.model.actors.has(reference);
  return (
    <>
      <button type="button" className="link back" onClick={() => props.onSelect(undefined)}>
        ← Back to the plan
      </button>
      <p className="step-where">
        {el ? el.spec.kind : actor ? "actor" : ""}
        {inModel ? "" : " · new in this plan"}
      </p>
      <h2 className="step-title">{el?.spec.name ?? actor?.spec.name ?? reference}</h2>
      {el?.spec.description ? <p className="lede">{el.spec.description}</p> : null}
      {changes.length ? (
        <section className="block">
          <h3>In this plan</h3>
          <ul className="plan-changes">
            {changes.map((c) => (
              <ChangeItem key={c.id} {...props} change={c} />
            ))}
          </ul>
        </section>
      ) : null}
      <Notes {...props} on={reference} />
      {props.editable ? (
        <section className="block">
          <h3>Plan a change</h3>
          <div className="form-actions">
            {el && inModel ? (
              <>
                <button
                  type="button"
                  className="btn small"
                  onClick={() => props.onDraft({ kind: "change", element: reference, how: "set" })}
                >
                  Change it
                </button>
                <button
                  type="button"
                  className="btn small"
                  onClick={() =>
                    props.onDraft({ kind: "change", element: reference, how: "remove" })
                  }
                >
                  Remove it
                </button>
              </>
            ) : null}
            {el ? (
              <button
                type="button"
                className="btn small"
                onClick={() => props.onDraft({ kind: "element", parent: reference })}
              >
                Add a part inside
              </button>
            ) : null}
            <button
              type="button"
              className="btn small"
              onClick={() => props.onDraft({ kind: "sequence", steps: [], cursor: reference })}
            >
              Start a sequence here
            </button>
          </div>
          <p className="muted small">
            To draw an arrow, drag from this box's right edge to another box.
          </p>
        </section>
      ) : null}
    </>
  );
}

/** The plan as a whole: its goal, every change and sequence, notes, what it reaches, the check. */
function PlanOverview(props: PanelProps) {
  const { plan, check } = props.map;
  const s = plan.spec;
  const status = planStatusOf(s);
  return (
    <>
      <p className="step-where">Plan · {STATUS_LABEL[status]}</p>
      <h2 className="step-title">{s.title}</h2>
      {s.goal ? <p className="lede">{s.goal}</p> : null}
      {props.editable && (status === "drafting" || status === "reviewing") ? (
        <p className="plan-hint">
          Double-click the map to add an element (inside an open box to put it there), drag from a
          box's right edge to another for an arrow, or click a box to change it. Every part needs
          its intent.
        </p>
      ) : null}

      <section className="block">
        <h3>
          Changes {s.changes.length ? <span className="muted">{s.changes.length}</span> : null}
        </h3>
        {s.changes.length ? (
          <ul className="plan-changes">
            {s.changes.map((c) => (
              <ChangeItem key={c.id} {...props} change={c} />
            ))}
          </ul>
        ) : (
          <p className="muted small">None yet.</p>
        )}
      </section>

      <section className="block">
        <h3>
          Sequences{" "}
          {s.sequences.length ? <span className="muted">{s.sequences.length}</span> : null}
        </h3>
        {s.sequences.length ? (
          <ul className="plan-changes">
            {s.sequences.map((q) => (
              <li key={q.id} className={`plan-change${q.status ? ` is-${q.status}` : ""}`}>
                <button type="button" className="link" onClick={() => props.onSequence(q.id)}>
                  {q.id} · {q.name ?? q.goal ?? q.journey}
                </button>
                <p className="muted small">
                  {q.steps.length} step{q.steps.length === 1 ? "" : "s"} · journey {q.journey}
                  {props.model.journeys.has(q.journey) ? " (changed)" : " (new)"}
                </p>
                <Suggestion {...props} item={q} id={q.id} />
              </li>
            ))}
          </ul>
        ) : null}
        {props.editable ? (
          <div className="form-actions">
            <button
              type="button"
              className="btn small"
              onClick={() => props.onDraft({ kind: "sequence", steps: [] })}
            >
              New sequence
            </button>
            <select
              className="btn small"
              value=""
              aria-label="Change a journey's steps"
              onChange={(e) =>
                e.target.value &&
                props.onDraft({
                  kind: "sequence",
                  journey: e.target.value,
                  steps: (props.model.journeys.get(e.target.value)?.spec.steps ?? []).map((st) => ({
                    from: st.from,
                    to: st.to,
                    action: st.action ?? "",
                    intent: "",
                  })),
                  cursor: props.model.journeys.get(e.target.value)?.spec.steps.at(-1)?.to,
                })
              }
            >
              <option value="">Change a journey…</option>
              {[...props.model.journeys.values()].map((j) => (
                <option key={j.id} value={j.id}>
                  {j.spec.name ?? j.id}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </section>

      <Notes {...props} on={undefined} all />

      <section className="block">
        <h3>What it reaches</h3>
        <p className="small">
          <strong>Journeys:</strong>{" "}
          {check.reach.journeys.length
            ? check.reach.journeys.map((j, i) => (
                <span key={j.id}>
                  {i ? ", " : ""}
                  {j.name ?? j.id}
                  {j.added ? " (new)" : j.changed ? " (changed)" : ""}
                  {j.importance !== "normal" ? (
                    <>
                      {" "}
                      <span className={`importance importance-${j.importance}`}>
                        {j.importance}
                      </span>
                    </>
                  ) : null}
                </span>
              ))
            : "none"}
        </p>
        <p className="small">
          <strong>Actors:</strong> {check.reach.actors.join(", ") || "none"}
        </p>
        {check.reach.owners.length ? (
          <p className="small">
            <strong>Owners:</strong> {check.reach.owners.join(", ")}
          </p>
        ) : null}
        {check.reach.elsewhere.length ? (
          <p className="small">
            <strong>Other repos:</strong> {check.reach.elsewhere.join(", ")}
          </p>
        ) : null}
      </section>

      <section className="block">
        <h3>Check</h3>
        {check.findings.length ? (
          <ul className="plan-findings">
            {check.findings.map((f) => (
              <li key={`${f.code}${f.item ?? ""}${f.message}`} className={`sev-${f.severity}`}>
                {f.message}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">Nothing to fix.</p>
        )}
      </section>

      {s.tasks.length ? (
        <section className="block">
          <h3>
            Tasks{" "}
            <span className="muted">
              {check.open.tasks.done}/{check.open.tasks.total}
            </span>
          </h3>
          <ol className="plan-tasks">
            {s.tasks.map((t) => (
              <li key={t.id} className={`plan-task task-${t.status ?? "todo"}`}>
                <span className="chip plan-chip">{t.status ?? "todo"}</span> {t.title}
                {t.files?.length ? <p className="muted small">{t.files.join(", ")}</p> : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </>
  );
}

/** Notes on an item (or all of the plan's), each with its thread and a reply box. */
function Notes(props: PanelProps & { on: string | undefined; compact?: boolean; all?: boolean }) {
  const notes = props.map.plan.spec.notes.filter((n) =>
    props.all ? true : props.on !== undefined && n.on === props.on,
  );
  const [text, setText] = useState("");
  const [question, setQuestion] = useState(false);
  const [open, setOpen] = useState(false);

  if (props.compact && !notes.length) return null;
  const body = (
    <>
      {notes.length ? (
        <ul className="plan-notes">
          {notes.map((n) => (
            <NoteItem key={n.id} {...props} note={n} />
          ))}
        </ul>
      ) : null}
      {props.editable && !props.compact ? (
        open ? (
          <form
            className="plan-form"
            onSubmit={(e) => {
              e.preventDefault();
              void props
                .onEdit([
                  {
                    op: "put",
                    list: "notes",
                    item: {
                      ...(props.on ? { on: props.on } : {}),
                      kind: question ? "question" : "note",
                      text: text.trim(),
                    },
                  },
                ])
                .then((ok) => {
                  if (!ok) return;
                  setText("");
                  setOpen(false);
                });
            }}
          >
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={2}
              placeholder="A note for the agent: what you mean, or what you're unsure of"
            />
            <label className="check">
              <input
                type="checkbox"
                checked={question}
                onChange={(e) => setQuestion(e.target.checked)}
              />{" "}
              It's a question that needs an answer
            </label>
            <div className="form-actions">
              <button
                type="submit"
                className="btn small primary"
                disabled={props.busy || !text.trim()}
              >
                Add the note
              </button>
              <button type="button" className="btn small" onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button type="button" className="link small" onClick={() => setOpen(true)}>
            + Add a note
          </button>
        )
      ) : null}
    </>
  );
  if (props.compact) return body;
  return (
    <section className="block">
      <h3>Notes {notes.length ? <span className="muted">{notes.length}</span> : null}</h3>
      {body}
    </section>
  );
}

function NoteItem(props: PanelProps & { note: PlanNote; on?: string | undefined }) {
  const n = props.note;
  const [reply, setReply] = useState("");
  const answered = (n.replies ?? []).some((r) => r.kind === "answer");
  const kind = n.kind ?? "note";
  return (
    <li className={`plan-note note-${kind}${n.resolved ? " is-resolved" : ""}`}>
      <p className="plan-note-head">
        <span className={`chip plan-chip note-chip-${kind}`}>{kind}</span>
        <span className="muted small">
          {n.by?.startsWith("agent:") ? "agent" : "you"}
          {n.on && props.on === undefined ? ` · on ${n.on}` : ""}
        </span>
      </p>
      <p className="plan-note-text">{n.text}</p>
      {(n.replies ?? []).map((r, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: replies are only ever added at the end
        <p key={i} className={`plan-reply reply-${r.kind ?? "reply"}`}>
          <span className="muted small">{r.by?.startsWith("agent:") ? "agent" : "you"}: </span>
          {r.text}
        </p>
      ))}
      {props.editable && !n.resolved ? (
        <form
          className="plan-reply-form"
          onSubmit={(e) => {
            e.preventDefault();
            void props
              .onEdit([
                {
                  op: "reply",
                  note: n.id,
                  text: reply.trim(),
                  kind: kind === "question" && !answered ? "answer" : undefined,
                },
              ])
              .then((ok) => ok && setReply(""));
          }}
        >
          <input
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder={kind === "question" && !answered ? "Answer" : "Reply"}
            aria-label={`Reply to ${n.id}`}
          />
          <button type="submit" className="btn small" disabled={props.busy || !reply.trim()}>
            {kind === "question" && !answered ? "Answer" : "Reply"}
          </button>
          <button
            type="button"
            className="link small"
            disabled={props.busy}
            onClick={() => void props.onEdit([{ op: "resolve", note: n.id }])}
          >
            Resolve
          </button>
        </form>
      ) : null}
    </li>
  );
}
