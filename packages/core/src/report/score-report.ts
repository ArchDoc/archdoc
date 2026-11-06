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
    `  ${"System".padEnd(14)} ${pct(d.system)} of containers, datastores, and queues inside a system`,
    `  ${"Step data".padEnd(14)} ${pct(d.stepData)} of steps across a boundary say what they carry`,
    `  ${"Store data".padEnd(14)} ${pct(d.storeData)} of datastores and queues say what they hold`,
    `  ${"Data fields".padEnd(14)} ${pct(d.dataFields)} of data entries have fields or a schema source`,
    `  ${"Journey flow".padEnd(14)} ${pct(d.journeyFlow)} of steps start where the flow already is`,
    ...(d.deployed === undefined
      ? []
      : [
          `  ${"Deployed".padEnd(14)} ${pct(d.deployed)} of containers, datastores, and queues say where they run`,
        ]),
    ...(d.entryPoints === undefined
      ? []
      : [`  ${"Entry points".padEnd(14)} ${pct(d.entryPoints)} reached by a journey`]),
    `  ${"Uses shape".padEnd(14)} ${pct(d.usesShape)} of uses point the right way, at one level`,
    `  ${"Code shape".padEnd(14)} ${pct(d.codeShape)} of elements' code is in their parent's, theirs alone, not one file or generated`,
    ...(d.deploymentMapped === undefined
      ? []
      : [
          `  ${"Deploy mapped".padEnd(14)} ${pct(d.deploymentMapped)} of deployment files an environment or element maps`,
        ]),
    `  ${"Data distinct".padEnd(14)} ${pct(d.dataDistinct)} of data entries aren't numbered copies`,
    `  ${"Code names".padEnd(14)} ${pct(d.codeNames)} of containers and components named as their code is`,
    `  ${"Code precision".padEnd(14)} ${pct(d.codePrecision)} of code elements and steps point at a function or lines`,
    `  ${"Key code".padEnd(14)} ${pct(d.keyCode)} of components name the functions that do their work`,
  ];
  if (verbose && d.journeys.missed.length) {
    out.push(`  missed journeys: ${d.journeys.missed.join(", ")}`);
  }
  return out.join("\n");
}
