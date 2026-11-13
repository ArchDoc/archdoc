import { filesUnder, locate, resolveCodeMap } from "../codemap/codemap.js";
import { compileGlob, literalPrefix } from "../codemap/glob.js";
import { isSnippet as isSnippetRef } from "../codemap/snippet.js";
import { stepMessage } from "../data/flows.js";
import type { ElementNode, JourneyStep, Model } from "../model.js";
import { stepCodePath } from "../query/code-index.js";
import { orphanElements } from "./check.js";

// Is a model of a repository done? What `archdoc check --done` lists for an
// agent finishing a model that archdoc init started, and what the evals
// score: each level small enough to read, every element described, test
// and verification code left out, nothing left unconnected, actors, and the
// main flows as journeys whose steps say what happens and where the code is.
// Deterministic, so the agent and the evals hold the model to the same list.

/**
 * Directories that hold tests, test helpers, and verification code: suites,
 * end-to-end and load tests, fixtures, mocks, benchmarks, smoke checks.
 */
/** Beyond this many journeys, each says its section. */
const JOURNEY_SECTIONS_AT = 8;

const VERIFICATION_DIR =
  /(^|\/)(tests?|__tests__|e2e|e2e-tests?|integration-?tests?|acceptance-?tests?|functional-?tests?|smoke-?tests?|load-?tests?|loadtests?|perf-?tests?|testdata|__testdata__|test-?data|testutils?|test-?utils?|test-?helpers?|testing-?utils?|testlib|testing|__mocks__|mocks?|fakes?|stubs|fixtures?|__fixtures__|bench(mark)?s?|verification|conformance|playwright|cypress|test-[^/]+|[^/]+[-_]tests?|[^/]+\.(Unit|Functional|Integration|E2E)?Tests?)\//i;
/** Files that are tests or only serve them, in the languages init reads. */
const VERIFICATION_FILE =
  /(^|\/)[^/]+[._-](test|spec|bench|e2e)\.[cm]?[jt]sx?$|_test\.go$|(^|\/)test_[^/]*\.py$|_test\.py$|(^|\/)conftest\.py$|(^|\/)[A-Z][A-Za-z0-9]*(Tests?|IT|Spec|Mock|Fake)\.(java|kt|kts|scala|cs|swift)$|(^|\/)[A-Z][A-Za-z0-9]*Mocks?[A-Z][A-Za-z0-9]*\.(java|kt|cs|swift|[cm]?[jt]sx?)$|\.Testing\.cs$|(^|\/)(setupTests|test-setup|testSetup|jest\.setup|vitest\.setup)\.[cm]?[jt]sx?$|(^|\/)(vitest|jest|playwright|cypress|karma|wdio|ava|mocha)\.config\.[a-z.]+$|(^|\/)\.mocharc\.[a-z]+$|(^|\/)(mock|fake)_[^/]+\.(go|py)$|_(mock|fake)\.(go|py)$|(^|\/)test_?utils?\.(go|py|[cm]?[jt]sx?)$/;

/**
 * Whether a file is test or verification code: a test suite, a test helper,
 * a mock, a fixture, a benchmark, or a test runner's config. Init leaves it
 * out, and a finished model doesn't model it as architecture.
 */
export function isVerificationCode(path: string): boolean {
  return VERIFICATION_DIR.test(path) || VERIFICATION_FILE.test(path);
}

/** A description archdoc init wrote: it says where the element came from, not what it does. */
export const INIT_DESCRIPTION =
  /^(The \S+ (package|binary|module|crate|project|action|service in \S+|the repository runs)|The Python project|The whole repository, until you know its parts|The database (\S+ describes|the migrations in \S+ build)|An? (directory|code directory|source file)|(Function|Class) \S+)( \([^)]*\))?\.$/;

/** The limits a level of the model is held to, so it can be read top-down. */
export const LEVEL_LIMITS = { top: 12, children: 10 } as const;
/** The most code elements one part names: the functions a newcomer opens first. */
export const KEY_CODE_LIMIT = 5;

/**
 * When a container needs components. With fewer than `lean` source files it
 * is read as one part and has none; with `split` or more, spread over a few
 * directories, a newcomer needs its parts named.
 */
export const COMPONENT_SIZE = { lean: 5, split: 30, directories: 3 } as const;

/**
 * Files that say where and how the system is deployed: compose files,
 * Terraform, CDK apps, Kubernetes manifests and Helm charts, serverless and
 * SAM templates, Pulumi, Bicep, and app hosts.
 */
const DEPLOYMENT_FILE =
  /(^|\/)(docker-)?compose(\.[\w-]+)?\.ya?ml$|\.tf$|(^|\/)cdk\.json$|(^|\/)Chart\.yaml$|(^|\/)(k8s|kubernetes|manifests|helm|charts)\/.+\.ya?ml$|(^|\/)serverless\.ya?ml$|(^|\/)(template|samconfig)\.ya?ml$|(^|\/)Pulumi\.ya?ml$|\.bicep$|(^|\/)[^/]*AppHost[^/]*\/(Program|AppHost)\.cs$/;

/** Whether a file says where the system is deployed (see DEPLOYMENT_FILE). */
export function isDeploymentFile(path: string): boolean {
  return DEPLOYMENT_FILE.test(path) && !isVerificationCode(path) && !NOT_ARCHITECTURE.test(path);
}

/** Where a flow starts in the code: a route, a consumer, a scheduled job, a CLI command. */
export interface EntryPoint {
  /** route, consumer, schedule, command, handler, or page. */
  kind: string;
  /** What starts it, such as `POST /bookings` or `booking-requested`. */
  label: string;
  /** The file it's handled in, relative to the repository root. */
  file: string;
  symbol?: string | undefined;
  line?: number | undefined;
  /** Where it lives: the container it's in, or before a model exists, its package's directory. */
  place?: string | undefined;
}

export interface DiscoveryOptions {
  /** The repository's entry points, when they're known (`archdoc paths`): journeys should start from most of them. */
  entryPoints?: readonly EntryPoint[] | undefined;
}

/** The share of entry points a done model's journeys start from or pass through. */
const ENTRY_COVERAGE = 0.8;

/** One thing a model still lacks before it's done. */
export interface DiscoveryGap {
  /** done/backwards-use, done/use-in-family, done/use-two-levels, done/code-outside-parent, done/overlapping-code, done/one-file-component, done/generated-code, done/unmapped-deployment, done/outside-system, done/code-name, done/whole-file-code, done/no-key-code, done/duplicate-data, done/level-too-wide, done/thin-container, done/flat-container, done/undescribed, done/test-code, done/unmapped-code, done/orphan, done/no-system, done/no-actors, done/actor-without-journey, done/few-journeys, done/uncovered-entry-points, done/short-journey, done/journey-stops-short, done/step-detail, done/step-data, done/data-undescribed, done/data-fields, done/agent-actor, done/actor-name, done/step-elsewhere, done/coarse-step, done/step-whole-file, done/store-data, done/no-environments, done/undeployed. */
  code: string;
  message: string;
  element?: string | undefined;
  journey?: string | undefined;
}

