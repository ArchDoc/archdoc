---
name: archdoc
description: Use at the start of every coding task in a repository that has an .archdoc/ directory, before searching or reading code. Finds where the change belongs in the architecture model and what it affects (consumers, actors, journeys, owners, rules). Also use after editing, to check the change and keep the model true; when asked to explain or fix a bug, to place the error and write a trace; in a repository with no .archdoc/ yet, to start a model with archdoc init; and when the user asks to see, show, view, or open the architecture or the model, to open the explorer in their browser.
---

# Working in a repository with an ArchDoc model

`.archdoc/` holds the architecture the team agreed on: who uses the system (actors), what it's made of (elements, each mapped to code paths), how people use it (journeys), and the data it sends and stores. People own it. It's the fastest way to find where code lives and what a change affects, so start with it, before you grep.

Six MCP tools, one per question. Use them, not the CLI.

The ArchDoc MCP server starts with the session through `npx`, which takes a few seconds the first time, so its tools may not be in your tool list yet, or may be listed by name only (`mcp__plugin_archdoc_archdoc__archdoc_context` and the like). If you don't see them, search your tools for "archdoc" and load them, and if the server is still starting, wait and search again. Run the CLI instead only when no ArchDoc MCP server is configured at all; each command prints the same answer as its tool.

**`npx` needs the network the first time.** The MCP server and every `npx -y @archdoc/cli` command download the CLI from the npm registry until it's cached. In a sandbox without network access (Codex's default, and some other agents'), `npx` exits with no output, or with `ENOTFOUND`, `EAI_AGAIN`, or a fetch error, and the MCP server never starts. Don't read that as an empty answer or a missing model:

1. Run the command again with network access. In Codex, ask to run it outside the sandbox (escalated permissions), and say it's to download `@archdoc/cli` from npm.
2. If network access isn't allowed, tell the user what failed and give them two ways to fix it. They can turn on network access for the session; in Codex, that's `network_access = true` under `[sandbox_workspace_write]` in `~/.codex/config.toml`. Or they can install the CLI in the repository once (`npm install --save-dev @archdoc/cli`), so `npx` finds it without the network.

| Tool | Question | CLI, only without the MCP server |
|---|---|---|
| `archdoc_context` | Where do I start, and what does it affect? | `archdoc context <words or paths>`, `--error <file>` |
| `archdoc_show` | What is this one thing? | `archdoc show <id>` |
| `archdoc_paths` | Where do flows start, and what does each one call? | `archdoc paths [entry]` |
| `archdoc_check` | What's wrong or stale, and what does my change do? With `done: true`: is a new model done? | `archdoc check --base main`, `--done` |
| `archdoc_seal` | I checked these facts against their code. | `archdoc seal <fact> --by agent:<name>` |
| `archdoc_init` | There's no model yet. | `archdoc init` |

## A change: context, edit, check, seal

