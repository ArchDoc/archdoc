import { describe, expect, it } from "vitest";
import { buildModel, type EditOp, editModel } from "../src/index.js";
import { dedent } from "./helpers.js";

const ROOT = dedent(`
  # The shop, in spec v2.
  archdoc: "2.0"
  namespace: shop
  actors:
    buyer:
      kind: person
      description: Buys things
      uses:
        web: Shops
  elements:
    shop:
      kind: system
      description: The shop.
      elements:
        web:
          kind: container
          description: The storefront.
          code: web/**
          uses:
            orders.api:
              description: Posts orders
        orders:
          kind: container
          description: Takes orders.
          code: orders/**
          elements:
            api:
              kind: component
              description: The HTTP routes.
              code: orders/src/api/**
              uses:
                store:
                  description: Saves orders
                  sends: [Order]
            store:
              kind: component
              description: Reads and writes orders.
              code: orders/src/store/**
              uses:
                db: Inserts rows

        # Postgres, from compose.
        db:
          kind: datastore
          technology: Postgres
          stores:
            orders: { entity: Order, key: id }
  data:
    Order:
      kind: entity
      description: An order.
      fields:
        id: { type: uuid }
        total: { type: int }
`);

const JOURNEY = dedent(`
  journeys:
    place-order:
      actor: buyer
      goal: Buy what's in the cart
      steps:
        - { from: buyer, to: web, action: Checks out, code: web/src/checkout.tsx }
        - { from: web, to: shop.orders.api, action: Posts the cart, code: web/src/api.ts, sends: [Order] }
        - { from: shop.orders.api, to: shop.orders.store, action: Saves it, code: orders/src/api/orders.ts }
        - { from: shop.orders.store, to: db, action: Inserts the row, creates: Order }
`);

const sources = [
  { path: ".archdoc/archdoc.yaml", text: ROOT },
  { path: ".archdoc/journeys/place-order.yaml", text: JOURNEY },
];

function edit(ops: EditOp | EditOp[], by?: string) {
  const r = editModel(sources, [ops].flat(), {
    by,
    journeyFile: (id) => `.archdoc/journeys/${id}.yaml`,
  });
  const files = new Map(r.files.map((f) => [f.path, f]));
  const text = (path = ".archdoc/archdoc.yaml") => files.get(path)?.text ?? "";
  const next = sources
    .filter((s) => !files.get(s.path)?.removed)
    .map((s) => ({ path: s.path, text: files.get(s.path)?.text ?? s.text }))
    .concat(r.files.filter((f) => f.created).map((f) => ({ path: f.path, text: f.text })));
  return { ...r, text, files, model: buildModel(next, { root: ".archdoc/archdoc.yaml" }) };
}

/** The lines an edit changed, as a small diff: - removed, + added, in order. */
function changed(before: string, after: string): string[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const lcs = a.map(() => new Array<number>(b.length + 1).fill(0));
  lcs.push(new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      const row = lcs[i] as number[];
      const below = lcs[i + 1] as number[];
      row[j] =
        a[i] === b[j]
          ? (below[j + 1] as number) + 1
          : Math.max(below[j] as number, row[j + 1] as number);
    }
  }
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      i++;
      j++;
    } else if (
      j >= b.length ||
      (i < a.length && (lcs[i + 1]?.[j] ?? 0) >= (lcs[i]?.[j + 1] ?? 0))
    ) {
      out.push(`- ${(a[i++] as string).trim()}`);
    } else {
      out.push(`+ ${(b[j++] as string).trim()}`);
    }
  }
  return out;
}

const errors = (m: ReturnType<typeof buildModel>) =>
  m.diagnostics.filter((d) => d.severity === "error").map((d) => d.message);

