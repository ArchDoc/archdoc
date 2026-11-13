import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildModel, checkPlan, loadPlans } from "@archdoc/core";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// The free half of the plan eval (scripts/eval-plan.mjs): each scenario
// starts where its stage does. A plan to answer is the person's alone, sent
// once and unread, and checks clean, so what's scored is the agent's answer;
// a plan to carry out is clean but for its tasks.
const evals = fileURLToPath(new URL("../../../evals/", import.meta.url));
const scenarios = readdirSync(join(evals, "plan"), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);
const stage = (name: string) =>
  parse(readFileSync(join(evals, "plan", name, "scenario.yaml"), "utf8")).stage;
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

describe.each(scenarios.filter((n) => stage(n) === "answer"))("plan eval %s", (name) => {
  const scenario = parse(readFileSync(join(evals, "plan", name, "scenario.yaml"), "utf8"));
  const text = readFileSync(join(evals, "plan", name, "plan.yaml"), "utf8");
  const { sources, model } = golden(scenario.fixture);
  const { plans, diagnostics } = loadPlans([{ path: `.archdoc/plans/${name}.yaml`, text }]);
  const plan = plans[0];
  if (!plan) throw new Error("no plan");

  it("is sent once, with every item unread and nothing from the agent yet", () => {
    expect(diagnostics).toEqual([]);
    expect(plan.spec.status).toBe("reviewing");
    expect(plan.spec.sent).toBe(1);
    expect(plan.spec.seen ?? 0).toBe(0);
    const items = [...plan.spec.intents, ...plan.spec.changes, ...plan.spec.notes];
    expect(items.every((x) => !x.by?.startsWith("agent:"))).toBe(true);
    expect(new Set(plan.spec.unread?.map((u) => u.id))).toEqual(new Set(items.map((x) => x.id)));
  });

  it("has the intents it scores: clear ones, an open one between two boxes, one on the person's box", () => {
    const ids = plan.spec.intents.map((i) => i.id);
    for (const id of [...scenario.expected.clear, scenario.expected.open])
      expect(ids).toContain(id);
    expect(plan.spec.intents.find((i) => i.id === scenario.expected.open)?.to).toBeTruthy();
    const box = plan.spec.changes.find((c) => c.id === scenario.expected.box.change);
    expect(box?.add?.id).toBe(scenario.expected.box.id);
    expect(plan.spec.intents.some((i) => i.on === scenario.expected.box.id)).toBe(true);
  });

  it("checks: each intent waits on the agent, and nothing else is wrong", () => {
    const c = checkPlan(model, sources, plan, { root: ".archdoc/archdoc.yaml" });
    const found = c.findings.filter((f) => f.severity !== "info");
    expect(found.filter((f) => f.code !== "plan/open-intent")).toEqual([]);
    expect(found.map((f) => f.item).sort()).toEqual(plan.spec.intents.map((i) => i.id).sort());
  });
});
