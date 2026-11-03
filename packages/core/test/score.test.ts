import { describe, expect, it } from "vitest";
import { formatScore, scoreModel } from "../src/index.js";
import { model } from "./helpers.js";

const files = [
  "apps/web/src/main.ts",
  "apps/web/src/page.ts",
  "apps/api/src/routes/orders.ts",
  "apps/api/src/orders/service.ts",
  "apps/api/src/orders/totals.ts",
  "apps/api/src/storage/db.ts",
];

const golden = model({
  "archdoc.yaml": `
    archdoc: "2.0"
    namespace: shop
    elements:
      shop:
        kind: system
        elements:
          web:
            kind: container
            code: apps/web/**
            uses: { api: Calls it }
          api:
            kind: container
            code: apps/api/**
            elements:
              routes:
                kind: component
                code: apps/api/src/routes/**
                uses: { orders: Creates orders }
              orders:
                kind: component
                code: apps/api/src/orders/**
                uses: { storage: Saves orders }
              storage:
                kind: component
                code: apps/api/src/storage/**
                uses: { db: Writes orders }
          db:
            kind: datastore
            technology: PostgreSQL
  `,
});

describe("scoreModel", () => {
  it("scores a model against itself as perfect", () => {
    const s = scoreModel(golden, golden, files);
    expect(s.overall).toBe(1);
    expect(s.missing).toEqual([]);
    expect(s.extra).toEqual([]);
    expect(s.relationships).toMatchObject({ expected: 4, matched: 4, precision: 1 });
  });

  it("matches elements by their code, not their names", () => {
    const renamed = model({
      "archdoc.yaml": `
        archdoc: "2.0"
        namespace: other
        elements:
          storefront:
            kind: container
            code: apps/web/**
            uses: { backend: Calls it }
          backend:
            kind: container
            code: apps/api/**
            elements:
              http: { kind: component, code: apps/api/src/routes/**, uses: { domain: x } }
              domain: { kind: component, code: apps/api/src/orders/**, uses: { persistence: x } }
              persistence: { kind: component, code: apps/api/src/storage/**, uses: { postgres: x } }
          postgres: { kind: datastore, technology: Postgres }
      `,
    });
    const s = scoreModel(renamed, golden, files);
    expect(s.overall).toBe(1);
    expect(s.matches.find((m) => m.golden === "shop.api.orders")?.found).toBe("backend.domain");
    expect(s.matches.find((m) => m.golden === "shop.db")?.found).toBe("postgres");
  });

  it("misses the components and their uses in a model that stops at containers", () => {
    const flat = model({
      "archdoc.yaml": `
        archdoc: "2.0"
        namespace: shop
        elements:
          web: { kind: container, code: apps/web/**, uses: { api: x } }
          api: { kind: container, code: apps/api/**, uses: { db: x } }
          db: { kind: datastore, technology: PostgreSQL }
      `,
    });
    const s = scoreModel(flat, golden, files);
    expect(s.containers.recall).toBe(1);
    expect(s.components).toMatchObject({ expected: 3, matched: 0, recall: 0 });
    // Files still sit in the right container.
    expect(s.code.accuracy).toBe(1);
    // web → api is there; the uses between components aren't. api → db is
    // right once lifted, so it isn't an extra.
    expect(s.relationships).toMatchObject({ expected: 4, matched: 1, precision: 1 });
    expect(s.missing).toEqual(["shop.api.routes", "shop.api.orders", "shop.api.storage"]);
    expect(s.nesting.ratio).toBe(1);
  });

  it("finds a component under the wrong container", () => {
    const misplaced = model({
      "archdoc.yaml": `
        archdoc: "2.0"
        namespace: shop
        elements:
          web:
            kind: container
            code: apps/web/**
            elements:
              orders: { kind: component, code: apps/api/src/orders/** }
          api:
            kind: container
            code: apps/api/**
            elements:
              routes: { kind: component, code: apps/api/src/routes/** }
              storage: { kind: component, code: apps/api/src/storage/** }
      `,
    });
    const s = scoreModel(misplaced, golden, files);
    expect(s.misnested).toEqual([
      { golden: "shop.api.orders", found: "web.orders", expectedParent: "api", foundParent: "web" },
    ]);
    expect(s.nesting).toMatchObject({ checked: 5, correct: 4 });
  });

  it("counts extra elements against precision, and a different kind against kind agreement", () => {
    const extra = model({
      "archdoc.yaml": `
        archdoc: "2.0"
        namespace: shop
        elements:
          web: { kind: container, code: apps/web/src/main.ts }
          page: { kind: container, code: apps/web/src/page.ts }
          api:
            kind: container
            code: apps/api/**
            elements:
              routes: { kind: container, code: apps/api/src/routes/** }
      `,
    });
    const s = scoreModel(extra, golden, files);
    // web keeps half its files, enough to match; page is extra.
    expect(s.containers.recall).toBe(1);
    expect(s.containers.precision).toBeCloseTo(3 / 4);
    expect(s.extra).toEqual(["page"]);
    // routes is a component in the golden model, a container here.
    expect(s.kindAgreement).toBeCloseTo(2 / 3);
    expect(formatScore(s, true)).toContain("extra: page");
  });

  it("counts a model's errors", () => {
    const broken = model({
      "archdoc.yaml": `
        archdoc: "2.0"
        namespace: shop
        elements:
          web: { kind: container, code: apps/web/**, uses: { nowhere: x } }
      `,
    });
    expect(scoreModel(broken, golden, files).errors).toBeGreaterThan(0);
  });
});
