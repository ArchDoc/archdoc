import { mkdir, unlink, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import {
  buildModel,
  compileGlob,
  type Diagnostic,
  type EditOp,
  editModel,
  type FindGap,
  type FindType,
  find,
  formatDiagnostic,
  formatFind,
  formatOutline,
  listRepoFiles,
  loadModel,
  type ModelSource,
  readModelSources,
} from "@archdoc/core";
import type { Answer, Where } from "./answers.js";

const NO_MODEL =
  "No ArchDoc model here. Expected .archdoc/archdoc.yaml. Run archdoc init to start one.";

export interface FindInput {
  /** Words, such as "checkout pricing" or "orders queue". */
  query?: string | undefined;
  type?: FindType | undefined;
  kind?: string | undefined;
  under?: string | undefined;
  path?: string | undefined;
  missing?: readonly FindGap[] | undefined;
  /** The element tree instead of a list: from the top, or from `under`. */
  outline?: boolean | undefined;
  depth?: number | undefined;
  limit?: number | undefined;
}

/**
 * Finds parts of the model by words or by what they are (kind, place, the
 * file they own, what they lack), or outlines its element tree, so an agent
 * gets IDs to edit without reading the YAML.
 */
export async function findAnswer(where: Where, input: FindInput = {}): Promise<Answer> {
  const m = await loadModel(where.model ?? ".", { cwd: where.cwd });
  if (m.diagnostics.some((d) => d.code === "model/not-found")) return { ok: false, text: NO_MODEL };
  if (input.outline) {
    return { ok: true, text: formatOutline(m, { under: input.under, depth: input.depth }) };
  }
  const path = input.path
    ? relative(m.baseDir, resolve(where.cwd, input.path)).replace(/\\/g, "/")
    : undefined;
  const q = {
    words: input.query,
    type: input.type,
    kind: input.kind,
    under: input.under,
    path,
    missing: input.missing,
    limit: input.limit,
  };
  const r = find(m, q);
  return { ok: !r.problem, text: formatFind(r, q) };
}

export interface EditInput {
  ops: readonly EditOp[];
  /** Marks what's added as suggested by this author, such as agent:claude-code. */
  by?: string | undefined;
  /** Say what would change, and write nothing. */
  dryRun?: boolean | undefined;
}

/**
 * Changes the model by ID (add, set, remove, rename, use, step), writes only
 * the lines each change touches, and answers with what the change fixed and
 * broke in the model, so the next step is clear without another check. A
 * change that adds errors isn't written.
 */
export async function editAnswer(where: Where, input: EditInput): Promise<Answer> {
  if (!input.ops?.length) return { ok: false, text: "Give at least one op." };
  const read = await readModelSources(where.model ?? ".", { cwd: where.cwd });
  if (!read) return { ok: false, text: NO_MODEL };
  const dir =
    read.source.endsWith(".yaml") || read.source.endsWith(".yml") ? undefined : read.source;
  const display = (abs: string) => relative(where.cwd, abs).replace(/\\/g, "/");
  const r = editModel(read.sources, input.ops, {
    by: input.by,
    root: read.root,
    journeyFile: dir ? (id) => display(join(dir, "journeys", `${id}.yaml`)) : undefined,
  });
  if (r.problems.length) {
    return {
      ok: false,
      text: [
        `Nothing changed: ${r.problems.length === 1 ? "an op" : `${r.problems.length} ops`} couldn't be done.`,
        ...r.problems.map((p) => `  ✗ ${p}`),
        "",
        "Fix those and send the edit again; ops run in order, and all of them or none are written.",
      ].join("\n"),
    };
  }
  if (!r.files.length) {
    return {
      ok: true,
      text: ["No change: the model already says that.", ...r.done.map((d) => `  ${d}`)].join("\n"),
    };
  }

  const after = applyFiles(read.sources, r.files);
  const before = buildModel(read.sources, { root: read.root });
  const next = buildModel(after, { root: read.root });
  const { added, fixed } = compare(before.diagnostics, next.diagnostics);
  const newErrors = added.filter((d) => d.severity === "error");
  const newWarnings = added.filter((d) => d.severity === "warning");
  const files = r.files.map(
    (f) => `${f.path}${f.created ? " (new)" : f.removed ? " (removed)" : ""}`,
  );

  if (newErrors.length) {
    return {
      ok: false,
      text: [
        `Nothing written: this edit would add ${newErrors.length} error${newErrors.length === 1 ? "" : "s"} to the model.`,
        ...newErrors.slice(0, 12).map((d) => `  ✗ ${formatDiagnostic(d)}`),
        ...(newErrors.length > 12 ? [`  … and ${newErrors.length - 12} more`] : []),
        "",
        "What it would have done:",
        ...r.done.map((d) => `  ${d}`),
        "",
        "Fix the ops (add what they point at first, in the same edit) and send it again.",
      ].join("\n"),
    };
  }

  if (!input.dryRun) await writeFiles(where.cwd, r.files);
  const stale = await staleCode(read.baseDir, input.ops, next);
  const errors = next.diagnostics.filter((d) => d.severity === "error").length;
  const warnings = next.diagnostics.filter((d) => d.severity === "warning").length;
  const out = [
    `${input.dryRun ? "Would change" : "✓ Changed"} ${files.join(", ")}:`,
    ...r.done.map((d) => `  ${d}`),
  ];
  if (fixed.length) {
    out.push("", `Fixed ${fixed.length} finding${fixed.length === 1 ? "" : "s"}:`);
    out.push(...fixed.slice(0, 8).map((d) => `  ✓ ${d.code} ${d.message}`));
    if (fixed.length > 8) out.push(`  … and ${fixed.length - 8} more`);
  }
  if (newWarnings.length || stale.length) {
    out.push("", `New warnings (${newWarnings.length + stale.length}):`);
    out.push(...newWarnings.slice(0, 12).map((d) => `  ! ${formatDiagnostic(d)}`));
    if (newWarnings.length > 12) out.push(`  … and ${newWarnings.length - 12} more`);
    out.push(...stale.map((s) => `  ! ${s}`));
  }
  out.push(
    "",
    `The model has ${errors} error${errors === 1 ? "" : "s"} and ${warnings} warning${warnings === 1 ? "" : "s"}.${
      errors || warnings ? " archdoc_check lists them with fixes, and checks the code too." : ""
    }`,
  );
  return { ok: true, text: out.join("\n") };
}

function applyFiles(
  sources: readonly ModelSource[],
  files: readonly {
    path: string;
    text: string;
    created?: boolean | undefined;
    removed?: boolean | undefined;
  }[],
): ModelSource[] {
  const byPath = new Map(files.map((f) => [f.path, f]));
  const out: ModelSource[] = [];
  for (const s of sources) {
    const f = byPath.get(s.path);
    if (f?.removed) continue;
    out.push(f ? { path: s.path, text: f.text } : s);
  }
  for (const f of files)
    if (f.created && !sources.some((s) => s.path === f.path))
      out.push({ path: f.path, text: f.text });
  return out;
}

async function writeFiles(
  cwd: string,
  files: readonly { path: string; text: string; removed?: boolean | undefined }[],
): Promise<void> {
  for (const f of files) {
    const abs = resolve(cwd, f.path);
    if (f.removed) {
      await unlink(abs).catch(() => undefined);
      continue;
    }
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, f.text);
  }
}

