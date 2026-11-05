import { filesUnder, locate, resolveCodeMap } from "../codemap/codemap.js";
import { compileGlob } from "../codemap/glob.js";
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
  /** done/level-too-wide, done/thin-container, done/flat-container, done/undescribed, done/test-code, done/unmapped-code, done/orphan, done/no-system, done/no-actors, done/actor-without-journey, done/few-journeys, done/uncovered-entry-points, done/short-journey, done/journey-stops-short, done/step-detail, done/step-data, done/data-undescribed, done/data-fields, done/agent-actor, done/step-elsewhere, done/coarse-step, done/store-data, done/no-environments, done/undeployed. */
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
  };
}

const ARCHITECTURE = new Set(["container", "component", "datastore", "queue", "external"]);
/** Code that's never architecture: vendored, generated, or built. */
const NOT_ARCHITECTURE =
  /(^|\/)(node_modules|vendor|third_party|dist|build|out|target|generated|gen|\.[^/]+)\/|\.(pb|pb\.gw|gen|generated)\.[a-z]+$|_pb2(_grpc)?\.py$/;
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
  const codeHeavy = elements.filter(
    (e) =>
      e.spec.kind === "component" &&
      e.childIds.filter((c) => model.elements.get(c)?.spec.kind === "code").length >
        LEVEL_LIMITS.children,
  );
  for (const e of codeHeavy) {
    const n = e.childIds.length;
    gaps.push({
      code: "done/level-too-wide",
      element: e.id,
      message: `${e.id} holds ${n} code elements. Fold them into its code: glob, and keep only the entry points and core functions a newcomer has to find by name.`,
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

  const leaf = (id: string) =>
    !(model.elements.get(id)?.childIds ?? []).some(
      (c) => model.elements.get(c)?.spec.kind !== "code",
    );
  let steps = 0;
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
    },
  };
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
      ? "✓ The model is done: every level is small, every element is described and connected, no test code is modeled, the main flows are journeys that say what they carry, and the model says where it runs."
      : `✗ Not done yet: ${plural(a.gaps.length, "thing")} to finish${found ? `, and archdoc check has ${found} to fix` : ""}.`,
    "",
    `  ${s.described} of ${s.elements} elements described, ${s.orphans.length} unconnected, widest level ${s.widestLevel}`,
    `  ${s.sourceFiles - s.unmappedFiles} of ${s.sourceFiles} source files belong to an element`,
    `  ${s.testElements.length} test or verification element${s.testElements.length === 1 ? "" : "s"}; ${s.testFilesModeled} of ${s.testFiles} test files modeled`,
    `  ${s.actors} actor${s.actors === 1 ? "" : "s"}, ${s.journeys} journey${s.journeys === 1 ? "" : "s"}, ${s.detailedSteps} of ${s.steps} steps with an action and code`,
    `  ${s.dataStepsDescribed} of ${s.dataSteps} steps across a boundary say what they carry; ${s.storesDescribed} of ${s.stores} datastores and queues say what they hold; ${s.dataDefined} of ${s.dataEntries} data entries have fields`,
    `  ${s.deployed} of ${s.deployable} containers, datastores, and queues say where they run (${s.deploymentFiles} deployment file${s.deploymentFiles === 1 ? "" : "s"})${s.entryPoints ? `; journeys reach ${s.entryPointsCovered} of ${s.entryPoints} entry points` : ""}`,
  );
  const order = [
    "done/test-code",
    "done/level-too-wide",
    "done/thin-container",
    "done/flat-container",
    "done/unmapped-code",
    "done/orphan",
    "done/no-system",
    "done/undescribed",
    "done/no-environments",
    "done/undeployed",
    "done/store-data",
    "done/data-undescribed",
    "done/data-fields",
    "done/no-actors",
    "done/agent-actor",
    "done/few-journeys",
    "done/actor-without-journey",
    "done/uncovered-entry-points",
    "done/short-journey",
    "done/journey-stops-short",
    "done/step-detail",
    "done/step-data",
    "done/step-elsewhere",
    "done/coarse-step",
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
      "Fix only with what the code shows: never add a use or a step you haven't seen in the code to clear a line here. Work through every line and warning before you hand the model over (a warning that a schema or type is missing means finding it in the code and mapping its fields). If one can't be fixed from the code, say why when you hand it over.",
    );
  }
  return out.join("\n");
}
