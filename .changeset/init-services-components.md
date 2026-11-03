---
"@archdoc/analyzers": patch
---

`archdoc init` makes a `services/` (or `apps/`, `packages/`) directory inside a package a component, instead of looking through it as if it held packages, and makes the source files beside a package's directories (such as `db.py`) components too, so their code isn't left directly under the container. Files that wire a package together (`server.ts`, `app.py`, like `index.ts` and `main.go`) stay with the container.
