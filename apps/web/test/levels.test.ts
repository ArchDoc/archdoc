import { describe, expect, it } from "vitest";
import { buildGraph, levelExpansion, levelOf } from "../src/graph/graph.js";
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

  it("opens the systems for their containers, and the containers for their components", () => {
    expect(levelExpansion(model, "containers")).toEqual(new Set(["payments", "rides"]));
    expect(levelExpansion(model, "components")).toEqual(
      new Set(["payments", "rides", "payments.charges"]),
    );
  });

  it("names the level the open boxes show, and none when they show a mix", () => {
    expect(levelOf(model, new Set())).toBe("context");
    expect(levelOf(model, new Set(["payments", "rides"]))).toBe("containers");
    expect(levelOf(model, new Set(["payments"]))).toBeUndefined();
  });
});
