// Claude as judge for the agent evals: is a model of a repository well
// decomposed and easy for an engineer new to it to digest? scoreModel in
// @archdoc/core says whether a model has the elements a reference has; this
// says whether the model is a good one, which a partial reference can't, on
// the rubric below. It also runs the onboarding test: the judge answers a
// newcomer's questions with one element of the model each, and the answer is
// a hit when that element's code covers where the answer is.
//
// Used by scripts/eval-agent.mjs (--judge), and on its own to calibrate it:
//
//   node scripts/eval-judge.mjs <repo-dir> [--model-dir <dir with archdoc yaml>]
//        [--reference evals/real-world/<name>/reference.yaml]
//        [--questions evals/real-world/<name>/questions.yaml] [--passes 1] [--no-cache]
//
// The judge model is fixed (JUDGE_MODEL) so scores compare across releases;
// change it only with a note in the report that scores reset.
//
// Verdicts are cached in evals/.cache/judge/, keyed by everything the judge
// is sent (model, system prompt, schema, prompt text) and the number of
// passes, so a model judged before (init's, for a pinned commit and an
// unchanged analyzer) isn't paid for again. A change to the rubric, the
// prompt, or the model being judged changes the key. --no-cache skips it.
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

export const JUDGE_MODEL = "claude-opus-5-5";

const here = new URL("..", import.meta.url).pathname;
/** yaml, from @archdoc/core's dependencies (the root package has none). */
export const { parse: parseYaml, stringify: stringifyYaml } = createRequire(
  join(here, "packages/core/package.json"),
)("yaml");

/** Where verdicts are cached (ignored by git). */
const CACHE = join(here, "evals/.cache/judge");
/**
 * The most model text the judge is sent, in characters (about 25K tokens).
 * Past it, code elements are left out (they say which file holds a function,
 * which the judge doesn't score), then the text is cut: a model that size
 * fails granularity anyway, and one such model cost $2.87 to judge.
 */
export const MAX_MODEL_CHARS = 100_000;

/** The rubric. Each dimension is scored 1 to 5 against these anchors. */
export const RUBRIC = [
  {
    id: "fidelity",
    name: "Fidelity",
    five: "Boundaries match how the project's own docs and maintainers describe it: the parts a maintainer would name are there, under names they'd recognize.",
    one: "Boundaries follow folders or build files with no meaning, or contradict the project's docs.",
  },
  {
    id: "granularity",
    name: "Granularity",
    five: "Each level fits in a head: a few top-level elements (about 3 to 12) and about 3 to 10 children under each, each one a real responsibility. No element that's one helper file, no grab-bag 'utils', no near-duplicate siblings. Many variants of one thing (one server in many languages) are grouped, not listed flat.",
    one: "Dozens of flat elements at one level, or one blob that holds everything.",
  },
  {
    id: "coverage",
    name: "Coverage",
    five: "The code that matters is mapped to elements, including infrastructure definitions; vendored, generated, and test-only code is left out or clearly marked.",
    one: "Major subsystems are missing, or vendored and generated code is modeled as architecture.",
  },
  {
    id: "relationships",
    name: "Relationships",
    five: "Uses are real (the code shows them), point the right way, sit at the level where the code makes them, and show the main flows without a hairball.",
    one: "Key calls are missing, uses are invented, or everything uses everything.",
  },
  {
    id: "infrastructure",
    name: "Infrastructure",
    five: "Datastores, queues, and external services are their own elements with the right kind and technology; deployment definitions (Kubernetes, Helm, Terraform, compose, Aspire) are mapped to what they deploy or provision, not modeled as code components. Score 5 when the repository has none and the model invents none.",
    one: "Infrastructure is missing, modeled as code components, or invented.",
  },
  {
    id: "descriptions",
    name: "Descriptions",
    five: "Every element has one or two sentences saying what it's responsible for, in the domain's terms, that a newcomer can act on.",
    one: "Descriptions are missing, restate the name, or list files.",
  },
  {
    id: "journeys",
    name: "Journeys",
    five: "Two or three journeys that a newcomer would actually trace (the main flows of the system), each step on a real element, with actors who really use the system.",
    one: "No journeys, or generic stories whose steps don't follow the code.",
  },
];

