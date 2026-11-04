import { describe, expect, it } from "vitest";
import {
  check,
  deploymentsOf,
  deploymentView,
  fingerprints,
  formatElement,
  formatEnvironment,
  sealableFacts,
} from "../src/index.js";
import { codes, model } from "./helpers.js";

/** The root file's first lines, indented to match the YAML after them. */
const root = (indent: number) =>
  ['archdoc: "2.0"', "namespace: shop"].map((l) => `${" ".repeat(indent)}${l}`).join("\n");

const shop = () =>
  model({
    "archdoc.yaml": `
${root(6)}
      actors:
        shopper: { kind: person, uses: { web: Browses } }
      elements:
        web:
          kind: container
          deploy: { to: production.aws.eks, replicas: 3, url: "https://shop.example.com", code: deploy/web/values.yaml }
          uses: { api: { description: Calls, technology: HTTPS } }
        api:
          kind: container
          deploy: [production.aws.eks, local]
          elements:
            orders:
              kind: component
              uses: { db: Saves orders, payments: Charges }
        db:
          kind: datastore
          deploy: production.aws.rds
        payments: { kind: external }
      environments:
        production:
          name: Production
          nodes:
            aws:
              kind: region
              code: infra/terraform/
              nodes:
                eks: { kind: cluster, technology: EKS, code: infra/terraform/eks.tf }
                rds: { kind: managed }
        local: {}
    `,
  });

describe("deployments", () => {
  it("reads environments as a tree of nodes, and each element's deploy", () => {
    const m = shop();
    expect(codes(m)).toEqual([]);
    expect([...m.environments.keys()]).toEqual(["production", "local"]);
    expect(m.environments.get("production")?.nodeIds).toEqual(["production.aws"]);
    expect([...m.deploymentNodes.keys()]).toEqual([
      "production.aws",
      "production.aws.eks",
      "production.aws.rds",
    ]);
    expect(m.deploymentNodes.get("production.aws.eks")).toMatchObject({
      key: "eks",
      environment: "production",
      parentId: "production.aws",
      depth: 1,
    });
    expect(m.deployments.map((d) => [d.element, d.environment, d.node ?? null])).toEqual([
      ["web", "production", "production.aws.eks"],
      ["api", "production", "production.aws.eks"],
      ["api", "local", null],
      ["db", "production", "production.aws.rds"],
    ]);
    expect(m.deployments[0]).toMatchObject({ replicas: 3, url: "https://shop.example.com" });
  });

  it("says where a part runs: where its container does", () => {
    const m = shop();
    expect(deploymentsOf(m, "api.orders")?.from).toBe("api");
    expect(deploymentsOf(m, "payments")).toBeUndefined();
    expect(formatElement(m, "api.orders")).toContain(
      "Deployed (with api):\n  api on production.aws.eks\n  api on local",
    );
  });

  it("fails on a target that isn't an environment or a node in one", () => {
    const m = model({
      "archdoc.yaml": `
${root(8)}
        elements:
          api: { kind: container, deploy: production.aws.ek }
          ui: { kind: container, deploy: prod }
        environments:
          production:
            nodes: { aws: { nodes: { eks: {} } } }
      `,
    });
    const found = m.diagnostics.filter((d) => d.code === "deploy/unknown-target");
    expect(found.map((d) => d.severity)).toEqual(["error", "error"]);
    expect(found[0]?.message).toContain("Nodes in production: production.aws, production.aws.eks");
    expect(found[1]?.message).toContain("Environments: production");
    expect(found[0]?.location?.line).toBe(4);
  });

  it("warns on a deploy that belongs to a container, and on a container that says nothing", () => {
    const m = model({
      "archdoc.yaml": `
${root(8)}
        elements:
          api:
            kind: container
            elements:
              handler: { kind: component, deploy: production }
          worker: { kind: container }
          later: { kind: container, status: planned }
        environments:
          production: {}
      `,
    });
    expect(codes(m, "warning")).toEqual([
      "deploy/not-deployable",
      "deploy/not-deployed",
      "deploy/not-deployed",
    ]);
    expect(
      m.diagnostics.filter((d) => d.code === "deploy/not-deployed").map((d) => d.message),
    ).toEqual([
      expect.stringContaining("Container api"),
      expect.stringContaining("Container worker"),
    ]);
  });

  it("says nothing about deploy in a model without environments", () => {
    const m = model({ "archdoc.yaml": `${root(0)}\nelements: { api: { kind: container } }` });
    expect(codes(m)).toEqual([]);
  });

  it("shows an environment: its nodes, what runs on them, and the uses between them", () => {
    const m = shop();
    const v = deploymentView(m, "production");
    expect(v?.placed.map((p) => [p.element.id, p.node])).toEqual([
      ["web", "production.aws.eks"],
      ["api", "production.aws.eks"],
      ["db", "production.aws.rds"],
    ]);
    // A part's uses are its container's; what's not deployed here sits outside.
    expect(v?.links.map((l) => `${l.from}->${l.to}`)).toEqual([
      "actor:shopper->element:web",
      "element:web->element:api",
      "element:api->element:db",
      "element:api->element:payments",
    ]);
    expect(v?.outside).toEqual(["actor:shopper", "element:payments"]);
    expect(v?.missing).toEqual([]);
    expect(deploymentView(m, "local")?.missing.map((e) => e.id)).toEqual(["web"]);
    expect(deploymentView(m, "nowhere")).toBeUndefined();
  });

  it("prints an environment or a node with what runs there", () => {
    const m = shop();
    expect(formatEnvironment(m, "production.aws")).toBe(
      [
        "production.aws (region)",
        "Code: infra/terraform/",
        "Contains: eks (cluster), rds (managed)",
        "Runs:",
        "  web on production.aws.eks (3 replicas, https://shop.example.com, deploy/web/values.yaml)",
        "  api on production.aws.eks",
        "  db on production.aws.rds",
      ].join("\n"),
    );
    expect(formatEnvironment(m, "production")).toContain("production (environment) · Production");
    expect(formatEnvironment(m, "api")).toBeUndefined();
  });

  it("checks the infrastructure code and seals it", () => {
    const m = shop();
    const files = ["infra/terraform/eks.tf", "infra/terraform/main.tf"];
    const stale = check(m, { files }).findings.filter((f) => f.code === "drift/stale-path");
    expect(stale.map((f) => f.message)).toEqual([
      'web\'s deployment to production.aws.eks maps "deploy/web/values.yaml", which matches no file. Update its code paths.',
    ]);

    const facts = sealableFacts(m).filter((f) => f.key.startsWith("deploy:"));
    expect(facts.map((f) => [f.key, f.kind, f.element ?? null])).toEqual([
      ["deploy:production.aws", "structure", null],
      ["deploy:production.aws.eks", "content", null],
      ["deploy:web@production.aws.eks", "content", "web"],
    ]);
    const texts: Record<string, string> = { "infra/terraform/eks.tf": "cluster {}" };
    const print = (t: Record<string, string>) =>
      fingerprints(m, { files, read: (p) => t[p] }).find(
        (f) => f.fact.key === "deploy:production.aws.eks",
      )?.seal.hash;
    expect(print(texts)).not.toBe(print({ "infra/terraform/eks.tf": "cluster { size = 3 }" }));
  });
});
