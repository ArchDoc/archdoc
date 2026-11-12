import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  type PlanListInput,
  planListAnswer,
  planReadAnswer,
  planRespondAnswer,
  planStartAnswer,
  planTaskAnswer,
  planWaitAnswer,
} from "@archdoc/analyzers";
import type { PlanEditOp } from "@archdoc/core";
import type { Io } from "../io.js";
import { readStdin } from "./stdin.js";

const STATUSES = ["drafting", "reviewing", "ready", "executing", "done", "abandoned"] as const;
const TASK_STATUSES = ["todo", "doing", "done", "skipped"] as const;

type Answer = { ok: boolean; text: string; failing?: boolean | undefined };

function print(r: Answer, io: Io): number {
  (r.ok ? io.out : io.err)(r.text);
  return r.ok ? (r.failing ? 1 : 0) : 2;
}

export interface PlanStartOptions {
  model?: string;
  title?: string;
  id?: string;
  by?: string;
  path?: string[];
  dryRun?: boolean;
}

/** `archdoc plan start <goal…>`: a new plan from the person's idea. */
export async function planStart(
  words: string[],
  options: PlanStartOptions,
  io: Io,
  stdin: () => Promise<string> = readStdin,
): Promise<number> {
  const goal = words.length === 1 && words[0] === "-" ? await stdin() : words.join(" ");
  return print(
    await planStartAnswer(
      { model: options.model, cwd: io.cwd },
      {
        goal,
        title: options.title,
        id: options.id,
        by: options.by,
        paths: options.path,
        dryRun: options.dryRun,
      },
    ),
    io,
  );
}

/** `archdoc plan list`: the plans and what's open in each. */
export async function planList(
  options: { model?: string; status?: string },
  io: Io,
): Promise<number> {
  const s = options.status;
  if (s && s !== "open" && !(STATUSES as readonly string[]).includes(s)) {
    io.err(`--status must be one of ${STATUSES.join(", ")}, or open.`);
    return 2;
  }
  return print(
    await planListAnswer(
      { model: options.model, cwd: io.cwd },
      { status: s as PlanListInput["status"] },
    ),
    io,
  );
}

/** `archdoc plan read <id>`: the plan, what changed since the last read first. */
export async function planRead(
  id: string,
  options: { model?: string; peek?: boolean },
  io: Io,
): Promise<number> {
  return print(
    await planReadAnswer({ model: options.model, cwd: io.cwd }, { id, peek: options.peek }),
    io,
  );
}

/** `archdoc plan wait <id>`: blocks until the person sends the plan, then reads it. */
export async function planWait(
  id: string,
  options: { model?: string; timeout?: string },
  io: Io,
): Promise<number> {
  const timeout = options.timeout === undefined ? undefined : Number(options.timeout);
  if (timeout !== undefined && !(timeout > 0)) {
    io.err("--timeout is a number of seconds.");
    return 2;
  }
  return print(await planWaitAnswer({ model: options.model, cwd: io.cwd }, { id, timeout }), io);
}

/** `archdoc plan respond <id> <ops>`: the agent's notes, suggestions, and tasks, as JSON ops. */
export async function planRespond(
  id: string,
  ops: string | undefined,
  options: { model?: string; file?: string; by?: string },
  io: Io,
  stdin: () => Promise<string> = readStdin,
): Promise<number> {
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
      'Give the ops as JSON, such as \'{"op":"put","list":"notes","item":{"on":"c1","kind":"question","text":"…"}}\', or --file ops.json.',
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
  const list = (Array.isArray(parsed) ? parsed : [parsed]) as PlanEditOp[];
  return print(
    await planRespondAnswer(
      { model: options.model, cwd: io.cwd },
      { id, ops: list, by: options.by },
    ),
    io,
  );
}

/** `archdoc plan task <id> <task> --status done`: a task's progress while the plan is carried out. */
export async function planTask(
  id: string,
  task: string,
  options: { model?: string; status?: string; note?: string },
  io: Io,
): Promise<number> {
  const status = options.status ?? "done";
  if (!(TASK_STATUSES as readonly string[]).includes(status)) {
    io.err(`--status must be one of ${TASK_STATUSES.join(", ")}.`);
    return 2;
  }
  return print(
    await planTaskAnswer(
      { model: options.model, cwd: io.cwd },
      { id, task, status: status as (typeof TASK_STATUSES)[number], note: options.note },
    ),
    io,
  );
}
