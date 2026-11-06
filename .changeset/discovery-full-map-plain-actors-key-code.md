---
"@archdoc/core": patch
"@archdoc/analyzers": patch
"@archdoc/cli": patch
---

Discovery maps the whole repository, names actors in plain words, and keeps code elements to the few functions a newcomer opens first, listed in the explorer rather than drawn.

- **No code element per file.** `archdoc init` no longer writes a `kind: code` element for each file (or each of a flat file's functions). Which functions a newcomer opens first takes reading the code, so the agent adds 1 to 5 per component at their symbols. `archdoc check --done` flags a part with more than five code elements (`done/level-too-wide`, which flagged only more than ten in a component before).
- **Code elements aren't boxes on the map.** The explorer doesn't draw code elements. A component lists them in its details panel under Key code, each with its description and links to its lines. A use or journey step that names a code element is drawn from its component, and opening a journey through one opens the map only down to that component.
- **Actors in plain words.** `done/actor-name` asks for a `name:` in plain words (`name: Dashboard User`) for an actor whose ID is kebab-case or snake_case and has no name. Kebab-case is for names in the code and infrastructure. The explorer shows an actor without a name as its ID in plain words (`dashboard-user` reads "Dashboard User").
- **Map all of it.** The skill, AGENTS.md, and `archdoc check --done` say to keep going however big the repository, without stopping after init or partway through to summarize, hand over part of the model, or ask whether to go on.
