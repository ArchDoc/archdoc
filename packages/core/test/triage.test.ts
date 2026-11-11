import { describe, expect, it } from "vitest";
import {
  checkTrace,
  formatTrace,
  formatTraceList,
  loadTraces,
  parseTrace,
  recordsOn,
  tracesInChange,
  triageStatusOf,
} from "../src/index.js";
import { dedent, model } from "./helpers.js";

const shop = () =>
  model({
    "archdoc.yaml": `
      archdoc: "2.0"
      namespace: shop
      actors:
        shopper: { kind: person }
      elements:
        web: { kind: container, code: [apps/web/**], uses: { api: Places orders } }
        api:
          kind: container
          code: [services/api/**]
          uses: { db: Saves orders }
          elements:
            checkout: { kind: component, code: [services/api/checkout/**] }
        db: { kind: datastore }
      journeys:
        checkout:
          actor: shopper
          goal: Buy what's in the cart
          steps:
            - { from: shopper, to: web, action: Clicks pay }
            - { from: web, to: api, action: Places the order }
            - { from: api, to: db, action: Saves the order }
    `,
  });

const record = (yaml: string, file = ".archdoc/triage/t.yaml") => {
  const r = parseTrace(file, dedent(yaml));
  if (!r.trace) throw new Error(JSON.stringify(r.diagnostics));
  return r.trace;
};

const codes = (r: { findings: { code: string }[] }) => r.findings.map((f) => f.code);

