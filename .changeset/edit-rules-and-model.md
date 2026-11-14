---
"@archdoc/core": patch
"@archdoc/mcp": patch
---

`archdoc edit` changes rules and the model itself, so agents no longer edit those by hand: `add`, `set`, `rename`, and `remove` take `type: rule` (a rule by its `id`, in the file that has the rules), and `set` with `type: model` changes the model's own `name`, `description`, or `imports`.
