import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, posix } from "node:path";
import {
  buildModel,
  type CodeIndex,
  isDevTooling,
  isVerificationCode,
  listRepoFiles,
  locate,
  observedEdges,
} from "@archdoc/core";
import { parse, stringify } from "yaml";
import { type AnalyzerContext, contextFor } from "./api.js";
import { analyze } from "./run.js";
import { indexCode } from "./symbols.js";

/**
 * A starting model for a repository that has none, from what the repository
 * declares: containers for packages and modules from their manifests,
 * components for the directories (or, in a flat package, the files) inside
 * each, and code for the files and functions inside each component;
 * datastores and queues from compose files; uses, at every level, from the
 * dependencies the analyzers see; and data
 * and contracts from schema files. Deterministic: no LLM, no network. Every
 * fact is marked inferred, for a person (or an agent) to review. What can't
 * be inferred (who uses the system, and how) is left for them to add.
 */
export interface InitResult {
  /** Files to write, relative to the repository. */
  files: { path: string; text: string }[];
  stats: {
    /** Containers. */
    elements: number;
    /** Components inside the containers. */
    components: number;
    /** Code (files, functions, classes) inside the components. */
    code: number;
    /** Uses at every level: between containers, components, and code. */
    uses: number;
    datastores: number;
    contracts: number;
    data: number;
    /** Source files an element claims, of all source files. */
    coverage: { claimed: number; total: number };
  };
  /** Problems the model would have; init writes nothing when there are errors. */
  problems: string[];
}

interface Unit {
  key: string;
  dir: string;
  kind: "container" | "component" | "code" | "datastore" | "queue";
  description?: string | undefined;
  technology?: string | undefined;
  /** Code paths; datastores and queues from images have none. */
  code: string[];
  /** The declaration a code element points at, in its one file. */
  symbol?: string | undefined;
  uses: Map<string, string>;
  provides: string[];
  stores: Map<string, { entity: string }>;
  /** Children: a container's components, a component's code. */
  components: Unit[];
  source: string;
  /** Run by a compose file. */
  composed?: boolean | undefined;
}

const INFERRED = { source: "inferred", by: "archdoc init" } as const;
const YAML = { lineWidth: 0, aliasDuplicateObjects: false } as const;
const SKIP_DIR =
  /(^|\/)(node_modules|dist|build|out|target|vendor|coverage|\.git|\.archdoc|examples?|fixtures?|tests?|__tests__|testdata|templates?|docs?)(\/|$)/;
const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs|go|rs|py|java|kt|rb|cs|php|swift|scala|ex|exs)$/;
const CODE_ROOTS = ["apps", "services", "packages", "cmd", "libs", "lib", "src", "internal"];
/** Where a package keeps its source, looked through to find its parts. */
const SOURCE_ROOTS = ["src", "lib", "internal", "pkg"];
/** Where a repository keeps what isn't an app or a library, but still ships. */
const TOOL_ROOTS = ["integrations", "plugins", "extensions", "tools", "actions"];

