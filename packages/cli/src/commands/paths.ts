import { pathsAnswer } from "@archdoc/analyzers";
import type { Io } from "../io.js";

export interface PathsOptions {
  model?: string;
  depth?: string;
  all?: boolean;
}

/**
 * `archdoc paths [entry]`: where flows start (routes, consumers, schedules,
 * CLI commands) and the calls each makes, by function, file, and line. Works
 * before a model exists.
 */
export async function paths(
  entry: string | undefined,
  options: PathsOptions,
  io: Io,
): Promise<number> {
  try {
    const depth = options.depth ? Number(options.depth) : undefined;
    if (depth !== undefined && !(depth >= 1 && depth <= 10)) {
      io.err("--depth must be from 1 to 10.");
      return 2;
    }
    const r = await pathsAnswer(
      { model: options.model, cwd: io.cwd },
      { entry, depth, all: options.all },
    );
    (r.ok ? io.out : io.err)(r.text);
    return r.ok ? 0 : 1;
  } catch (err) {
    io.err(err instanceof Error ? err.message : String(err));
    return 2;
  }
}
