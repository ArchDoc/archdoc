---
"@archdoc/spec": patch
"@archdoc/core": patch
"@archdoc/analyzers": patch
"@archdoc/mcp": patch
"@archdoc/cli": patch
---

Triage records say more, and read better in the explorer.

- **Each step of a bug says what happened there and what it carried.** `archdoc check` warns when a step of a root-caused or fixed record has no `description`, or crosses into another element without `sends` (or `creates`/`changes`), with the data the journey step it opens up sends as a hint, and notes a `sends` that isn't a data entry. `archdoc triage start` writes a record that asks for both, and its answer spells out the whole workflow, so an agent needn't look for the skill.
- **The triage record comes first, also for a fix.** The MCP instructions, `archdoc_triage`, the skill, and AGENTS.md say to start the record before reading the code and keep it through the fix, and `archdoc context` says so when the task reads like a bug.
- **The explorer's Triage header is small:** the root cause in brief and the fix, with the report a click away and no leads, so the map keeps the room. A step's panel shows the data it carried, with the fields the run had values for.
- **Journeys:** a step's message moves at one speed whatever the arrow's length. A step can say what comes back (`returns:`), and a request through an API that returns data plays to the callee and back. The journey list shows whole titles.
- **`archdoc view --detach`** starts the explorer in the background, prints its URL, and returns, reusing one already running: for agents whose shell can't keep a command running. The skill uses it, and asks to open the explorer once a new model is done.
- **`archdoc init` never makes a component of one file.** Files beside a container's directories, and a flat package's files, stay with the container. A list of problems from `archdoc check` now says it's the work list, so an agent fixes a first pass's errors instead of stopping.
