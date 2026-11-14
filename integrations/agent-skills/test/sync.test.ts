import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("agent integrations", () => {
  // Claude Code reads .claude/skills/; Codex and other agents read .agents/skills/.
  const SKILL_FILES = [
    "SKILL.md",
    "references/init.md",
    "references/plan.md",
    "references/triage.md",
  ];
  it.each([".claude", ".agents"])("this repo's %s/skills/ has the same skill it ships", (dir) => {
    for (const file of SKILL_FILES) {
      expect(read(`../../../${dir}/skills/archdoc/${file}`), file).toBe(
        read(`../../claude-plugin/skills/archdoc/${file}`),
      );
    }
  });

  it("keeps the skill an agent reads on every task short, and links each reference", () => {
    const skill = read("../../claude-plugin/skills/archdoc/SKILL.md");
    // Init, triage, and plan are read only for those tasks: a change loads this file alone.
    expect(skill.split(/\s+/).length).toBeLessThan(2600);
    for (const file of SKILL_FILES.slice(1)) expect(skill).toContain(`](${file})`);
  });

  it("this repo's AGENTS.md carries the shipped workflow, word for word", () => {
    // The shipped snippet, without the line that says where to paste it.
    const shipped = read("../AGENTS.md").replace(/^<!--.*-->\n\n/, "");
    // This repo runs the CLI from its build.
    const own = read("../../../AGENTS.md").replaceAll("pnpm -s archdoc", "archdoc");
    expect(shipped).toContain("Every task: context, edit, check, seal.");
    expect(own).toContain(shipped.trim());
  });

  it("the skill has the frontmatter Claude Code needs", () => {
    expect(read("../../claude-plugin/skills/archdoc/SKILL.md")).toMatch(
      /^---\nname: archdoc\ndescription: .+\n---\n/,
    );
  });

  it("the plugin runs the CLI released with it, from the marketplace at the root", () => {
    const { version } = JSON.parse(read("../../../packages/cli/package.json"));
    const plugin = JSON.parse(read("../../claude-plugin/.claude-plugin/plugin.json"));
    const mcp = JSON.parse(read("../../claude-plugin/.mcp.json"));
    const market = JSON.parse(read("../../../.claude-plugin/marketplace.json"));
    // pnpm version-packages (or set-version) runs scripts/sync-plugin.mjs.
    expect(plugin.version).toBe(version);
    // node on a launcher rather than npx, which Windows can't start without a shell.
    expect(mcp.mcpServers.archdoc).toEqual({
      command: "node",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Claude Code expands it, not JavaScript.
      args: ["${CLAUDE_PLUGIN_ROOT}/scripts/mcp.mjs", `@archdoc/cli@${version}`],
    });
    // From the release branch, which moves only once a version is live on npm (publish.yml).
    expect(market.plugins).toEqual([
      expect.objectContaining({
        name: plugin.name,
        source: {
          source: "git-subdir",
          url: "https://github.com/ArchDoc/archdoc.git",
          path: "integrations/claude-plugin",
          ref: "release",
        },
      }),
    ]);
  });

  it("every integration runs the CLI released with it, never whatever is newest", () => {
    const { version } = JSON.parse(read("../../../packages/cli/package.json"));
    const files = [
      "../../github-action/action.yml",
      "../../github-action/README.md",
      "../README.md",
      "../mcp/claude-code.mcp.json",
      "../mcp/cursor.mcp.json",
      "../../landscape-template/workflows/archdoc-landscape.yml",
    ];
    for (const file of files) {
      const text = read(file);
      // Every @archdoc/cli it runs names this version, and it runs at least one.
      const runs = [...text.matchAll(/(?:npx -y |")@archdoc\/cli(@[\w.-]+)?/g)];
      expect(runs.length, file).toBeGreaterThan(0);
      for (const m of runs) expect(m[1], `${file}: ${m[0]}`).toBe(`@${version}`);
    }
    expect(read("../../github-action/README.md")).not.toContain("github-action@main");
  });
});
