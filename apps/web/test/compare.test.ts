import { buildModel, check, deriveCodeChange, type Model } from "@archdoc/core/browser";
import { describe, expect, it } from "vitest";
import { type ChangeFindings, compareCode } from "../src/model/compare.js";

const load = (text: string): Model => buildModel([{ path: "archdoc.yaml", text }]);

// Branch 1's model: what the code change is read into.
const model = load(`
archdoc: "2.0"
namespace: shop
actors:
  buyer: { kind: person, uses: { web: Shops } }
elements:
  web: { kind: container, code: apps/web/**, uses: { api: Calls } }
  api: { kind: container, code: services/api/**, uses: { fraud: Scores } }
  fraud: { kind: container, code: services/fraud/** }
  receipts:
    kind: container
    code: services/receipts/**
    uses: { api: Reads }
    provenance: { source: suggested, by: "agent:claude" }
journeys:
  checkout:
    actor: buyer
    goal: Buy something
    importance: critical
    steps: [{ from: buyer, to: web }, { from: web, to: api }, { from: api, to: fraud }]
rules:
  - id: web-never-scores
    deny: { from: web, to: fraud }
`);

const baseFiles = ["apps/web/app.ts", "services/api/index.ts", "services/fraud/index.ts"];
const headFiles = [
  ...baseFiles,
  "apps/web/score.ts",
  "services/receipts/index.ts",
  "tools/x/sync.ts",
];
const observed = [
  { from: "apps/web/app.ts", to: "services/api", analyzer: "ts-imports" },
  { from: "apps/web/score.ts", to: "services/fraud", analyzer: "ts-imports", line: 1 },
  { from: "services/receipts/index.ts", to: "services/api", analyzer: "ts-imports" },
];
const changedFiles = ["apps/web/score.ts", "services/receipts/index.ts", "tools/x/sync.ts"];
const change: ChangeFindings = {
  base: "main",
  head: "feature",
  commit: "abc123",
  changedFiles,
  findings: check(model, { observed, files: headFiles }).findings.map((f) => ({
    ...f,
    introduced: true,
  })),
  code: deriveCodeChange({
    model,
    base: { files: baseFiles, observed: observed.slice(0, 1) },
    head: {
      files: headFiles,
      observed,
      entries: [{ kind: "route", label: "POST /score", file: "apps/web/score.ts" }],
    },
    changed: changedFiles,
  }),
};

describe("compareCode", () => {
  const c = compareCode(model, change);

  it("reads the branch's code change into its own model", () => {
    expect(c).toMatchObject({ ref: "main", head: "feature" });
    expect(c.base).toBe(model);
    // New code no element maps is drawn as the element it would be.
    expect(c.after.elements.get("tools")?.spec).toMatchObject({ kind: "container" });
    expect(c.groups.elements.map((i) => `${i.kind} ${i.label}`)).toEqual([
      "added receipts",
      "added tools",
      "changed web",
      "added receipts → api",
      "added web → fraud",
    ]);
    expect(c.groups.elements[2]).toMatchObject({ detail: "1 file added" });
  });

  it("lists what the code says that the model doesn't", () => {
    expect(c.groups.unmodeled.map((i) => `${i.label} · ${i.hint}`)).toEqual([
      "tools · new container",
      "web → fraud · use not in the model",
    ]);
  });

  it("puts broken rules first, and lists entry points with their journeys", () => {
    expect(c.groups.breaks[0]).toMatchObject({ kind: "error", hint: "rule web-never-scores" });
    expect(c.groups.entries).toEqual([
      expect.objectContaining({ label: "route POST /score", detail: "through checkout" }),
    ]);
    expect(c.journeys.has("checkout")).toBe(true);
    // An agent's suggestion is still one to review; what the code proposes isn't.
    expect(c.groups.suggested.map((i) => i.key)).toEqual(["element:receipts"]);
  });

  it("shows nothing when no code changed", () => {
    const same = compareCode(model, {
      ...change,
      changedFiles: [],
      findings: [],
      code: deriveCodeChange({
        model,
        base: { files: baseFiles, observed: [] },
        head: { files: baseFiles, observed: [] },
        changed: [],
      }),
    });
    expect(same.count).toBe(0);
    expect(same.groups.unmodeled).toEqual([]);
    expect(same.after.elements.size).toBe(model.elements.size);
  });
});
