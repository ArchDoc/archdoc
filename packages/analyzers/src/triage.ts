import { mkdirSync, readFileSync, rmdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import {
  anchorError,
  checkTrace,
  formatAnchors,
  formatTrace,
  formatTraceChecks,
  formatTraceList,
  type LoadedModel,
  listRepoFiles,
  loadModel,
  loadTraces,
  readTraceSources,
  recordsOn,
  TRACES_DIR,
  TRIAGE_DIR,
  type Trace,
  type TraceCheck,
  type TriageReport,
  traceSkeleton,
  triageId,
  triageStatusOf,
} from "@archdoc/core";
import { isMap, isScalar, parseDocument, Scalar, YAMLMap } from "yaml";
import { type Answer, readRepoFile, type Where } from "./answers.js";

type TriageStatus = ReturnType<typeof triageStatusOf>;

const NO_MODEL =
  "No ArchDoc model here. Expected .archdoc/archdoc.yaml. Run archdoc init to start one.";

/** The directory the model's files are in, which `triage/` sits inside. */
export function modelDir(m: LoadedModel): string {
  return statSync(m.source).isDirectory() ? m.source : dirname(m.source);
}

async function loaded(where: Where): Promise<LoadedModel | undefined> {
  const m = await loadModel(where.model ?? ".", { cwd: where.cwd });
  return m.diagnostics.some((d) => d.code === "model/not-found") ? undefined : m;
}

async function records(where: Where): Promise<Trace[]> {
  return loadTraces(await readTraceSources(where.model ?? ".", { cwd: where.cwd })).traces;
}

async function checkAll(m: LoadedModel, traces: readonly Trace[]): Promise<TraceCheck[]> {
  const files = await listRepoFiles(m.baseDir);
  const inRepo = new Set(files);
  const read = (p: string) => (inRepo.has(p) ? readRepoFile(m.baseDir, p) : undefined);
  return traces.map((t) => checkTrace(m, t, { files, read }));
}

export interface TriageStartInput extends TriageReport {
  /** What the person handed over: the error, log, stack trace, wrong output, or issue text. */
  symptom: string;
  /** Print the record without writing it. */
  dryRun?: boolean | undefined;
}

/**
 * Starts a Triage record from a bug report: places the error on the journey
 * steps it likely showed up in, and writes `.archdoc/triage/<id>.yaml` with
 * status investigating, the best journey step, the elements the error names
 * as open leads, and steps from the stack. Says where to start in the code.
 */
export async function triageStartAnswer(where: Where, input: TriageStartInput): Promise<Answer> {
  const symptom = input.symptom.trim();
  if (!symptom) return { ok: false, text: "Give the bug: the error, log, or what went wrong." };
  const m = await loaded(where);
  if (!m) return { ok: false, text: NO_MODEL };
  const files = await listRepoFiles(m.baseDir);
  const anchored = anchorError(m, symptom, { files, root: m.baseDir });
  const taken = new Set((await records(where)).map((t) => t.id));
  const dir = join(modelDir(m), TRIAGE_DIR);
  const base = input.id ?? triageId(input.title ?? symptom);
  let id = base;
  for (let n = 2; taken.has(id) || exists(join(dir, `${id}.yaml`)); n++) id = `${base}-${n}`;
  const at = input.at ?? new Date().toISOString().slice(0, 10);
  const yaml = traceSkeleton(anchored, symptom, { ...input, id, at });
  const file = join(dir, `${id}.yaml`);
  const shown = relative(where.cwd, file).replace(/\\/g, "/") || file;
  const out: string[] = [];
  if (input.dryRun) {
    out.push(`Would write ${shown}:`, "", yaml.trimEnd());
  } else {
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, yaml);
    out.push(`Started ${shown} (status: investigating).`);
  }
  out.push("", formatAnchors(anchored));
  out.push(
    "",
    "Next (this is the whole workflow; you don't need to find the skill file):",
    "  1. Follow the code from the top journey step. As you go, rule each lead in or out (verdict, evidence, note), and add a step per hop the failing request took, on the most specific element.",
    "  2. Give every step what a reader needs to walk through it on the map: action (what it does, in a few words), description (what happened at this hop in the failing run: the value it had, what the code did with it, and why that's right or wrong there), sends (the data entry it passes, by its name under data:; creates or changes for a write), observed and expected on that entry's fields where they differ (observed: { Order.status: pending }), code (path#function or path:line), and evidence (reproduced, read, or inferred).",
    "  3. Mark the step where it goes wrong role: cause, and say why in root-cause: { summary, step }. Set status: root-caused. If you were asked only to explain it, stop and report.",
    "  4. If you fix it, keep the record: set status: fixed and fix: { summary, link, test }, and commit it with the fix. A fix without its record isn't done.",
    `  5. archdoc check checks the record; archdoc_triage with id: ${id} shows it the way the explorer will, and what it still lacks.`,
  );
  return { ok: true, text: out.join("\n") };
}

function exists(path: string): boolean {
  try {
    statSync(path);
    return true;
  } catch {
    return false;
  }
}

export interface TriageListInput {
  status?: TriageStatus | "open-all" | undefined;
  /** Only records that name this element, its parts, or what it's part of. */
  element?: string | undefined;
}

