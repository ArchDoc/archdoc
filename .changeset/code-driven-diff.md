---
"@archdoc/core": minor
"@archdoc/analyzers": minor
"@archdoc/cli": minor
---

The explorer's branch diff now reads the change from code, not from the other branch's model. Branch 1 (the working tree by default) is compared with branch 2 (main by default): the files changed since their merge base are analyzed at both ends and read into branch 1's model as elements whose code changed, was added, or was removed, uses the code added or dropped, proposed elements for new code no element maps, and new entry points, each marked with whether the model already says it. New in core: `deriveCodeChange` and `projectCodeChange`; in analyzers: `codeChange`. `archdoc view --base` and `archdoc site --base` take a branch only; compare two model files with `archdoc diff`.