/** What `archdoc init` writes, without writing it. */
export async function inferModel(root: string, name?: string): Promise<InitResult> {
  // Tests, test helpers, mocks, fixtures, benchmarks, and smoke checks aren't
  // architecture: left out, they make no containers, components, or uses.
  const files = (await listRepoFiles(root)).filter(
    (f) => !f.startsWith(".archdoc/") && !isVerificationCode(f),
  );
  const ctx = contextFor(root, files);
  const units: Unit[] = [];
  const add = (u: Omit<Found, "key">, key: string) => {
    const unit: Unit = {
      ...u,
      key: uniqueKey(units, key),
      uses: new Map(),
      provides: [],
      stores: new Map(),
      components: [],
    };
    units.push(unit);
    return unit;
  };

  // 1. Packages and modules, from their manifests.
  for (const m of await manifests(ctx)) add(m, m.key);
  // Directories under the conventional roots that no manifest claims, such as
  // an integration written in Markdown and YAML, or code without a manifest.
  const claimedBy = (f: string) => ownerOf(units, f) && units.length > 0;
  for (const dir of codeDirs(files, "", (f) => !claimedBy(f))) {
    add(await directoryUnit(ctx, dir), basename(dir));
  }
  // Nothing to split it by: the repository is one container.
  if (!units.some((u) => u.kind === "container")) {
    const whole = await directoryUnit(ctx, "");
    add(
      { ...whole, source: "the whole repository, until you know its parts" },
      name ?? (await rootName(ctx)) ?? basename(root),
    );
  }
  // Build, release, and maintenance scripts at the top, which no package claims.
  for (const dir of ["scripts", "tools", "bin"]) {
    const inside = files.filter((f) => f.startsWith(`${dir}/`) && SOURCE.test(f));
    if (inside.length >= 2 && !inside.some((f) => ownerOf(units, f)?.dir)) {
      add({ ...(await directoryUnit(ctx, dir)), source: `the ${dir} the repository runs` }, dir);
    }
  }

  // Components inside each container, and code inside each component.
  const index = await indexCode(ctx).catch(
    (): CodeIndex => ({ files: [...ctx.files], sources: [] }),
  );
  const exportsOf = new Map(index.sources.map((s) => [s.path, s.exports]));
  for (const unit of units.filter((u) => u.kind === "container" && u.code.length)) {
    const sources = files.filter(
      (f) => isSource(f) && inside(unit.dir, f) && ownerOf(units, f) === unit,
    );
    unit.components = components(unit.dir, sources, exportsOf);
  }

  // 2. Datastores, queues, and dependencies, from compose files.
  await compose(ctx, units, add);

  // 3. Uses, from the dependencies analyzers see, mapped onto the elements the
  // way archdoc check maps them, and declared at the level where the two
  // sides part: between containers, between the components of one container,
  // or between the code of one component. check then finds every import declared.
  const draft = buildModel(
    [{ path: ".archdoc/archdoc.yaml", text: stringify(modelDoc("x", units), YAML) }],
    {
      root: ".archdoc/archdoc.yaml",
    },
  );
  const byId = new Map<string, Unit>();
  const walk = (list: Unit[], prefix: string) => {
    for (const u of list) {
      byId.set(`${prefix}${u.key}`, u);
      walk(u.components, `${prefix}${u.key}.`);
    }
  };
  walk(units, "");
  const deps = (await analyze(ctx)).filter((d) => !isDevTooling(d));
  for (const e of observedEdges(draft, deps)) {
    if (e.declared) continue;
    const a = e.from.split(".");
    const b = e.to.split(".");
    let n = 0;
    while (a[n] === b[n]) n++;
    const from = byId.get(a.slice(0, n + 1).join("."));
    const to = byId.get(b.slice(0, n + 1).join("."));
    if (!from || !to || from === to || from.uses.has(to.key)) continue;
    from.uses.set(to.key, `Imports ${e.dependencies[0]?.specifier ?? to.key}`);
  }

  // 4. Data and contracts, from schema files.
  const data = await schemas(ctx, units, add);

  // The model, as YAML, and checked before it's written.
  const namespace = sanitize(name ?? (await rootName(ctx)) ?? basename(root));
  const doc = modelDoc(namespace, units);
  const files_: InitResult["files"] = [
    { path: ".archdoc/archdoc.yaml", text: HEADER + stringify(doc, YAML) + NEXT },
  ];
  if (Object.keys(data).length) {
    files_.push({
      path: ".archdoc/data.yaml",
      text: `# What the schema files say this repository stores and sends. Fields come from the source.\n${stringify({ data }, YAML)}`,
    });
  }
  const model = buildModel(
    files_.map((f) => ({ path: f.path, text: f.text })),
    {
      root: ".archdoc/archdoc.yaml",
    },
  );
  const problems = model.diagnostics
    .filter((d) => d.severity === "error")
    .map((d) => `${d.code}: ${d.message}`);

  const source = files.filter((f) => SOURCE.test(f) && !SKIP_DIR.test(f));
  const claimed = source.filter((f) => locate(model, f).element).length;
  const all: Unit[] = [];
  const flat = (list: Unit[]) => {
    for (const u of list) {
      all.push(u);
      flat(u.components);
    }
  };
  flat(units);
  return {
    files: files_,
    stats: {
      elements: all.filter((u) => u.kind === "container").length,
      components: all.filter((u) => u.kind === "component").length,
      code: all.filter((u) => u.kind === "code").length,
      uses: all.reduce((n, u) => n + u.uses.size, 0),
      datastores: all.filter((u) => u.kind === "datastore" || u.kind === "queue").length,
      contracts: all.reduce((n, u) => n + u.provides.length, 0),
      data: Object.keys(data).length,
      coverage: { claimed, total: source.length },
    },
    problems,
  };
}

/** Writes the starting model; refuses when there is one. */
export async function initModel(
  root: string,
  options: { name?: string | undefined; dryRun?: boolean | undefined } = {},
): Promise<InitResult & { written: boolean; refused?: string | undefined }> {
  if (existsSync(join(root, ".archdoc"))) {
    return {
      ...emptyResult(),
      written: false,
      refused:
        "This repository already has .archdoc/. archdoc map shows what it covers, and archdoc check what's wrong.",
    };
  }
  const r = await inferModel(root, options.name);
  if (r.problems.length || options.dryRun) return { ...r, written: false };
  for (const f of r.files) {
    await mkdir(dirname(join(root, f.path)), { recursive: true });
    await writeFile(join(root, f.path), f.text);
  }
  return { ...r, written: true };
}

