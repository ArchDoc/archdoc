import { buildModel } from "@archdoc/core/browser";
import { describe, expect, it } from "vitest";
import { entrySheet, storeCards, travellingEntries } from "../src/graph/catalog.js";

const model = buildModel([
  {
    path: "archdoc.yaml",
    text: `
archdoc: "2.0"
namespace: shop
actors:
  shopper: { kind: person, uses: { web: { description: Checks out, sends: Cart } } }
elements:
  web: { kind: container, uses: { api: { description: Posts the cart, sends: Cart } } }
  api: { kind: container, uses: { db: Saves orders, bus: Publishes order.placed } }
  db:
    kind: datastore
    technology: PostgreSQL
    stores:
      orders: { entity: Order, key: id }
      lines: { entity: OrderLine, key: id }
  bus: { kind: queue, technology: RabbitMQ }
data:
  Cart: { kind: message, description: The cart., fields: { items: { type: json } } }
  Order:
    kind: entity
    description: An order.
    fields: { id: { type: uuid }, email: { type: string, classification: pii } }
  OrderLine:
    kind: entity
    description: One line of an order.
    fields: { id: { type: uuid }, order_id: { type: uuid, references: Order.id } }
  OrderPlaced: { kind: event, description: A new order. }
journeys:
  checkout:
    actor: shopper
    goal: Buy the cart
    steps:
      - { from: shopper, to: web, sends: Cart }
      - { from: web, to: api, sends: Cart }
      - { from: api, to: db, creates: Order }
      - { from: api, to: bus, sends: OrderPlaced }
`,
  },
]);

describe("the data catalog", () => {
  it("lists each store with its tables, keys, and who writes and uses it", () => {
    const [db, bus] = storeCards(model);
    expect(db).toMatchObject({
      id: "db",
      kind: "datastore",
      technology: "PostgreSQL",
      tables: [
        { table: "orders", entry: "shop.Order", key: "id", fields: 2 },
        { table: "lines", entry: "shop.OrderLine", key: "id", fields: 2 },
      ],
    });
    expect(db?.writers).toEqual([{ type: "element", id: "api" }]);
    expect(db?.users.map((u) => u.description)).toEqual(["Saves orders"]);
    expect(bus).toMatchObject({ kind: "queue", tables: [], carries: ["shop.OrderPlaced"] });
  });

  it("gives an entry its stores, keys, who makes it, its journey steps, and its relations", () => {
    const order = entrySheet(model, "shop.Order");
    expect(order.stores).toEqual([
      { element: "db", namespace: "shop", table: "orders", key: "id" },
    ]);
    expect([...order.keys]).toEqual(["id"]);
    expect(order.moves).toEqual([
      { from: { type: "element", id: "api" }, to: { type: "element", id: "db" }, how: "writes" },
    ]);
    expect(order.steps).toMatchObject([{ journey: "checkout", label: "3", how: "writes" }]);
    expect(order.referredBy).toMatchObject([{ entry: "shop.OrderLine", field: "order_id" }]);

    const cart = entrySheet(model, "shop.Cart");
    expect(cart.steps.map((s) => s.label)).toEqual(["1", "2"]);
    expect(cart.moves.map((m) => `${m.from.type}:${"id" in m.from ? m.from.id : ""}`)).toEqual([
      "actor:shopper",
      "element:web",
    ]);
  });

  it("lists what travels and isn't stored, with its fields", () => {
    expect(travellingEntries(model).map((t) => [t.entry, t.fields])).toEqual([
      ["shop.Cart", 1],
      ["shop.OrderPlaced", 0],
    ]);
  });
});
