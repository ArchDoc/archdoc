import { describe, expect, it } from "vitest";
import {
  CODE_DIFF_BY,
  type CodeSide,
  deriveCodeChange,
  type ObservedDependency,
  projectCodeChange,
} from "../src/index.js";
import { model, root } from "./helpers.js";

const shop = model({
  "archdoc.yaml": root(`
    actors:
      buyer: { kind: person, uses: { shop.web: Shops } }
    elements:
      shop:
        kind: system
        elements:
          web: { kind: container, code: apps/web/**, uses: { shop.api: Calls, shop.legacy: Reads } }
          api:
            kind: container
            code: services/api/**
            elements:
              orders: { kind: component, code: services/api/src/orders.ts }
          legacy: { kind: container, code: services/legacy/** }
          billing: { kind: container, code: services/billing/** }
    journeys:
      checkout:
        actor: buyer
        goal: Buy something
        steps: [{ from: buyer, to: shop.web }, { from: shop.web, to: shop.api.orders }]
  `),
});

const dep = (from: string, to: string, extra: Partial<ObservedDependency> = {}) => ({
  from,
  to,
  analyzer: "ts-imports",
  ...extra,
});

const base: CodeSide = {
  files: [
    "apps/web/src/app.ts",
    "services/api/src/orders.ts",
    "services/api/src/index.ts",
    "services/legacy/src/index.ts",
    "services/billing/src/index.ts",
  ],
  observed: [
    dep("apps/web/src/app.ts", "services/api"),
    dep("apps/web/src/app.ts", "services/legacy"),
  ],
  entries: [],
};

const head: CodeSide = {
  files: [
    "apps/web/src/app.ts",
    "apps/web/src/pay.ts",
    "services/api/src/orders.ts",
    "services/api/src/index.ts",
    "services/billing/src/index.ts",
    "services/api/src/refunds/index.ts",
    "services/api/src/refunds/policy.ts",
    "services/search/src/index.ts",
  ],
  observed: [
    dep("apps/web/src/app.ts", "services/api"),
    dep("apps/web/src/pay.ts", "services/billing", { line: 1, specifier: "@shop/billing" }),
    dep("services/search/src/index.ts", "services/api"),
  ],
  entries: [{ kind: "route", label: "POST /pay", file: "apps/web/src/pay.ts" }],
};

const changed = [
  "apps/web/src/pay.ts",
  "services/api/src/orders.ts",
  "services/api/src/refunds/index.ts",
  "services/api/src/refunds/policy.ts",
  "services/legacy/src/index.ts",
  "services/search/src/index.ts",
  "README.md",
];