export interface DiscoveryAssessment {
  gaps: DiscoveryGap[];
  stats: {
    /** Containers, components, datastores, queues, and externals. */
    elements: number;
    described: number;
    /** Source files (not tests, not vendored or generated) that no element covers, of how many. */
    unmappedFiles: number;
    sourceFiles: number;
    /** Elements nothing connects to. */
    orphans: string[];
    /** Elements whose code is mostly test or verification code. */
    testElements: string[];
    /** Test and verification source files in the repository, and how many the model gives elements of their own. */
    testFiles: number;
    testFilesModeled: number;
    actors: number;
    journeys: number;
    /** Journeys long enough to follow and that reach the datastore, queue, or external their elements use. */
    completeJourneys: number;
    steps: number;
    /** Steps that say what happens (action or description) and point at code that exists. */
    detailedSteps: number;
    /** Steps on the most specific elements the model has (no components left to name), whose code is theirs. */
    preciseSteps: number;
    /** The widest level: how many elements (not code) one parent, or the top, holds. */
    widestLevel: number;
    /** Whether the model has a system (kind: system), the box the C4 context draws. */
    system: boolean;
    /** Steps that carry data across a boundary (into another container, a datastore, a queue, or an external), and how many say what (sends, creates, or changes). */
    dataSteps: number;
    dataStepsDescribed: number;
    /** Datastores and queues, and how many say what they hold (stores, or the messages sent through them). */
    stores: number;
    storesDescribed: number;
    /** Data entries, and how many say what's in them: fields, or a schema source to read them from. */
    dataEntries: number;
    dataDefined: number;
    /** Journey steps after the first, and how many start where the flow already is (at an element an earlier step reached, an actor, or an external). */
    flowSteps: number;
    flowStepsConnected: number;
    /** Deployment files in the repository (compose, Terraform, CDK, Kubernetes, Helm, and the like). */
    deploymentFiles: number;
    /** Containers, datastores, and queues, and how many say where they run (deploy). */
    deployable: number;
    deployed: number;
    /** Entry points known, and how many a journey starts from or passes through; 0 of 0 when they aren't known. */
    entryPoints: number;
    entryPointsCovered: number;
    /** Uses between elements, and how many point the wrong way, stay inside one element's family, or repeat a more specific use. */
    uses: number;
    usesMisshapen: number;
    /** Containers, components, datastores, queues, and externals whose code is shaped wrong: outside their parent's, claimed by a sibling too, one file, or generated. */
    elementsMisshapen: number;
    /** Deployment files some element or environment maps. */
    deploymentFilesMapped: number;
    /** Data entries that copy another one (the same name with a number after it). */
    dataDuplicates: number;
    /** Containers, components, datastores, and queues (not tests), and how many sit inside a system element. */
    ownParts: number;
    insideSystem: number;
    /** Containers and components whose code names a directory, package, or file, and how many are named after it (or, when it goes by several names, have a name:). */
    nameable: number;
    namedFromCode: number;
    /** Code elements and journey steps that point at a source file, and how many point into it: a symbol or lines. */
    codeRefs: number;
    preciseCodeRefs: number;
    /** Components and lean containers with source files, and how many have a code element at a symbol or lines. */
    leafParts: number;
    keyedParts: number;
  };
}

const ARCHITECTURE = new Set(["container", "component", "datastore", "queue", "external"]);
/** Code that's never architecture: vendored, generated, or built. */
const NOT_ARCHITECTURE =
  /(^|\/)(node_modules|vendor|third_party|dist|build|out|target|generated|gen|genproto|__generated__|\.[^/]+)\/|\.(pb|pb\.gw|gen|generated)\.[a-z]+$|_pb2(_grpc)?\.py$/;
/** Two siblings claim the same code when they share at least this many files, and this share of the smaller one's. */
const OVERLAP = { files: 3, share: 0.5 } as const;
/** A data entry that copies another: its name with a number after it (CartItem2 beside CartItem). */
const NUMBERED = /^(.*?\D)\d+$/;

/** The share of source files a model may leave unmapped before it's not done. */
const UNMAPPED_LIMIT = 0.2;
/** Where a flow ends: what it stores, publishes, or calls outside the system. */
const INFRA = new Set(["datastore", "queue", "external"]);
const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs|go|py|rs|java|kt|kts|rb|cs|php|swift|scala|ex|exs)$/;

/**
 * What a model still lacks before it's done. `files` are the repository's
 * files, relative to its root, to tell which elements cover test code and
 * whether a step's code exists.
 */
