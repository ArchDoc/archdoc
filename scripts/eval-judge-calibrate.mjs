// Checks that the judge in scripts/eval-judge.mjs tells good models from bad
// ones before its scores are trusted: on each fixture in evals/fixtures it
// judges the golden model, what archdoc init writes, and a blob (one
// container that holds everything). The golden model should score highest
// and the blob lowest. Run it again whenever the rubric or JUDGE_MODEL
// changes. Calls a model, so it costs money (about $4 for every fixture at 3
// passes).
//
//   pnpm build
//   node scripts/eval-judge-calibrate.mjs [fixture...] [--passes 3] [--out <dir>]
import { execFileSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { JUDGE_MODEL, judge, RUBRIC } from "./eval-judge.mjs";

const here = new URL("..", import.meta.url).pathname;
const fixtures = join(here, "evals/fixtures");
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(name);
  return i < 0 ? fallback : argv.splice(i, 2)[1];
};
const passes = Number(flag("--passes", "3"));
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const out = resolve(flag("--out", join(here, "evals/results", `judge-${stamp}`)));
const names = argv.filter((a) => !a.startsWith("--"));
const chosen = names.length
  ? names
  : readdirSync(fixtures, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();

const core = await import(join(here, "packages/core/dist/index.js"));
const { inferModel } = await import(join(here, "packages/analyzers/dist/index.js"));

const blob = (ns) =>
  [
    'archdoc: "2.0"',
    `namespace: ${ns}`,
    "elements:",
    "  app:",
    "    kind: container",
    "    description: The application.",
    '    code: "**"',
    "",
  ].join("\n");

const load = (dir) =>
  core.buildModel(
    readdirSync(dir)
      .filter((f) => f.endsWith(".yaml"))
      .map((f) => ({ path: f, text: readFileSync(join(dir, f), "utf8") })),
    { root: "archdoc.yaml" },
  );

mkdirSync(out, { recursive: true });
const rows = [];
for (const name of chosen) {
  const work = mkdtempSync(join(tmpdir(), `archdoc-judge-${name}-`));
  const repo = join(work, "repo");
  cpSync(join(fixtures, name, "repo"), repo, { recursive: true });
  const git = (...a) => execFileSync("git", a, { cwd: repo, stdio: "ignore" });
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("-c", "user.name=eval", "-c", "user.email=eval@archdoc.invalid", "commit", "-qm", "init");

  const models = {};
  models.golden = join(work, "golden");
  mkdirSync(models.golden);
  cpSync(join(fixtures, name, "golden.yaml"), join(models.golden, "archdoc.yaml"));
  models.init = join(work, "init");
  mkdirSync(models.init);
  for (const f of (await inferModel(repo)).files) {
    const p = join(models.init, f.path.replace(/^\.archdoc\//, ""));
    mkdirSync(join(p, ".."), { recursive: true });
    writeFileSync(p, f.text);
  }
  models.blob = join(work, "blob");
  mkdirSync(models.blob);
  writeFileSync(join(models.blob, "archdoc.yaml"), blob(name));

  const row = { fixture: name };
  await Promise.all(
    Object.entries(models).map(async ([kind, dir]) => {
      row[kind] = await judge({ repoDir: repo, modelDir: dir, found: load(dir), passes, core });
      console.log(`${name} ${kind}: ${Math.round((row[kind].digestibility ?? 0) * 100)}%`);
    }),
  );
  rows.push(row);
  rmSync(work, { recursive: true, force: true });
}

const pct = (x) => (x === undefined ? "–" : `${Math.round(x * 100)}%`);
const kinds = ["golden", "init", "blob"];
const ordered = rows.filter(
  (r) =>
    r.golden.digestibility > r.init.digestibility && r.init.digestibility > r.blob.digestibility,
);
const cost = rows.reduce((a, r) => a + kinds.reduce((b, k) => b + r[k].cost, 0), 0);
const lines = [
  "# Judge calibration",
  "",
  `${new Date().toISOString()} · ${JUDGE_MODEL} · ${passes} passes per model, median per dimension · $${cost.toFixed(2)}`,
  "",
  "Digestibility is the mean of the rubric's dimensions, 1 to 5 mapped onto 0 to 100%. The golden model should score highest and the blob lowest.",
  "",
  "| Fixture | Golden | Init | Blob | Ordered |",
  "|---|---|---|---|---|",
  ...rows.map(
    (r) =>
      `| ${r.fixture} | ${pct(r.golden.digestibility)} | ${pct(r.init.digestibility)} | ${pct(r.blob.digestibility)} | ${ordered.includes(r) ? "yes" : "**no**"} |`,
  ),
  "",
  "By dimension (median over fixtures), golden / init / blob:",
  "",
  ...RUBRIC.map((d) => {
    const med = (k) => {
      const xs = rows
        .map((r) => r[k].scores[d.id])
        .filter(Number.isFinite)
        .sort((a, b) => a - b);
      return xs.length ? xs[Math.floor(xs.length / 2)] : "–";
    };
    const spread = Math.max(...rows.flatMap((r) => kinds.map((k) => r[k].spread[d.id] ?? 0)));
    return `- ${d.name}: ${med("golden")} / ${med("init")} / ${med("blob")} (largest spread between passes: ${spread})`;
  }),
];
writeFileSync(join(out, "calibration.md"), `${lines.join("\n")}\n`);
writeFileSync(join(out, "calibration.json"), JSON.stringify(rows, null, 2));
console.log(`\n${lines.join("\n")}\n\nWrote ${join(out, "calibration.md")}.`);
