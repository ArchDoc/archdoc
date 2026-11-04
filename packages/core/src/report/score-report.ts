import type { DiscoveryScore, ModelScore, ScoreCount } from "../query/score.js";

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

/** How well a model was discovered (scoreDiscovery), as text. */
export function formatDiscoveryScore(d: DiscoveryScore, verbose = false): string {
  const out = [
    `Discovery ${pct(d.overall)}${d.gaps ? `, ${d.gaps} thing${d.gaps === 1 ? "" : "s"} archdoc check --done still lists` : ""}`,
    d.journeys.expected
      ? `  ${"Journeys".padEnd(14)} recall ${pct(d.journeys.recall).padStart(4)} (${d.journeys.matched}/${d.journeys.expected}), ${d.journeys.found} in the model`
      : `  ${"Journeys".padEnd(14)} ${d.journeys.found} in the model`,
    `  ${"Journey depth".padEnd(14)} ${pct(d.journeyDepth)} of journeys are long enough and reach where they end`,
    `  ${"Step detail".padEnd(14)} ${pct(d.stepDetail)} of steps have an action and code that exists`,
    `  ${"Step depth".padEnd(14)} ${pct(d.stepPrecision)} of steps name the most specific element`,
    `  ${"Tests left out".padEnd(14)} ${pct(d.testExclusion)} of test and verification files`,
    `  ${"Mapped".padEnd(14)} ${pct(d.mapped)} of source files belong to an element`,
    `  ${"Connected".padEnd(14)} ${pct(d.connected)} of elements`,
    `  ${"Described".padEnd(14)} ${pct(d.described)} of elements`,
  ];
  if (verbose && d.journeys.missed.length) {
    out.push(`  missed journeys: ${d.journeys.missed.join(", ")}`);
  }
  return out.join("\n");
}
