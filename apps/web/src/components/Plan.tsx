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
import { useEffect, useRef, useState } from "react";
import { type IntentPin, type PlanMap, refOf, startPlan } from "../model/plans.js";
import { SendToAgent } from "./Agent.js";

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

/**
 * Where the person clicked on the Plan tab's map, to say what they want
 * there: a box (its node ID) and where in it, or an intent already pinned.
 */
export interface PlanPop {
  /** Node ID of the box clicked in (element:…, actor:…). */
  node?: string | undefined;
  /** Where in that box, as percentages of its width and height. */
  at?: { x: number; y: number } | undefined;
  /** Where on the map, in its own coordinates, when the click gave it. */
  flow?: { x: number; y: number } | undefined;
  /** An intent already on the map, to read or change. */
  intent?: string | undefined;
  /** For how two boxes connect: the other box (node ID), from an arrow or a drag. */
  to?: string | undefined;
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
            Say what you want where you click on the map; your agent turns it into the model
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
                    {p.spec.intents.length} intent{p.spec.intents.length === 1 ? "" : "s"} ·{" "}
                    {p.spec.changes.length + p.spec.sequences.length} proposed
                    {p.spec.unread?.length ? " · not sent yet" : ""}
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

/** Starting a plan: the idea in a sentence or two, then the map. */
export function PlanStart(props: { editable: boolean; onStarted: (id: string) => void }) {
  const [goal, setGoal] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const start = () => {
    if (!goal.trim() || busy) return;
    setBusy(true);
    setError(undefined);
    void startPlan(goal.trim()).then((r) => {
      setBusy(false);
      if (r.ok) props.onStarted(r.id);
      else setError(r.error);
    });
  };
  return (
    <section className="story triage-start" aria-label="Start a plan">
      <header className="story-head">
        <div className="story-title">
          <h1>Start a plan</h1>
          <p className="muted">
            Say what you want to change. Then click in the boxes on the map where it should happen
            and say what you want there. You drive the design: your agent turns what you say into
            elements, arrows, and flows, checks them against the code, and asks where you've left a
            choice open. When you agree, it builds it.
          </p>
        </div>
      </header>
      <div className="triage-start-body plan-start">
        {props.editable ? (
          <form
            className="plan-form"
            onSubmit={(e) => {
              e.preventDefault();
              start();
            }}
          >
            <label className="triage-paste">
              <span className="sr-only">The change</span>
              <textarea
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    start();
                  }
                }}
                rows={4}
                placeholder="Email the shopper a receipt once checkout charges the order"
              />
            </label>
            {error ? <p className="form-error">{error}</p> : null}
            <div className="form-actions">
              <button type="submit" className="btn primary" disabled={busy || !goal.trim()}>
                Start the plan
              </button>
              <span className="muted small">The first line is its title.</span>
            </div>
          </form>
        ) : (
          <p className="muted">
            This explorer is read-only. Plans are made in <code>archdoc view</code>, or started by
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
  const s = check.plan.spec;
  return [
    s.intents.length + s.changes.length + s.sequences.length ? "" : "nothing in it yet",
    o.intents ? `${o.intents} intent${o.intents === 1 ? "" : "s"} for the agent to work out` : "",
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
  onEdit: (ops: PlanEditOp[]) => Promise<boolean>;
  hint?: string | undefined;
  /** The map shows what the plan touches, or (whole) the whole system. */
  focus?: { whole: boolean; available: boolean; onWhole: (whole: boolean) => void } | undefined;
}) {
  const { plan, check } = props.map;
  const status = planStatusOf(plan.spec);
  const blocked = blockers(check);
  const unread = plan.spec.unread?.length ?? 0;
  const designing = status === "drafting" || status === "reviewing";
  // The person drives the design: nothing to send until they've said what they want.
  const wrote = plan.spec.intents.some((n) => !n.by?.startsWith("agent:"));
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
        {props.focus?.available ? (
          <p className="plan-focus muted small">
            {props.focus.whole ? "Showing the whole system · " : "Showing what the plan touches · "}
            <button
              type="button"
              className="link"
              onClick={() => props.focus?.onWhole(!props.focus.whole)}
            >
              {props.focus.whole ? "Show only what it touches" : "Show the whole system"}
            </button>
          </p>
        ) : null}
        {props.hint ? <p className="plan-hint">{props.hint}</p> : null}
      </div>
      {props.editable && designing ? (
        <div className="plan-actions">
          <button
            type="button"
            className="btn"
            disabled={props.busy || blocked.length > 0}
            title={
              blocked.length
                ? `Settle these first: ${blocked.join(", ")}`
                : "The plan is agreed: the agent writes the tasks and builds it"
            }
            onClick={() => void props.onEdit([{ op: "set", status: "ready" }, { op: "send" }])}
          >
            Mark ready
          </button>
          <SendToAgent
            count={unread}
            disabled={props.busy || !wrote}
            title={
              !wrote
                ? "Click in a box on the map and say what you want there first: you drive the design"
                : unread
                  ? `Hand your ${unread} edit${unread === 1 ? "" : "s"} to the agent: it turns what you want into the model`
                  : "Ask the agent to look again"
            }
            onSend={() => props.onEdit([{ op: "send" }])}
          />
        </div>
      ) : null}
    </header>
  );
}

