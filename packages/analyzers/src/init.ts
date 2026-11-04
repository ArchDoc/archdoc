import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, posix } from "node:path";
import {
  buildModel,
  COMPONENT_SIZE,
  type CodeIndex,
  type EntryPoint,
  isDeploymentFile,
  isDevTooling,
  isVerificationCode,
  listRepoFiles,
  locate,
  observedEdges,
} from "@archdoc/core";
import { parse, stringify } from "yaml";
import { type AnalyzerContext, contextFor } from "./api.js";
import { type IacFindings, readIac } from "./iac.js";
import { findEntryPoints, formatEntrySummary, placeEntries } from "./paths.js";
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
    /** Environments, from compose files and infrastructure as code. */
    environments: number;
  };
  /** Where flows start: routes, queue consumers, schedules, CLI commands. */
  entryPoints: EntryPoint[];
  /** What to read before reshaping the model: the docs, and the files that say how it's deployed. */
  brief: { docs: string[]; deployment: string[] };
  /** Problems the model would have; init writes nothing when there are errors. */
  problems: string[];
}

interface Unit {
  key: string;
  dir: string;
  kind: "container" | "component" | "code" | "datastore" | "queue" | "external";
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
  /** Where it runs: deployment nodes such as production.aws.lambda. */
  deploy?: string[] | undefined;
}

/** What init writes besides the elements: who starts the system, and where it runs. */
interface Extras {
  actors: Record<string, Record<string, unknown>>;
  environments: Record<string, Record<string, unknown>>;
  /** Data entries the IaC declares, such as a DynamoDB table's keys. */
  data: Record<string, Record<string, unknown>>;
  /** Where flows start: routes, consumers, schedules. */
  entryPoints: EntryPoint[];
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

