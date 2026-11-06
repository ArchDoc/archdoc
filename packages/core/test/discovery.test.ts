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

  it("asks for the fields of each entry, unless a schema source has them", () => {
    const m = model({
      "archdoc.yaml": `
        archdoc: "2.0"
        namespace: d
        data:
          Order: { kind: entity, description: An order., fields: { id: { type: uuid } } }
          Charge: { kind: entity, description: A charge., source: { sql: "db/schema.sql#charges" } }
          CheckoutForm: { kind: message, description: What the shopper submits. }
      `,
    });
    const a = assessDiscovery(m, []);
    const g = a.gaps.find((x) => x.code === "done/data-fields");
    expect(g?.message).toMatch(
      /^Data entry CheckoutForm has no fields\. Find where the code defines/,
    );
    expect([a.stats.dataDefined, a.stats.dataEntries]).toEqual([2, 3]);
  });
});

describe("actors", () => {
  it("keeps kind: agent for AI agents, and asks for kind: system for software that calls in", () => {
    const m = model({
      "archdoc.yaml": `
        archdoc: "2.0"
        namespace: d
        actors:
          scheduler: { kind: agent, description: The CronJob that runs the nightly report. }
          reviewer: { kind: agent, description: An LLM that reviews pull requests. }
          coding-agent: { kind: agent, description: Claude Code editing the repository. }
          billing: { kind: system, description: The billing service that posts invoices. }
      `,
    });
    const g = assessDiscovery(m, []).gaps.filter((x) => x.code === "done/agent-actor");
    expect(g).toHaveLength(1);
    expect(g[0]?.message).toMatch(/^scheduler is kind: agent, which is for AI agents/);
    expect(g[0]?.message).toContain("make it kind: system");
  });
});