export function assessDiscovery(
  model: Model,
  files: readonly string[],
  options: DiscoveryOptions = {},
): DiscoveryAssessment {
  const gaps: DiscoveryGap[] = [];
  const elements = [...model.elements.values()];
  const arch = elements.filter((e) => ARCHITECTURE.has(e.spec.kind));
  const fileSet = new Set(files);

  // 1. Levels: a newcomer reads a level at a time.
  const levels = new Map<string, ElementNode[]>();
  for (const e of elements) {
    if (e.spec.kind === "code" || e.spec.kind === "system") continue;
    // A system is a frame, not a level: its children are read as the top.
    let p = e.parentId;
    while (p && model.elements.get(p)?.spec.kind === "system") p = model.elements.get(p)?.parentId;
    const at = p ?? "";
    levels.set(at, [...(levels.get(at) ?? []), e]);
  }
  let widest = 0;
  for (const [parent, list] of levels) {
    widest = Math.max(widest, list.length);
    const limit = parent ? LEVEL_LIMITS.children : LEVEL_LIMITS.top;
    if (list.length <= limit) continue;
    gaps.push({
      code: "done/level-too-wide",
      element: parent || undefined,
      message: `${parent ? `${parent} holds` : "The top of the model holds"} ${list.length} elements; aim for ${parent ? `3 to ${limit}` : `3 to ${limit}`}. Group them by what they're for, fold one-file elements into their neighbors, and make language or provider variants one element.`,
    });
  }
  // Code elements are the few functions a newcomer opens first, not a file list: one per file
  // is too fine to read, and the code: glob already maps every file.
  for (const e of elements) {
    if (e.spec.kind === "code") continue;
    const n = e.childIds.filter((c) => model.elements.get(c)?.spec.kind === "code").length;
    if (n <= KEY_CODE_LIMIT) continue;
    gaps.push({
      code: "done/level-too-wide",
      element: e.id,
      message: `${e.id} holds ${n} code elements; keep 1 to ${KEY_CODE_LIMIT}. Remove the rest (its code: glob already maps their files), and keep the entry points and core functions a newcomer opens first, each at its symbol, never one per file.`,
    });
  }

  // 2. Descriptions that say what each element is responsible for.
  const undescribed = arch.filter(
    (e) => !e.spec.description?.trim() || INIT_DESCRIPTION.test(e.spec.description.trim()),
  );
  if (undescribed.length) {
    const ids = undescribed.map((e) => e.id);
    const shown = ids.slice(0, 12).join(", ");
    gaps.push({
      code: "done/undescribed",
      message: `${ids.length === 1 ? `${shown} has` : `${ids.length} elements have`} no description of ${ids.length === 1 ? "its" : "their"} own (none, or init's)${ids.length === 1 ? "" : `: ${shown}${ids.length > 12 ? `, and ${ids.length - 12} more` : ""}`}. Open each one's code (archdoc_show with code) and say in one or two sentences what it's responsible for, in the domain's words.`,
    });
  }

  // 3. Test and verification code isn't architecture.
  const map = resolveCodeMap(model, files);
  const testFiles = files.filter((f) => SOURCE.test(f) && isVerificationCode(f));
  const testElements: string[] = [];
  for (const e of elements) {
    if (e.spec.kind === "system") continue;
    // All its files count, docs and config too: an integration of Markdown with one test isn't a test.
    const under = filesUnder(model, map, e.id);
    const tests = under.filter((f) => isVerificationCode(f)).length;
    // All but a few of its files are tests: a test suite, a mock, a test helper modeled as an
    // element. A container whose glob also covers its own tests is fine, even in Go or Java,
    // where tests can outnumber the code.
    if (under.length && tests / under.length >= 0.9) testElements.push(e.id);
  }
  // Name the outermost one only: its children go with it.
  const outermost = testElements.filter(
    (id) => !testElements.some((o) => o !== id && id.startsWith(`${o}.`)),
  );
  const modeled = new Set(outermost.flatMap((id) => filesUnder(model, map, id)));
  const testFilesModeled = testFiles.filter((f) => modeled.has(f)).length;
  for (const id of outermost) {
    gaps.push({
      code: "done/test-code",
      element: id,
      message: `${id} is test or verification code (tests, mocks, fixtures, benchmarks, smoke checks). Remove it from the model, and the uses and steps that name it.`,
    });
  }

  // Code no element covers: usually a code: that lists a few files where the directory was meant.
  // Infrastructure as code a deployment node points at (a CDK app, say) is mapped too.
  const infra = [...model.deploymentNodes.values()].flatMap((n) =>
    n.code.map((c) => compileGlob(c.path.endsWith("/") ? `${c.path}**` : c.path)),
  );
  const sources = files.filter(
    (f) =>
      SOURCE.test(f) &&
      !isVerificationCode(f) &&
      !NOT_ARCHITECTURE.test(f) &&
      !infra.some((re) => re.test(f)),
  );
  const unmappedSet = new Set(map.unmapped);
  const unmapped = sources.filter((f) => unmappedSet.has(f));
  if (sources.length && unmapped.length / sources.length > UNMAPPED_LIMIT) {
    const byDir = new Map<string, number>();
    for (const f of unmapped) {
      const dir = f.split("/").slice(0, -1).slice(0, 2).join("/") || ".";
      byDir.set(dir, (byDir.get(dir) ?? 0) + 1);
    }
    const top = [...byDir]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 6)
      .map(([d, n]) => `${d}/ (${n})`);
    gaps.push({
      code: "done/unmapped-code",
      message: `${unmapped.length} of ${sources.length} source files belong to no element, such as in ${top.join(", ")}. Map each element to its whole directory (code: dir/**) rather than a few files, and give what's left an element or leave it out on purpose.`,
    });
  }

  // Components where a container is big enough to need them, and not where it's small.
  const sourcesOf = (id: string) =>
    filesUnder(model, map, id).filter(
      (f) => SOURCE.test(f) && !isVerificationCode(f) && !NOT_ARCHITECTURE.test(f),
    );
  for (const e of elements) {
    if (e.spec.kind !== "container" || testElements.includes(e.id)) continue;
    const parts = e.childIds.filter((c) => model.elements.get(c)?.spec.kind === "component");
    const own = sourcesOf(e.id);
    if (parts.length && own.length < COMPONENT_SIZE.lean) {
      gaps.push({
        code: "done/thin-container",
        element: e.id,
        message: `${e.id} has ${parts.length} component${parts.length === 1 ? "" : "s"} but only ${own.length} source file${own.length === 1 ? "" : "s"}. Keep a container this small lean: fold its components into its code: and description, and point steps at the container.`,
      });
    }
    const dirs = new Set(own.map((f) => f.split("/").slice(0, -1).join("/")));
    if (
      !parts.length &&
      own.length >= COMPONENT_SIZE.split &&
      dirs.size >= COMPONENT_SIZE.directories
    ) {
      gaps.push({
        code: "done/flat-container",
        element: e.id,
        message: `${e.id} holds ${own.length} source files in ${dirs.size} directories, and no components. Give it 3 to 10 components for the parts its code is split into (each code: dir/**, described in the domain's words), so a newcomer can find their way inside it.`,
      });
    }
  }

  // 4. Orphans: an element nothing connects to was usually reached in a way imports don't show.
  const orphans = orphanElements(model)
    .filter((e) => ARCHITECTURE.has(e.spec.kind) && !testElements.includes(e.id))
    .map((e) => e.id);
  for (const id of orphans) {
    gaps.push({
      code: "done/orphan",
      element: id,
      message: `${id} connects to nothing. Find how it's reached: HTTP calls to a URL from config or env, gRPC clients, queue topics it publishes or consumes, scheduled jobs and manifests that run it, plugins registered by name, CLIs that start it. Add the uses you find. If it isn't part of the system, remove it.`,
    });
  }

  // The system: the box the C4 context draws, with who uses it and what it talks to around it.
  const system = elements.some((e) => e.spec.kind === "system");
  if (!system && arch.length) {
    gaps.push({
      code: "done/no-system",
      message: `No system. Wrap the containers, datastores, and queues in one element with kind: system, named for the product (${model.name ?? model.namespace}), and keep externals outside it, so the context view shows the system with who uses it and what it calls.`,
    });
  }

  // 5. Who uses it, and the flows they follow.
  if (!model.actors.size) {
    gaps.push({
      code: "done/no-actors",
      message:
        "No actors. Add who and what uses the system: the people behind its UIs and APIs, operators, other systems that call in, and schedulers that start jobs.",
    });
  }
  const journeys = [...model.journeys.values()];
  if (journeys.length < 2) {
    gaps.push({
      code: "done/few-journeys",
      message: `${journeys.length ? "One journey" : "No journeys"}. Add a journey for each main flow, starting from the entry points: routes, pages, CLI commands, consumers, and scheduled jobs. Most systems have four to ten; mark the main one importance: critical.`,
    });
  }
  // Many journeys read by topic: each says the section it's listed under.
  const unsectioned = journeys.filter((j) => !j.spec.section?.trim());
  if (journeys.length > JOURNEY_SECTIONS_AT && unsectioned.length) {
    const shown = unsectioned.slice(0, 5).map((j) => j.id);
    gaps.push({
      code: "done/journey-sections",
      message: `${journeys.length} journeys, ${unsectioned.length} without a section (${shown.join(", ")}${unsectioned.length > shown.length ? ", …" : ""}). Give each a section: the topic it's about, such as Checkout or Accounts, a few journeys each, never its importance. The explorer lists them under it.`,
    });
  }
  // Every actor who reaches the system starts at least one journey.
  const inJourney = new Set(
    journeys.flatMap((j) => [
      j.spec.actor,
      ...j.steps.flatMap((s) => [s.from, s.to]).flatMap((t) => (t?.type === "actor" ? [t.id] : [])),
    ]),
  );
  const lonely = [...model.actors.values()].filter(
    (a) => Object.keys(a.spec.uses ?? {}).length > 0 && !inJourney.has(a.id),
  );
  if (lonely.length && journeys.length) {
    gaps.push({
      code: "done/actor-without-journey",
      message: `${lonely.map((a) => a.id).join(", ")} ${lonely.length === 1 ? "uses the system but has" : "use the system but have"} no journey. Trace what ${lonely.length === 1 ? "it does" : "each does"} from the entry point ${lonely.length === 1 ? "it reaches" : "they reach"}, a step per hop.`,
    });
  }

  // Journeys should start from most of the entry points: each route, consumer, and job is a flow.
  const entries = options.entryPoints ?? [];
  const stepFiles = new Set(
    journeys.flatMap((j) =>
      j.steps.flatMap((s) => (s.spec.code ? [stepCodePath(s.spec.code)] : [])),
    ),
  );
  const uncovered = entries.filter((e) => !stepFiles.has(e.file));
  if (entries.length && (entries.length - uncovered.length) / entries.length < ENTRY_COVERAGE) {
    const shown = uncovered
      .slice(0, 10)
      .map((e) => `${e.label} (${e.file})`)
      .join(", ");
    gaps.push({
      code: "done/uncovered-entry-points",
      message: `Journeys reach ${entries.length - uncovered.length} of ${entries.length} entry points. Not yet: ${shown}${uncovered.length > 10 ? `, and ${uncovered.length - 10} more` : ""}. Add a journey for each flow a newcomer would need (archdoc_paths shows each one's calls), with a step whose code is the handler's file, or say which you left out and why when you hand over.`,
    });
  }

  // The data each boundary-crossing step carries, and what each datastore and queue holds.
  const unitOf = (id: string): string => {
    for (
      let e = model.elements.get(id);
      e;
      e = e.parentId ? model.elements.get(e.parentId) : undefined
    ) {
      if (e.spec.kind !== "component" && e.spec.kind !== "code") return e.id;
    }
    return id;
  };
  const crosses = (s: JourneyStep): boolean => {
    if (s.from?.type === "actor" || s.to?.type === "actor") return false;
    if (s.from?.type !== "element" || s.to?.type !== "element") return !!s.from && !!s.to;
    const kinds = [s.from.id, s.to.id].map((id) => model.elements.get(id)?.spec.kind ?? "");
    return kinds.some((k) => INFRA.has(k)) || unitOf(s.from.id) !== unitOf(s.to.id);
  };
  const writes = (s: JourneyStep) =>
    !!s.spec.creates ||
    !!s.spec.changes ||
    Object.values(s.spec.branches ?? {}).some((b) => !!b.creates || !!b.changes);
  let dataSteps = 0;
  let dataStepsDescribed = 0;
  const silentSteps: string[] = [];
  for (const j of journeys) {
    const silent: number[] = [];
    for (const s of j.steps) {
      if (!crosses(s)) continue;
      dataSteps++;
      if (writes(s) || stepMessage(model, s)) dataStepsDescribed++;
      else silent.push(s.index + 1);
    }
    if (silent.length)
      silentSteps.push(`"${j.id}" step${silent.length === 1 ? "" : "s"} ${silent.join(", ")}`);
  }
  if (silentSteps.length) {
    gaps.push({
      code: "done/step-data",
      message: `Steps that cross into another container, a datastore, a queue, or an external don't say what they carry: ${silentSteps.slice(0, 8).join("; ")}${silentSteps.length > 8 ? `, and ${silentSteps.length - 8} more journeys` : ""}. Read the request, message, or record the code builds, add it under data: with its fields (classification: pii for personal data), and name it with sends: on the step or its use, or creates:/changes: on a step that writes a datastore.`,
    });
  }
  const holders = arch.filter((e) => e.spec.kind === "datastore" || e.spec.kind === "queue");
  const sendsThrough = (id: string) =>
    model.relationships.some(
      (r) => r.sends.length > 0 && [r.from, r.to].some((t) => t.type === "element" && t.id === id),
    ) ||
    journeys.some((j) =>
      j.steps.some(
        (s) =>
          [s.from, s.to].some((t) => t?.type === "element" && t.id === id) &&
          (writes(s) || !!s.spec.sends),
      ),
    );
  const emptyHolders = holders.filter((e) =>
    e.spec.kind === "datastore" ? !Object.keys(e.spec.stores ?? {}).length : !sendsThrough(e.id),
  );
  if (emptyHolders.length) {
    gaps.push({
      code: "done/store-data",
      message: `${emptyHolders.map((e) => e.id).join(", ")} ${emptyHolders.length === 1 ? "doesn't" : "don't"} say what ${emptyHolders.length === 1 ? "it holds" : "they hold"}. For a datastore, add stores: with each table or collection, its key, and the data entry it holds (from the schema, migrations, ORM models, or the IaC that creates it, such as a DynamoDB table's keys). For a queue, name the messages sent through it with sends: on the uses that publish and consume them.`,
    });
  }

  // What each entry is: its name is short (it's drawn on a chip), so its description says the rest.
  const unexplained = [...model.data.values()].filter((d) => !d.spec.description?.trim());
  if (unexplained.length) {
    const ids = unexplained.map((d) => d.id);
    gaps.push({
      code: "done/data-undescribed",
      message: `${ids.length === 1 ? `Data entry ${ids[0]} doesn't` : `${ids.length} data entries don't`} say what ${ids.length === 1 ? "it is" : "they are"}${ids.length === 1 ? "" : `: ${ids.slice(0, 12).join(", ")}${ids.length > 12 ? `, and ${ids.length - 12} more` : ""}`}. Give each a description of a sentence: what it holds or announces, and who makes it. Keep the name itself short, one to three words, such as OrderPlaced.`,
    });
  }

  // What's in each entry: a name and a description aren't a shape. Its fields come from the code.
  const shapeless = [...model.data.values()].filter(
    (d) => !d.spec.source && !Object.keys(d.spec.fields ?? {}).length,
  );
  if (shapeless.length) {
    const ids = shapeless.map((d) => d.id);
    gaps.push({
      code: "done/data-fields",
      message: `${ids.length === 1 ? `Data entry ${ids[0]} has` : `${ids.length} data entries have`} no fields${ids.length === 1 ? "" : `: ${ids.slice(0, 12).join(", ")}${ids.length > 12 ? `, and ${ids.length - 12} more` : ""}`}. Find where the code defines each one before you leave it: the class, struct, record, interface, or type the code builds or reads (a request body, an event payload, an ORM model), a schema file (SQL migrations, Prisma, protobuf, OpenAPI), or the IaC that creates its table. Point source: at a schema file archdoc reads (sql, prisma, proto, openapi), or write fields: with each field's type, and classification: pii for personal data.`,
    });
  }

  // Who's an agent: an AI that acts on its own. Software that calls in is a system.
  const AI =
    /\b(ai|llm|gpt|claude|copilot|cursor|codex|gemini|model|assistant|chatbot|language model|agentic|mcp)\b/i;
  const notAi = [...model.actors.values()].filter(
    (a) =>
      a.spec.kind === "agent" &&
      !AI.test(`${a.id} ${a.spec.name ?? ""} ${a.spec.description ?? ""}`),
  );
  if (notAi.length) {
    const ids = notAi.map((a) => a.id);
    gaps.push({
      code: "done/agent-actor",
      message: `${ids.join(", ")} ${ids.length === 1 ? "is" : "are"} kind: agent, which is for AI agents (an LLM or assistant that acts on its own), and ${ids.length === 1 ? "its" : "their"} description doesn't say ${ids.length === 1 ? "it's" : "they're"} one. If ${ids.length === 1 ? "it's" : "they're"} software that calls in, such as another service, a scheduler or CronJob, a CI job, or a webhook sender, make ${ids.length === 1 ? "it" : "them"} kind: system. If ${ids.length === 1 ? "it is" : "they are"} an AI agent, say so in the description.`,
    });
  }

  // People, teams, and the systems that call in read in plain words: kebab-case says "a name in
  // the code or infrastructure", which an actor isn't.
  const coined = [...model.actors.values()].filter(
    (a) => !a.spec.name?.trim() && /[-_]/.test(a.id),
  );
  if (coined.length) {
    const shown = coined.slice(0, 12).map((a) => `${a.id} → name: ${plainWords(a.id)}`);
    gaps.push({
      code: "done/actor-name",
      message: `Give ${coined.length === 1 ? "this actor" : "these actors"} a name: in plain words, the way people say it: ${shown.join("; ")}${coined.length > 12 ? `, and ${coined.length - 12} more` : ""}. Kebab-case is for names in the code and infrastructure (services, packages, tables); a person, team, or system that calls in isn't one. Keep the ID.`,
    });
  }

  // A journey goes from one element to the next; check counts each step that doesn't as a warning.
  let flowSteps = 0;
  let flowStepsConnected = 0;
  for (const j of journeys) {
    const reached: string[] = [];
    for (const s of j.steps) {
      if (!s.from || !s.to) break;
      if (reached.length) {
        flowSteps++;
        const from = s.from;
        const outside =
          from.type !== "element" || model.elements.get(from.id)?.spec.kind === "external";
        if (
          outside ||
          reached.some(
            (r) => r === from.id || r.startsWith(`${from.id}.`) || from.id.startsWith(`${r}.`),
          )
        )
          flowStepsConnected++;
      }
      for (const t of [s.from, s.to])
        reached.push(
          t.type === "element" ? t.id : `${t.type}:${t.type === "external" ? t.ref : t.id}`,
        );
    }
  }

  // Where it runs: the deployment files say, so the model should too.
  const deploymentFiles = files.filter(isDeploymentFile);
  const deployable = arch.filter(
    (e) => ["container", "datastore", "queue"].includes(e.spec.kind) && e.spec.status !== "planned",
  );
  const deployedIds = new Set(model.deployments.map((d) => d.element));
  const deployed = deployable.filter(
    (e) => deployedIds.has(e.id) || [...deployedIds].some((d) => e.id.startsWith(`${d}.`)),
  );
  if (deploymentFiles.length && !model.environments.size) {
    gaps.push({
      code: "done/no-environments",
      message: `No environments, though the repository has deployment files (${deploymentFiles.slice(0, 5).join(", ")}${deploymentFiles.length > 5 ? `, and ${deploymentFiles.length - 5} more` : ""}). Add environments: with one entry per environment they define (production, staging, local) and the infrastructure in each (account or region, cluster, serverless, managed services), each with code: pointing at its file. Then give each container, datastore, and queue a deploy:.`,
    });
  } else if (model.environments.size && deployed.length < deployable.length) {
    const missing = deployable.filter((e) => !deployed.includes(e)).map((e) => e.id);
    gaps.push({
      code: "done/undeployed",
      message: `${missing.slice(0, 12).join(", ")}${missing.length > 12 ? `, and ${missing.length - 12} more` : ""} ${missing.length === 1 ? "has" : "have"} no deploy:. Say where each runs, such as deploy: [production.aws.lambda], from the deployment files that define it.`,
    });
  }

  // 6. Shape: what a reader trips over even when everything is there. Uses that
  // point the wrong way or say a thing twice, code that sits outside its parent
  // or is claimed twice, elements too small or generated to be parts, deployment
  // files left out, and data entries that copy each other.
  const kindOf = (id: string) => model.elements.get(id)?.spec.kind;
  const inFamily = (a: string, b: string) => a.startsWith(`${b}.`) || b.startsWith(`${a}.`);
  const elementUses = model.relationships.flatMap((r) =>
    r.from.type === "element" &&
    r.to.type === "element" &&
    model.elements.has(r.from.id) &&
    model.elements.has(r.to.id)
      ? [{ from: r.from.id, to: r.to.id }]
      : [],
  );
  const misshapenUses = new Set<(typeof elementUses)[number]>();
  const backwards = elementUses.filter((r) => {
    const from = kindOf(r.from);
    const to = kindOf(r.to) ?? "";
    return (from === "datastore" || from === "queue") && !INFRA.has(to);
  });
  if (backwards.length) {
    for (const r of backwards) misshapenUses.add(r);
    const shown = backwards.slice(0, 8).map((r) => `${r.from} → ${r.to}`);
    gaps.push({
      code: "done/backwards-use",
      message: `${shown.join(", ")}${backwards.length > 8 ? `, and ${backwards.length - 8} more` : ""}: a datastore or queue uses ${backwards.length === 1 ? "an element" : "elements"} that read or consume it. Point each the other way: the consumer uses the queue or datastore (with sends: for the messages it reads), and remove the use from the queue or datastore.`,
    });
  }
  const family = elementUses.filter((r) => inFamily(r.from, r.to));
  if (family.length) {
    for (const r of family) misshapenUses.add(r);
    const shown = family.slice(0, 8).map((r) => `${r.from} → ${r.to}`);
    gaps.push({
      code: "done/use-in-family",
      message: `${shown.join(", ")}${family.length > 8 ? `, and ${family.length - 8} more` : ""}: ${family.length === 1 ? "an element uses its own parent or child" : "elements use their own parents or children"}. Nesting already says a parent holds its children; remove these uses, and put each call between the children that make it.`,
    });
  }
  const targets = new Map<string, Set<string>>();
  for (const r of elementUses) {
    targets.set(r.from, (targets.get(r.from) ?? new Set()).add(r.to));
  }
  const twice = elementUses.filter(
    (r) =>
      !inFamily(r.from, r.to) &&
      [...(targets.get(r.from) ?? [])].some((t) => t.startsWith(`${r.to}.`)),
  );
  if (twice.length) {
    for (const r of twice) misshapenUses.add(r);
    const shown = twice.slice(0, 8).map((r) => `${r.from} → ${r.to}`);
    gaps.push({
      code: "done/use-two-levels",
      message: `${shown.join(", ")}${twice.length > 8 ? `, and ${twice.length - 8} more` : ""}: the same call is also listed to a part inside ${twice.length === 1 ? "that element" : "those elements"}. Keep only the use on the part the code calls, so each call is drawn once.`,
    });
  }

  const globsOf = (e: ElementNode) =>
    e.code.map((c) => compileGlob(c.path.endsWith("/") ? `${c.path}**` : c.path));
  const sourceSet = files.filter((f) => SOURCE.test(f) && !isVerificationCode(f));
  const claimed = (e: ElementNode) => {
    const res = globsOf(e);
    return res.length ? sourceSet.filter((f) => res.some((re) => re.test(f))) : [];
  };
  const claims = new Map<string, string[]>();
  const claimsOf = (e: ElementNode) => {
    let c = claims.get(e.id);
    if (!c) {
      c = claimed(e);
      claims.set(e.id, c);
    }
    return c;
  };
  const misshapen = new Set<string>();
  const outside: string[] = [];
  for (const e of elements) {
    if (e.spec.kind === "system" || !e.code.length || !e.parentId) continue;
    const p = model.elements.get(e.parentId);
    if (!p || p.spec.kind === "system" || !p.code.length) continue;
    const parentGlobs = globsOf(p);
    const own = claimsOf(e).filter((f) => !NOT_ARCHITECTURE.test(f));
    const out = own.filter((f) => !parentGlobs.some((re) => re.test(f)));
    if (out.length) {
      outside.push(`${e.id} (${out.length} of ${own.length} files, such as ${out[0]})`);
      misshapen.add(e.id);
    }
  }
  if (outside.length) {
    gaps.push({
      code: "done/code-outside-parent",
      message: `Code that isn't in its parent's code: ${outside.slice(0, 8).join("; ")}${outside.length > 8 ? `, and ${outside.length - 8} more` : ""}. A parent's code: covers its children's, so a newcomer who opens the parent finds them: widen the parent's code: to take in each child's directory, or move the child under the element whose code it is.`,
    });
  }

  const overlaps: string[] = [];
  const siblings = new Map<string, ElementNode[]>();
  for (const e of elements) {
    if (e.spec.kind === "code" || e.spec.kind === "system" || !e.code.length) continue;
    const at = e.parentId ?? "";
    siblings.set(at, [...(siblings.get(at) ?? []), e]);
  }
  for (const list of siblings.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i] as ElementNode;
        const b = list[j] as ElementNode;
        const fa = claimsOf(a);
        const fb = new Set(claimsOf(b));
        const shared = fa.filter((f) => fb.has(f)).length;
        if (shared >= OVERLAP.files && shared >= OVERLAP.share * Math.min(fa.length, fb.size)) {
          overlaps.push(`${a.id} and ${b.id} (${shared} files)`);
          misshapen.add(a.id);
          misshapen.add(b.id);
        }
      }
    }
  }
  if (overlaps.length) {
    gaps.push({
      code: "done/overlapping-code",
      message: `Siblings whose code: claims the same files: ${overlaps.slice(0, 8).join("; ")}${overlaps.length > 8 ? `, and ${overlaps.length - 8} more` : ""}. Give each its own directories, so every file has one place in the model; a code: of ** that takes in the whole repository is the usual cause.`,
    });
  }

  const tiny: string[] = [];
  const generated: string[] = [];
  for (const e of elements) {
    if (e.spec.kind !== "component" && e.spec.kind !== "container") continue;
    const all = filesUnder(model, map, e.id).filter(
      (f) => SOURCE.test(f) && !isVerificationCode(f),
    );
    if (all.length && all.filter((f) => NOT_ARCHITECTURE.test(f)).length / all.length >= 0.9) {
      generated.push(e.id);
      misshapen.add(e.id);
      continue;
    }
    if (e.spec.kind !== "component" || !e.parentId) continue;
    const peers = (model.elements.get(e.parentId)?.childIds ?? []).filter(
      (c) => kindOf(c) === "component",
    );
    // In a big container a one-file component is a helper; in a small one it may be all there is.
    if (
      peers.length >= 3 &&
      sourcesOf(e.id).length === 1 &&
      sourcesOf(e.parentId).length >= COMPONENT_SIZE.split
    ) {
      tiny.push(e.id);
      misshapen.add(e.id);
    }
  }
  if (generated.length) {
    gaps.push({
      code: "done/generated-code",
      message: `${generated.join(", ")} ${generated.length === 1 ? "is" : "are"} generated code (protobuf or gRPC stubs, codegen output). Generated code isn't a part a newcomer works in: fold it into the element that uses it, or point at the schema it's generated from (a proto file, say) as data.`,
    });
  }
  if (tiny.length) {
    gaps.push({
      code: "done/one-file-component",
      message: `${tiny.slice(0, 12).join(", ")}${tiny.length > 12 ? `, and ${tiny.length - 12} more` : ""} ${tiny.length === 1 ? "is a component of one source file" : "are components of one source file each"}. A helper file isn't a responsibility of its own: fold each into the component that uses it, or into its container's code:, unless it's a part a newcomer has to find by name.`,
    });
  }

  // An element's code counts only when it names a place: a code: of ** claims everything.
  const elementGlobs = elements.flatMap((e) =>
    e.code
      .filter((c) => literalPrefix(c.path))
      .map((c) => compileGlob(c.path.endsWith("/") ? `${c.path}**` : c.path)),
  );
  // A deployment file is mapped when something points at it, or at a file beside or below it
  // (an environment that names a CDK app's entry point maps its cdk.json too).
  const pointedAt = files.filter(
    (f) => infra.some((re) => re.test(f)) || elementGlobs.some((re) => re.test(f)),
  );
  const unmappedDeployment = model.environments.size
    ? deploymentFiles.filter((f) => {
        const dir = f.includes("/") ? `${f.slice(0, f.lastIndexOf("/"))}/` : "";
        return !pointedAt.some((m) => m === f || (dir ? m.startsWith(dir) : false));
      })
    : [];
  if (unmappedDeployment.length) {
    const dirs = [
      ...new Set(unmappedDeployment.map((f) => f.split("/").slice(0, -1).join("/") || f)),
    ];
    gaps.push({
      code: "done/unmapped-deployment",
      message: `${unmappedDeployment.length} of ${deploymentFiles.length} deployment files belong to no environment or element, such as in ${dirs.slice(0, 6).join(", ")}. Point the environment they define at them (code: on the environment or its nodes), so a reader can see what deploys each part.`,
    });
  }

  // The system's own parts sit inside it, so the context view shows one box with who uses it
  // and what it calls around it, and the container view opens it. Only externals sit outside.
  const systems = elements.filter((e) => e.spec.kind === "system").map((e) => e.id);
  const inSystem = (id: string) => systems.some((s) => id.startsWith(`${s}.`));
  const ownParts = arch.filter((e) => e.spec.kind !== "external" && !testElements.includes(e.id));
  // Name the outermost: what's inside a misplaced container moves with it.
  const outsideSystem = systems.length
    ? ownParts
        .filter((e) => !inSystem(e.id))
        .filter((e) => !e.parentId || inSystem(e.parentId) || !model.elements.get(e.parentId))
        .map((e) => e.id)
    : [];
  if (outsideSystem.length) {
    for (const id of outsideSystem) misshapen.add(id);
    const [only] = systems;
    const into =
      systems.length === 1
        ? ` (archdoc_edit rename to ${only}.<id>, such as ${only}.${outsideSystem[0]})`
        : " (archdoc_edit rename)";
    gaps.push({
      code: "done/outside-system",
      message: `${outsideSystem.slice(0, 12).join(", ")}${outsideSystem.length > 12 ? `, and ${outsideSystem.length - 12} more` : ""} ${outsideSystem.length === 1 ? "is part of the system but sits" : "are part of the system but sit"} outside the system element, so the context view draws ${outsideSystem.length === 1 ? "it" : "them"} beside the system instead of inside it, and looks like the container view. Move ${outsideSystem.length === 1 ? "it" : "each"} inside it${into}, and keep only externals outside.`,
    });
  }
  const insideSystem = systems.length ? ownParts.filter((e) => inSystem(e.id)).length : 0;

  // Names from the code: a newcomer who reads auth in the model looks for auth/ in the code.
  const misnamed: string[] = [];
  const unnamed: string[] = [];
  let nameable = 0;
  for (const e of elements) {
    if (e.spec.kind !== "container" && e.spec.kind !== "component") continue;
    if (testElements.some((t) => e.id === t || e.id.startsWith(`${t}.`))) continue;
    if (generated.includes(e.id)) continue;
    const terms = codeTerms(e);
    if (!terms.length) continue;
    nameable++;
    const said = [e.key, e.spec.name ?? ""];
    if (terms.some((t) => said.some((s) => sameName(s, t)))) continue;
    const roots = [...new Set(terms.map(nameRoot))];
    if (roots.length === 1) misnamed.push(`${e.id} → ${terms[0]}`);
    else if (!e.spec.name?.trim()) unnamed.push(`${e.id} (${terms.slice(0, 3).join(", ")})`);
  }
  if (misnamed.length) {
    gaps.push({
      code: "done/code-name",
      message: `Name ${misnamed.length === 1 ? "this part" : "these parts"} the way the code does, so a newcomer finds the code by the name: ${misnamed.slice(0, 12).join("; ")}${misnamed.length > 12 ? `, and ${misnamed.length - 12} more` : ""}. Rename each to the directory, package, or module its code: names (archdoc_edit rename keeps every reference).`,
    });
  }
  if (unnamed.length) {
    gaps.push({
      code: "done/code-name",
      message: `${unnamed.slice(0, 12).join("; ")}${unnamed.length > 12 ? `, and ${unnamed.length - 12} more` : ""}: ${unnamed.length === 1 ? "its code goes" : "their code goes"} by several names and ${unnamed.length === 1 ? "its ID matches" : "their IDs match"} none of them. Name ${unnamed.length === 1 ? "it" : "each"} after the term the code uses most, or give ${unnamed.length === 1 ? "it" : "each"} a name: in plain words that says what it is, such as name: Local Migration Scripts.`,
    });
  }
  const namedFromCode = nameable - misnamed.length - unnamed.length;

  // Code an auditor can check: each part names the functions and classes that do its work,
  // not only whole files, so a reader opens the lines the model is about.
  const wholeFile: string[] = [];
  let codeElements = 0;
  for (const e of elements) {
    if (e.spec.kind !== "code" || !e.code.length) continue;
    codeElements++;
    if (!e.code.some(isSnippetRef)) wholeFile.push(e.id);
  }
  if (wholeFile.length) {
    gaps.push({
      code: "done/whole-file-code",
      message: `${wholeFile.slice(0, 12).join(", ")}${wholeFile.length > 12 ? `, and ${wholeFile.length - 12} more` : ""} ${wholeFile.length === 1 ? "is a code element that points" : "are code elements that point"} at a whole file. Point each at the function, class, or lines it's about (code: { path, symbol }, path#symbol, or path:40-88), so a reader can check it; remove one a newcomer doesn't need by name.`,
    });
  }
  const keyless: string[] = [];
  let leafParts = 0;
  for (const e of elements) {
    const lean =
      e.spec.kind === "container" &&
      !e.childIds.some((c) => model.elements.get(c)?.spec.kind === "component");
    if (e.spec.kind !== "component" && !lean) continue;
    if (testElements.some((t) => e.id === t || e.id.startsWith(`${t}.`))) continue;
    if (generated.includes(e.id) || !sourcesOf(e.id).length) continue;
    leafParts++;
    const keyed = e.childIds.some((c) => {
      const child = model.elements.get(c);
      return child?.spec.kind === "code" && child.code.some(isSnippetRef);
    });
    if (!keyed) keyless.push(e.id);
  }
  if (keyless.length) {
    gaps.push({
      code: "done/no-key-code",
      message: `${keyless.slice(0, 12).join(", ")}${keyless.length > 12 ? `, and ${keyless.length - 12} more` : ""} ${keyless.length === 1 ? "maps" : "map"} only whole files and directories. Add 1 to 5 code elements inside each for the functions or classes a newcomer opens first (its entry point, the core logic), each kind: code with code: { path, symbol } (or path#symbol), so a reader can audit the model against those lines. In a container without components they go directly in the container: don't add a component to hold them.`,
    });
  }

  const dataIds = new Set(model.data.keys());
  const duplicates = [...dataIds].filter((id) => {
    const m = NUMBERED.exec(id);
    return m?.[1] !== undefined && dataIds.has(m[1]);
  });
  if (duplicates.length) {
    gaps.push({
      code: "done/duplicate-data",
      message: `${duplicates.slice(0, 12).join(", ")}${duplicates.length > 12 ? `, and ${duplicates.length - 12} more` : ""} ${duplicates.length === 1 ? "copies a data entry" : "copy data entries"} under a numbered name. If it's the same message or record copied (a service's copy of a shared proto, say), keep one entry from the schema it's defined in, point every step and use at it, and remove the copies. If it's a different one that shares a name, rename it to say how it differs (RemoteWriteExemplar, not Exemplar2).`,
    });
  }

  const leaf = (id: string) =>
    !(model.elements.get(id)?.childIds ?? []).some(
      (c) => model.elements.get(c)?.spec.kind !== "code",
    );
  let steps = 0;
  let stepCode = 0;
  let preciseStepCode = 0;
  let completeJourneys = 0;
  let detailedSteps = 0;
  let preciseSteps = 0;
  for (const j of journeys) {
    const elementHops = j.steps.filter(
      (s) => s.from?.type === "element" || s.to?.type === "element",
    ).length;
    const short = j.steps.length < 3 || elementHops < 2;
    if (short) {
      gaps.push({
        code: "done/short-journey",
        journey: j.id,
        message: `Journey "${j.id}" has ${j.steps.length} step${j.steps.length === 1 ? "" : "s"}. Follow the request through the code to where it ends (the datastore it writes, the message it publishes, the reply the actor gets) and add a step for each hop.`,
      });
    }
    // A flow ends somewhere: what it stores, publishes, or calls outside.
    const on = new Set(
      j.steps.flatMap((s) => [s.from, s.to]).flatMap((t) => (t?.type === "element" ? [t.id] : [])),
    );
    const reaches = [...on].some((id) => INFRA.has(model.elements.get(id)?.spec.kind ?? ""));
    const reachable = model.relationships.flatMap((r) =>
      r.from.type === "element" &&
      on.has(r.from.id) &&
      r.to.type === "element" &&
      INFRA.has(model.elements.get(r.to.id)?.spec.kind ?? "")
        ? [r.to.id]
        : [],
    );
    const stops = !reaches && reachable.length > 0;
    if (!short && !stops) completeJourneys++;
    if (stops) {
      gaps.push({
        code: "done/journey-stops-short",
        journey: j.id,
        message: `Journey "${j.id}" never reaches the datastore, queue, or external it reads, writes, or calls, though its elements use ${[...new Set(reachable)].join(", ")}. Follow the flow to where it ends and add the step that reaches it.`,
      });
    }
    const thin: number[] = [];
    const whole: number[] = [];
    const coarse: number[] = [];
    const elsewhere: string[] = [];
    for (const s of j.steps) {
      steps++;
      const said = !!(s.spec.action?.trim() || s.spec.description?.trim());
      const code = s.spec.code ? stepCodePath(s.spec.code) : undefined;
      const located = !!code && (fileSet.has(code) || files.some((f) => f.startsWith(`${code}/`)));
      // A reply to an actor, or a step between things with no code here, has no code to point at.
      const coded = [s.from, s.to].some(
        (t) => t?.type === "element" && filesUnder(model, map, t.id).length > 0,
      );
      const needsCode = s.to?.type !== "actor" && coded;
      if (said && (located || (!code && !needsCode))) detailedSteps++;
      else thin.push(s.index + 1);
      // A source file named whole: the function (#symbol) or lines (:40-88) say where in it.
      if (code && located && fileSet.has(code) && SOURCE.test(code)) {
        stepCode++;
        if (STEP_SNIPPET.test(s.spec.code ?? "")) preciseStepCode++;
        else whole.push(s.index + 1);
      }
      // The step's code should be its own: in the element it's from or to, or inside one.
      const owner = code && located ? locate(model, code).element?.id : undefined;
      const endIds = [s.from, s.to].flatMap((t) => (t?.type === "element" ? [t.id] : []));
      const astray =
        !!owner &&
        endIds.length > 0 &&
        !endIds.some(
          (id) => owner === id || owner.startsWith(`${id}.`) || id.startsWith(`${owner}.`),
        );
      if (astray) elsewhere.push(`step ${s.index + 1}'s code is in ${owner}`);
      if (!endIds.every(leaf)) coarse.push(s.index + 1);
      else if (!astray) preciseSteps++;
    }
    if (thin.length) {
      gaps.push({
        code: "done/step-detail",
        journey: j.id,
        message: `Journey "${j.id}", step${thin.length === 1 ? "" : "s"} ${thin.join(", ")}: give each an action (what happens, in the domain's words) and code: the file (and function) where it happens, one that exists. Add sends: when you know the data it carries.`,
      });
    }
    if (elsewhere.length) {
      gaps.push({
        code: "done/step-elsewhere",
        journey: j.id,
        message: `Journey "${j.id}": ${elsewhere.join(", ")}, not in the elements the step names. Put each step on the elements whose code does the work, a hop for each, so the journey leads a newcomer through the code.`,
      });
    }
    if (whole.length) {
      gaps.push({
        code: "done/step-whole-file",
        journey: j.id,
        message: `Journey "${j.id}", step${whole.length === 1 ? "" : "s"} ${whole.join(", ")}: code names a whole file. Add the function or method where the step happens (path#functionName), or its lines (path:40-88), so a reader lands on them.`,
      });
    }
    if (coarse.length) {
      gaps.push({
        code: "done/coarse-step",
        journey: j.id,
        message: `Journey "${j.id}", step${coarse.length === 1 ? "" : "s"} ${coarse.join(", ")}: name the component that handles each, not its container, so the step leads to the code.`,
      });
    }
  }

  return {
    gaps,
    stats: {
      elements: arch.length,
      described: arch.length - undescribed.length,
      unmappedFiles: unmapped.length,
      sourceFiles: sources.length,
      orphans,
      testElements: outermost,
      testFiles: testFiles.length,
      testFilesModeled,
      actors: model.actors.size,
      journeys: journeys.length,
      completeJourneys,
      steps,
      detailedSteps,
      preciseSteps,
      widestLevel: widest,
      system,
      dataSteps,
      dataStepsDescribed,
      stores: holders.length,
      storesDescribed: holders.length - emptyHolders.length,
      dataEntries: model.data.size,
      dataDefined: model.data.size - shapeless.length,
      flowSteps,
      flowStepsConnected,
      deploymentFiles: deploymentFiles.length,
      deployable: deployable.length,
      deployed: deployed.length,
      entryPoints: entries.length,
      entryPointsCovered: entries.length - uncovered.length,
      uses: elementUses.length,
      usesMisshapen: misshapenUses.size,
      elementsMisshapen: arch.filter((e) => misshapen.has(e.id)).length,
      deploymentFilesMapped: deploymentFiles.length - unmappedDeployment.length,
      dataDuplicates: duplicates.length,
      ownParts: ownParts.length,
      insideSystem,
      nameable,
      namedFromCode,
      codeRefs: codeElements + stepCode,
      preciseCodeRefs: codeElements - wholeFile.length + preciseStepCode,
      leafParts,
      keyedParts: leafParts - keyless.length,
    },
  };
}

