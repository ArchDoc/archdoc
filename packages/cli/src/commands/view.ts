import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Io } from "../io.js";
import { startViewServer, type ViewServer } from "../server.js";

export interface ViewOptions {
  watch?: boolean;
  /** Show changes since this ref. */
  base?: string;
  /** Show the composed landscape. */
  landscape?: boolean;
  port?: string;
  open?: boolean;
  /**
   * Start the explorer in a process of its own, print its URL, and return:
   * for agents whose shell can't keep a command running in the background.
   * One already running on the same model and options is reused.
   */
  detach?: boolean;
}

/** Where a detached explorer says it's listening, by the model and options it serves. */
export interface DetachedState {
  pid: number;
  url: string;
  source: string;
}

/** How long a detached explorer gets to say it's listening (npx may still be unpacking). */
const DETACH_WAIT_MS = 20_000;

/** Starts the explorer. Resolves once the server is listening; it runs until the process ends. */
export async function view(
  target: string,
  options: ViewOptions,
  io: Io,
): Promise<{ code: number; server?: ViewServer }> {
  const port = options.port === undefined ? 0 : Number(options.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    io.err(`--port must be a number from 0 to 65535 (0 picks a free port).`);
    return { code: 1 };
  }
  if (options.detach) return detach(target, options, io);
  let server: ViewServer;
  try {
    server = await startViewServer({
      target,
      cwd: io.cwd,
      port,
      watch: options.watch,
      base: options.base,
      landscape: options.landscape,
    });
  } catch (err) {
    io.err(`Couldn't start the explorer: ${err instanceof Error ? err.message : String(err)}`);
    return { code: 1 };
  }
  if (!server.source) {
    io.err(
      `No ArchDoc model at ${target}. Expected .archdoc/archdoc.yaml. Run archdoc init to start one.`,
    );
    await server.close();
    return { code: 1 };
  }

  const what = relative(io.cwd, server.source) || ".";
  io.out(
    `ArchDoc explorer: ${server.url}${options.landscape ? " (the landscape)" : ""}${options.base ? ` (showing changes since ${options.base})` : ""}`,
  );
  io.out(
    options.watch
      ? `Watching ${what} for changes. Press Ctrl+C to stop.`
      : `Serving ${what}. Press Ctrl+C to stop.`,
  );
  if (options.open) openBrowser(server.url);
  // Started by --detach: say where it listens, for the process that started it.
  const state = process.env.ARCHDOC_VIEW_STATE;
  if (state) {
    const said: DetachedState = { pid: process.pid, url: server.url, source: server.source };
    writeFileSync(state, JSON.stringify(said));
    const forget = () => {
      try {
        rmSync(state, { force: true });
      } catch {
        // Gone already.
      }
    };
    process.once("exit", forget);
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
      process.once(signal, () => {
        forget();
        process.exit(0);
      });
    }
  }
  return { code: 0, server };
}

/** The file a detached explorer for this model and these options writes its URL to. */
export function detachedStateFile(target: string, options: ViewOptions, cwd: string): string {
  const key = JSON.stringify([
    resolve(cwd, target),
    options.base ?? "",
    options.landscape === true,
    options.watch === true,
    options.port ?? "",
  ]);
  const hash = createHash("sha256").update(key).digest("hex").slice(0, 16);
  return join(tmpdir(), "archdoc-view", `${hash}.json`);
}

/**
 * Starts the explorer in a process of its own and waits for it to listen,
 * then prints its URL and returns, so a shell that can't run a command in the
 * background still gets the URL. Reuses one that's already running.
 */
async function detach(
  target: string,
  options: ViewOptions,
  io: Io,
): Promise<{ code: number; server?: ViewServer }> {
  const stateFile = detachedStateFile(target, options, io.cwd);
  const running = await alive(stateFile);
  if (running) {
    io.out(`ArchDoc explorer: ${running.url} (already running, process ${running.pid})`);
    io.out(stopLine(running.pid));
    if (options.open) openBrowser(running.url);
    return { code: 0 };
  }
  mkdirSync(join(tmpdir(), "archdoc-view"), { recursive: true });
  rmSync(stateFile, { force: true });
  const logFile = stateFile.replace(/\.json$/, ".log");
  const log = openSync(logFile, "w");
  const args = [fileURLToPath(new URL("../bin.js", import.meta.url)), "view", target];
  if (options.watch) args.push("--watch");
  if (options.base) args.push("--base", options.base);
  if (options.landscape) args.push("--landscape");
  if (options.port) args.push("--port", options.port);
  if (options.open) args.push("--open");
  const child = spawn(process.execPath, args, {
    cwd: io.cwd,
    detached: true,
    stdio: ["ignore", log, log],
    env: { ...process.env, ARCHDOC_VIEW_STATE: stateFile },
    windowsHide: true,
  });
  closeSync(log);
  let exited: number | null | undefined;
  child.on("exit", (code) => {
    exited = code;
  });
  child.on("error", () => {
    exited = 1;
  });
  child.unref();
  const deadline = Date.now() + DETACH_WAIT_MS;
  while (Date.now() < deadline) {
    const state = readState(stateFile);
    if (state) {
      const what = relative(io.cwd, state.source) || ".";
      io.out(
        `ArchDoc explorer: ${state.url}${options.base ? ` (showing changes since ${options.base})` : ""}`,
      );
      io.out(
        `Serving ${what}${options.watch ? ", and updating as it changes" : ""}, in the background (process ${state.pid}).`,
      );
      io.out(stopLine(state.pid));
      return { code: 0 };
    }
    if (exited !== undefined) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  const said = readText(logFile).trim();
  io.err(
    exited !== undefined
      ? said || "The explorer stopped before it started."
      : `The explorer didn't start within ${DETACH_WAIT_MS / 1000} seconds.${said ? `\n${said}` : ""}`,
  );
  if (exited === undefined) {
    try {
      process.kill(child.pid as number);
    } catch {
      // Already gone.
    }
  }
  return { code: 1 };
}

function stopLine(pid: number): string {
  return process.platform === "win32"
    ? `Stop it with: taskkill /PID ${pid}`
    : `Stop it with: kill ${pid}`;
}

function readText(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function readState(path: string): DetachedState | undefined {
  try {
    const s = JSON.parse(readFileSync(path, "utf8")) as DetachedState;
    return typeof s.pid === "number" && typeof s.url === "string" ? s : undefined;
  } catch {
    return undefined;
  }
}

/** The explorer a state file names, if its process is still running and answers. */
async function alive(path: string): Promise<DetachedState | undefined> {
  const s = readState(path);
  if (!s) return undefined;
  try {
    process.kill(s.pid, 0);
  } catch {
    rmSync(path, { force: true });
    return undefined;
  }
  try {
    const r = await fetch(`${s.url}/api/model`, { signal: AbortSignal.timeout(2000) });
    if (r.ok) return s;
  } catch {
    // Not answering: start another.
  }
  return undefined;
}

function openBrowser(url: string) {
  const [cmd, args] =
    process.platform === "darwin"
      ? ["open", [url]]
      : process.platform === "win32"
        ? ["cmd", ["/c", "start", "", url]]
        : ["xdg-open", [url]];
  spawn(cmd, args, { stdio: "ignore", detached: true })
    .on("error", () => {})
    .unref();
}
