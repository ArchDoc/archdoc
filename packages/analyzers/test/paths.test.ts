import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { listRepoFiles } from "@archdoc/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  contextFor,
  findPaths,
  formatPaths,
  matchEntries,
  parseHcl,
  pathsAnswer,
  readIac,
  resourceOf,
} from "../src/index.js";

const fixtures = fileURLToPath(new URL("../../../evals/fixtures/", import.meta.url));
const ctxOf = async (name: string) => {
  const root = `${fixtures}${name}/repo`;
  return contextFor(root, await listRepoFiles(root));
};

describe("archdoc paths", () => {
  it("follows each Lambda from its trigger to the tables and queues it reaches", async () => {
    for (const name of ["serverless-aws", "serverless-aws-tf"]) {
      const r = await findPaths(await ctxOf(name), { entry: "POST /bookings" });
      expect(r.entryPoints).toHaveLength(5);
      const text = formatPaths(r);
      expect(text).toContain(
        "route POST /bookings → services/bookings/src/handlers/create-booking.ts#handler",
      );
      expect(text).toMatch(
        /putBooking {2}services\/bookings\/src\/store\/bookings-table\.ts:\d+\n\s+→ DynamoDB PutCommand/,
      );
      expect(text).toMatch(
        /announce {2}services\/bookings\/src\/events\/booking-requested\.ts:\d+\n\s+→ SQS SendMessageCommand/,
      );
    }
  });

  it("finds routes, consumers, commands, and CronJobs in TypeScript, Python, and Go", async () => {
    const flows = await findPaths(await ctxOf("order-flows"));
    expect(flows.entryPoints.map((e) => `${e.kind} ${e.label}`).sort()).toEqual([
      "consumer consumes fulfillment",
      "consumer consumes notifier",
      "route GET /:id",
      "route POST /",
      "schedule 0 2 * * * (nightly-sales-report)",
    ]);
    // An inline handler is its own function: POST / reaches placeOrder, not GET's findOrder.
    const post = flows.paths.find((p) => p.entry.label === "POST /");
    expect(post?.root?.children.map((c) => c.name)).toEqual(["placeOrder"]);
    // A Python consumer follows its calls into other modules.
    const ship = formatPaths({
      entryPoints: [],
      paths: flows.paths.filter((p) => p.entry.label === "consumes fulfillment"),
    });
    expect(ship).toMatch(
      /book_label {2}fulfillment\/fulfillment\/carrier\.py:\d+\n\s+→ HTTP httpx\.post\(\)/,
    );

    // A Go handler in another package: postings.Handler.
    const go = await findPaths(await ctxOf("go-service"), { entry: "/postings" });
    expect(go.paths[0]?.root?.name).toBe("Handler");
    expect(go.paths[0]?.root?.file).toBe("internal/postings/postings.go");

    const cli = await findPaths(await ctxOf("single-package"));
    expect(cli.entryPoints.map((e) => `${e.kind} ${e.label} ${e.symbol}`)).toEqual([
      "command check check",
      "command fix fix",
    ]);
    expect(cli.paths[0]?.root?.file).toBe("src/commands/check.ts");
  });
});

