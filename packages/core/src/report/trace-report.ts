import { type Diagnostic, formatDiagnostic } from "../diagnostics.js";
import type { AnchorResult } from "../trace/anchor.js";
import type { TraceCheck, TraceStepView, TraceView } from "../trace/check.js";
import type { TraceEnd } from "../trace/hops.js";
import { type Trace, triageStatusOf } from "../trace/trace.js";

// Triage records as text, shared by `archdoc triage`, `archdoc show`, and the MCP tools.

const ICON = { error: "✗", warning: "!", info: "i" } as const;

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function endLabel(e: TraceEnd): string {
  return e.id ?? e.written;
}

/** The result of checking traces: each trace with its findings, then the totals. */
export function formatTraceChecks(
  checks: readonly TraceCheck[],
  problems: readonly Diagnostic[] = [],
): string {
  const out: string[] = [];
  for (const d of problems) out.push(`${ICON[d.severity]} ${formatDiagnostic(d)}`);
  if (problems.length) out.push("");
  if (checks.length === 0 && problems.length === 0) {
    return "No Triage records. Start one with archdoc triage start (or the archdoc_triage tool) when you explain or fix a bug.";
  }
  for (const c of checks) {
    const v = c.view;
    const worst = c.findings.some((f) => f.severity === "error")
      ? "✗"
      : c.findings.some((f) => f.severity === "warning")
        ? "!"
        : "✓";
    out.push(`${worst} ${v.id} · ${v.title}`);
    out.push(`    ${summaryLine(v)}`);
    for (const f of c.findings) out.push(`    ${ICON[f.severity]} ${formatDiagnostic(f)}`);
  }
  const all = [...problems, ...checks.flatMap((c) => c.findings)];
  const errors = all.filter((f) => f.severity === "error").length;
  const warnings = all.filter((f) => f.severity === "warning").length;
  out.push(
    "",
    `${plural(checks.length, "Triage record")}: ${plural(errors, "error")}, ${plural(warnings, "warning")}.`,
  );
  return out.join("\n");
}

function summaryLine(v: TraceView): string {
  const parts: string[] = [v.status];
  const a = v.anchor;
  if (a?.modeled) {
    parts.push(`expands ${a.written} (${endLabel(a.modeled.from)} → ${endLabel(a.modeled.to)})`);
  } else if (a) {
    parts.push(`expands ${a.written}`);
  } else if (v.actor) {
    parts.push(`${endLabel(v.actor)}${v.goal ? `: ${v.goal}` : ""}`);
  }
  parts.push(plural(v.steps.length, "step"));
  if (v.causes.length) parts.push(`cause at step ${v.causes.join(", ")}`);
  if (v.undeclared.length)
    parts.push(`${plural(v.undeclared.length, "hop")} the model doesn't declare`);
  return parts.join(" · ");
}

const VERDICT = { open: "?", "ruled-out": "✗", confirmed: "✓" } as const;

/**
 * A Triage record to read: the report, the journey step it showed up in, the
 * leads followed, every hop with its evidence, the root cause, and the fix.
 */
export function formatTrace(v: TraceView): string {
  const out = [`${v.id}: ${v.title}`];
  out.push(
    [
      `Status: ${v.status}${v.statusWritten ? "" : " (from what the record holds)"}`,
      v.severity ? `severity ${v.severity}` : undefined,
      v.reported?.by ? `reported by ${v.reported.by}` : undefined,
      v.reported?.at ? `on ${v.reported.at}` : undefined,
    ]
      .filter(Boolean)
      .join(" · "),
  );
  if (v.reported?.link) out.push(`Report: ${v.reported.link}`);
  const a = v.anchor;
  if (a?.modeled) {
    out.push(
      `Opens up ${a.journey} step ${a.step}${a.importance ? ` (${a.importance})` : ""}: ${endLabel(a.modeled.from)} → ${endLabel(a.modeled.to)}${a.modeled.action ? `: ${a.modeled.action}` : ""}`,
    );
    if (a.goal) out.push(`  Journey: ${a.actor ? `${a.actor}: ` : ""}${a.goal}`);
  } else if (a) {
    out.push(`Opens up ${a.written} (${a.status.replace("-", " ")})`);
  } else if (v.actor) {
    out.push(`Actor: ${endLabel(v.actor)}${v.goal ? ` · ${v.goal}` : ""}`);
  }
  out.push(
    "",
    "Symptom:",
    ...v.symptom
      .trimEnd()
      .split("\n")
      .map((l) => `  ${l}`),
  );
  if (v.attachments.length) out.push(`Attached: ${v.attachments.join(", ")}`);
  if (v.reproduce) out.push(`Reproduce: ${v.reproduce.trim()}`);
  if (v.hypotheses.length) {
    out.push("", "Leads:");
    for (const h of v.hypotheses) {
      const code = h.code.map((c) => c.label).join(", ");
      out.push(
        `  ${VERDICT[h.verdict]} ${h.verdict}: ${h.claim}${h.evidence ? `  [${h.evidence}]` : ""}${h.element ? ` · ${endLabel(h.element)}` : ""}${code ? ` · ${code}` : ""}`,
      );
      if (h.note) out.push(`     ${h.note.trim()}`);
    }
  }
  if (v.steps.length) {
    out.push("", "What happened:");
    for (const s of v.steps) out.push(...formatStep(s));
  } else {
    out.push("", "No steps yet.");
  }
  if (v.diagnosis)
    out.push(
      "",
      `Root cause${v.causes.length ? ` (step ${v.causes.join(", ")})` : ""}: ${v.diagnosis.trim()}`,
    );
  if (v.worksIn) {
    const code = v.worksIn.code.map((c) => c.label).join(", ");
    out.push(
      "",
      `Works in: ${endLabel(v.worksIn.element)}${code ? ` (${code})` : ""}${v.worksIn.note ? `: ${v.worksIn.note.trim()}` : ""}`,
    );
  }
  if (v.fixDetail) {
    out.push("", `Fix: ${v.fixDetail.summary.trim()}`);
    if (v.fixDetail.link) out.push(`  ${v.fixDetail.link}`);
    for (const t of v.fixDetail.test) out.push(`  test: ${t.label}`);
  }
  return out.join("\n");
}

