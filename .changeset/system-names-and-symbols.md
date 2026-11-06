---
"@archdoc/core": patch
"@archdoc/spec": patch
---

Discovery keeps every part inside the system, names parts the way the code does, and points code at the lines that do the work.

- **Inside the system.** `archdoc check --done` asks for every container, component, datastore, and queue outside the system element to move inside it (`done/outside-system`, which named only datastores and queues before), so the explorer's Context view shows the system as one box instead of looking like the Container view. `archdoc edit` puts a container, datastore, or queue added with no parent inside the model's one system, and says so. The discovery score's System part is now the share of parts inside the system, not only whether there is one.
- **Names from the code.** `done/code-name` names a container or component whose ID matches none of the names its code goes by (`auth.identity → auth` for `src/auth/**`), and asks for a `name:` in plain words (`name: Local Migration Scripts`) when its code goes by several names. Generic directories (`src/`, `internal/`, `cmd/`) don't count as names.
- **Code a reader can audit.** `done/whole-file-code` names code elements that point at a whole file, `done/no-key-code` components (and containers without components) with no code element at a function, class, or lines, and `done/step-whole-file` journey steps whose code names a whole source file rather than `file#function` or `file:40-88`. An element's `code:` takes the same shorthand as a step's: `path#symbol`, `path:40`, and `path:40-88` read as `{ path, symbol }` and `{ path, lines }`.
- `scoreDiscovery` scores three new parts, code names, code precision, and key code, and the agent eval reports them.

The skill and AGENTS.md say the same: keep init's system with everything but externals inside it (with a skeleton for a hand-written `archdoc.yaml`), name each part after its directory, package, or module with the domain's words in the description, add 1 to 5 code elements per component at the functions a newcomer opens first, and give each journey step the function where it happens.
