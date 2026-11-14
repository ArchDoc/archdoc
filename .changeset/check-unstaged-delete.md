---
"@archdoc/core": patch
---

`archdoc check` (and every command that reads the working tree) no longer fails with "Can't read" when a tracked file has been deleted and the deletion isn't staged yet, which is how a change that removes a file looks until it's committed.
