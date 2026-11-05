/* The Build tabs that aren't open yet: what each will do. */

const SOON = {
  plan: {
    title: "Plan",
    lead: "Plan a change on the model before you write the code.",
    body: "Describe what you want to build, and see the elements, journeys, and data it touches, who owns them, and what to check, before the first commit.",
  },
  triage: {
    title: "Triage",
    lead: "Place a bug in the system and follow it to its cause.",
    body: "Paste an error or a stack trace to see the journey steps it most likely showed up in, the elements its frames map to, and the traces already written for it.",
  },
} as const;

export function Soon({ tab }: { tab: keyof typeof SOON }) {
  const s = SOON[tab];
  return (
    <section className="soon" aria-label={s.title}>
      <div className="soon-card">
        <p className="soon-badge">Coming soon</p>
        <h1>{s.title}</h1>
        <p className="soon-lead">{s.lead}</p>
        <p className="muted">{s.body}</p>
      </div>
    </section>
  );
}