describe("archdoc paths in a big repository", () => {
  let dir: string;
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "archdoc-paths-big-"));
    const write = async (path: string, text: string) => {
      await mkdir(dirname(join(dir, path)), { recursive: true });
      await writeFile(join(dir, path), text);
    };
    await write("package.json", '{ "name": "big", "private": true }');
    for (const svc of ["orders", "billing", "users"]) {
      await write(`services/${svc}/package.json`, `{ "name": "${svc}" }`);
      for (const resource of ["items", "refunds"]) {
        const routes = Array.from(
          { length: 15 },
          (_, i) => `router.get("/api/v1/${resource}/:id/r${i}", (req) => save(req));`,
        );
        await write(
          `services/${svc}/src/routes/${resource}.ts`,
          `import { Router } from "express";\nimport { save } from "../store";\nconst router = Router();\n${routes.join("\n")}\n`,
        );
      }
      await write(
        `services/${svc}/src/store.ts`,
        'import pg from "pg";\nimport { audit } from "./audit";\nexport function save(x) {\n  audit(x);\n  return new pg.Pool().query("x");\n}\n',
      );
      await write(`services/${svc}/src/audit.ts`, "export function audit(x) {}\n");
    }
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it("summarizes many entry points by place and resource", async () => {
    const r = await pathsAnswer({ cwd: dir });
    expect(r.text).toMatch(/^90 entry points, where flows start, in 3 places/);
    expect(r.text).toContain("  services/orders  30 routes");
    expect(r.text).toContain("route    /items (15), /refunds (15)");
    // No trees, and a word that there's no model yet.
    expect(r.text).not.toContain("store.ts:");
    expect(r.text).toContain("run archdoc init (not --dry-run)");
  });

  it("lists a place's entry points, and a place and resource together", async () => {
    const r = await pathsAnswer({ cwd: dir }, { entry: "services/billing /refunds" });
    expect(r.text).toMatch(/^15 entry points, where flows start:/);
    expect(r.text).not.toContain("services/orders");
  });

  it("shows only the hops between elements", async () => {
    const full = await pathsAnswer({ cwd: dir }, { entry: "GET /api/v1/items/:id/r3 users" });
    const hops = await pathsAnswer(
      { cwd: dir },
      { entry: "GET /api/v1/items/:id/r3 users", hops: true },
    );
    expect(full.text).toContain("audit  services/users/src/audit.ts");
    // audit is in the same directory as save, so it folds into it, and so does what it reaches.
    expect(hops.text).not.toContain("audit  services/users/src/audit.ts");
    expect(hops.text).toContain("→ SQL");
  });

  it("names a route's resource", () => {
    const route = (label: string) => resourceOf({ kind: "route", label, file: "x.ts" });
    expect(route("GET /api/v1/orders/:id")).toBe("/orders");
    expect(route("POST /{tenant}/refunds")).toBe("/refunds");
    expect(route("/-/healthy")).toBe("/healthy");
    expect(route("GET /")).toBe("/");
    const e = [
      { kind: "route", label: "GET /a", file: "s/one/x.ts", place: "s/one" },
      { kind: "route", label: "GET /a", file: "s/one2/x.ts", place: "s/one2" },
    ];
    expect(matchEntries(e, "one /a").map((x) => x.place)).toEqual(["s/one"]);
  });
});

describe("infrastructure as code", () => {
  it("reads HCL blocks, labels, nested blocks, and attributes", () => {
    const [b] = parseHcl(
      'resource "aws_dynamodb_table" "t" {\n  name = "x" # a comment\n  attribute {\n    name = "id"\n    type = "S"\n  }\n  tags = { a = "b" }\n}\n',
    );
    expect(b?.labels).toEqual(["aws_dynamodb_table", "t"]);
    expect(b?.attrs.name).toBe('"x"');
    expect(b?.attrs.tags).toBe('{ a = "b" }');
    expect(b?.blocks[0]?.attrs.type).toBe('"S"');
  });

  it("reads the same stack from CDK and from Terraform", async () => {
    const summary = async (name: string) => {
      const [f] = await readIac(await ctxOf(name));
      return {
        tables: f?.tables.map(
          (t) => `${t.name} ${t.keys.map((k) => `${k.name}:${k.type}`).join(",")} [${t.indexes}]`,
        ),
        queues: f?.queues.map((q) => `${q.name} ${q.technology}`),
        handlers: f?.functions.map((x) => x.handler).sort(),
        triggers: f?.triggers
          .map((t) => `${t.kind} ${t.kind === "consumer" ? "queue" : t.label}`)
          .sort(),
        services: f?.services.map((s) => s.technology),
      };
    };
    const cdk = await summary("serverless-aws");
    expect(cdk).toEqual(await summary("serverless-aws-tf"));
    expect(cdk.tables).toEqual([
      "bookings bookingId:string [byCustomer]",
      "daily-reports date:string []",
    ]);
    expect(cdk.services).toEqual(["Amazon SES"]);
  });
});