/** A step's code that points into a file: path#symbol or path:40(-88). */
const STEP_SNIPPET = /#[^/#]+$|:\d+(-\d+)?$/;

/**
 * Directory names that say where code sits, not what it is: an element isn't
 * named after src/ or internal/, but after the directory inside it.
 */
const GENERIC_DIR = new Set([
  "src",
  "source",
  "sources",
  "lib",
  "libs",
  "app",
  "apps",
  "internal",
  "pkg",
  "packages",
  "package",
  "services",
  "cmd",
  "main",
  "java",
  "kotlin",
  "scala",
  "python",
  "go",
  "com",
  "org",
  "net",
  "io",
  "modules",
  "code",
  "projects",
]);

/**
 * The codebase's own names for what an element's code: points at: for each
 * path, the last directory (or a file's name, and its directory) that isn't a
 * generic one such as src/ or internal/.
 */
function codeTerms(e: ElementNode): string[] {
  const out: string[] = [];
  for (const c of e.code) {
    // Deployment files and docs a container maps don't name it.
    if (!SOURCE.test(c.path) && !/[*?]|\/$/.test(c.path) && /\.[A-Za-z0-9]+$/.test(c.path))
      continue;
    if (/(^|\/)(Dockerfile|Containerfile|Makefile|Procfile|Jenkinsfile)[^/]*$/.test(c.path))
      continue;
    const parts = c.path
      .replace(/^\.\//, "")
      .split("/")
      .filter((p) => p && !/[*?{}[\]]/.test(p));
    const file = /\.[A-Za-z0-9]+$/.test(parts.at(-1) ?? "") && !/[*?]/.test(c.path);
    const named = parts
      .map((p, i) => (file && i === parts.length - 1 ? p.replace(/\.[^.]+$/, "") : p))
      .filter((p) => !GENERIC_DIR.has(p.toLowerCase()));
    // A path that's only generic directories (internal/**) says nothing the name can match:
    // the name may come from a manifest, so leave it to the reader.
    if (!named.length) return [];
    for (const t of named.slice(file ? -2 : -1)) if (!out.includes(t)) out.push(t);
  }
  return out;
}

/** An ID in plain words: "dashboard-user" is "Dashboard User". */
export function plainWords(id: string): string {
  return id
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => (w[0] ?? "").toUpperCase() + w.slice(1))
    .join(" ");
}

