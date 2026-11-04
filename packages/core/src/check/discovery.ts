import { filesUnder, resolveCodeMap } from "../codemap/codemap.js";
import type { ElementNode, Model } from "../model.js";
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
const INIT_DESCRIPTION =
  /^(The \S+ (package|binary|module|crate|project|action|service in \S+|the repository runs)|The Python project|The whole repository, until you know its parts|The database (\S+ describes|the migrations in \S+ build)|An? (directory|code directory|source file)|(Function|Class) \S+)( \([^)]*\))?\.$/;

/** The limits a level of the model is held to, so it can be read top-down. */
export const LEVEL_LIMITS = { top: 12, children: 10 } as const;

/** One thing a model still lacks before it's done. */
export interface DiscoveryGap {
  /** done/level-too-wide, done/undescribed, done/test-code, done/orphan, done/no-actors, done/few-journeys, done/short-journey, done/step-detail, done/coarse-step. */
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
    /** Elements nothing connects to. */
    orphans: string[];
    /** Elements whose code is mostly test or verification code. */
    testElements: string[];
    /** Test and verification source files in the repository, and how many the model gives elements of their own. */
    testFiles: number;
    testFilesModeled: number;
    actors: number;
    journeys: number;
    steps: number;
    /** Steps that say what happens (action or description) and point at code that exists. */
    detailedSteps: number;
    /** Steps whose elements are the most specific the model has (no components left to name). */
    preciseSteps: number;
    /** The widest level: how many elements (not code) one parent, or the top, holds. */
    widestLevel: number;
  };
}

const ARCHITECTURE = new Set(["container", "component", "datastore", "queue", "external"]);
const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs|go|py|rs|java|kt|kts|rb|cs|php|swift|scala|ex|exs)$/;

/**
 * What a model still lacks before it's done. `files` are the repository's
 * files, relative to its root, to tell which elements cover test code and
 * whether a step's code exists.
 */
export function assessDiscovery(model: Model, files: readonly string[]): DiscoveryAssessment {
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
  const testSet = new Set(testFiles);
  const testElements: string[] = [];
  for (const e of elements) {
    if (e.spec.kind === "system") continue;
    const under = filesUnder(model, map, e.id).filter((f) => SOURCE.test(f));
    const tests = under.filter((f) => testSet.has(f)).length;
    // Mostly tests: a test suite, a mock, a test helper modeled as an element.
    // A container's glob that also covers its own tests is fine.
    if (under.length && tests / under.length > 0.5) testElements.push(e.id);
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
      message: `${journeys.length ? "One journey" : "No journeys"}. Add the two or three flows a newcomer would trace first, starting from the entry points: routes, pages, CLI commands, consumers, and scheduled jobs.`,
    });
  }
  const leaf = (id: string) =>
    !(model.elements.get(id)?.childIds ?? []).some(
      (c) => model.elements.get(c)?.spec.kind !== "code",
    );
  let steps = 0;
  let detailedSteps = 0;
  let preciseSteps = 0;
  for (const j of journeys) {
    const elementHops = j.steps.filter(
      (s) => s.from?.type === "element" || s.to?.type === "element",
    ).length;
    if (j.steps.length < 3 || elementHops < 2) {
      gaps.push({
        code: "done/short-journey",
        journey: j.id,
        message: `Journey "${j.id}" has ${j.steps.length} step${j.steps.length === 1 ? "" : "s"}. Follow the request through the code to where it ends (the datastore it writes, the message it publishes, the reply the actor gets) and add a step for each hop.`,
      });
    }
    const thin: number[] = [];
    const coarse: number[] = [];
    for (const s of j.steps) {
      steps++;
      const said = !!(s.spec.action?.trim() || s.spec.description?.trim());
      const code = s.spec.code ? stepCodePath(s.spec.code) : undefined;
      const located = !!code && (fileSet.has(code) || files.some((f) => f.startsWith(`${code}/`)));
      if (said && located) detailedSteps++;
      else thin.push(s.index + 1);
      const ends = [s.from, s.to].filter((t) => t?.type === "element") as { id: string }[];
      if (ends.every((t) => leaf(t.id))) preciseSteps++;
      else coarse.push(s.index + 1);
    }
    if (thin.length) {
      gaps.push({
        code: "done/step-detail",
        journey: j.id,
        message: `Journey "${j.id}", step${thin.length === 1 ? "" : "s"} ${thin.join(", ")}: give each an action (what happens, in the domain's words) and code: the file (and function) where it happens, one that exists. Add sends: when you know the data it carries.`,
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
      orphans,
      testElements: outermost,
      testFiles: testFiles.length,
      testFilesModeled,
      actors: model.actors.size,
      journeys: journeys.length,
      steps,
      detailedSteps,
      preciseSteps,
      widestLevel: widest,
    },
  };
}

/** The assessment as text: what `archdoc check --done` prints and archdoc_check with done answers. */
export function formatDiscovery(a: DiscoveryAssessment, errors = 0): string {
  const s = a.stats;
  const out: string[] = [];
  const ok = !a.gaps.length && !errors;
  out.push(
    ok
      ? "✓ The model is done: every level is small, every element is described and connected, no test code is modeled, and the main flows are journeys."
      : `✗ Not done yet: ${a.gaps.length} thing${a.gaps.length === 1 ? "" : "s"} to finish${errors ? `, and archdoc check has ${errors} error${errors === 1 ? "" : "s"}` : ""}.`,
    "",
    `  ${s.described} of ${s.elements} elements described, ${s.orphans.length} unconnected, widest level ${s.widestLevel}`,
    `  ${s.testElements.length} test or verification element${s.testElements.length === 1 ? "" : "s"}; ${s.testFilesModeled} of ${s.testFiles} test files modeled`,
    `  ${s.actors} actor${s.actors === 1 ? "" : "s"}, ${s.journeys} journey${s.journeys === 1 ? "" : "s"}, ${s.detailedSteps} of ${s.steps} steps with an action and code`,
  );
  const order = [
    "done/test-code",
    "done/level-too-wide",
    "done/orphan",
    "done/undescribed",
    "done/no-actors",
    "done/few-journeys",
    "done/short-journey",
    "done/step-detail",
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
      "Fix only with what the code shows: never add a use or a step you haven't seen in the code to clear a line here. If one can't be fixed, say why when you hand the model over.",
    );
  }
  return out.join("\n");
}
