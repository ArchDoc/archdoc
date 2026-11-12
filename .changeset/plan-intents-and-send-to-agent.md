---
"@archdoc/spec": patch
"@archdoc/core": patch
"@archdoc/analyzers": patch
"@archdoc/mcp": patch
"@archdoc/cli": patch
---

Plan by intent, Send to agent for Triage, one shape for the Build tabs, and a rename that keeps a container in its system.

- Plan: no more forms. Click in a box on the map and say what you want there, in a small window where you clicked; it's an intent (`intents:` in the plan, `i1`), pinned in the box. You drive the design: your agent suggests nothing until you've sent an intent, then carries out what each one says, as suggested changes and sequences that name it (`for: [i1]`), which you accept or dismiss, and asks with the options where you left a choice open. `archdoc plan respond` refuses a suggestion before you've sent an intent, or without one. `archdoc check` says which intents nothing carries out yet, and they block Mark ready. Start a plan with the idea alone: its first line is the title.
- Triage: paste a bug and press Send to agent: find the root cause, or Find and fix it. One way to hand it over, and a record's header sends it again (Send to agent: fix it, once it's root-caused). The record says so (`sent`, `ask`), and the agent picks it up with `archdoc triage wait` or `archdoc_triage` with `wait: true`, which marks it `received`. A read-only site still gives the prompt to copy.
- Plan, Triage, and Diff share one layout: a list beside a header with what it is, where it stands, and its controls (Diff's branch picker moves there), over the map, with the same Send to agent button.
- `archdoc edit` rename: `shop.ui`, with a system named `shop` (as init names it), now goes inside that system, as add does, instead of to the top of namespace `shop`; and a container moved to the top stays inside the only system. That's how a container ended up beside the system in the context view.
