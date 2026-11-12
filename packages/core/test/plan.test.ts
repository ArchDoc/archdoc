import { describe, expect, it } from "vitest";
import {
  applyPlan,
  buildModel,
  checkPlan,
  editPlan,
  formatPlan,
  loadPlans,
  type ModelSource,
  nextStep,
  type Plan,
  parsePlan,
  planId,
} from "../src/index.js";
import { dedent } from "./helpers.js";

const ROOT = dedent(`
  archdoc: "2.0"
  namespace: shop
  actors:
    shopper: { kind: person, name: Shopper }
  elements:
    shop:
      kind: system
      elements:
        web: { kind: container, code: [apps/web/**], uses: { api: Places orders } }
        api:
          kind: container
          code: [services/api/**]
          uses: { db: Saves orders }
          elements:
            checkout: { kind: component, code: [services/api/checkout/**] }
        db: { kind: datastore }
  journeys:
    checkout:
      actor: shopper
      goal: Buy what's in the cart
      importance: critical
      steps:
        - { from: shopper, to: shop.web, action: Clicks pay }
        - { from: shop.web, to: shop.api, action: Places the order }
        - { from: shop.api, to: shop.db, action: Saves the order }
`);

const sources: ModelSource[] = [{ path: "archdoc.yaml", text: ROOT }];
const model = buildModel(sources, { root: "archdoc.yaml" });
const FILE = ".archdoc/plans/p.yaml";

/** A plan: the base fields and these. */
const plan = (yaml = ""): Plan => {
  const r = parsePlan(FILE, `${dedent(BASE)}\n${yaml.trim() ? dedent(yaml) : ""}`);
  if (!r.plan) throw new Error(JSON.stringify(r.diagnostics));
  return r.plan;
};

const codes = (c: { findings: { code: string }[] }) => c.findings.map((f) => f.code);

const BASE = `
  plan: p
  title: Email a receipt
  goal: Email the shopper a receipt after they pay
`;

describe("plan files", () => {
  it("reads a plan with every list present", () => {
    const p = plan();
    expect(p.id).toBe("p");
    expect(p.spec.changes).toEqual([]);
    expect(p.spec.sequences).toEqual([]);
    expect(p.spec.notes).toEqual([]);
    expect(p.spec.tasks).toEqual([]);
  });

  it("refuses a change that is more than one op", () => {
    const r = parsePlan(
      FILE,
      dedent(`
        plan: p
        title: t
        changes:
          - { id: c1, add: { id: shop.mailer }, remove: shop.db }
      `),
    );
    expect(r.plan).toBeUndefined();
    expect(r.diagnostics.map((d) => d.message).join()).toMatch(/exactly one of/);
  });

  it("flags two plans with one ID", () => {
    const text = dedent(BASE);
    const r = loadPlans([
      { path: ".archdoc/plans/a.yaml", text },
      { path: ".archdoc/plans/b.yaml", text },
    ]);
    expect(r.plans).toHaveLength(1);
    expect(r.diagnostics.map((d) => d.code)).toContain("plan/duplicate");
  });

  it("makes an ID from a goal", () => {
    expect(planId("Email the shopper a receipt after they pay!")).toMatch(/^email-the-shopper/);
  });
});

describe("applyPlan", () => {
  it("makes agreed changes and new journeys, leaving suggestions out unless asked", () => {
    const p = plan(`
      changes:
        - { id: c1, intent: Sends mail, add: { id: shop.mailer, kind: container } }
        - { id: c2, intent: After the order saves, use: { from: shop.api, to: shop.mailer, description: Sends the receipt } }
        - { id: c3, intent: Retries, status: suggested, add: { id: shop.queue, kind: queue } }
      sequences:
        - id: s1
          journey: receipt
          actor: shopper
          goal: Get a receipt
          steps:
            - { from: shopper, to: shop.web, action: Pays, intent: Starts it }
            - { from: shop.web, to: shop.api, action: Places the order, intent: As today }
            - { from: shop.api, to: shop.mailer, action: Sends the receipt, intent: The new hop }
    `);
    const applied = applyPlan(sources, model, p, { root: "archdoc.yaml" });
    expect(applied.problems).toEqual([]);
    expect(applied.applied.map((a) => a.item)).toEqual(["c1", "c2", "s1"]);
    const after = buildModel(applied.sources, { root: "archdoc.yaml" });
    expect(after.elements.has("shop.mailer")).toBe(true);
    expect(after.elements.has("shop.queue")).toBe(false);
    expect(after.journeys.get("receipt")?.spec.steps).toHaveLength(3);

    const all = applyPlan(sources, model, p, { root: "archdoc.yaml", suggestions: true });
    expect(all.applied.map((a) => a.item)).toContain("c3");
  });

  it("keeps going past a change it can't make", () => {
    const p = plan(`
      changes:
        - { id: c1, intent: Gone, remove: shop.nowhere }
        - { id: c2, intent: Sends mail, add: { id: shop.mailer, kind: container } }
    `);
    const applied = applyPlan(sources, model, p, { root: "archdoc.yaml" });
    expect(applied.problems.map((x) => x.item)).toEqual(["c1"]);
    expect(applied.applied.map((a) => a.item)).toEqual(["c2"]);
  });
});

