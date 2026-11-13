import { existsSync, type FSWatcher, watch } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  codeChange,
  contextOf,
  importSchemas,
  planEditAnswer,
  planStartAnswer,
  type Snapshot,
  sealReport,
  snapshot,
  triageSendAnswer,
  triageStartAnswer,
} from "@archdoc/analyzers";
import {
  buildModel,
  isSnippet,
  listBranches,
  loadPlans,
  PLAN_DIR,
  type PlanEditOp,
  type RepoInfo,
  readFederationInput,
  readModelSources,
  readPlanSources,
  repoInfo,
  resolveGitRef,
  resolveSnippets,
  TRIAGE_DIRS,
} from "@archdoc/core";
import { landscapePayload, loadLandscape } from "./landscape.js";
import { isModelPath } from "./model-path.js";

export interface ViewServerOptions {
  /** Repository, .archdoc directory, or model file. */
  target: string;
  cwd: string;
  /** 0 picks a free port. */
  port?: number;
  host?: string;
  /** Watch the model files and tell the explorer to reload when they change. */
  watch?: boolean;
  /** Directory with the built explorer. Found automatically when omitted. */
  webDir?: string;
  /** Also send the model as it was at this ref, for the explorer's before/after view. */
  base?: string;
  /** Send the landscape: this model composed with every model it imports. */
  landscape?: boolean;
}

