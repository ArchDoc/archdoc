import { rmSync } from "node:fs";
import { dirname } from "node:path";
import { loadModel } from "@archdoc/core";
import { afterAll, describe, expect, it } from "vitest";
import { checkRepository, editAnswer, sealAnswer } from "../src/index.js";

// The free half of the everyday-loop eval: each scenario in evals/change has to
// be one an agent can pass. Its starting repository checks clean and doesn't
// meet the scenario yet; its reference solution (the code change, the model
// edit, and a seal) meets all of it and checks clean against main. The agent
// half, which asks an agent to make the change, is scripts/eval-change.mjs.

interface Score {
  model: number;
  missed: string[];
  clean: boolean;
  left: string[];
}
interface Scenario {
  name: string;
  fixture: string;
}
interface Lib {
  scenarioNames(): string[];
  loadScenario(name: string): Scenario;
  startRepo(scenario: Scenario, api: unknown): Promise<string>;
  applySolution(dir: string, scenario: Scenario, api: unknown): Promise<void>;
  scoreRepo(dir: string, scenario: Scenario, api: unknown): Promise<Score>;
  scoreSession(lines: unknown[]): Record<string, number | boolean>;
}

const libPath = "../../../scripts/eval-change-lib.mjs";
const lib = (await import(libPath)) as Lib;
const api = { loadModel, checkRepository, editAnswer, sealAnswer };
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(dirname(d), { recursive: true, force: true });
});

describe("evals: the everyday loop's scenarios", () => {
  for (const name of lib.scenarioNames()) {
    it(`${name}: starts unmet and clean, and its solution meets it and checks clean`, async () => {
      const scenario = lib.loadScenario(name);
      const dir = await lib.startRepo(scenario, api);
      dirs.push(dir);
      const before = await lib.scoreRepo(dir, scenario, api);
      expect(before.left).toEqual([]);
      expect(before.model).toBeLessThan(1);
      await lib.applySolution(dir, scenario, api);
      const after = await lib.scoreRepo(dir, scenario, api);
      expect(after.missed).toEqual([]);
      expect(after.left).toEqual([]);
    }, 60_000);
  }

  it("reads the loop from a session's tool calls", () => {
    const call = (name: string, input: Record<string, unknown>) => ({
      type: "assistant",
      message: { content: [{ type: "tool_use", name, input }] },
    });
    const session = lib.scoreSession([
      call("mcp__archdoc__archdoc_context", { task: "move payments" }),
      call("Edit", { file_path: "/r/apps/api/src/orders/service.ts" }),
      call("Bash", { command: "archdoc edit '[]'" }),
      call("Edit", { file_path: "/r/.archdoc/archdoc.yaml" }),
      call("Read", { file_path: "/r/.archdoc/archdoc.yaml" }),
      call("Bash", { command: "npx -y @archdoc/cli check --base main" }),
      call("mcp__archdoc__archdoc_seal", { facts: ["element:shop.api.orders"] }),
    ]);
    expect(session).toMatchObject({
      contextFirst: true,
      context: 1,
      edit: 1,
      handEdits: 1,
      yamlReads: 1,
      check: 1,
      seal: 1,
    });
  });
});
