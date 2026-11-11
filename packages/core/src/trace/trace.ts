import {
  type FixSpec,
  type TraceCodeSpec,
  TraceFileSchema,
  type TraceStepSpec,
  type TriageFile,
  TriageFileSchema,
  type TriageStatus,
} from "@archdoc/spec";
import type { Diagnostic, SourceLocation } from "../diagnostics.js";
import { schemaDiagnostics } from "../load/build.js";
import { parseYaml, type YamlPath } from "../load/yaml.js";

/**
 * A Triage record as written, without the editor fields, keyed `triage:`
 * whichever way the file is (a trace from before 0.8 is keyed `trace:`), and
 * with its steps, which may be none yet.
 */
export type TraceSpec = Omit<TriageFile, "$schema" | "archdoc" | "steps"> & {
  steps: TraceStepSpec[];
};

/** A Triage record's spec under its 0.8 name. */
export type TriageSpec = TraceSpec;

/**
 * A Triage record: a bug, the leads followed, and the path the failing
 * request took, read from `.archdoc/triage/<id>.yaml` (or, before 0.8,
 * `.archdoc/traces/`). Never part of the model. Core calls it a trace, the
 * name the walk-through had before Triage.
 */
export interface Trace {
  id: string;
  /** The file it was read from, as given to {@link parseTrace}. */
  file: string;
  spec: TraceSpec;
  /** Written the pre-0.8 way: keyed `trace:`, or in `.archdoc/traces/`. */
  legacy?: boolean | undefined;
  /** Where things are written, by dotted path such as `expands` or `steps.1.from`. */
  locations: Record<string, SourceLocation>;
}

export interface ParsedTraces {
  traces: Trace[];
  /** YAML and schema problems, and duplicate IDs. */
  diagnostics: Diagnostic[];
}

/** One code reference in a trace, with `path:line` read apart. */
export interface TraceCodeRef {
  path: string;
  /** One line or a range, as written (`42` or `40-88`). */
  lines?: string | undefined;
  symbol?: string | undefined;
  description?: string | undefined;
}

/** Parses one trace file. Returns no trace when the YAML or the schema doesn't hold. */
export function parseTrace(
  file: string,
  text: string,
): { trace?: Trace | undefined; diagnostics: Diagnostic[] } {
  const { parsed, diagnostics } = parseYaml(file, text);
  if (!parsed) return { diagnostics };
  if (parsed.value === null || typeof parsed.value !== "object") {
    return {
      diagnostics: [
        ...diagnostics,
        {
          severity: "error",
          code: "trace/not-a-trace",
          message: 'A Triage record needs "triage", "title", and "symptom".',
          location: { file, line: 1, column: 1 },
        },
      ],
    };
  }
  const keyedTrace = "trace" in parsed.value && !("triage" in parsed.value);
  const result = keyedTrace
    ? TraceFileSchema.safeParse(parsed.value)
    : TriageFileSchema.safeParse(parsed.value);
  if (!result.success) {
    return { diagnostics: [...diagnostics, ...schemaDiagnostics(result.error, parsed)] };
  }
  const data = result.data as Record<string, unknown>;
  const { $schema: _s, archdoc: _a, trace: oldId, triage: newId, steps, ...rest } = data;
  const spec = {
    triage: (newId ?? oldId) as string,
    ...(rest as Omit<TraceSpec, "triage" | "steps">),
    steps: (steps as TraceStepSpec[] | undefined) ?? [],
  } as TraceSpec;
  const locations: Record<string, SourceLocation> = {};
  const at = (path: YamlPath) => {
    locations[path.join(".")] = parsed.locate(path);
  };
  const idKey = keyedTrace ? "trace" : "triage";
  locations.trace = parsed.locate([idKey]);
  locations.triage = locations.trace;
  for (const key of [
    "status",
    "expands",
    "actor",
    "root-cause",
    "root-cause.step",
    "fix",
    "reported.by",
    "attachments",
    "works-in",
    "works-in.element",
    "works-in.code",
  ])
    at(key.split("."));
  for (const [i, h] of (spec.hypotheses ?? []).entries()) {
    at(["hypotheses", i]);
    if (h.element) at(["hypotheses", i, "element"]);
    if (h.code !== undefined) at(["hypotheses", i, "code"]);
  }
  for (const [i, step] of spec.steps.entries()) {
    at(["steps", i]);
    for (const key of ["from", "to", "code"] as const)
      if (step[key] !== undefined) at(["steps", i, key]);
    if (step.missing) at(["steps", i, "missing", "to"]);
  }
  const legacy = keyedTrace || /(^|[\\/])traces[\\/]/.test(file);
  return { trace: { id: spec.triage, file, spec, locations, legacy }, diagnostics };
}