describe("deriveCodeChange", () => {
  const change = deriveCodeChange({ model: shop, base, head, changed });

  it("says what each changed file did, and which element owns it", () => {
    expect(change.files).toEqual([
      { path: "apps/web/src/pay.ts", status: "added", element: "shop.web", proposed: undefined },
      {
        path: "services/api/src/orders.ts",
        status: "modified",
        element: "shop.api.orders",
        proposed: undefined,
      },
      {
        path: "services/api/src/refunds/index.ts",
        status: "added",
        element: "shop.api",
        proposed: undefined,
      },
      {
        path: "services/api/src/refunds/policy.ts",
        status: "added",
        element: "shop.api",
        proposed: undefined,
      },
      {
        path: "services/legacy/src/index.ts",
        status: "deleted",
        element: "shop.legacy",
        proposed: undefined,
      },
      {
        path: "services/search/src/index.ts",
        status: "added",
        element: undefined,
        proposed: "shop.search",
      },
    ]);
  });

  it("proposes new code no element maps as the element it would be, beside its neighbours", () => {
    expect(change.proposed).toEqual([
      {
        id: "shop.search",
        key: "search",
        parent: "shop",
        kind: "container",
        code: "services/search/**",
        files: ["services/search/src/index.ts"],
      },
    ]);
  });

  it("reads elements as added, changed, or removed by their code", () => {
    expect(change.elements.map((e) => `${e.kind} ${e.id} ${e.modeled}`)).toEqual([
      "changed shop.api true",
      "changed shop.api.orders true",
      "removed shop.legacy true",
      "added shop.search false",
      "changed shop.web true",
    ]);
  });

  it("finds the uses the code added and dropped, and whether the model says so", () => {
    expect(change.uses).toEqual([
      {
        from: "shop.search",
        to: "shop.api",
        kind: "added",
        modeled: false,
        typeOnly: false,
        evidence: ["services/search/src/index.ts"],
      },
      {
        from: "shop.web",
        to: "shop.billing",
        kind: "added",
        modeled: false,
        typeOnly: false,
        evidence: ["apps/web/src/pay.ts:1 (@shop/billing)"],
      },
      {
        from: "shop.web",
        to: "shop.legacy",
        kind: "removed",
        modeled: true,
        typeOnly: false,
        evidence: [],
      },
    ]);
  });

  it("lists new entry points with the journeys through their element", () => {
    expect(change.entries).toEqual([
      {
        kind: "added",
        entry: { kind: "route", label: "POST /pay", file: "apps/web/src/pay.ts" },
        element: "shop.web",
        journeys: ["checkout"],
      },
    ]);
  });

  it("projects the change onto the model, marking what it proposes", () => {
    const { model: after, diff } = projectCodeChange(shop, change);
    // The model given is left as it was.
    expect(shop.elements.has("shop.search")).toBe(false);
    expect(after.elements.get("shop.search")?.spec).toMatchObject({
      kind: "container",
      provenance: { source: "inferred", by: CODE_DIFF_BY },
    });
    expect(after.elements.get("shop")?.childIds).toContain("shop.search");
    expect(after.elements.has("shop.legacy")).toBe(false);
    expect(diff.elements.map((c) => `${c.kind} ${c.id}`)).toEqual([
      "changed shop.api",
      "changed shop.api.orders",
      "removed shop.legacy",
      "added shop.search",
      "changed shop.web",
    ]);
    expect(diff.relationships.map((c) => `${c.kind} ${c.id}`)).toEqual([
      "added element:shop.search->element:shop.api",
      "added element:shop.web->element:shop.billing",
      "removed element:shop.web->element:shop.legacy",
    ]);
    const web = after.relationships.filter(
      (r) => r.from.type === "element" && r.from.id === "shop.web",
    );
    expect(web.map((r) => (r.to.type === "element" ? r.to.id : ""))).toEqual([
      "shop.api",
      "shop.billing",
    ]);
  });

  it("shows a use the model already has as added when the code adds it", () => {
    const declared = model({
      "archdoc.yaml": root(`
        elements:
          web: { kind: container, code: apps/web/**, uses: { billing: Pays } }
          billing: { kind: container, code: services/billing/** }
      `),
    });
    const c = deriveCodeChange({
      model: declared,
      base: { files: ["apps/web/a.ts", "services/billing/b.ts"], observed: [] },
      head: {
        files: ["apps/web/a.ts", "services/billing/b.ts"],
        observed: [dep("apps/web/a.ts", "services/billing")],
      },
      changed: ["apps/web/a.ts"],
    });
    expect(c.uses).toMatchObject([{ from: "web", to: "billing", kind: "added", modeled: true }]);
    const { model: after, diff } = projectCodeChange(declared, c);
    expect(after.relationships).toHaveLength(1);
    expect(diff.relationships.map((r) => `${r.kind} ${r.id}`)).toEqual([
      "added element:web->element:billing",
    ]);
  });

  it("proposes a new file in a directory that was already there on its own", () => {
    const c = deriveCodeChange({
      model: shop,
      base: { files: [...base.files, "tools/a.ts"], observed: [] },
      head: { files: [...base.files, "tools/a.ts", "tools/sync.ts"], observed: [] },
      changed: ["tools/sync.ts"],
    });
    expect(c.proposed).toMatchObject([{ id: "shop.sync", code: "tools/sync.ts" }]);
  });
});
