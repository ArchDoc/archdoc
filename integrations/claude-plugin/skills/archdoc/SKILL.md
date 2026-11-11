---
name: archdoc
description: Use at the start of every coding task in a repository that has an .archdoc/ directory, before searching or reading code. Finds where the change belongs in the architecture model and what it affects (consumers, actors, journeys, owners, rules). Also use after editing, to check the change and keep the model true; when handed a bug, issue, error, or stack trace to explain or fix, to triage it to its root cause and record it; in a repository with no .archdoc/ yet, to start a model with archdoc init, including when asked to figure out, explain, map, or document the system's architecture; and when the user asks to see, show, view, or open the architecture or the model, to open the explorer in their browser.
---

# Working in a repository with an ArchDoc model

`.archdoc/` holds the architecture the team agreed on: who uses the system (actors), what it's made of (elements, each mapped to code paths), how people use it (journeys), and the data it sends and stores. People own it. It's the fastest way to find where code lives and what a change affects, so start with it, before you grep.

Nine MCP tools, one per question. Use them, not the CLI. Handed a bug, even one you're asked to fix? Start with `archdoc_triage`, before you read the code ([below](#a-bug-triage-it-to-its-root-cause)).

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
| `add` | Adds an element (its ID names its parent; `kind` defaults to the level below), actor, data entry, journey (in its own file), environment, or node (`production.aws.lambda`) | `{ "op": "add", "type": "element", "id": "orders.events", "spec": { "description": "Publishes order events", "code": "orders/src/events/**" } }` |
| `set` | Merges fields into one thing, as a JSON merge patch: maps merge, lists replace, `null` removes | `{ "op": "set", "id": "Order", "spec": { "fields": { "total": { "type": "int" } } } }` |
| `remove` | Removes one thing; an element goes with what's inside it and the uses of it | `{ "op": "remove", "id": "vite-config" }` |
| `rename` | Renames or moves, and rewrites every reference (uses, steps, sends, stores, owners); an element's dotted `to` moves it inside that parent | `{ "op": "rename", "id": "react-app", "to": "web.react-app" }` |
| `use` | Adds or updates a use (`remove: true` removes it) | `{ "op": "use", "from": "orders.checkout", "to": "rabbitmq", "spec": { "description": "Publishes order.placed", "sends": "OrderPlaced" } }` |
| `step` | Appends a journey step; with `at`, merges into that step, and with `insert` or `remove`, inserts or removes there | `{ "op": "step", "journey": "place-order", "at": 3, "spec": { "code": "orders/src/checkout.ts#placeOrder" } }` |

A spec has the fields the YAML would: a journey is one `add` with its `actor`, `goal`, and all its `steps`; a data entry has `kind` (`entity`, `message`, or `event`; `entity` if you leave it out) and `fields`; `stores` is `{ Order: "what it keeps" }` or a list of entries; a step's `sends` is an entry or a list, `creates` an entry or a list, and `changes` is `{ "Order.status": "pending -> paid" }`.

Pass `by: agent:<your-name>` so what you add is marked `provenance: { source: suggested }`, and `dryRun: true` to see what an edit would do. Edit a file by hand only for what the ops don't cover, such as rules, mappings, and logic.

## A bug: triage it to its root cause

When you're handed a bug to explain or fix (an issue, a log line, a stack trace, wrong output), triage it: find the root cause and record the bug's journey, step by step, the way a journey records a flow. People read it in the explorer's Triage tab, on the map, one step at a time, so each step says what happened there and what it carried.

Do it whenever you're handed a bug, also when you're asked to fix it: the record comes first, and the fix isn't done until the record says it's fixed. Everything you need is here and in `archdoc_triage`'s answer, which repeats how to fill the record in; you don't need to look for this file again.

1. **Start the record, before you read the code.** Call `archdoc_triage` with `symptom` set to the bug as the user gave it, and `title`, `link`, and `reportedBy` when you know them (CLI: `archdoc triage start bug.txt -t "..." --link ...`, or `-` for stdin). It places the error on the journey steps it most likely showed up in, writes `.archdoc/triage/<id>.yaml` with status `investigating`, the best journey step, the elements the error names as open leads, and steps from the stack, and tells you where to start.
2. **Follow the code** from that step, and fill in the record as you go:

