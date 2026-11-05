import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { editAnswer, findAnswer } from "@archdoc/analyzers";
import { type EditOp, FIND_GAPS, type FindGap, type FindType } from "@archdoc/core";
import type { Io } from "../io.js";

export interface FindOptions {
  model?: string;
  type?: string;
  kind?: string;
  under?: string;
  path?: string;
  missing?: string;
  outline?: boolean;
  depth?: string;
  limit?: string;
}

const TYPES = ["element", "actor", "journey", "data", "environment"];

/**
 * `archdoc find [words…]`: parts of the model by words or by what they are,
 * with the ID to edit and where each is written; --outline for the element
 * tree.
 */
export async function findCommand(words: string[], options: FindOptions, io: Io): Promise<number> {
  try {
    if (options.type && !TYPES.includes(options.type)) {
      io.err(`--type is one of ${TYPES.join(", ")}.`);
      return 2;
    }
    const missing = options.missing
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const unknown = missing?.filter((g) => !FIND_GAPS.includes(g as FindGap));
    if (unknown?.length) {
      io.err(`--missing takes ${FIND_GAPS.join(", ")}; not ${unknown.join(", ")}.`);
      return 2;
    }
    const r = await findAnswer(
      { model: options.model, cwd: io.cwd },
      {
        query: words.join(" ") || undefined,
        type: options.type as FindType | undefined,
        kind: options.kind,
        under: options.under,
        path: options.path,
        missing: missing as FindGap[] | undefined,
        outline: options.outline,
        depth: options.depth ? Number(options.depth) : undefined,
        limit: options.limit ? Number(options.limit) : undefined,
      },
    );
    (r.ok ? io.out : io.err)(r.text);
    return r.ok ? 0 : 1;
  } catch (err) {
    io.err(err instanceof Error ? err.message : String(err));
    return 2;
  }
}

export interface EditOptions {
  model?: string;
  file?: string;
  by?: string;
  dryRun?: boolean;
}

/**
 * `archdoc edit <ops>`: changes the model by ID. Ops are JSON, one op or a
 * list, given inline, with --file, or on stdin (-).
 */
export async function editCommand(
  ops: string | undefined,
  options: EditOptions,
  io: Io,
  stdin: () => Promise<string> = readStdin,
): Promise<number> {
  try {
    const text =
      options.file !== undefined
        ? options.file === "-"
          ? await stdin()
          : await readFile(resolve(io.cwd, options.file), "utf8")
        : ops === "-"
          ? await stdin()
          : ops;
    if (!text?.trim()) {
      io.err(
        'Give the ops as JSON, such as \'{"op":"set","id":"orders","spec":{"description":"…"}}\', or --file ops.json.',
      );
      return 2;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      io.err(`The ops aren't valid JSON: ${err instanceof Error ? err.message : String(err)}`);
      return 2;
    }
    const list = (Array.isArray(parsed) ? parsed : [parsed]) as EditOp[];
    const r = await editAnswer(
      { model: options.model, cwd: io.cwd },
      { ops: list, by: options.by, dryRun: options.dryRun },
    );
    (r.ok ? io.out : io.err)(r.text);
    return r.ok ? 0 : 1;
  } catch (err) {
    io.err(err instanceof Error ? err.message : String(err));
    return 2;
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}