/** What init says it did, and what to do next. */
export function formatInit(r: InitResult & { written: boolean; refused?: string | undefined }) {
  if (r.refused) return r.refused;
  const s = r.stats;
  const pct = s.coverage.total ? Math.round((100 * s.coverage.claimed) / s.coverage.total) : 100;
  const out = [
    r.written
      ? `✓ Wrote ${r.files.map((f) => f.path).join(" and ")}.`
      : r.problems.length
        ? "✗ Wrote nothing: the model init inferred doesn't validate."
        : `Would write ${r.files.map((f) => f.path).join(" and ")}:`,
    `  ${s.elements} container${s.elements === 1 ? "" : "s"}, ${s.components} component${s.components === 1 ? "" : "s"} in them, ${s.code} code element${s.code === 1 ? "" : "s"} in those`,
    `  ${s.uses} use${s.uses === 1 ? "" : "s"}, ${s.datastores} datastore${s.datastores === 1 ? "" : "s"} or queue${s.datastores === 1 ? "" : "s"}, ${s.contracts} contract${s.contracts === 1 ? "" : "s"}, ${s.data} data entr${s.data === 1 ? "y" : "ies"}`,
    `  ${s.coverage.claimed} of ${s.coverage.total} source files (${pct}%) belong to an element`,
  ];
  for (const p of r.problems) out.push(`  ✗ ${p}`);
  if (!r.problems.length) {
    out.push(
      "",
      "Everything is marked inferred, and tests and other verification code are left out. Next, with the code open:",
      "  1. Reshape it to the parts the README and deployment files name: about 3 to 12 per level.",
      "     Fold per-file code into its component, group variants, rename what's named after build files.",
      "  2. Add what imports don't show: datastores, queues, externals, and the uses between services",
      "     over HTTP, queues, and schedulers. Find how each unconnected element is reached.",
      "  3. Describe each element: what it does, not what it's called (archdoc show <id> --code).",
      "     Keep the layers nested: a component inside a container, code inside a component.",
      "  4. Add actors from the entry points (routes, pages, CLI commands, consumers, scheduled jobs),",
      "     and trace the two to four main flows through the code as journeys, a step per hop,",
      "     each with an action and the code where it happens.",
      "  5. archdoc check --done until it says the model is done, then ask a person to review it.",
      "  6. Once they accept it, remove the provenance blocks and run archdoc seal --all.",
    );
    if (!r.written) out.push("", ...r.files.flatMap((f) => [`# ${f.path}`, f.text]));
  }
  return out.join("\n");
}

const HEADER = `# Written by archdoc init from the repository's manifests, compose files,
# imports, and schema files. Everything is marked inferred: check it against
# the code, describe what each element does, then remove the provenance blocks.
`;

const NEXT = `
# Who uses this system, and how: init can't tell. Trace the main flows through the
# code, a step per hop, then run archdoc check --done.
# actors:
#   customer: { kind: person, uses: { web: Shops } }
# journeys:
#   checkout:
#     actor: customer
#     goal: Buy what's in the cart
#     importance: critical
#     steps:
#       - { from: customer, to: web, action: Checks out, code: apps/web/src/checkout.ts }
#       - { from: web, to: api, action: Posts the cart, code: apps/web/src/api.ts }
`;

function modelDoc(namespace: string, units: Unit[]) {
  const element = (u: Unit): Record<string, unknown> => {
    const out: Record<string, unknown> = { kind: u.kind };
    if (u.technology) out.technology = u.technology;
    out.description =
      u.description ??
      `${capitalize(u.source)}${u.dir && !u.source.includes(u.dir) ? ` (${u.dir})` : ""}.`;
    if (u.symbol) out.code = { path: u.code[0], symbol: u.symbol };
    else if (u.code.length) out.code = u.code.length === 1 ? u.code[0] : u.code;
    if (u.provides.length) out.provides = u.provides.map((api) => ({ api }));
    if (u.stores.size) out.stores = Object.fromEntries(u.stores);
    if (u.uses.size) {
      out.uses = Object.fromEntries(
        [...u.uses].map(([to, description]) => [to, { description, provenance: INFERRED }]),
      );
    }
    if (u.components.length) {
      out.elements = Object.fromEntries(u.components.map((c) => [c.key, element(c)]));
    }
    out.provenance = INFERRED;
    return out;
  };
  return {
    archdoc: "2.0",
    namespace,
    elements: Object.fromEntries(units.map((u) => [u.key, element(u)])),
  };
}

type Found = Omit<Unit, "uses" | "provides" | "stores" | "components">;

