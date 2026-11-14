// Pins every integration to the CLI version released from the same commit:
// the Claude Code plugin (its version in plugin.json, and the @archdoc/cli its
// MCP server runs), the GitHub Action's default command and the tag its README
// uses, the MCP configs and landscape workflow people copy. Pinned, so no
// integration runs a CLI release nobody chose. Runs after `changeset version`
// (pnpm version-packages) and in set-version;
// integrations/agent-skills/test/sync.test.ts checks it.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const plugin = join(root, "integrations/claude-plugin");
const { version } = JSON.parse(readFileSync(join(root, "packages/cli/package.json"), "utf8"));

// Only the version strings change, so the files keep the repo's formatting.
const manifest = join(plugin, ".claude-plugin/plugin.json");
writeFileSync(
  manifest,
  readFileSync(manifest, "utf8").replace(/"version": "[^"]+"/, `"version": "${version}"`),
);

const mcp = join(plugin, ".mcp.json");
writeFileSync(
  mcp,
  readFileSync(mcp, "utf8").replace(/@archdoc\/cli@[^"]+/, `@archdoc/cli@${version}`),
);
// Every other place that runs the CLI or names the action's release.
const pinned = [
  "integrations/github-action/action.yml",
  "integrations/github-action/README.md",
  "integrations/agent-skills/README.md",
  "integrations/agent-skills/mcp/claude-code.mcp.json",
  "integrations/agent-skills/mcp/cursor.mcp.json",
  "integrations/landscape-template/workflows/archdoc-landscape.yml",
];
for (const rel of pinned) {
  const file = join(root, rel);
  writeFileSync(
    file,
    readFileSync(file, "utf8")
      .replace(/@archdoc\/cli@\d+\.\d+\.\d+[\w.-]*/g, `@archdoc/cli@${version}`)
      .replace(/github-action@v\d+\.\d+\.\d+[\w.-]*/g, `github-action@v${version}`)
      .replace(/`v\d+\.\d+\.\d+[\w.-]*`/g, `\`v${version}\``),
  );
}
console.log(`The plugin and integrations run @archdoc/cli@${version}.`);
