import { assessDiscovery, type DiscoveryOptions } from "../check/discovery.js";
import { filesUnder, locate, resolveCodeMap } from "../codemap/codemap.js";
import type { ElementNode, JourneyNode, Model } from "../model.js";

// How close a model is to one a person wrote for the same repository: are its
// containers, components, datastores, code, nesting, and uses the ones the
// person's model has. Elements are matched by the files they cover, not by
// their IDs, since two people (or an agent) rarely name things the same way.
// Deterministic: the evals for archdoc init and for the agent that finishes
// its model both score with it.

/** Precision and recall for one kind of thing. */
export interface ScoreCount {
  /** In the golden model. */
  expected: number;
  /** In the scored model. */
  found: number;
  /** Matched pairs. */
  matched: number;
  precision: number;
  recall: number;
  f1: number;
}

export interface ElementMatch {
  golden: string;
  found: string;
  /** Jaccard overlap of the files each covers; 1 for datastores matched by name. */
  overlap: number;
  /** Whether both have the same kind. */
  sameKind: boolean;
}

export interface Misnested {
  golden: string;
  found: string;
  /** Where the golden model puts it: the found element its golden parent matched, or undefined at the top. */
  expectedParent?: string | undefined;
  /** Where the scored model puts it. */
  foundParent?: string | undefined;
}

export interface ModelScore {
  containers: ScoreCount;
  components: ScoreCount;
  /** Datastores and queues. */
  datastores: ScoreCount;
  /** Uses between elements, each lifted to the nearest element both models share. */
  relationships: ScoreCount;
  nesting: { checked: number; correct: number; ratio: number };
  code: {
    /** Source files the golden model maps. */
    total: number;
    /** Of those, files the scored model maps to any element. */
    covered: number;
    /** Of those, files the scored model maps to the element the golden one does (at the depth it goes to). */
    placed: number;
    coverage: number;
    accuracy: number;
  };
  /** Matched pairs whose kinds agree, of matched containers and components. */
  kindAgreement: number;
  /** Errors the scored model has; a model with errors isn't usable whatever it scores. */
  errors: number;
  /** One number from 0 to 1: the mean of the F1s, nesting, and code accuracy that apply. */
  overall: number;
  matches: ElementMatch[];
  missing: string[];
  extra: string[];
  misnested: Misnested[];
  missedUses: string[];
  extraUses: string[];
}

export interface ScoreOptions {
  /** Least file overlap for two elements to match, from 0 to 1. Default 0.5. */
  minOverlap?: number | undefined;
}

const STRUCTURAL = new Set(["system", "container", "component"]);
const STORE = new Set(["datastore", "queue"]);

/**
 * Scores `found` against `golden`, a model a person wrote for the same
 * repository. `files` are the repository's files, relative to its root.
 */