const ids = RUBRIC.map((d) => d.id);
const schema = {
  type: "object",
  properties: {
    scores: {
      type: "object",
      properties: Object.fromEntries(
        ids.map((id) => [
          id,
          {
            type: "object",
            properties: {
              score: { type: "integer", minimum: 1, maximum: 5 },
              why: { type: "string" },
              elements: { type: "array", items: { type: "string" } },
            },
            required: ["score", "why"],
          },
        ]),
      ),
      required: ids,
    },
    answers: {
      type: "array",
      items: {
        type: "object",
        properties: { question: { type: "integer" }, element: { type: "string" } },
        required: ["question", "element"],
      },
    },
    fixes: { type: "array", items: { type: "string" } },
  },
  required: ["scores", "answers", "fixes"],
};

const SYSTEM = [
  "You review architecture models that a coding agent wrote with ArchDoc for a repository it had never seen.",
  "A model is YAML: elements (system, container, component, code, datastore, queue, external) nested inside each other, each with a description, the code paths it covers (globs), and the elements it uses; plus actors, journeys, and data.",
  "Judge whether the model is well decomposed and easy for an engineer new to the repository to digest. Be strict and specific: a 3 is a model a good engineer would have to fix before sharing; a 5 needs nothing.",
  "Base every score on the model text, the repository tree, and the docs you're given. Name the element IDs behind each score.",
].join(" ");

function tree(repo) {
  const files = execFileSync("git", ["ls-files"], { cwd: repo, encoding: "utf8" })
    .split("\n")
    .filter((f) => f && !f.startsWith(".archdoc/"));
  // Directories down to depth 3 with how many files each holds, so the judge
  // sees the shape of a large repository without every file.
  const counts = new Map();
  for (const f of files) {
    const parts = f.split("/");
    for (let d = 1; d <= Math.min(3, parts.length - 1); d++) {
      const dir = `${parts.slice(0, d).join("/")}/`;
      counts.set(dir, (counts.get(dir) ?? 0) + 1);
    }
    if (parts.length === 1) counts.set(f, 0);
  }
  const lines = [...counts.keys()]
    .sort()
    .map(
      (k) =>
        `${"  ".repeat(k.split("/").length - (k.endsWith("/") ? 2 : 1))}${k.replace(/.*\/(?=[^/]+\/?$)/, "")}${counts.get(k) ? ` (${counts.get(k)} files)` : ""}`,
    );
  const cap = 400;
  return {
    files,
    text:
      lines.length > cap
        ? `${lines.slice(0, cap).join("\n")}\n… ${lines.length - cap} more`
        : lines.join("\n"),
  };
}

function docs(repo) {
  const out = [];
  const read = (p, max) => {
    const text = readFileSync(join(repo, p), "utf8");
    out.push(`--- ${p}\n${text.length > max ? `${text.slice(0, max)}\n… (cut)` : text}`);
  };
  if (existsSync(join(repo, "README.md"))) read("README.md", 8000);
  const arch = execFileSync("git", ["ls-files"], { cwd: repo, encoding: "utf8" })
    .split("\n")
    .filter((f) => /(architecture|design)[^/]*\.md$/i.test(f) && !f.startsWith(".archdoc/"))
    .slice(0, 2);
  for (const p of arch) read(p, 6000);
  return out.join("\n\n");
}

/** The model as the judge reads it: every YAML file under the model directory, except the lock, vendored models, and traces. */
export function modelText(dir, max = MAX_MODEL_CHARS) {
  const files = [];
  const walk = (d, rel) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (!["vendor", "traces"].includes(e.name)) walk(join(d, e.name), r);
      } else if (/\.ya?ml$/.test(e.name) && e.name !== "archdoc.lock") {
        files.push({ path: `.archdoc/${r}`, text: readFileSync(join(d, e.name), "utf8") });
      }
    }
  };
  walk(dir, "");
  const render = (fs) => fs.map((f) => `--- ${f.path}\n${f.text}`).join("\n\n");
  let text = render(files);
  if (text.length <= max) return text;
  // Too big: leave out the code elements, and say so.
  let dropped = 0;
  const strip = (elements) => {
    if (!elements || typeof elements !== "object") return;
    for (const [id, e] of Object.entries(elements)) {
      if (e && typeof e === "object" && e.kind === "code") {
        delete elements[id];
        dropped++;
      } else strip(e?.elements);
    }
  };
  const slim = files.map((f) => {
    try {
      const y = parseYaml(f.text);
      if (!y?.elements) return f;
      const before = dropped;
      strip(y.elements);
      return dropped > before ? { ...f, text: stringifyYaml(y) } : f;
    } catch {
      return f;
    }
  });
  text = render(slim);
  const notes = [];
  if (dropped) notes.push(`${dropped} code elements (kind: code) were left out to fit.`);
  if (text.length > max) {
    notes.push(`The model was cut at ${max} characters of ${text.length}.`);
    text = text.slice(0, max);
  }
  return `(This model is too large to show whole. ${notes.join(" ")})\n\n${text}`;
}

