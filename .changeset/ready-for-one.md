---
"@archdoc/spec": patch
"@archdoc/core": patch
"@archdoc/analyzers": patch
"@archdoc/federation": patch
"@archdoc/mcp": patch
"@archdoc/cli": patch
---

Ready for 1.0: a compatibility promise, clear errors for what an older ArchDoc can't read, and the same plugin on every platform.

- [COMPATIBILITY.md](https://github.com/ArchDoc/archdoc/blob/main/COMPATIBILITY.md) says what semantic versioning covers from 1.0: the model format, the CLI's commands, flags, exit codes, and JSON output, and the MCP tools' names and inputs. Experimental parts, including the GitHub Action, aren't covered yet.
- A model whose `archdoc:` format is newer than the ArchDoc reading it (`2.1`, `3.0`) stops with `spec/newer-format` and says to upgrade, instead of calling its new fields unknown or saying to migrate it. `archdoc --version` prints `(model format 2.0)`.
- `archdoc` and `archdoc-mcp` say they need Node.js 22.12 or later on an older Node, instead of failing inside a dependency.
- `archdoc --help` lists every command: `eval` and `migrate` under "Other commands", and `sync`, `publish`, and `landscape` under "Experimental".
- `archdoc validate` exits 2, like every other command, when there's no model.
- The Claude Code plugin starts its MCP server through `node`, so it works on Windows, where `npx` can't start without a shell. It installs from the `release` branch, which moves only once a version is live on npm, and each release gets GitHub release notes.
- Every package has a README on npm.