/** A name reduced to compare: lowercase letters and digits, without a plural s. */
function nameRoot(name: string): string {
  const s = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  return s.length > 3 && s.endsWith("s") ? s.slice(0, -1) : s;
}

/** Whether a name is the code's term: one contains the other, ignoring case, punctuation, and plurals. */
function sameName(name: string, term: string): boolean {
  const a = nameRoot(name);
  const b = nameRoot(term);
  if (a.length < 2 || b.length < 2) return a === b;
  return a.includes(b) || (b.includes(a) && a.length >= 3);
}

/**
 * Warnings only a person can settle: seals (their word that the model is
 * right), other repositories' models, owners, and the rules the team set.
 * Every other warning can be fixed from the code, so a done model has none.
 */
const FOR_A_PERSON =
  /^(seal|import|landscape)\/|^ref\/(unresolved-owner|deprecated-target|deprecated-contract)$|^rule\/violation$/;

/** Whether only a person can settle a warning `archdoc check` gives (see FOR_A_PERSON). */
export function needsPerson(code: string): boolean {
  return FOR_A_PERSON.test(code);
}

/** Warnings a done check already lists as a line of its own, and that line's code. */
const LISTED_AS: Record<string, string> = {
  "model/orphan-element": "done/orphan",
  "deploy/not-deployed": "done/undeployed",
  "journey/step-without-message": "done/step-data",
};