```yaml
triage: refund-waits-for-finance
title: A $4 refund waits for finance instead of going through
status: root-caused                # open, investigating, root-caused, fixed, wont-fix, cannot-reproduce
severity: high                     # low, normal, high, critical
reported: { by: rider, at: 2026-10-02, link: https://support.example.com/tickets/4812 }
symptom: |
  refund ref-ch-81: status pending_approval (expected approved)
reproduce: 'POST /refunds { "charge_id": "ch-81", "amount": 4.00 }'
expands: request-refund#4          # the journey step where it showed up (1-based)
hypotheses:                        # every lead you followed, ruled in or out
  - { claim: refund-approval sends small refunds to finance, element: payments.charges.refunds, verdict: ruled-out, evidence: read, note: It auto-approves up to half the charge }
  - { claim: The amount is converted to cents twice, element: api-gateway, verdict: confirmed, evidence: reproduced }
steps:
  - from: app
    to: api-gateway
    action: Sends the refund request
    description: The app posts the refund in dollars, as the gateway's API says it should.
    sends: RefundRequest
    code: apps/rider/src/refunds.ts#requestRefund
    evidence: read
    observed: { RefundRequest.amount: 4.00 }
  - from: api-gateway
    to: payments.charges
    action: Forwards the request, multiplying the amount by 100
    description: The gateway converts dollars to cents, but the amount it got was already in cents for this client, so $4 becomes 40000 cents.
    sends: RefundRequest            # the data entry it passes, by its name under data:
    code: services/gateway/src/refunds.ts:42
    role: cause                    # ok (default), cause, spreads, symptom
    evidence: reproduced           # reproduced, read, or inferred (default)
    observed: { RefundRequest.amount_cents: 40000 }
    expected: { RefundRequest.amount_cents: 400 }
root-cause: { summary: The gateway converts the amount to cents a second time., step: 2 }
fix: { summary: Pass amount_cents through unchanged., link: https://github.com/acme/rides/pull/88, test: services/gateway/src/refunds.test.ts }
```

   Give every step what a reader needs to walk through it: `action`, a few words on what it does; `description`, a sentence or two on what happened at that hop in the failing run (the value it had, what the code did with it, and why that's right or wrong there); `sends`, the data entry it carries, by its name under the model's `data:` (the journey step it opens up usually names it; `creates` or `changes` for a write); and `observed` and `expected` on that entry's fields where they differ (`RefundRequest.amount_cents`). `archdoc_check` warns about a step without a description or without what it carries. Put each step on the most specific element the model has (the component, not the container it's in), with the `code` where it happens; the cause step needs it most, since that's where the reader opens the code. Give every step and every lead evidence, and be honest about it: `reproduced` only for what you saw run, `read` for what you followed in the code, `inferred` for the rest. Keep a lead you ruled out, with what showed it: the next person won't follow it again. `missing: { to, call }` marks a call that should have happened and didn't, and `works-in: { element, code, note }` points at code that does the same job right. A record is evidence of one bug, not the design, so it's never part of the model.
3. **Set the status as you go.** `root-caused` once a step has `role: cause` and `root-cause` says why. If you were asked only to explain the bug, stop there and report. If you fix it, keep the record: set `status: fixed` and `fix`, with the PR and the test that shows it. A fix without its record isn't done. `wont-fix` and `cannot-reproduce` say why in `root-cause`.
4. **Check it** with `archdoc_check`, which checks records too: unknown elements and journeys, stale code references, and what the status needs. A hop the model doesn't declare is drift you found while debugging: say so, and add it to the model if the code is right. `archdoc_triage` with only `id`, or `archdoc_show` with the ID, shows it as the explorer will.
5. **Commit the record with the fix.** The PR comment then says which bug the change fixes, or whose root cause it found.

