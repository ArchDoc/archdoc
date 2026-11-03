---
"@archdoc/cli": patch
---

The archdoc skill now has the agent reshape what `archdoc init` writes before describing it: read how the project describes itself, keep each level to a handful of elements, fold per-file and build-config elements away, group variants of one thing, rename elements named after build files, and add the datastores, queues, externals, and deployment definitions init can't see. It also says when the model is done.