  // 1. Packages and modules, from their manifests. A CDK app is how the system is
  // deployed, not a part of it: its code goes with the environments it defines.
  const iac = await readIac(ctx).catch((): IacFindings[] => []);
  const cdkDirs = new Set(iac.filter((f) => f.tool === "cdk").map((f) => f.dir));
  for (const m of await manifests(ctx)) {
    if (m.kind === "container" && cdkDirs.has(m.dir)) continue;
    add(m, m.key);
  }
  // Directories under the conventional roots that no manifest claims, such as
  // an integration written in Markdown and YAML, or code without a manifest.
  const iacFiles = new Set(iac.flatMap((f) => f.files));
  const claimedBy = (f: string) => (ownerOf(units, f) && units.length > 0) || iacFiles.has(f);
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
    // A small container stays lean: its few files are read as one part.
    unit.components =
      sources.filter((f) => !ENTRY_FILE.test(f)).length >= COMPONENT_SIZE.lean
        ? components(unit.dir, sources, exportsOf)
        : [];
  }

  // 2. Datastores, queues, and dependencies, from compose files and infrastructure as code.
  const extras: Extras = { actors: {}, environments: {}, data: {}, entryPoints: [] };
  await compose(ctx, units, add, extras);
  await infrastructure(ctx, units, add, iac, extras);

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

  // Where flows start: what the agent traces as journeys.
  extras.entryPoints = placeEntries(await findEntryPoints(ctx, iac).catch(() => []), ctx.files);

  // 4. Data and contracts, from schema files.
  const data = { ...extras.data, ...(await schemas(ctx, units, add)) };

  // The model, as YAML, and checked before it's written.
  const namespace = sanitize(name ?? (await rootName(ctx)) ?? basename(root));
  // Who starts the system and where it runs get files of their own, as journeys do
  // (.archdoc/journeys/<id>.yaml), so each edit is to a small file.
  const { actors, environments, ...doc } = modelDoc(namespace, units, extras) as Record<
    string,
    unknown
  >;
  const files_: InitResult["files"] = [
    { path: ".archdoc/archdoc.yaml", text: HEADER + stringify(doc, YAML) + NEXT },
  ];
  if (actors) {
    files_.push({
      path: ".archdoc/actors.yaml",
      text: `# Who and what uses the system. Init only knows the schedulers infrastructure as code declares: add the people and systems behind each entry point.\n${stringify({ actors }, YAML)}`,
    });
  }
  if (environments) {
    files_.push({
      path: ".archdoc/environments.yaml",
      text: `# Where the system runs, from compose files and infrastructure as code. Elements say which node they run on with deploy:.\n${stringify({ environments }, YAML)}`,
    });
  }
  if (Object.keys(data).length) {
    files_.push({
      path: ".archdoc/data.yaml",
      text: `# What the schema files and infrastructure as code say this repository stores and sends. Fields come from the source.\n${stringify({ data }, YAML)}`,
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

  // A CDK app's code is how the system is deployed: the environments point at it.
  const source = files.filter((f) => SOURCE.test(f) && !SKIP_DIR.test(f) && !iacFiles.has(f));
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
      environments: Object.keys(extras.environments).length,
    },
    entryPoints: extras.entryPoints,
    brief: {
      docs: files
        .filter(
          (f) =>
            /^(README|ARCHITECTURE|DESIGN)[^/]*\.md$/i.test(f) ||
            /^(docs?|architecture|adr|design)\/[^/]*\.md$/i.test(f) ||
            /^[^/]+\/[^/]+\/README\.md$|^[^/]+\/README\.md$/i.test(f),
        )
        .filter((f) => !SKIP_DIR.test(f) || /^docs?\//.test(f))
        .slice(0, 12),
      deployment: [...new Set([...files.filter(isDeploymentFile), ...iacFiles])].slice(0, 15),
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
      ? `✓ Wrote ${list(r.files.map((f) => f.path))}.`
      : r.problems.length
        ? "✗ Wrote nothing: the model init inferred doesn't validate."
        : `Dry run: wrote nothing. It would write ${list(r.files.map((f) => f.path))}. To model the system, run archdoc init again without --dry-run, then follow the steps below.`,
    `  ${s.elements} container${s.elements === 1 ? "" : "s"}, ${s.components} component${s.components === 1 ? "" : "s"} in them, ${s.code} code element${s.code === 1 ? "" : "s"} in those`,
    `  ${s.uses} use${s.uses === 1 ? "" : "s"}, ${s.datastores} datastore${s.datastores === 1 ? "" : "s"} or queue${s.datastores === 1 ? "" : "s"}, ${s.contracts} contract${s.contracts === 1 ? "" : "s"}, ${s.data} data entr${s.data === 1 ? "y" : "ies"}`,
    `  ${s.coverage.claimed} of ${s.coverage.total} source files (${pct}%) belong to an element`,
  ];
  if (s.environments) {
    out.push(
      `  ${s.environments} environment${s.environments === 1 ? "" : "s"}, from compose files and infrastructure as code`,
    );
  }
  for (const p of r.problems) out.push(`  ✗ ${p}`);
  if (!r.problems.length) {
    const b = r.brief;
    if (b.docs.length) out.push("", "Read first:", ...b.docs.map((d) => `  ${d}`));
    if (b.deployment.length) {
      out.push(
        "",
        "How it's deployed (the environments, and the datastores, queues, and services each part reaches):",
        ...b.deployment.map((d) => `  ${d}`),
      );
    }
    const flows = r.entryPoints.filter((e) => e.kind !== "main");
    if (r.entryPoints.length > 30) {
      // Many: by place and resource, each line a journey's worth of flows.
      out.push(
        "",
        formatEntrySummary(r.entryPoints, { places: 15 }).replace(
          /^(\d+) entry points/,
          "Where flows start: $1 entry points",
        ),
      );
    } else if (r.entryPoints.length) {
      out.push(
        "",
        `Where flows start (${r.entryPoints.length}); archdoc_paths shows the calls each one makes:`,
      );
      const width = Math.min(36, Math.max(...r.entryPoints.map((e) => e.label.length)));
      for (const e of r.entryPoints) {
        out.push(
          `  ${e.kind.padEnd(8)} ${e.label.padEnd(width)}  ${e.file}${e.symbol ? `#${e.symbol}` : ""}`,
        );
      }
    }
    out.push(
      "",
      "Everything is marked inferred, and tests and other verification code are left out. Next, with the code open:",
      "  1. Reshape it to the parts the README and deployment files name: about 3 to 12 per level.",
      "     Fold per-file code into its component, group variants, rename what's named after build files.",
      "     Give a big container (many directories, dozens of files) components; keep a small one lean.",
      "  2. Add what imports don't show: datastores, queues, externals, and the uses between services",
      "     over HTTP, queues, and schedulers. Find how each unconnected element is reached.",
      "  3. Describe each element: what it does, not what it's called (archdoc show <id> --code).",
      "     Keep the layers nested: a component inside a container, code inside a component.",
      `  4. Add actors from the entry points, and trace ${flows.length >= 3 ? "a journey for each main flow above" : "the main flows"} through the`,
      "     code with archdoc_paths (not grep), a step per hop, each with an action, the code where it",
      "     happens, and the data it carries (sends:, creates:, changes:).",
      "  5. Say what each datastore stores and each queue carries (data:, stores:, sends:), and where each",
      "     part runs (environments:, deploy:) from the deployment files.",
      "  6. archdoc check --done until it says the model is done: fix each line and each warning the code",
      "     can answer (a missing schema: find it and map its fields), and leave only what needs a person.",
      "     Then ask a person to review it.",
      "  7. Once they accept it, remove the provenance blocks and run archdoc seal --all.",
    );
    if (!r.written) {
      out.push("", ...r.files.flatMap((f) => [`# ${f.path}`, f.text]));
      out.push(
        "",
        "That was a dry run: nothing is in .archdoc/ yet. Run archdoc init without --dry-run to write it.",
      );
    }
  }
  return out.join("\n");
}

const HEADER = `# Written by archdoc init from the repository's manifests, compose files,
# imports, schema files, and infrastructure as code. Everything is marked inferred: check it against
# the code, describe what each element does, then remove the provenance blocks.
`;

const NEXT = `
# Who uses this system, and how: init can't tell. Trace the main flows through the
# code (archdoc paths), a step per hop, one journey per file in .archdoc/journeys/,
# then run archdoc check --done.
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

function modelDoc(namespace: string, units: Unit[], extras?: Extras) {
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
    if (extras && u.deploy?.length) out.deploy = u.deploy;
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
  if (!extras) {
    return {
      archdoc: "2.0",
      namespace,
      elements: Object.fromEntries(units.map((u) => [u.key, element(u)])),
    };
  }
  // One system around everything but the externals, so the context view has a box to draw.
  const inside = units.filter((u) => u.kind !== "external");
  const outside = units.filter((u) => u.kind === "external");
  const system = units.some((u) => u.key === namespace) ? `${namespace}-system` : namespace;
  return {
    archdoc: "2.0",
    namespace,
    ...(Object.keys(extras.actors).length ? { actors: extras.actors } : {}),
    elements: {
      [system]: {
        kind: "system",
        description: `The ${namespace} system: everything this repository builds and runs.`,
        elements: Object.fromEntries(inside.map((u) => [u.key, element(u)])),
        provenance: INFERRED,
      },
      ...Object.fromEntries(outside.map((u) => [u.key, element(u)])),
    },
    ...(Object.keys(extras.environments).length ? { environments: extras.environments } : {}),
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
  extras: Extras,
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
    // A compose file runs them on one host: the local environment.
    if (byService.size) {
      extras.environments.local ??= {
        description: "A developer's machine.",
        nodes: {},
        provenance: INFERRED,
      };
      const env = extras.environments.local as { nodes: Record<string, unknown> };
      const node = Object.keys(env.nodes).length
        ? `compose-${Object.keys(env.nodes).length + 1}`
        : "compose";
      env.nodes[node] = { kind: "host", technology: "Docker Compose", code: f };
      for (const u of new Set(byService.values())) {
        u.deploy = [...new Set([...(u.deploy ?? []), `local.${node}`])];
      }
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
      environments: 0,
    },
    entryPoints: [],
    brief: { docs: [], deployment: [] },
    problems: [],
  };
}

/** What each SDK a component imports reaches, to put a use on the component that makes the call. */
const SDK: [RegExp, RegExp][] = [
  [/DynamoDB/, /@aws-sdk\/(client-dynamodb|lib-dynamodb)|\bdynamodb\b|DynamoDB/],
  [
    /RDS/,
    /\bpg\b|postgres|mysql|prisma|knex|sequelize|typeorm|drizzle|sqlalchemy|psycopg|database\/sql/,
  ],
  [/SQS/, /@aws-sdk\/client-sqs|\bsqs\b|SQS/],
  [/SNS/, /@aws-sdk\/client-sns|\bsns\b|SNS/],
  [/EventBridge/, /@aws-sdk\/client-eventbridge|eventbridge|EventBridge/],
  [/Kinesis/, /@aws-sdk\/client-kinesis|kinesis/],
  [/SES/, /@aws-sdk\/client-sesv?2?|\bses\b|SES/],
  [/Bedrock/, /@aws-sdk\/client-bedrock|bedrock/],
  [/Secrets Manager/, /@aws-sdk\/client-secrets-manager|secretsmanager/],
];
/** The AWS SDK as a whole (v2, boto3): any of them, when no client says which. */
const ANY_AWS_SDK = /["']aws-sdk["']|\bboto3\b/;

const ACCESS: Record<string, string> = {
  read: "Reads",
  write: "Writes",
  readwrite: "Reads and writes",
  send: "Sends messages to",
  consume: "Consumes",
  publish: "Publishes to",
  call: "Calls",
};

/**
 * Datastores, queues, and services from infrastructure as code (Terraform and
 * CDK), with what each function is granted as uses from the code that makes
 * the call, the keys of each table as data, who starts each function on a
 * schedule, and the environments it deploys to.
 */
async function infrastructure(
  ctx: AnalyzerContext,
  units: Unit[],
  add: (u: Omit<Found, "key">, key: string) => Unit,
  findings: IacFindings[],
  extras: Extras,
) {
  const read = (f: string) => ctx.read(f).catch(() => "");
  const keyFor = (name: string, suffix: string) => {
    const k = sanitize(name);
    return units.some((u) => u.key === k) ? `${k}-${suffix}` : k;
  };
  for (const iac of findings) {
    const byId = new Map<string, Unit>();
    for (const t of iac.tables) {
      const name = t.name ?? t.id.split(".").pop() ?? "table";
      const unit = add(
        {
          dir: "",
          kind: "datastore",
          technology: t.technology,
          code: [],
          source: `the ${name} table in ${t.file}`,
        },
        keyFor(name, "table"),
      );
      byId.set(t.id, unit);
      if (!t.keys.length) continue;
      const entity = uniqueEntity(extras.data, entityName(name));
      const fields: Record<string, Record<string, string>> = {};
      for (const k of [...t.keys, ...t.attributes]) {
        fields[k.name] = k.type ? { type: k.type } : {};
      }
      extras.data[entity] = {
        kind: "entity",
        description: `A record in the ${name} table. ${t.file} declares its keys${t.indexes.length ? ` and indexes (${t.indexes.join(", ")})` : ""}; add the other attributes from the code that writes it.`,
        fields,
        provenance: INFERRED,
      };
      const pk = t.keys.find((k) => k.role === "partition")?.name;
      unit.stores.set(name, { entity, ...(pk ? { key: pk } : {}) } as { entity: string });
    }
    for (const q of iac.queues) {
      const name = q.name ?? q.id.split(".").pop() ?? "queue";
      byId.set(
        q.id,
        add(
          {
            dir: "",
            kind: "queue",
            technology: q.technology,
            code: [],
            source: `the ${name} ${q.kind} in ${q.file}`,
          },
          keyFor(name, q.kind),
        ),
      );
    }
    for (const s of iac.services) {
      const existing = units.find((u) => u.kind === "external" && u.technology === s.technology);
      byId.set(
        s.id,
        existing ??
          add(
            {
              dir: "",
              kind: "external",
              technology: s.technology,
              code: [],
              source: `${s.technology}, which the functions in ${iac.dir || "the repository"} call`,
            },
            s.id,
          ),
      );
    }

    // Each function's uses, from the code that makes the call.
    const fnUnit = new Map<string, Unit>();
    for (const fn of iac.functions) {
      if (!fn.handler) continue;
      const container = ownerOf(units, fn.handler);
      if (!container) continue;
      fnUnit.set(fn.id, container);
      if (!container.technology?.includes("Lambda")) {
        container.technology = container.technology
          ? `${container.technology}, AWS Lambda`
          : fn.technology;
      }
      const handlerPart = partHolding(container, fn.handler);
      for (const u of fn.uses) {
        const to = byId.get(u.to);
        if (!to) continue;
        const caller =
          u.access === "consume"
            ? (handlerPart ?? container)
            : ((await callerOf(container, to, read, ctx.files)) ?? container);
        if (caller === to || caller.uses.has(to.key)) continue;
        caller.uses.set(
          to.key,
          `${ACCESS[u.access]} ${to.key} (${iac.files.includes(fn.file) ? fn.file : iac.dir})`,
        );
      }
    }

    // Where flows start, and who starts the scheduled ones.
    for (const t of iac.triggers) {
      const fn = iac.functions.find((f) => f.id === t.function);
      if (!fn?.handler) continue;
      const unit = fnUnit.get(fn.id);
      if (t.kind === "schedule" && unit) {
        extras.actors.scheduler ??= {
          kind: "agent",
          description: `What runs the scheduled jobs (${iac.tool === "cdk" ? "EventBridge rules in the CDK app" : "EventBridge rules in Terraform"}).`,
          uses: {},
          provenance: INFERRED,
        };
        const actor = extras.actors.scheduler as { uses: Record<string, unknown> };
        actor.uses[unit.key] = {
          description: `Runs ${fn.name ?? fn.id} on ${t.label} (${t.file})`,
          provenance: INFERRED,
        };
      }
    }

    // Environments, and what's deployed to each.
    const kinds = new Set([...byId.values()].map((u) => u.technology ?? ""));
    for (const env of iac.environments) {
      const nodes: Record<string, Record<string, unknown>> = {};
      const node = (id: string, spec: Record<string, unknown>) => {
        nodes[id] = spec;
        return `${env.id}.aws.${id}`;
      };
      const lambda = iac.functions.length
        ? node("lambda", { kind: "serverless", technology: "AWS Lambda" })
        : undefined;
      const managed = new Map<string, string>();
      for (const [re, id, technology] of [
        [/DynamoDB/, "dynamodb", "Amazon DynamoDB"],
        [/RDS/, "rds", "Amazon RDS"],
        [/SQS/, "sqs", "Amazon SQS"],
        [/SNS/, "sns", "Amazon SNS"],
        [/EventBridge/, "eventbridge", "Amazon EventBridge"],
        [/Kinesis/, "kinesis", "Amazon Kinesis"],
      ] as const) {
        const tech = [...kinds].find((k) => re.test(k));
        if (tech) managed.set(tech, node(id, { kind: "managed", technology }));
      }
      if (iac.buckets.some((b) => b.website))
        node("site", { kind: "cdn", technology: "Amazon S3 website" });
      extras.environments[env.id] = {
        ...(env.name && env.name !== env.id ? { name: env.name } : {}),
        description: `What ${iac.tool === "cdk" ? `the ${env.name ?? env.id} stack` : `the Terraform in ${iac.dir || "the repository"}`} deploys${env.region ? ` to ${env.region}` : ""}.`,
        nodes: {
          aws: {
            kind: "region",
            name: `AWS${env.region ? ` ${env.region}` : ""}`,
            technology: "AWS",
            code: env.code.length === 1 ? env.code[0] : env.code,
            nodes,
          },
        },
        provenance: INFERRED,
      };
      for (const u of new Set(fnUnit.values())) {
        if (lambda) u.deploy = [...new Set([...(u.deploy ?? []), lambda])];
      }
      for (const u of byId.values()) {
        const at = managed.get(u.technology ?? "");
        if (at) u.deploy = [...new Set([...(u.deploy ?? []), at])];
      }
    }
  }
}

/** The component inside a container whose code holds a file. */
function partHolding(container: Unit, file: string): Unit | undefined {
  return container.components.find((c) =>
    c.code.some((p) => p === file || (p.endsWith("/**") && file.startsWith(p.slice(0, -2)))),
  );
}

/**
 * The component that makes calls to a datastore, queue, or service: the only
 * one in the container whose code imports the SDK for it.
 */
async function callerOf(
  container: Unit,
  to: Unit,
  read: (f: string) => Promise<string>,
  files: readonly string[],
): Promise<Unit | undefined> {
  const sdk = SDK.find(([tech]) => tech.test(to.technology ?? ""))?.[1];
  if (!sdk || !container.components.length) return undefined;
  const importsOf = new Map<Unit, string>();
  for (const c of container.components) {
    const inside = files.filter((f) =>
      c.code.some((p) => p === f || (p.endsWith("/**") && f.startsWith(p.slice(0, -2)))),
    );
    const lines: string[] = [];
    for (const f of inside.filter(isSource)) {
      lines.push(
        ...(await read(f))
          .split("\n")
          .filter((l) => /^\s*(import\b|from\b|export .* from|.*require\()/.test(l)),
      );
    }
    importsOf.set(c, lines.join("\n"));
  }
  for (const re of [sdk, ANY_AWS_SDK]) {
    const hits = container.components.filter((c) => re.test(importsOf.get(c) ?? ""));
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) return undefined;
  }
  return undefined;
}

function uniqueEntity(data: Record<string, unknown>, name: string): string {
  let k = name;
  for (let i = 2; data[k]; i++) k = `${name}${i}`;
  return k;
}

/** a, b, and c. */
function list(items: string[]): string {
  return items.length <= 2
    ? items.join(" and ")
    : `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}
