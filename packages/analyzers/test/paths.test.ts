import { fileURLToPath } from "node:url";
import { listRepoFiles } from "@archdoc/core";
import { describe, expect, it } from "vitest";
import { contextFor, findPaths, formatPaths, parseHcl, readIac } from "../src/index.js";

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
