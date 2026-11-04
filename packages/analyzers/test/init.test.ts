import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildModel, loadModel, type Model } from "@archdoc/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse, stringify } from "yaml";
import { checkRepository, formatInit, inferModel, initModel } from "../src/index.js";

const repo = fileURLToPath(new URL("../../../", import.meta.url));
const org = join(repo, "examples/org");

/**
 * The model init writes, built the way loadModel builds it. Init wraps the
 * elements in one system; these tests look at what's inside it, so the system
 * is taken away and its elements put at the top, where their IDs are short.
 */
async function inferred(root: string): Promise<{ model: Model; stats: InitStats }> {
  const r = await inferModel(root);
  expect(r.problems).toEqual([]);
  const files = r.files.map((f) =>
    f.path === ".archdoc/archdoc.yaml" ? { ...f, text: unwrapSystem(f.text) } : f,
  );
  return {
    model: buildModel(files, { root: ".archdoc/archdoc.yaml" }),
    stats: r.stats,
  };
}
type InitStats = Awaited<ReturnType<typeof inferModel>>["stats"];

/** Takes init's system away, putting its elements at the top, where their IDs are short. */
function unwrapSystem(text: string): string {
  const doc = parse(text) as { elements: Record<string, { kind: string; elements?: object }> };
  const [key, system] = Object.entries(doc.elements).find(([, e]) => e.kind === "system") ?? [];
  expect(system, "init wraps the elements in a system").toBeDefined();
  if (key && system) {
    delete doc.elements[key];
    doc.elements = { ...system.elements, ...doc.elements } as typeof doc.elements;
  }
  return stringify(doc);
}

/** The model init wrote to disk, without its system (see unwrapSystem). */
async function loadUnwrapped(dir: string): Promise<Model> {
  const files: { path: string; text: string }[] = [];
  for (const path of [".archdoc/archdoc.yaml", ".archdoc/data.yaml"]) {
    const text = await readFile(join(dir, path), "utf8").catch(() => undefined);
    if (text !== undefined)
      files.push({ path, text: path.endsWith("archdoc.yaml") ? unwrapSystem(text) : text });
  }
  return buildModel(files, { root: ".archdoc/archdoc.yaml" });
}

/** The directory an element's code is, from a `dir/**` path. */
const dirOf = (path: string) => path.replace(/\/\*\*$/, "");

/**
 * How much of a hand-written model init finds: containers (by their code
 * directories) and the uses between them.
 */
function recall(found: Model, hand: Model) {
  const handContainers = [...hand.elements.values()].filter(
    (e) => e.spec.kind === "container" && e.code.some((c) => c.path.endsWith("/**")),
  );
  const match = new Map<string, string>();
  for (const h of handContainers) {
    const dirs = h.code.map((c) => dirOf(c.path));
    const f = [...found.elements.values()].find((e) =>
      e.code.some((c) => dirs.includes(dirOf(c.path))),
    );
    if (f) match.set(h.id, f.id);
  }
  // Uses between matched containers, lifted from their components.
  const lift = (m: Model, id: string, ids: Set<string>) => {
    for (let e = m.elements.get(id); e; e = e.parentId ? m.elements.get(e.parentId) : undefined) {
      if (ids.has(e.id)) return e.id;
    }
    return undefined;
  };
  const handIds = new Set(match.keys());
  const handUses = new Set<string>();
  for (const r of hand.relationships) {
    if (r.from.type !== "element" || r.to.type !== "element") continue;
    const a = lift(hand, r.from.id, handIds);
    const b = lift(hand, r.to.id, handIds);
    if (a && b && a !== b) handUses.add(`${match.get(a)}->${match.get(b)}`);
  }
  const foundUses = new Set(
    found.relationships.map(
      (r) => `${"id" in r.from ? r.from.id : ""}->${"id" in r.to ? r.to.id : ""}`,
    ),
  );
  const usesFound = [...handUses].filter((u) => foundUses.has(u)).length;
  return {
    containers: match.size / handContainers.length,
    uses: handUses.size ? usesFound / handUses.size : 1,
  };
}

/** Data sources a hand-written model reads, and how many init found. */
function sourceRecall(found: Model, hand: Model) {
  const refs = (m: Model) =>
    new Set(
      [...m.data.values()].flatMap((d) =>
        Object.entries(d.spec.source ?? {}).map(([k, v]) => `${k}:${v}`),
      ),
    );
  const want = refs(hand);
  const have = refs(found);
  return [...want].filter((r) => have.has(r)).length / want.size;
}