/** A unit per package or module its manifest declares. */
async function manifests(ctx: AnalyzerContext): Promise<Found[]> {
  const out: Found[] = [];
  const read = async (f: string) => ctx.read(f).catch(() => "");
  const manifestsAt = ctx.files.filter((f) => !SKIP_DIR.test(f));
  // package.json with a name; the root one only when it's the only one.
  const pkgs = manifestsAt.filter((f) => /(^|\/)package\.json$/.test(f));
  for (const f of pkgs) {
    const dir = dirOf(f);
    if (!dir && pkgs.length > 1) continue;
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(await read(f)) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (typeof json.name !== "string") continue;
    const deps = {
      ...(json.dependencies as Record<string, string> | undefined),
      ...(json.devDependencies as Record<string, string> | undefined),
    };
    out.push({
      key: json.name.split("/").pop() ?? json.name,
      dir,
      kind: "container",
      description: typeof json.description === "string" ? json.description : undefined,
      technology: jsTechnology(
        deps,
        json,
        ctx.files.some((x) => x.startsWith(dir ? `${dir}/` : "") && /\.tsx?$/.test(x)),
      ),
      code: [glob(dir)],
      source: `the ${json.name} package`,
    });
  }
  // Go: a container per binary under cmd/, and the module.
  for (const f of manifestsAt.filter((f) => /(^|\/)go\.mod$/.test(f))) {
    const dir = dirOf(f);
    const mod = /^module\s+(\S+)/m.exec(await read(f))?.[1] ?? (dir || "module");
    const cmds = [
      ...new Set(
        ctx.files
          .filter((x) => x.startsWith(`${dir ? `${dir}/` : ""}cmd/`) && x.endsWith(".go"))
          .map((x) =>
            x
              .split("/")
              .slice(0, dir ? dir.split("/").length + 2 : 2)
              .join("/"),
          ),
      ),
    ];
    for (const c of cmds) {
      out.push({
        key: basename(c),
        dir: c,
        kind: "container",
        technology: "Go",
        code: [glob(c)],
        source: `the ${basename(c)} binary`,
      });
    }
    out.push({
      key: mod.split("/").pop() ?? mod,
      dir,
      kind: "container",
      technology: "Go",
      code: [glob(dir)],
      source: `the ${mod} module`,
    });
  }
  // Rust, Python, Java: a container per package or module.
  for (const f of manifestsAt.filter((f) => /(^|\/)Cargo\.toml$/.test(f))) {
    const text = await read(f);
    const pkg = /\[package\][^[]*?name\s*=\s*"([^"]+)"/s.exec(text);
    if (!pkg?.[1]) continue;
    const dir = dirOf(f);
    out.push({
      key: pkg[1],
      dir,
      kind: "container",
      technology: "Rust",
      description: /\[package\][^[]*?description\s*=\s*"([^"]+)"/s.exec(text)?.[1],
      code: [glob(dir)],
      source: `the ${pkg[1]} crate`,
    });
  }
  for (const f of manifestsAt.filter((f) => /(^|\/)(pyproject\.toml|setup\.py)$/.test(f))) {
    const text = await read(f);
    // A workspace root (uv, a tools-only pyproject) has no [project] of its own.
    if (f.endsWith("pyproject.toml") && !/^\[(project|tool\.poetry)\]/m.test(text)) continue;
    const project =
      /^name\s*=\s*["']([^"']+)["']/m.exec(text) ?? /name\s*=\s*["']([^"']+)["']/.exec(text);
    const dir = dirOf(f);
    if (out.some((o) => o.dir === dir)) continue;
    const framework = /fastapi/i.test(text)
      ? "FastAPI"
      : /django/i.test(text)
        ? "Django"
        : /flask/i.test(text)
          ? "Flask"
          : undefined;
    out.push({
      key: project?.[1] ?? (basename(dir) || "app"),
      dir,
      kind: "container",
      technology: framework ? `Python, ${framework}` : "Python",
      code: [glob(dir)],
      source: `the ${project?.[1] ?? "Python"} project`,
    });
  }
  const poms = manifestsAt.filter((f) => /(^|\/)(pom\.xml|build\.gradle(\.kts)?)$/.test(f));
  for (const f of poms) {
    const dir = dirOf(f);
    // A parent build that only lists modules isn't a deployable of its own.
    if (!dir && poms.length > 1) continue;
    if (out.some((o) => o.dir === dir)) continue;
    const text = await read(f);
    const artifact = /<artifactId>([^<]+)<\/artifactId>/.exec(text)?.[1];
    out.push({
      key: artifact ?? (basename(dir) || "app"),
      dir,
      kind: "container",
      technology: f.endsWith(".kts") ? "Kotlin" : "Java",
      code: [glob(dir)],
      source: `the ${artifact ?? basename(dir)} module`,
    });
  }
  return out;
}

