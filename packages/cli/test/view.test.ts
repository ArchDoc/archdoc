import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { startViewServer, type ViewServer } from "../src/index.js";

let tmp: string;
let repo: string;
let web: string;
let server: ViewServer | undefined;

beforeAll(async () => {
  tmp = await mkdtemp(join(tmpdir(), "archdoc-view-"));
  repo = join(tmp, "repo");
  web = join(tmp, "web");
  await mkdir(join(repo, ".archdoc"), { recursive: true });
  await mkdir(join(web, "assets"), { recursive: true });
  await writeFile(join(repo, ".archdoc", "archdoc.yaml"), 'archdoc: "2.0"\nnamespace: demo\n');
  await writeFile(join(web, "index.html"), "<!doctype html><title>explorer</title>");
  await writeFile(join(web, "assets", "app.js"), "console.log(1)");
});

afterEach(async () => {
  await server?.close();
  server = undefined;
});

afterAll(() => rm(tmp, { recursive: true, force: true }));

describe("view server", () => {
  it("says where each code snippet is, so the explorer links a symbol to its lines", async () => {
    const shop = join(tmp, "shop");
    await mkdir(join(shop, ".archdoc"), { recursive: true });
    await mkdir(join(shop, "src"), { recursive: true });
    await writeFile(
      join(shop, "src", "orders.ts"),
      "import x from 'y';\n\nexport function place() {\n  return x;\n}\n",
    );
    await writeFile(
      join(shop, ".archdoc", "archdoc.yaml"),
      'archdoc: "2.0"\nnamespace: shop\nelements:\n  orders:\n    kind: component\n    code:\n      - { path: src/orders.ts, symbol: place }\n      - { path: src/orders.ts, symbol: gone }\n',
    );
    server = await startViewServer({ target: ".", cwd: shop, webDir: web });
    const payload = (await (await fetch(`${server.url}/api/model`)).json()) as {
      snippets: Record<string, unknown>;
    };
    expect(payload.snippets).toEqual({
      "src/orders.ts##place": { start: 3, end: 5 },
      "src/orders.ts##gone": { problem: "doesn't declare gone" },
    });
  });

  it("refuses a model file as the base: the Diff reads the change from code", async () => {
    const examples = join(tmp, "examples");
    await mkdir(examples, { recursive: true });
    const model = (desc: string) =>
      `archdoc: "2.0"\nnamespace: shop\nelements:\n  web: { kind: container, description: ${desc} }\n`;
    await writeFile(join(examples, "shop.yaml"), model("Before"));
    await writeFile(join(examples, "shop.next.yaml"), model("After"));
    await expect(
      startViewServer({ target: "shop.next.yaml", cwd: examples, webDir: web, base: "shop.yaml" }),
    ).rejects.toThrow("archdoc diff shop.yaml");
    // A model file on its own sends no samples (simulation is hidden).
    await writeFile(join(examples, "buy.sample.json"), "{}");
    server = await startViewServer({ target: "shop.next.yaml", cwd: examples, webDir: web });
    const payload = (await (await fetch(`${server.url}/api/model`)).json()) as {
      samples?: unknown;
    };
    expect(payload.samples).toBeUndefined();
  });

  it("serves the model sources and the explorer", async () => {
    server = await startViewServer({ target: ".", cwd: repo, webDir: web });
    expect(server.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

    const model = await (await fetch(`${server.url}/api/model`)).json();
    expect(model).toMatchObject({
      root: ".archdoc/archdoc.yaml",
      watch: false,
      sources: [{ path: ".archdoc/archdoc.yaml" }],
    });

    const js = await fetch(`${server.url}/assets/app.js`);
    expect(js.headers.get("content-type")).toContain("text/javascript");
    // Unknown routes get the app shell.
    expect(await (await fetch(`${server.url}/journeys/x`)).text()).toContain("explorer");
  });

  it("refuses paths outside the explorer directory", async () => {
    server = await startViewServer({ target: ".", cwd: repo, webDir: web });
    const res = await fetch(`${server.url}/%2e%2e%2f%2e%2e%2frepo%2f.archdoc%2farchdoc.yaml`);
    expect(res.status).toBe(403);
  });

  it("answers 404 when there is no model", async () => {
    server = await startViewServer({ target: "web", cwd: tmp, webDir: web });
    expect(server.source).toBeUndefined();
    expect((await fetch(`${server.url}/api/model`)).status).toBe(404);
  });

  it("sends a change event when a model file changes, with --watch", async () => {
    server = await startViewServer({ target: ".", cwd: repo, webDir: web, watch: true });
    const res = await fetch(`${server.url}/api/events`);
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    const decoder = new TextDecoder();
    let text = decoder.decode((await reader.read()).value);
    expect(text).toContain(": connected");

    await writeFile(join(repo, ".archdoc", "actors.yaml"), "actors: { dev: { kind: person } }\n");
    while (!text.includes("event: change")) {
      const chunk = await reader.read();
      if (chunk.done) break;
      text += decoder.decode(chunk.value);
    }
    expect(text).toContain("event: change");
    await reader.cancel();

    const model = (await (await fetch(`${server.url}/api/model`)).json()) as {
      sources: { path: string }[];
    };
    expect(model.sources.map((s) => s.path)).toContain(".archdoc/actors.yaml");
  });
});

describe("view --detach", () => {
  // The built CLI: --detach starts it again in a process of its own (typecheck builds it).
  const bin = fileURLToPath(new URL("../dist/bin.js", import.meta.url));
  const detached = (cwd: string) =>
    new Promise<{ code: number; out: string; err: string }>((done) => {
      execFile(process.execPath, [bin, "view", "--detach"], { cwd }, (e, out, err) =>
        done({ code: typeof e?.code === "number" ? e.code : 0, out, err }),
      );
    });
  const pidOf = (out: string) => Number(/process (\d+)/.exec(out)?.[1]);

  it("prints the URL and returns, and reuses the explorer that's running", async () => {
    const first = await detached(repo);
    expect(first.code).toBe(0);
    const url = /ArchDoc explorer: (http:\/\/127\.0\.0\.1:\d+)/.exec(first.out)?.[1];
    const pid = pidOf(first.out);
    try {
      expect(url).toBeDefined();
      expect((await fetch(`${url}/api/model`)).ok).toBe(true);
      const again = await detached(repo);
      expect(again.out).toContain(`ArchDoc explorer: ${url} (already running, process ${pid})`);
    } finally {
      process.kill(pid);
    }
  });

  it("says why when there's no model, instead of returning with nothing", async () => {
    const r = await detached(tmp);
    expect(r.code).toBe(1);
    expect(r.err).toContain("No ArchDoc model at .");
  });
});

describe("view server plans", () => {
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${server?.url}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });

  it("starts a plan and applies the person's edits, as unread for the agent", async () => {
    server = await startViewServer({ target: ".", cwd: repo, webDir: web });
    const payload = (await (await fetch(`${server.url}/api/model`)).json()) as {
      editable: boolean;
    };
    expect(payload.editable).toBe(true);
    const started = await post("/api/plans", { title: "Add search", goal: "Let people search" });
    expect(started.status).toBe(200);
    const { id } = (await started.json()) as { id: string };
    expect(id).toBe("add-search");
    const edited = await post(`/api/plans/${id}`, {
      ops: [{ op: "put", list: "notes", item: { text: "Start small" } }],
    });
    expect(await edited.json()).toMatchObject({ ids: ["n1"] });
    const text = await readFile(join(repo, ".archdoc", "plans", `${id}.yaml`), "utf8");
    expect(text).toContain("what: added");
    const plans = (await (await fetch(`${server.url}/api/model`)).json()) as {
      plans: { path: string }[];
    };
    expect(plans.plans.map((p) => p.path)).toEqual([".archdoc/plans/add-search.yaml"]);
  });

  it("refuses another site, anything but JSON, and edits against a stale plan", async () => {
    server = await startViewServer({ target: ".", cwd: repo, webDir: web });
    const op = { ops: [{ op: "set", title: "Search" }] };
    expect(
      (await post("/api/plans/add-search", op, { origin: "https://evil.example" })).status,
    ).toBe(403);
    const form = await fetch(`${server.url}/api/plans/add-search`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: JSON.stringify(op),
    });
    expect(form.status).toBe(415);
    expect((await post("/api/plans/add-search", { ...op, base: "old text" })).status).toBe(409);
    expect((await fetch(`${server.url}/api/plans/add-search`)).status).toBe(405);
  });

  it("answers only at its local address, so a rebinding site can't reach it", async () => {
    server = await startViewServer({ target: ".", cwd: repo, webDir: web });
    const { port } = new URL(server.url);
    const status = (host: string, method = "GET", path = "/api/model") =>
      new Promise<number>((resolveStatus, reject) => {
        const body = method === "POST" ? JSON.stringify({ goal: "Steal it" }) : undefined;
        const req = request(
          {
            host: "127.0.0.1",
            port,
            path,
            method,
            headers: {
              host,
              ...(body ? { "content-type": "application/json", origin: `http://${host}` } : {}),
            },
          },
          (res) => {
            res.resume();
            resolveStatus(res.statusCode ?? 0);
          },
        );
        req.on("error", reject);
        req.end(body);
      });
    // Same-origin to the browser, since the page's own name now points at 127.0.0.1.
    expect(await status(`evil.example:${port}`, "POST", "/api/plans")).toBe(403);
    expect(await status(`evil.example:${port}`, "POST", "/api/triage")).toBe(403);
    expect(await status(`evil.example:${port}`)).toBe(403);
    expect(await status(`127.0.0.1:${port}`)).toBe(200);
    expect(await status(`localhost:${port}`)).toBe(200);
    // The explorer's dev server proxies from its own port.
    expect(await status("localhost:5173")).toBe(200);
  });
});
