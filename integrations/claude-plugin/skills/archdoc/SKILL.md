---
name: archdoc
description: Use at the start of every coding task in a repository that has an .archdoc/ directory, before searching or reading code. Finds where the change belongs in the architecture model and what it affects (consumers, actors, journeys, owners, rules). Also use after editing, to check the change and keep the model true; when handed a bug, issue, error, or stack trace to explain or fix, to triage it to its root cause and record it; when asked to plan, design, or think through a change or feature before building it, to plan it with the user on the explorer's map; in a repository with no .archdoc/ yet, to start a model with archdoc init, including when asked to figure out, explain, map, or document the system's architecture; and when the user asks to see, show, view, or open the architecture or the model, to open the explorer in their browser.
---

# Working in a repository with an ArchDoc model

`.archdoc/` holds the architecture the team agreed on: who uses the system (actors), what it's made of (elements, each mapped to code paths), how people use it (journeys), and the data it sends and stores. People own it. It's the fastest way to find where code lives and what a change affects, so start with it, before you grep.

Ten MCP tools, one per question. Use them, not the CLI. This file covers a change to code, which is most tasks. Three other kinds of task have their own instructions next to it; read the one that fits before you start:

- **Handed a bug** (an issue, a log line, a stack trace, wrong output), even one you're asked to fix: read [references/triage.md](references/triage.md), and start with `archdoc_triage` before you read the code.
- **Asked to plan, design, or think through a change** before it's built: read [references/plan.md](references/plan.md), and start with `archdoc_plan`, not a markdown plan.
- **No `.archdoc/` yet**, or asked to model, map, explain, or document the architecture: read [references/init.md](references/init.md), and start with `archdoc_init`.

The ArchDoc MCP server starts with the session through `npx`, which takes a few seconds the first time, so its tools may not be in your tool list yet, or may be listed by name only (`mcp__plugin_archdoc_archdoc__archdoc_context` and the like). If you don't see them, search your tools for "archdoc" and load them, and if the server is still starting, wait and search again. Run the CLI instead only when no ArchDoc MCP server is configured at all; each command prints the same answer as its tool.

**`npx` needs the network the first time.** The MCP server and every `npx -y @archdoc/cli` command download the CLI from the npm registry until it's cached. In a sandbox without network access (Codex's default, and some other agents'), `npx` exits with no output, or with `ENOTFOUND`, `EAI_AGAIN`, or a fetch error, and the MCP server never starts. Don't read that as an empty answer or a missing model:

1. Run the command again with network access. In Codex, ask to run it outside the sandbox (escalated permissions), and say it's to download `@archdoc/cli` from npm.
2. If network access isn't allowed, tell the user what failed and give them two ways to fix it. They can turn on network access for the session; in Codex, that's `network_access = true` under `[sandbox_workspace_write]` in `~/.codex/config.toml`. Or they can install the CLI in the repository once (`npm install --save-dev @archdoc/cli`), so `npx` finds it without the network.

| Tool | Question | CLI, only without the MCP server |
|---|---|---|
| `archdoc_context` | Where do I start, and what does it affect? | `archdoc context <words or paths>`, `--error <file>` |
| `archdoc_show` | What is this one thing? | `archdoc show <id>` |
| `archdoc_paths` | Where do flows start, and what does each one call? | `archdoc paths [entry]` |
| `archdoc_find` | Which parts of the model are these (by words, inside an element, owning a file, missing a description, use, deploy, or fields)? `outline: true`: what's the model's shape? | `archdoc find [words]`, `--outline` |
| `archdoc_edit` | Change the model by ID: add, set, remove, rename, use, step. | `archdoc edit '<ops as JSON>'` |
| `archdoc_check` | What's wrong or stale, and what does my change do? With `done: true`: is a new model done? | `archdoc check --base main`, `--done` |
| `archdoc_seal` | I checked these facts against their code. | `archdoc seal <fact> --by agent:<name>` |
| `archdoc_triage` | I've been handed a bug: where does it start, and how do I record it? | `archdoc triage start bug.txt` (or `-`) |
| `archdoc_plan` | The user wants to design a change with me before it's built. | `archdoc plan start <idea>`, `wait`, `read`, `respond`, `task` |
| `archdoc_init` | There's no model yet. | `archdoc init` |

