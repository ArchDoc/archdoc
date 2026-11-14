---
"@archdoc/analyzers": patch
"@archdoc/core": patch
---

`archdoc init` finds every crate in a Cargo workspace: it read a crate's name only when no array (such as `categories` or `keywords`) came before it, so most published crates were missed. Init and `archdoc paths` also leave out Rust benches (`benches/`), test helpers spelled with an underscore (`test_helpers/`, `test_utils/`), and Django's `tests.py`, so a test is no longer reported as an entry point.