describe("checkPlan", () => {
  it("asks for intent on every change and step", () => {
    const p = plan(`
      changes:
        - { id: c1, add: { id: shop.mailer, kind: container } }
      sequences:
        - id: s1
          journey: checkout
          steps:
            - { from: shopper, to: shop.web, action: Clicks pay }
    `);
    const c = checkPlan(model, sources, p, { root: "archdoc.yaml" });
    const missing = c.findings.filter((f) => f.code === "plan/missing-intent");
    expect(missing).toHaveLength(2);
    expect(missing.every((f) => f.severity === "warning")).toBe(true);
    expect(c.open.missingIntent).toBe(2);
  });

  it("says why a change can't be made, and what the plan would break", () => {
    const p = plan(`
      changes:
        - { id: c1, intent: Not needed, remove: shop.db }
      sequences:
        - id: s1
          journey: receipt
          actor: shopper
          goal: Get a receipt
          steps:
            - { from: shopper, to: shop.web, action: Pays, intent: Starts it }
    `);
    const c = checkPlan(model, sources, p, { root: "archdoc.yaml" });
    const cannot = c.findings.find((f) => f.code === "plan/cannot-apply");
    expect(cannot?.message).toMatch(/checkout#3/);
    const breaks = c.findings.find((f) => f.code === "plan/would-break");
    expect(breaks?.message).toMatch(/broken-step/);
    expect(breaks?.item).toBe("s1");
  });

  it("names the journeys, actors, and critical journeys it reaches", () => {
    const p = plan(`
      changes:
        - { id: c1, intent: Validates the cart, set: { id: shop.api, description: Places and validates orders } }
    `);
    const c = checkPlan(model, sources, p, { root: "archdoc.yaml" });
    expect(c.reach.journeys.map((j) => [j.id, j.importance])).toEqual([["checkout", "critical"]]);
    expect(c.reach.actors).toEqual(["shopper"]);
    expect(formatPlan(c)).toMatch(/Critical journeys \(checkout\)/);
  });

  it("doesn't count a new element's parent's journeys as reached", () => {
    const p = plan(`
      changes:
        - { id: c1, intent: Renders the receipt, add: { id: shop.api.receipts, kind: component } }
    `);
    const c = checkPlan(model, sources, p, { root: "archdoc.yaml" });
    expect(c.reach.journeys).toEqual([]);
  });

  it("holds a ready plan to errors: open questions and no tasks", () => {
    const p = plan(`
      status: ready
      changes:
        - { id: c1, intent: Sends mail, add: { id: shop.mailer, kind: container } }
      notes:
        - { id: n1, kind: question, by: agent:claude, text: SMTP or a provider? }
    `);
    const c = checkPlan(model, sources, p, { root: "archdoc.yaml" });
    expect(codes(c)).toEqual(expect.arrayContaining(["plan/open-question", "plan/no-tasks"]));
    expect(c.findings.filter((f) => f.code === "plan/open-question")[0]?.severity).toBe("error");
  });

  it("doesn't check a done plan", () => {
    const p = plan(`
      status: done
      changes:
        - { id: c1, remove: shop.nowhere }
    `);
    expect(checkPlan(model, sources, p, { root: "archdoc.yaml" }).findings).toEqual([]);
  });

  it("tells the agent what's still open", () => {
    const p = plan(`
      status: reviewing
      changes:
        - { id: c1, intent: Retries, status: suggested, add: { id: shop.queue, kind: queue } }
    `);
    const c = checkPlan(model, sources, p, { root: "archdoc.yaml" });
    expect(nextStep(c)).toMatch(/1 suggestion waiting/);
  });
});

describe("editPlan", () => {
  const text = dedent(BASE);
  const edit = (t: string, ops: Parameters<typeof editPlan>[2], by = "human:@dana", track = true) =>
    editPlan(FILE, t, ops, { by, track });

  it("numbers new items and records them as unread", () => {
    const r = edit(text, [
      {
        op: "put",
        list: "changes",
        item: { intent: "Sends mail", add: { id: "shop.mailer", kind: "container" } },
      },
      { op: "put", list: "notes", item: { on: "c1", text: "Which provider?" } },
    ]);
    expect(r.problems).toEqual([]);
    expect(r.ids).toEqual(["c1", "n1"]);
    expect(r.plan?.spec.changes[0]?.by).toBe("human:@dana");
    expect(r.plan?.spec.unread).toEqual([
      { id: "c1", what: "added" },
      { id: "n1", what: "added" },
    ]);
  });

  it("changes nothing when one op fails", () => {
    const r = edit(text, [
      { op: "put", list: "changes", item: { intent: "x", add: { id: "shop.a" } } },
      { op: "accept", id: "c9" },
    ]);
    expect(r.text).toBeUndefined();
    expect(r.problems.length).toBeGreaterThan(0);
  });

  it("accepts only suggestions, and forgets an item added then dropped", () => {
    const one = edit(text, [
      { op: "put", list: "changes", item: { intent: "x", add: { id: "shop.a" } } },
    ]);
    expect(edit(one.text ?? "", [{ op: "accept", id: "c1" }]).problems.join()).toMatch(/suggest/);
    const dropped = edit(one.text ?? "", [{ op: "drop", id: "c1" }]);
    expect(dropped.plan?.spec.changes).toEqual([]);
    expect(dropped.plan?.spec.unread ?? []).toEqual([]);
  });

  it("sends a round and clears unread on read", () => {
    const one = edit(text, [
      { op: "put", list: "changes", item: { intent: "x", add: { id: "shop.a" } } },
      { op: "send" },
    ]);
    expect(one.plan?.spec.status).toBe("reviewing");
    expect(one.plan?.spec.sent).toBe(1);
    const read = editPlan(FILE, one.text ?? "", [{ op: "read" }], { by: "agent:claude" });
    expect(read.plan?.spec.unread).toBeUndefined();
  });

  it("adds, replaces, and drops steps", () => {
    const one = edit(text, [
      {
        op: "put",
        list: "sequences",
        item: { journey: "receipt", actor: "shopper", goal: "Get a receipt", steps: [] },
      },
      {
        op: "step",
        sequence: "s1",
        step: { from: "shopper", to: "shop.web", action: "Pays", intent: "Starts it" },
      },
      {
        op: "step",
        sequence: "s1",
        step: { from: "shop.web", to: "shop.api", action: "Orders", intent: "As today" },
      },
      { op: "step", sequence: "s1", at: 2, step: { action: "Places the order" } },
    ]);
    expect(one.problems).toEqual([]);
    expect(one.plan?.spec.sequences[0]?.steps.map((s) => s.action)).toEqual([
      "Pays",
      "Places the order",
    ]);
    const two = edit(one.text ?? "", [{ op: "drop", id: "s1#1" }]);
    expect(two.plan?.spec.sequences[0]?.steps.map((s) => s.action)).toEqual(["Places the order"]);
  });

  it("threads replies on a note", () => {
    const one = editPlan(
      FILE,
      text,
      [{ op: "put", list: "notes", item: { kind: "question", text: "SMTP?" } }],
      { by: "agent:claude" },
    );
    const two = edit(one.text ?? "", [
      { op: "reply", note: "n1", text: "A provider", kind: "answer" },
    ]);
    expect(two.plan?.spec.notes[0]?.replies).toEqual([
      { by: "human:@dana", kind: "answer", text: "A provider" },
    ]);
    expect(two.plan?.spec.unread).toEqual([{ id: "n1", what: "replied" }]);
  });
});