function prompt({ model, repo, reference, questions }) {
  const parts = [
    "# The rubric",
    "Score each dimension from 1 to 5. Anchors:",
    ...RUBRIC.map((d) => `- ${d.id} (${d.name}). 5: ${d.five} 1: ${d.one}`),
    "",
    "# The repository",
    "Its tree, directories to depth 3 with file counts:",
    repo.text,
    "",
    "Its docs:",
    repo.docs || "(none)",
  ];
  if (reference) {
    parts.push(
      "",
      "# Expert notes",
      "What maintainers would agree the system has. It's partial and may name or nest things differently; use it to check fidelity and coverage, not as the only right answer.",
      reference,
    );
  }
  parts.push("", "# The model to judge", model);
  if (questions?.length) {
    parts.push(
      "",
      "# Onboarding questions",
      "Answer each as a newcomer who has only this model: give the ID of the single container or component (as the model spells it, nested IDs with dots) you'd open first, the most specific one that answers it; not a code element. Don't use the repository tree for this, only the model.",
      ...questions.map((q, i) => `${i}. ${q.ask}`),
    );
  } else {
    parts.push("", "There are no onboarding questions: return an empty answers list.");
  }
  parts.push(
    "",
    "Then list up to five fixes that would most improve the model, most important first.",
  );
  return parts.join("\n");
}

function callJudge(text, claude) {
  const cwd = mkdtempSync(join(tmpdir(), "archdoc-judge-"));
  const args = [
    // The prompt goes on stdin: a large model doesn't fit in argv.
    "-p",
    "--model",
    JUDGE_MODEL,
    "--system-prompt",
    SYSTEM,
    "--tools",
    "",
    "--strict-mcp-config",
    "--setting-sources",
    "",
    "--no-session-persistence",
    "--max-turns",
    "3",
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(schema),
  ];
  return new Promise((done) => {
    const child = spawn(claude, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    child.stdin.end(text);
    child.on("error", (e) => done({ error: String(e) }));
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => {
      out += d;
    });
    child.stderr.on("data", (d) => {
      err += d;
    });
    child.on("close", (code) => {
      rmSync(cwd, { recursive: true, force: true });
      try {
        const r = JSON.parse(out);
        let verdict = r.structured_output;
        if (!verdict && typeof r.result === "string") {
          const m = r.result.match(/\{[\s\S]*\}/);
          if (m) verdict = JSON.parse(m[0]);
        }
        done({ verdict, cost: r.total_cost_usd, error: verdict ? undefined : "no verdict" });
      } catch (e) {
        done({ error: err.trim() || `exited ${code}: ${String(e)}` });
      }
    });
  });
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length
    ? s.length % 2
      ? s[(s.length - 1) / 2]
      : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
    : undefined;
};

/** The element a judge named, found by its full ID, its ID without the namespace, or its last segment when only one element has it. */
function findElement(model, id) {
  if (!id) return undefined;
  const clean = id.trim().replace(/^`|`$/g, "");
  if (model.elements.has(clean)) return clean;
  for (const k of model.elements.keys()) if (k.endsWith(`.${clean}`) || k === clean) return k;
  const last = clean.split(".").pop();
  const hits = [...model.elements.keys()].filter((k) => k.split(".").pop() === last);
  return hits.length === 1 ? hits[0] : undefined;
}

/**
 * Judges one model `passes` times and keeps the median of each dimension.
 * `found` is the loaded model (for the onboarding test), `modelDir` the
 * directory its YAML is in.
 */
