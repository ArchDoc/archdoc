import { buildModel } from "@archdoc/core/browser";
import { describe, expect, it } from "vitest";
import { journeyInteractions } from "../src/graph/data.js";
import {
  buildGraph,
  defaultExpanded,
  drawnChildIds,
  journeyEdges,
  journeyExpansion,
  onlyGraph,
  shownId,
} from "../src/graph/graph.js";
import { actorLabel } from "../src/model/stories.js";
import { ridesModel } from "./fixtures.js";

const model = ridesModel();
const ids = (xs: { id: string }[]) => xs.map((x) => x.id).sort();

describe("buildGraph", () => {
  it("opens top-level systems by default", () => {
    expect([...defaultExpanded(model)]).toEqual(["platform"]);
  });

  it("hides children of collapsed elements and lifts their relationships", () => {
    const g = buildGraph(model, { expanded: new Set() });
    expect(ids(g.nodes)).toEqual([
      "actor:lurker",
      "actor:ops-team",
      "actor:passenger",
      "element:app",
      "element:console",
      "element:orphan",
      "element:platform",
      "external:payments.charges",
    ]);
    const platform = g.nodes.find((n) => n.id === "element:platform");
    expect(platform).toMatchObject({ isGroup: false, hiddenChildren: 3 });
    // app → api becomes app → platform; api → db disappears inside platform.
    expect(ids(g.edges)).toEqual([
      "actor:ops-team->element:console",
      "actor:passenger->element:app",
      "element:app->element:platform",
      "element:app->external:payments.charges",
      "element:console->element:platform",
    ]);
  });

  it("shows children inside an open group", () => {
    const g = buildGraph(model, { expanded: new Set(["platform"]) });
    expect(g.nodes.find((n) => n.id === "element:platform")).toMatchObject({ isGroup: true });
    expect(g.nodes.find((n) => n.id === "element:platform.api")?.parentId).toBe("element:platform");
    expect(ids(g.edges)).toContain("element:platform.api->element:platform.db");
  });

  it("merges relationships that lift onto the same edge, and tracks planned ones", () => {
    const g = buildGraph(model, { expanded: new Set() });
    const consoleEdge = g.edges.find((e) => e.id === "element:console->element:platform");
    expect(consoleEdge?.planned).toBe(true);
    expect(g.edges.find((e) => e.id === "element:app->element:platform")?.planned).toBe(false);
  });

  it("focus keeps the neighborhood, what an actor owns, and enclosing groups", () => {
    const g = buildGraph(model, { expanded: new Set(["platform"]), focus: "actor:ops-team" });
    expect(ids(g.nodes)).toEqual([
      "actor:ops-team",
      "element:console",
      "element:platform",
      "element:platform.api",
      "element:platform.cache",
      "element:platform.db",
    ]);
  });

  it("focus on an unknown key shows everything", () => {
    const all = buildGraph(model, { expanded: new Set() });
    expect(buildGraph(model, { expanded: new Set(), focus: "element:nope" }).nodes).toHaveLength(
      all.nodes.length,
    );
  });
});

describe("journeys", () => {
  const journey = model.journeys.get("book");
  if (!journey) throw new Error("fixture");

  it("expands what a journey needs", () => {
    expect(journeyExpansion(model, journey)).toEqual(["platform"]);
  });

  it("maps steps onto visible nodes", () => {
    const closed = journeyEdges(
      model,
      { expanded: new Set() },
      journey.id,
      journeyInteractions(model, journey),
    );
    expect(closed.map((s) => `${s.step}:${s.source}->${s.target}`)).toEqual([
      "0:actor:passenger->element:app",
      "1:element:app->element:platform",
      "2:element:platform->element:platform",
    ]);
    const open = journeyEdges(
      model,
      { expanded: new Set(["platform"]) },
      journey.id,
      journeyInteractions(model, journey),
    );
    expect(open[2]).toMatchObject({
      source: "element:platform.api",
      target: "element:platform.db",
    });
  });
});

