import type { Diagnostic, Model, TraceCheck, TraceCodeView } from "@archdoc/core/browser";
import { anchorError, formatDiagnostic, recordsOn } from "@archdoc/core/browser";
import { useMemo, useState } from "react";
import {
  endLabel,
  groupByStatus,
  hopText,
  observedExpected,
  sendToAgent,
  startPrompt,
  statusLabel,
  traceChips,
  traceData,
  traceLanes,
} from "../model/traces.js";
import type { LandscapeInfo } from "../model/useModel.js";
import { type AgentAsk, SendToAgent } from "./Agent.js";
import { type CodeContext, linkTarget, PathLinks } from "./code.js";
import { Lanes } from "./Lanes.js";
import { Payload } from "./Payload.js";

/** The Triage records, grouped by status (what needs looking at first), with a way to start one. */
export function TraceList(props: {
  checks: TraceCheck[];
  problems: Diagnostic[];
  traceId?: string | undefined;
  onTrace: (id: string) => void;
}) {
  return (
    <nav className="side-list" aria-label="Triage records">
      <h2 className="side-title">Triage</h2>
      <button
        type="button"
        className={`side-item triage-start-item${props.traceId === NEW ? " is-active" : ""}`}
        aria-current={props.traceId === NEW ? "true" : undefined}
        onClick={() => props.onTrace(NEW)}
      >
        <span className="side-item-label">
          + Start a triage
          <span className="side-item-sub">
            Paste the bug and send it to your agent, which follows it to the root cause
          </span>
        </span>
      </button>
      {groupByStatus(props.checks).map((g) => (
        <div key={g.status} className="triage-group">
          <h3 className={`triage-group-title status-${g.status}`}>
            {g.label} <span className="muted">{g.checks.length}</span>
          </h3>
          {g.checks.map((c) => (
            <button
              key={c.view.id}
              type="button"
              className={`side-item${props.traceId === c.view.id ? " is-active" : ""}`}
              aria-current={props.traceId === c.view.id ? "true" : undefined}
              onClick={() => props.onTrace(c.view.id)}
            >
              <span className="side-item-label">
                {c.view.title}
                <span className="side-item-sub">
                  {c.view.severity ? (
                    <span className={`severity severity-${c.view.severity}`}>
                      {c.view.severity}
                    </span>
                  ) : null}
                  {c.view.anchor
                    ? `${c.view.anchor.journey} · step ${c.view.anchor.step}`
                    : c.view.id}
                </span>
              </span>
            </button>
          ))}
        </div>
      ))}
      {props.problems.length ? (
        <div className="trace-problems">
          <p className="muted small">Files the explorer couldn't read as Triage records:</p>
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

/** The ID that opens the start panel instead of a record. */
export const NEW = "new";

/**
 * A Triage record: a small header with the root cause in brief (the report
 * on asking; the leads are the agent's working, not shown), then the bug's
 * journey, on the map (the `map` given) or as lanes beneath the journey step
 * it opens up, with the cause marked.
 */
export function TraceStory(props: {
  model: Model;
  check: TraceCheck;
  at: number;
  onAt: (at: number) => void;
  landscape?: LandscapeInfo | undefined;
  /** The map, walking through the bug; without it, lanes. */
  map?: React.ReactNode;
  sequence: boolean;
  onSequence: (sequence: boolean) => void;
  /** Whether the record can be sent to the agent from here (archdoc view). */
  editable?: boolean | undefined;
  /** Sent it to the agent: reload to show it. */
  onSent?: (() => Promise<void>) | undefined;
}) {
  const { model, check, landscape } = props;
  const [error, setError] = useState<string>();
  const sent = check.trace.spec.sent ?? 0;
  const v = check.view;
  const lanes = useMemo(() => traceLanes(model, v, landscape), [model, v, landscape]);
  // The header stays small, so the map has the room: the root cause in brief, the report on asking.
  const [open, setOpen] = useState(false);
  return (
    <section className="story trace-story" aria-label="Triage record">
      <header className="trace-head">
        <div className="story-head">
          <div className="story-title">
            <h1>{v.title}</h1>
            <p className="muted triage-meta">
              <span className={`triage-status status-${v.status}`}>{statusLabel(v.status)}</span>
              {v.severity ? (
                <span className={`severity severity-${v.severity}`}>{v.severity}</span>
              ) : null}
              {v.reported?.by ? <span>reported by {v.reported.by}</span> : null}
              {v.reported?.at ? <span>on {v.reported.at}</span> : null}
              {v.reported?.link ? (
                <a href={v.reported.link} target="_blank" rel="noreferrer">
                  the report
                </a>
              ) : null}
              {traceChips(v).map((c) => (
                <span key={c.label} className={`chip trace-chip chip-${c.kind}`}>
                  {c.label}
                </span>
              ))}
            </p>
          </div>
          <div className="plan-actions">
            {v.steps.length ? (
              <fieldset className="segmented story-view" aria-label="Show the bug as">
                <legend>Show as</legend>
                {(
                  [
                    [false, "Map", "Each step of the bug on the map of the system, one at a time"],
                    [true, "Sequence", "Each step as a row, beneath the journey step it opens up"],
                  ] as const
                ).map(([seq, label, title]) => (
                  <button
                    key={label}
                    type="button"
                    className={props.sequence === seq ? "is-on" : undefined}
                    aria-pressed={props.sequence === seq}
                    title={title}
                    onClick={() => props.onSequence(seq)}
                  >
                    {label}
                  </button>
                ))}
              </fieldset>
            ) : null}
            {props.editable ? (
              <SendToAgent
                title="Hand the bug to your agent again, with what you want now"
                asks={sendAsks(v.status)}
                onSend={async (ask) => {
                  setError(undefined);
                  const r = await sendToAgent({ id: v.id, ask });
                  if (!r.ok) {
                    setError(r.error);
                    return false;
                  }
                  await props.onSent?.();
                  return true;
                }}
              />
            ) : null}
          </div>
        </div>
        {sent || error ? (
          <p className={error ? "form-error" : "plan-hint"}>
            {error ??
              `Sent to your agent${sent > 1 ? ` ${sent}×` : ""}${check.trace.spec.ask ? `, asking: ${check.trace.spec.ask}` : ""}. ${(check.trace.spec.received ?? 0) >= sent ? "Your agent has it." : "It picks it up with archdoc triage wait, or tell it in the chat."}`}
          </p>
        ) : null}
        <div className="trace-rca">
          <p
            className={`trace-rca-text${open ? " is-open" : ""}`}
            title={open ? undefined : v.diagnosis}
          >
            <span className="trace-rca-label">
              Root cause{v.causes.length ? ` · step ${v.causes.join(", ")}` : ""}
            </span>{" "}
            {v.diagnosis ?? <span className="muted">Not found yet.</span>}
          </p>
          {v.fixDetail ? (
            <p className="trace-rca-text trace-fix">
              <span className="trace-rca-label">Fix</span> {v.fixDetail.summary}
              {v.fixDetail.link ? (
                <>
                  {" "}
                  <a href={v.fixDetail.link} target="_blank" rel="noreferrer">
                    (the change)
                  </a>
                </>
              ) : null}
            </p>
          ) : null}
          <button
            type="button"
            className="link trace-more"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            {open ? "Less" : "The report"}
          </button>
        </div>
        {open ? (
          <div className="trace-log">
            <p className="trace-log-label">What you gave the agent</p>
            <pre>{v.symptom.trimEnd()}</pre>
            {v.reproduce ? (
              <p className="trace-reproduce">
                <span aria-hidden="true">$ </span>
                <code>{v.reproduce}</code>
              </p>
            ) : null}
            {v.attachments.length ? (
              <p className="muted small">Attached: {v.attachments.join(", ")}</p>
            ) : null}
          </div>
        ) : null}
      </header>
      <div className="story-body">
        {!v.steps.length ? (
          <p className="empty-main">
            No steps yet. The agent adds a step for each hop the failing request took as it follows
            the code.
          </p>
        ) : !props.sequence && props.map ? (
          props.map
        ) : (
          <Lanes data={lanes} at={props.at} onAt={props.onAt} />
        )}
      </div>
    </section>
  );
}

/**
 * Starting a triage: paste an error and see where it belongs (the journey
 * steps it likely showed up in, the elements it names, and records already
 * on them), then send it to the agent, which writes the record and follows
 * it. A read-only explorer gives the command instead.
 */
export function TriageStart(props: {
  model: Model;
  files: readonly string[];
  checks: TraceCheck[];
  onJourney: (id: string) => void;
  onTrace: (id: string) => void;
  onSelect: (key: string) => void;
  /** Whether bugs can be sent to the agent from here (archdoc view). */
  editable?: boolean | undefined;
  /** A bug was sent: its record's ID, to open once it's loaded. */
  onSent?: ((id: string) => void) | undefined;
}) {
  const [text, setText] = useState("");
  const [copied, setCopied] = useState<string>();
  const [error, setError] = useState<string>();
  const result = useMemo(
    () =>
      text.trim()
        ? anchorError(props.model, text, props.files.length ? { files: props.files } : {})
        : undefined,
    [props.model, props.files, text],
  );
  const known = useMemo(() => {
    if (!result) return [];
    const ids = result.elements.map((e) => e.element);
    const own = `${props.model.namespace}.`;
    const local = ids.map((id) => (id.startsWith(own) ? id.slice(own.length) : id));
    const steps = new Set(result.anchors.map((a) => `${a.journey}#${a.step}`));
    const on = new Set(recordsOn(props.checks, local, { closed: true }).map((c) => c.view.id));
    return props.checks.filter(
      (c) => on.has(c.view.id) || (c.view.anchor && steps.has(c.view.anchor.written)),
    );
  }, [result, props.checks, props.model]);
  const send = async (ask?: string): Promise<boolean> => {
    if (!text.trim()) return false;
    setError(undefined);
    const r = await sendToAgent({ symptom: text, ask });
    if (!r.ok) {
      setError(r.error);
      return false;
    }
    setText("");
    props.onSent?.(r.id);
    return true;
  };
  const hand = startPrompt(text);
  const copy = (what: string, value: string) => {
    void navigator.clipboard?.writeText(value).then(() => setCopied(what));
  };
  return (
    <section className="story triage-start" aria-label="Start a triage">
      <header className="story-head">
        <div className="story-title">
          <h1>Start a triage</h1>
          <p className="muted">
            Paste the bug: an error, a stack trace, a log, or what went wrong. The explorer places
            it on the system; send it to your agent, and it follows it to the root cause and writes
            the record.
          </p>
        </div>
      </header>
      {error ? <p className="form-error">{error}</p> : null}
      <div className="triage-start-body">
        <label className="triage-paste">
          <span className="sr-only">The bug</span>
          <textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setCopied(undefined);
            }}
            placeholder={
              "TypeError: Cannot read properties of undefined (reading 'id')\n    at saveOrder (services/api/orders/save.ts:42:7)"
            }
            rows={8}
            spellCheck={false}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && props.editable) {
                e.preventDefault();
                void send(sendAsks()[0]?.ask);
              }
            }}
          />
        </label>
        {props.editable ? (
          <div className="form-actions">
            <SendToAgent
              disabled={!text.trim()}
              title="Write the record and hand the bug to your agent"
              asks={sendAsks()}
              onSend={send}
            />
            <span className="muted small">
              Writes the record; your agent picks it up with archdoc triage wait.
            </span>
          </div>
        ) : null}
        {error ? <p className="form-error">{error}</p> : null}
        {result ? (
          <div className="triage-placed">
            <section className="block">
              <h3>Where it likely showed up</h3>
              {result.anchors.length ? (
                <ol className="triage-anchors">
                  {result.anchors.map((a) => (
                    <li key={`${a.journey}#${a.step}`}>
                      <button
                        type="button"
                        className="link"
                        onClick={() => props.onJourney(a.journey)}
                      >
                        {a.journey} · step {a.step}
                      </button>{" "}
                      <span className={`importance importance-${a.importance}`}>
                        {a.importance}
                      </span>
                      <span className="muted">
                        {" "}
                        {a.from} → {a.to}
                        {a.action ? `: ${a.action}` : ""}
                      </span>
                      {a.reasons[0] ? <p className="muted small">{a.reasons[0]}</p> : null}
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="muted">
                  {result.elements.length
                    ? "No journey step goes through what the error names."
                    : "Nothing in it maps to the model yet: paste the stack trace, or name the files."}
                </p>
              )}
            </section>
            {result.elements.length ? (
              <section className="block">
                <h3>What it names</h3>
                <ul className="triage-elements">
                  {result.elements.map((e) => (
                    <li key={e.element}>
                      <button
                        type="button"
                        className="link"
                        onClick={() => props.onSelect(`element:${localOf(props.model, e.element)}`)}
                      >
                        {e.element}
                      </button>
                      <span className="muted small"> · {e.evidence.slice(0, 2).join("; ")}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {known.length ? (
              <section className="block">
                <h3>Already triaged there</h3>
                <ul className="triage-known">
                  {known.map((c) => (
                    <li key={c.view.id}>
                      <button
                        type="button"
                        className="link"
                        onClick={() => props.onTrace(c.view.id)}
                      >
                        {c.view.title}
                      </button>
                      <span className="muted small"> · {statusLabel(c.view.status)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {props.editable ? null : (
              <section className="block">
                <h3>Hand it to your agent</h3>
                <p className="muted small">
                  This explorer is read-only. Run <code>{hand.command}</code>, or give your agent
                  this:
                </p>
                <pre className="triage-prompt">{hand.prompt}</pre>
                <div className="triage-copy">
                  <button type="button" className="btn" onClick={() => copy("prompt", hand.prompt)}>
                    {copied === "prompt" ? "Copied" : "Copy the prompt"}
                  </button>
                </div>
              </section>
            )}
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** What to ask the agent about a bug, by where it stands: the main ask first. */
function sendAsks(status?: string): AgentAsk[] {
  if (status === "root-caused")
    return [
      { label: "Send to agent: fix it", ask: "Fix it" },
      { label: "Look again", ask: "Look again" },
    ];
  if (status === "fixed")
    return [{ label: "Send to agent: it's back", ask: "It's back: look again" }];
  return [
    { label: "Send to agent: find the root cause", ask: "Find the root cause" },
    { label: "Find and fix it", ask: "Find the root cause and fix it" },
  ];
}

function localOf(model: Model, id: string): string {
  const own = `${model.namespace}.`;
  return id.startsWith(own) ? id.slice(own.length) : id;
}

/** The selected hop: what it does, its code, what was observed and expected, and how sure. */
export function TraceStepPanel(props: {
  model: Model;
  check: TraceCheck;
  at: number;
  onAt: (at: number) => void;
  code: CodeContext;
  onSelect?: ((key: string) => void) | undefined;
}) {
  const { model, check, at } = props;
  const v = check.view;
  const s = v.steps[at];
  if (!s) return <div className="details" />;
  const rows = observedExpected(s);
  const carried = traceData(model, v, at);
  const findings = check.findings;
  return (
    <div className="details step-panel">
      <p className="step-where">
        Step {s.step} of {v.steps.length}
        {v.anchor?.modeled && s.within ? ` · inside step ${v.anchor.step}` : ""}
      </p>
      <h2 className="step-title">
        {s.action ?? `${endLabel(model, s.from)} → ${endLabel(model, s.to)}`}
      </h2>
      <p className="step-ends">
        {endLabel(model, s.from)}
        <span className="arrow"> → </span>
        {endLabel(model, s.to)}
      </p>
      <div className="chips">
        {s.role !== "ok" ? (
          <span className={`chip trace-chip role-${s.role}`}>
            {s.role === "symptom" ? "symptom: matches your log" : s.role}
          </span>
        ) : null}
        <span className={`chip trace-chip evidence-${s.evidence}`} title={EVIDENCE[s.evidence]}>
          {s.evidence}
        </span>
        {s.hop.kind === "undeclared" ? (
          <span className="chip trace-chip chip-undeclared">not in the model</span>
        ) : null}
      </div>
      <p className="muted small">{hopText(model, s)}</p>
      {s.description ? <p className="lede">{s.description}</p> : null}

      {carried.sends.length ? (
        <section className="block">
          <h3>What it carries</h3>
          <Payload key={`${v.id}${at}`} entries={carried.sends} onSelect={props.onSelect} />
          {carried.written ? null : (
            <p className="muted small">
              As the model says the use carries it; the record doesn't say.
            </p>
          )}
        </section>
      ) : null}
      {carried.writes.length ? (
        <section className="block">
          <h3>What it writes</h3>
          <Payload key={`${v.id}${at}w`} entries={carried.writes} onSelect={props.onSelect} />
        </section>
      ) : null}
      {!carried.sends.length && !carried.writes.length && s.from.id !== s.to.id ? (
        <p className="muted small">
          The record doesn't say what this step carries. The agent adds <code>sends:</code> with the
          data entry, and <code>observed:</code> with the values the run had.
        </p>
      ) : null}

      {rows.length ? (
        <section className="block">
          <h3>Observed and expected</h3>
          <table className="observed">
            <thead>
              <tr>
                <th scope="col" />
                <th scope="col">Observed</th>
                <th scope="col">Expected</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <th scope="row">
                    <code>{r.key}</code>
                  </th>
                  <td
                    className={
                      r.expected !== undefined && r.observed !== r.expected ? "is-wrong" : undefined
                    }
                  >
                    <code>{r.observed ?? "—"}</code>
                  </td>
                  <td>
                    <code>{r.expected ?? "—"}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      {s.missing ? (
        <section className="block">
          <h3>Missing</h3>
          <p>
            {endLabel(model, s.missing.from)} should call{" "}
            {s.missing.call ? <code>{s.missing.call}</code> : null} in{" "}
            {endLabel(model, s.missing.to)}
            {s.missing.description ? `: ${s.missing.description}` : ""}.
          </p>
        </section>
      ) : null}

      {s.code.length ? (
        <section className="block">
          <h3>Code</h3>
          <CodeRefs refs={s.code} ctx={props.code} />
        </section>
      ) : null}

      {v.worksIn && at === v.steps.length - 1 ? (
        <section className="block">
          <h3>Same job, done right</h3>
          <p>
            {endLabel(model, v.worksIn.element)}
            {v.worksIn.note ? ` ${v.worksIn.note}` : ""}
          </p>
          <CodeRefs refs={v.worksIn.code} ctx={props.code} />
        </section>
      ) : null}

      {findings.length ? (
        <section className="block">
          <h3>What the check found</h3>
          <ul className="trace-findings">
            {findings.map((f) => (
              <li
                key={`${f.code}${f.message}`}
                className={`sev-${f.severity}${f.step === s.step ? " is-here" : ""}`}
              >
                {f.message}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <nav className="step-nav" aria-label="Steps">
        <button
          type="button"
          className="btn"
          disabled={at === 0}
          onClick={() => props.onAt(at - 1)}
        >
          ← Back
        </button>
        <span className="muted">
          {at + 1} / {v.steps.length}
        </span>
        <button
          type="button"
          className="btn primary"
          disabled={at >= v.steps.length - 1}
          onClick={() => props.onAt(at + 1)}
        >
          Next →
        </button>
      </nav>
    </div>
  );
}

const EVIDENCE = {
  reproduced: "Seen in a run",
  read: "Followed in the code",
  inferred: "Neither run nor read: a guess",
} as const;

/** A trace's code references, linked like an element's code. */
function CodeRefs({ refs, ctx }: { refs: TraceCodeView[]; ctx: CodeContext }) {
  return (
    <ul className="code-list">
      {refs.map((c) => {
        const t = linkTarget(c.path, ctx.files);
        return (
          <li key={c.label}>
            {c.exists === false ? (
              <span className="code-missing">
                No file <code>{c.path}</code>
              </span>
            ) : (
              <>
                <code>{c.label}</code>
                {c.problem ? (
                  <span className="code-missing">{c.problem}</span>
                ) : (
                  <PathLinks repo={ctx.repo} path={t.path} isFile={t.isFile} lines={c.lines} />
                )}
              </>
            )}
            {c.description ? <p>{c.description}</p> : null}
          </li>
        );
      })}
    </ul>
  );
}
