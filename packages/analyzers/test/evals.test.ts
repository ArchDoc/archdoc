import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assessDiscovery,
  buildModel,
  formatDiscoveryScore,
  formatScore,
  listRepoFiles,
  type ModelScore,
  scoreDiscovery,
  scoreModel,
} from "@archdoc/core";
import { describe, expect, it } from "vitest";
import { inferModel } from "../src/index.js";

// The init half of the evals in evals/: archdoc init on each fixture repo,
// scored against the model a person wrote for it (golden.yaml). The floors
// are what init scores today, so a change that makes it find less fails
// here; raise them when it finds more. The agent half, which scores the
// model an agent finishes from this one, is scripts/eval-agent.mjs.

const fixtures = fileURLToPath(new URL("../../../evals/fixtures/", import.meta.url));
const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs|go|py|rs|java|kt|rb|sql)$/;

interface Floor {
  overall: number;
  containers: number;
  components: number;
  datastores: number;
  uses: number;
  nesting: number;
  code: number;
}

// Measured: init finds every container and datastore, splits containers into
// components by their code directories, and sees uses in imports and compose
// files, and keeps a container with fewer than five source files lean, with
// no components. It misses components that are one file (python-fastapi's db.py,
// single-package's cli.ts and config.ts), python-fastapi's services/, and
// uses that compose puts on a container when the golden model has them on a
// component. What it misses is what the agent is there to add.
const floors: Record<string, Floor> = {
  "go-service": {
    overall: 0.87,
    containers: 1,
    components: 1,
    datastores: 1,
    uses: 0.3,
    nesting: 1,
    code: 0.9,
  },
  // A Go server whose packages sit beside cmd/pulse, a CLI that borrows a few of
  // them, and a web UI that's a pnpm workspace below the top. Init makes the
  // module and the binary named after it one container, and the workspace one
  // container with its packages as components.
  "go-server-ui": {
    overall: 0.93,
    containers: 1,
    components: 1,
    datastores: 1,
    uses: 0.57,
    nesting: 1,
    code: 1,
  },
  polyglot: {
    overall: 0.93,
    containers: 1,
    components: 1,
    datastores: 1,
    uses: 0.71,
    nesting: 1,
    code: 0.92,
  },
  "python-fastapi": {
    overall: 0.82,
    containers: 1,
    components: 0.5,
    datastores: 1,
    uses: 0.2,
    nesting: 1,
    code: 0.92,
  },
  "single-package": {
    overall: 0.91,
    containers: 1,
    components: 0.66,
    datastores: 1,
    uses: 0.62,
    nesting: 1,
    code: 1,
  },
  // Services that reach each other over HTTP and RabbitMQ, which imports
  // don't show, plus tests, mocks, smoke checks, and a load test that init
  // leaves out. Init finds the services; the uses between them are the agent's.
  "order-flows": {
    overall: 0.89,
    containers: 1,
    components: 1,
    datastores: 1,
    uses: 0.3,
    nesting: 1,
    code: 0.96,
  },
  // Lambdas behind API Gateway, DynamoDB tables, an SQS queue, and a schedule, all
  // wired in a CDK app or in Terraform, which imports don't show. Init reads the
  // IaC: the tables with their keys, the queue, SES, which component calls each,
  // the environments, and the routes, consumer, and schedule as entry points.
  "serverless-aws": {
    overall: 0.97,
    containers: 1,
    components: 1,
    datastores: 1,
    uses: 0.9,
    nesting: 1,
    code: 1,
  },
  "serverless-aws-tf": {
    overall: 0.97,
    containers: 1,
    components: 1,
    datastores: 1,
    uses: 0.9,
    nesting: 1,
    code: 1,
  },
  "ts-monorepo": {
    overall: 0.95,
    containers: 1,
    components: 1,
    datastores: 1,
    uses: 0.81,
    nesting: 1,
    code: 0.93,
  },
};