describe("code elements", () => {
  const coded = buildModel([
    {
      path: "archdoc.yaml",
      text: `
archdoc: "2.0"
namespace: shop
actors:
  dashboard-user: { kind: person, uses: { api.orders: Places orders } }
elements:
  api:
    kind: container
    elements:
      orders:
        kind: component
        uses: { db: Saves orders }
        elements:
          place: { kind: code, description: Places an order., code: "api/orders.ts#placeOrder" }
          price: { kind: code, description: Prices the cart., code: "api/price.ts#price" }
      users:
        kind: component
  db: { kind: datastore, uses: {} }
journeys:
  buy:
    actor: dashboard-user
    goal: Buy
    steps:
      - { from: dashboard-user, to: api.orders.place }
      - { from: api.orders.place, to: db }
`,
    },
  ]);

  it("aren't drawn: their component is a closed box with nothing to open", () => {
    const g = buildGraph(coded, { expanded: new Set(["api", "api.orders"]) });
    expect(ids(g.nodes).filter((id) => id.startsWith("element:"))).toEqual([
      "element:api",
      "element:api.orders",
      "element:api.users",
      "element:db",
    ]);
    expect(g.nodes.find((n) => n.id === "element:api.orders")).toMatchObject({
      isGroup: false,
      hiddenChildren: 0,
    });
    expect(g.nodes.find((n) => n.id === "element:api")).toMatchObject({ isGroup: true });
    expect(drawnChildIds(coded, "api.orders")).toEqual([]);
    expect(drawnChildIds(coded, "api")).toEqual(["api.orders", "api.users"]);
  });

  it("stand for their component on the map, and a journey through them opens only up to it", () => {
    const journey = coded.journeys.get("buy");
    if (!journey) throw new Error("fixture");
    expect(shownId(coded, "api.orders.place")).toBe("api.orders");
    expect(journeyExpansion(coded, journey)).toEqual(["api"]);
    const steps = journeyEdges(
      coded,
      { expanded: new Set(["api"]) },
      journey.id,
      journeyInteractions(coded, journey),
    );
    expect(steps.map((s) => `${s.source}->${s.target}`)).toEqual([
      "actor:dashboard-user->element:api.orders",
      "element:api.orders->element:db",
    ]);
  });

  it("names actors in plain words when they have no name:", () => {
    expect(actorLabel(coded, "dashboard-user")).toBe("Dashboard User");
  });
});

describe("onlyGraph", () => {
  const all = (expanded: string[]) => buildGraph(model, { expanded: new Set(expanded) });

  it("keeps what a plan touches, what it connects to, and the boxes they sit in", () => {
    const g = onlyGraph(all(["platform"]), {
      keep: new Set(["element:platform.api"]),
      around: new Set(["element:platform.api"]),
    });
    expect(ids(g.nodes)).toEqual([
      "element:app",
      "element:console",
      "element:platform",
      "element:platform.api",
      "element:platform.cache",
      "element:platform.db",
    ]);
    expect(g.edges.every((e) => ids(g.nodes).includes(e.source))).toBe(true);
  });

  it("shows a scope without its neighbors, and everything when nothing it names is drawn", () => {
    const g = all(["platform"]);
    const scoped = onlyGraph(g, {
      keep: new Set(["element:platform.db"]),
      around: new Set(),
    });
    expect(ids(scoped.nodes)).toEqual(["element:platform", "element:platform.db"]);
    expect(onlyGraph(g, { keep: new Set(["element:nope"]), around: new Set() })).toBe(g);
  });

  it("is applied by buildGraph", () => {
    const only = { keep: new Set(["actor:ops-team"]), around: new Set(["actor:ops-team"]) };
    expect(ids(buildGraph(model, { expanded: new Set(), only }).nodes)).toEqual([
      "actor:ops-team",
      "element:console",
    ]);
  });
});