export function scoreModel(
  found: Model,
  golden: Model,
  files: readonly string[],
  options: ScoreOptions = {},
): ModelScore {
  const minOverlap = options.minOverlap ?? 0.5;
  const gMap = resolveCodeMap(golden, files);
  const fMap = resolveCodeMap(found, files);
  const subtree = (m: Model, map: typeof gMap) => {
    const out = new Map<string, Set<string>>();
    for (const id of m.elements.keys()) {
      const s = new Set(filesUnder(m, map, id));
      if (s.size) out.set(id, s);
    }
    return out;
  };
  const gFiles = subtree(golden, gMap);
  const fFiles = subtree(found, fMap);

  // 1. Match elements with code by the files they cover, best overlap first.
  const pairs: { g: ElementNode; f: ElementNode; overlap: number }[] = [];
  for (const [gid, gs] of gFiles) {
    for (const [fid, fs] of fFiles) {
      let both = 0;
      for (const x of gs) if (fs.has(x)) both++;
      if (!both) continue;
      const overlap = both / (gs.size + fs.size - both);
      const g = el(golden, gid);
      const f = el(found, fid);
      if (overlap >= minOverlap && group(g) === group(f)) pairs.push({ g, f, overlap });
    }
  }
  pairs.sort(
    (a, b) =>
      b.overlap - a.overlap ||
      Number(b.g.spec.kind === b.f.spec.kind) - Number(a.g.spec.kind === a.f.spec.kind) ||
      Math.abs(a.g.depth - a.f.depth) - Math.abs(b.g.depth - b.f.depth) ||
      Number(b.g.key === b.f.key) - Number(a.g.key === a.f.key) ||
      a.g.id.localeCompare(b.g.id) ||
      a.f.id.localeCompare(b.f.id),
  );
  const g2f = new Map<string, string>();
  const f2g = new Map<string, string>();
  const matches: ElementMatch[] = [];
  const pair = (g: ElementNode, f: ElementNode, overlap: number) => {
    g2f.set(g.id, f.id);
    f2g.set(f.id, g.id);
    matches.push({ golden: g.id, found: f.id, overlap, sameKind: g.spec.kind === f.spec.kind });
  };
  for (const p of pairs) {
    if (!g2f.has(p.g.id) && !f2g.has(p.f.id)) pair(p.g, p.f, p.overlap);
  }

  // 2. Datastores, queues, and externals often have no code (or only their
  // migrations): match the rest by name or technology.
  const unmatched = (m: Model, matched: Map<string, string>) =>
    [...m.elements.values()].filter(
      (e) => !matched.has(e.id) && (STORE.has(e.spec.kind) || e.spec.kind === "external"),
    );
  const fStores = unmatched(found, f2g);
  for (const g of unmatched(golden, g2f)) {
    const f = fStores.find((c) => !f2g.has(c.id) && group(c) === group(g) && sameThing(g, c));
    if (f) pair(g, f, 1);
  }

  // The nearest element, from `id` up, that the other model has too.
  const nearest = (m: Model, matched: Map<string, string>, id: string | undefined) => {
    for (let e = id ? m.elements.get(id) : undefined; e; e = parent(m, e)) {
      if (matched.has(e.id)) return e.id;
    }
    return undefined;
  };

  // 3. Counts per kind, by the golden model's kind for recall and the scored model's for precision.
  const count = (kinds: Set<string>): ScoreCount => {
    const scored = (m: Model, covered: Map<string, Set<string>>) =>
      [...m.elements.values()].filter(
        (e) => kinds.has(e.spec.kind) && (STORE.has(e.spec.kind) || covered.has(e.id)),
      );
    const want = scored(golden, gFiles);
    const have = scored(found, fFiles);
    return ratios(
      want.length,
      have.length,
      want.filter((e) => g2f.has(e.id)).length,
      have.filter((e) => f2g.has(e.id)).length,
    );
  };
  const containers = count(new Set(["container"]));
  const components = count(new Set(["component"]));
  const datastores = count(STORE);

  // 4. Nesting: each matched element sits under the element its golden parent matched.
  const misnested: Misnested[] = [];
  let checked = 0;
  for (const m of matches) {
    const g = el(golden, m.golden);
    if (!STRUCTURAL.has(g.spec.kind) && !STORE.has(g.spec.kind)) continue;
    if (g.spec.kind === "system") continue;
    checked++;
    const ga = nearest(golden, g2f, g.parentId);
    const expectedParent = ga ? g2f.get(ga) : undefined;
    const foundParent = nearest(found, f2g, el(found, m.found).parentId);
    if (expectedParent !== foundParent) {
      misnested.push({ golden: m.golden, found: m.found, expectedParent, foundParent });
    }
  }

  // 5. Code: each file the golden model maps, in the same place in the scored one.
  let total = 0;
  let covered = 0;
  let placed = 0;
  for (const file of files) {
    const gOwner = locate(golden, file).element;
    if (!gOwner) continue;
    total++;
    const fOwner = locate(found, file).element;
    if (!fOwner) continue;
    covered++;
    const gm = nearest(golden, g2f, gOwner.id);
    if (gm && g2f.get(gm) === nearest(found, f2g, fOwner.id)) placed++;
  }

  // 6. Uses. Recall is at the golden model's resolution: a use whose ends the
  // scored model doesn't have is missed. Precision lifts each end to the
  // nearest element the golden model has, so a use from a component the
  // golden model doesn't split out still counts when its container's is right.
  const edges = (m: Model) => {
    const out = new Map<string, [string, string]>();
    for (const r of m.relationships) {
      if (r.from.type === "element" && r.to.type === "element") {
        out.set(`${r.from.id} -> ${r.to.id}`, [r.from.id, r.to.id]);
      }
    }
    return [...out.values()];
  };
  const lifted = (m: Model, matched: Map<string, string>, toFound: (id: string) => string) => {
    const out = new Set<string>();
    for (const [from, to] of edges(m)) {
      const a = nearest(m, matched, from);
      const b = nearest(m, matched, to);
      if (!a || !b || a === b || within(m, a, b) || within(m, b, a)) continue;
      out.add(`${toFound(a)} -> ${toFound(b)}`);
    }
    return out;
  };
  const fUses = lifted(found, f2g, (id) => id);
  const gUses = lifted(golden, g2f, (id) => g2f.get(id) as string);
  const gEdges = edges(golden);
  const missedUses = gEdges
    .filter(([from, to]) => {
      const a = g2f.get(from);
      const b = g2f.get(to);
      return !a || !b || !fUses.has(`${a} -> ${b}`);
    })
    .map(([from, to]) => `${from} -> ${to}`);
  const relationships = ratios(
    gEdges.length,
    fUses.size,
    gEdges.length - missedUses.length,
    [...fUses].filter((u) => gUses.has(u)).length,
  );

  const structural = matches.filter((m) => {
    const k = el(golden, m.golden).spec.kind;
    return k === "container" || k === "component";
  });
  const nesting = {
    checked,
    correct: checked - misnested.length,
    ratio: frac(checked - misnested.length, checked),
  };
  const code = {
    total,
    covered,
    placed,
    coverage: frac(covered, total),
    accuracy: frac(placed, total),
  };
  const parts = [
    containers.expected ? containers.f1 : undefined,
    components.expected ? components.f1 : undefined,
    datastores.expected ? datastores.f1 : undefined,
    relationships.expected ? relationships.f1 : undefined,
    checked ? nesting.ratio : undefined,
    total ? code.accuracy : undefined,
  ].filter((x): x is number => x !== undefined);

  const scoredKind = (e: ElementNode, covered: Map<string, Set<string>>) =>
    (e.spec.kind === "container" || e.spec.kind === "component") && covered.has(e.id)
      ? true
      : STORE.has(e.spec.kind);
  return {
    containers,
    components,
    datastores,
    relationships,
    nesting,
    code,
    kindAgreement: frac(structural.filter((m) => m.sameKind).length, structural.length),
    errors: found.diagnostics.filter((d) => d.severity === "error").length,
    overall: parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : 0,
    matches,
    missing: [...golden.elements.values()]
      .filter((e) => scoredKind(e, gFiles) && !g2f.has(e.id))
      .map((e) => e.id),
    extra: [...found.elements.values()]
      .filter((e) => scoredKind(e, fFiles) && !f2g.has(e.id))
      .map((e) => e.id),
    misnested,
    missedUses: missedUses.sort(),
    extraUses: [...fUses].filter((u) => !gUses.has(u)).sort(),
  };
}