/** A container for a directory no manifest claims: what its files say it is. */
async function directoryUnit(ctx: AnalyzerContext, dir: string): Promise<Omit<Found, "key">> {
  const inside = dir ? ctx.files.filter((f) => f.startsWith(`${dir}/`)) : ctx.files;
  const has = (re: RegExp) => inside.some((f) => re.test(f));
  let technology: string | undefined;
  let source = "a directory";
  let description: string | undefined;
  const action = inside.find((f) => /^[^/]+\/[^/]+\/action\.ya?ml$/.test(f));
  if (action) {
    const doc = (parse(await ctx.read(action).catch(() => "")) ?? {}) as {
      name?: string;
      description?: string;
      runs?: { using?: string };
    };
    technology = `GitHub Actions (${doc.runs?.using ?? "action"})`;
    description = doc.description;
    source = `the ${doc.name ?? basename(dir)} action`;
  } else {
    const langs = [
      [/\.tsx?$/, "TypeScript"],
      [/\.(m|c)?jsx?$/, "JavaScript"],
      [/\.go$/, "Go"],
      [/\.py$/, "Python"],
      [/\.rs$/, "Rust"],
      [/\.(ya?ml)$/, "YAML"],
      [/\.md$/, "Markdown"],
    ] as const;
    const found = langs.filter(([re]) => has(re)).map(([, name]) => name);
    technology = found.slice(0, 3).join(", ") || undefined;
  }
  return { dir, kind: "container", technology, description, code: [glob(dir)], source };
}

const TEST_FILE = /([._-](test|spec)\.[a-z]+$)|((^|\/)test_[^/]+\.py$)|(\.d\.ts$)/;
/** Files that wire a package together rather than do one job: they stay with their container. */
const ENTRY_FILE =
  /(^|\/)(index|main|mod|lib|bin|cli|server|app|__init__|__main__|conftest)\.[a-z]+$/;
/** What a code element can point at: a function or a class. */
const CALLABLE = new Set(["function", "class"]);

function isSource(f: string): boolean {
  return SOURCE.test(f) && !SKIP_DIR.test(f) && !TEST_FILE.test(f);
}

function inside(dir: string, f: string): boolean {
  return !dir || f.startsWith(`${dir}/`);
}

type Exports = Map<string, { name: string; kind: string; line: number }[]>;

/**
 * A container's components: the directories its code is split into (looking
 * through src/, lib/, internal/, and the like), and the files beside them. Each component's code follows: its files, or a file's functions and
 * classes. A container with one part has no components; files that wire it
 * together (index.ts, main.go, __init__.py) stay with the container.
 */
function components(dir: string, sources: string[], exportsOf: Exports, depth = 0): Unit[] {
  const prefix = dir ? `${dir}/` : "";
  const dirs = new Map<string, string[]>();
  const loose: string[] = [];
  for (const f of sources) {
    const parts = f.slice(prefix.length).split("/");
    let i = 0;
    // At the top of a repository, apps/ and services/ hold packages; inside a package,
    // services/ is a part like any other, and only src/, lib/, and the like are looked through.
    const roots = dir ? SOURCE_ROOTS : CODE_ROOTS;
    while (i < parts.length - 1 && roots.includes(parts[i] as string)) i++;
    if (i === parts.length - 1) {
      if (!ENTRY_FILE.test(f)) loose.push(f);
      continue;
    }
    const top = parts[i] as string;
    if (top.startsWith(".") || top.startsWith("_") || (!dir && top === "scripts")) continue;
    const at = `${prefix}${parts.slice(0, i + 1).join("/")}`;
    dirs.set(at, [...(dirs.get(at) ?? []), f]);
  }
  // One package inside, such as backend/app: its parts are one level down.
  const [only] = dirs;
  if (dirs.size === 1 && !loose.length && only && depth < 3) {
    return components(only[0], only[1], exportsOf, depth + 1);
  }
  const keys = new Set<string>();
  const key = (k: string) => uniqueIn(keys, k);
  const out: Unit[] = [
    ...[...dirs].map(([at, inside]) => ({
      ...part(key(sanitize(basename(at))), at, "component", [`${at}/**`], "a code directory"),
      components: filesAsCode(at, inside, exportsOf),
    })),
    // A file beside the directories, or in a flat package: each is a part, and its functions
    // and classes are its code.
    ...loose.map((f) => ({
      ...part(key(sanitize(stem(basename(f)))), f, "component", [f], "a source file"),
      components: symbolsAsCode(f, exportsOf),
    })),
  ];
  return out.length >= 2 ? out.sort((a, b) => a.dir.localeCompare(b.dir)) : [];
}

/** A component directory's code: a code element per file, at its one function or class when it has one. */
function filesAsCode(dir: string, files: string[], exportsOf: Exports): Unit[] {
  const keys = new Set<string>();
  return files
    .filter((f) => !ENTRY_FILE.test(f))
    .sort()
    .map((f) => {
      const callable = (exportsOf.get(f) ?? []).filter((x) => CALLABLE.has(x.kind));
      const symbol = callable.length === 1 ? callable[0]?.name : undefined;
      const k = uniqueIn(keys, sanitize(stem(f.slice(dir.length + 1)).replaceAll("/", "-")));
      return { ...part(k, f, "code", [f], "a source file"), symbol };
    });
}

