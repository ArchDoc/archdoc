import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { codeChange } from "../src/index.js";

// The free half of the branch diff eval: on each scenario in evals/diff, what
// the Diff tab reads from the branch's code (codeChange, which /api/compare
// serves) has to be what the scenario says the branch changed. The agent half,
// which asks an agent to show a person the diff, is scripts/eval-diff.mjs.

interface Lib {
  scenarioNames(): string[];
  loadScenario(name: string): { name: string; fixture: string };
  branchRepo(scenario: { name: string; fixture: string }): string;
  diffTabChange(code: unknown): unknown;
  changeFacts(change: unknown): Set<string>;
  scoreChange(
    found: Set<string>,
    scenario: unknown,
  ): { f1: number; missed: string[]; wrong: string[] };
  diffEvalReasons(base: string, cwd?: string): string[];
  DIFF_PATHS: { path: string; lines?: RegExp }[];
}

const libPath = "../../../scripts/eval-diff-lib.mjs";
const lib = (await import(libPath)) as Lib;
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(dirname(d), { recursive: true, force: true });
});

describe("evals: the Diff tab on the branch diff scenarios", () => {
  for (const name of lib.scenarioNames()) {
    it(`reads ${name} from the code`, async () => {
      const scenario = lib.loadScenario(name);
      const dir = lib.branchRepo(scenario);
      dirs.push(dir);
      const read = await codeChange({ cwd: dir, base: "main" });
      const score = lib.scoreChange(lib.changeFacts(lib.diffTabChange(read.change)), scenario);
      expect({ missed: score.missed, wrong: score.wrong }).toEqual({ missed: [], wrong: [] });
    }, 30_000);
  }
});

describe("evals: when the branch diff eval runs", () => {
  it("covers the differ, the compare API, the Diff tab, and the skills", () => {
    const paths = lib.DIFF_PATHS.map((p) => p.path);
    for (const p of [
      "packages/core/src/diff/",
      "packages/analyzers/src/code-change.ts",
      "packages/cli/src/server.ts",
      "apps/web/src/model/compare.ts",
      "integrations/claude-plugin/skills/",
    ])
      expect(paths).toContain(p);
  });

  it("runs for a change in its paths, and for a skill edit only when it's about the diff", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "archdoc-diff-paths-")), "repo");
    dirs.push(dir);
    const git = (...a: string[]) => execFileSync("git", a, { cwd: dir, stdio: "ignore" });
    const write = (path: string, text: string) => {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    };
    const skill = "integrations/claude-plugin/skills/archdoc/SKILL.md";
    mkdirSync(dir);
    write(skill, "# Skill\n\nModel the repo.\n");
    write("packages/core/src/check/check.ts", "export {};\n");
    git("init", "-q", "-b", "main");
    git("add", "-A");
    git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init");
    git("checkout", "-q", "-b", "change");

    write("packages/core/src/check/check.ts", "export const a = 1;\n");
    write(skill, "# Skill\n\nModel the repository.\n");
    expect(lib.diffEvalReasons("main", dir)).toEqual([]);

    write(skill, "# Skill\n\nModel the repository. To show a change, add --base main.\n");
    expect(lib.diffEvalReasons("main", dir)).toEqual([skill]);

    write("packages/core/src/diff/code-diff.ts", "export {};\n");
    expect(lib.diffEvalReasons("main", dir)).toEqual([
      skill,
      "packages/core/src/diff/code-diff.ts",
    ]);
  });
});