describe("journey flow", () => {
  it("counts the steps that start where the flow already is", () => {
    const m = model({
      "archdoc.yaml": `
        archdoc: "2.0"
        namespace: d
        actors:
          user: { kind: person, uses: { web: Uses } }
        elements:
          web: { kind: container, uses: { api: Calls } }
          api: { kind: container, uses: { db: Saves } }
          db: { kind: datastore }
          bank: { kind: external, uses: { api: Reports } }
        journeys:
          j:
            actor: user
            goal: Test
            steps:
              - { from: user, to: web }
              - { from: web, to: api }
              - { from: bank, to: api }
              - { from: user, to: web }
              - { from: api, to: db }
          gap:
            actor: user
            goal: Test
            steps:
              - { from: user, to: web }
              - { from: api, to: db }
      `,
    });
    const s = assessDiscovery(m, []).stats;
    expect([s.flowStepsConnected, s.flowSteps]).toEqual([4, 5]);
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

describe("shape", () => {
  const shapeFiles = [
    ...Array.from({ length: 30 }, (_, i) => `shop/handlers/h${i}.go`),
    "shop/money/money.go",
    "shop/rpc/client.go",
    "shop/rpc/conn.go",
    "shop/genproto/demo.pb.go",
    "shop/genproto/demo_grpc.pb.go",
    "carts/src/store.cs",
    "carts/src/server.cs",
    "carts/protos/Cart.proto",
    "lib/a.ts",
    "lib/b.ts",
    "lib/c.ts",
    "k8s/shop.yaml",
    "k8s/carts.yaml",
    "terraform/main.tf",
  ];
  const misshapen = model({
    "archdoc.yaml": `
      archdoc: "2.0"
      namespace: boutique
      elements:
        boutique:
          kind: system
          description: The shop.
          elements:
            shop:
              kind: container
              description: The storefront.
              code: shop/handlers/**
              uses: { carts: Reads the cart, carts.store: Reads the cart, shop.rpc: Calls out }
              elements:
                handlers: { kind: component, description: Serves pages., code: shop/handlers/**, uses: { rpc: Calls services } }
                money: { kind: component, description: Adds up prices., code: shop/money/** }
                rpc: { kind: component, description: Calls the services., code: shop/rpc/** }
                genproto: { kind: component, description: Generated stubs., code: shop/genproto/** }
            carts:
              kind: container
              description: Keeps carts.
              code: carts/**
              elements:
                store: { kind: component, description: Stores carts., code: carts/src/store.cs }
            everything:
              kind: container
              description: Shared code.
              code: "**"
            queue:
              kind: queue
              description: Order events.
              uses: { carts: Delivers events }
        redis:
          kind: datastore
          description: Cart storage.
      environments:
        production:
          nodes:
            gke: { kind: cluster, code: [terraform/main.tf] }
      data:
        CartItem: { kind: message, description: An item., fields: { id: { type: string } } }
        CartItem2: { kind: message, description: The same item., fields: { id: { type: string } } }
    `,
  });
  const a = assessDiscovery(misshapen, shapeFiles);
  const gap = (code: string) => a.gaps.find((g) => g.code === code)?.message ?? "";

  it("flags uses that point the wrong way, stay in the family, or say a call twice", () => {
    expect(gap("done/backwards-use")).toContain("boutique.queue → boutique.carts");
    expect(gap("done/use-in-family")).toContain("boutique.shop → boutique.shop.rpc");
    expect(gap("done/use-two-levels")).toContain("boutique.shop → boutique.carts");
    expect([a.stats.usesMisshapen, a.stats.uses]).toEqual([3, 5]);
  });

  it("flags code outside its parent, claimed twice, one file in a big container, or generated", () => {
    expect(gap("done/code-outside-parent")).toContain("boutique.shop.money");
    expect(gap("done/overlapping-code")).toContain("boutique.everything");
    expect(gap("done/one-file-component")).toContain("boutique.shop.money");
    expect(gap("done/generated-code")).toContain("boutique.shop.genproto");
    // A component of one file in a small container is all there is: carts.store isn't flagged.
    expect(gap("done/one-file-component")).not.toContain("carts.store");
  });

  it("flags deployment files no environment maps, infrastructure outside the system, and copied data", () => {
    expect(gap("done/unmapped-deployment")).toContain("2 of 3 deployment files");
    expect(gap("done/unmapped-deployment")).toContain("k8s");
    expect(gap("done/outside-system")).toContain("redis");
    expect(gap("done/duplicate-data")).toContain("CartItem2");
    expect(a.stats.dataDuplicates).toBe(1);
  });

  it("scores the shape", () => {
    const d = scoreDiscovery(
      misshapen,
      misshapen,
      shapeFiles,
      scoreModel(misshapen, misshapen, shapeFiles),
    );
    expect(d.usesShape).toBeCloseTo(2 / 5);
    expect(d.codeShape).toBeLessThan(1);
    expect(d.deploymentMapped).toBeCloseTo(1 / 3);
    expect(d.dataDistinct).toBeCloseTo(1 / 2);
  });

  it("finds nothing wrong with a well-shaped model", () => {
    const clean = assessDiscovery(unfinished, files);
    const shapeCodes = clean.gaps.filter((g) =>
      /backwards|family|two-levels|outside|overlapping|one-file|generated|unmapped-deployment|duplicate/.test(
        g.code,
      ),
    );
    expect(shapeCodes).toEqual([]);
  });
});

describe("the system, names from the code, and code a reader can audit", () => {
  const codeFiles = [
    "src/auth/login.ts",
    "src/auth/session.ts",
    "src/orders/place-order.ts",
    "src/orders/repo.ts",
    "scripts/migrate-local.ts",
    "db/seed-local.ts",
    "catalog/main.go",
  ];
  const m = model({
    "archdoc.yaml": `
      archdoc: "2.0"
      namespace: shop
      elements:
        shop:
          kind: system
          elements:
            api:
              kind: container
              description: The shop's API.
              code: src/**
              elements:
                identity:
                  kind: component
                  description: Signs people in.
                  code: src/auth/**
                  elements:
                    login: { kind: code, description: Checks a password., code: src/auth/login.ts }
                orders:
                  kind: component
                  description: Places orders.
                  code: src/orders/**
                  elements:
                    place: { kind: code, description: Places an order., code: "src/orders/place-order.ts#placeOrder" }
                dev-data:
                  kind: component
                  description: Loads local data.
                  code: [scripts/**, db/**]
        catalog:
          kind: container
          description: Lists products.
          code: catalog/**
        stripe: { kind: external, description: Takes payments. }
      journeys:
        buy:
          actor: shopper
          goal: Buy
          steps:
            - { from: api.orders, to: api.identity, action: Checks the session, code: src/auth/session.ts }
            - { from: api.identity, to: api.orders, action: Places the order, code: "src/orders/place-order.ts#placeOrder" }
            - { from: api.orders, to: api.orders, action: Saves it, code: "src/orders/repo.ts:3-9" }
    `,
  });
  const a = assessDiscovery(m, codeFiles);
  const gap = (code: string) =>
    a.gaps
      .filter((g) => g.code === code)
      .map((g) => g.message)
      .join("\n");

  it("asks for a container outside the system to move inside it", () => {
    expect(gap("done/outside-system")).toContain("catalog");
    expect(gap("done/outside-system")).toContain("shop.catalog");
    expect(gap("done/outside-system")).not.toContain("stripe");
    expect(a.stats.insideSystem).toBe(4);
    expect(a.stats.ownParts).toBe(5);
  });

  it("asks for names the code uses, or a plain name when it uses several", () => {
    expect(gap("done/code-name")).toContain("shop.api.identity → auth");
    expect(gap("done/code-name")).toContain("shop.api.dev-data (scripts, db)");
    expect(gap("done/code-name")).toContain("name: Local Migration Scripts");
    expect(gap("done/code-name")).not.toContain("shop.api.orders");
    const named = model({
      "archdoc.yaml": `
        archdoc: "2.0"
        namespace: shop
        elements:
          dev-data: { kind: container, name: Local Migration Scripts, code: [scripts/**, db/**] }
          internals: { kind: container, code: internal/** }
      `,
    });
    expect(assessDiscovery(named, codeFiles).gaps.map((g) => g.code)).not.toContain(
      "done/code-name",
    );
  });

  it("asks for code elements and steps at a function or lines, not a whole file", () => {
    expect(gap("done/whole-file-code")).toContain("shop.api.identity.login");
    expect(gap("done/whole-file-code")).not.toContain("shop.api.orders.place");
    // identity's only code element is a whole file; dev-data and catalog have none.
    expect(gap("done/no-key-code")).toContain("shop.api.identity");
    expect(gap("done/no-key-code")).toContain("shop.api.dev-data");
    expect(gap("done/no-key-code")).toContain("catalog");
    expect(gap("done/no-key-code")).not.toContain("shop.api.orders,");
    expect(gap("done/step-whole-file")).toMatch(/step 1:/);
    expect(a.stats.codeRefs).toBe(5);
    expect(a.stats.preciseCodeRefs).toBe(3);
  });

  it("scores them", () => {
    const d = scoreDiscovery(m, m, codeFiles, scoreModel(m, m, codeFiles));
    expect(d.system).toBeCloseTo(4 / 5);
    expect(d.codeNames).toBeCloseTo(2 / 4);
    expect(d.codePrecision).toBeCloseTo(3 / 5);
    expect(d.keyCode).toBeCloseTo(1 / 4);
  });
});
