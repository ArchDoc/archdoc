import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { checkTrace, listRepoFiles, loadModel, loadTraces, type TraceCheck } from "@archdoc/core";
import { afterAll, describe, expect, it } from "vitest";
import { triageStartAnswer } from "../src/index.js";

// The free half of the triage eval: each scenario in evals/triage seeds a bug
// in a fixture. Its golden model has to load, the record a careful triage
// writes (gold.yaml) has to check clean and score full marks, and a record
// that blames the lead that isn't the cause has to fail. The agent half,
// which hands an agent the bug report, is scripts/eval-triage.mjs.

interface Scenario {
  name: string;
  fixture: string;
  symptom: string;
  expected: { journeys?: string[]; "not-cause"?: string[] };
}
interface Score {
  cause: boolean;
  specific: boolean;
  code: boolean;
  journey: boolean;
  ruledOut?: number;
  wrongBlame: boolean;
  honest: boolean;
  inModel?: number;
  stopped: boolean;
  errors: string[];
  pass: boolean;
}
interface Lib {
  scenarioNames(): string[];
  loadScenario(name: string): Scenario;
  goldRecord(scenario: Scenario): string;
  bugRepo(scenario: Scenario): string;
  touchedFiles(dir: string): string[];
  scoreRecord(check: TraceCheck, scenario: Scenario): Score;
}

const libPath = "../../../scripts/eval-triage-lib.mjs";
const lib = (await import(libPath)) as Lib;
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(dirname(d), { recursive: true, force: true });
});

async function checkRecord(dir: string, text: string): Promise<TraceCheck> {
  const m = await loadModel(".", { cwd: dir });
  expect(m.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  const { traces, diagnostics } = loadTraces([{ path: ".archdoc/triage/r.yaml", text }]);
  expect(diagnostics).toEqual([]);
  const files = await listRepoFiles(dir);
  return checkTrace(m, traces[0] as NonNullable<(typeof traces)[0]>, { files });
}

describe("evals: the triage scenarios", () => {
  for (const name of lib.scenarioNames()) {
    describe(name, () => {
      const scenario = lib.loadScenario(name);
      const dir = lib.bugRepo(scenario);
      dirs.push(dir);

      it("gives the careful record full marks", async () => {
        const score = lib.scoreRecord(await checkRecord(dir, lib.goldRecord(scenario)), scenario);
        expect(score).toMatchObject({
          cause: true,
          specific: true,
          code: true,
          journey: true,
          ruledOut: 1,
          wrongBlame: false,
          honest: true,
          inModel: 1,
          stopped: true,
          errors: [],
          pass: true,
        });
      }, 30_000);

      it("fails a record that blames the wrong lead, or says it reproduced it", async () => {
        const [lead] = scenario.expected["not-cause"] ?? [];
        const text = [
          `triage: ${name}`,
          "title: Wrong",
          "status: root-caused",
          "symptom: s",
          "root-cause: { summary: It's here, step: 1 }",
          `steps: [{ from: ${lead}, to: ${lead}, role: cause, evidence: reproduced }]`,
        ].join("\n");
        const score = lib.scoreRecord(await checkRecord(dir, text), scenario);
        expect(score).toMatchObject({ cause: false, honest: false, pass: false, wrongBlame: true });
      }, 30_000);

      it("starts a record on a journey the bug shows up in, touching only .archdoc/triage", async () => {
        const r = await triageStartAnswer({ cwd: dir }, { symptom: scenario.symptom, id: name });
        expect(r.ok).toBe(true);
        // The report is in words, with no stack: the elements it names place it.
        const text = readFileSync(join(dir, `.archdoc/triage/${name}.yaml`), "utf8");
        const journey = /^expands: ([\w-]+)#/m.exec(text)?.[1];
        expect(scenario.expected.journeys).toContain(journey);
        expect(lib.touchedFiles(dir)).toEqual([]);
        // Code the agent changes shows.
        mkdirSync(join(dir, "scratch"), { recursive: true });
        writeFileSync(join(dir, "scratch/x.txt"), "x");
        expect(lib.touchedFiles(dir)).toEqual(["scratch/x.txt"]);
        rmSync(join(dir, "scratch"), { recursive: true });
        rmSync(join(dir, ".archdoc/triage"), { recursive: true });
      }, 30_000);
    });
  }
});
