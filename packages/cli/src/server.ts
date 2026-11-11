import { existsSync, type FSWatcher, watch } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  codeChange,
  contextOf,
  importSchemas,
  type Snapshot,
  sealReport,
  snapshot,
} from "@archdoc/analyzers";
import {
  buildModel,
  isSnippet,
  listBranches,
  type RepoInfo,
  readFederationInput,
  readModelSources,
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
        return json(res, 200, { ...body, watch: watching });
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
    // What data entries' schema sources say (types, values, foreign keys), as check reads them.
    schemas: (await importSchemas(contextOf(snap), model)).filter((s) => !s.error),
    repo,
  };
}

/** The Triage records in the model directory's triage/ (and traces/, before 0.8), as the snapshot has them. */
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
