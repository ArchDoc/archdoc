import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  type TriageListInput,
  triageListAnswer,
  triageMigrateAnswer,
  triageStartAnswer,
  triageWaitAnswer,
} from "@archdoc/analyzers";
import type { Io } from "../io.js";
import { readStdin } from "./stdin.js";

const STATUSES = [
  "open",
  "investigating",
  "root-caused",
  "fixed",
  "wont-fix",
  "cannot-reproduce",
] as const;
const SEVERITIES = ["low", "normal", "high", "critical"] as const;

export interface TriageStartOptions {
  model?: string;
  title?: string;
  id?: string;
  link?: string;
  by?: string;
  severity?: string;
  dryRun?: boolean;
}

/** `archdoc triage start <file|->`: a new Triage record from a bug report. */
export async function triageStart(
  file: string | undefined,
  options: TriageStartOptions,
  io: Io,
  stdin: () => Promise<string> = readStdin,
): Promise<number> {
  if (options.severity && !(SEVERITIES as readonly string[]).includes(options.severity)) {
    io.err(`--severity must be one of ${SEVERITIES.join(", ")}.`);
    return 2;
  }
  const text =
    !file || file === "-" ? await stdin() : await readFile(resolve(io.cwd, file), "utf8");
  const r = await triageStartAnswer(
    { model: options.model, cwd: io.cwd },
    {
      symptom: text,
      title: options.title,
      id: options.id,
      link: options.link,
      by: options.by,
      severity: options.severity as (typeof SEVERITIES)[number] | undefined,
      dryRun: options.dryRun,
    },
  );
  (r.ok ? io.out : io.err)(r.text);
  return r.ok ? 0 : 2;
}

/** `archdoc triage list`: the records, open ones first. */
export async function triageList(
  options: { model?: string; status?: string; element?: string },
  io: Io,
): Promise<number> {
  const status = options.status === "open-all" ? "open-all" : options.status;
  if (status && status !== "open-all" && !(STATUSES as readonly string[]).includes(status)) {
    io.err(`--status must be one of ${STATUSES.join(", ")}, or open-all.`);
    return 2;
  }
  const r = await triageListAnswer(
    { model: options.model, cwd: io.cwd },
    { status: status as TriageListInput["status"], element: options.element },
  );
  (r.ok ? io.out : io.err)(r.text);
  return r.ok ? 0 : 2;
}

/** `archdoc triage wait [id]`: blocks until the person sends a bug from the explorer. */
export async function triageWait(
  id: string | undefined,
  options: { model?: string; timeout?: string },
  io: Io,
): Promise<number> {
  const timeout = options.timeout === undefined ? undefined : Number(options.timeout);
  if (timeout !== undefined && !(timeout > 0)) {
    io.err("--timeout is a number of seconds.");
    return 2;
  }
  const r = await triageWaitAnswer({ model: options.model, cwd: io.cwd }, { id, timeout });
  (r.ok ? io.out : io.err)(r.text);
  return r.ok ? 0 : 2;
}

/** `archdoc triage migrate`: traces from before 0.8 to Triage records. */
export async function triageMigrate(
  options: { model?: string; dryRun?: boolean },
  io: Io,
): Promise<number> {
  const r = await triageMigrateAnswer({ model: options.model, cwd: io.cwd }, options);
  (r.ok ? io.out : io.err)(r.text);
  return r.ok ? 0 : 2;
}
