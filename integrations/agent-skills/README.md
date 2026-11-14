# Agent integrations

ArchDoc is most useful when your coding agent starts each task with the architecture: it finds where a change belongs and what it affects before it searches the code. The workflows are the same in every agent: a change (context, edit code and model, check, seal), a bug (a Triage record, hop by hop to its root cause), a change to design (a plan on the explorer's map), and a repository with no model (init, describe it, check).

## Claude Code

Install the plugin from [`integrations/claude-plugin`](../claude-plugin). It brings the skill and the MCP server, pinned to the CLI version released with it:

```
/plugin marketplace add ArchDoc/archdoc
/plugin install archdoc@archdoc
```

The skill is [`claude-plugin/skills/archdoc/SKILL.md`](../claude-plugin/skills/archdoc/SKILL.md). To set a repository up without the plugin, copy that folder to `.claude/skills/archdoc/` and [`mcp/claude-code.mcp.json`](./mcp/claude-code.mcp.json) to `.mcp.json`.

## Cursor, Codex, and other agents

1. Paste [`AGENTS.md`](./AGENTS.md) near the top of your repository's `AGENTS.md`. Codex, Cursor, Copilot, and others read it.
2. Copy the skill folder, [`claude-plugin/skills/archdoc/`](../claude-plugin/skills/archdoc), to `.agents/skills/archdoc/` in your repository. Codex looks for skills there, not in `.claude/skills/` or the Claude Code plugin cache.
3. Register the MCP server, which runs `npx -y @archdoc/cli@0.9.2 mcp` in the repository:
   - **Cursor:** copy [`mcp/cursor.mcp.json`](./mcp/cursor.mcp.json) to `.cursor/mcp.json`.
   - **Codex:** add it to `~/.codex/config.toml`:
     ```toml
     [mcp_servers.archdoc]
     command = "npx"
     args = ["-y", "@archdoc/cli@0.9.2", "mcp"]
     ```
     `npx` downloads `@archdoc/cli` from npm the first time, and Codex's sandbox has no network access by default, so the server (and `npx @archdoc/cli` in a shell) exits with no output. Do one of these:
     - Allow network access: add `network_access = true` under `[sandbox_workspace_write]` in `~/.codex/config.toml`.
     - Install the CLI in the repository with `npm install --save-dev @archdoc/cli`, so `npx` finds it without the network.
   - **On Windows:** an agent that starts the server without a shell can't run `npx` directly, because it's `npx.cmd`. Use `"command": "cmd", "args": ["/c", "npx", "-y", "@archdoc/cli@0.9.2", "mcp"]` (in Codex, `command = "cmd"` and those `args`). The Claude Code plugin does this for you.
   - **Anything else with MCP:** a stdio server with that command. Without MCP, the agent can run the CLI: each tool is a command of the same name, with `--format json` where it needs structure.

## MCP tools

One tool per question. Every tool reloads the model on every call, and the CLI command of the same name prints the same answer. All of them are read-only except `archdoc_edit`, which changes the model by ID, `archdoc_seal`, which writes only `.archdoc/archdoc.sum`, `archdoc_triage` and `archdoc_plan`, which write only `.archdoc/triage/` and `.archdoc/plans/`, and `archdoc_init`, which writes `.archdoc/` only when there's none.

| Tool | Answers |
|---|---|
| `archdoc_context` | Where do I start, and what does it affect? For a task in words or the files to change (even ones that don't exist yet): files and functions to open first, other callers of the same functions, data, rules, journeys, tests, owners, and who uses it, other repos included. For an error: the journey steps it showed up in. With nothing: an overview |
| `archdoc_paths` | Where do flows start, and what does each call? Routes, consumers, schedules, and CLI commands, with the calls each makes by function, file, and line |
| `archdoc_show` | What is this one thing? An element (with its code), actor, journey, data entry, `Entry.field` (lineage), Triage record, or a sealed fact |
| `archdoc_find` | Which parts of the model are these? By words, inside an element, owning a file, or missing a description, use, deploy, or fields, each with its ID and where it's written. `outline: true`: the element tree with code and uses |
| `archdoc_edit` | Change the model by ID: `add`, `set` (a JSON merge patch), `remove`, `rename` (references follow), `use`, and `step` ops, many per call, all written or none. Writes only the lines it changes, refuses an edit that adds errors, and says what it fixed and broke |
| `archdoc_check` | What's wrong or stale? Model problems, undeclared imports, broken rules and journeys, stale paths, Triage records, and facts whose sealed code changed, each with its fix. With `base`, only what the change caused, with a verdict; `format: "markdown"` returns it as a report for the pull request description |
| `archdoc_seal` | Record that the facts you checked still describe their code, and say what's left |
| `archdoc_triage` | I've been handed a bug: where does it start? Starts a Triage record to fill in, or waits for one sent from the explorer |
| `archdoc_plan` | Design a change with the person on the explorer's map, then carry out its tasks |
| `archdoc_init` | Start a model in a repository without one, every fact marked inferred |
