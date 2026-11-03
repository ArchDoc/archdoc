---
"@archdoc/spec": minor
"@archdoc/core": minor
"@archdoc/analyzers": minor
"@archdoc/mcp": patch
"@archdoc/cli": patch
---

`archdoc init` sweeps every layer: containers, the components inside each container (its code directories, or in a flat package its files), and the code inside each component (its files, or a file's functions and classes), with uses from imports declared at the level where the two sides part. The model format gains `kind: code` for that layer, and `archdoc check` warns about a component outside a container (`model/component-outside-container`) and code outside a component (`model/code-outside-component`). Code needs no relationships of its own, so it isn't reported as an orphan.