export interface ViewServer {
  url: string;
  /** Absolute directory (or file) being served and watched. */
  source?: string | undefined;
  close(): Promise<void>;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

/**
 * Serves the explorer and the model to it. The browser builds the model from
 * the raw files with @archdoc/core, so the CLI and the explorer always agree.
 * Listens on localhost only.
 */
export async function startViewServer(options: ViewServerOptions): Promise<ViewServer> {
  const webDir = options.webDir ?? findWebDir();
  const watching = options.watch === true;
  const clients = new Set<ServerResponse>();
  const initial = await readModelSources(options.target, { cwd: options.cwd });
  const cwd = options.cwd;
  if (options.base && isModelPath(cwd, options.base)) {
    throw new Error(
      `The explorer's Diff reads the change from code, so --base takes a branch, not a model file. Compare model files with archdoc diff ${options.base}.`,
    );
  }
  if (options.base && !(await resolveGitRef(cwd, options.base))) {
    throw new Error(`"${options.base}" is not a commit, branch, or tag in this repository.`);
  }

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    try {
      if (url.pathname === "/api/model" && options.landscape) {
        const { model, composed } = await loadLandscape(options.target, options.cwd);
        return json(res, 200, await landscapePayload(model, composed, watching));
      }
      if (url.pathname === "/api/model") {
        const body = await modelResponse({ target: options.target, cwd, base: options.base });
        if (!body) {
          return json(res, 404, {
            error: `No ArchDoc model found at ${options.target}. Expected .archdoc/archdoc.yaml. Run archdoc init to start one.`,
          });
        }
        // The view server can write plans; a published site can't.
        return json(res, 200, { ...body, watch: watching, editable: true });
      }
      if (url.pathname === "/api/plans" || url.pathname.startsWith("/api/plans/")) {
        return await planRoute(req, res, url, { target: options.target, cwd });
      }
      if (url.pathname === "/api/triage" || url.pathname.startsWith("/api/triage/")) {
        return await triageRoute(req, res, url, { target: options.target, cwd });
      }
      if (url.pathname === "/api/refs") {
        const { current, branches } = await listBranches(options.cwd);
        return json(res, 200, { current, branches, base: options.base });
      }
      if (url.pathname === "/api/compare") {
        // Only branches (and the --base the server started with), never arbitrary git arguments.
        const allowed = new Set((await listBranches(cwd)).branches);
        if (options.base) allowed.add(options.base);
        const ref = (name: string) => {
          const value = url.searchParams.get(name);
          if (value === null || value === "") return undefined;
          if (!allowed.has(value))
            throw new RangeError(`"${value}" is not a branch in this repository.`);
          return value;
        };
        try {
          const base = ref("base");
          if (!base) return json(res, 400, { error: "Pick the branch to compare with." });
          const head = ref("head");
          // The code changed on head since it left base, read into head's model.
          const compared = await comparison(options.target, cwd, base, head);
          if (!compared) return json(res, 404, { error: "No ArchDoc model here." });
          return json(res, 200, compared);
        } catch (err) {
          if (err instanceof RangeError) return json(res, 400, { error: err.message });
          throw err;
        }
      }
      if (url.pathname === "/api/events") {
        if (!watching) return json(res, 404, { error: "Start with --watch for live reload." });
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        res.write(": connected\n\n");
        clients.add(res);
        req.on("close", () => clients.delete(res));
        return;
      }
      if (!webDir) {
        res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        return res.end(
          "The explorer isn't built. In the ArchDoc repo, run `pnpm build`, or set ARCHDOC_WEB_DIR.",
        );
      }
      return await serveStatic(webDir, url.pathname, res);
    } catch (err) {
      if (!res.headersSent)
        json(res, 500, { error: err instanceof Error ? err.message : String(err) });
      else res.end();
    }
  });

  let watcher: FSWatcher | undefined;
  const heartbeat = setInterval(() => {
    for (const c of clients) c.write(": ping\n\n");
  }, 25_000);
  heartbeat.unref();

  if (watching && initial) {
    let timer: NodeJS.Timeout | undefined;
    const notify = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        for (const c of clients) c.write("event: change\ndata: {}\n\n");
      }, 80);
    };
    const isFile = (await stat(initial.source)).isFile();
    const dir = isFile ? dirname(initial.source) : initial.source;
    watcher = watch(dir, { recursive: !isFile }, (_event, name) => {
      if (isFile && name !== basename(initial.source)) return;
      if (name && !/\.ya?ml$/.test(String(name))) return;
      notify();
    });
  }

  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, options.host ?? "127.0.0.1", () => resolveListen());
  });
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://${options.host ?? "127.0.0.1"}:${port}`,
    source: initial?.source,
    close: async () => {
      clearInterval(heartbeat);
      watcher?.close();
      for (const c of clients) c.end();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

/** The most a plan edit's body can be. */
const MAX_BODY = 1024 * 1024;

/**
 * Writes plans for the explorer's Plan tab: POST /api/plans starts one, POST
 * /api/plans/<id> applies edit ops to one. Only JSON from this page (a form
 * on another site can't send it), and only against the text the page last
 * saw, so the person and the agent never write over each other.
 */
async function planRoute(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  where: { target: string; cwd: string },
) {
  const body = await jsonBody(req, res, "Plans");
  if (!body) return;
  const by = typeof body.by === "string" && body.by ? body.by : "human";
  const w = { model: where.target, cwd: where.cwd };
  if (url.pathname === "/api/plans") {
    const goal = typeof body.goal === "string" ? body.goal : "";
    const title = typeof body.title === "string" ? body.title : undefined;
    const r = await planStartAnswer(w, { goal: goal || title || "", title, by });
    if (!r.ok) return json(res, 400, { error: r.text });
    return json(res, 200, { id: r.id, text: r.text });
  }
  const id = decodeURIComponent(url.pathname.slice("/api/plans/".length));
  const ops = Array.isArray(body.ops) ? (body.ops as PlanEditOp[]) : undefined;
  if (!ops?.length) return json(res, 400, { error: "Give the ops." });
  if (typeof body.base === "string") {
    const sources = await readPlanSources(where.target, { cwd: where.cwd });
    const file = loadPlans(sources).plans.find((p) => p.id === id)?.file;
    const now = sources.find((p) => p.path === file);
    if (now && now.text !== body.base)
      return json(res, 409, {
        error:
          "The plan changed since this page read it (the agent may have answered). Reload and try again.",
        text: now.text,
      });
  }
  const r = await planEditAnswer(w, { id, ops, by, track: true });
  if (!r.ok) return json(res, 400, { error: r.text });
  return json(res, 200, { ids: r.ids ?? [], text: r.text });
}

/**
 * Sends bugs to the agent from the explorer's Triage tab: POST /api/triage
 * starts a record from the pasted bug, marked sent; POST /api/triage/<id>
 * sends one again, with what the person asks now. The same guards as plans.
 */
async function triageRoute(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  where: { target: string; cwd: string },
) {
  const body = await jsonBody(req, res, "Triage records");
  if (!body) return;
  const w = { model: where.target, cwd: where.cwd };
  const ask = typeof body.ask === "string" ? body.ask : undefined;
  if (url.pathname === "/api/triage") {
    const symptom = typeof body.symptom === "string" ? body.symptom : "";
    // Until the agent names it, the bug's first line is its title.
    const first = symptom.trim().split("\n")[0]?.trim() ?? "";
    const title =
      typeof body.title === "string" && body.title.trim()
        ? body.title
        : first
          ? first.length > 80
            ? `${first.slice(0, 77)}…`
            : first
          : undefined;
    const r = await triageStartAnswer(w, { symptom, title, send: { ask } });
    if (!r.ok) return json(res, 400, { error: r.text });
    return json(res, 200, { id: r.id, text: r.text });
  }
  const id = decodeURIComponent(url.pathname.slice("/api/triage/".length));
  const r = await triageSendAnswer(w, { id, ask });
  if (!r.ok) return json(res, 400, { error: r.text });
  return json(res, 200, { id, text: r.text });
}

/** A JSON POST from the explorer itself, or undefined once it has answered with why not. */
async function jsonBody(
  req: IncomingMessage,
  res: ServerResponse,
  what: string,
): Promise<Record<string, unknown> | undefined> {
  if (req.method !== "POST") {
    json(res, 405, { error: `${what} are changed with POST.` });
    return undefined;
  }
  const origin = req.headers.origin;
  if (origin && new URL(origin).host !== req.headers.host) {
    json(res, 403, { error: `${what} can only be changed from the explorer itself.` });
    return undefined;
  }
  if (!String(req.headers["content-type"] ?? "").startsWith("application/json")) {
    json(res, 415, { error: "Send JSON." });
    return undefined;
  }
  try {
    return JSON.parse(await readBody(req)) as Record<string, unknown>;
  } catch (err) {
    json(res, 400, { error: err instanceof Error ? err.message : String(err) });
    return undefined;
  }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error("The request is too big."));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolveBody(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function serveStatic(root: string, pathname: string, res: ServerResponse) {
  const base = resolve(root);
  let file = resolve(base, `.${decodeURIComponent(pathname)}`);
  if (file !== base && !file.startsWith(base + sep)) {
    res.writeHead(403);
    return res.end();
  }
  const info = await stat(file).catch(() => undefined);
  // Unknown paths fall back to the app shell.
  if (!info?.isFile()) file = join(base, "index.html");
  const body = await readFile(file);
  res.writeHead(200, {
    "content-type": TYPES[extname(file)] ?? "application/octet-stream",
    "cache-control": file.includes(`${sep}assets${sep}`)
      ? "public, max-age=31536000, immutable"
      : "no-cache",
  });
  res.end(body);
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

/**
 * The built explorer: ARCHDOC_WEB_DIR, the workspace build (when running from a
 * clone), or the copy that `prepack` puts next to the published CLI.
 */
export function findWebDir(): string | undefined {
  const candidates = [
    process.env.ARCHDOC_WEB_DIR,
    fileURLToPath(new URL("../../../apps/web/dist/", import.meta.url)),
    fileURLToPath(new URL("../web/", import.meta.url)),
  ];
  return candidates.find((d): d is string => !!d && existsSync(join(d, "index.html")));
}

/**
 * What /api/model sends, and what `archdoc site` writes: the working tree's
 * model, and with `base`, the code changed since the merge base with it, read
 * into this model, so the Diff tab opens on it.
 */
export async function modelResponse(options: {
  target: string;
  cwd: string;
  base?: string | undefined;
}) {
  const snap = await snapshot(options.target, { cwd: options.cwd });
  if (!snap) return undefined;
  const repo = { ...(await repoInfo(snap.baseDir)), root: snap.baseDir };
  const body = { ...(await payloadOf(snap, repo, options.cwd)), seals: await sealsOf(options) };
  if (!options.base) return body;
  if (isModelPath(options.cwd, options.base)) {
    throw new Error(
      `The Diff reads the change from code, so --base takes a branch, not a model file. Compare model files with archdoc diff ${options.base}.`,
    );
  }
  const compared = await comparison(options.target, options.cwd, options.base, undefined);
  return compared ? { ...body, change: compared.change } : body;
}

/**
 * The working tree's seals, for the explorer: the facts whose code changed
 * since they were sealed, and the ones no one has sealed. Undefined when the
 * repository doesn't keep an archdoc.sum.
 */
async function sealsOf(options: { target: string; cwd: string }) {
  const r = await sealReport(options.target, options.cwd).catch(() => undefined);
  if (!r || (!r.recorded && !r.error)) return undefined;
  return {
    file: r.file,
    error: r.error,
    total: r.statuses.length,
    facts: r.statuses
      .filter((s) => s.state !== "sealed")
      .map((s) => ({
        key: s.fact.key,
        label: s.fact.label,
        state: s.state,
        element: s.fact.element,
        refs: s.fact.refs,
        changes: s.changes,
        location: s.fact.location,
      })),
  };
}

/**
 * The code changed on `head` (or the working tree) since it left `base`, read
 * into head's model, and head's model when it isn't the working tree. Base's
 * model is never read: the change comes from the code alone.
 */
async function comparison(target: string, cwd: string, base: string, head: string | undefined) {
  const headSnap = head ? await snapshot(target, { cwd, ref: head }) : undefined;
  if (head && !headSnap) return undefined;
  const read = await codeChange({ model: target, cwd, base, head });
  const linksAt = async (s: Snapshot) => ({
    webUrl: (await repoInfo(s.baseDir)).webUrl,
    commit: s.commit,
  });
  return {
    head: headSnap && { ref: head, ...(await payloadOf(headSnap, await linksAt(headSnap), cwd)) },
    change: {
      base,
      head,
      commit: read.commit,
      findings: read.findings,
      changedFiles: read.changedFiles,
      code: read.change,
    },
  };
}

/** What the explorer needs to build and show one version of the model. */
async function payloadOf(
  snap: Snapshot,
  repo: RepoInfo & { root?: string | undefined },
  cwd: string,
) {
  const model = snap.sources.length
    ? buildModel(snap.sources, { root: snap.root })
    : buildModel([]);
  const inRepo = new Set(snap.files);
  const readRel = (path: string) =>
    inRepo.has(path) ? snap.read(path) : Promise.resolve(undefined);
  // Snippets are found synchronously, so read the files they're in first.
  const snippetFiles = new Map<string, string | undefined>();
  for (const e of model.elements.values()) {
    for (const ref of e.code) {
      if (isSnippet(ref) && !snippetFiles.has(ref.path)) {
        snippetFiles.set(ref.path, await readRel(ref.path));
      }
    }
  }
  const federation = await readFederationInput(snap.fedDir, cwd, (file) => {
    const rel = relative(snap.baseDir, file).replace(/\\/g, "/");
    return rel.startsWith("..") ? Promise.resolve(undefined) : snap.read(rel);
  });
  return {
    ...(snap.commit ? { commit: snap.commit } : {}),
    root: snap.root,
    sources: snap.sources,
    files: snap.files,
    // Where each code snippet is, so the explorer links a symbol to its lines.
    snippets: resolveSnippets(model, (path) => snippetFiles.get(path)),
    // Other repos' models, so the explorer checks across repos like the CLI.
    federation: {
      lockPath: federation.lockPath,
      lock: federation.lock,
      lockError: federation.lockError,
      bundles: [...federation.bundles].map(([key, b]) => ({ key, ...b })),
    },
    // Triage records beside the model, for the explorer's Triage tab. Never part of the model.
    traces: await readTraces(snap),
    // Plans beside the model, for the explorer's Plan tab. Never part of the model.
    plans: await readPlans(snap),
    // What data entries' schema sources say (types, values, foreign keys), as check reads them.
    schemas: (await importSchemas(contextOf(snap), model)).filter((s) => !s.error),
    repo,
  };
}

/** The Triage records in the model directory's triage/, as the snapshot has them. */
async function readTraces(snap: Snapshot): Promise<{ path: string; text: string }[]> {
  const dirs = TRIAGE_DIRS.map((d) =>
    relative(snap.baseDir, join(snap.source, d)).replace(/\\/g, "/"),
  ).filter((d) => !d.startsWith(".."));
  const out: { path: string; text: string }[] = [];
  for (const path of snap.files.filter(
    (f) => dirs.some((d) => f.startsWith(`${d}/`)) && /\.ya?ml$/.test(f),
  )) {
    const text = await snap.read(path);
    if (text !== undefined) out.push({ path, text });
  }
  return out;
}

/** The plans in the model directory's plans/, as the snapshot has them. */
async function readPlans(snap: Snapshot): Promise<{ path: string; text: string }[]> {
  const dir = relative(snap.baseDir, join(snap.source, PLAN_DIR)).replace(/\\/g, "/");
  if (dir.startsWith("..")) return [];
  const out: { path: string; text: string }[] = [];
  for (const path of snap.files.filter((f) => f.startsWith(`${dir}/`) && /\.ya?ml$/.test(f))) {
    const text = await snap.read(path);
    if (text !== undefined) out.push({ path, text });
  }
  return out;
}
