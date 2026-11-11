import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { archdocJsonSchema, TraceFileSchema, TriageFileSchema } from "../src/index.js";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("TriageFileSchema", () => {
  it("accepts the Triage records in this repo and the demo org", () => {
    for (const path of [
      "../../../.archdoc/triage/report-false-data-changes.yaml",
      "../../../examples/org/rides/.archdoc/triage/small-refund-waits-for-finance.yaml",
    ]) {
      const result = TriageFileSchema.safeParse(parse(read(path)));
      expect(result.error?.issues ?? []).toEqual([]);
    }
  });

  it("takes journey step syntax, plus what went wrong", () => {
    const result = TraceFileSchema.safeParse({
      trace: "slow-refund",
      title: "Refunds hang",
      symptom: "timeout after 30s",
      expands: "payments.refund#2",
      steps: [
        {
          from: "api",
          to: "payments.charges",
          sends: "RefundRequest",
          code: [{ path: "src/a.ts", lines: "10-20" }, "src/b.ts:3"],
          role: "cause",
          evidence: "reproduced",
          observed: { "Refund.status": null },
          expected: { "Refund.status": "approved" },
          missing: { to: "ledger", call: "post" },
        },
      ],
      "works-in": { element: "web", code: "web/x.ts:4", note: "retries" },
      provenance: { source: "suggested", by: "agent:claude-code" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects unknown roles and evidence, a bad expands, and unknown fields", () => {
    const result = TraceFileSchema.safeParse({
      trace: "t",
      title: "x",
      symptom: "x",
      expands: "book-a-ride",
      steps: [{ from: "a", to: "b", role: "culprit", evidence: "guessed", colour: "red" }],
    });
    expect(result.error?.issues.map((i) => i.path.join("/")).sort()).toEqual([
      "expands",
      "steps/0",
      "steps/0/evidence",
      "steps/0/role",
    ]);
    // A record can be started before any step is known.
    expect(TriageFileSchema.safeParse({ triage: "t", title: "x", symptom: "x" }).success).toBe(
      true,
    );
    expect(
      TriageFileSchema.safeParse({ triage: "t", title: "x", symptom: "x", status: "done" }).success,
    ).toBe(false);
  });

  it("takes the report, leads, root cause, and fix", () => {
    const result = TriageFileSchema.safeParse({
      triage: "t",
      title: "x",
      status: "fixed",
      severity: "critical",
      reported: { by: "support", at: "2026-11-10", link: "https://example.com/1" },
      symptom: "x",
      attachments: ["attachments/t.log"],
      hypotheses: [
        { claim: "a", verdict: "ruled-out", evidence: "read", note: "n", element: "api" },
        { claim: "b", code: "src/a.ts:3" },
      ],
      steps: [{ from: "a", to: "b", role: "cause" }],
      "root-cause": { summary: "why", step: 1 },
      fix: { summary: "how", link: "https://example.com/2", test: "src/a.test.ts" },
    });
    expect(result.error?.issues ?? []).toEqual([]);
  });

  it("is in the JSON Schema, so editors check Triage records and old traces too", () => {
    const schema = archdocJsonSchema() as { anyOf: { required?: string[] }[] };
    expect(schema.anyOf.some((s) => s.required?.includes("triage"))).toBe(true);
    expect(schema.anyOf.some((s) => s.required?.includes("trace"))).toBe(true);
  });
});