/** Parses trace files (the CLI reads them), and reports two traces with the same ID. */
export function loadTraces(sources: readonly { path: string; text: string }[]): ParsedTraces {
  const traces: Trace[] = [];
  const diagnostics: Diagnostic[] = [];
  const seen = new Map<string, Trace>();
  for (const source of sources) {
    const r = parseTrace(source.path, source.text);
    diagnostics.push(...r.diagnostics);
    if (!r.trace) continue;
    const before = seen.get(r.trace.id);
    if (before) {
      diagnostics.push({
        severity: "error",
        code: "trace/duplicate",
        message: `Triage record "${r.trace.id}" is also in ${before.file}.`,
        location: r.trace.locations.trace,
      });
      continue;
    }
    seen.set(r.trace.id, r.trace);
    traces.push(r.trace);
  }
  return { traces, diagnostics };
}

/** A trace's `expands`, read apart: the journey (maybe namespaced) and the 1-based step. */
export function parseExpands(expands: string): { journey: string; step: number } | undefined {
  const m = /^(.+)#(\d+)$/.exec(expands);
  if (!m) return undefined;
  return { journey: m[1] as string, step: Number(m[2]) };
}

/**
 * The code references in a trace's `code:`: `path`, `path:line`,
 * `path:40-88`, `path:line:column`, or `{ path, lines, symbol }`.
 */
export function traceCodeRefs(code: TraceCodeSpec | undefined): TraceCodeRef[] {
  if (code === undefined) return [];
  const list = Array.isArray(code) ? code : [code];
  return list.map((c) => {
    if (typeof c !== "string") {
      return {
        path: c.path,
        lines: c.lines === undefined ? undefined : String(c.lines),
        symbol: c.symbol,
        description: c.description,
      };
    }
    const range = /^(.+?):(\d+)-(\d+)$/.exec(c);
    if (range) return { path: range[1] as string, lines: `${range[2]}-${range[3]}` };
    const line = /^(.+?):(\d+)(?::\d+)?$/.exec(c);
    if (line) return { path: line[1] as string, lines: line[2] };
    return { path: c };
  });
}

/** A code reference as people write it: path:42 or path:40-88 (symbol). */
export function traceCodeLabel(ref: TraceCodeRef): string {
  return `${ref.path}${ref.lines ? `:${ref.lines}` : ""}${ref.symbol ? ` (${ref.symbol})` : ""}`;
}

/** The step's role, with the default. */
export function traceRoleOf(step: TraceStepSpec) {
  return step.role ?? "ok";
}

/** The step's evidence, with the default. */
export function traceEvidenceOf(step: TraceStepSpec) {
  return step.evidence ?? "inferred";
}

/**
 * Where a record stands: its `status`, or, when it doesn't say, what it
 * holds: fixed with a fix, root-caused with a cause, otherwise investigating.
 */
export function triageStatusOf(spec: TraceSpec): TriageStatus {
  if (spec.status) return spec.status;
  if (spec.fix !== undefined) return "fixed";
  if (spec["root-cause"] || spec.steps.some((s) => s.role === "cause")) return "root-caused";
  return "investigating";
}

/** Statuses a record ends in. */
export const CLOSED_STATUSES: readonly TriageStatus[] = ["fixed", "wont-fix", "cannot-reproduce"];

/** The fix as one shape, whichever way it's written. */
export function fixOf(
  fix: FixSpec | undefined,
): { summary: string; link?: string | undefined; test?: TraceCodeSpec | undefined } | undefined {
  if (fix === undefined) return undefined;
  return typeof fix === "string" ? { summary: fix } : fix;
}

/** The root cause in words: root-cause.summary, or diagnosis. */
export function rootCauseOf(spec: TraceSpec): string | undefined {
  return spec["root-cause"]?.summary ?? spec.diagnosis;
}
