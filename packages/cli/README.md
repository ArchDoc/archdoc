# @archdoc/cli

**Understand your architecture while AI builds it.**

[ArchDoc](https://archdoc.github.io) keeps a model of your system's architecture in your repository, in `.archdoc/`: who uses it, what it's made of (each part mapped to its code), how people reach their goals through it, and what data moves where. Your coding agent reads the model before it edits and keeps it true as the code changes. You read it in the explorer.

This is the `archdoc` command. It needs Node.js 22.12 or later, on macOS, Linux, or Windows.

```bash
npx -y @archdoc/cli init       # start a model in this repository
npx -y @archdoc/cli view       # open it in the explorer
npx -y @archdoc/cli check      # what's wrong or stale in the model
npx -y @archdoc/cli --help     # every command
```

In Claude Code, install the plugin instead: it brings the skill and these commands as MCP tools.

```
/plugin marketplace add ArchDoc/archdoc
/plugin install archdoc@archdoc
```

For Cursor, Codex, and other agents, run `archdoc mcp` as a stdio MCP server: [agent setup](https://github.com/ArchDoc/archdoc/tree/main/integrations/agent-skills).

## Commands

| Command | What it does |
|---|---|
| `init` | Start a model from what the repository declares, every fact marked inferred |
| `view` | Open the explorer in your browser |
| `context` | Where to start a task, and what it affects |
| `show`, `find`, `paths`, `map` | Look up one thing, find parts of the model, list where flows start, map files to the model |
| `edit` | Change the model by ID, writing only the lines that change |
| `check` | What's wrong or stale; with `--base main`, what your branch does |
| `seal` | Record that the model still describes the code |
| `triage`, `plan` | Triage records for bugs, and plans for changes designed on the map |
| `validate`, `diff`, `report`, `site`, `schema` | Check the model, compare it, report on a change, publish the explorer, print the JSON Schema |
| `mcp` | Start the MCP server for coding agents |

ArchDoc sends no telemetry. The explorer listens on `localhost` only.

From 1.0, the CLI's commands, flags, exit codes, and JSON output, and the model format, follow semantic versioning: see [COMPATIBILITY.md](https://github.com/ArchDoc/archdoc/blob/main/COMPATIBILITY.md). Release notes are on [GitHub Releases](https://github.com/ArchDoc/archdoc/releases).

MIT licensed. Source: [github.com/ArchDoc/archdoc](https://github.com/ArchDoc/archdoc).