/** The panel beside the map: the selected box, a sequence, or the plan as a whole. */
export function PlanPanel(props: {
  map: PlanMap;
  model: Model;
  editable: boolean;
  busy: boolean;
  error?: string | undefined;
  selected?: string | undefined;
  onSelect: (key: string | undefined) => void;
  sequence?: string | undefined;
  onSequence: (id: string | undefined) => void;
  at: number;
  onAt: (at: number) => void;
  onEdit: (ops: PlanEditOp[]) => Promise<boolean>;
  /** Opens the popover: on an intent, or in a box to say what's wanted there. */
  onPop: (pop: PlanPop) => void;
}) {
  const { map } = props;
  const error = props.error ? <p className="form-error">{props.error}</p> : null;
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

/** Where an intent stands, in a few words. */
function intentState(pin: IntentPin): string {
  if (pin.resolved) return "settled";
  if (pin.open) return "for the agent";
  return `carried out by ${pin.carried.join(", ")}`;
}

/**
 * The small window that opens where the person clicked on the map: what they
 * want there, in their words. On an intent already there: its text, what
 * carries it out, and the agent's notes on it.
 */
export function IntentPopover(props: {
  map: PlanMap;
  pop: PlanPop;
  editable: boolean;
  busy: boolean;
  onEdit: (ops: PlanEditOp[]) => Promise<boolean>;
  onClose: () => void;
  /** Shows an item of the plan in the panel: a sequence, or a change's box. */
  onItem?: ((id: string) => void) | undefined;
}) {
  const { map, pop } = props;
  const intent = pop.intent ? map.plan.spec.intents.find((i) => i.id === pop.intent) : undefined;
  const pin = pop.intent ? map.pins.find((p) => p.id === pop.intent) : undefined;
  const [text, setText] = useState(intent?.text ?? "");
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    box.current?.focus();
  }, []);
  const ref = (pin?.node ?? pop.node) ? refOf((pin?.node ?? pop.node) as string) : undefined;
  const toKey = pin?.to ?? pop.to;
  const toRef = toKey ? refOf(toKey) : (intent?.to ?? undefined);
  const where = toRef
    ? `${ref ? nameOf(map.after, ref) : "the system"} → ${nameOf(map.after, toRef)}`
    : ref
      ? nameOf(map.after, ref)
      : "the system";
  const notes = intent ? map.plan.spec.notes.filter((n) => n.on === intent.id) : [];
  const save = () => {
    const value = text.trim();
    if (!value || props.busy) return;
    if (intent && value === intent.text) return props.onClose();
    const item: Record<string, unknown> = intent
      ? { ...intent, text: value }
      : {
          ...(ref ? { on: ref } : {}),
          ...(toRef ? { to: toRef } : pop.at ? { at: pop.at } : {}),
          text: value,
        };
    // Close at once: the pin appears when the plan reloads, and an error shows in the panel.
    props.onClose();
    void props.onEdit([{ op: "put", list: "intents", item }]);
  };
  return (
    <div
      className="intent-popover"
      role="dialog"
      aria-label={
        intent
          ? `Intent ${intent.id}`
          : toRef
            ? `What you want between ${where}`
            : `What you want in ${where}`
      }
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          props.onClose();
        }
      }}
    >
      <p className="intent-popover-where">
        {intent ? (
          <>
            <span className="chip plan-chip">{intent.id}</span> {toRef ? "on" : "in"} {where}
          </>
        ) : toRef ? (
          <>What should change between {where}?</>
        ) : (
          <>What do you want in {where}?</>
        )}
      </p>
      {props.editable && !intent?.resolved ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <textarea
            ref={box}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                save();
              }
            }}
            rows={3}
            aria-label="What you want here"
            placeholder={
              toRef
                ? "Send it through a queue, so a slow mailer doesn't hold up checkout"
                : "Email the shopper a receipt once the charge goes through"
            }
          />
          <div className="intent-popover-actions">
            <button
              type="submit"
              className="btn small primary"
              disabled={props.busy || !text.trim()}
            >
              {intent ? "Save" : "Add"}
            </button>
            <button type="button" className="btn small" onClick={props.onClose}>
              {intent ? "Close" : "Cancel"}
            </button>
            {intent ? (
              <button
                type="button"
                className="link small intent-remove"
                disabled={props.busy}
                onClick={() =>
                  void props
                    .onEdit([{ op: "drop", id: intent.id }])
                    .then((ok) => ok && props.onClose())
                }
              >
                Remove
              </button>
            ) : (
              <span className="muted small">Enter to add</span>
            )}
          </div>
        </form>
      ) : (
        <p className="plan-note-text">{intent?.text}</p>
      )}
      {pin ? (
        <p className="muted small intent-popover-state">
          {pin.open || pin.resolved
            ? intentState(pin)
            : pin.carried.map((id, i) => (
                <span key={id}>
                  {i ? ", " : "carried out by "}
                  {props.onItem ? (
                    <button type="button" className="link" onClick={() => props.onItem?.(id)}>
                      {id}
                    </button>
                  ) : (
                    id
                  )}
                </span>
              ))}
          {props.editable && intent && !pin.open ? (
            <>
              {" · "}
              <button
                type="button"
                className="link"
                disabled={props.busy}
                onClick={() =>
                  void props.onEdit([
                    { op: "resolve", note: intent.id, resolved: !intent.resolved },
                  ])
                }
              >
                {intent.resolved ? "reopen" : "settle it"}
              </button>
            </>
          ) : null}
        </p>
      ) : null}
      {notes.length ? (
        <ul className="intent-popover-notes">
          {notes.map((n) => (
            <li key={n.id} className={`intent-note note-${n.kind ?? "note"}`}>
              <strong className="intent-note-kind">{n.kind ?? "note"}:</strong> {n.text}
              <Choices note={n} editable={props.editable} busy={props.busy} onEdit={props.onEdit} />
              {n.replies?.length ? (
                <span className="muted small">
                  {" "}
                  · {n.replies.length} repl{n.replies.length === 1 ? "y" : "ies"}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** The person's intents, each with where it is and where it stands. */
function IntentList(props: PanelProps & { pins: IntentPin[] }) {
  if (!props.pins.length) return null;
  return (
    <ul className="plan-changes plan-intents">
      {props.pins.map((p) => {
        const ref = p.node ? refOf(p.node) : undefined;
        const to = p.to ? refOf(p.to) : undefined;
        const name = (r: string) => nameOf(props.map.after, r);
        return (
          <li
            key={p.id}
            className={`plan-change plan-intent-item${p.open ? " is-open" : ""}${p.resolved ? " is-resolved" : ""}`}
          >
            <button type="button" className="link" onClick={() => props.onPop({ intent: p.id })}>
              {p.id} ·{" "}
              {ref && to
                ? `between ${name(ref)} → ${name(to)}`
                : `in ${ref ? name(ref) : "the system"}`}
            </button>
            <p className="plan-intent">{p.text}</p>
            <p className="muted small">
              {p.open || p.resolved ? intentState(p) : "carried out by"}
            </p>
            {p.carried.length ? (
              <ul className="plan-carried">
                {p.carried.map((id) => {
                  const c = props.map.plan.spec.changes.find((x) => x.id === id);
                  const q = props.map.plan.spec.sequences.find((x) => x.id === id);
                  const item = c ?? q;
                  if (!item) return null;
                  return (
                    <li key={id}>
                      {q ? (
                        <button type="button" className="link" onClick={() => props.onSequence(id)}>
                          {id} · {q.name ?? q.goal ?? q.journey}
                        </button>
                      ) : (
                        <span>
                          {id} · {c ? describeChange(c) : ""}
                        </span>
                      )}
                      <Suggestion {...props} item={item} id={id} />
                    </li>
                  );
                })}
              </ul>
            ) : null}
            <Notes {...props} on={p.id} compact />
          </li>
        );
      })}
    </ul>
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
      {c.for?.length ? <span className="muted small"> for {c.for.join(", ")}</span> : null}
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
  const pins = map.pins.filter((p) => p.node === props.nodeKey);
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
          <h3>What the agent proposes here</h3>
          <ul className="plan-changes">
            {changes.map((c) => (
              <ChangeItem key={c.id} {...props} change={c} />
            ))}
          </ul>
        </section>
      ) : null}
      {pins.length ? (
        <section className="block">
          <h3>What you want here</h3>
          <IntentList {...props} pins={pins} />
        </section>
      ) : null}
      {props.editable ? (
        <button
          type="button"
          className="btn small"
          onClick={() => props.onPop({ node: props.nodeKey })}
        >
          + Say what you want here
        </button>
      ) : null}
      <Notes {...props} on={reference} />
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
          Click in a box on the map where you want something to change, and say what you want there:
          the more you say about how, the closer it follows. Your agent turns it into elements,
          arrows, and flows, asks where you've left a choice open, and you accept or dismiss what it
          proposes.
        </p>
      ) : null}

      <section className="block">
        <h3>
          What you want{" "}
          {s.intents.length ? <span className="muted">{s.intents.length}</span> : null}
        </h3>
        {s.intents.length ? (
          <IntentList {...props} pins={props.map.pins} />
        ) : (
          <p className="muted small">Nothing yet: click in a box on the map.</p>
        )}
      </section>

      <section className="block">
        <h3>
          Changes the agent proposes{" "}
          {s.changes.length ? <span className="muted">{s.changes.length}</span> : null}
        </h3>
        {s.changes.length ? (
          <ul className="plan-changes">
            {s.changes.map((c) => (
              <ChangeItem key={c.id} {...props} change={c} />
            ))}
          </ul>
        ) : (
          <p className="muted small">
            None yet. Once you've said what you want and sent it, your agent proposes the changes
            that carry it out, here and on the map.
          </p>
        )}
      </section>

      {s.sequences.length ? (
        <section className="block">
          <h3>
            Flows the agent proposes <span className="muted">{s.sequences.length}</span>
          </h3>
          <ul className="plan-changes">
            {s.sequences.map((q) => (
              <li key={q.id} className={`plan-change${q.status ? ` is-${q.status}` : ""}`}>
                <button type="button" className="link" onClick={() => props.onSequence(q.id)}>
                  {q.id} · {q.name ?? q.goal ?? q.journey}
                </button>
                <p className="muted small">
                  {q.steps.length} step{q.steps.length === 1 ? "" : "s"} · journey {q.journey}
                  {props.model.journeys.has(q.journey) ? " (changed)" : " (new)"}
                  {q.for?.length ? ` · for ${q.for.join(", ")}` : ""}
                </p>
                <Suggestion {...props} item={q} id={q.id} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

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

/**
 * A question's options as buttons: one tap answers it with that option,
 * settles it, and sends the plan back to the agent.
 */
function Choices(props: {
  note: PlanNote;
  editable: boolean;
  busy: boolean;
  onEdit: (ops: PlanEditOp[]) => Promise<boolean>;
}) {
  const n = props.note;
  const answer = (n.replies ?? []).find((r) => r.kind === "answer");
  if (!n.options?.length || (n.kind ?? "note") !== "question") return null;
  if (answer || n.resolved)
    return answer ? (
      <span className="plan-choice-picked muted small"> · you chose: {answer.text}</span>
    ) : null;
  if (!props.editable) return null;
  return (
    <fieldset className="plan-choices" aria-label={`Answer ${n.id}`}>
      {n.options.map((o) => (
        <button
          key={o}
          type="button"
          className="btn small plan-choice"
          disabled={props.busy}
          onClick={() =>
            void props.onEdit([
              { op: "reply", note: n.id, text: o, kind: "answer" },
              { op: "resolve", note: n.id },
              { op: "send" },
            ])
          }
        >
          {o}
        </button>
      ))}
    </fieldset>
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
      {n.options?.length && !answered && !n.resolved ? (
        <Choices note={n} editable={props.editable} busy={props.busy} onEdit={props.onEdit} />
      ) : null}
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
            placeholder={
              kind === "question" && !answered
                ? n.options?.length
                  ? "Or in your own words"
                  : "Answer"
                : "Reply"
            }
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