describe("Triage records", () => {
  it("reads the report, leads, root cause, and fix", () => {
    const t = record(`
      triage: t
      title: Orders save twice
      status: fixed
      severity: high
      reported: { by: shopper, at: 2026-11-10, link: https://example.com/issues/1 }
      symptom: duplicate key
      expands: checkout#3
      hypotheses:
        - { claim: The db retries, element: db, verdict: ruled-out, evidence: read, note: No retries configured }
        - { claim: The api saves twice, element: api.checkout, verdict: confirmed, evidence: reproduced }
      steps:
        - { from: api, to: db, action: Saves, role: cause, evidence: reproduced }
      root-cause: { summary: The handler saves before and after payment. }
      fix: { summary: Save once, link: https://example.com/pull/2, test: services/api/checkout/pay.test.ts }
    `);
    const r = checkTrace(shop(), t);
    expect(r.findings).toEqual([]);
    expect(r.view).toMatchObject({
      status: "fixed",
      statusWritten: true,
      severity: "high",
      reported: { by: "shopper", at: "2026-11-10", link: "https://example.com/issues/1" },
      diagnosis: "The handler saves before and after payment.",
      fix: "Save once",
      fixDetail: {
        link: "https://example.com/pull/2",
        test: [{ path: "services/api/checkout/pay.test.ts" }],
      },
      causes: [1],
      legacy: false,
    });
    expect(r.view.hypotheses.map((h) => [h.verdict, h.element?.id])).toEqual([
      ["ruled-out", "db"],
      ["confirmed", "api.checkout"],
    ]);
    expect(r.view.elements).toEqual(["api", "api.checkout", "db"]);
    const text = formatTrace(r.view);
    expect(text).toContain("Status: fixed · severity high · reported by shopper · on 2026-11-10");
    expect(text).toContain("✗ ruled-out: The db retries  [read] · db");
    expect(text).toContain("Root cause (step 1): The handler saves before and after payment.");
    expect(text).toContain("  test: services/api/checkout/pay.test.ts");
  });

  it("works out the status when the record doesn't say", () => {
    const of = (extra: string) =>
      triageStatusOf(record(`triage: t\ntitle: x\nsymptom: x\n${extra}`).spec);
    expect(of("")).toBe("investigating");
    expect(of("steps: [{ from: api, to: db, role: cause }]")).toBe("root-caused");
    expect(of("fix: Save once")).toBe("fixed");
    expect(of("status: open")).toBe("open");
  });

  it("holds a record to what its status needs", () => {
    const m = shop();
    const check = (yaml: string) => codes(checkTrace(m, record(yaml)));
    expect(check("triage: t\ntitle: x\nsymptom: x\nstatus: open")).toEqual(["trace/no-anchor"]);
    expect(
      check("triage: t\ntitle: x\nsymptom: x\nstatus: investigating\nexpands: checkout#2"),
    ).toEqual(["triage/empty"]);
    expect(
      check(
        "triage: t\ntitle: x\nsymptom: x\nstatus: root-caused\nexpands: checkout#2\nsteps: [{ from: web, to: api, evidence: read }]",
      ),
    ).toEqual(["trace/no-cause", "triage/no-root-cause"]);
    expect(
      check(
        "triage: t\ntitle: x\nsymptom: x\nstatus: fixed\nexpands: checkout#2\nsteps: [{ from: web, to: api, evidence: read }]\nroot-cause: { summary: y, step: 1 }",
      ),
    ).toEqual(["triage/no-fix"]);
    expect(
      check(
        "triage: t\ntitle: x\nsymptom: x\nstatus: root-caused\nexpands: checkout#2\nsteps: [{ from: web, to: api, evidence: read }]\nroot-cause: { summary: y, step: 4 }",
      ),
    ).toEqual(["triage/unknown-step", "trace/no-cause"]);
    expect(check("triage: t\ntitle: x\nsymptom: x\nstatus: wont-fix\nexpands: checkout#2")).toEqual(
      ["triage/no-reason"],
    );
  });

  it("reports a closed record's stale code as info", () => {
    const yaml = (status: string) =>
      `triage: t\ntitle: x\nsymptom: x\nstatus: ${status}\nexpands: checkout#2\nroot-cause: { summary: y }\nfix: z\nsteps: [{ from: web, to: api, role: cause, evidence: read, code: services/api/gone.ts }]`;
    const files = { files: ["services/api/checkout/pay.ts"] };
    const fixed = checkTrace(shop(), record(yaml("fixed")), files);
    expect(fixed.findings.map((f) => [f.code, f.severity])).toEqual([["trace/stale-code", "info"]]);
    const open = checkTrace(shop(), record(yaml("root-caused")), files);
    expect(open.findings.map((f) => [f.code, f.severity])).toEqual([
      ["trace/stale-code", "warning"],
    ]);
  });

  it("reads a trace from before 0.8, and says to migrate it", () => {
    const t = record(
      "trace: t\ntitle: x\nsymptom: x\nexpands: checkout#2\nsteps: [{ from: web, to: api, role: cause, evidence: read }]",
      ".archdoc/traces/t.yaml",
    );
    expect(t.id).toBe("t");
    expect(t.legacy).toBe(true);
    expect(codes(checkTrace(shop(), t))).toEqual(["triage/legacy-trace"]);
  });

  it("lists records open first, and finds the open ones on an element", () => {
    const { traces } = loadTraces([
      {
        path: ".archdoc/triage/a.yaml",
        text: "triage: a\ntitle: A\nsymptom: s\nstatus: fixed\nfix: f\nsteps: [{ from: api, to: db, role: cause }]\n",
      },
      {
        path: ".archdoc/triage/b.yaml",
        text: "triage: b\ntitle: B\nsymptom: s\nseverity: high\nhypotheses: [{ claim: c, element: api.checkout }]\n",
      },
    ]);
    expect(formatTraceList(traces).split("\n")).toEqual([
      "b · investigating (high) · B (.archdoc/triage/b.yaml)",
      "a · fixed · A (.archdoc/triage/a.yaml)",
    ]);
    const checks = traces.map((t) => checkTrace(shop(), t));
    expect(recordsOn(checks, ["api"]).map((c) => c.trace.id)).toEqual(["b"]);
    expect(recordsOn(checks, ["db"], { closed: true }).map((c) => c.trace.id)).toEqual(["a"]);
    expect(recordsOn(checks, ["web"])).toEqual([]);
    expect(tracesInChange([".archdoc/triage/a.yaml"], traces)[0]?.status).toBe("fixed");
  });
});
