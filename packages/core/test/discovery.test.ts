import { describe, expect, it } from "vitest";
import {
  assessDiscovery,
  formatDiscovery,
  isVerificationCode,
  scoreDiscovery,
  scoreModel,
} from "../src/index.js";
import { model } from "./helpers.js";

describe("isVerificationCode", () => {
  it.each([
    "apps/api/test/orders.test.ts",
    "apps/api/src/orders/service.spec.ts",
    "src/__tests__/api.ts",
    "e2e/checkout.ts",
    "playwright-tests/login.ts",
    "test-jpms/src/main/java/Module.java",
    "gson/src/test/java/com/google/gson/GsonTest.java",
    "internal/store/store_test.go",
    "util/testutil/context.go",
    "model/histogram/test_utils.go",
    "worker/tests/test_triage.py",
    "worker/conftest.py",
    "tests/Basket.UnitTests/BasketServiceTests.cs",
    "src/Catalog.API/Program.Testing.cs",
    "src/ClientApp/Services/Basket/BasketMockService.cs",
    "web/src/setupTests.ts",
    "web/vitest.config.ts",
    "e2e/playwright.config.ts",
    "orders/src/testing/fake-publisher.ts",
    "verification/smoke.py",
    "loadtest/checkout.js",
    "src/__mocks__/fs.ts",
    "web/ui/react-app/src/pages/targets/__testdata__/testdata.ts",
    "benchmarks/parse.go",
  ])("%s is test or verification code", (path) => {
    expect(isVerificationCode(path)).toBe(true);
  });

  it.each([
    "apps/api/src/orders/service.ts",
    "internal/postings/settle.go",
    "src/auth/verify.ts",
    "cmd/promtool/main.go",
    "src/contest/entries.ts",
    "openapi/specs/orders.yaml",
    "src/Ordering.API/Program.cs",
    "src/latest/index.ts",
    "testimonials/page.tsx",
  ])("%s isn't", (path) => {
    expect(isVerificationCode(path)).toBe(false);
  });
});

const files = [
  "web/src/main.ts",
  "web/src/api.ts",
  "api/src/routes/orders.ts",
  "api/src/orders/service.ts",
  "api/src/storage/db.ts",
  "api/test/orders.test.ts",
  "e2e/checkout.spec.ts",
  "e2e/helpers.ts",
  "worker/main.py",
];

const unfinished = model({
  "archdoc.yaml": `
    archdoc: "2.0"
    namespace: shop
    elements:
      web:
        kind: container
        description: The @shop/web package (web).
        code: web/**
        uses: { api: Calls it }
      api:
        kind: container
        description: The orders API.
        code: api/**
        elements:
          routes: { kind: component, description: A code directory (api/src/routes)., code: api/src/routes/**, uses: { orders: Creates orders } }
          orders: { kind: component, description: Creates orders., code: api/src/orders/**, uses: { storage: Saves orders } }
          storage: { kind: component, description: Talks to the database., code: api/src/storage/** }
      e2e:
        kind: container
        description: End-to-end tests.
        code: e2e/**
      worker:
        kind: container
        description: Sends receipts.
        code: worker/**
    journeys:
      checkout:
        actor: web
        goal: Buy
        steps:
          - { from: web, to: api }
  `,
});

