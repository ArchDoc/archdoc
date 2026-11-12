// What the triage eval (scripts/eval-triage.mjs) and its free half
// (packages/analyzers/test/triage-evals.test.ts) share: the scenarios in
// evals/triage, the repository each one makes from a fixture with a bug
// seeded in it, and how a Triage record is scored against what the bug is.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

const here = new URL("..", import.meta.url).pathname;
export const SCENARIOS = join(here, "evals/triage");
const FIXTURES = join(here, "evals/fixtures");
const parseYaml = (text) =>
  createRequire(join(here, "packages/cli/package.json"))("yaml").parse(text);

export function scenarioNames() {
  return readdirSync(SCENARIOS, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(SCENARIOS, d.name, "scenario.yaml")))
    .map((d) => d.name)
    .sort();
}

/**
 * A scenario: the fixture, the bug report the agent is handed (`symptom`),
 * and what the bug is (`expected`: the elements the cause is in, the file it's
 * in, the journeys it opens up, and the leads that aren't the cause).
 */
export function loadScenario(name) {
  const s = parseYaml(readFileSync(join(SCENARIOS, name, "scenario.yaml"), "utf8"));
  return { name, ...s, dir: join(SCENARIOS, name) };
}

/** The record a careful triage of the scenario writes: what scores full marks. */
export function goldRecord(scenario) {
  return readFileSync(join(scenario.dir, "gold.yaml"), "utf8");
}

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8" });

/**
 * A scratch repository for a scenario: the fixture with its golden model as
 * .archdoc/ and the bug's files over it, in one commit on main, so the history
 * doesn't give the bug away. Returns its directory; remove the directory
 * above it when done.
 */
export function bugRepo(scenario) {
  const dir = join(mkdtempSync(join(tmpdir(), "archdoc-triage-eval-")), scenario.fixture);
  cpSync(join(FIXTURES, scenario.fixture, "repo"), dir, { recursive: true });
  mkdirSync(join(dir, ".archdoc"));
  cpSync(join(FIXTURES, scenario.fixture, "golden.yaml"), join(dir, ".archdoc/archdoc.yaml"));
  const bug = join(scenario.dir, "bug");
  if (existsSync(bug)) cpSync(bug, dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  git(dir, "add", "-A");
  git(
    dir,
    "-c",
    "user.name=eval",
    "-c",
    "user.email=eval@archdoc.invalid",
    "commit",
    "-qm",
    "init",
  );
  return dir;
}

/** Files the agent changed outside .archdoc/triage/: code it was asked not to touch, and the model. */
export function touchedFiles(dir) {
  return git(dir, "status", "--porcelain", "--untracked-files=all")
    .split("\n")
    .filter(Boolean)
    .map((l) => l.slice(3).trim())
    .filter((f) => !f.startsWith(".archdoc/triage/"));
}

/** One ID names another when they're the same element, written with or without the namespace or system. */
const names = (id, want) => id === want || id.endsWith(`.${want}`) || want.endsWith(`.${id}`);
/** `id` is `want` or one of its parts. */
const within = (id, want) => names(id, want) || id.startsWith(`${want}.`);

const bare = (path) =>
  String(path)
    .replace(/[#:].*$/, "")
    .replace(/^\.\//, "");

/**
 * Scores a Triage record, from its check (`checkTrace` in @archdoc/core: a
 * view and findings), against what the scenario says the bug is:
 *
 * - cause: a cause step (role cause, or root-cause.step) is on an element the
 *   cause is in, one of its parts, or what it's part of (`coarse`).
 * - specific: on the element the cause is in or one of its parts, not only
 *   on what it's part of, though the model has the finer element.
 * - code: that step's code, or a confirmed lead's, is the file the bug is in.
 * - journey: the record opens up one of the journeys the bug shows up in.
 * - ruledOut: the share of leads that aren't the cause it ruled out.
 * - wrongBlame: a cause step names a lead that isn't the cause, and nothing
 *   the cause is in.
 * - honest: no step or lead says reproduced (the agent can't run anything).
 * - inModel: the share of steps whose hop the model declares.
 * - described: the share of steps with a description of what happened there.
 * - data: the share of steps across elements that say what they carry
 *   (sends, creates, or changes).
 * - stopped: status root-caused: it explained the bug and didn't fix it.
 * - errors: what archdoc check says is wrong with it.
 * - pass: cause, code, stopped, honest, and no errors.
 */
export function scoreRecord(check, scenario) {
  const { view, findings } = check;
  const want = scenario.expected ?? {};
  const cause = want.cause ?? [];
  const notCause = want["not-cause"] ?? [];
  const coarse = want.coarse ?? [];
  const causeSteps = view.steps.filter((s) => view.causes.includes(s.step));
  const ends = (s) => [s.from.id, s.to.id, s.missing?.from.id, s.missing?.to.id].filter(Boolean);
  const onCause = (s) => ends(s).some((id) => cause.some((c) => within(id, c)));
  const onCoarse = (s) => ends(s).some((id) => coarse.some((c) => names(id, c)));
  const specific = causeSteps.some(onCause);
  const causeHit = specific || causeSteps.some(onCoarse);
  const paths = [
    ...causeSteps.flatMap((s) => s.code.map((c) => c.path)),
    ...view.hypotheses
      .filter((h) => h.verdict === "confirmed")
      .flatMap((h) => h.code.map((c) => c.path)),
  ].map(bare);
  const code = want.code ? paths.includes(bare(want.code)) : true;
  const journey = want.journeys?.length
    ? Boolean(view.anchor && want.journeys.includes(view.anchor.journey))
    : true;
  const ruled = notCause.filter((n) =>
    view.hypotheses.some(
      (h) => h.verdict === "ruled-out" && h.element?.id && within(h.element.id, n),
    ),
  );
  const wrongBlame = causeSteps.some(
    (s) => !onCause(s) && !onCoarse(s) && ends(s).some((id) => notCause.some((n) => within(id, n))),
  );
  const honest =
    !view.steps.some((s) => s.evidence === "reproduced") &&
    !view.hypotheses.some((h) => h.evidence === "reproduced");
  const inModel = view.steps.length
    ? (view.steps.length - view.undeclared.length) / view.steps.length
    : undefined;
  const described = view.steps.length
    ? view.steps.filter((s) => s.description?.trim()).length / view.steps.length
    : undefined;
  const across = view.steps.filter((s) => s.from.id && s.to.id && s.from.id !== s.to.id);
  const data = across.length
    ? across.filter(
        (s) =>
          s.spec.sends !== undefined ||
          s.spec.creates !== undefined ||
          s.spec.changes !== undefined,
      ).length / across.length
    : undefined;
  const stopped = view.status === "root-caused";
  const errors = findings
    .filter((f) => f.severity === "error")
    .map((f) => `${f.code}: ${f.message}`);
  return {
    cause: causeHit,
    specific,
    code,
    journey,
    ruledOut: notCause.length ? ruled.length / notCause.length : undefined,
    wrongBlame,
    honest,
    inModel,
    described,
    data,
    stopped,
    status: view.status,
    steps: view.steps.length,
    errors,
    pass: causeHit && code && stopped && honest && !errors.length,
  };
}