/**
 * The warnings a model isn't done with: the ones the code can answer, less
 * those the assessment already lists; and the ones to leave to a person.
 */
export function openWarnings<F extends { severity: string; code: string }>(
  findings: readonly F[],
  a: DiscoveryAssessment,
): { fix: F[]; person: F[] } {
  const gaps = new Set(a.gaps.map((g) => g.code));
  const warnings = findings.filter((f) => f.severity === "warning");
  return {
    fix: warnings.filter((f) => {
      if (needsPerson(f.code)) return false;
      const listed = LISTED_AS[f.code];
      return !(listed && gaps.has(listed));
    }),
    person: warnings.filter((f) => needsPerson(f.code)),
  };
}

/** The assessment as text: what `archdoc check --done` prints and archdoc_check with done answers. */
export function formatDiscovery(a: DiscoveryAssessment, errors = 0, warnings = 0): string {
  const s = a.stats;
  const out: string[] = [];
  const ok = !a.gaps.length && !errors && !warnings;
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const found = [errors ? plural(errors, "error") : "", warnings ? plural(warnings, "warning") : ""]
    .filter(Boolean)
    .join(" and ");
  out.push(
    ok
      ? "✓ The model is done: every level is small and inside the system, every element is named as the code names it, described, and connected, its code points at the functions that do the work, no test code is modeled, the main flows are journeys that say what they carry, and the model says where it runs. Hand it over: say what it covers, the journeys you traced, and what's left for a person. Then ask the user whether they'd like to see it in the explorer, and if so open it (archdoc view --detach --watch --open, or give the URL again if it's already running)."
      : `✗ Not done yet: ${plural(a.gaps.length, "thing")} to finish${found ? `, and archdoc check has ${found} to fix` : ""}.`,
    "",
    `  ${s.described} of ${s.elements} elements described, ${s.orphans.length} unconnected, widest level ${s.widestLevel}`,
    `  ${s.sourceFiles - s.unmappedFiles} of ${s.sourceFiles} source files belong to an element`,
    `  ${s.testElements.length} test or verification element${s.testElements.length === 1 ? "" : "s"}; ${s.testFilesModeled} of ${s.testFiles} test files modeled`,
    `  ${s.actors} actor${s.actors === 1 ? "" : "s"}, ${s.journeys} journey${s.journeys === 1 ? "" : "s"}, ${s.detailedSteps} of ${s.steps} steps with an action and code`,
    `  ${s.dataStepsDescribed} of ${s.dataSteps} steps across a boundary say what they carry; ${s.storesDescribed} of ${s.stores} datastores and queues say what they hold; ${s.dataDefined} of ${s.dataEntries} data entries have fields`,
    `  ${s.insideSystem} of ${s.ownParts} containers, datastores, and queues inside the system; ${s.namedFromCode} of ${s.nameable} parts named as the code names them; ${s.preciseCodeRefs} of ${s.codeRefs} code references point at a function or lines`,
    `  ${s.deployed} of ${s.deployable} containers, datastores, and queues say where they run (${s.deploymentFiles} deployment file${s.deploymentFiles === 1 ? "" : "s"})${s.entryPoints ? `; journeys reach ${s.entryPointsCovered} of ${s.entryPoints} entry points` : ""}`,
  );
  const order = [
    "done/test-code",
    "done/generated-code",
    "done/level-too-wide",
    "done/overlapping-code",
    "done/code-outside-parent",
    "done/one-file-component",
    "done/thin-container",
    "done/flat-container",
    "done/unmapped-code",
    "done/orphan",
    "done/no-system",
    "done/outside-system",
    "done/code-name",
    "done/backwards-use",
    "done/use-in-family",
    "done/use-two-levels",
    "done/undescribed",
    "done/no-environments",
    "done/undeployed",
    "done/unmapped-deployment",
    "done/store-data",
    "done/data-undescribed",
    "done/duplicate-data",
    "done/data-fields",
    "done/no-actors",
    "done/agent-actor",
    "done/actor-name",
    "done/few-journeys",
    "done/actor-without-journey",
    "done/uncovered-entry-points",
    "done/short-journey",
    "done/journey-stops-short",
    "done/step-detail",
    "done/step-data",
    "done/step-elsewhere",
    "done/coarse-step",
    "done/whole-file-code",
    "done/no-key-code",
    "done/step-whole-file",
  ];
  const sorted = [...a.gaps].sort((x, y) => order.indexOf(x.code) - order.indexOf(y.code));
  if (sorted.length) out.push("");
  const cap = 40;
  for (const g of sorted.slice(0, cap)) out.push(`  - ${g.message}`);
  if (sorted.length > cap) {
    out.push(`  … and ${sorted.length - cap} more. Fix these, then check again.`);
  }
  if (!ok) {
    out.push(
      "",
      "Fix only with what the code shows: never add a use or a step you haven't seen in the code to clear a line here. However big the repository, keep going until the model is done: don't stop to summarize, hand over part of it, or ask whether to go on. Work through every line and warning before you hand the model over (a warning that a schema or type is missing means finding it in the code and mapping its fields). If one can't be fixed from the code, say why when you hand it over.",
    );
  }
  return out.join("\n");
}
