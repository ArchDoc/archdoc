import type { ModelScore, ScoreCount } from "../query/score.js";

// A model's score against a golden one, as text: what the init and agent
// evals print for each fixture.

const pct = (x: number) => `${Math.round(x * 100)}%`;

const counts = (label: string, c: ScoreCount) =>
  `  ${label.padEnd(14)} recall ${pct(c.recall).padStart(4)} (${c.matched}/${c.expected})  precision ${pct(c.precision).padStart(4)}  F1 ${pct(c.f1).padStart(4)}`;

export function formatScore(s: ModelScore, verbose = false): string {
  const out = [
    `Overall ${pct(s.overall)}${s.errors ? `, but the model has ${s.errors} error${s.errors === 1 ? "" : "s"}` : ""}`,
    counts("Containers", s.containers),
    counts("Components", s.components),
    counts("Datastores", s.datastores),
    counts("Uses", s.relationships),
    `  ${"Nesting".padEnd(14)} ${pct(s.nesting.ratio)} (${s.nesting.correct}/${s.nesting.checked}) under the right parent`,
    `  ${"Code".padEnd(14)} ${pct(s.code.accuracy)} placed (${s.code.placed}/${s.code.total}), ${pct(s.code.coverage)} covered`,
    `  ${"Kinds".padEnd(14)} ${pct(s.kindAgreement)} of matched containers and components have the golden kind`,
  ];
  if (verbose) {
    const list = (label: string, items: string[]) => {
      if (items.length) out.push(`  ${label}: ${items.join(", ")}`);
    };
    list("missing", s.missing);
    list("extra", s.extra);
    list(
      "misnested",
      s.misnested.map(
        (m) =>
          `${m.found} under ${m.foundParent ?? "the top"}, not ${m.expectedParent ?? "the top"}`,
      ),
    );
    list("missed uses", s.missedUses);
    list("extra uses", s.extraUses);
  }
  return out.join("\n");
}