describe("archdoc init on ArchDoc itself", () => {
  it("finds the containers and the uses between them a person wrote", async () => {
    const { model, stats } = await inferred(repo);
    const hand = await loadModel(".", { cwd: repo });
    const r = recall(model, hand);
    // Measured: all 10 containers, and 13 of the 17 uses between them. The
    // other 4 happen at run time, not in imports: the CLI serves the
    // explorer's build, the action and the landscape template run the CLI,
    // and the skill calls the MCP server.
    expect(r.containers).toBe(1);
    expect(r.uses).toBeGreaterThanOrEqual(0.7);
    expect(stats.coverage.claimed / stats.coverage.total).toBeGreaterThanOrEqual(0.95);
    expect(model.elements.get("github-action")?.spec.technology).toBe("GitHub Actions (composite)");
    expect(model.elements.get("cli")?.spec.technology).toBe("TypeScript, CLI");
  });
});

describe("archdoc init on the demo org", () => {
  it("reads every data source the hand-written models name", async () => {
    for (const name of ["payments", "trips"]) {
      const { model } = await inferred(join(org, name));
      const hand = await loadModel(".", { cwd: join(org, name) });
      expect(sourceRecall(model, hand), name).toBe(1);
    }
  });

  it("makes the Prisma schema a datastore with its tables, and the proto service a contract", async () => {
    const r = await inferModel(join(org, "payments"));
    const model = buildModel(r.files, { root: ".archdoc/archdoc.yaml" });
    const db = [...model.elements.values()].find((e) => e.spec.kind === "datastore");
    expect(db?.spec.technology).toBe("PostgreSQL");
    expect(Object.keys(db?.spec.stores ?? {})).toEqual(["charges", "refunds", "ledger_entries"]);
    expect(r.stats.contracts).toBe(1);
  });
});

describe("archdoc init on a Go service with compose and SQL migrations", () => {
  let dir: string;
  const write = async (path: string, text: string) => {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), text);
  };

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "archdoc-init-"));
    await write("go.mod", "module github.com/acme/rides\n\ngo 1.23\n");
    await write("cmd/api/main.go", "package main\n\nfunc main() {}\n");
    await write("cmd/api/routes.go", "package main\n");
    await write("cmd/worker/main.go", "package main\n\nfunc main() {}\n");
    await write("internal/trips/trips.go", "package trips\n");
    await write(
      "migrations/001_init.sql",
      "CREATE TABLE trips (id uuid primary key, rider_email text);\nCREATE TABLE ride_events (id uuid);\n",
    );
    await write("migrations/002_drop.sql", "DROP TABLE ride_events;\n");
    await write(
      "compose.yaml",
      [
        "services:",
        "  api:",
        "    build: { context: ., dockerfile: cmd/api/Dockerfile }",
        "    depends_on: [db, cache, events]",
        "  worker:",
        "    build: { context: ., dockerfile: cmd/worker/Dockerfile }",
        "    depends_on: { events: { condition: service_started } }",
        "  db: { image: postgres:16 }",
        "  cache: { image: redis:7-alpine }",
        "  events: { image: bitnami/kafka:3.7 }",
      ].join("\n"),
    );
    execFileSync("git", ["init", "-q"], { cwd: dir });
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it("writes a binary per cmd/, compose's datastores and queues, and the tables migrations leave", async () => {
    const r = await initModel(dir);
    expect(r.written).toBe(true);
    expect(
      (await loadModel(".", { cwd: dir })).diagnostics.filter((d) => d.severity === "error"),
    ).toEqual([]);
    const model = await loadUnwrapped(dir);
    expect(model.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const kinds = Object.fromEntries(
      [...model.elements.values()].map((e) => [e.id, `${e.spec.kind} ${e.spec.technology}`]),
    );
    expect(kinds).toEqual({
      api: "container Go",
      worker: "container Go",
      rides: "container Go",
      db: "datastore PostgreSQL",
      cache: "datastore Redis",
      events: "queue Kafka",
    });
    const uses = model.relationships
      .map((x) => `${"id" in x.from ? x.from.id : ""}->${"id" in x.to ? x.to.id : ""}`)
      .sort();
    expect(uses).toEqual(["api->cache", "api->db", "api->events", "rides->db", "worker->events"]);
    // The compose database is the one the migrations describe.
    expect(model.elements.get("db")?.spec.stores).toEqual({ trips: { entity: "Trip" } });
    expect(model.data.get("Trip")?.spec.source).toEqual({ sql: "migrations#trips" });
    expect(model.elements.get("api")?.spec.provenance).toEqual({
      source: "inferred",
      by: "archdoc init",
    });
    const yaml = await readFile(join(dir, ".archdoc/archdoc.yaml"), "utf8");
    expect(yaml).toContain("# Who uses this system, and how: init can't tell.");
    expect(yaml).not.toMatch(/[&*]a\d/);
  });

  it("never writes over a model", async () => {
    const r = await initModel(dir);
    expect(r.written).toBe(false);
    expect(formatInit(r)).toContain("already has .archdoc/");
  });

  it("says what it found and what to do next", async () => {
    const out = formatInit({ ...(await inferModel(dir)), written: true });
    expect(out).toMatch(/^✓ Wrote \.archdoc\/archdoc\.yaml and \.archdoc\/data\.yaml\./);
    expect(out).toContain("3 containers, 0 components in them, 0 code elements in those");
    expect(out).toContain("5 uses, 3 datastores or queues, 0 contracts, 1 data entry");
    expect(out).toContain("4. Add actors");
    expect(out).toContain("archdoc check --done");
    expect(out).toContain("archdoc seal --all");
  });
});