/** A file component's code: its exported functions and classes, when it has more than one. */
function symbolsAsCode(file: string, exportsOf: Exports): Unit[] {
  const callable = (exportsOf.get(file) ?? [])
    .filter((x) => CALLABLE.has(x.kind) && x.name !== "default")
    .sort((a, b) => a.line - b.line);
  if (callable.length < 2) return [];
  const keys = new Set<string>();
  return callable.map((x) => ({
    ...part(
      uniqueIn(keys, ID.test(x.name) ? x.name : sanitize(x.name)),
      file,
      "code",
      [file],
      `${x.kind} ${x.name}`,
    ),
    symbol: x.name,
  }));
}

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

function part(key: string, dir: string, kind: Unit["kind"], code: string[], source: string): Unit {
  return {
    key,
    dir,
    kind,
    code,
    source,
    uses: new Map(),
    provides: [],
    stores: new Map(),
    components: [],
  };
}

function uniqueIn(keys: Set<string>, key: string): string {
  const base = key || "part";
  let k = base;
  for (let i = 2; keys.has(k); i++) k = `${base}-${i}`;
  keys.add(k);
  return k;
}

/** packages/core/src/check/check.ts → check. */
function stem(path: string): string {
  return path.replace(/\.[^./]+$/, "");
}

/** Datastores and queues from compose images; built services' dependencies as uses. */
async function compose(
  ctx: AnalyzerContext,
  units: Unit[],
  add: (u: Omit<Found, "key">, key: string) => Unit,
) {
  const files = ctx.files.filter(
    (f) => /(^|\/)(docker-)?compose(\.[\w-]+)?\.ya?ml$/.test(f) && !SKIP_DIR.test(f),
  );
  for (const f of files) {
    let doc: { services?: Record<string, ComposeService> };
    try {
      doc = (parse(await ctx.read(f)) ?? {}) as typeof doc;
    } catch {
      continue;
    }
    const byService = new Map<string, Unit>();
    for (const [name, svc] of Object.entries(doc.services ?? {})) {
      const build = typeof svc.build === "string" ? svc.build : svc.build?.context;
      if (build !== undefined) {
        // The Dockerfile's directory says more than a context at the root.
        const dockerfile = typeof svc.build === "object" ? svc.build.dockerfile : undefined;
        const at = dockerfile ? posix.join(build, posix.dirname(dockerfile)) : build;
        const dir = posix.normalize(posix.join(dirOf(f), at)).replace(/^\.\/?|\/$/g, "");
        const unit =
          units.find((u) => u.dir === (dir === "." ? "" : dir)) ?? ownerOf(units, `${dir}/x`);
        if (unit) byService.set(name, unit);
        continue;
      }
      const image = svc.image?.split(":")[0]?.split("/").pop() ?? "";
      const known = IMAGES.find(([re]) => re.test(image));
      if (!known) continue;
      const [, kind, technology] = known;
      byService.set(
        name,
        units.find((u) => u.key === sanitize(name) && u.kind === kind) ??
          add(
            {
              dir: "",
              kind,
              technology,
              code: [],
              source: `the ${name} service in ${f}`,
              composed: true,
            },
            name,
          ),
      );
    }
    for (const [name, svc] of Object.entries(doc.services ?? {})) {
      const from = byService.get(name);
      const deps = Array.isArray(svc.depends_on)
        ? svc.depends_on
        : Object.keys(svc.depends_on ?? {});
      for (const d of deps) {
        const to = byService.get(d);
        if (from && to && from !== to && !from.uses.has(to.key)) {
          from.uses.set(to.key, `Depends on ${d} (${basename(f)})`);
        }
      }
    }
  }
}

interface ComposeService {
  image?: string;
  build?: string | { context?: string; dockerfile?: string };
  depends_on?: string[] | Record<string, unknown>;
}

const IMAGES: [RegExp, "datastore" | "queue", string][] = [
  [/^postgres|^postgis/, "datastore", "PostgreSQL"],
  [/^mysql/, "datastore", "MySQL"],
  [/^mariadb/, "datastore", "MariaDB"],
  [/^mongo/, "datastore", "MongoDB"],
  [/^redis|^valkey/, "datastore", "Redis"],
  [/^(elasticsearch|opensearch)/, "datastore", "Elasticsearch"],
  [/^(cassandra|scylla)/, "datastore", "Cassandra"],
  [/^minio/, "datastore", "S3 (MinIO)"],
  [/kafka|redpanda/, "queue", "Kafka"],
  [/^rabbitmq/, "queue", "RabbitMQ"],
  [/^nats/, "queue", "NATS"],
];

