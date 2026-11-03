---
"@archdoc/cli": patch
---

The archdoc skill and the AGENTS.md snippet tell agents that `npx @archdoc/cli` and the MCP server download the CLI the first time, so in a sandbox without network access (Codex's default) they exit with no output. The agent reruns the command with network access instead of reading it as an empty answer, or tells the user how to allow it or install the CLI in the repository. The Codex setup notes say the same.