describe("editModel", () => {
  it("sets fields and changes only those lines, keeping comments and blank lines", () => {
    const r = edit({
      op: "set",
      id: "orders.api",
      spec: { description: "Routes for placing orders.", technology: "Express" },
    });
    expect(r.problems).toEqual([]);
    expect(r.done).toEqual([
      "Set description, technology on element shop.orders.api (.archdoc/archdoc.yaml).",
    ]);
    expect(changed(ROOT, r.text())).toEqual([
      "- description: The HTTP routes.",
      "+ technology: Express",
      "+ description: Routes for placing orders.",
    ]);
    expect(r.text()).toContain("# Postgres, from compose.");
    expect(r.text()).toContain("# The shop, in spec v2.");
    expect(r.model.elements.get("shop.orders.api")?.spec.technology).toBe("Express");
  });

  it("merges like a JSON merge patch: maps merge, null removes", () => {
    const r = edit({
      op: "set",
      id: "Order",
      spec: { fields: { total: { type: "int", description: "In cents" }, id: null } },
    });
    expect(changed(ROOT, r.text())).toEqual([
      "- id: { type: uuid }",
      "- total: { type: int }",
      "+ total: { type: int, description: In cents }",
    ]);
  });

  it("adds an element inside its parent, with the kind of the level below and provenance", () => {
    const r = edit(
      {
        op: "add",
        type: "element",
        id: "orders.events",
        spec: { description: "Publishes order.placed.", code: "orders/src/events/**" },
      },
      "agent:test",
    );
    expect(r.done[0]).toBe(
      "Added component shop.orders.events in .archdoc/archdoc.yaml (kind component: say kind to change it).",
    );
    expect(r.model.elements.get("shop.orders.events")?.spec).toMatchObject({
      kind: "component",
      provenance: { source: "suggested", by: "agent:test" },
    });
    expect(r.text()).toContain("provenance: { source: suggested, by: agent:test }");
    expect(errors(r.model)).toEqual([]);
  });

  it("adds, updates, and removes uses, written as short as they resolve", () => {
    const added = edit({ op: "use", from: "orders.store", to: "shop.web", spec: "Calls back" });
    expect(added.done).toEqual(["Added the use shop.orders.store -> shop.web (as web)."]);
    expect(added.model.relationships).toContainEqual(
      expect.objectContaining({ from: { type: "element", id: "shop.orders.store" }, ref: "web" }),
    );

    const updated = edit({
      op: "use",
      from: "api",
      to: "store",
      spec: { sends: ["Order", "Refund"] },
    });
    expect(updated.done).toEqual(["Updated the use shop.orders.api -> shop.orders.store."]);
    expect(changed(ROOT, updated.text())).toEqual(["- sends: [Order]", "+ sends: [Order, Refund]"]);

    const removed = edit({ op: "use", from: "store", to: "db", remove: true });
    expect(changed(ROOT, removed.text())).toEqual(["- uses:", "- db: Inserts rows"]);
  });

  it("renames an element in place and rewrites every reference the way it was written", () => {
    const r = edit({ op: "rename", id: "orders.store", to: "repository" });
    expect(r.done).toEqual([
      "Renamed element shop.orders.store to shop.orders.repository, and 3 references to it.",
    ]);
    expect(errors(r.model)).toEqual([]);
    // The use from api (written short) and the element's own key.
    expect(changed(ROOT, r.text())).toEqual([
      "- store:",
      "+ repository:",
      "- store:",
      "+ repository:",
    ]);
    expect(r.text(".archdoc/journeys/place-order.yaml")).toContain(
      "{ from: shop.orders.repository, to: db, action: Inserts the row, creates: Order }",
    );
  });

  it("moves an element to another parent, and its references follow", () => {
    const r = edit({ op: "rename", id: "orders.api", to: "shop.web.api" });
    expect(errors(r.model)).toEqual([]);
    expect(r.model.elements.has("shop.web.api")).toBe(true);
    // The moved element's own uses still reach the store from its new place.
    expect(r.model.relationships).toContainEqual(
      expect.objectContaining({
        from: { type: "element", id: "shop.web.api" },
        to: { type: "element", id: "shop.orders.store" },
      }),
    );
    expect(r.text(".archdoc/journeys/place-order.yaml")).toContain("to: shop.web.api");
  });

  it("renames an actor and a data entry everywhere they're named", () => {
    const actor = edit({ op: "rename", id: "buyer", to: "customer" });
    expect(errors(actor.model)).toEqual([]);
    expect(actor.text(".archdoc/journeys/place-order.yaml")).toMatch(
      /actor: customer[\s\S]*from: customer/,
    );

    const data = edit({ op: "rename", type: "data", id: "Order", to: "Purchase" });
    expect(errors(data.model)).toEqual([]);
    expect(data.text()).toContain("entity: Purchase");
    expect(data.text()).toContain("sends: [Purchase]");
    expect(data.text(".archdoc/journeys/place-order.yaml")).toContain("creates: Purchase");
  });

  it("removes an element with what's inside it and the uses of it, but not under a journey", () => {
    const refused = edit({ op: "remove", id: "orders" });
    expect(refused.files.size).toBe(0);
    expect(refused.problems[0]).toContain(
      "Journey steps go through it: place-order#2, place-order#3",
    );

    const r = edit({ op: "remove", id: "shop.web" }, undefined);
    expect(r.problems[0]).toContain("place-order#1");

    const db = edit([
      { op: "step", journey: "place-order", at: 4, remove: true },
      { op: "remove", id: "db" },
    ]);
    expect(db.problems).toEqual([]);
    expect(db.done[1]).toBe("Removed element shop.db, and 1 use of it.");
    expect(errors(db.model)).toEqual([]);
    expect(db.text()).not.toContain("Postgres");
  });

  it("appends, inserts, merges, and removes journey steps in the file's style", () => {
    const r = edit([
      {
        op: "step",
        journey: "place-order",
        spec: { from: "shop.orders.api", to: "buyer", action: "Answers 201" },
      },
      {
        op: "step",
        journey: "place-order",
        at: 2,
        insert: true,
        spec: { from: "web", to: "web", action: "Validates the cart" },
      },
      { op: "step", journey: "place-order", at: 1, spec: { action: "Opens checkout" } },
    ]);
    expect(r.problems).toEqual([]);
    const text = r.text(".archdoc/journeys/place-order.yaml");
    expect(changed(JOURNEY, text)).toEqual([
      "- - { from: buyer, to: web, action: Checks out, code: web/src/checkout.tsx }",
      "+ - { from: buyer, to: web, action: Opens checkout, code: web/src/checkout.tsx }",
      "+ - { from: web, to: web, action: Validates the cart }",
      "+ - { from: shop.orders.api, to: buyer, action: Answers 201 }",
    ]);
    expect(text.split("\n").findIndex((l) => l.includes("Validates"))).toBe(6);
  });

  it("writes a new journey to a file of its own", () => {
    const r = edit({
      op: "add",
      type: "journey",
      id: "track-order",
      spec: {
        actor: "buyer",
        goal: "See where an order is",
        steps: [{ from: "buyer", to: "web", action: "Opens the order page" }],
      },
    });
    const file = r.files.get(".archdoc/journeys/track-order.yaml");
    expect(file?.created).toBe(true);
    expect(file?.text).toBe(
      [
        "journeys:",
        "  track-order:",
        "    actor: buyer",
        "    goal: See where an order is",
        "    steps:",
        "      - { from: buyer, to: web, action: Opens the order page }",
        "",
      ].join("\n"),
    );
    expect(r.model.journeys.has("track-order")).toBe(true);
  });

  it("says what failed, and changes nothing", () => {
    const r = edit([
      { op: "set", id: "orders", spec: { description: "x" } },
      { op: "set", id: "nope", spec: { description: "x" } },
      { op: "add", type: "element", id: "missing.child" },
    ]);
    expect(r.files.size).toBe(0);
    expect(r.problems).toEqual([
      '#2 set nope: Nothing is called "nope". archdoc_find lists IDs.',
      '#3 add element missing.child: No element "missing". archdoc_find lists IDs.',
    ]);
  });

  it("asks which one when an ID names two things", () => {
    const both = [
      {
        path: "archdoc.yaml",
        text: 'archdoc: "2.0"\nnamespace: x\nactors:\n  ops: { kind: team }\nelements:\n  ops: { kind: container }\n',
      },
    ];
    const r = editModel(both, [{ op: "set", id: "ops", spec: { description: "d" } }]);
    expect(r.problems[0]).toContain('"ops" names an element and an actor. Say which with type.');
    const ok = editModel(both, [
      { op: "set", id: "ops", type: "actor", spec: { description: "d" } },
    ]);
    expect(ok.files[0]?.text).toContain("ops: { kind: team, description: d }");
  });
});
