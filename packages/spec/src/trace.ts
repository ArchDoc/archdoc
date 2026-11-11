import { z } from "zod";
import {
  CodeRefSchema,
  IdSchema,
  JourneyStepSchema,
  ProvenanceSchema,
  RefSchema,
} from "./schema.js";

/**
 * Where Triage records live, inside the model directory (`.archdoc/triage/`).
 * They're never part of the model.
 */
export const TRIAGE_DIR = "triage";

/** Where traces lived before 0.8. Still read, as Triage records, until 0.9. */
export const TRACES_DIR = "traces";

/** The folders read as Triage records, newest first. */
export const TRIAGE_DIRS = [TRIAGE_DIR, TRACES_DIR] as const;

/** Where a bug stands. */
export const TriageStatusSchema = z
  .enum(["open", "investigating", "root-caused", "fixed", "wont-fix", "cannot-reproduce"])
  .describe(
    "open: reported, not looked at. investigating: being followed. root-caused: the cause is found. fixed: the fix is in. wont-fix and cannot-reproduce: closed without a fix, with why in root-cause.",
  );

/** How bad the bug is for the people it reaches. */
export const TriageSeveritySchema = z.enum(["low", "normal", "high", "critical"]);

/** Who reported the bug, when, and where. */
export const ReportedSchema = z
  .strictObject({
    by: z.string().optional().describe("Who reported it: an actor ID, or a name"),
    at: z.union([z.string(), z.date()]).optional().describe("When, such as 2026-11-10"),
    link: z.string().optional().describe("Where: the issue, ticket, or thread"),
  })
  .describe("Who reported the bug, when, and where");

/** What a step did in the failing run. */
export const TraceRoleSchema = z
  .enum(["ok", "cause", "spreads", "symptom"])
  .describe(
    "ok: worked as designed (the default). cause: where it went wrong. spreads: carries the wrong value on. symptom: where the error shows.",
  );

/** How the trace's author knows a step happened as written. */
export const TraceEvidenceSchema = z
  .enum(["reproduced", "read", "inferred"])
  .describe(
    "reproduced: seen in a run (a log, a test, a debugger). read: followed in the code. inferred: reasoned from the model or the symptom (the default).",
  );

/**
 * A code reference in a trace: `path`, `path:line`, `path:40-88`, or the
 * object form model files use ({ path, lines, symbol }).
 */
export const TraceCodeSchema = z
  .union([CodeRefSchema, z.array(CodeRefSchema)])
  .describe(
    "The code this happens in: path, path:line, path:40-88, or { path, lines, symbol }, relative to the repo root",
  );

/** A call that should have happened in a step and didn't. */
export const MissingHopSchema = z
  .strictObject({
    from: RefSchema.optional().describe("Who should have made it. Defaults to the step's from."),
    to: RefSchema.describe("The element it should have gone to"),
    call: z.string().optional().describe("The function or endpoint, such as applySchemas"),
    description: z.string().optional(),
  })
  .describe("A call that should have happened and didn't");

const Values = z
  .record(z.string(), z.unknown())
  .describe("Values by name, such as { Charge.id.type: undefined }");

/** One hop of the failing run, in journey step syntax plus what went wrong. */
export const TraceStepSchema = JourneyStepSchema.extend({
  code: TraceCodeSchema.optional(),
  role: TraceRoleSchema.optional(),
  evidence: TraceEvidenceSchema.optional(),
  observed: Values.optional().describe("What the run had at this step"),
  expected: Values.optional().describe("What it should have had"),
  missing: MissingHopSchema.optional(),
});

/** A lead the investigation followed. */
export const HypothesisSchema = z
  .strictObject({
    claim: z.string().min(1).describe("What might be wrong, such as: the finance API times out"),
    verdict: z
      .enum(["open", "ruled-out", "confirmed"])
      .optional()
      .describe("open (the default), ruled-out, or confirmed"),
    evidence: TraceEvidenceSchema.optional(),
    note: z.string().optional().describe("What showed it"),
    element: z.string().min(1).optional().describe("The element the lead is about"),
    code: TraceCodeSchema.optional(),
  })
  .describe("A lead the investigation followed, and what came of it");

/** The root cause, in words, and the step it happens in. */
export const RootCauseSchema = z
  .strictObject({
    summary: z.string().min(1).describe("Why it happens, in a sentence or two"),
    step: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("The 1-based step it happens in. Defaults to the step with role: cause."),
  })
  .describe("The root cause");