1. **Find where to start.** Call `archdoc_context` with the task in a few words, the files you plan to change, or both, such as `pr report shows type undefined for data fields`. You get the files and functions to open first (with line numbers), other code that does the same job (a fix in one place usually needs them too), the data and rules involved, the narrowest journeys, the tests to run, owners, and who uses it, other repos included. Read those files before you grep. A path you're about to create works too: it says where the file belongs.
2. **Say what it affects.** Name the affected journeys and actors when you share your plan. Ask the user first if a critical journey is involved, if the change would break a rule, or if it removes or renames something another repo uses.
3. **Look things up as you go.** `archdoc_show` takes any ID: an element (`code: true` adds its snippets' text), an actor, a journey, a data entry, `Entry.field` (where its value comes from and goes), a trace, or a fact `archdoc_check` names.
4. **Edit the code and the model together.** Stay inside the element boundaries you found. When the change adds a component or a dependency between elements on purpose, add it to `.archdoc/` and mark it as a suggestion, so a person accepts it:

   ```yaml
   uses:
     billing:
       description: Sends invoice events
       provenance: { source: suggested, by: agent:claude-code }
   ```

   When you remove, rename, or move something, update `.archdoc/` in the same change. When a component sends, accepts, or stores different data, update `data:` and the `sends`, `accepts`, `returns`, or `stores` that name it, and classify sensitive fields (`classification: pii`). Elements in other repos are referenced by namespace (`payments.charges`); to depend on a new repo, add it to `imports` and run `archdoc sync`. Never edit `.archdoc/archdoc.lock` or `.archdoc/vendor/` by hand.
5. **Check.** Call `archdoc_check` with base `main` (or the branch you started from). It leads with the verdict the PR comment will give, then what blocks the merge and what to check, each with its fix: imports the model doesn't declare, broken rules and journeys, stale paths, data rules, and facts whose code changed since they were sealed. Fix what your change introduced; if a dependency isn't intended, remove the import. Check again until it's clean.
6. **Seal what you checked.** If the repository keeps `.archdoc/archdoc.sum`, `archdoc_check` names each fact whose code you changed and what changed. Read it, update the model where it no longer describes the code, then call `archdoc_seal` with those facts (an element ID seals all of its facts) and `by: agent:<your-name>`. It says what's still to check. Sealing is your word that the model is right, and reviewers see it in the PR, so never seal a fact you haven't read.

In the PR description, list the affected journeys and actors and the model changes you suggested: `archdoc_check` with `format: "markdown"` (or `archdoc report --base main`) writes it for you.

## A bug: context on the error, then a trace

1. **Place the error.** Call `archdoc_context` with `error` set to the error as the user gave it: a log line, a stack trace, or the wrong output (CLI: `archdoc context --error log.txt`, or `-` for stdin). You get the journey steps it most likely showed up in (best first, with why), the elements its stack frames and paths map to, and a trace to start from.
2. **Follow the code** from the top step, and write the path the failing request actually took to `.archdoc/traces/<id>.yaml`:

```yaml
trace: refund-waits-for-finance
title: A $4 refund waits for finance instead of going through
symptom: |
  refund ref-ch-81: status pending_approval (expected approved)
reproduce: 'POST /refunds { "charge_id": "ch-81", "amount": 4.00 }'
expands: request-refund#4          # the journey step where it showed up (1-based)
diagnosis: The gateway converts the amount to cents a second time.
steps:
  - { from: app, to: api-gateway, action: Sends the refund request, evidence: read }
  - from: api-gateway
    to: payments.charges
    action: Forwards the request, multiplying the amount by 100
    code: services/gateway/src/refunds.ts:42
    role: cause                    # ok (default), cause, spreads, symptom
    evidence: reproduced           # reproduced, read, or inferred (default)
    observed: { RefundRequest.amount_cents: 40000 }
    expected: { RefundRequest.amount_cents: 400 }
fix: Pass amount_cents through unchanged.
```

   Give every step evidence, and be honest about it: `reproduced` only for what you saw run, `read` for what you followed in the code, `inferred` for the rest. `missing: { to, call }` marks a call that should have happened and didn't, and `works-in: { element, code, note }` points at code that does the same job right. A trace is evidence of one run, not the design, so it's never part of the model.
3. **Check it** with `archdoc_check`, which checks traces too: unknown elements and journeys, and stale code references. A hop the model doesn't declare is drift you found while debugging: say so, and add it to the model if the code is right. `archdoc_show` with the trace's ID shows it as the explorer will.
4. **Commit the trace with the fix.** The PR comment then says which bug the change fixes.

## No model yet: init, then make it true

In a repository with no `.archdoc/`, when the user asks you to model it (or to use ArchDoc):

What `init` writes is raw material, not a model. It lists every package, directory, file, and import it finds, without knowing what they're for, who uses them, or how the parts reach each other at runtime. The model you hand over is one an engineer new to the repository can read top-down in ten minutes, and whose journeys walk them through the main flows to the code. Steps 2 to 8 are that work, and they usually take most of your turns. Do them before you hand the model over, even when `archdoc_check` already passes: `archdoc_check` with `done: true` says what's left.

1. **Start it.** Call `archdoc_init` (or run `archdoc init`). It writes `.archdoc/` from what the repository declares, every layer of it, inside one `kind: system`: a container per package, module, or code directory; inside each container, a component per code directory (or, in a flat package, per file); inside each component, code for its files, or a file's functions and classes (`kind: code`, `code: { path, symbol }`); datastores and queues from compose files; uses from imports, declared at the level where the two sides part; and data and contracts from schema files. From Terraform and CDK it adds the tables (with their keys as data), queues, and services the code calls, a use from the component that makes each call, a scheduler actor for scheduled jobs, and `environments:` with `deploy:`; compose files add a `local` environment. It leaves out tests and other verification code. Everything is marked `provenance: { source: inferred }`. It never writes over a model. Its answer is a brief: the docs and deployment files to read, and the entry points (routes, consumers, schedules, commands) where flows start.
2. **Read how the project describes itself.** Read the docs and deployment files the brief lists: the README, any architecture or design docs, and the files that wire the system together: compose files, Kubernetes manifests, Helm charts, Terraform, CDK, an app host (.NET Aspire and the like). Note the parts they name, how those parts talk to each other, and who they say uses the system. Those parts are your top-level elements, under the names the project uses. Don't write scripts to explore the repository: `archdoc_paths` lists the entry points and the calls each one makes, and `archdoc_show` with `code: true` shows an element's code.
3. **Reshape it before you describe it.** Change init's structure until it matches those parts and these limits. When init's model is much bigger than the limits (hundreds of elements), don't edit it piece by piece: write a new `archdoc.yaml` with the structure you found in step 2, and take only the code paths and uses you need from init's.
   - **Keep the system at the top.** Name it for the product, keep the containers, datastores, and queues inside it, and the externals outside. It's the box the explorer's Context view draws, with who uses it and what it calls around it.
   - **Keep each level small.** Aim for about 3 to 12 top-level elements, and about 3 to 10 children under each. A container is something that runs or ships on its own: a service, a binary, a web app, a worker, a scheduled job, a published library. A component is one responsibility inside a container.
   - **Fold away what's too fine.** Fold init's per-file `kind: code` elements into their component's `code:` glob. Map each element to its whole directory (`tsdb/**`), not a handful of files from it, so all of its code belongs to it. Keep a code element only for a file or function a newcomer has to find by name, such as an entry point or the core algorithm. Fold build and tooling config (`vite-config`, `eslint-config`, `next-config`) into the element it configures.
   - **Leave out tests and verification code.** Test suites, end-to-end and load tests, test helpers and fixtures, mocks and fakes, benchmarks, smoke checks, and test-runner config aren't architecture, even when they have their own package. Init leaves most of them out; remove any element that's left, and don't add one. A container's glob may still cover its own tests. Never model vendored or generated code either.
   - **Group variants.** When one thing comes in many variants, make one element for the thing, and list the variants in its `technology` or as its children. Examples are the same server written in several languages, one client per framework, or one plugin per provider.
   - **Rename what init named after build files.** IDs like `gson-parent-2` or `stripe-sample-app-3` become what the project calls the element. Fix `namespace` the same way.
   - **Place shared code once.** When several binaries share library code, put it where a newcomer would look for it, and say in its description who uses it.
4. **Add what init can't see, and connect every element.** Init sees imports and compose files. Services reach each other in ways it doesn't: HTTP calls to a URL from config or the environment, gRPC clients, messages on a queue, SDK clients for third-party services, jobs a scheduler starts, plugins loaded by name.
   - **Infrastructure.** Add the datastores, queues, and third-party services init didn't find, from app hosts, manifests, Terraform, CDK, connection strings, environment variables, and SDK clients, each as its own element with `kind` (`datastore`, `queue`, or `external` for a third-party service such as Stripe or an email provider) and `technology`. Add each deployment definition (manifest, chart, Terraform module, app host) to the `code:` of the element it deploys or provisions. Add shared contracts (protobuf, OpenAPI) to the element that serves them.
   - **Where it runs.** Add an `environments:` section with one entry per environment (production, staging, local) and the infrastructure nodes inside it that the deployment files name (cloud account or region, cluster, namespace, host, managed service), each with `code:` pointing at its Terraform, Helm, Kubernetes, or compose file. Then give each container, datastore, and queue a `deploy:` naming where it runs in each environment, such as `deploy: [production.aws.eks, local.compose]`, with `replicas`, `url`, and `code` when the files say them.
   - **What it stores and sends.** For each datastore, list what it keeps under `stores:` (each table or collection, its key, and the data entry it holds), and describe each entry under `data:` with its fields, from the schema, migrations, ORM models, the IaC that creates it (a DynamoDB table's keys), or the code that writes it. For each queue, name the messages that go through it. Classify personal data (`classification: pii`).
   - **Uses.** Put each use between the components whose code makes the call, not on their containers. Route messages through the queue: the publisher uses the queue, and so does the consumer. Point each use at the datastore or external it reaches, and say in its description what it does (`Publishes order.placed`, `Books a shipping label`).
   - **Investigate every element nothing connects to.** `archdoc_check` warns `model/orphan-element` for each one. An orphan is usually a service that's reached at runtime, not imported. For each, read its entry point and search for its name, port, route paths, queue or topic names, and environment variables across the repository: who calls the URL, who publishes what it consumes, which manifest or CronJob runs it, which config registers it. Add each use you find with the code that shows it. Remove the element only if it isn't part of the system (build tooling often isn't), and say which ones you couldn't connect and why.
5. **Describe each element, top-down,** with the code open (`archdoc_show <id>` with `code: true`). Start with the containers, then the components inside each. Give each one or two sentences that say what it's responsible for, in the domain's terms, not what it's called or which files it has. Replace every description init wrote (`The x package.`, `A code directory (...).`). Keep the layers nested: a component inside a container, and code inside a component. `archdoc_check` flags one that isn't.
6. **Find the actors and the flows they follow.**
   - **List the entry points.** Call `archdoc_paths`: it lists the HTTP routes, queue consumers, scheduled jobs, and CLI commands it finds in the code and in Terraform and CDK. Add the ones it can't see (UI pages and forms, webhooks, handlers registered by name). Each is where a flow starts.
   - **Name the actors** behind them: the people who use the UIs and APIs (by role, such as `customer` or `operator`), other systems that call in, and the scheduler that starts jobs (`kind: agent`). Give each `uses` for the element it reaches first.
   - **A journey for each main flow:** one for each entry point, or group of entry points that do one thing (the routes of one resource, say), so the journeys together reach most of them; most systems have four to ten. Include what happens after a flow asynchronously (the consumers of what it publishes) and the scheduled and admin jobs. Mark the main one `importance: critical`. Leave out a flow only for a reason you'll say when you hand over (a health check, a debug route).
   - **Trace each one through the code.** Call `archdoc_paths` with the entry point (`entry: "POST /orders"`): it shows the calls the flow makes, by function, file, and line, the element each is in, and what each reaches outside the code (a table, a queue, an HTTP call). Follow it hop by hop: from the route to the component that does the work, to what it stores, to what it publishes, to who consumes that, to the external it calls, until the flow ends. Open the files on the path to read what each hop does and what data it carries; don't guess a hop from names, and don't grep for what the paths already show.
   - **Write each hop as a step,** one journey per file in `.archdoc/journeys/<id>.yaml` (with `journeys:` at its top), so each edit is small. `from` and `to` are the most specific elements that do the work (a component, not its container, when it has components), and the step's `code` is in one of them: when the work happens in a shared library, the step goes through the library's component. End the flow where it really ends: the datastore it writes, the queue it publishes to, the external it calls. `action` says what happens in the domain's words (`Prices the cart and saves the order`). `code` is the file where it happens, with the function when it helps (`orders/src/checkout/place-order.ts#placeOrder`). Every step that crosses into another container, a datastore, a queue, or an external says what it carries: `sends` with the request or message (`OrderPlaced`), or, for a write, `creates` or `changes` with the records (`creates: Order`, `changes: { Order.status: placed -> paid }`); add each one under `data:` with its fields, from the code that builds it. Add `description` for what a newcomer would miss: a condition, a retry, a transaction. Give the journey a `goal` from the actor's side and a `description` of the flow in a sentence or two.

   ```yaml
   journeys:
     place-order:
       actor: customer
       goal: Buy what's in the cart
       description: The storefront posts the cart to the orders API, which saves the order and publishes order.placed for fulfillment.
       importance: critical
       steps:
         - { from: customer, to: web.checkout, action: Places the order, code: web/src/pages/checkout.tsx }
         - { from: web.checkout, to: orders.routes, action: POSTs the cart to /orders, code: web/src/api.ts#placeOrder }
         - { from: orders.routes, to: orders.checkout, action: Prices the cart and places the order, code: orders/src/routes/orders.ts }
         - { from: orders.checkout, to: postgres, action: Saves the order as placed, code: orders/src/store/orders-repo.ts#insertOrder }
         - { from: orders.checkout, to: rabbitmq, action: Publishes order.placed, code: orders/src/events/publisher.ts, sends: OrderPlaced }
   ```

   Each step has to follow a use (`archdoc_check` says which don't): when a step shows a call the model is missing, add the use, since the code you just read shows it.
7. **Say where it runs.** Init writes the environments the deployment files define; check them against those files, and add what it missed: other environments (staging, local), the infrastructure in each (account or region, cluster, serverless, managed services, CDN), each with `code:` pointing at its file. Give each container, datastore, and queue a `deploy:` naming where it runs in each environment (`deploy: [production.aws.lambda]`).
8. **Check it's done.** Call `archdoc_check` with `done: true` (CLI: `archdoc check --done`). It lists what the model still lacks, each with what to do: levels over the limits, source files no element covers, elements without a description of their own, test code modeled as an element, elements nothing connects to, no system, missing actors, actors without a journey, entry points no journey reaches, short journeys, journeys that never reach what they store, publish, or call, steps without an action or code, steps that cross a boundary without saying what they carry, datastores and queues that don't say what they hold, deployment files with no environments, elements with no `deploy:`, and steps whose code is in another element than the ones they name, or on a container where a component would lead to the code. It also counts `archdoc_check`'s errors. Work through it and call it again until it says the model is done. Fix a line only with what the code shows: never add a use or a step you haven't seen in the code to clear it, and say which lines are left and why.
9. **Hand it over.** Say what the model covers, the journeys you traced, and what's left. Then ask the user to review it. They accept facts by removing their `provenance` blocks. Once they have, `archdoc seal --all` starts keeping the model true.
10. **Offer to open it.** Ask whether they'd like to see it, and if so, open the explorer for them (below).

## Show the user the model

When the user asks to see, show, view, or open the architecture or the model, or right after you've created or changed it and they'd want to look, open the explorer for them. Don't send them to a terminal.

1. **Already running?** If you started the explorer earlier in this session and it's still running, give its URL again. It runs with `--watch`, so it already shows the model as it is now. Don't start a second one.
2. **On a remote machine?** If `CLAUDE_CODE_REMOTE` is `true`, or `SSH_CONNECTION` or `SSH_TTY` is set, `127.0.0.1` is that machine, not the user's. Write the explorer as a static site instead, with `npx -y @archdoc/cli site --out archdoc-site`, and tell them where it is (a folder of HTML they can open or host, not for committing).
3. **Otherwise, start it in the background**, so it doesn't block the session (in Claude Code, the Bash tool's background option, not a trailing `&`): `npx -y @archdoc/cli view --watch --open`. `--open` opens their browser, and `--watch` updates the page as the model changes. To show a change, add `--base <ref>`, such as `--base main`.
4. **Tell them the URL** from the line it prints, `ArchDoc explorer: http://127.0.0.1:<port>`; read the background output for it. With `--base`, add `#changes` so the link opens on the change. If the output says there's no model, say so and offer to start one.
