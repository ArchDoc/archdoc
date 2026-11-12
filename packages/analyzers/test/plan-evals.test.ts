import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildModel, checkPlan, loadPlans } from "@archdoc/core";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// The free half of the plan eval (scripts/eval-plan.mjs): each scenario
// starts where its stage does. A review's plan loads, and its check finds
// what a check can, so the flaws left for the agent are the ones that take
// reading the code; a plan to carry out is clean but for its tasks.
const evals = fileURLToPath(new URL("../../../evals/", import.meta.url));
const scenarios = readdirSync(join(evals, "plan"), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);
const stage = (name: string) =>
  parse(readFileSync(join(evals, "plan", name, "scenario.yaml"), "utf8")).stage ?? "review";
const golden = (fixture: string) => {
  const text = readFileSync(join(evals, "fixtures", fixture, "golden.yaml"), "utf8");
  const sources = [{ path: ".archdoc/archdoc.yaml", text }];
  return { sources, model: buildModel(sources, { root: ".archdoc/archdoc.yaml" }) };
};

describe.each(scenarios.filter((n) => stage(n) === "start"))("plan eval %s", (name) => {
  it("starts from the idea alone: no plan yet", () => {
    const scenario = parse(readFileSync(join(evals, "plan", name, "scenario.yaml"), "utf8"));
    expect(scenario.idea).toBeTruthy();
    expect(scenario.expected.scope.length).toBeGreaterThan(0);
    expect(existsSync(join(evals, "plan", name, "plan.yaml"))).toBe(false);
  });
});

describe.each(scenarios.filter((n) => stage(n) === "carry"))("plan eval %s", (name) => {
  const scenario = parse(readFileSync(join(evals, "plan", name, "scenario.yaml"), "utf8"));
  const text = readFileSync(join(evals, "plan", name, "plan.yaml"), "utf8");
  const { sources, model } = golden(scenario.fixture);

  it("is agreed and ready, and only lacks its tasks", () => {
    const { plans, diagnostics } = loadPlans([{ path: `.archdoc/plans/${name}.yaml`, text }]);
    expect(diagnostics).toEqual([]);
    const plan = plans[0];
    if (!plan) throw new Error("no plan");
    expect(plan.spec.status).toBe("ready");
    const c = checkPlan(model, sources, plan, { root: ".archdoc/archdoc.yaml" });
    expect(c.findings.map((f) => f.code)).toEqual(["plan/no-tasks"]);
    const ids = new Set([...plan.spec.changes, ...plan.spec.sequences].map((x) => x.id));
    for (const b of scenario.expected.built) expect(ids.has(b)).toBe(true);
  });
});

describe.each(scenarios.filter((n) => stage(n) === "review"))("plan eval %s", (name) => {
  const scenario = parse(readFileSync(join(evals, "plan", name, "scenario.yaml"), "utf8"));
  const text = readFileSync(join(evals, "plan", name, "plan.yaml"), "utf8");
  const golden = readFileSync(join(evals, "fixtures", scenario.fixture, "golden.yaml"), "utf8");
  const sources = [{ path: ".archdoc/archdoc.yaml", text: golden }];
  const model = buildModel(sources, { root: ".archdoc/archdoc.yaml" });

  it("loads, sent, with every flaw on an item it has", () => {
    const { plans, diagnostics } = loadPlans([{ path: `.archdoc/plans/${name}.yaml`, text }]);
    expect(diagnostics).toEqual([]);
    const plan = plans[0];
    expect(plan?.spec.status).toBe("reviewing");
    const ids = new Set([
      ...(plan?.spec.changes.map((c) => c.id) ?? []),
      ...(plan?.spec.sequences.flatMap((s) => [
        s.id,
        ...s.steps.map((_, i) => `${s.id}#${i + 1}`),
      ]) ?? []),
    ]);
    for (const f of scenario.expected.flaws)
      expect(f.on.some((o: string) => ids.has(o))).toBe(true);
  });

  it("checks: the missing intent is found, and nothing errs", () => {
    const plan = loadPlans([{ path: `.archdoc/plans/${name}.yaml`, text }]).plans[0];
    if (!plan) throw new Error("no plan");
    const c = checkPlan(model, sources, plan, { root: ".archdoc/archdoc.yaml" });
    expect(c.findings.filter((f) => f.code === "plan/missing-intent")).toHaveLength(1);
    expect(c.findings.filter((f) => f.severity === "error")).toEqual([]);
    expect(c.findings.map((f) => f.code)).not.toContain("plan/would-break");
  });
});