async function scoreInit(name: string) {
  const dir = join(fixtures, name);
  const golden = buildModel(
    [{ path: "golden.yaml", text: readFileSync(join(dir, "golden.yaml"), "utf8") }],
    { root: "golden.yaml" },
  );
  expect(golden.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  const repo = join(dir, "repo");
  const r = await inferModel(repo);
  expect(r.problems).toEqual([]);
  const found = buildModel(r.files, { root: ".archdoc/archdoc.yaml" });
  const all = await listRepoFiles(repo);
  const files = all.filter((f) => SOURCE.test(f));
  const score: ModelScore = scoreModel(found, golden, files);
  return {
    score,
    discovery: scoreDiscovery(found, golden, all, score, { entryPoints: r.entryPoints }),
    entryPoints: r.entryPoints,
    golden: scoreDiscovery(golden, golden, all, scoreModel(golden, golden, files)),
    done: assessDiscovery(found, all, { entryPoints: r.entryPoints }),
  };
}

describe("evals: archdoc init on the fixture repos", () => {
  it("has a floor for every fixture", () => {
    const names = readdirSync(fixtures, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    expect(names).toEqual(Object.keys(floors).sort());
  });

  for (const [name, floor] of Object.entries(floors)) {
    it(name, async () => {
      const { score: s } = await scoreInit(name);
      const got = {
        overall: s.overall,
        containers: s.containers.recall,
        components: s.components.recall,
        datastores: s.datastores.recall,
        uses: s.relationships.recall,
        nesting: s.nesting.ratio,
        code: s.code.accuracy,
      };
      for (const [k, min] of Object.entries(floor)) {
        expect(got[k as keyof Floor], `${k}\n${formatScore(s, true)}`).toBeGreaterThanOrEqual(min);
      }
      expect(s.errors).toBe(0);
      // Containers come from manifests, so every one init writes should be real.
      expect(s.containers.precision).toBe(1);
    });
  }

  // What the agent is there to add, and what scoreDiscovery measures it by.
  for (const name of Object.keys(floors)) {
    it(`${name}: discovery`, async () => {
      const { discovery, golden, done } = await scoreInit(name);
      const shown = `\n${formatDiscoveryScore(discovery, true)}`;
      // Init leaves test and verification code out, writes no journeys, and puts
      // everything in a system.
      expect(done.stats.testElements, shown).toEqual([]);
      expect(discovery.testExclusion, shown).toBe(1);
      expect(discovery.journeys.found, shown).toBe(0);
      expect(discovery.system, shown).toBe(1);
      expect(done.gaps.map((g) => g.code)).toEqual(
        expect.arrayContaining(["done/few-journeys", "done/undescribed"]),
      );
      // The golden model follows every journey it has, with detailed steps.
      expect(golden.journeys.expected, formatDiscoveryScore(golden)).toBeGreaterThanOrEqual(2);
      expect(golden.journeys.recall, formatDiscoveryScore(golden, true)).toBe(1);
      expect(golden.stepDetail, formatDiscoveryScore(golden)).toBe(1);
      expect(golden.overall).toBeGreaterThan(discovery.overall);
    });
  }

  // Infrastructure as code says what imports can't: where it runs, what each table keeps,
  // and where each flow starts.
  for (const name of ["serverless-aws", "serverless-aws-tf"]) {
    it(`${name}: reads the infrastructure as code`, async () => {
      const { done, entryPoints } = await scoreInit(name);
      expect(entryPoints.map((e) => `${e.kind} ${e.label} ${e.file}`).sort()).toEqual([
        "consumer consumes booking-requested services/confirmations/src/confirm-booking.ts",
        "route GET /bookings services/bookings/src/handlers/list-bookings.ts",
        "route GET /bookings/{bookingId} services/bookings/src/handlers/get-booking.ts",
        "route POST /bookings services/bookings/src/handlers/create-booking.ts",
        "schedule cron(0 2 * * ? *) services/reports/src/nightly-report.ts",
      ]);
      // The tables say what they store; the queue waits for the agent to name its message.
      expect(done.stats.storesDescribed).toBe(2);
      expect(done.stats.stores).toBe(3);
      // Everything but the web app, which the IaC doesn't tie to its bucket, says where it runs.
      expect(done.stats.deployed).toBe(done.stats.deployable - 1);
      expect(done.gaps.map((g) => g.code)).toContain("done/uncovered-entry-points");
      expect(done.gaps.map((g) => g.code)).not.toContain("done/no-environments");
      expect(done.gaps.map((g) => g.code)).not.toContain("done/no-system");
    });
  }
});
