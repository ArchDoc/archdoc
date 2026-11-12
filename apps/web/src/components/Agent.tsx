import { useState } from "react";

/** One thing to ask the agent: the button's words, and what it asks. */
export interface AgentAsk {
  label: string;
  ask: string;
}

/**
 * The hand-off every Build tab ends in: Send to agent. With `asks`, one
 * button per thing to ask, the first as the main one (Send to agent: find
 * the root cause, then Find and fix it); without, one Send to agent button.
 */
export function SendToAgent(props: {
  /** Edits the agent hasn't seen, shown on the button. */
  count?: number | undefined;
  disabled?: boolean | undefined;
  title?: string | undefined;
  asks?: readonly AgentAsk[] | undefined;
  onSend: (ask?: string) => Promise<boolean>;
}) {
  const [busy, setBusy] = useState(false);
  const send = (ask?: string) => {
    setBusy(true);
    void props.onSend(ask).finally(() => setBusy(false));
  };
  const count = props.count ? ` (${props.count})` : "";
  if (!props.asks?.length)
    return (
      <button
        type="button"
        className="btn primary"
        disabled={props.disabled || busy}
        title={props.title}
        onClick={() => send()}
      >
        Send to agent{count}
      </button>
    );
  return (
    <div className="send-agent">
      {props.asks.map((a, i) => (
        <button
          key={a.ask}
          type="button"
          className={i === 0 ? "btn primary" : "btn"}
          disabled={props.disabled || busy}
          title={props.title}
          onClick={() => send(a.ask)}
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}