const ROLE = {
  ok: "",
  cause: "✗ cause  ",
  spreads: "→ spreads  ",
  symptom: "! symptom  ",
} as const;

function formatStep(s: TraceStepView): string[] {
  const hop =
    s.hop.kind === "undeclared"
      ? " (the model doesn't declare this)"
      : s.hop.kind === "returns" && s.hop.relationship
        ? ` (answers ${s.hop.relationship.from} → ${s.hop.relationship.to})`
        : s.hop.kind === "unverified"
          ? " (in a repo that isn't synced)"
          : s.hop.kind === "unknown"
            ? " (not in the model)"
            : "";
  const outside = s.within === false ? " (outside the journey step)" : "";
  const out = [
    `  ${s.step}. ${ROLE[s.role]}${endLabel(s.from)} → ${endLabel(s.to)}${s.action ? `: ${s.action}` : ""}  [${s.evidence}]${hop}${outside}`,
  ];
  if (s.description) out.push(`     ${s.description.trim()}`);
  const carries = [
    ...[s.spec.sends ?? []].flat().map((d) => `sends ${d}`),
    ...[
      s.spec.creates === undefined
        ? []
        : typeof s.spec.creates === "string" || Array.isArray(s.spec.creates)
          ? [s.spec.creates].flat()
          : Object.keys(s.spec.creates),
    ]
      .flat()
      .map((d) => `creates ${d}`),
    ...Object.entries(s.spec.changes ?? {}).map(([k, v]) => `changes ${k}: ${String(v)}`),
  ];
  if (carries.length) out.push(`     ${carries.join("; ")}`);
  for (const c of s.code) {
    out.push(
      `     code: ${c.label}${c.exists === false ? " (not in the repository)" : c.problem ? ` (${c.problem})` : ""}`,
    );
  }
  const keys = [...new Set([...Object.keys(s.observed ?? {}), ...Object.keys(s.expected ?? {})])];
  for (const k of keys) {
    const has = (m: Record<string, unknown> | undefined) => m !== undefined && k in m;
    const observed = has(s.observed) ? show(s.observed?.[k]) : undefined;
    const expected = has(s.expected) ? show(s.expected?.[k]) : undefined;
    out.push(
      `     ${k}: ${observed ?? "?"}${expected !== undefined ? `, expected ${expected}` : ""}`,
    );
  }
  if (s.missing) {
    out.push(
      `     missing: ${endLabel(s.missing.from)} → ${endLabel(s.missing.to)}${s.missing.call ? ` (${s.missing.call})` : ""}, never called${s.missing.description ? `: ${s.missing.description.trim()}` : ""}`,
    );
  }
  return out;
}

function show(v: unknown): string {
  return typeof v === "string" ? v : JSON.stringify(v);
}

/** The Triage records in a repository, one line each, open ones first. */
export function formatTraceList(traces: readonly Trace[]): string {
  if (traces.length === 0) return "No Triage records in .archdoc/triage/.";
  const rank = (t: Trace) => STATUS_ORDER.indexOf(triageStatusOf(t.spec));
  return [...traces]
    .sort((a, b) => rank(a) - rank(b))
    .map(
      (t) =>
        `${t.id} · ${triageStatusOf(t.spec)}${t.spec.severity ? ` (${t.spec.severity})` : ""} · ${t.spec.title}${t.spec.expands ? ` · ${t.spec.expands}` : ""} (${t.file})`,
    )
    .join("\n");
}

/** Statuses in the order people work them: what needs looking at first. */
export const STATUS_ORDER = [
  "investigating",
  "open",
  "root-caused",
  "fixed",
  "wont-fix",
  "cannot-reproduce",
] as const;

/** Where an error belongs: the ranked journey steps, the elements, and a trace to start from. */
export function formatAnchors(r: AnchorResult, skeleton?: string, maxReasons = 3): string {
  const out: string[] = [];
  if (r.anchors.length === 0) {
    out.push(
      r.elements.length
        ? "No journey step goes through what the error names."
        : "Nothing in the error maps to the model: no paths or names it knows. Paste the stack trace, or name the files.",
    );
  } else {
    out.push("Where this error belongs, best first:");
    for (const [i, a] of r.anchors.entries()) {
      out.push(
        `  ${i + 1}. ${a.journey}#${a.step} (${a.importance}) · ${a.from} → ${a.to}${a.action ? `: ${a.action}` : ""}`,
      );
      const reasons = [...new Set(a.reasons)];
      for (const reason of reasons.slice(0, maxReasons)) out.push(`     ${reason}`);
      if (reasons.length > maxReasons) out.push(`     … and ${reasons.length - maxReasons} more`);
    }
  }
  if (r.elements.length) {
    out.push("", "Elements in the error:");
    for (const e of r.elements) {
      out.push(
        `  ${e.element} · ${e.evidence.slice(0, 2).join("; ")}${e.evidence.length > 2 ? `; and ${e.evidence.length - 2} more` : ""}`,
      );
    }
  }
  if (r.unmapped.length) out.push("", `Not mapped to an element: ${r.unmapped.join(", ")}`);
  if (skeleton) {
    out.push(
      "",
      "Follow the code from there, then write the Triage record. A start:",
      "",
      skeleton.trimEnd(),
    );
  }
  return out.join("\n");
}