`archdoc_context` on a task lists the open records on what it touches, as known bugs, and `archdoc_triage` with `list: true` lists them all. Traces from before 0.8 (`.archdoc/traces/`) still load; `archdoc triage migrate` moves them.

## No model yet: init, then make it true

In a repository with no `.archdoc/`, when the user asks you to model it, to use ArchDoc, or to figure out, explain, map, or document its architecture:

**What you hand over is a model written to `.archdoc/`,** not a summary in chat and not `init`'s dry run. Run `archdoc_init` for real: `dryRun` writes nothing, so use it only when the user said not to write files. `archdoc_paths` lists entry points; on its own it doesn't make a model either. Then do steps 2 to 10, and explain the architecture from the model you wrote.

Make the changes in steps 3 to 8 with `archdoc_edit`, a step of work per call, and look the model up with `archdoc_find` (`outline: true` for its shape, `missing` for what's left), not by reading and editing its YAML.

What `init` writes is raw material, not a model. It lists every package, directory, file, and import it finds, without knowing what they're for, who uses them, or how the parts reach each other at runtime. The model you hand over is one an engineer new to the repository can read top-down in ten minutes, and whose journeys walk them through the main flows to the code. Steps 2 to 8 are that work, and they usually take most of your turns. Do them before you hand the model over, even when `archdoc_check` already passes: `archdoc_check` with `done: true` says what's left.

**However big the repository, map all of it.** A monorepo with hundreds of packages and thousands of files means more parts to group, not less to model. Don't stop after init, or partway through, to summarize what you've seen, hand over part of the model, or ask whether to go on: the user asked for the architecture, and the steps below are it. Work a level at a time (the containers first, then the components of the big ones), keep `archdoc_paths`'s summary and `archdoc_find` with `outline` and `depth` in place of reading files one by one, and keep going until `archdoc_check` with `done: true` says the model is done.

**Errors after a pass are the work list, not a verdict.** A first pass at a model, or a new `archdoc.yaml` written over init's, usually shows dozens of errors and warnings: stale paths, unknown IDs, uses that don't resolve. Each says what to fix, and many share one cause (a renamed element, a moved directory). Fix them and check again. Don't stop to report the count or hand over a model that has errors.

1. **Start it.** Call `archdoc_init` (or run `archdoc init`). It writes `.archdoc/` from what the repository declares, every layer of it, inside one `kind: system`: a container per package, module, or code directory; inside each big container, a component per code directory (files beside them, and a flat package's files, stay with the container: never a component per file); datastores and queues from compose files; uses from imports, declared at the level where the two sides part; and data and contracts from schema files. From Terraform and CDK it adds the tables (with their keys as data), queues, and services the code calls, a use from the component that makes each call, a scheduler actor for scheduled jobs, and `environments:` with `deploy:`; compose files add a `local` environment. It leaves out tests and other verification code. It writes no code elements: which functions a newcomer opens first takes reading the code (step 5). Everything is marked `provenance: { source: inferred }`. It never writes over a model. Its answer is a brief: the docs and deployment files to read, and the entry points (routes, consumers, schedules, commands) where flows start.
2. **Read how the project describes itself.** Read the docs and deployment files the brief lists: the README, any architecture or design docs, and the files that wire the system together: compose files, Kubernetes manifests, Helm charts, Terraform, CDK, an app host (.NET Aspire and the like). Note the parts they name, how those parts talk to each other, and who they say uses the system. Those parts are your top-level elements, under the names the project uses. Don't write scripts to explore the repository: `archdoc_paths` lists the entry points and the calls each one makes, and `archdoc_show` with `code: true` shows an element's code.
3. **Reshape it before you describe it.** Change init's structure until it matches those parts and these limits: `rename` moves an element into the container it belongs in (its references follow), `remove` drops what isn't architecture, `set` folds a code element's path into its component's `code:`. When init's model is much bigger than the limits (hundreds of elements), don't edit it piece by piece: write a new `archdoc.yaml` with the structure you found in step 2, and take only the code paths and uses you need from init's. That's the one time you write the model by hand: from there on, change it with `archdoc_edit`. Keep init's system element in what you write, with everything but the externals inside it:

   ```yaml
   archdoc: "2.0"
   namespace: shop
   elements:
     shop:                 # the system, named for the product
       kind: system
       name: Shop
       description: What the product does, for whom.
       elements:           # every container, datastore, and queue goes in here
         web: { kind: container, code: apps/web/** }
         api:
           kind: container
           code: apps/api/**
           elements:
             orders: { kind: component, code: apps/api/src/orders/** }
         postgres: { kind: datastore, technology: Postgres }
     stripe: { kind: external, description: Takes card payments. }   # externals sit beside it
   ```
   - **Keep the system at the top, with the parts inside it.** One `kind: system` element, named for the product (`name: Online Boutique`), holds every container, datastore, and queue, at any depth; only externals sit beside it. It's the box the explorer's Context view draws, with who uses it and what it calls around it, and the Container view opens it. A container left beside the system shows in both views, and they look the same. `archdoc_edit` `add` puts a new container, datastore, or queue with no parent inside the system for you; move one that's outside with `rename` (`{ "op": "rename", "id": "catalog", "to": "shop.catalog" }`).
   - **Name each part the way the code does.** An element's ID is the name the codebase uses for that part: its directory, package, module, or namespace. Code in `src/auth/` is `auth`, not `identity`; `src/Ordering.API/` is `ordering-api`. A newcomer searches the code for what they read in the model, so don't coin a domain term the code doesn't use: the domain's words go in the description. When a part's code goes by several names (local scripts in `scripts/` and `db/seed/`), give it a short ID and a `name:` in plain words that says what it is, such as `name: Local Migration Scripts`, never a coined kebab-case term on its own. `archdoc_check` with `done: true` names a part whose ID matches none of its code's names.
   - **Keep each level small.** Aim for about 3 to 12 top-level elements, and about 3 to 10 children under each. A container is something that runs or ships on its own: a service, a binary, a web app, a worker, a scheduled job, a published library. A component is one responsibility inside a container.
   - **Components only where a container is big.** A container with fewer than about five source files, or that does one job, stays lean: no components, its `code:` covers it all, and journey steps name the container. A container with dozens of files across several directories gets 3 to 10 components, one for each part its code is split into. Init follows the same rule. When you write a new `archdoc.yaml` over init's, keep the components of the big containers; don't flatten them. `archdoc_check` with `done: true` names a small container that has components and a big one that has none.
   - **Fold away what's too fine.** Map each element to its whole directory (`tsdb/**`), not a handful of files from it, so all of its code belongs to it. Fold build and tooling config (`vite-config`, `eslint-config`, `next-config`) into the element it configures. Step 5 adds the few code elements worth naming, at the functions they're about.
   - **Leave out tests and verification code.** Test suites, end-to-end and load tests, test helpers and fixtures, mocks and fakes, benchmarks, smoke checks, and test-runner config aren't architecture, even when they have their own package. Init leaves most of them out; remove any element that's left, and don't add one. A container's glob may still cover its own tests. Never model vendored or generated code either.
   - **Group variants.** When one thing comes in many variants, make one element for the thing, and list the variants in its `technology` or as its children. Examples are the same server written in several languages, one client per framework, or one plugin per provider.
   - **Rename what init named after build files.** IDs like `gson-parent-2` or `stripe-sample-app-3` become what the project calls the element. Fix `namespace` the same way.
   - **One app, one container.** Packages that exist to build one app (a UI workspace's app, its older version, the editor module it embeds) are components of one container named for the app, even when each has its own `package.json`. Init already makes a workspace below the top of the repository (`web/ui/` with its packages) one container; keep it that way. A package gets a container of its own only when it's deployed on its own.
   - **A binary's own code goes in its container.** When one binary is the product, such as a server under `cmd/<name>/` whose packages sit beside it, those packages are its components: don't leave a one-file container for its `main.go` beside a `core` or module container that holds the code it runs. Init does this when the binary is named after the module (`cmd/prometheus` in `github.com/prometheus/prometheus`); do it yourself when it isn't.
   - **Place shared code once.** When several binaries use library code equally (an API and a worker over one domain library), it's a container of its own: put it where a newcomer would look for it, and say in its description who uses it. A tool that only borrows a few of the main binary's packages (a CLI that checks its config) gets a use of them instead.
4. **Add what init can't see, and connect every element.** Init sees imports and compose files. Services reach each other in ways it doesn't: HTTP calls to a URL from config or the environment, gRPC clients, messages on a queue, SDK clients for third-party services, jobs a scheduler starts, plugins loaded by name.
   - **Infrastructure.** Add the datastores, queues, and third-party services init didn't find, from app hosts, manifests, Terraform, CDK, connection strings, environment variables, and SDK clients, each as its own element with `kind` (`datastore`, `queue`, or `external` for a third-party service such as Stripe or an email provider) and `technology`. Add each deployment definition (manifest, chart, Terraform module, app host) to the `code:` of the element it deploys or provisions. Add shared contracts (protobuf, OpenAPI) to the element that serves them.
   - **Where it runs.** Add an `environments:` section with one entry per environment (production, staging, local) and the infrastructure nodes inside it that the deployment files name (cloud account or region, cluster, namespace, host, managed service), each with `code:` pointing at its Terraform, Helm, Kubernetes, or compose file. Then give each container, datastore, and queue a `deploy:` naming where it runs in each environment, such as `deploy: [production.aws.eks, local.compose]`, with `replicas`, `url`, and `code` when the files say them. Step 7 says how to keep it in one logical place.
   - **What it stores and sends.** For each datastore, list what it keeps under `stores:` (each table or collection, its key, and the data entry it holds), and describe each entry under `data:` with its fields. For each queue, name the messages that go through it. Classify personal data (`classification: pii`).
   - **Find every entry's definition; never leave its fields blank.** A data entry with a name and a description but no fields tells a newcomer nothing about its shape, and the explorer has nothing to show on its page or on the steps that carry it. Before you add an entry, find where the code defines it, in this order: a schema file archdoc reads (SQL migrations, Prisma, protobuf, OpenAPI), which you point at with `source:` (`source: { proto: protos/demo.proto#CartItem }`) so the fields stay in step with it; the class, struct, record, dataclass, Pydantic or Zod schema, interface, or type the code builds or reads (the request body a handler parses, the payload a publisher serializes, the ORM model a repository saves); the IaC that creates its table (a DynamoDB table's keys); or, last, the object literal the code builds. Write each field with its `type` (`int`, `string`, `uuid`, `timestamp`, `json`, an enum's `values`, or another entry's name), `references: Entry.field` for a foreign key, and `classification: pii` for personal data. Search for the entry's name and the names of the fields you'd expect; `archdoc_show` with `code: true` shows the element's code. Only an entry the code truly never shapes (an opaque blob passed through) stays without fields, and you say so in its description.
   - **Short names for data, with a description.** Name each data entry with a short noun of one to three words, in PascalCase, the way the code names it: `OrderPlaced`, `ChargeProjection`, `RefundRequest`. Never a phrase such as `Tenant-partitioned Stripe object projections`: the explorer draws the name on a chip that moves along each step, and a long one doesn't fit. Say what it is in the entry's `description`, a sentence: what it holds or announces, and who makes it.

     ```yaml
     data:
       ChargeProjection:
         kind: entity
         description: A tenant's copy of a Stripe charge, partitioned by tenant, that the dashboard reads.
         fields: { tenant_id: { type: uuid }, charge_id: { type: string }, amount_cents: { type: int } }
     ```
   - **Uses.** Put each use between the components whose code makes the call, not on their containers. Route messages through the queue: the publisher uses the queue, and so does the consumer. Point each use at the datastore or external it reaches, and say in its description what it does (`Publishes order.placed`, `Books a shipping label`).
   - **Investigate every element nothing connects to.** `archdoc_check` warns `model/orphan-element` for each one, and `archdoc_find` with `missing: ["uses"]` lists them. An orphan is usually a service that's reached at runtime, not imported. For each, read its entry point and search for its name, port, route paths, queue or topic names, and environment variables across the repository: who calls the URL, who publishes what it consumes, which manifest or CronJob runs it, which config registers it. Add each use you find with the code that shows it. Remove the element only if it isn't part of the system (build tooling often isn't), and say which ones you couldn't connect and why.
5. **Describe each element, top-down,** with the code open (`archdoc_show <id>` with `code: true`). `archdoc_find` with `missing: ["description"]` lists the ones left; send their descriptions as `set` ops in one `archdoc_edit`. Start with the containers, then the components inside each. Give each one or two sentences that say what it's responsible for, in the domain's terms, not what it's called or which files it has. Replace every description init wrote (`The x package.`, `A code directory (...).`). Keep the layers nested: a component inside a container, and code inside a component. `archdoc_check` flags one that isn't.
   - **Point at the code that does the work.** A reader audits the model by opening the lines it names, and a whole file or directory gives them nothing to check. In each component (and each container without components), add 1 to 5 code elements for the functions, classes, or handlers a newcomer opens first: its entry point, the core logic, the function that writes to the datastore. Each is `kind: code` with the symbol it declares, `code: path#symbol` (or `{ path, symbol }`), or lines (`path:40-88`) where no one declaration covers it, and a one-sentence description. Never a whole file, and never one per file: that's what the component's `code:` glob is for. The explorer doesn't draw code elements on the map: it lists them in their component's details, each with its description and links to the lines, so more than five is a file list no one reads. In a lean container they go directly in the container; don't add a component just to hold them. Send them with the descriptions:

     ```json
     { "op": "add", "id": "orders.checkout.place-order", "spec": { "kind": "code", "description": "Prices the cart and saves the order as placed.", "code": "orders/src/checkout/place-order.ts#placeOrder" } }
     ```
6. **Find the actors and the flows they follow.**
   - **List the entry points.** Call `archdoc_paths`: it lists the HTTP routes, queue consumers, scheduled jobs, and CLI commands it finds in the code and in Terraform and CDK. Add the ones it can't see (UI pages and forms, webhooks, handlers registered by name). Each is where a flow starts. In a big repository it answers with a summary instead: the entry points by place (a container, or a package before there's a model), with counts by kind and routes grouped by resource. Each line there is usually one journey. Pass a place or a resource as `entry` (`"apps/api"`, `"/orders"`, or both: `"apps/api /orders"`) to list its entry points, then one label to see its calls. Don't page through every entry point: pick the groups a newcomer would need.
   - **Name the actors** behind them, each with the kind that says what it is:
     - `person`, `role`, `team`, or `organization` for people: who use the UIs and APIs, by role, such as `customer` or `operator`.
     - `system` for software that calls in on its own: another service or app that calls the API, a scheduler or CronJob that starts jobs, a CI pipeline, a webhook sender, a device. Most automated callers are this.
     - `agent` only for an AI agent: an LLM or assistant that acts on its own, such as a coding agent or a support bot built on a model, and say so in its description. A service, a job, or a bot without a model is never `agent`.
     Give each actor a `name:` in plain words, the way people say it: `name: Dashboard User` for `dashboard-user`, `name: Nightly Scheduler`, `name: Platform Team`. Its ID stays kebab-case, but the explorer and reports show the name, and kebab-case there reads as a name in the code or infrastructure (a service, package, or table), which an actor isn't. Kebab-case is right for the elements named after the code.
     A third-party service that calls in and that the system also calls (a payment provider's webhooks) is an `external` element with a use of what it calls, not an actor. Give each actor `uses` for the element it reaches first.
   - **A journey for each main flow:** one for each entry point, or group of entry points that do one thing (the routes of one resource, say), so the journeys together reach most of them; most systems have four to ten. Include what happens after a flow asynchronously (the consumers of what it publishes) and the scheduled and admin jobs. Mark the main one `importance: critical`. Leave out a flow only for a reason you'll say when you hand over (a health check, a debug route).
   - **Trace each one through the code.** Call `archdoc_paths` with the entry point (`entry: "POST /orders"`): it shows the calls the flow makes, by function, file, and line, the element each is in, and what each reaches outside the code (a table, a queue, an HTTP call). With `hops: true` it folds the calls that stay inside one element and shows only the calls from one element to another, which are the steps you write; add `depth` to follow a long flow further. Follow it hop by hop: from the route to the component that does the work, to what it stores, to what it publishes, to who consumes that, to the external it calls, until the flow ends. Open the files on the path to read what each hop does and what data it carries; don't guess a hop from names, and don't grep for what the paths already show.
   - **Go from one element to the next.** A journey is a path: each step starts where the flow already is, at the element the step before it reached (or one an earlier step reached, when one component calls two things in turn). Never jump: if step 3 ends at `web.pages` and the next thing you know of starts at `web.api-client`, the hop between them (the page calling the client) is a step you haven't read yet. When you don't know how the flow gets from one element to the next, investigate before you write the step: call `archdoc_paths` with the entry point and `hops: true`, open the files on the path, and search for the function, route, topic, or table that joins them. Write the step the code shows. Only an actor, or an external system acting on its own (a webhook arriving), may start a step out of the flow. `archdoc_check` warns `journey/disconnected-step` for each jump.
   - **Write each hop as a step,** one journey per file in `.archdoc/journeys/<id>.yaml` (with `journeys:` at its top), so each edit is small. `archdoc_edit` with `add` and `type: "journey"` writes that file, and the data entries its steps carry can go in the same call. `from` and `to` are the most specific elements that do the work (a component, not its container, when it has components), and the step's `code` is in one of them: when the work happens in a shared library, the step goes through the library's component. End the flow where it really ends: the datastore it writes, the queue it publishes to, the external it calls. `action` says what happens in the domain's words (`Prices the cart and saves the order`). `code` is the function or method where it happens, `file#function` (`orders/src/checkout/place-order.ts#placeOrder`), or its lines (`file:40-88`) when no one function does it; name a whole file only when it isn't code (a manifest, a page template). Every step that crosses into another container, a datastore, a queue, or an external says what it carries: `sends` with the request or message (`OrderPlaced`), or, for a write, `creates` or `changes` with the records (`creates: Order`, `changes: { Order.status: placed -> paid }`); add each one under `data:` with its fields, from the code that builds it. Add `description` for what a newcomer would miss: a condition, a retry, a transaction. Give the journey a `goal` from the actor's side and a `description` of the flow in a sentence or two.

   ```yaml
   journeys:
     place-order:
       actor: customer
       goal: Buy what's in the cart
       description: The storefront posts the cart to the orders API, which saves the order and publishes order.placed for fulfillment.
       importance: critical
       steps:
         - { from: customer, to: web.checkout, action: Places the order, code: web/src/pages/checkout.tsx#CheckoutPage }
         - { from: web.checkout, to: orders.routes, action: POSTs the cart to /orders, code: web/src/api.ts#placeOrder }
         - { from: orders.routes, to: orders.checkout, action: Prices the cart and places the order, code: orders/src/routes/orders.ts#createOrder }
         - { from: orders.checkout, to: postgres, action: Saves the order as placed, code: orders/src/store/orders-repo.ts#insertOrder }
         - { from: orders.checkout, to: rabbitmq, action: Publishes order.placed, code: orders/src/events/publisher.ts#publishOrderPlaced, sends: OrderPlaced }
   ```

   Each step has to follow a use (`archdoc_check` says which don't): when a step shows a call the model is missing, add the use, since the code you just read shows it.
7. **Say where it runs, each thing in one logical place.** Init writes the environments the deployment files define; check them against those files, and add what it missed: other environments (staging, local), the infrastructure in each (account or region, cluster, serverless, managed services, CDN), each with `code:` pointing at its file. Give each container, datastore, and queue a `deploy:` naming where it runs in each environment (`deploy: [production.aws.lambda]`). Keep the infrastructure consolidated, so a reader finds everything that runs on one service in one place:
   - **One environment per stage**, named the way the deployment files name it, and the same way everywhere (`production`, not `prod` in one place and `production` in another).
   - **The same nesting in every environment:** the cloud account or region, then each service inside it (`production.aws.lambda`, `production.aws.dynamodb`, `production.aws.sqs`; `staging.aws.lambda`, ...), or the cluster, then its namespaces.
   - **Deploy each element to the most specific node it runs on:** a Lambda function to `dev.aws.lambda`, a DynamoDB table to `dev.aws.dynamodb`, never to `dev` or `dev.aws` when they have nodes inside them. Add the node if it's missing.
   - **One node for each service in an environment:** never `dev.lambda` beside `dev.aws.lambda`.
   `archdoc_check` warns `deploy/loose-placement` for an element on an environment or node that has nodes inside it, and `deploy/split-node` for one service in two places.
8. **Check it's done.** Call `archdoc_check` with `done: true` (CLI: `archdoc check --done`). It lists what the model still lacks, each with what to do: parts outside the system, parts whose ID matches none of their code's names, code elements and steps that point at a whole file rather than a function or lines, components with no code element at the functions that do their work or with more than five, levels over the limits, small containers with components and big ones without, data entries without a description or without fields, source files no element covers, elements without a description of their own, test code modeled as an element, elements nothing connects to, no system, missing actors, actors that are `kind: agent` but aren't AI, actors without a plain `name:`, actors without a journey, entry points no journey reaches, short journeys, journeys that never reach what they store, publish, or call, steps without an action or code, steps that cross a boundary without saying what they carry, datastores and queues that don't say what they hold, deployment files with no environments, elements with no `deploy:`, and steps whose code is in another element than the ones they name, or on a container where a component would lead to the code. It also counts `archdoc_check`'s errors and warnings, and lists each with its fix. Work through all of it and call it again until it says the model is done; it isn't done while a warning is left that the code can answer. Each warning is a lookup in the code, not a note for the user: a data entry with no type or no fields means finding its schema (migrations, ORM models, protobuf, OpenAPI, the type the code builds) and mapping its fields; an unresolved data name means adding the entry under `data:` or fixing the name; a stale path means finding where the code moved. Only what it lists under "Left for a person" stays: owners, seals, other repositories' models, and the rules the team set. Don't fix those; name them when you hand over. Fix a line only with what the code shows: never add a use or a step you haven't seen in the code to clear it, and say which lines are left and why.
9. **Hand it over.** Say what the model covers, the journeys you traced, and what's left: only what needs a person, each with why. Then ask the user to review it. They accept facts by removing their `provenance` blocks. Once they have, `archdoc seal --all` starts keeping the model true.
10. **Offer to open it.** Ask whether they'd like to see it in the explorer, unless you've opened it already in this session (then give its URL again). If they say yes, open it for them (below).

## Show the user the model

When the user asks to see, show, view, or open the architecture or the model, or right after you've created or changed it and they'd want to look, open the explorer for them. Don't send them to a terminal.

1. **Already running?** If you started the explorer earlier in this session and it's still running, give its URL again. It runs with `--watch`, so it already shows the model as it is now. Don't start a second one.
2. **On a remote machine?** If `CLAUDE_CODE_REMOTE` is `true`, or `SSH_CONNECTION` or `SSH_TTY` is set, `127.0.0.1` is that machine, not the user's. Write the explorer as a static site instead, with `npx -y @archdoc/cli site --out archdoc-site`, and tell them where it is (a folder of HTML they can open or host, not for committing).
3. **Otherwise, start it detached:** `npx -y @archdoc/cli view --detach --watch --open`. `--detach` starts the explorer in a process of its own, waits until it's listening, prints its URL, and returns, so it works in any shell, with no background option. Run it again and it gives the URL of the one already running instead of starting another. `--open` opens their browser, and `--watch` updates the page as the model changes. To show a change, add `--base <ref>`, such as `--base main`.
4. **Tell them the URL** from the line it prints, `ArchDoc explorer: http://127.0.0.1:<port>`. With `--base`, add `#diff` so the link opens on the change. If it says there's no model, say so and offer to start one. If it prints nothing at all, `npx` couldn't download the CLI: see the network note at the top.
