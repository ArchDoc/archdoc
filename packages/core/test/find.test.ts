import { describe, expect, it } from "vitest";
import { find, formatFind, formatOutline } from "../src/index.js";
import { model } from "./helpers.js";

const m = model({
  "archdoc.yaml": `
    archdoc: "2.0"
    namespace: shop
    actors:
      buyer: { kind: person, description: Buys things, uses: { web: Shops } }
      auditor: { kind: role }
    elements:
      shop:
        kind: system
        elements:
          web: { kind: container, description: The storefront, code: web/**, uses: { orders.api: Posts orders } }
          orders:
            kind: container
            description: The orders package.
            code: orders/**
            elements:
              api: { kind: component, description: HTTP routes for orders, code: orders/src/api/**, uses: { store: Saves } }
              store: { kind: component, code: orders/src/store/** }
              mailer: { kind: component, description: Sends receipts }
          db: { kind: datastore, technology: Postgres }
    journeys:
      place-order:
        actor: buyer
        goal: Buy what's in the cart
        importance: critical
        steps:
          - { from: buyer, to: web, action: Checks out }
          - { from: web, to: shop.orders.api, action: Posts the cart }
    data:
      Order: { kind: entity, description: An order, fields: { id: { type: uuid } } }
      Receipt: { kind: message, description: A receipt }
  `,
});

const ids = (q: Parameters<typeof find>[1]) => find(m, q).rows.map((r) => r.id);

describe("find", () => {
  it("lists what's inside an element, by kind", () => {
    expect(ids({ under: "orders" })).toEqual([
      "shop.orders.api",
      "shop.orders.store",
      "shop.orders.mailer",
    ]);
    expect(ids({ type: "element", kind: "container" })).toEqual(["shop.web", "shop.orders"]);
    expect(ids({ type: "journey", kind: "critical" })).toEqual(["place-order"]);
  });

  it("finds the elements whose code covers a file, the owner first", () => {
    expect(ids({ path: "orders/src/store/repo.ts" })).toEqual(["shop.orders.store", "shop.orders"]);
  });

  it("finds what's still missing a description, a use, code, fields, or a journey", () => {
    // Init's descriptions don't count.
    expect(ids({ type: "element", missing: ["description"] })).toEqual([
      "shop",
      "shop.orders",
      "shop.orders.store",
      "shop.db",
    ]);
    expect(ids({ missing: ["uses"] })).toEqual(["shop.orders.mailer", "shop.db"]);
    expect(ids({ missing: ["code"] })).toEqual(["shop.orders.mailer"]);
    expect(ids({ missing: ["fields"] })).toEqual(["Receipt"]);
    expect(ids({ missing: ["journey"] })).toEqual(["auditor"]);
  });

  it("ranks by words, and says where each is written", () => {
    const r = find(m, { words: "orders api routes" });
    expect(r.rows[0]?.id).toBe("shop.orders.api");
    const text = formatFind(r, { words: "orders api routes" });
    expect(text).toMatch(/^\d+ match(es)? in the model for "orders api routes":/);
    expect(text).toContain(
      "  shop.orders.api (component): HTTP routes for orders\n    code orders/src/api/** · uses shop.orders.store · archdoc.yaml:",
    );
  });

  it("says when nothing matches", () => {
    expect(formatFind(find(m, { under: "nope" }), { under: "nope" })).toBe('No element "nope".');
    expect(formatFind(find(m, { missing: ["deploy"] }), { missing: ["deploy"] })).toBe(
      "Nothing in the model missing deploy.",
    );
  });

  it("outlines the element tree with code and uses", () => {
    const text = formatOutline(m, { depth: 2 });
    expect(text.split("\n").slice(0, 7)).toEqual([
      "shop: 7 elements, 2 actors, 1 journey, 2 data entries",
      "  shop (system)",
      "    shop.web (container): The storefront",
      "      code web/** · uses orders.api",
      "    shop.orders (container): The orders package.",
      "      code orders/**",
      "      … 3 elements inside (raise depth, or under: shop.orders)",
    ]);
    expect(formatOutline(m, { under: "orders" })).toContain("shop.orders.api (component)");
  });
});