/** Data entries from Prisma, SQL, OpenAPI, and protobuf files; datastores and contracts too. */
async function schemas(
  ctx: AnalyzerContext,
  units: Unit[],
  add: (u: Omit<Found, "key">, key: string) => Unit,
): Promise<Record<string, Record<string, unknown>>> {
  const data: Record<string, Record<string, unknown>> = {};
  const entry = (name: string, spec: Record<string, unknown>) => {
    // A record and a message of the same name: the message says what it is.
    let key = data[name] && spec.kind === "message" ? `${name}Message` : name;
    for (let i = 2; data[key]; i++) key = `${name}${i}`;
    data[key] = { ...spec, provenance: INFERRED };
    return key;
  };
  const files = ctx.files.filter((f) => !SKIP_DIR.test(f));
  const read = (f: string) => ctx.read(f).catch(() => "");
  const store = (near: string, technology: string, source: string) => {
    const owner = ownerOf(units, near);
    const key = `${owner && owner.kind === "container" ? `${owner.key}-` : ""}db`;
    // A database the compose file runs is the one the schema describes, when there's one.
    const sqlStores = units.filter(
      (u) => u.kind === "datastore" && u.composed && SQL_TECH.test(u.technology ?? ""),
    );
    const composed = sqlStores.length === 1 ? sqlStores[0] : undefined;
    const existing =
      units.find((u) => u.key === key && u.kind === "datastore") ??
      (SQL_TECH.test(technology) || technology === "SQL database" ? composed : undefined);
    const db = existing ?? add({ dir: "", kind: "datastore", technology, code: [], source }, key);
    if (owner && owner.kind === "container" && !owner.uses.has(db.key)) {
      owner.uses.set(db.key, "Reads and writes its tables");
    }
    return db;
  };

  for (const f of files.filter((f) => f.endsWith(".prisma"))) {
    const text = await read(f);
    const provider = /provider\s*=\s*"(\w+)"/.exec(
      /datasource\s+\w+\s*\{[^}]*\}/.exec(text)?.[0] ?? "",
    )?.[1];
    const models = [...text.matchAll(/^model\s+(\w+)\s*\{([^}]*)\}/gm)];
    if (!models.length) continue;
    const db = store(f, PRISMA[provider ?? ""] ?? "SQL database", `the database ${f} describes`);
    for (const [, name, body] of models) {
      const key = entry(name as string, { kind: "entity", source: { prisma: `${f}#${name}` } });
      const table = /@@map\("([^"]+)"\)/.exec(body ?? "")?.[1] ?? name;
      db.stores.set(table as string, { entity: key });
    }
  }

  // SQL migrations: the tables the last migration leaves, per directory.
  const sqlDirs = [...new Set(files.filter((f) => f.endsWith(".sql")).map(dirOf))];
  for (const dir of sqlDirs) {
    const tables = new Set<string>();
    for (const f of files.filter((x) => dirOf(x) === dir && x.endsWith(".sql")).sort()) {
      const text = (await read(f)).replace(/--[^\n]*/g, "");
      for (const m of text.matchAll(
        /create\s+table\s+(?:if\s+not\s+exists\s+)?["`]?(?:\w+\.)?(\w+)/gi,
      ))
        tables.add((m[1] as string).toLowerCase());
      for (const m of text.matchAll(/drop\s+table\s+(?:if\s+exists\s+)?["`]?(?:\w+\.)?(\w+)/gi))
        tables.delete((m[1] as string).toLowerCase());
      for (const m of text.matchAll(
        /alter\s+table\s+["`]?(?:\w+\.)?(\w+)["`]?\s+rename\s+to\s+["`]?(\w+)/gi,
      )) {
        tables.delete((m[1] as string).toLowerCase());
        tables.add((m[2] as string).toLowerCase());
      }
    }
    if (!tables.size) continue;
    const db = store(
      `${dir}/x`,
      "SQL database",
      `the database the migrations in ${dir || "."} build`,
    );
    for (const t of [...tables].sort()) {
      const key = entry(entityName(t), { kind: "entity", source: { sql: `${dir || "."}#${t}` } });
      db.stores.set(t, { entity: key });
    }
  }

  // OpenAPI documents and protobuf services are contracts their owner provides.
  for (const f of files.filter((f) => /\.(ya?ml|json)$/.test(f))) {
    const text = await read(f);
    if (!/^\s*["']?(openapi|swagger)["']?\s*:/m.test(text)) continue;
    let doc: { components?: { schemas?: Record<string, unknown> } };
    try {
      doc = (parse(text) ?? {}) as typeof doc;
    } catch {
      continue;
    }
    ownerOf(units, f)?.provides.push(f);
    for (const name of Object.keys(doc.components?.schemas ?? {})) {
      entry(name, { kind: "message", source: { openapi: `${f}#${name}` } });
    }
  }
  for (const f of files.filter((f) => f.endsWith(".proto"))) {
    const text = await read(f);
    if (/^\s*service\s+\w+/m.test(text)) ownerOf(units, f)?.provides.push(f);
    for (const [, name] of text.matchAll(/^\s*message\s+(\w+)\s*\{/gm)) {
      entry(name as string, { kind: "message", source: { proto: `${f}#${name}` } });
    }
  }
  return data;
}

const SQL_TECH = /PostgreSQL|MySQL|MariaDB|SQL Server|CockroachDB|SQLite/;

const PRISMA: Record<string, string> = {
  postgresql: "PostgreSQL",
  postgres: "PostgreSQL",
  mysql: "MySQL",
  sqlite: "SQLite",
  sqlserver: "SQL Server",
  mongodb: "MongoDB",
  cockroachdb: "CockroachDB",
};

/**
 * Directories one level under the conventional code roots that hold two
 * source files, or with `keep`, any file it keeps besides a README.
 */
function codeDirs(
  files: readonly string[],
  under: string,
  keep?: (file: string) => boolean | undefined,
): string[] {
  const prefix = under ? `${under}/` : "";
  const counts = new Map<string, number>();
  for (const f of files) {
    if (!f.startsWith(prefix) || SKIP_DIR.test(f.slice(prefix.length))) continue;
    if (keep ? !keep(f) || /(^|\/)(README|LICENSE|CHANGELOG)[^/]*$/i.test(f) : !SOURCE.test(f))
      continue;
    const parts = f.slice(prefix.length).split("/");
    const roots = keep ? [...CODE_ROOTS, ...TOOL_ROOTS] : CODE_ROOTS;
    if (parts.length < 3 || !roots.includes(parts[0] as string)) continue;
    const dir = `${prefix}${parts[0]}/${parts[1]}`;
    counts.set(dir, (counts.get(dir) ?? 0) + 1);
  }
  return [...counts]
    .filter(([, n]) => n >= (keep ? 1 : 2))
    .map(([d]) => d)
    .sort();
}

/** The unit whose directory holds the path, most specific first. */
function ownerOf(units: Unit[], path: string): Unit | undefined {
  let best: Unit | undefined;
  for (const u of units.flatMap((x) => [x, ...x.components])) {
    if (u.kind !== "container") continue;
    if (u.dir && !(path === u.dir || path.startsWith(`${u.dir}/`))) continue;
    if (!best || u.dir.length > best.dir.length) best = u;
  }
  return best;
}

function jsTechnology(
  deps: Record<string, string>,
  json: Record<string, unknown>,
  typescript: boolean,
): string {
  const parts: string[] = [typescript || deps.typescript ? "TypeScript" : "JavaScript"];
  for (const [dep, name] of JS_FRAMEWORKS) {
    if (deps[dep] && !parts.includes(name)) parts.push(name);
  }
  if (json.bin && !parts.some((p) => p.includes("CLI"))) parts.push("CLI");
  return parts.join(", ");
}

const JS_FRAMEWORKS: [string, string][] = [
  ["next", "Next.js"],
  ["react", "React"],
  ["vue", "Vue"],
  ["svelte", "Svelte"],
  ["@angular/core", "Angular"],
  ["express", "Express"],
  ["fastify", "Fastify"],
  ["@nestjs/core", "NestJS"],
  ["koa", "Koa"],
  ["hono", "Hono"],
  ["commander", "CLI"],
  ["yargs", "CLI"],
];

async function rootName(ctx: AnalyzerContext): Promise<string | undefined> {
  if (!ctx.files.includes("package.json")) return undefined;
  try {
    const name = (JSON.parse(await ctx.read("package.json")) as { name?: unknown }).name;
    return typeof name === "string" ? (name.split("/").pop() ?? name) : undefined;
  } catch {
    return undefined;
  }
}

function uniqueKey(units: Unit[], key: string): string {
  const base = sanitize(key) || "app";
  let k = base;
  for (let i = 2; units.some((u) => u.key === k); i++) k = `${base}-${i}`;
  return k;
}

/** A model key: lowercase letters, digits, and dashes. */
function sanitize(s: string): string {
  return s
    .toLowerCase()
    .replace(/^@/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** trips → Trip, ledger_entries → LedgerEntry. */
function entityName(table: string): string {
  return table
    .split(/[_-]/)
    .map((w, i, all) => {
      const word = i === all.length - 1 ? singular(w) : w;
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join("");
}

function singular(w: string): string {
  if (/ies$/.test(w)) return `${w.slice(0, -3)}y`;
  if (/(ss|us|is)$/.test(w)) return w;
  if (/(sh|ch|x|z)es$/.test(w)) return w.slice(0, -2);
  return w.endsWith("s") && w.length > 3 ? w.slice(0, -1) : w;
}

function dirOf(path: string): string {
  const d = posix.dirname(path);
  return d === "." ? "" : d;
}

function glob(dir: string): string {
  return dir ? `${dir}/**` : "**";
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function emptyResult(): InitResult {
  return {
    files: [],
    stats: {
      elements: 0,
      components: 0,
      code: 0,
      uses: 0,
      datastores: 0,
      contracts: 0,
      data: 0,
      coverage: { claimed: 0, total: 0 },
    },
    problems: [],
  };
}