describe("archdoc init on flat Go and Python layouts", () => {
  let dir: string;
  const write = async (path: string, text: string) => {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), text);
  };
  const uses = (m: Model) =>
    m.relationships
      .map((x) => `${"id" in x.from ? x.from.id : ""}->${"id" in x.to ? x.to.id : ""}`)
      .sort();

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "archdoc-init-flat-"));
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it("splits a Go module by its packages, with uses from their imports", async () => {
    const root = join(dir, "go");
    const w = (p: string, t: string) => write(`go/${p}`, t);
    await w("go.mod", "module github.com/acme/blog\n\ngo 1.23\n");
    await w("main.go", 'package main\n\nimport "github.com/acme/blog/articles"\n');
    await w("articles/models.go", 'package articles\n\nimport "github.com/acme/blog/common"\n');
    await w("articles/routers.go", "package articles\n");
    await w("common/db.go", 'package common\n\nimport "database/sql"\n');
    await w("common/errors.go", "package common\n");
    const { model } = await inferred(root);
    const kinds = Object.fromEntries([...model.elements.values()].map((e) => [e.id, e.spec.kind]));
    expect(kinds).toEqual({
      blog: "container",
      "blog.articles": "component",
      "blog.articles.models": "code",
      "blog.articles.routers": "code",
      "blog.common": "component",
      "blog.common.db": "code",
      "blog.common.errors": "code",
    });
    expect(uses(model)).toEqual(["blog.articles->blog.common"]);
  });

  it("skips a pyproject that only declares a workspace, and reads the project's imports", async () => {
    const root = join(dir, "py");
    const w = (p: string, t: string) => write(`py/${p}`, t);
    await w("pyproject.toml", '[tool.uv.workspace]\nmembers = ["backend"]\n');
    await w("backend/pyproject.toml", '[project]\nname = "app"\ndependencies = ["fastapi"]\n');
    await w("backend/app/__init__.py", "");
    await w("backend/app/api/routes.py", "from app.core.security import hash_password\n");
    await w("backend/app/api/deps.py", "from app.core import config\n");
    await w("backend/app/core/security.py", "def hash_password(p): ...\n");
    await w("backend/app/core/config.py", "settings = {}\n");
    const { model } = await inferred(root);
    expect([...model.elements.values()].map((e) => `${e.id} ${e.spec.technology}`)).toContain(
      "app Python, FastAPI",
    );
    expect([...model.elements.values()].some((e) => e.code.some((c) => c.path === "**"))).toBe(
      false,
    );
    expect(uses(model)).toEqual(["app.api->app.core"]);
  });

  it("leaves out tests, test packages, mocks, and smoke checks", async () => {
    const root = join(dir, "tested");
    const w = (p: string, t: string) => write(`tested/${p}`, t);
    await w("package.json", '{ "name": "shop", "private": true }\n');
    await w("pnpm-workspace.yaml", "packages: [api, e2e]\n");
    await w("api/package.json", '{ "name": "@shop/api" }\n');
    await w(
      "api/src/orders/service.ts",
      'import { db } from "../storage/db";\nexport const s = db;\n',
    );
    await w("api/src/orders/service.spec.ts", 'import { s } from "./service";\n');
    await w("api/src/storage/db.ts", "export const db = {};\n");
    await w("api/src/testing/fake-db.ts", 'import { db } from "../storage/db";\n');
    await w("api/test/orders.test.ts", 'import { s } from "../src/orders/service";\n');
    await w("api/vitest.config.ts", "export default {};\n");
    await w(
      "e2e/package.json",
      '{ "name": "@shop/e2e", "devDependencies": { "@playwright/test": "1" } }\n',
    );
    await w("e2e/checkout.spec.ts", "export {};\n");
    await w("e2e/helpers.ts", "export {};\n");
    await w("verification/smoke.py", "import httpx\n");
    await w("services/billing/billing_test.go", "package billing\n");
    const { model } = await inferred(root);
    expect([...model.elements.keys()].sort()).toEqual([
      "api",
      "api.orders",
      "api.orders.service",
      "api.storage",
      "api.storage.db",
    ]);
    expect(uses(model)).toEqual(["api.orders->api.storage"]);
  });
});

