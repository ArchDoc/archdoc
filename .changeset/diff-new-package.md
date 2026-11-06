---
"@archdoc/core": patch
"@archdoc/cli": patch
---

The Diff proposes a new package beside the only package already there, not inside it (`packages/billing` next to `packages/shared` is a new container), and shows the use from code that imports it. `archdoc view --help` says `--base` opens on the Diff, read from the code since the branch left that ref.
