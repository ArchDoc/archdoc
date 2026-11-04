import { describe, expect, it } from "vitest";
import { toneOf } from "../src/components/Legend.js";
import { buildGraph, defaultExpanded, type GraphEdge } from "../src/graph/graph.js";
import {
  edgeLabels,
  edgeText,
  LABEL_LINES,
  LABEL_WIDTH,
  labelFor,
  wrap,
} from "../src/graph/labels.js";
import { type Box, layoutGraph, type Point } from "../src/graph/layout.js";
import { ridesModel } from "./fixtures.js";

const edge = (over: Partial<GraphEdge>): GraphEdge => ({
  id: "a->b",
  source: "a",
  target: "b",
  relationships: [],
  planned: false,
  ...over,
});
const rel = (description?: string) =>
  ({ description }) as unknown as GraphEdge["relationships"][number];

describe("edgeText", () => {
  it("says what a use is for, and a subscription's channel", () => {
    expect(edgeText(edge({ relationships: [rel("Charges the card")] }))).toBe("Charges the card");
    expect(
      edgeText(
        edge({
          relationships: [rel("Hears about orders")],
          subscription: { channel: "orders.placed", transport: "kafka" },
        }),
      ),
    ).toBe("orders.placed (kafka) · Hears about orders");
  });

  it("names one of many uses lifted to a closed box, and how many more", () => {
    const text = edgeText(edge({ relationships: [rel("a"), rel("b"), rel("c"), rel("a")] }));
    expect(text).toBe("a (+2 more)");
  });

  it("says nothing for foreign keys, lines between rows, or uses without a description", () => {
    expect(edgeText(edge({ reference: { field: "x", to: "y" } }))).toBe("");
    expect(edgeText(edge({ rows: { from: 0, to: 1 } }))).toBe("");
    expect(edgeText(edge({ relationships: [rel()] }))).toBe("");
  });
});

describe("wrap and labelFor", () => {
  it("wraps by words, cuts long words, and ends a cut-short text with an ellipsis", () => {
    expect(wrap("one two three", 7)).toEqual(["one two", "three"]);
    expect(wrap("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
    const lines = wrap("a ".repeat(100), 9);
    expect(lines).toHaveLength(LABEL_LINES);
    expect(lines.at(-1)?.endsWith("…")).toBe(true);
  });

  it("sizes a label to its text, no wider than the limit", () => {
    const short = labelFor("Saves orders");
    const long = labelFor("Reads the model and briefs the task with everything an agent needs");
    expect(short?.lines).toEqual(["Saves orders"]);
    expect(short?.width).toBeLessThan(long?.width ?? 0);
    expect(long?.width).toBeLessThanOrEqual(LABEL_WIDTH);
    expect(long?.height).toBeGreaterThan(short?.height ?? 0);
    expect(labelFor("")).toBeUndefined();
  });

  it("starts each part, such as a journey step, on a line of its own", () => {
    const label = labelFor(["3. Saves the order", "5. Marks it paid"]);
    expect(label?.lines).toEqual(["3. Saves the order", "5. Marks it paid"]);
    expect(label?.text).toBe("3. Saves the order\n5. Marks it paid");
  });
});

describe("layoutGraph with labels", () => {
  it("places every description centered on its own line", async () => {
    const model = ridesModel();
    const graph = buildGraph(model, { expanded: defaultExpanded(model) });
    const labels = edgeLabels(graph);
    expect(labels.size).toBeGreaterThan(0);
    const { labels: placed, routes } = await layoutGraph(graph, {}, 4, labels);
    expect(placed.size).toBe(labels.size);
    for (const [id, box] of placed) {
      for (const v of [box.x, box.y]) expect(Number.isFinite(v)).toBe(true);
      const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      expect(distance({ ...center, width: 0, height: 0 }, routes.get(id) ?? []), id).toBeLessThan(
        2,
      );
    }
  });
});

describe("toneOf", () => {
  it("colors people, agents, and each kind of element, and not a team's frame", () => {
    expect(toneOf({ family: "actor", kind: "person" })?.id).toBe("actor");
    expect(toneOf({ family: "actor", kind: "agent" })?.id).toBe("agent");
    expect(toneOf({ family: "element", kind: "container" })?.id).toBe("container");
    expect(toneOf({ family: "element", kind: "repo" })?.id).toBe("system");
    expect(toneOf({ family: "external", kind: "datastore" })?.id).toBe("datastore");
    expect(toneOf({ family: "group", kind: "team" })).toBeUndefined();
  });
});

/** How far a box is from the nearest stretch of a line. */
function distance(b: Box, points: Point[]): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as Point;
    const c = points[i] as Point;
    const dx = Math.max(0, b.x - Math.max(a.x, c.x), Math.min(a.x, c.x) - (b.x + b.width));
    const dy = Math.max(0, b.y - Math.max(a.y, c.y), Math.min(a.y, c.y) - (b.y + b.height));
    best = Math.min(best, Math.hypot(dx, dy));
  }
  return best;
}
