---
"@archdoc/spec": minor
"@archdoc/core": minor
"@archdoc/analyzers": minor
"@archdoc/mcp": minor
"@archdoc/cli": minor
---

Plan a change with your agent on the map, instead of skimming a markdown plan.

- **The explorer's Plan tab** (Build → Plan, no longer "coming soon") draws the model as it would be with the plan made, with the Diff tab's marks. Double-click the map to add an element (inside an open box to put it there), drag from a box's right edge to another for an arrow, click a box to change or remove it, and record a sequence by clicking boxes in order, or change a journey's steps. Every element, arrow, change, and step needs its intent before it saves. Pin notes to anything, reply to the agent's, and press **Send to agent** when you want its review. The agent's suggestions are drawn dashed, to accept or dismiss. **Mark ready** once nothing is open. A published site shows plans read-only.
- **Plans live in `.archdoc/plans/<id>.yaml`**, never part of the model: changes written as `archdoc edit` ops, sequences of journey steps, notes with replies, and, once agreed, tasks with the changes they carry out, their files, and tests. What the person changed since the agent last read it is kept for the agent's next read.
- **`archdoc plan`** (`start`, `list`, `read`, `wait`, `respond`, `task`) and the **`archdoc_plan`** MCP tool: start a plan from the idea with its scope, wait for the person to send it, read it with what they changed first and the op shapes to answer with, respond with notes, questions, risks, and suggested changes and steps (the agent can't change, accept, or drop the person's items), and mark tasks as they land, which moves the plan to executing and then done.
- **`archdoc check` checks open plans**: items without intent, changes the model can't take and why, what the plan would break (findings the model would have with the plan made), open questions and suggestions, the journeys, actors, owners, and other repos it reaches with critical journeys called out, the tasks once it's ready, and while it's carried out, which planned changes the model doesn't show yet. Warnings while it's drafted, errors once it's ready.
- **`archdoc view` writes plans** for the Plan tab: JSON only, from the explorer's own origin, and against the text the page last read, so the person and the agent never write over each other.
- The skill, AGENTS.md, and the MCP instructions teach the workflow.
- **Removed:** `.archdoc/traces/` from before 0.8 isn't read as Triage records any more (`archdoc triage migrate` moves them), and the deprecated `archdoc trace` command is gone (use `archdoc triage`).