export async function judge({
  repoDir,
  modelDir,
  found,
  reference,
  questions,
  passes = 1,
  claude = "claude",
  core,
  cache = true,
}) {
  const r = tree(repoDir);
  const text = prompt({
    model: modelText(modelDir),
    repo: { text: r.text, docs: docs(repoDir) },
    reference,
    questions,
  });
  const key = createHash("sha256")
    .update(JSON.stringify({ model: JUDGE_MODEL, system: SYSTEM, schema, text, passes }))
    .digest("hex");
  const cached = join(CACHE, `${key}.json`);
  let runs;
  let hit = false;
  if (cache && existsSync(cached)) {
    runs = JSON.parse(readFileSync(cached, "utf8")).runs;
    hit = true;
  } else {
    runs = await Promise.all(Array.from({ length: passes }, () => callJudge(text, claude)));
    // Only a full set of verdicts is kept: a failed pass is tried again next time.
    if (cache && runs.every((x) => x.verdict)) {
      mkdirSync(CACHE, { recursive: true });
      writeFileSync(cached, JSON.stringify({ model: JUDGE_MODEL, passes, runs }));
    }
  }
  const ok = runs.filter((x) => x.verdict);
  const scores = Object.fromEntries(
    ids.map((id) => [
      id,
      median(ok.map((x) => x.verdict.scores[id]?.score).filter(Number.isFinite)),
    ]),
  );
  const mean = ids.map((id) => scores[id]).filter((x) => x !== undefined);
  const result = {
    model: JUDGE_MODEL,
    passes: ok.length,
    scores,
    // 1 to 5 mapped onto 0 to 1, so it reads next to scoreModel's numbers.
    digestibility: mean.length
      ? (mean.reduce((a, b) => a + b, 0) / mean.length - 1) / 4
      : undefined,
    spread: Object.fromEntries(
      ids.map((id) => {
        const xs = ok.map((x) => x.verdict.scores[id]?.score).filter(Number.isFinite);
        return [id, xs.length ? Math.max(...xs) - Math.min(...xs) : undefined];
      }),
    ),
    // What this call spent: nothing when the verdicts came from the cache.
    cost: hit ? 0 : runs.reduce((a, x) => a + (x.cost ?? 0), 0),
    cached: hit,
    verdicts: ok.map((x) => x.verdict),
    errors: runs.filter((x) => x.error).map((x) => x.error),
  };
  if (questions?.length && found && core) {
    const map = core.resolveCodeMap(found, r.files);
    const per = questions.map((q, i) => {
      const tries = ok.map((x) => {
        const named = x.verdict.answers.find((a) => a.question === i)?.element;
        // Code elements are lifted to the component they're in: the test is
        // whether the model's components lead a newcomer to the answer.
        let id = findElement(found, named);
        while (
          id &&
          found.elements.get(id)?.spec.kind === "code" &&
          found.elements.get(id).parentId
        ) {
          id = found.elements.get(id).parentId;
        }
        const files = id ? core.filesUnder(found, map, id) : [];
        return { named, id, hit: q.paths.some((p) => files.includes(p)), files: files.length };
      });
      return {
        ask: q.ask,
        hit: tries.filter((t) => t.hit).length > tries.length / 2,
        // How many files the named element covers: the fewer, the less a newcomer has to read.
        files: median(tries.filter((t) => t.hit).map((t) => t.files)),
        tries,
      };
    });
    result.onboarding = {
      hits: per.filter((p) => p.hit).length,
      total: per.length,
      files: median(per.map((p) => p.files).filter(Number.isFinite)),
      questions: per,
    };
  }
  return result;
}

// On its own: judge one model, for calibrating the rubric.
if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i < 0 ? undefined : argv.splice(i, 2)[1];
  };
  const noCache = argv.indexOf("--no-cache");
  if (noCache >= 0) argv.splice(noCache, 1);
  const cache = noCache < 0;
  const modelDir = resolve(flag("--model-dir") ?? join(argv[0] ?? ".", ".archdoc"));
  const referencePath = flag("--reference");
  const questionsPath = flag("--questions");
  const passes = Number(flag("--passes") ?? "1");
  const repoDir = resolve(argv[0] ?? ".");
  const core = await import(join(here, "packages/core/dist/index.js"));
  const questions = questionsPath ? parseYaml(readFileSync(questionsPath, "utf8")) : undefined;
  const found = core.buildModel(
    readdirSync(modelDir)
      .filter((f) => /\.ya?ml$/.test(f) && f !== "archdoc.lock")
      .map((f) => ({ path: f, text: readFileSync(join(modelDir, f), "utf8") })),
    {
      root: existsSync(join(modelDir, "archdoc.yaml"))
        ? "archdoc.yaml"
        : readdirSync(modelDir).find((f) => /\.ya?ml$/.test(f)),
    },
  );
  const r = await judge({
    repoDir,
    modelDir,
    found,
    reference: referencePath ? readFileSync(referencePath, "utf8") : undefined,
    questions,
    passes,
    core,
    cache,
  });
  console.log(
    JSON.stringify(argv.includes("--verbose") ? r : { ...r, verdicts: undefined }, null, 2),
  );
}
