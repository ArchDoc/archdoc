import {
  type CodeChange,
  deriveCodeChange,
  type LoadedModel,
  type MarkedFinding,
} from "@archdoc/core";
import { checkRepository } from "./check.js";
import { findEntryPoints } from "./paths.js";
import { contextOf, type Snapshot } from "./revision.js";

export interface CodeChangeOptions {
  /** Repository, .archdoc directory, or model file. Defaults to ".". */
  model?: string | undefined;
  cwd: string;
  /** The branch the change is measured from, such as main. */
  base: string;
  /** The branch with the change. Omit for the working tree. */
  head?: string | undefined;
}

export interface CodeChangeResult {
  /** The head's model: what the code change is compared with. */
  model: LoadedModel;
  /** The merge base of `base` and the head. */
  commit: string;
  changedFiles: string[];
  /** The code change in the model's terms. */
  change: CodeChange;
  /** check's findings on the head, marked with whether the change introduced them. */
  findings: MarkedFinding[];
}

/**
 * Reads what a branch changed from its code: the files changed since the merge
 * base with `base`, analyzed at both ends and mapped onto the head's model as
 * elements, uses, and entry points. The model at the base is never read for
 * the comparison, only the code.
 */
export async function codeChange(options: CodeChangeOptions): Promise<CodeChangeResult> {
  const checked = await checkRepository({
    model: options.model,
    cwd: options.cwd,
    base: options.base,
    head: options.head,
  });
  const base = checked.base;
  if (!base) throw new Error(`Couldn't read ${options.base}.`);
  const changed = base.changedFiles;
  const entriesIn = async (snap: Snapshot) => {
    const present = new Set(snap.files);
    const files = changed.filter((f) => present.has(f));
    if (!files.length) return [];
    return findEntryPoints({ ...contextOf(snap), files }).catch(() => []);
  };
  const change = deriveCodeChange({
    model: checked.model,
    base: {
      files: base.snapshot.files,
      observed: base.observed,
      entries: await entriesIn(base.snapshot),
    },
    head: {
      files: checked.snapshot.files,
      observed: checked.observed,
      entries: await entriesIn(checked.snapshot),
    },
    changed,
  });
  return {
    model: checked.model,
    commit: base.commit,
    changedFiles: changed,
    change,
    findings: checked.findings,
  };
}