describe("assessDiscovery", () => {
  const a = assessDiscovery(unfinished, files);
  const codes = a.gaps.map((g) => g.code);

  it("lists what an unfinished model lacks", () => {
    expect(a.stats.testElements).toEqual(["e2e"]);
    expect(a.stats.orphans).toEqual(["worker"]);
    expect(codes).toEqual(
      expect.arrayContaining([
        "done/test-code",
        "done/orphan",
        "done/undescribed",
        "done/no-actors",
        "done/few-journeys",
        "done/short-journey",
        "done/step-detail",
        "done/coarse-step",
      ]),
    );
    // A container whose glob also covers its own tests isn't test code.
    expect(a.stats.testElements).not.toContain("api");
    // web's and routes' descriptions are init's.
    expect(a.stats.described).toBe(a.stats.elements - 2);
    expect(a.gaps.find((g) => g.code === "done/undescribed")?.message).toContain("api.routes");
  });

  it("says what to do in text", () => {
    const text = formatDiscovery(a);
    expect(text).toMatch(/^✗ Not done yet/);
    expect(text).toContain("e2e is test or verification code");
    expect(text).toContain("worker connects to nothing");
    expect(formatDiscovery(a, 2)).toContain("archdoc check has 2 errors");
  });

  it("flags a level that's too wide", () => {
    const wide = model({
      "archdoc.yaml": `
        archdoc: "2.0"
        namespace: wide
        elements:
          ${Array.from({ length: 14 }, (_, i) => `c${i}: { kind: container, description: Part ${i}. }`).join("\n          ")}
      `,
    });
    const g = assessDiscovery(wide, []).gaps.find((x) => x.code === "done/level-too-wide");
    expect(g?.message).toContain("The top of the model holds 14 elements");
  });
});

describe("scoreDiscovery", () => {
  const golden = model({
    "archdoc.yaml": `
      archdoc: "2.0"
      namespace: shop
      actors:
        shopper: { kind: person, uses: { web: Shops } }
      elements:
        web: { kind: container, code: web/**, uses: { api.routes: Calls it } }
        api:
          kind: container
          code: api/**
          elements:
            routes: { kind: component, code: api/src/routes/**, uses: { orders: Creates orders } }
            orders: { kind: component, code: api/src/orders/**, uses: { storage: Saves orders } }
            storage: { kind: component, code: api/src/storage/** }
      journeys:
        checkout:
          actor: shopper
          goal: Buy
          steps:
            - { from: shopper, to: web, action: Checks out, code: web/src/main.ts }
            - { from: web, to: api.routes, action: Posts the order, code: web/src/api.ts }
            - { from: api.routes, to: api.orders, action: Creates it, code: api/src/routes/orders.ts }
            - { from: api.orders, to: api.storage, action: Saves it, code: api/src/orders/service.ts }
    `,
  });

  it("finds a journey told at another depth, under other names", () => {
    const found = model({
      "archdoc.yaml": `
        archdoc: "2.0"
        namespace: shop
        actors:
          customer: { kind: person, uses: { storefront: Shops } }
        elements:
          storefront: { kind: container, description: The shop's pages., code: web/**, uses: { backend: Calls it } }
          backend:
            kind: container
            description: The orders API.
            code: api/**
            elements:
              http: { kind: component, description: Routes., code: api/src/routes/**, uses: { domain: Creates orders } }
              domain: { kind: component, description: Orders., code: api/src/orders/**, uses: { db: Saves orders } }
              db: { kind: component, description: Storage., code: api/src/storage/** }
        journeys:
          buy:
            actor: customer
            goal: Buy
            steps:
              - { from: customer, to: storefront, action: Checks out, code: web/src/main.ts }
              - { from: storefront, to: backend, action: Posts the order, code: web/src/api.ts }
              - { from: backend.http, to: backend.domain, action: Creates it, code: api/src/routes/missing.ts }
              - { from: backend.domain, to: backend.db, action: Saves it }
      `,
    });
    const d = scoreDiscovery(found, golden, files, scoreModel(found, golden, files));
    expect(d.journeys).toMatchObject({ expected: 1, matched: 1, recall: 1 });
    // Two of four steps have an action and code that exists.
    expect(d.stepDetail).toBe(0.5);
    // storefront → backend names a container that has components.
    expect(d.stepPrecision).toBe(0.75);
    expect(d.testExclusion).toBe(1);
    expect(d.described).toBe(1);
  });

  it("misses a journey nothing follows", () => {
    const d = scoreDiscovery(unfinished, golden, files, scoreModel(unfinished, golden, files));
    expect(d.journeys).toMatchObject({ expected: 1, matched: 0, missed: ["checkout"] });
    expect(d.testExclusion).toBeLessThan(1);
  });
});
