---
"@archdoc/cli": patch
"@archdoc/core": patch
"@archdoc/spec": patch
"@archdoc/mcp": patch
---

Security hardening before 1.0.0. `archdoc view` answers only at its local address (127.0.0.1, localhost, or [::1]), so a web page that rebinds its own name to your machine can't read the model or send the agent a plan or a bug. The GitHub Action, the MCP configs, and the landscape workflow now run the CLI released with them instead of the newest on npm, and zod is at 4.6.7 or later.
