// Approves the staged versions of the six @archdoc packages, after a release
// run has staged them (scripts/release.mjs). Run it on your own machine,
// logged in to npm as a maintainer:
//
//   pnpm approve-staged            # the version in packages/cli/package.json
//   pnpm approve-staged 0.4.1      # a given version
//   pnpm approve-staged --yes      # without asking first
//
// It lists what's staged, asks once, then approves each package in turn.
// npm asks for 2FA itself (a browser or a one-time code) when it needs it.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";

const PKGS = ["spec", "core", "analyzers", "federation", "mcp", "cli"].map((p) => `@archdoc/${p}`);
const NPM = ["-y", "npm@11"];
const args = process.argv.slice(2);
const yes = args.includes("--yes");
const version =
  args.find((a) => /^\d+\.\d+\.\d+/.test(a)) ??
  JSON.parse(readFileSync(new URL("../packages/cli/package.json", import.meta.url), "utf8"))
    .version;

const npx = (rest, opts = {}) =>
  execFileSync("npx", [...NPM, ...rest], { encoding: "utf8", ...opts });

try {
  console.log(`npm user: ${npx(["whoami"]).trim()}`);
} catch {
  console.error("Not logged in to npm. Run `npx -y npm@11 login` first.");
  process.exit(1);
}

const staged = [];
for (const pkg of PKGS) {
  const items = JSON.parse(npx(["stage", "list", pkg, "--json"]) || "[]");
  const item = items.find(
    (i) => i.version === version && !/approved|rejected|published/i.test(i.status ?? ""),
  );
  if (item) staged.push(item);
  else console.log(`  ${pkg}@${version}: nothing staged`);
}
if (!staged.length) {
  console.log(`Nothing staged for ${version}.`);
  process.exit(0);
}

console.log(`\nStaged for ${version}:`);
for (const i of staged) console.log(`  ${i.packageName}@${i.version}  ${i.status ?? ""}  ${i.id}`);
if (!yes) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`\nApprove and publish these ${staged.length}? [y/N] `);
  rl.close();
  if (!/^y(es)?$/i.test(answer.trim())) process.exit(0);
}

let failed = 0;
for (const i of staged) {
  console.log(`\n== ${i.packageName}@${i.version}`);
  try {
    npx(["stage", "approve", i.id], { stdio: "inherit" });
  } catch {
    failed++;
    console.error(`✗ ${i.packageName} wasn't approved; run it again to retry the rest.`);
  }
}
const latest = npx(["view", "@archdoc/cli", "dist-tags.latest"]).trim();
console.log(
  `\n${staged.length - failed} of ${staged.length} approved. @archdoc/cli latest: ${latest}`,
);
process.exit(failed ? 1 : 0);
