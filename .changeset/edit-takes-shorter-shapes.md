---
"@archdoc/core": patch
"@archdoc/analyzers": patch
"@archdoc/mcp": patch
---

`archdoc edit` takes the shorter shapes agents write: `stores` as a list or `{ Order: "what it keeps" }`, `uses` as a list on a new element, a data entry without `kind` (entity), an `add` without `type`, and `data:Order`-style IDs. An edit refused for its shape now says the shapes the schema wants. The skill says to change the model only with `archdoc_edit` once it exists, and the agent eval counts find, edit, and hand edits of `.archdoc/`.
