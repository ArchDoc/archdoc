# @archdoc/spec

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

## 0.8.1

### Patch Changes

- 693c11a: Triage records say more, and read better in the explorer.
  
  - **Each step of a bug says what happened there and what it carried.** `archdoc check` warns when a step of a root-caused or fixed record has no `description`, or crosses into another element without `sends` (or `creates`/`changes`), with the data the journey step it opens up sends as a hint, and notes a `sends` that isn't a data entry. `archdoc triage start` writes a record that asks for both, and its answer spells out the whole workflow, so an agent needn't look for the skill.
  - **The triage record comes first, also for a fix.** The MCP instructions, `archdoc_triage`, the skill, and AGENTS.md say to start the record before reading the code and keep it through the fix, and `archdoc context` says so when the task reads like a bug.
  - **The explorer's Triage header is small:** the root cause in brief and the fix, with the report a click away and no leads, so the map keeps the room. A step's panel shows the data it carried, with the fields the run had values for.
  - **Journeys:** a step's message moves at one speed whatever the arrow's length. A step can say what comes back (`returns:`), and a request through an API that returns data plays to the callee and back. The journey list shows whole titles.
  - **`archdoc view --detach`** starts the explorer in the background, prints its URL, and returns, reusing one already running: for agents whose shell can't keep a command running. The skill uses it, and asks to open the explorer once a new model is done.
  - **`archdoc init` never makes a component of one file.** Files beside a container's directories, and a flat package's files, stay with the container. A list of problems from `archdoc check` now says it's the work list, so an agent fixes a first pass's errors instead of stopping.

## 0.8.0

### Minor Changes

- a27ee24: Triage: hand your agent a bug and it finds the root cause, and records the bug's journey the way a journey records a flow. Traces grow into Triage records in `.archdoc/triage/<id>.yaml`, with a `status` (open, investigating, root-caused, fixed, wont-fix, cannot-reproduce), `severity`, `reported: { by, at, link }`, `attachments`, the leads followed as `hypotheses` (each confirmed or ruled out, with evidence), `root-cause: { summary, step }`, and `fix: { summary, link, test }`, beside the steps traces already had.
  
  - `archdoc triage start` and the new `archdoc_triage` MCP tool place a bug and write a record to fill in; `archdoc triage list` lists records, open ones first; `archdoc triage migrate` moves traces from `.archdoc/traces/`.
  - A bug report in plain words, with no stack trace, now places too: an element it names by its own name ("the notifier", "ledger-worker") counts, when no other element has that name.
  - `archdoc check` holds a record to what its status needs (a cause and a root cause once root-caused, a fix once fixed) and reports a closed record's stale code as info.
  - `archdoc context` lists the open records on what a task touches, and the PR comment says whether a change fixes a bug, finds its root cause, or triages it.
  - The explorer's Build → Triage tab replaces Explore → Traces: records by status, each one's report, leads, root cause, and fix, the bug's journey on the map one step at a time (or as lanes), and a panel that places a pasted error and gives a prompt to hand your agent. Old `#traces=` links open it.
  - Traces keyed `trace:` and files in `.archdoc/traces/` still load as records, with a note to migrate. `archdoc trace list` still works, and goes in 0.9.

## 0.7.2

No changes in this release.

## 0.7.1

### Patch Changes

- 90059fe: Discovery keeps every part inside the system, names parts the way the code does, and points code at the lines that do the work.
  
  - **Inside the system.** `archdoc check --done` asks for every container, component, datastore, and queue outside the system element to move inside it (`done/outside-system`, which named only datastores and queues before), so the explorer's Context view shows the system as one box instead of looking like the Container view. `archdoc edit` puts a container, datastore, or queue added with no parent inside the model's one system, and says so. The discovery score's System part is now the share of parts inside the system, not only whether there is one.
  - **Names from the code.** `done/code-name` names a container or component whose ID matches none of the names its code goes by (`auth.identity → auth` for `src/auth/**`), and asks for a `name:` in plain words (`name: Local Migration Scripts`) when its code goes by several names. Generic directories (`src/`, `internal/`, `cmd/`) don't count as names.
  - **Code a reader can audit.** `done/whole-file-code` names code elements that point at a whole file, `done/no-key-code` components (and containers without components) with no code element at a function, class, or lines, and `done/step-whole-file` journey steps whose code names a whole source file rather than `file#function` or `file:40-88`. An element's `code:` takes the same shorthand as a step's: `path#symbol`, `path:40`, and `path:40-88` read as `{ path, symbol }` and `{ path, lines }`.
  - `scoreDiscovery` scores three new parts, code names, code precision, and key code, and the agent eval reports them.
  
  The skill and AGENTS.md say the same: keep init's system with everything but externals inside it (with a skeleton for a hand-written `archdoc.yaml`), name each part after its directory, package, or module with the domain's words in the description, add 1 to 5 code elements per component at the functions a newcomer opens first, and give each journey step the function where it happens.

