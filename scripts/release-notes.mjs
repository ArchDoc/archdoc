// Prints the GitHub release notes for a version: every change the packages'
// changelogs list for it, once each (a change that touched several packages
// shows in each of their changelogs), without the "Updated dependencies" lines,
// and how to install it. Run by .github/workflows/publish.yml.
//
//   node scripts/release-notes.mjs [version]   (default: the CLI's version)
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const version =
  process.argv[2] ??
  JSON.parse(readFileSync(join(root, "packages/cli/package.json"), "utf8")).version;

/** The entries under `## version` in one changelog, by the kind of change. */
export function entries(changelog, version) {
  const lines = changelog.split("\n");
  const start = lines.findIndex((l) => l.trim() === `## ${version}`);
  if (start < 0) return [];
  const out = [];
  let kind = "Changes";
  let current;
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) break;
    const heading = /^### (\w+) Changes/.exec(line);
    if (heading) {
      kind = heading[1];
      current = undefined;
    } else if (line.startsWith("- ")) {
      current = { kind, lines: [line] };
      out.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }
  return out
    .filter((e) => !e.lines[0].startsWith("- Updated dependencies"))
    .map((e) => ({
      kind: e.kind,
      // Changesets starts each entry with its commit: "- a59fd90: The Plan tab…"
      id: /^- ([0-9a-f]{7,40}):/.exec(e.lines[0])?.[1] ?? e.lines[0],
      text: e.lines
        .join("\n")
        .replace(/^- [0-9a-f]{7,40}: /, "- ")
        .trimEnd(),
    }));
}

export function releaseNotes(version, changelogs) {
  const seen = new Set();
  const byKind = new Map();
  for (const changelog of changelogs) {
    for (const e of entries(changelog, version)) {
      if (seen.has(e.id)) continue;
      seen.add(e.id);
      byKind.set(e.kind, [...(byKind.get(e.kind) ?? []), e.text]);
    }
  }
  const sections = ["Major", "Minor", "Patch", "Changes"]
    .filter((k) => byKind.has(k))
    .map(
      (k) => `### ${k === "Changes" ? "Changes" : `${k} changes`}\n\n${byKind.get(k).join("\n")}`,
    );
  return [
    ...(sections.length ? sections : ["Dependency updates only."]),
    "### Install",
    [
      "In Claude Code: `/plugin marketplace add ArchDoc/archdoc`, then `/plugin install archdoc@archdoc` (or `/plugin marketplace update archdoc` to update).",
      "",
      `Anywhere with Node.js 22.12 or later: \`npx -y @archdoc/cli@${version} init\`.`,
    ].join("\n"),
  ].join("\n\n");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = join(root, "packages");
  // The CLI first, so a change reads where people meet it.
  const names = readdirSync(dir).sort((a, b) =>
    a === "cli" ? -1 : b === "cli" ? 1 : a < b ? -1 : 1,
  );
  const changelogs = names.flatMap((name) => {
    try {
      return [readFileSync(join(dir, name, "CHANGELOG.md"), "utf8")];
    } catch {
      return [];
    }
  });
  console.log(releaseNotes(version, changelogs));
}
