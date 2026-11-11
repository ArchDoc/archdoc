/* The Build tabs that aren't open yet: what each will do. */

const SOON = {
  plan: {
    title: "Plan",
    lead: "Plan a change on the model before you write the code.",
    body: "Describe what you want to build, and see the elements, journeys, and data it touches, who owns them, and what to check, before the first commit.",
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
