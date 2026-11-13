import { buildModel, loadPlans, type ModelSource, type Plan } from "@archdoc/core/browser";
import { describe, expect, it } from "vitest";
import {
  changeLine,
  newElementId,
  newElementPlace,
  openQuestion,
  planMap,
  planTurn,
  turnsOf,
} from "../src/model/plans.js";

const sources: ModelSource[] = [
  {
    path: "archdoc.yaml",
    text: `
archdoc: "2.0"
namespace: shop
actors:
  shopper: { kind: person, name: Shopper, uses: { shop.web: Shops } }
elements:
  shop:
    kind: system
    elements:
      web: { kind: container, name: Storefront, uses: { shop.api: Calls } }
      api:
        kind: container
        elements:
          orders: { kind: component, name: Orders }
`,
  },
];
const model = buildModel(sources);
expect(model.diagnostics.filter((d) => d.severity === "error")).toEqual([]);

function plan(text: string): Plan {
  const { plans, diagnostics } = loadPlans([{ path: ".archdoc/plans/p.yaml", text }]);
  expect(diagnostics).toEqual([]);
  const p = plans[0];
  if (!p) throw new Error("no plan");
  return p;
}

const drawn = `
plan: p
title: Email a confirmation
status: reviewing
sent: 1
intents:
  - { id: i1, on: shop.mailer, at: { x: 90, y: 80 }, by: "human:@dana", text: Sends the shopper's emails }
changes:
  - { id: c1, add: { id: shop.mailer, kind: container, name: Mailer }, intent: Sends the shopper's emails, by: "human:@dana" }
`;

describe("planTurn", () => {
  const spec = (s: Partial<Plan["spec"]>) => ({ ...plan("plan: p\ntitle: T\n").spec, ...s });
  it("is the agent's while a round is unanswered, and says whether it read it", () => {
    expect(planTurn(spec({ status: "reviewing", sent: 2, seen: 1, answered: 1 }))).toBe("sent");
    expect(planTurn(spec({ status: "reviewing", sent: 2, seen: 2, answered: 1 }))).toBe("agent");
  });
  it("is the person's once answered, unsent when they've changed things", () => {
    expect(planTurn(spec({ status: "reviewing", sent: 2, seen: 2, answered: 2 }))).toBe("you");
    expect(
      planTurn(spec({ status: "drafting", sent: 0, unread: [{ id: "i1", what: "added" }] })),
    ).toBe("unsent");
  });
  it("is nobody's once the plan is ready", () => {
    expect(planTurn(spec({ status: "ready", sent: 3, answered: 1 }))).toBe("none");
  });
});

describe("new elements", () => {
  it("go inside a system or container, beside anything smaller", () => {
    expect(newElementPlace(model, undefined)).toEqual({ parent: "shop", kind: "container" });
    expect(newElementPlace(model, "element:shop.api")).toEqual({
      parent: "shop.api",
      kind: "component",
    });
    expect(newElementPlace(model, "element:shop.api.orders")).toEqual({
      parent: "shop.api",
      kind: "component",
    });
  });
  it("get an ID from their name, unique beside their siblings", () => {
    expect(newElementId(model, "shop", "Mail Sender!")).toBe("shop.mail-sender");
    expect(newElementId(model, "shop", "Web")).toBe("shop.web-2");
    expect(newElementId(model, undefined, "  ")).toBe("new-element");
  });
});

describe("a box the person drew", () => {
  const map = planMap(model, { root: ".", sources }, plan(drawn), buildModel);

  it("shows on the map with its intent pinned in it, open until the agent answers", () => {
    expect(map.after.elements.get("shop.mailer")?.spec.name).toBe("Mailer");
    expect(map.suggested.has("element:shop.mailer")).toBe(false);
    expect(map.pins).toMatchObject([
      { id: "i1", node: "element:shop.mailer", at: { x: 90, y: 80 }, open: true, carried: [] },
    ]);
    const { turns } = turnsOf(map);
    expect(turns).toMatchObject([{ intent: { id: "i1" }, drew: { id: "c1" }, settled: false }]);
    expect(changeLine(map, map.plan.spec.changes[0] as Plan["spec"]["changes"][number])).toBe(
      "New container: Mailer",
    );
  });

  it("settles once the agent carries it out, and waits again on its question", () => {
    const answered = plan(`${drawn}
  - { id: c2, use: { from: shop.api.orders, to: shop.mailer }, for: [i1], by: "agent:claude-code", status: suggested }
answered: 1
seen: 1
`);
    const after = planMap(model, { root: ".", sources }, answered, buildModel);
    expect(after.pins[0]).toMatchObject({ open: false, carried: ["c2"] });
    expect(after.suggestedEdges.has("element:shop.api.orders|element:shop.mailer")).toBe(true);
    // A suggestion waits on the person until they accept it.
    expect(turnsOf(after).turns[0]).toMatchObject({ settled: false, items: [{ id: "c2" }] });
    expect(changeLine(after, answered.spec.changes[1] as Plan["spec"]["changes"][number])).toBe(
      "Orders → Mailer",
    );

    const accepted = plan(`${drawn}
  - { id: c2, use: { from: shop.api.orders, to: shop.mailer }, for: [i1], by: "agent:claude-code" }
notes:
  - { id: n1, on: i1, kind: question, by: "agent:claude-code", text: Send it now or queue it?, options: [Now, Queue] }
  - { id: n2, kind: insight, by: "agent:claude-code", text: Orders already has the email }
answered: 1
`);
    const asked = planMap(model, { root: ".", sources }, accepted, buildModel);
    const { turns, rest } = turnsOf(asked);
    expect(turns[0]).toMatchObject({ settled: false, notes: [{ id: "n1" }] });
    expect(rest.map((n) => n.id)).toEqual(["n2"]);
    expect(openQuestion(asked)?.id).toBe("n1");
  });

  it("closes the question once the person answers it", () => {
    const replied = plan(`${drawn}
  - { id: c2, use: { from: shop.api.orders, to: shop.mailer }, for: [i1], by: "agent:claude-code" }
notes:
  - { id: n1, on: i1, kind: question, by: "agent:claude-code", text: Now or queued?, options: [Now, Queue], replies: [{ kind: answer, by: "human:@dana", text: Queue }] }
answered: 1
`);
    const map2 = planMap(model, { root: ".", sources }, replied, buildModel);
    expect(openQuestion(map2)).toBeUndefined();
    expect(turnsOf(map2).turns[0]?.settled).toBe(true);
  });
});