## A change: context, edit, check, seal

1. **Find where to start.** Call `archdoc_context` with the task in a few words, the files you plan to change, or both, such as `pr report shows type undefined for data fields`. You get the files and functions to open first (with line numbers), other code that does the same job (a fix in one place usually needs them too), the data and rules involved, the narrowest journeys, the tests to run, owners, and who uses it, other repos included. Read those files before you grep. A path you're about to create works too: it says where the file belongs.
2. **Say what it affects.** Name the affected journeys and actors when you share your plan. Ask the user first if a critical journey is involved, if the change would break a rule, or if it removes or renames something another repo uses.
3. **Look things up as you go.** `archdoc_show` takes any ID: an element (`code: true` adds its snippets' text), an actor, a journey, a data entry, `Entry.field` (where its value comes from and goes), a Triage record, or a fact `archdoc_check` names.
4. **Edit the code and the model together.** Stay inside the element boundaries you found. When the change adds a component or a dependency between elements on purpose, add it to the model with `archdoc_edit` and `by: agent:<your-name>`, which marks it as a suggestion a person accepts:

   ```json
   { "by": "agent:claude-code", "ops": [{ "op": "use", "from": "orders.checkout", "to": "billing", "spec": "Sends invoice events" }] }
   ```

   When you remove, rename, or move something, update the model in the same change: `rename` moves an element and rewrites every reference to it. When a component sends, accepts, or stores different data, update `data:` and the `sends`, `accepts`, `returns`, or `stores` that name it, and classify sensitive fields (`classification: pii`). Elements in other repos are referenced by namespace (`payments.charges`); to depend on a new repo, add it to `imports` and run `archdoc sync`. Never edit `.archdoc/archdoc.lock` or `.archdoc/vendor/` by hand.
5. **Check.** Call `archdoc_check` with base `main` (or the branch you started from). It leads with the verdict the PR comment will give, then what blocks the merge and what to check, each with its fix: imports the model doesn't declare, broken rules and journeys, stale paths, data rules, and facts whose code changed since they were sealed. Fix what your change introduced; if a dependency isn't intended, remove the import. Check again until it's clean.
6. **Seal what you checked.** If the repository keeps `.archdoc/archdoc.sum`, `archdoc_check` names each fact whose code you changed and what changed. Read it, update the model where it no longer describes the code, then call `archdoc_seal` with those facts (an element ID seals all of its facts) and `by: agent:<your-name>`. It says what's still to check. Sealing is your word that the model is right, and reviewers see it in the PR, so never seal a fact you haven't read.

In the PR description, list the affected journeys and actors and the model changes you suggested: `archdoc_check` with `format: "markdown"` (or `archdoc report --base main`) writes it for you.

## Change the model by ID, not by editing its YAML

`archdoc_find` and `archdoc_edit` read and change the model by ID, so you don't read `.archdoc/` files to find the right lines, or edit them by hand and run check to see what broke. Once the model exists, make every change to it with `archdoc_edit`, not Edit or Write on `.archdoc/` files: descriptions, uses, data, stores, deploys, new journeys, and fixes for what `archdoc_check` lists. It's fewer turns, and it refuses a change that would break the model instead of leaving it for check.

- **Find.** `archdoc_find` with `outline: true` gives the element tree, with each element's code and uses (`under` and `depth` narrow it); read it instead of the YAML. With `query` (words), `under` (inside an element), `path` (the elements whose code covers a file, the owner first), `type`, `kind`, or `missing` (`description`, `code`, `uses` for elements nothing connects to, `deploy`, `fields`, `journey` for actors without one), it lists the matches with their IDs and where each is written.
- **Edit.** `archdoc_edit` takes a list of ops and runs them in order, so later ops can use what earlier ones added. Send a whole step of work in one call: every description, or a journey and the data it carries. It writes only the lines it changes and keeps comments. All ops are written or none: when one fails, or the edit would add errors to the model, it writes nothing and says why. It answers with what each op did, the findings it fixed, and new warnings to act on. IDs resolve the way references do: `orders.api` for `shop.orders.api`.

| op | Does | Example |
|---|---|---|
| `add` | Adds an element (its ID names its parent; `kind` defaults to the level below), actor, data entry, journey (in its own file), environment, node (`production.aws.lambda`), or rule (`type: rule`, with its `deny` or `allow-only`) | `{ "op": "add", "type": "element", "id": "orders.events", "spec": { "description": "Publishes order events", "code": "orders/src/events/**" } }` |
| `set` | Merges fields into one thing, as a JSON merge patch: maps merge, lists replace, `null` removes; `type: model` sets the model's own `name`, `description`, or `imports` | `{ "op": "set", "id": "Order", "spec": { "fields": { "total": { "type": "int" } } } }` |
| `remove` | Removes one thing; an element goes with what's inside it and the uses of it | `{ "op": "remove", "id": "vite-config" }` |
| `rename` | Renames or moves, and rewrites every reference (uses, steps, sends, stores, owners); an element's dotted `to` moves it inside that parent | `{ "op": "rename", "id": "react-app", "to": "web.react-app" }` |
| `use` | Adds or updates a use (`remove: true` removes it) | `{ "op": "use", "from": "orders.checkout", "to": "rabbitmq", "spec": { "description": "Publishes order.placed", "sends": "OrderPlaced" } }` |
| `step` | Appends a journey step; with `at`, merges into that step, and with `insert` or `remove`, inserts or removes there | `{ "op": "step", "journey": "place-order", "at": 3, "spec": { "code": "orders/src/checkout.ts#placeOrder" } }` |

A spec has the fields the YAML would: a journey is one `add` with its `actor`, `goal`, and all its `steps`; a data entry has `kind` (`entity`, `message`, or `event`; `entity` if you leave it out) and `fields`; `stores` is `{ Order: "what it keeps" }` or a list of entries; a step's `sends` is an entry or a list, `creates` an entry or a list, and `changes` is `{ "Order.status": "pending -> paid" }`.

Pass `by: agent:<your-name>` so what you add is marked `provenance: { source: suggested }`, and `dryRun: true` to see what an edit would do. Edit a file by hand only for what the ops don't cover: the experimental `mappings` and `logic`.

## Show the user the model

When the user asks to see, show, view, or open the architecture or the model, or right after you've created or changed it and they'd want to look, open the explorer for them. Don't send them to a terminal.

1. **Already running?** If you started the explorer earlier in this session and it's still running, give its URL again. It runs with `--watch`, so it already shows the model as it is now. Don't start a second one.
2. **On a remote machine?** If `CLAUDE_CODE_REMOTE` is `true`, or `SSH_CONNECTION` or `SSH_TTY` is set, `127.0.0.1` is that machine, not the user's. Write the explorer as a static site instead, with `npx -y @archdoc/cli site --out archdoc-site`, and tell them where it is (a folder of HTML they can open or host, not for committing).
3. **Otherwise, start it detached:** `npx -y @archdoc/cli view --detach --watch --open`. `--detach` starts the explorer in a process of its own, waits until it's listening, prints its URL, and returns, so it works in any shell, with no background option. Run it again and it gives the URL of the one already running instead of starting another. `--open` opens their browser, and `--watch` updates the page as the model changes. To show a change, add `--base <ref>`, such as `--base main`.
4. **Tell them the URL** from the line it prints, `ArchDoc explorer: http://127.0.0.1:<port>`. With `--base`, add `#diff` so the link opens on the change. If it says there's no model, say so and offer to start one. If it prints nothing at all, `npx` couldn't download the CLI: see the network note at the top.
