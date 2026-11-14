# ArchDoc for Claude Code

An architecture model your coding agent reads before it edits, and keeps true as the code changes.

```
/plugin marketplace add ArchDoc/archdoc
/plugin install archdoc@archdoc
```

The plugin brings two things:

- **The `archdoc` skill** ([`skills/archdoc/SKILL.md`](./skills/archdoc/SKILL.md)): Claude starts each task from the repository's model in `.archdoc/`, edits the model with the code, and checks and seals before it's done. Handed a bug, it triages it to its root cause in a Triage record. Asked to design a change, it plans it with you on the explorer's map. In a repository with no model, it starts one.
- **The MCP server** ([`.mcp.json`](./.mcp.json)): `archdoc_context`, `archdoc_show`, `archdoc_paths`, `archdoc_find`, `archdoc_edit`, `archdoc_check`, `archdoc_seal`, `archdoc_triage`, `archdoc_plan`, and `archdoc_init`, from `@archdoc/cli` at the version released with this plugin. It runs in the repository Claude Code is open in, through `npx` (started by [`scripts/mcp.mjs`](./scripts/mcp.mjs), so it works on Windows too), and needs Node.js 22.12 or later.

To start, open a repository and ask: "Start an architecture model for this repository." Then, on any task, Claude reads the model first. To update, run `/plugin marketplace update archdoc`.

## How releases reach the plugin

The plugin's version and the CLI it runs move together: `pnpm version-packages` runs [`scripts/sync-plugin.mjs`](../../scripts/sync-plugin.mjs), and a test fails if they drift. The marketplace, [`.claude-plugin/marketplace.json`](../../.claude-plugin/marketplace.json) at the repository root, installs the plugin from the `release` branch, not `main`. The [publish workflow](../../.github/workflows/publish.yml) moves `release` to a version only once that version is live on npm, so the plugin never runs a CLI that isn't published yet. Check both with `claude plugin validate .` and `claude plugin validate integrations/claude-plugin`.
