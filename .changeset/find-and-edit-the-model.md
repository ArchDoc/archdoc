---
"@archdoc/core": minor
"@archdoc/analyzers": minor
"@archdoc/cli": minor
"@archdoc/mcp": minor
---

Agents find and change the model by ID, instead of reading `.archdoc/` and editing its YAML by hand. Two new MCP tools, each with a CLI command of the same name:

- `archdoc_find` (`archdoc find`) lists parts of the model by words, by place (`under` an element), by the file they own (`path`, the owner first), by `type` and `kind`, or by what they still lack (`missing`: a description, code, uses, a deploy, fields, or a journey), each with its ID, code, uses, and where it's written. `outline: true` (`--outline`) shows the element tree with each element's code and uses.
- `archdoc_edit` (`archdoc edit`) takes a list of ops by ID and runs them in order: `add` (an element inside the parent its ID names, with the kind of the level below, an actor, a data entry, a journey in its own file, an environment, or a deployment node), `set` (a JSON merge patch), `remove` (an element with what's inside it and the uses of it), `rename` (renames or moves, and rewrites every reference: uses, journey steps, sends, stores, owners), `use`, and `step` (append, insert, merge, or remove a journey step). It writes only the lines each op touches, so comments and formatting stay; writes all ops or none, refusing an edit that would add errors to the model; and answers with what each op did, the findings it fixed, new warnings, and code paths that match no file. `by` marks what it adds `provenance: { source: suggested }`.

The skill and AGENTS.md tell agents to model a repository with them, a step of work per call.

`archdoc seal` points a journey step's fact at its file when the step's `code` names a function (`orders/src/checkout.ts#placeOrder`), as the skill asks; before, it matched no file.
