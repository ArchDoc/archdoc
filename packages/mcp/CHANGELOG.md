# @archdoc/mcp

## 0.9.1

### Patch Changes

- 5a624d8: Plan by intent, Send to agent for Triage, one shape for the Build tabs, and a rename that keeps a container in its system.
  
  - Plan: no more forms. Click in a box on the map and say what you want there, in a small window where you clicked; it's an intent (`intents:` in the plan, `i1`), pinned in the box. You drive the design: your agent suggests nothing until you've sent an intent, then carries out what each one says, as suggested changes and sequences that name it (`for: [i1]`), which you accept or dismiss, and asks with the options where you left a choice open. `archdoc plan respond` refuses a suggestion before you've sent an intent, or without one. `archdoc check` says which intents nothing carries out yet, and they block Mark ready. Start a plan with the idea alone: its first line is the title.
  - Triage: paste a bug and press Send to agent: find the root cause, or Find and fix it. One way to hand it over, and a record's header sends it again (Send to agent: fix it, once it's root-caused). The record says so (`sent`, `ask`), and the agent picks it up with `archdoc triage wait` or `archdoc_triage` with `wait: true`, which marks it `received`. A read-only site still gives the prompt to copy.
  - Plan, Triage, and Diff share one layout: a list beside a header with what it is, where it stands, and its controls (Diff's branch picker moves there), over the map, with the same Send to agent button.
  - `archdoc edit` rename: `shop.ui`, with a system named `shop` (as init names it), now goes inside that system, as add does, instead of to the top of namespace `shop`; and a container moved to the top stays inside the only system. That's how a container ended up beside the system in the context view.
- Updated dependencies [3cf1a13]
- Updated dependencies [5a624d8]
  - @archdoc/core@0.9.1
  - @archdoc/analyzers@0.9.1

## 0.9.0

### Minor Changes

- 2f5681a: Plan a change with your agent on the map, instead of skimming a markdown plan.
  
  - **The explorer's Plan tab** (Build → Plan, no longer "coming soon") draws the model as it would be with the plan made, with the Diff tab's marks. Double-click the map to add an element (inside an open box to put it there), drag from a box's right edge to another for an arrow, click a box to change or remove it, and record a sequence by clicking boxes in order, or change a journey's steps. Every element, arrow, change, and step needs its intent before it saves. Pin notes to anything, reply to the agent's, and press **Send to agent** when you want its review. The agent's suggestions are drawn dashed, to accept or dismiss. **Mark ready** once nothing is open. A published site shows plans read-only.
  - **Plans live in `.archdoc/plans/<id>.yaml`**, never part of the model: changes written as `archdoc edit` ops, sequences of journey steps, notes with replies, and, once agreed, tasks with the changes they carry out, their files, and tests. What the person changed since the agent last read it is kept for the agent's next read.
  - **`archdoc plan`** (`start`, `list`, `read`, `wait`, `respond`, `task`) and the **`archdoc_plan`** MCP tool: start a plan from the idea with its scope, wait for the person to send it, read it with what they changed first and the op shapes to answer with, respond with notes, questions, risks, and suggested changes and steps (the agent can't change, accept, or drop the person's items), and mark tasks as they land, which moves the plan to executing and then done.
  - **`archdoc check` checks open plans**: items without intent, changes the model can't take and why, what the plan would break (findings the model would have with the plan made), open questions and suggestions, the journeys, actors, owners, and other repos it reaches with critical journeys called out, the tasks once it's ready, and while it's carried out, which planned changes the model doesn't show yet. Warnings while it's drafted, errors once it's ready.
  - **`archdoc view` writes plans** for the Plan tab: JSON only, from the explorer's own origin, and against the text the page last read, so the person and the agent never write over each other.
  - **Carrying a plan out**: once it's ready, `archdoc plan read` gives each agreed change as the `archdoc edit` op that makes it, and a change the model already shows counts as made, so landing one doesn't turn into a "can't be made" error.
  - The skill, AGENTS.md, and the MCP instructions teach the workflow.
  - **Removed:** `.archdoc/traces/` from before 0.8 isn't read as Triage records any more (`archdoc triage migrate` moves them), and the deprecated `archdoc trace` command is gone (use `archdoc triage`).

### Patch Changes

- Updated dependencies [2f5681a]
  - @archdoc/core@0.9.0
  - @archdoc/analyzers@0.9.0

## 0.8.1

### Patch Changes

- 693c11a: Triage records say more, and read better in the explorer.
  
  - **Each step of a bug says what happened there and what it carried.** `archdoc check` warns when a step of a root-caused or fixed record has no `description`, or crosses into another element without `sends` (or `creates`/`changes`), with the data the journey step it opens up sends as a hint, and notes a `sends` that isn't a data entry. `archdoc triage start` writes a record that asks for both, and its answer spells out the whole workflow, so an agent needn't look for the skill.
  - **The triage record comes first, also for a fix.** The MCP instructions, `archdoc_triage`, the skill, and AGENTS.md say to start the record before reading the code and keep it through the fix, and `archdoc context` says so when the task reads like a bug.
  - **The explorer's Triage header is small:** the root cause in brief and the fix, with the report a click away and no leads, so the map keeps the room. A step's panel shows the data it carried, with the fields the run had values for.
  - **Journeys:** a step's message moves at one speed whatever the arrow's length. A step can say what comes back (`returns:`), and a request through an API that returns data plays to the callee and back. The journey list shows whole titles.
  - **`archdoc view --detach`** starts the explorer in the background, prints its URL, and returns, reusing one already running: for agents whose shell can't keep a command running. The skill uses it, and asks to open the explorer once a new model is done.
  - **`archdoc init` never makes a component of one file.** Files beside a container's directories, and a flat package's files, stay with the container. A list of problems from `archdoc check` now says it's the work list, so an agent fixes a first pass's errors instead of stopping.
- Updated dependencies [693c11a]
  - @archdoc/core@0.8.1
  - @archdoc/analyzers@0.8.1

## 0.8.0

### Minor Changes

- a27ee24: Triage: hand your agent a bug and it finds the root cause, and records the bug's journey the way a journey records a flow. Traces grow into Triage records in `.archdoc/triage/<id>.yaml`, with a `status` (open, investigating, root-caused, fixed, wont-fix, cannot-reproduce), `severity`, `reported: { by, at, link }`, `attachments`, the leads followed as `hypotheses` (each confirmed or ruled out, with evidence), `root-cause: { summary, step }`, and `fix: { summary, link, test }`, beside the steps traces already had.
  
  - `archdoc triage start` and the new `archdoc_triage` MCP tool place a bug and write a record to fill in; `archdoc triage list` lists records, open ones first; `archdoc triage migrate` moves traces from `.archdoc/traces/`.
  - A bug report in plain words, with no stack trace, now places too: an element it names by its own name ("the notifier", "ledger-worker") counts, when no other element has that name.
  - `archdoc check` holds a record to what its status needs (a cause and a root cause once root-caused, a fix once fixed) and reports a closed record's stale code as info.
  - `archdoc context` lists the open records on what a task touches, and the PR comment says whether a change fixes a bug, finds its root cause, or triages it.
  - The explorer's Build → Triage tab replaces Explore → Traces: records by status, each one's report, leads, root cause, and fix, the bug's journey on the map one step at a time (or as lanes), and a panel that places a pasted error and gives a prompt to hand your agent. Old `#traces=` links open it.
  - Traces keyed `trace:` and files in `.archdoc/traces/` still load as records, with a note to migrate. `archdoc trace list` still works, and goes in 0.9.

### Patch Changes

- Updated dependencies [a27ee24]
  - @archdoc/core@0.8.0
  - @archdoc/analyzers@0.8.0

## 0.7.2

### Patch Changes

- Updated dependencies [d5019df]
- Updated dependencies [0efcd77]
  - @archdoc/core@0.7.2
  - @archdoc/analyzers@0.7.2

## 0.7.1

### Patch Changes

- Updated dependencies [90059fe]
  - @archdoc/core@0.7.1
  - @archdoc/analyzers@0.7.1

## 0.7.0

### Minor Changes

- 5f9749f: Agents find and change the model by ID, instead of reading `.archdoc/` and editing its YAML by hand. Two new MCP tools, each with a CLI command of the same name:
  
  - `archdoc_find` (`archdoc find`) lists parts of the model by words, by place (`under` an element), by the file they own (`path`, the owner first), by `type` and `kind`, or by what they still lack (`missing`: a description, code, uses, a deploy, fields, or a journey), each with its ID, code, uses, and where it's written. `outline: true` (`--outline`) shows the element tree with each element's code and uses.
  - `archdoc_edit` (`archdoc edit`) takes a list of ops by ID and runs them in order: `add` (an element inside the parent its ID names, with the kind of the level below, an actor, a data entry, a journey in its own file, an environment, or a deployment node), `set` (a JSON merge patch), `remove` (an element with what's inside it and the uses of it), `rename` (renames or moves, and rewrites every reference: uses, journey steps, sends, stores, owners), `use`, and `step` (append, insert, merge, or remove a journey step). It writes only the lines each op touches, so comments and formatting stay; writes all ops or none, refusing an edit that would add errors to the model; and answers with what each op did, the findings it fixed, new warnings, and code paths that match no file. `by` marks what it adds `provenance: { source: suggested }`.
  
  The skill and AGENTS.md tell agents to model a repository with them, a step of work per call.
  
  `archdoc seal` points a journey step's fact at its file when the step's `code` names a function (`orders/src/checkout.ts#placeOrder`), as the skill asks; before, it matched no file.

### Patch Changes

- 0f86d2d: `archdoc edit` takes the shorter shapes agents write: `stores` as a list or `{ Order: "what it keeps" }`, `uses` as a list on a new element, a data entry without `kind` (entity), an `add` without `type`, and `data:Order`-style IDs. An edit refused for its shape now says the shapes the schema wants. The skill says to change the model only with `archdoc_edit` once it exists, and the agent eval counts find, edit, and hand edits of `.archdoc/`.
- Updated dependencies [cc5f29e]
- Updated dependencies [e038693]
- Updated dependencies [0f86d2d]
- Updated dependencies [5f9749f]
  - @archdoc/core@0.7.0
  - @archdoc/analyzers@0.7.0

## 0.6.3

### Patch Changes

- 91e12de: Journeys go from one element to the next. A new warning, `journey/disconnected-step`, flags a step that starts at an element no earlier step reached (an actor, or an external system acting on its own, may start a step any time), and the skill tells agents to read the code between two elements rather than jump. In the explorer, a step that doesn't follow a use is drawn straight across between its boxes, in red, instead of looping around the map, and its panel shows the error; a step's note shows on one line when a use and a subscription join the same boxes.
  
  Actors have a new kind, `system`, for software that calls in on its own: another service, a scheduler or CronJob, a CI job, a webhook sender. `agent` is for AI agents. `archdoc init` makes the scheduler it finds in Terraform and CDK a `system`, `archdoc check --done` asks about an `agent` whose description doesn't say it's an AI, and the explorer colors and names each kind.
  
  `archdoc check --done` asks for the fields of every data entry that has neither fields nor a schema `source:` (`done/data-fields`), and the skill tells agents where to find each one's definition. The discovery score counts data entries with fields and journey steps that start where the flow already is.
  
  Infrastructure sits in one logical place: `deploy/loose-placement` warns when an element is deployed to an environment or node that has nodes inside it (`dev` beside `dev.aws.lambda`), and `deploy/split-node` when one service has two nodes in an environment (`dev.lambda` and `dev.aws.lambda`).
  
  The explorer's Data tab opens on where the data lives: each datastore and queue with its tables, keys, the entry each holds, and who writes and uses it, then what travels between the parts. Each entry has a page with its schema, where it's stored, who makes and gets it, the journey steps that send or write it, and related entries; Map shows it on the system map as before. The map's key and its layout direction are one box, "Key and layout".
  
  `archdoc init` keeps one app in one container: a workspace below the top of the repository (a Go server's `web/ui` with its app and modules) is one container with its packages as components, and a Go module's binary named after the module (`cmd/prometheus` in `github.com/prometheus/prometheus`) is one container with the module's packages. The skill says the same for when init can't tell.
- Updated dependencies [91e12de]
  - @archdoc/core@0.6.3
  - @archdoc/analyzers@0.6.3

## 0.6.2

### Patch Changes

- 043e5a5: `archdoc paths` stays readable in a big repository. With more than 60 entry points it answers with a summary: the entry points by place (the container they're in, or their package before there's a model), with counts by kind and routes grouped by resource, each line usually one journey. `entry` takes a place, a resource, or both (`"apps/api /orders"`) to list them, and one label to show its calls. `--hops` (`hops: true`) folds calls that stay inside one element, so a tree shows only the calls between elements. Call trees now follow handlers written as one-line arrows, such as `(req) => save(req)`. Init's brief uses the same summary.
  
  `archdoc check --done` isn't done while `archdoc check` has a warning the code can answer: it counts and lists them with the errors, and sets aside the ones only a person settles (owners, seals, other repositories' models, the team's rules). It also asks for components in a big container and none in a small one, and for a description of each data entry. A new warning, `data/long-name`, flags a data entry whose name is too long for the chip the explorer draws on a step, and the explorer cuts a long name to fit, with the whole name as its tooltip.
  
  `archdoc init` keeps a container with fewer than five source files lean, with no components. A dry run says plainly that it wrote nothing. The skill turns "figure out the architecture" into a model written to `.archdoc/`, works through every warning before it hands the model over, keeps big containers' components when it reshapes init's model, and names data entries with short nouns and a description.
- Updated dependencies [043e5a5]
  - @archdoc/analyzers@0.6.2
  - @archdoc/core@0.6.2

## 0.6.1

### Patch Changes

- f6855fe: `archdoc init` reads the AWS CDK and Terraform. It models the DynamoDB tables (with what each stores, keyed the way the table is), SQS queues, SNS topics, and the AWS services the code calls (such as SES), adds the uses the IAM grants and SDK calls show, places each function, table, and queue in an environment per CDK stack or Terraform workspace, and adds a scheduler actor for scheduled jobs. Every element now sits inside a system, so the explorer's Context view shows one box. Init writes actors and environments to files of their own, and tells the agent which docs and deployment files to read first and where flows start.
  
  New: `archdoc paths` (and the `archdoc_paths` MCP tool) lists where flows start (API routes, queue consumers, schedules, CLI commands, and pages, from the code and from CDK and Terraform) and the calls each one makes, down to the datastores, queues, and services it touches, in TypeScript, Python, and Go. The agent uses it to trace journeys instead of writing scripts to explore the repository.
  
  `archdoc check --done` asks for more before a model is done: a system element, a journey per main flow (and for most routes, consumers, and schedules), what each step that crosses into another container, a datastore, a queue, or an external carries, what each datastore stores, and an environment for every container, datastore, and queue when the repository has deployment files. The skill asks for the same.
- Updated dependencies [f6855fe]
  - @archdoc/analyzers@0.6.1
  - @archdoc/core@0.6.1

## 0.6.0

### Minor Changes

- eef9e90: Better system discovery for a new model. `archdoc check --done` (`archdoc_check` with `done: true`) says whether a model is done and what it still lacks, each with what to do: levels over the limits, elements with no description of their own, test and verification code modeled as elements, elements nothing connects to, missing actors, too few or too short journeys, and steps without an action or code, or on a container where a component would lead to the code. `archdoc init` leaves out tests, test packages, mocks, fixtures, benchmarks, smoke checks, and test-runner config. The archdoc skill has the agent find how each unconnected element is reached at runtime, list the entry points, trace the main flows through the code as journeys with a step per hop, and run the done check before it hands the model over. `scoreDiscovery` scores the same things for the evals.

### Patch Changes

- Updated dependencies [eef9e90]
- Updated dependencies [f668b61]
  - @archdoc/core@0.6.0
  - @archdoc/analyzers@0.6.0

## 0.5.1

### Patch Changes

- @archdoc/analyzers@0.5.1
  - @archdoc/core@0.5.1

## 0.5.0

### Minor Changes

- 11662c5: `archdoc init` sweeps every layer: containers, the components inside each container (its code directories, or in a flat package its files), and the code inside each component (its files, or a file's functions and classes), with uses from imports declared at the level where the two sides part. The model format gains `kind: code` for that layer, and `archdoc check` warns about a component outside a container (`model/component-outside-container`) and code outside a component (`model/code-outside-component`). Code needs no relationships of its own, so it isn't reported as an orphan.

### Patch Changes

- Updated dependencies [b9c94bf]
- Updated dependencies [11662c5]
- Updated dependencies [c59e030]
  - @archdoc/analyzers@0.5.0
  - @archdoc/core@0.5.0

## 0.4.1

### Patch Changes

- Updated dependencies [6df5f40]
  - @archdoc/core@0.4.1
  - @archdoc/analyzers@0.4.1

## 0.4.0

### Minor Changes

- 8389170: Simulation is hidden, and sharing models across repos is experimental. `show <journey> --sample`, the `sample` input of `archdoc_show`, and the explorer's "Try a sample" are gone, and the explorer no longer runs journeys: steps show their messages' fields, and a journey's rows are what its steps declare. `archdoc view` and `archdoc site` stop sending sample files. `simulate()` stays in `@archdoc/core`. `sync`, `publish`, `landscape build`, and `view --landscape` still work but are left out of `--help`, which now ends with a note pointing to docs/experimental.md.

### Patch Changes

- Updated dependencies [02d583c]
- Updated dependencies [c672281]
- Updated dependencies [5b72266]
- Updated dependencies [8389170]
- Updated dependencies [8f5359b]
- Updated dependencies [b434769]
- Updated dependencies [b9fdff6]
- Updated dependencies [9c1bee7]
  - @archdoc/core@0.4.0
  - @archdoc/analyzers@0.4.0

## 0.3.0

### Minor Changes

- Moves to 0.3.0. Skips 0.2.x, whose git tags (v0.1.2 to v0.2.0) belong to the v0 viewer. From now on, all six @archdoc packages share one version.

## 0.1.1

### Patch Changes

- a0022a8: Packages are built from clean before they're released, so they no longer ship leftover files from removed sources (0.1.0's CLI included an unused `dist/commands/data.js`). Each package now publishes as public by default.
- Updated dependencies [a0022a8]
  - @archdoc/core@0.1.1
  - @archdoc/analyzers@0.1.1

## 0.1.0

### Minor Changes

- 0c16f45: Add `archdoc context <words…|paths…>` and the `archdoc_context` MCP tool: a short brief for starting a task, with the files and symbols to open first, other callers of the functions they use ("does the same job elsewhere"), data, rules, the journeys whose steps name the files, tests, and owners. `@archdoc/analyzers` indexes exported symbols and named imports (`indexCode`), and `search` matches file paths and symbol names with it, splitting identifiers on `_`, `-`, and camelCase. `archdoc eval` replays recent commits through `context` and reports recall; `--min-recall` fails below a threshold.
- 9b10e0b: Five agent tools instead of 21, one per question, and `archdoc init`.
  
  The MCP server now has `archdoc_context` (where to start, from a task, paths, or an error; who uses it; an overview with nothing), `archdoc_show` (one thing by ID: an element with its code, actor, journey run on a sample, data entry, `Entry.field` lineage, trace, or sealed fact), `archdoc_check` (model problems, drift, rules, traces, and sealed facts whose code changed, each with its fix; with a base, the PR comment's verdict, journeys, and who to ask; `format: "markdown"` returns the comment), `archdoc_seal` (which now says what's left to check), and `archdoc_init`. The search, locate, overview, impact, anchor, get_element, get_actor, journey, data, code, lineage, simulate, validate, verify, diff, report, trace_check, and propose tools are gone: agents edit `.archdoc/` directly and `check` validates it. The tool list an agent reads drops from about 16,000 characters to under 4,500.
  
  The CLI commands of the same name print the same answers, shared in `@archdoc/analyzers`: `check` leads with the verdict and fixes (`--all` lists everything, `--seals` is what `verify` was), `show` takes any ID and `--sample`, and `context` takes `--error` and no arguments. `search`, `locate`, `impact`, `lineage`, `simulate`, `verify`, and `trace anchor/check/show` still work, with a note naming the command they're part of. `check` now checks traces too.
  
  `archdoc init` writes a starting model for a repository without one: containers from manifests (npm, Go, Cargo, Python, Maven, Gradle) and code directories, datastores and queues from compose files, uses from imports, and data, datastores, and contracts from Prisma, SQL migrations, OpenAPI, and protobuf, every fact marked `provenance: inferred`. Inferred facts show in the PR comment and the explorer as facts to review, like suggested ones. It never writes over a model and never seals.
- 88b968a: Add bug traces: the path one failing request took, written to `.archdoc/traces/<id>.yaml` and attached to the journey step where the error showed up (`expands: <journey>#<step>`). Steps use journey step syntax plus `role` (ok, cause, spreads, symptom), `evidence` (reproduced, read, inferred), `observed`/`expected`, and `missing`; a trace also has `works-in` and `fix`. Traces are never loaded into the model.
  
  - spec: `TraceFileSchema`, also in the JSON Schema.
  - core: `parseTrace`/`loadTraces`, `checkTrace` (unknown elements, journeys, and steps, stale code references, hops the model doesn't declare, a missing cause) with a resolved view for drawing, `anchorError` (stack frames and paths in JavaScript, Python, Go, Rust, and Java, mapped to elements and ranked journey steps), `traceSkeleton`, `tracesInChange` for the PR comment, `readTraceSources`, and text renderers.
  - cli: `archdoc trace anchor|check|list|show`; `archdoc show` finds traces too.
  - mcp: `archdoc_anchor` and `archdoc_trace_check`.
- bd15e1f: Code mapping and the MCP server. `@archdoc/core` adds `locate` (which element owns a path, most specific first), `resolveCodeMap` (files per element, unmapped files, stale code paths), and `impact` (consumers, affected actors and journeys ranked by importance, owners, and rules), with shared text and JSON reports. The CLI adds `archdoc locate`, `archdoc impact`, `archdoc map`, and `archdoc mcp`. The new `@archdoc/mcp` package serves read-only tools for coding agents over stdio. The explorer's details panel links each element to its code on GitHub and in VS Code.
- 9612ef4: Data in the explorer and for agents. The MCP server adds `archdoc_data` (an entry's fields, classifications, lifecycle, where it's stored and sent), `archdoc_lineage` (where a field's value comes from and goes, across repos), and `archdoc_simulate` (the branch a journey takes for a sample request, and the records it writes), and tells agents to use them before changing data. The explorer gains a Data section: pick an entry to see its fields and classifications and light up where it's stored and the relationships it travels along; click a field to draw its lineage graph across repos. Journeys that carry data get a simulator: edit a sample (or pick one from the repo's `samples/*.json`), run it in the browser, and read the branch each decision takes and the records each step creates and changes, in a timeline and in the journey bar. `archdoc view` now sends other repos' vendored models, so the explorer checks and simulates across repos like the CLI.
- e6a2e96: Agents close the loop, and reviewers see the change. `@archdoc/mcp` adds `archdoc_check`, `archdoc_diff`, and `archdoc_propose`, its first write tool: it adds elements and relationships to the model as suggestions with a rationale note in `.archdoc/proposals/`, never changes or removes what's there, keeps the YAML's formatting, and writes nothing that wouldn't validate. `@archdoc/core` adds `propose`, `planProposal`, `insertIntoMap`, and `readModelSourcesAtRef`. `@archdoc/analyzers` adds `checkRepository`, shared by the CLI and MCP. `archdoc view --base <ref>` shows the explorer's before/after view: changed boxes and relationships, removed ones as ghosts, suggested facts dashed, and affected journeys flagged.
- 1e8fc9f: Seals: know which parts of the model to re-check when code changes.
  
  `archdoc seal` records a fingerprint of the code each model fact points at in `.archdoc/archdoc.sum`. An element's paths are fingerprinted by the files it owns and the names they export, so a new file or a renamed export breaks the seal and a function body doesn't. Snippets, decisions, mappings, and contracts are fingerprinted by their lines (without comments and whitespace), journey steps by their entry file's exports, and data entries by their schema's fields.
  
  `archdoc check` reports `seal/changed` (with what changed) and `seal/unsealed` when a repository has an `archdoc.sum`, and with `--base` only what the change caused, so the PR comment lists them under "To check". `archdoc verify` lists the facts to re-check, with what changed and where each fact is in the model, and exits 1 while there are any. `archdoc seal <fact|element-id> --by <who>` records that someone checked. Without facts, it seals only new facts and keeps changed ones flagged, and `--all` seals everything. The PR comment says which facts a change sealed again, and who did. MCP adds `archdoc_verify` and `archdoc_seal`, which writes only `archdoc.sum`.
  
  `archdoc view` shows the same facts: the overview lists what to re-check, a box whose facts changed carries a "re-check" mark on the map, and its panel says what changed and which `archdoc seal` to run. When a change touches no code the model maps, the PR comment says so instead of "Touches the model only".
- a970b49: Pub-sub is a topic on the arrow. Contracts and relationships take a `transport` (http, grpc, kafka, sqs, eventbridge, or anything else). Core's `subscriptionOf` says when a relationship subscribes to a topic or event, and a journey step's message says when its data goes against the step (`against`), such as a subscriber's step to what it subscribes to. The explorer draws subscriptions from the publisher to the subscriber, labelled with their channel and transport, and plays messages, message focus, and journey steps the way the data goes. Tables inside an opened datastore take the datastore's emphasis instead of looking disabled.
  
  Code references can point at snippets: a line range (`lines: 40-88`) or a declaration (`symbol: Checkout::PlaceOrder.call`). `check` warns when a snippet no longer matches the code (`drift/stale-snippet`). `archdoc show <element> --code` and the new `archdoc_code` MCP tool print each snippet's text, so an agent reads the right lines before searching. In the explorer, every snippet links to its lines and shows them: `archdoc view` finds where each symbol's declaration is (core's `resolveSnippets`), and flags a snippet that no longer matches the code.
  
  `archdoc diff a.yaml b.yaml`, `archdoc report --base a.yaml`, and `archdoc view --base a.yaml` compare two model files without git. The PR report counts a changed relationship as touching the element it starts from, so its journeys are listed. `archdoc view` finds `<journey>.sample.json` files next to a model. A reference like `shop.orders` now resolves to that element even when the namespace is also `shop`.
  
  The examples are one flat folder: a quickstart, a modular monolith with components and snippets, an event-driven system, decisions, a big schema, and sensitive data. Three variants of the quickstart show changes to compare, and `examples/org/` (formerly `examples/acme/`) is the multi-repo demo.

### Patch Changes

- a87a18f: Cross-repo impact. A repo can import the landscape with `landscape:` in `archdoc.yaml`; `archdoc sync` reads it at its release tag with every model it vendors (checked against its lock), so one fetch brings every repo's model. `impact`, `show`, and the MCP tools then list consumers and journeys in other repos, and `show payments.charges` works for elements in other repos. The pull request report lists consumers in other repos, marks the ones a change breaks (an element they use is removed, or a contract they use `via`) or deprecates, adds their journeys and actors with sequence diagrams, and draws them in the change diagram. Model diffs name the contracts that changed. The spec adds `landscape:`, `lock.landscape`, and `includes` on bundles.
- 5d62016: Diff, drift, and the pull request loop. `@archdoc/core` adds a semantic model diff (`diffModels`), models at any git ref (`loadModelAtRef`), `check` (undeclared dependencies, `deny` and `allow-only` rules, stale code paths, orphan elements), and the pull request impact report. The new `@archdoc/analyzers` package finds workspace manifest dependencies and TS/JS imports. The CLI adds `archdoc check [--base]`, `archdoc diff [range]`, and `archdoc report --base`. `@archdoc/mcp` drops an unused dependency on `@archdoc/spec`.
- b9b658d: Every arrow on a journey carries a message. A step without `sends:` carries what the relationship it travels along sends (between its boxes, their parents, or what's inside them, and in another repo's model for a step that starts there), what the API it calls accepts (or returns, for a lookup), or what it writes through a mapping or creates and changes. `validate` warns about a step none of these name (`journey/step-without-message`), once the repos it goes into are synced, and `archdoc show <journey>` and the `archdoc_journey` MCP tool print each step's message and where it comes from. In the explorer, the current step's message travels along its arrow; opening a journey opens the tables it writes to, and each step lights up the row it adds or the fields it changes, with their values when the journey is simulated. The details panel expands each step to its message's fields.
- c942c74: A PR comment you can trust, and that tells a reviewer what to do.
  
  - `loadRevision` (analyzers) builds the model at any ref the way the working tree is built: schema sources, other repos' models pinned at that commit, and the repository's files. `report`, `diff`, MCP's `archdoc_diff`, and the explorer use it, so a field whose type comes from a schema no longer shows as changed on every pull request.
  - `check --base` checks the merge base too, and marks a finding introduced only when the base didn't have it. A one-line model edit is no longer blamed for warnings already on main.
  - `summarizeChange` (core) is one verdict on a change: blocking, attention, info, or none, with what blocks the merge and how to fix it, what to check, and who to involve. The PR comment and the explorer's Changes tab both render it.
  - The PR comment leads with that verdict, then blocking issues, a Before merging checklist, and a diagram of only what changed; journeys, consumers, data, drift, model changes, and findings already on the base fold. A change with no architectural impact gets one line.
  - Journey diagrams draw the steps after a decision as `alt / else` blocks with the decision's conditions.
  - A changed decision touches the element it runs in and the journeys, here and in other repos, that decide with it.
  - Bundles carry what the model's schema sources say (`schemas`), so a repo that imports another sees its field types.
  - `check --format github` prints workflow annotations; `report --explorer-url` links the change in the explorer; `archdoc site` writes the explorer as a static site, opened on a change with `--base`.
- Updated dependencies [0c16f45]
- Updated dependencies [9b10e0b]
- Updated dependencies [88b968a]
- Updated dependencies [565c92d]
- Updated dependencies [bd15e1f]
- Updated dependencies [a87a18f]
- Updated dependencies [a5810d6]
- Updated dependencies [56bcc26]
- Updated dependencies [59c4690]
- Updated dependencies [5d62016]
- Updated dependencies [32d17a6]
- Updated dependencies [c3db021]
- Updated dependencies [3f624eb]
- Updated dependencies [748bedf]
- Updated dependencies [7e4b25c]
- Updated dependencies [5ccd0d8]
- Updated dependencies [b9b658d]
- Updated dependencies [71b92f5]
- Updated dependencies [030b5ce]
- Updated dependencies [e6a2e96]
- Updated dependencies [1e8fc9f]
- Updated dependencies [423d593]
- Updated dependencies [7e01863]
- Updated dependencies [6dee848]
- Updated dependencies [527f9fe]
- Updated dependencies [41786cd]
- Updated dependencies [a970b49]
- Updated dependencies [c942c74]
- Updated dependencies [b4d81ae]
  - @archdoc/core@0.1.0
  - @archdoc/analyzers@0.1.0