## 0.7.0

No changes in this release.

## 0.6.3

### Patch Changes

- 91e12de: Journeys go from one element to the next. A new warning, `journey/disconnected-step`, flags a step that starts at an element no earlier step reached (an actor, or an external system acting on its own, may start a step any time), and the skill tells agents to read the code between two elements rather than jump. In the explorer, a step that doesn't follow a use is drawn straight across between its boxes, in red, instead of looping around the map, and its panel shows the error; a step's note shows on one line when a use and a subscription join the same boxes.
  
  Actors have a new kind, `system`, for software that calls in on its own: another service, a scheduler or CronJob, a CI job, a webhook sender. `agent` is for AI agents. `archdoc init` makes the scheduler it finds in Terraform and CDK a `system`, `archdoc check --done` asks about an `agent` whose description doesn't say it's an AI, and the explorer colors and names each kind.
  
  `archdoc check --done` asks for the fields of every data entry that has neither fields nor a schema `source:` (`done/data-fields`), and the skill tells agents where to find each one's definition. The discovery score counts data entries with fields and journey steps that start where the flow already is.
  
  Infrastructure sits in one logical place: `deploy/loose-placement` warns when an element is deployed to an environment or node that has nodes inside it (`dev` beside `dev.aws.lambda`), and `deploy/split-node` when one service has two nodes in an environment (`dev.lambda` and `dev.aws.lambda`).
  
  The explorer's Data tab opens on where the data lives: each datastore and queue with its tables, keys, the entry each holds, and who writes and uses it, then what travels between the parts. Each entry has a page with its schema, where it's stored, who makes and gets it, the journey steps that send or write it, and related entries; Map shows it on the system map as before. The map's key and its layout direction are one box, "Key and layout".
  
  `archdoc init` keeps one app in one container: a workspace below the top of the repository (a Go server's `web/ui` with its app and modules) is one container with its packages as components, and a Go module's binary named after the module (`cmd/prometheus` in `github.com/prometheus/prometheus`) is one container with the module's packages. The skill says the same for when init can't tell.

## 0.6.2

No changes in this release.

## 0.6.1

No changes in this release.

## 0.6.0

### Minor Changes

- f668b61: Model where the system runs, and see it in the explorer. A new `environments:` section holds each environment (production, staging, local) and its infrastructure as nodes inside nodes (cloud, region, cluster, namespace, managed service), each with `kind`, `technology`, and the `code` that defines it. Containers, datastores, and queues say where they run with `deploy`: a node's path such as `production.aws.eks`, a list of them, or `{ to, replicas, url, technology, code }`. The explorer's new Infrastructure tab draws one environment at a time, with each container on its node and the uses between them, and nodes colored by what they are (cloud and network, compute, managed service, client) with a key; `archdoc show` prints an environment or a node with what runs on it, and where an element is deployed. `validate` fails on a `deploy` that names nothing and warns about containers that don't say where they run once a model has environments; `check` warns about deployment code that matches no file, and seals flag a node's or deployment's code when it changes.

## 0.5.1

No changes in this release.

## 0.5.0

### Minor Changes

- 11662c5: `archdoc init` sweeps every layer: containers, the components inside each container (its code directories, or in a flat package its files), and the code inside each component (its files, or a file's functions and classes), with uses from imports declared at the level where the two sides part. The model format gains `kind: code` for that layer, and `archdoc check` warns about a component outside a container (`model/component-outside-container`) and code outside a component (`model/code-outside-component`). Code needs no relationships of its own, so it isn't reported as an orphan.

## 0.4.1

No changes in this release.

## 0.4.0

### Minor Changes

- 8f5359b: The model format is split into stable and experimental parts. `imports`, `landscape`, `domains`, rules with `scope: org`, `mappings`, `logic`, and journey steps' `decides` and `branches` are experimental: their JSON Schema descriptions start "Experimental", and `archdoc validate` (and its `--json`) names the ones a model uses in a note that doesn't fail `--strict`. Core's `experimentalUses(model)` lists them. The JSON Schema is at https://cdn.jsdelivr.net/npm/@archdoc/spec@0/schema/archdoc.v2.schema.json for editors.

## 0.3.0

### Minor Changes

- Moves to 0.3.0. Skips 0.2.x, whose git tags (v0.1.2 to v0.2.0) belong to the v0 viewer. From now on, all six @archdoc packages share one version.

## 0.1.1

### Patch Changes

- a0022a8: Packages are built from clean before they're released, so they no longer ship leftover files from removed sources (0.1.0's CLI included an unused `dist/commands/data.js`). Each package now publishes as public by default.

## 0.1.0

### Minor Changes

- 88b968a: Add bug traces: the path one failing request took, written to `.archdoc/traces/<id>.yaml` and attached to the journey step where the error showed up (`expands: <journey>#<step>`). Steps use journey step syntax plus `role` (ok, cause, spreads, symptom), `evidence` (reproduced, read, inferred), `observed`/`expected`, and `missing`; a trace also has `works-in` and `fix`. Traces are never loaded into the model.
  
  - spec: `TraceFileSchema`, also in the JSON Schema.
  - core: `parseTrace`/`loadTraces`, `checkTrace` (unknown elements, journeys, and steps, stale code references, hops the model doesn't declare, a missing cause) with a resolved view for drawing, `anchorError` (stack frames and paths in JavaScript, Python, Go, Rust, and Java, mapped to elements and ranked journey steps), `traceSkeleton`, `tracesInChange` for the PR comment, `readTraceSources`, and text renderers.
  - cli: `archdoc trace anchor|check|list|show`; `archdoc show` finds traces too.
  - mcp: `archdoc_anchor` and `archdoc_trace_check`.
- a87a18f: Cross-repo impact. A repo can import the landscape with `landscape:` in `archdoc.yaml`; `archdoc sync` reads it at its release tag with every model it vendors (checked against its lock), so one fetch brings every repo's model. `impact`, `show`, and the MCP tools then list consumers and journeys in other repos, and `show payments.charges` works for elements in other repos. The pull request report lists consumers in other repos, marks the ones a change breaks (an element they use is removed, or a contract they use `via`) or deprecates, adds their journeys and actors with sequence diagrams, and draws them in the change diagram. Model diffs name the contracts that changed. The spec adds `landscape:`, `lock.landscape`, and `includes` on bundles.
- a5810d6: Data, part one. Data entries (`entity`, `message`, `event`) have fields with a `classification`, enum `values`, and lifecycle `states`. Datastores map tables to entries with `stores`, relationships `send` data, contracts `accept`, `return`, or `carry` it, and journey steps say what they `send`, `create`, and `change`. Data in other repos is referenced by namespace and checked once synced. `validate` reports undefined data, unknown fields, values outside an enum, state changes the lifecycle doesn't allow, and data sent to an element that doesn't accept it. A new rule kind, `data: { classification, stored-in | not-sent-to }`, runs in `check` (and as an org rule from the landscape). Rule selectors can now name elements in other repos (`payments.charges`) and match `{ namespace }`. The PR report gains a Data section: entries that changed, and sensitive data a change sends or stores somewhere new, with external elements called out. `archdoc show` and `search` cover data entries, and `archdoc landscape build` composes every repo's data. `@archdoc/core` exports `resolveData`, `dataFlows`, `dataStores`, `checkData`, `evaluateDataRules`, and `sensitiveDataChanges`.
- 56bcc26: Data on the system canvas. A data field can point at another entry's field with `references: Charge.id` (or `Charge`, for its key); a field whose type names another entry points at it too, and SQL migrations and Prisma schemas fill references in from their foreign keys and relations. `validate` reports references that don't resolve, and the landscape keeps them pointing at the right entries. In the explorer, picking a message lights up the arrows it travels along and animates them; picking an entity opens the datastore that stores it into its tables, with a line for each foreign key, and any datastore's tables open from its card. A field's lineage now lights up on the same canvas, in every table and along every arrow on the way, instead of replacing it with a separate graph. `archdoc view` reads schema sources, so the explorer shows the types and foreign keys `check` sees.
- 3f624eb: Share models across repos. `archdoc sync` reads each import's model at the newest release tag its range allows (with git, from GitHub or any git URL), vendors it in `.archdoc/vendor/`, and pins it in `.archdoc/archdoc.lock`; `--update` takes new releases and `--frozen` checks the lock in CI. `archdoc publish` writes a validated, versioned bundle for `url:` imports. `validate` and `check` now report references into other repos that don't exist at the pinned version, deprecated targets and contracts, `via` contracts the target doesn't provide, journey steps that start in another repo but don't follow its relationships, and version skew between imports. The spec adds `provides` (api, topic, event), `via` on relationships, `git:` imports with an optional `path`, and the bundle and lockfile formats. A journey step from a publisher to a subscriber now follows the message. The new `@archdoc/federation` package holds sync and publish; `check` treats lockfile and vendor changes as model changes.
- 71b92f5: The landscape repo. `archdoc landscape build` composes the landscape's model with every model it imports into one (each repo a system named by its namespace, its elements inside, references and journeys connected across repos, repo copies of landscape teams merged), checks it (journeys across repos, owners that resolve to no actor are errors, the landscape's rules across repos), and writes the explorer and the composed model as a static site for GitHub Pages. `archdoc view --landscape` serves it live, and the explorer now uses relative URLs so it runs from any path. The spec adds `domains:` and `scope: org` on rules: in a repo that imports the landscape, owners resolve against the landscape's teams and its org rules run in `check`. `@archdoc/core` exports `composeLandscape`. `integrations/landscape-template` is a starting point for a landscape repo.
- 030b5ce: Mappings, logic, lineage, and simulation. `mappings:` say how records become other records, field by field, as CEL expressions over named inputs, written to an entry or a datastore table. `logic:` blocks are an element's decisions on the data it receives, as CEL rules (first match wins, then `else`). Journey steps `decide` with a logic block and say what each outcome's `branches` create, change, or continue as; later steps run `when` an outcome was decided, and write `via` a mapping. `validate` checks inputs, targets, and fields, that expressions parse, that rules end with `else`, and that branches, `when`, and `via` name something real, in this repo and in synced imports. `archdoc lineage <Entry.field>` follows a value through every mapping across repos to the tables it lands in. `archdoc simulate <journey> --sample <file>` runs a journey against sample records: the branch each decision takes and why, the records each step creates and changes, and where they're stored, deterministically. The PR report shows changed mappings and decisions with their expressions before and after. The landscape composes every repo's mappings and logic. CEL runs on `@marcbachmann/cel-js`.
- 1e8fc9f: Seals: know which parts of the model to re-check when code changes.
  
  `archdoc seal` records a fingerprint of the code each model fact points at in `.archdoc/archdoc.sum`. An element's paths are fingerprinted by the files it owns and the names they export, so a new file or a renamed export breaks the seal and a function body doesn't. Snippets, decisions, mappings, and contracts are fingerprinted by their lines (without comments and whitespace), journey steps by their entry file's exports, and data entries by their schema's fields.
  
  `archdoc check` reports `seal/changed` (with what changed) and `seal/unsealed` when a repository has an `archdoc.sum`, and with `--base` only what the change caused, so the PR comment lists them under "To check". `archdoc verify` lists the facts to re-check, with what changed and where each fact is in the model, and exits 1 while there are any. `archdoc seal <fact|element-id> --by <who>` records that someone checked. Without facts, it seals only new facts and keeps changed ones flagged, and `--all` seals everything. The PR comment says which facts a change sealed again, and who did. MCP adds `archdoc_verify` and `archdoc_seal`, which writes only `archdoc.sum`.
  
  `archdoc view` shows the same facts: the overview lists what to re-check, a box whose facts changed carries a "re-check" mark on the map, and its panel says what changed and which `archdoc seal` to run. When a change touches no code the model maps, the PR comment says so instead of "Touches the model only".
- 527f9fe: Schema importers. A data entry's `source:` names the schema it comes from: SQL migrations (`sql: migrations#charges`, replayed in file order through CREATE and ALTER TABLE), Prisma (`prisma: prisma/schema.prisma#Charge`), OpenAPI and JSON Schema (`openapi: openapi/trips.yaml#Trip`, `jsonschema: schemas/rider.json`), or Protobuf (`proto: proto/charges.proto#RefundRequest`). Fields can leave out their type when the entry has a source; `archdoc check` fills it in and reports schema drift: a modeled field the schema doesn't have (an error when it's classified, since a rename loses the classification), fields the schema has that the model doesn't, and type or enum mismatches. `@archdoc/analyzers` exports `importSchemas` and the `SchemaImporter` API; `@archdoc/core` exports `schemaDrift`, `applySchemas`, and `normalizeType`.
- a970b49: Pub-sub is a topic on the arrow. Contracts and relationships take a `transport` (http, grpc, kafka, sqs, eventbridge, or anything else). Core's `subscriptionOf` says when a relationship subscribes to a topic or event, and a journey step's message says when its data goes against the step (`against`), such as a subscriber's step to what it subscribes to. The explorer draws subscriptions from the publisher to the subscriber, labelled with their channel and transport, and plays messages, message focus, and journey steps the way the data goes. Tables inside an opened datastore take the datastore's emphasis instead of looking disabled.
  
  Code references can point at snippets: a line range (`lines: 40-88`) or a declaration (`symbol: Checkout::PlaceOrder.call`). `check` warns when a snippet no longer matches the code (`drift/stale-snippet`). `archdoc show <element> --code` and the new `archdoc_code` MCP tool print each snippet's text, so an agent reads the right lines before searching. In the explorer, every snippet links to its lines and shows them: `archdoc view` finds where each symbol's declaration is (core's `resolveSnippets`), and flags a snippet that no longer matches the code.
  
  `archdoc diff a.yaml b.yaml`, `archdoc report --base a.yaml`, and `archdoc view --base a.yaml` compare two model files without git. The PR report counts a changed relationship as touching the element it starts from, so its journeys are listed. `archdoc view` finds `<journey>.sample.json` files next to a model. A reference like `shop.orders` now resolves to that element even when the namespace is also `shop`.
  
  The examples are one flat folder: a quickstart, a modular monolith with components and snippets, an event-driven system, decisions, a big schema, and sensitive data. Three variants of the quickstart show changes to compare, and `examples/org/` (formerly `examples/acme/`) is the multi-repo demo.
- c942c74: A PR comment you can trust, and that tells a reviewer what to do.
  
  - `loadRevision` (analyzers) builds the model at any ref the way the working tree is built: schema sources, other repos' models pinned at that commit, and the repository's files. `report`, `diff`, MCP's `archdoc_diff`, and the explorer use it, so a field whose type comes from a schema no longer shows as changed on every pull request.
  - `check --base` checks the merge base too, and marks a finding introduced only when the base didn't have it. A one-line model edit is no longer blamed for warnings already on main.
  - `summarizeChange` (core) is one verdict on a change: blocking, attention, info, or none, with what blocks the merge and how to fix it, what to check, and who to involve. The PR comment and the explorer's Changes tab both render it.
  - The PR comment leads with that verdict, then blocking issues, a Before merging checklist, and a diagram of only what changed; journeys, consumers, data, drift, model changes, and findings already on the base fold. A change with no architectural impact gets one line.
  - Journey diagrams draw the steps after a decision as `alt / else` blocks with the decision's conditions.
  - A changed decision touches the element it runs in and the journeys, here and in other repos, that decide with it.
  - Bundles carry what the model's schema sources say (`schemas`), so a repo that imports another sees its field types.
  - `check --format github` prints workflow annotations; `report --explorer-url` links the change in the explorer; `archdoc site` writes the explorer as a static site, opened on a change with `--base`.
- b4d81ae: First v2 release. `@archdoc/spec` defines the v2 model format (actors, elements, journeys, data, namespaces) with a JSON Schema and v1 migration. `@archdoc/core` loads multi-file models with file-and-line diagnostics, resolves references, validates journeys, and answers element, actor, and overview queries. `@archdoc/cli` adds `archdoc validate`, `archdoc migrate`, and `archdoc schema`.
