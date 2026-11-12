import { useEffect, useRef, useState } from "react";

/**
 * The hand-off every Build tab ends in: Send to agent. With `asks`, it opens
 * a small popover under the button to say what you want this time (a quick
 * pick, or your own words); without, it sends at once.
 */
export function SendToAgent(props: {
  /** Edits the agent hasn't seen, shown on the button. */
  count?: number | undefined;
  disabled?: boolean | undefined;
  title?: string | undefined;
  /** Quick picks for what to ask; the popover opens with them. */
  asks?: readonly string[] | undefined;
  placeholder?: string | undefined;
  onSend: (ask?: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [ask, setAsk] = useState("");
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (open) box.current?.focus();
  }, [open]);
  const send = (what?: string) => {
    setBusy(true);
    void props.onSend(what?.trim() || undefined).then((ok) => {
      setBusy(false);
      if (ok) {
        setOpen(false);
        setAsk("");
      }
    });
  };
  return (
    <div className="send-agent">
      <button
        type="button"
        className="btn primary"
        disabled={props.disabled || busy}
        title={props.title}
        aria-expanded={props.asks ? open : undefined}
        onClick={() => (props.asks ? setOpen(!open) : send())}
      >
        Send to agent{props.count ? ` (${props.count})` : ""}
      </button>
      {open && props.asks ? (
        <div
          className="intent-popover send-agent-popover"
          role="dialog"
          aria-label="What to ask the agent"
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
        >
          <p className="intent-popover-where">What do you want from your agent?</p>
          <div className="send-agent-asks">
            {props.asks.map((a) => (
              <button
                key={a}
                type="button"
                className="btn small"
                disabled={busy}
                onClick={() => send(a)}
              >
                {a}
              </button>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(ask);
            }}
          >
            <textarea
              ref={box}
              value={ask}
              onChange={(e) => setAsk(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (ask.trim()) send(ask);
                }
              }}
              rows={2}
              aria-label="Or in your own words"
              placeholder={props.placeholder ?? "Or in your own words"}
            />
            <div className="intent-popover-actions">
              <button type="submit" className="btn small primary" disabled={busy || !ask.trim()}>
                Send
              </button>
              <button type="button" className="btn small" onClick={() => setOpen(false)}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
