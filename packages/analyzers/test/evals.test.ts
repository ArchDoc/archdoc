import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildModel, formatScore, listRepoFiles, type ModelScore, scoreModel } from "@archdoc/core";
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
// files. It misses components that are one file (python-fastapi's db.py,
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
  polyglot: {
    overall: 0.86,
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
  "ts-monorepo": {
    overall: 0.91,
    containers: 1,
    components: 1,
    datastores: 1,
    uses: 0.81,
    nesting: 1,
    code: 0.93,
  },
};

async function scoreInit(name: string): Promise<ModelScore> {
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
  const files = (await listRepoFiles(repo)).filter((f) => SOURCE.test(f));
  return scoreModel(found, golden, files);
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
      const s = await scoreInit(name);
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
});
