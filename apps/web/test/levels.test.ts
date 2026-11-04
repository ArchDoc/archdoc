import { buildModel } from "@archdoc/core/browser";
import { describe, expect, it } from "vitest";
import { buildGraph, levelExpansion, levelOf, systemBox } from "../src/graph/graph.js";
import { landscapeModel } from "./fixtures.js";

describe("C4 levels", () => {
  const model = landscapeModel();

  it("shows each system as one box in its context, with its actors and neighbors", () => {
    expect(levelExpansion(model, "context")).toEqual(new Set());
    const graph = buildGraph(model, { expanded: levelExpansion(model, "context") });
    const ids = graph.nodes.map((n) => n.id);
    expect(ids).toContain("element:payments");
    expect(ids).toContain("element:rides");
    expect(ids).toContain("actor:rider");
    expect(ids).not.toContain("element:rides.app");
    // The systems talk to each other as boxes of their own.
    expect(
      graph.edges.some((e) => e.source === "element:rides" && e.target === "element:payments"),
    ).toBe(true);
  });

  it("opens the systems for their containers", () => {
    expect(levelExpansion(model, "containers")).toEqual(new Set(["payments", "rides"]));
  });

  it("names the level the open boxes show, and none when they show a mix", () => {
    expect(levelOf(model, new Set())).toBe("context");
    expect(levelOf(model, new Set(["payments", "rides"]))).toBe("containers");
    expect(levelOf(model, new Set(["payments"]))).toBeUndefined();
    expect(systemBox(model)).toBeUndefined();
  });
});

describe("the context of a model without a system", () => {
  const model = buildModel([
    {
      path: "archdoc.yaml",
      text: `
archdoc: "2.0"
namespace: shop
name: Shop
actors:
  buyer: { kind: person, uses: { web: Shops } }
elements:
  web: { kind: container, uses: { api: Calls } }
  api: { kind: container, uses: { db: Writes, stripe: Charges } }
  db: { kind: datastore }
  stripe: { kind: external }
`,
    },
  ]);

  it("draws its own parts as one box, with who uses it and what it talks to", () => {
    const box = systemBox(model);
    expect(box?.key).toBe("system:shop");
    expect(box?.label).toBe("Shop");
    expect([...(box?.members ?? [])].sort()).toEqual(["api", "db", "web"]);
    const graph = buildGraph(model, { expanded: new Set(), system: box });
    expect(graph.nodes.map((n) => n.id).sort()).toEqual([
      "actor:buyer",
      "element:stripe",
      "system:shop",
    ]);
    const edges = graph.edges.map((e) => `${e.source}->${e.target}`).sort();
    expect(edges).toEqual(["actor:buyer->system:shop", "system:shop->element:stripe"]);
  });

  it("tells the context from the containers, which open nothing", () => {
    expect(levelExpansion(model, "containers")).toEqual(new Set());
    expect(levelOf(model, new Set())).toBe("containers");
    expect(levelOf(model, new Set(), true)).toBe("context");
  });
});
