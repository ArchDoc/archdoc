import { readFileSync } from "node:fs";
import { buildModel } from "@archdoc/core/browser";
import { describe, expect, it } from "vitest";
import { buildInfraGraph } from "../src/graph/infra.js";
import { layoutGraph } from "../src/graph/layout.js";
import { hashOf, readHash } from "../src/model/useCompare.js";

const model = buildModel([
  {
    path: "deployment.yaml",
    text: readFileSync(new URL("../../../examples/deployment.yaml", import.meta.url), "utf8"),
  },
]);

describe("the infrastructure view", () => {
  it("nests nodes in their environment, and deployed elements in their nodes", () => {
    const infra = buildInfraGraph(model, "production");
    const parent = Object.fromEntries(
      (infra?.graph.nodes ?? []).map((n) => [n.id, n.parentId ?? null]),
    );
    expect(parent).toMatchObject({
      "env:production": null,
      "deploy:production.aws": "env:production",
      "deploy:production.aws.eks.web": "deploy:production.aws.eks",
      "element:shop.api": "deploy:production.aws.eks.web",
      "deploy:production.aws.sqs": "deploy:production.aws",
      "element:shop.storefront": "deploy:production.cdn",
      // Outside the environment: who uses it, and what it calls that runs elsewhere.
      "actor:shopper": null,
      "element:payments": null,
      "element:email": null,
      "element:shop.admin": null,
    });
    const groups = infra?.graph.nodes.filter((n) => n.isGroup).map((n) => n.id);
    expect(groups).toContain("deploy:production.aws.eks");
    const edges = infra?.graph.edges.map((e) => e.id);
    expect(edges).toContain("element:shop.api->element:shop.db");
    // A subscription points the way the messages go: from the publisher.
    expect(edges).toContain("element:shop.api->element:shop.worker");
  });

  it("lays out without errors", async () => {
    const infra = buildInfraGraph(model, "staging");
    if (!infra) throw new Error("no staging");
    const layout = await layoutGraph(infra.graph);
    for (const n of infra.graph.nodes) expect(layout.boxes.has(n.id)).toBe(true);
  });

  it("has an address", () => {
    expect(readHash("#infrastructure=staging")).toEqual({
      tab: "infrastructure",
      environment: "staging",
    });
    expect(hashOf({ tab: "infrastructure", environment: "local" })).toBe("#infrastructure=local");
  });
});