describe("archdoc init, layer by layer", () => {
  let dir: string;
  const write = async (path: string, text: string) => {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), text);
  };

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "archdoc-init-layers-"));
    await write("package.json", JSON.stringify({ name: "shop", private: true }));
    await write("pnpm-workspace.yaml", "packages: [apps/*, packages/*]\n");
    await write("apps/web/package.json", JSON.stringify({ name: "@shop/web" }));
    await write(
      "apps/web/src/app.ts",
      'import { placeOrder } from "@shop/api";\nexport const app = placeOrder;\n',
    );
    await write(
      "packages/api/package.json",
      JSON.stringify({ name: "@shop/api", main: "src/index.ts" }),
    );
    await write("packages/api/src/index.ts", 'export { placeOrder } from "./orders/place.js";\n');
    await write(
      "packages/api/src/orders/place.ts",
      'import { login } from "../users/login.js";\nimport { price } from "./price.js";\nexport function placeOrder() {\n  return [login(), price()];\n}\n',
    );
    await write(
      "packages/api/src/orders/price.ts",
      "export function price() {}\nexport function tax() {}\n",
    );
    await write("packages/api/src/users/login.ts", "export function login() {}\n");
    await write("packages/util/package.json", JSON.stringify({ name: "@shop/util" }));
    await write("packages/util/src/strings.ts", "export function pad() {}\nexport class Slug {}\n");
    await write(
      "packages/util/src/dates.ts",
      'import { pad } from "./strings.js";\nexport function day() {\n  return pad();\n}\n',
    );
    execFileSync("git", ["init", "-q"], { cwd: dir });
    execFileSync("git", ["add", "."], { cwd: dir });
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it("nests components in containers and code in components, with uses at every level", async () => {
    const r = await initModel(dir);
    expect(r.problems).toEqual([]);
    const model = await loadUnwrapped(dir);
    const kinds = Object.fromEntries([...model.elements.values()].map((e) => [e.id, e.spec.kind]));
    expect(kinds).toEqual({
      web: "container",
      api: "container",
      "api.orders": "component",
      "api.orders.place": "code",
      "api.orders.price": "code",
      "api.users": "component",
      "api.users.login": "code",
      util: "container",
      // A flat package: its files are the components, their functions and classes the code.
      "util.dates": "component",
      "util.strings": "component",
      "util.strings.pad": "code",
      "util.strings.Slug": "code",
    });
    // A file with one function points at it; one with several leaves them to its component.
    expect(model.elements.get("api.orders.place")?.code).toEqual([
      { path: "packages/api/src/orders/place.ts", symbol: "placeOrder" },
    ]);
    expect(model.elements.get("api.orders.price")?.code).toEqual([
      { path: "packages/api/src/orders/price.ts" },
    ]);
    const uses = model.relationships
      .map((x) => `${"id" in x.from ? x.from.id : ""}->${"id" in x.to ? x.to.id : ""}`)
      .sort();
    expect(uses).toEqual([
      "api.orders->api.users",
      "api.orders.place->api.orders.price",
      "util.dates->util.strings",
      "web->api",
    ]);
    expect(r.stats).toMatchObject({ elements: 3, components: 4, code: 5, uses: 4 });

    // check agrees: every import is declared, and every layer sits inside the one above it.
    const checked = await checkRepository({ cwd: dir });
    const codes = checked.findings.map((f) => `${f.code} ${f.element ?? ""}`);
    expect(codes).toEqual([]);
  });

  it("makes services/ inside a package a component, and the files beside its directories too", async () => {
    const root = join(dir, "py");
    const w = (p: string, t: string) => write(`py/${p}`, t);
    await w("pyproject.toml", '[project]\nname = "invoicing"\ndependencies = ["fastapi"]\n');
    await w("invoicing/__init__.py", "");
    await w("invoicing/db.py", "def session(): ...\n");
    await w("invoicing/api/routes.py", "from invoicing.services.billing import bill\n");
    await w("invoicing/models/invoice.py", "class Invoice: ...\n");
    await w("invoicing/services/billing.py", "from invoicing.db import session\ndef bill(): ...\n");
    await w("invoicing/services/customers.py", "def find(): ...\n");
    const { model } = await inferred(root);
    const components = [...model.elements.values()]
      .filter((e) => e.spec.kind === "component")
      .map((e) => e.id)
      .sort();
    expect(components).toEqual([
      "invoicing.api",
      "invoicing.db",
      "invoicing.models",
      "invoicing.services",
    ]);
    expect(model.elements.get("invoicing.services.billing")?.spec.kind).toBe("code");
  });
});
