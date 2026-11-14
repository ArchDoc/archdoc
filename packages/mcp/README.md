# @archdoc/mcp

The ArchDoc MCP server, for coding agents: one tool per question an agent asks before and after it edits (`archdoc_context`, `archdoc_show`, `archdoc_check`, and more).

This package is part of [ArchDoc](https://archdoc.github.io), and is published for the `archdoc` command and its MCP server to use. **You probably want [`@archdoc/cli`](https://www.npmjs.com/package/@archdoc/cli).** Start it with `npx -y @archdoc/cli mcp`, or install the Claude Code plugin, which does it for you. [Agent setup](https://github.com/ArchDoc/archdoc/tree/main/integrations/agent-skills) covers Cursor, Codex, and others.

Its JavaScript API isn't covered by ArchDoc's [compatibility promise](https://github.com/ArchDoc/archdoc/blob/main/COMPATIBILITY.md) and may change in any release. Install the same version of every `@archdoc/*` package.

MIT licensed. Source: [github.com/ArchDoc/archdoc](https://github.com/ArchDoc/archdoc/tree/main/packages/mcp).