/** The fix: what it does, and where it is. */
export const FixSchema = z
  .union([
    z.string().min(1),
    z.strictObject({
      summary: z.string().min(1).describe("What fixes it"),
      link: z.string().optional().describe("The pull request or commit"),
      test: TraceCodeSchema.optional().describe("The test that shows it's fixed"),
    }),
  ])
  .describe("What fixes it: a sentence, or { summary, link, test }");

/** Where the same job is done right, to compare with. */
export const WorksInSchema = z
  .strictObject({
    element: RefSchema.describe("The element that does it right"),
    code: TraceCodeSchema.optional(),
    note: z.string().optional(),
  })
  .describe("Where the same job is done right, for comparison");

const recordShape = {
  $schema: z.string().optional(),
  archdoc: z
    .string()
    .regex(/^2(\.\d+)?$/)
    .optional(),
  title: z.string().min(1).describe("The bug in one line, as a user would say it"),
  status: TriageStatusSchema.optional().describe(
    "Where the bug stands. Defaults from the record: fixed with a fix, root-caused with a cause, otherwise investigating.",
  ),
  severity: TriageSeveritySchema.optional(),
  reported: ReportedSchema.optional(),
  symptom: z.string().min(1).describe("What the user saw: the log line, error, or wrong output"),
  attachments: z
    .array(z.string().min(1))
    .optional()
    .describe("Long logs and other files, relative to this file, such as attachments/run.log"),
  reproduce: z.string().optional().describe("How to see it again: a command, a request, a test"),
  expands: z
    .string()
    .regex(
      /^[A-Za-z0-9][A-Za-z0-9_.-]*#[1-9]\d*$/,
      "Write the journey step as <journey>#<step>, such as book-a-ride#2 or payments.month-end#1",
    )
    .optional()
    .describe(
      "The journey step the bug showed up in, as <journey>#<step> (1-based). A journey in another repo is named by namespace, such as payments.month-end#2.",
    ),
  actor: RefSchema.optional().describe("For a bug no journey covers: whose request it was"),
  goal: z.string().optional().describe("For a bug no journey covers: what they were doing"),
  hypotheses: z.array(HypothesisSchema).optional(),
  steps: z
    .array(TraceStepSchema)
    .optional()
    .describe("The bug's journey: the path the failing request took, one step per hop"),
  "root-cause": RootCauseSchema.optional(),
  diagnosis: z.string().optional().describe("Why it happens. The short form of root-cause."),
  "works-in": WorksInSchema.optional(),
  fix: FixSchema.optional(),
  tags: z.array(z.string()).optional(),
  provenance: ProvenanceSchema.optional(),
};

/**
 * A Triage record (`.archdoc/triage/<id>.yaml`): a bug as it was reported,
 * the leads followed, and the path the failing request actually took,
 * attached to the journey step where it showed up, down to its root cause
 * and the fix. It's never loaded into the model: the journey is the design,
 * the record is one bug.
 */
export const TriageFileSchema = z.strictObject({
  triage: IdSchema.describe("The record's ID, usually its file name"),
  ...recordShape,
});

/** A trace file from before 0.8: a Triage record keyed `trace:`. */
export const TraceFileSchema = z.strictObject({
  trace: IdSchema.describe("The trace's ID. Since 0.8, write triage: instead."),
  ...recordShape,
});

export type TriageStatus = z.infer<typeof TriageStatusSchema>;
export type TriageSeverity = z.infer<typeof TriageSeveritySchema>;
export type HypothesisSpec = z.infer<typeof HypothesisSchema>;
export type FixSpec = z.infer<typeof FixSchema>;
export type TriageFile = z.infer<typeof TriageFileSchema>;
export type TraceRole = z.infer<typeof TraceRoleSchema>;
export type TraceEvidence = z.infer<typeof TraceEvidenceSchema>;
export type TraceCodeSpec = z.infer<typeof TraceCodeSchema>;
export type MissingHopSpec = z.infer<typeof MissingHopSchema>;
export type TraceStepSpec = z.infer<typeof TraceStepSchema>;
export type WorksInSpec = z.infer<typeof WorksInSchema>;
export type TraceFile = z.infer<typeof TraceFileSchema>;