function el(m: Model, id: string): ElementNode {
  return m.elements.get(id) as ElementNode;
}

function parent(m: Model, e: ElementNode): ElementNode | undefined {
  return e.parentId ? m.elements.get(e.parentId) : undefined;
}

/** Whether `inner` is `outer` or inside it. */
function within(m: Model, inner: string, outer: string): boolean {
  for (let e = m.elements.get(inner); e; e = parent(m, e)) if (e.id === outer) return true;
  return false;
}

/** Kinds that can match each other: a container for a component is a matter of depth, a system for a container isn't. */
function group(e: ElementNode): string {
  if (STORE.has(e.spec.kind)) return "store";
  return e.spec.kind === "component" ? "container" : e.spec.kind;
}

const norm = (s: string | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Same key, name, or technology ("Postgres" and "PostgreSQL" are the same),
 * one name the start of the other ("carrier" and "carrier-api"), or one's
 * name the other's technology ("smtp" and an email relay on SMTP).
 */
function sameThing(a: ElementNode, b: ElementNode): boolean {
  const names = (e: ElementNode) => [norm(e.key), norm(e.spec.name)].filter(Boolean);
  const prefix = (x: string, y: string) =>
    x === y || (Math.min(x.length, y.length) >= 4 && (x.startsWith(y) || y.startsWith(x)));
  if (names(a).some((n) => names(b).some((m) => prefix(n, m)))) return true;
  const tech = (e: ElementNode) => norm(e.spec.technology);
  if (names(a).includes(tech(b)) || names(b).includes(tech(a))) return true;
  const ta = norm(a.spec.technology).slice(0, 5);
  const tb = norm(b.spec.technology).slice(0, 5);
  return ta.length >= 4 && ta === tb;
}

function frac(a: number, b: number): number {
  return b ? a / b : 1;
}

function ratios(expected: number, found: number, recalled: number, precise: number): ScoreCount {
  const recall = frac(recalled, expected);
  const precision = frac(precise, found);
  return {
    expected,
    found,
    matched: recalled,
    precision,
    recall,
    f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0,
  };
}

/**
 * How well a model was discovered, beyond its structure: the journeys a
 * person would trace, steps that say what happens and where the code is,
 * test and verification code left out, and nothing left unconnected. Each
 * part is from 0 to 1; `overall` is their mean.
 */
export interface DiscoveryScore {
  /** Golden journeys that one of the model's journeys follows (half their element hops or more). */
  journeys: { expected: number; found: number; matched: number; recall: number; missed: string[] };
  /** Journeys long enough to follow that reach the datastore, queue, or external their elements use, of the model's journeys (0 with none). */
  journeyDepth: number;
  /** Steps with an action and code that exists, of all the model's steps (0 with none). */
  stepDetail: number;
  /** Steps that name the most specific elements the model has, of all its steps (0 with none). */
  stepPrecision: number;
  /** Test and verification source files the model doesn't give elements of their own, of those in the repository. */
  testExclusion: number;
  /** Source files (not tests, vendored, or generated) some element covers, of all of them. */
  mapped: number;
  /** Elements that connect to something, of the model's containers, components, datastores, queues, and externals. */
  connected: number;
  /** Elements with a description of their own, of the same. */
  described: number;
  /** 1 when the model has a system (kind: system), the box the C4 context draws; else 0. */
  system: number;
  /** Steps across a boundary (another container, a datastore, a queue, an external) that say what they carry, of those steps (1 with none). */
  stepData: number;
  /** Datastores that say what they store and queues that name their messages, of both (1 with none). */
  storeData: number;
  /** Data entries with fields or a schema source, of all of them (1 with none). */
  dataFields: number;
  /** Journey steps after the first that start where the flow already is, of those steps (1 with none). */
  journeyFlow: number;
  /** Containers, datastores, and queues that say where they run, of those; undefined when the repository has no deployment files. */
  deployed?: number | undefined;
  /** Entry points a journey reaches, of those known; undefined when they aren't known. */
  entryPoints?: number | undefined;
  /** Uses that point the right way, cross out of their element's family, and aren't listed again at another level, of all uses between elements (1 with none). */
  usesShape: number;
  /** Elements whose code sits in their parent's, is theirs alone, and is more than one file and not generated, of the model's elements. */
  codeShape: number;
  /** Deployment files an environment or element maps, of those in the repository; undefined when it has none or the model has no environments. */
  deploymentMapped?: number | undefined;
  /** Data entries that aren't numbered copies of another, of all of them (1 with none). */
  dataDistinct: number;
  overall: number;
  /** What `archdoc check --done` would still list. */
  gaps: number;
}

/**
 * Scores how well `found` was discovered. `files` are all the repository's
 * files (a step's code may be a manifest); `score` is scoreModel's result
 * for the same pair, for which elements match.
 */
export function scoreDiscovery(
  found: Model,
  golden: Model,
  files: readonly string[],
  score: ModelScore,
  options: DiscoveryOptions = {},
): DiscoveryScore {
  const a = assessDiscovery(found, files, options);
  const f2g = new Map(score.matches.map((m) => [m.found, m.golden]));
  // Each end of a found step, as the golden element it is or sits inside.
  const toGolden = (id: string): string | undefined => {
    for (let e = found.elements.get(id); e; e = parent(found, e)) {
      const g = f2g.get(e.id);
      if (g) return g;
    }
    return undefined;
  };
  const near = (a: string, b: string) => within(golden, a, b) || within(golden, b, a);
  const hops = (j: JourneyNode) =>
    j.steps.flatMap((s) =>
      s.from?.type === "element" && s.to?.type === "element" ? [[s.from.id, s.to.id] as const] : [],
    );
  const foundHops = [...found.journeys.values()].map((j) =>
    hops(j).flatMap(([from, to]) => {
      const a = toGolden(from);
      const b = toGolden(to);
      return a && b && a !== b ? [[a, b] as const] : [];
    }),
  );
  const missed: string[] = [];
  const goldenJourneys = [...golden.journeys.values()];
  for (const j of goldenJourneys) {
    const want = hops(j);
    if (!want.length) continue;
    // Matched at any depth, either way round: a step on a container covers the golden step on
    // its component, and a queue delivering to a consumer is the consumer reading the queue.
    const covered = (have: (readonly [string, string])[]) =>
      want.filter(([from, to]) =>
        have.some(([x, y]) => (near(x, from) && near(y, to)) || (near(x, to) && near(y, from))),
      ).length;
    const best = Math.max(0, ...foundHops.map(covered));
    if (best * 2 < want.length) missed.push(j.id);
  }
  const expected = goldenJourneys.filter((j) => hops(j).length).length;
  const s = a.stats;
  const journeys = {
    expected,
    found: found.journeys.size,
    matched: expected - missed.length,
    recall: frac(expected - missed.length, expected),
    missed,
  };
  const parts = {
    journeyDepth: s.journeys ? s.completeJourneys / s.journeys : 0,
    stepDetail: s.steps ? s.detailedSteps / s.steps : 0,
    stepPrecision: s.steps ? s.preciseSteps / s.steps : 0,
    testExclusion: frac(s.testFiles - s.testFilesModeled, s.testFiles),
    mapped: frac(s.sourceFiles - s.unmappedFiles, s.sourceFiles),
    connected: frac(s.elements - s.orphans.length, s.elements),
    described: frac(s.described, s.elements),
    system: s.system ? 1 : 0,
    stepData: frac(s.dataStepsDescribed, s.dataSteps),
    storeData: frac(s.storesDescribed, s.stores),
    dataFields: frac(s.dataDefined, s.dataEntries),
    journeyFlow: frac(s.flowStepsConnected, s.flowSteps),
    usesShape: frac(s.uses - s.usesMisshapen, s.uses),
    codeShape: frac(s.elements - s.elementsMisshapen, s.elements),
    dataDistinct: frac(s.dataEntries - s.dataDuplicates, s.dataEntries),
  };
  const deployed = s.deploymentFiles ? frac(s.deployed, s.deployable) : undefined;
  const entryPoints = s.entryPoints ? s.entryPointsCovered / s.entryPoints : undefined;
  const deploymentMapped =
    s.deploymentFiles && found.environments.size
      ? s.deploymentFilesMapped / s.deploymentFiles
      : undefined;
  const all = [
    ...(expected ? [journeys.recall] : []),
    ...Object.values(parts),
    ...(deployed === undefined ? [] : [deployed]),
    ...(entryPoints === undefined ? [] : [entryPoints]),
    ...(deploymentMapped === undefined ? [] : [deploymentMapped]),
  ];
  return {
    journeys,
    ...parts,
    deployed,
    entryPoints,
    deploymentMapped,
    overall: all.reduce((x, y) => x + y, 0) / all.length,
    gaps: a.gaps.length,
  };
}