/** The Triage records, open ones first, by status or by element. */
export async function triageListAnswer(where: Where, input: TriageListInput = {}): Promise<Answer> {
  const m = await loaded(where);
  if (!m) return { ok: false, text: NO_MODEL };
  let traces = await records(where);
  if (input.status === "open-all") {
    traces = traces.filter(
      (t) => !["fixed", "wont-fix", "cannot-reproduce"].includes(triageStatusOf(t.spec)),
    );
  } else if (input.status) {
    traces = traces.filter((t) => triageStatusOf(t.spec) === input.status);
  }
  if (input.element) {
    const checks = traces.map((t) => checkTrace(m, t));
    const on = new Set(recordsOn(checks, [input.element], { closed: true }).map((c) => c.trace.id));
    traces = traces.filter((t) => on.has(t.id));
  }
  return { ok: true, text: formatTraceList(traces) };
}

/** One record: how it reads, then what it still lacks for its status. */
export async function triageCheckAnswer(where: Where, id: string): Promise<Answer> {
  const m = await loaded(where);
  if (!m) return { ok: false, text: NO_MODEL };
  const all = await records(where);
  const trace = all.find((t) => t.id === id);
  if (!trace) {
    return {
      ok: false,
      text: `No Triage record "${id}".${all.length ? ` Records: ${all.map((t) => t.id).join(", ")}.` : ""}`,
    };
  }
  const [c] = await checkAll(m, [trace]);
  const check = c as TraceCheck;
  return {
    ok: true,
    text: `${formatTrace(check.view)}\n\n${formatTraceChecks([check])}`,
    failing: check.findings.some((f) => f.severity === "error"),
  };
}

/** Open records on the elements a task touches: "known bugs here", for archdoc context. */
export async function knownBugs(
  where: Where,
  m: LoadedModel,
  elements: readonly string[],
): Promise<string | undefined> {
  if (!elements.length) return undefined;
  const traces = await records(where);
  if (!traces.length) return undefined;
  const on = recordsOn(
    traces.map((t) => checkTrace(m, t)),
    elements,
  );
  if (!on.length) return undefined;
  return [
    "Known bugs here (open Triage records):",
    ...on.map(
      (c) =>
        `  ${c.view.id} · ${c.view.status}${c.view.severity ? ` (${c.view.severity})` : ""} · ${c.view.title}${c.view.diagnosis ? ` · ${c.view.diagnosis.split("\n")[0]}` : ""}`,
    ),
  ].join("\n");
}

export interface TriageMigrateInput {
  dryRun?: boolean | undefined;
}

/**
 * Moves traces from before 0.8 (`.archdoc/traces/*.yaml`) to
 * `.archdoc/triage/`, keyed `triage:`, with `diagnosis` as
 * `root-cause.summary`. Keeps comments and the order of everything else.
 */
export async function triageMigrateAnswer(
  where: Where,
  input: TriageMigrateInput = {},
): Promise<Answer> {
  const m = await loaded(where);
  if (!m) return { ok: false, text: NO_MODEL };
  const root = modelDir(m);
  const from = join(root, TRACES_DIR);
  const to = join(root, TRIAGE_DIR);
  const entries = exists(from) ? await readdir(from, { withFileTypes: true }) : [];
  const moved: string[] = [];
  const skipped: string[] = [];
  for (const e of entries) {
    if (!e.isFile() || !/\.ya?ml$/.test(e.name)) continue;
    const src = join(from, e.name);
    const dest = join(to, e.name);
    const shown = relative(where.cwd, src).replace(/\\/g, "/");
    if (exists(dest)) {
      skipped.push(`${shown} (${relative(where.cwd, dest)} is already there)`);
      continue;
    }
    const text = migrateTraceText(readFileSync(src, "utf8"));
    if (!input.dryRun) {
      mkdirSync(to, { recursive: true });
      writeFileSync(dest, text);
      unlinkSync(src);
    }
    moved.push(`${shown} → ${relative(where.cwd, dest).replace(/\\/g, "/")}`);
  }
  if (!input.dryRun && moved.length) {
    try {
      rmdirSync(from);
    } catch {
      // Not empty: other files stay where they are.
    }
  }
  if (!moved.length && !skipped.length) return { ok: true, text: "No traces to move." };
  return {
    ok: true,
    text: [
      ...(moved.length
        ? [
            `${input.dryRun ? "Would move" : "Moved"} ${moved.length}:`,
            ...moved.map((x) => `  ${x}`),
          ]
        : []),
      ...(skipped.length ? ["Left where they are:", ...skipped.map((x) => `  ${x}`)] : []),
    ].join("\n"),
  };
}

/** A trace file's text as a Triage record's: `trace:` → `triage:`, `diagnosis` → `root-cause.summary`. */
export function migrateTraceText(text: string): string {
  const doc = parseDocument(text);
  const map = doc.contents;
  if (!isMap(map)) return text;
  for (const pair of map.items) {
    if (!isScalar(pair.key)) continue;
    if (pair.key.value === "trace") {
      pair.key.value = "triage";
    } else if (pair.key.value === "diagnosis" && !map.has("root-cause")) {
      const inner = new YAMLMap();
      inner.add({ key: new Scalar("summary"), value: pair.value });
      pair.key.value = "root-cause";
      pair.value = inner as unknown as typeof pair.value;
    }
  }
  return doc.toString({ lineWidth: 0 });
}
