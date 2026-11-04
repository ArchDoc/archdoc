import { describe, expect, it } from "vitest";
import {
  assessDiscovery,
  formatDiscovery,
  isLongDataName,
  isVerificationCode,
  openWarnings,
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

  it("flags a journey that never reaches what it stores or calls", () => {
    const m = model({
      "archdoc.yaml": `
        archdoc: "2.0"
        namespace: shop
        actors:
          shopper: { kind: person, uses: { api: Buys } }
        elements:
          api:
            kind: container
            description: The orders API.
            code: api/**
            elements:
              routes: { kind: component, description: Routes., code: api/src/routes/**, uses: { orders: Creates orders } }
              orders: { kind: component, description: Orders., code: api/src/orders/**, uses: { db: Saves orders } }
          db: { kind: datastore, description: Orders. }
        journeys:
          buy:
            actor: shopper
            goal: Buy
            steps:
              - { from: shopper, to: api.routes, action: Posts, code: api/src/routes/orders.ts }
              - { from: api.routes, to: api.orders, action: Creates, code: api/src/orders/service.ts }
      `,
    });
    const g = assessDiscovery(m, files).gaps.find((x) => x.code === "done/journey-stops-short");
    expect(g?.message).toContain("its elements use db");
  });

  it("flags a step whose code is in another element than the ones it names", () => {
    const m = model({
      "archdoc.yaml": `
        archdoc: "2.0"
        namespace: shop
        actors:
          shopper: { kind: person, uses: { web: Buys } }
        elements:
          web: { kind: container, description: Pages., code: web/**, uses: { db: Saves orders } }
          api:
            kind: container
            description: The orders API.
            code: api/**
            elements:
              orders: { kind: component, description: Orders., code: api/src/orders/** }
              storage: { kind: component, description: Storage., code: api/src/storage/** }
          db: { kind: datastore, description: Orders. }
        journeys:
          buy:
            actor: shopper
            goal: Buy
            steps:
              - { from: shopper, to: web, action: Buys, code: web/src/main.ts }
              - { from: web, to: db, action: Saves the order, code: api/src/storage/db.ts }
      `,
    });
    const a = assessDiscovery(m, files);
    const g = a.gaps.find((x) => x.code === "done/step-elsewhere");
    expect(g?.message).toContain("step 2's code is in api.storage");
    expect(a.stats.preciseSteps).toBe(1);
  });

  it("flags source files no element covers, but not tests or vendored code", () => {
    const m = model({
      "archdoc.yaml": `
        archdoc: "2.0"
        namespace: tsdb
        elements:
          tsdb: { kind: container, description: Stores samples., code: [tsdb/db.go] }
      `,
    });
    const tree = [
      "tsdb/db.go",
      "tsdb/head.go",
      "tsdb/compact.go",
      "tsdb/db_test.go",
      "vendor/x/y.go",
    ];
    const a = assessDiscovery(m, tree);
    expect(a.stats).toMatchObject({ sourceFiles: 3, unmappedFiles: 2 });
    expect(a.gaps.find((g) => g.code === "done/unmapped-code")?.message).toContain(
      "2 of 3 source files belong to no element, such as in tsdb/ (2)",
    );
  });

  it("says what to do in text", () => {
    const text = formatDiscovery(a);
    expect(text).toMatch(/^✗ Not done yet/);
    expect(text).toContain("e2e is test or verification code");
    expect(text).toContain("worker connects to nothing");
    expect(formatDiscovery(a, 2)).toContain("archdoc check has 2 errors to fix");
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

describe("components by size", () => {
  const big = Array.from({ length: 32 }, (_, i) => `core/src/part${i % 4}/file${i}.ts`);
  const m = model({
    "archdoc.yaml": `
      archdoc: "2.0"
      namespace: sized
      elements:
        core: { kind: container, description: The engine., code: core/** }
        tiny:
          kind: container
          description: A small helper.
          code: tiny/**
          elements:
            a: { kind: component, description: One part., code: tiny/a.ts }
            b: { kind: component, description: Another., code: tiny/b.ts }
        mid: { kind: container, description: Ten files and no parts., code: mid/** }
    `,
  });
  const files = [
    ...big,
    "tiny/a.ts",
    "tiny/b.ts",
    ...Array.from({ length: 10 }, (_, i) => `mid/src/f${i}.ts`),
  ];
  const gaps = assessDiscovery(m, files).gaps;

  it("asks for components in a big container, and none in a small one", () => {
    expect(gaps.find((g) => g.code === "done/flat-container")?.element).toBe("core");
    expect(gaps.find((g) => g.code === "done/flat-container")?.message).toContain(
      "32 source files in 4 directories",
    );
    expect(gaps.find((g) => g.code === "done/thin-container")?.element).toBe("tiny");
    // In between, it's the agent's call.
    expect(gaps.some((g) => g.element === "mid" && /container/.test(g.code))).toBe(false);
  });
});

describe("data names and descriptions", () => {
  it("keeps names short enough for the chip a step shows", () => {
    expect(isLongDataName("OrderPlaced")).toBe(false);
    expect(isLongDataName("CustomerInvoiceLineItem")).toBe(false);
    expect(isLongDataName("Tenant-partitioned Stripe object projections")).toBe(true);
    expect(isLongDataName("TenantPartitionedStripeObjectProjections")).toBe(true);
  });

  it("asks for a description of each data entry", () => {
    const m = model({
      "archdoc.yaml": `
        archdoc: "2.0"
        namespace: d
        elements:
          api: { kind: container, description: The API. }
        data:
          OrderPlaced: { kind: event, description: Announces a new order. }
          Refund: { kind: entity }
      `,
    });
    const g = assessDiscovery(m, []).gaps.find((x) => x.code === "done/data-undescribed");
    expect(g?.message).toContain("Data entry Refund doesn't say what it is");
  });
});

describe("warnings a done model has fixed", () => {
  const a = assessDiscovery(unfinished, files);
  const findings = [
    { severity: "warning", code: "data/missing-type" },
    { severity: "warning", code: "model/orphan-element" },
    { severity: "warning", code: "seal/unsealed" },
    { severity: "warning", code: "ref/unresolved-owner" },
    { severity: "error", code: "schema/invalid" },
  ];

  it("leaves only the ones a person settles", () => {
    const w = openWarnings(findings, a);
    // The orphan is listed as a line of its own, so it isn't counted twice.
    expect(w.fix.map((f) => f.code)).toEqual(["data/missing-type"]);
    expect(w.person.map((f) => f.code)).toEqual(["seal/unsealed", "ref/unresolved-owner"]);
  });

  it("isn't done while a warning is left to fix", () => {
    const done = assessDiscovery(unfinished, files);
    done.gaps = [];
    expect(formatDiscovery(done, 0, 1)).toMatch(
      /^✗ Not done yet: 0 things to finish, and archdoc check has 1 warning to fix\./,
    );
    expect(formatDiscovery(done, 2, 3)).toContain("2 errors and 3 warnings to fix");
    expect(formatDiscovery(done)).toMatch(/^✓ The model is done/);
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
