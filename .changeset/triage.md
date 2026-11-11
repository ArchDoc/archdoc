---
"@archdoc/spec": minor
"@archdoc/core": minor
"@archdoc/analyzers": minor
"@archdoc/mcp": minor
"@archdoc/cli": minor
---

Triage: hand your agent a bug and it finds the root cause, and records the bug's journey the way a journey records a flow. Traces grow into Triage records in `.archdoc/triage/<id>.yaml`, with a `status` (open, investigating, root-caused, fixed, wont-fix, cannot-reproduce), `severity`, `reported: { by, at, link }`, `attachments`, the leads followed as `hypotheses` (each confirmed or ruled out, with evidence), `root-cause: { summary, step }`, and `fix: { summary, link, test }`, beside the steps traces already had.

- `archdoc triage start` and the new `archdoc_triage` MCP tool place a bug and write a record to fill in; `archdoc triage list` lists records, open ones first; `archdoc triage migrate` moves traces from `.archdoc/traces/`.
- `archdoc check` holds a record to what its status needs (a cause and a root cause once root-caused, a fix once fixed) and reports a closed record's stale code as info.
- `archdoc context` lists the open records on what a task touches, and the PR comment says whether a change fixes a bug, finds its root cause, or triages it.
- The explorer's Build → Triage tab replaces Explore → Traces: records by status, each one's report, leads, root cause, and fix, the bug's journey on the map one step at a time (or as lanes), and a panel that places a pasted error and gives a prompt to hand your agent. Old `#traces=` links open it.
- Traces keyed `trace:` and files in `.archdoc/traces/` still load as records, with a note to migrate. `archdoc trace list` still works, and goes in 0.9.