/** Diagnostics only one side has, compared by what they say, not where. */
function compare(before: readonly Diagnostic[], after: readonly Diagnostic[]) {
  const key = (d: Diagnostic) => `${d.severity} ${d.code} ${d.message}`;
  const count = (list: readonly Diagnostic[]) => {
    const m = new Map<string, number>();
    for (const d of list) m.set(key(d), (m.get(key(d)) ?? 0) + 1);
    return m;
  };
  const was = count(before);
  const now = count(after);
  const added = after.filter((d) => {
    const k = key(d);
    const left = was.get(k) ?? 0;
    if (left > 0) {
      was.set(k, left - 1);
      return false;
    }
    return true;
  });
  const fixed = before.filter((d) => {
    const k = key(d);
    const left = now.get(k) ?? 0;
    if (left > 0) {
      now.set(k, left - 1);
      return false;
    }
    return d.severity !== "info";
  });
  return { added: added.filter((d) => d.severity !== "info"), fixed };
}

/** Code paths an op set that match no file in the repository. */
async function staleCode(
  baseDir: string,
  ops: readonly EditOp[],
  model: ReturnType<typeof buildModel>,
): Promise<string[]> {
  const ids = new Set<string>();
  for (const op of ops) {
    if ((op.op === "add" || op.op === "set") && op.spec && "code" in op.spec) ids.add(op.id);
  }
  if (!ids.size) return [];
  const files = await listRepoFiles(baseDir).catch(() => [] as string[]);
  if (!files.length) return [];
  const out: string[] = [];
  for (const e of model.elements.values()) {
    const named = [...ids].some(
      (id) => e.id === id || e.id.endsWith(`.${id}`) || `${model.namespace}.${e.id}` === id,
    );
    if (!named) continue;
    for (const c of e.code) {
      const re = compileGlob(c.path);
      if (!files.some((f) => re.test(f)))
        out.push(`${e.id}: code ${c.path} matches no file in the repository.`);
    }
  }
  return out;
}
