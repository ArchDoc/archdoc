# @archdoc/core

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
  - @archdoc/spec@0.9.0

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
  - @archdoc/spec@0.8.1

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
  - @archdoc/spec@0.8.0

## 0.7.2

### Patch Changes

- d5019df: The Diff proposes a new package beside the only package already there, not inside it (`packages/billing` next to `packages/shared` is a new container), and shows the use from code that imports it. `archdoc view --help` says `--base` opens on the Diff, read from the code since the branch left that ref.
- 0efcd77: Discovery maps the whole repository, names actors in plain words, and keeps code elements to the few functions a newcomer opens first, listed in the explorer rather than drawn.
  
  - **No code element per file.** `archdoc init` no longer writes a `kind: code` element for each file (or each of a flat file's functions). Which functions a newcomer opens first takes reading the code, so the agent adds 1 to 5 per component at their symbols. `archdoc check --done` flags a part with more than five code elements (`done/level-too-wide`, which flagged only more than ten in a component before).
  - **Code elements aren't boxes on the map.** The explorer doesn't draw code elements. A component lists them in its details panel under Key code, each with its description and links to its lines. A use or journey step that names a code element is drawn from its component, and opening a journey through one opens the map only down to that component.
  - **Actors in plain words.** `done/actor-name` asks for a `name:` in plain words (`name: Dashboard User`) for an actor whose ID is kebab-case or snake_case and has no name. Kebab-case is for names in the code and infrastructure. The explorer shows an actor without a name as its ID in plain words (`dashboard-user` reads "Dashboard User").
  - **Map all of it.** The skill, AGENTS.md, and `archdoc check --done` say to keep going however big the repository, without stopping after init or partway through to summarize, hand over part of the model, or ask whether to go on.
- @archdoc/spec@0.7.2

## 0.7.1

### Patch Changes

- 90059fe: Discovery keeps every part inside the system, names parts the way the code does, and points code at the lines that do the work.
  
  - **Inside the system.** `archdoc check --done` asks for every container, component, datastore, and queue outside the system element to move inside it (`done/outside-system`, which named only datastores and queues before), so the explorer's Context view shows the system as one box instead of looking like the Container view. `archdoc edit` puts a container, datastore, or queue added with no parent inside the model's one system, and says so. The discovery score's System part is now the share of parts inside the system, not only whether there is one.
  - **Names from the code.** `done/code-name` names a container or component whose ID matches none of the names its code goes by (`auth.identity → auth` for `src/auth/**`), and asks for a `name:` in plain words (`name: Local Migration Scripts`) when its code goes by several names. Generic directories (`src/`, `internal/`, `cmd/`) don't count as names.
  - **Code a reader can audit.** `done/whole-file-code` names code elements that point at a whole file, `done/no-key-code` components (and containers without components) with no code element at a function, class, or lines, and `done/step-whole-file` journey steps whose code names a whole source file rather than `file#function` or `file:40-88`. An element's `code:` takes the same shorthand as a step's: `path#symbol`, `path:40`, and `path:40-88` read as `{ path, symbol }` and `{ path, lines }`.
  - `scoreDiscovery` scores three new parts, code names, code precision, and key code, and the agent eval reports them.
  
  The skill and AGENTS.md say the same: keep init's system with everything but externals inside it (with a skeleton for a hand-written `archdoc.yaml`), name each part after its directory, package, or module with the domain's words in the description, add 1 to 5 code elements per component at the functions a newcomer opens first, and give each journey step the function where it happens.
- Updated dependencies [90059fe]
  - @archdoc/spec@0.7.1

## 0.7.0

### Minor Changes

- cc5f29e: The explorer's branch diff now reads the change from code, not from the other branch's model. Branch 1 (the working tree by default) is compared with branch 2 (main by default): the files changed since their merge base are analyzed at both ends and read into branch 1's model as elements whose code changed, was added, or was removed, uses the code added or dropped, proposed elements for new code no element maps, and new entry points, each marked with whether the model already says it. New in core: `deriveCodeChange` and `projectCodeChange`; in analyzers: `codeChange`. `archdoc view --base` and `archdoc site --base` take a branch only; compare two model files with `archdoc diff`.
- e038693: `archdoc check --done` flags a model's shape, not only what it's missing, so an agent fixes what a reader trips over before handing the model over: a queue or datastore that uses its own consumers, an element that uses its own parent or child, the same call listed to an element and to a part inside it, a child whose code isn't inside its parent's, siblings whose `code:` claims the same files (a `code: **`), a one-file helper component in a big container, generated code (protobuf and gRPC stubs) modeled as a part, deployment files no environment maps, datastores and queues outside the system, and numbered copies of data entries (`CartItem2`). `scoreDiscovery` scores them as four new parts: uses shape, code shape, deploy mapped, and data distinct. `genproto/` and `__generated__/` directories count as generated code.
- 5f9749f: Agents find and change the model by ID, instead of reading `.archdoc/` and editing its YAML by hand. Two new MCP tools, each with a CLI command of the same name:
  
  - `archdoc_find` (`archdoc find`) lists parts of the model by words, by place (`under` an element), by the file they own (`path`, the owner first), by `type` and `kind`, or by what they still lack (`missing`: a description, code, uses, a deploy, fields, or a journey), each with its ID, code, uses, and where it's written. `outline: true` (`--outline`) shows the element tree with each element's code and uses.
  - `archdoc_edit` (`archdoc edit`) takes a list of ops by ID and runs them in order: `add` (an element inside the parent its ID names, with the kind of the level below, an actor, a data entry, a journey in its own file, an environment, or a deployment node), `set` (a JSON merge patch), `remove` (an element with what's inside it and the uses of it), `rename` (renames or moves, and rewrites every reference: uses, journey steps, sends, stores, owners), `use`, and `step` (append, insert, merge, or remove a journey step). It writes only the lines each op touches, so comments and formatting stay; writes all ops or none, refusing an edit that would add errors to the model; and answers with what each op did, the findings it fixed, new warnings, and code paths that match no file. `by` marks what it adds `provenance: { source: suggested }`.
  
  The skill and AGENTS.md tell agents to model a repository with them, a step of work per call.
  
  `archdoc seal` points a journey step's fact at its file when the step's `code` names a function (`orders/src/checkout.ts#placeOrder`), as the skill asks; before, it matched no file.

### Patch Changes

- 0f86d2d: `archdoc edit` takes the shorter shapes agents write: `stores` as a list or `{ Order: "what it keeps" }`, `uses` as a list on a new element, a data entry without `kind` (entity), an `add` without `type`, and `data:Order`-style IDs. An edit refused for its shape now says the shapes the schema wants. The skill says to change the model only with `archdoc_edit` once it exists, and the agent eval counts find, edit, and hand edits of `.archdoc/`.
- @archdoc/spec@0.7.0

## 0.6.3

### Patch Changes

- 91e12de: Journeys go from one element to the next. A new warning, `journey/disconnected-step`, flags a step that starts at an element no earlier step reached (an actor, or an external system acting on its own, may start a step any time), and the skill tells agents to read the code between two elements rather than jump. In the explorer, a step that doesn't follow a use is drawn straight across between its boxes, in red, instead of looping around the map, and its panel shows the error; a step's note shows on one line when a use and a subscription join the same boxes.
  
  Actors have a new kind, `system`, for software that calls in on its own: another service, a scheduler or CronJob, a CI job, a webhook sender. `agent` is for AI agents. `archdoc init` makes the scheduler it finds in Terraform and CDK a `system`, `archdoc check --done` asks about an `agent` whose description doesn't say it's an AI, and the explorer colors and names each kind.
  
  `archdoc check --done` asks for the fields of every data entry that has neither fields nor a schema `source:` (`done/data-fields`), and the skill tells agents where to find each one's definition. The discovery score counts data entries with fields and journey steps that start where the flow already is.
  
  Infrastructure sits in one logical place: `deploy/loose-placement` warns when an element is deployed to an environment or node that has nodes inside it (`dev` beside `dev.aws.lambda`), and `deploy/split-node` when one service has two nodes in an environment (`dev.lambda` and `dev.aws.lambda`).
  
  The explorer's Data tab opens on where the data lives: each datastore and queue with its tables, keys, the entry each holds, and who writes and uses it, then what travels between the parts. Each entry has a page with its schema, where it's stored, who makes and gets it, the journey steps that send or write it, and related entries; Map shows it on the system map as before. The map's key and its layout direction are one box, "Key and layout".
  
  `archdoc init` keeps one app in one container: a workspace below the top of the repository (a Go server's `web/ui` with its app and modules) is one container with its packages as components, and a Go module's binary named after the module (`cmd/prometheus` in `github.com/prometheus/prometheus`) is one container with the module's packages. The skill says the same for when init can't tell.
- Updated dependencies [91e12de]
  - @archdoc/spec@0.6.3

## 0.6.2

### Patch Changes

- 043e5a5: `archdoc paths` stays readable in a big repository. With more than 60 entry points it answers with a summary: the entry points by place (the container they're in, or their package before there's a model), with counts by kind and routes grouped by resource, each line usually one journey. `entry` takes a place, a resource, or both (`"apps/api /orders"`) to list them, and one label to show its calls. `--hops` (`hops: true`) folds calls that stay inside one element, so a tree shows only the calls between elements. Call trees now follow handlers written as one-line arrows, such as `(req) => save(req)`. Init's brief uses the same summary.
  
  `archdoc check --done` isn't done while `archdoc check` has a warning the code can answer: it counts and lists them with the errors, and sets aside the ones only a person settles (owners, seals, other repositories' models, the team's rules). It also asks for components in a big container and none in a small one, and for a description of each data entry. A new warning, `data/long-name`, flags a data entry whose name is too long for the chip the explorer draws on a step, and the explorer cuts a long name to fit, with the whole name as its tooltip.
  
  `archdoc init` keeps a container with fewer than five source files lean, with no components. A dry run says plainly that it wrote nothing. The skill turns "figure out the architecture" into a model written to `.archdoc/`, works through every warning before it hands the model over, keeps big containers' components when it reshapes init's model, and names data entries with short nouns and a description.
- @archdoc/spec@0.6.2

## 0.6.1

### Patch Changes

- f6855fe: `archdoc init` reads the AWS CDK and Terraform. It models the DynamoDB tables (with what each stores, keyed the way the table is), SQS queues, SNS topics, and the AWS services the code calls (such as SES), adds the uses the IAM grants and SDK calls show, places each function, table, and queue in an environment per CDK stack or Terraform workspace, and adds a scheduler actor for scheduled jobs. Every element now sits inside a system, so the explorer's Context view shows one box. Init writes actors and environments to files of their own, and tells the agent which docs and deployment files to read first and where flows start.
  
  New: `archdoc paths` (and the `archdoc_paths` MCP tool) lists where flows start (API routes, queue consumers, schedules, CLI commands, and pages, from the code and from CDK and Terraform) and the calls each one makes, down to the datastores, queues, and services it touches, in TypeScript, Python, and Go. The agent uses it to trace journeys instead of writing scripts to explore the repository.
  
  `archdoc check --done` asks for more before a model is done: a system element, a journey per main flow (and for most routes, consumers, and schedules), what each step that crosses into another container, a datastore, a queue, or an external carries, what each datastore stores, and an environment for every container, datastore, and queue when the repository has deployment files. The skill asks for the same.
- @archdoc/spec@0.6.1

## 0.6.0

### Minor Changes

- eef9e90: Better system discovery for a new model. `archdoc check --done` (`archdoc_check` with `done: true`) says whether a model is done and what it still lacks, each with what to do: levels over the limits, elements with no description of their own, test and verification code modeled as elements, elements nothing connects to, missing actors, too few or too short journeys, and steps without an action or code, or on a container where a component would lead to the code. `archdoc init` leaves out tests, test packages, mocks, fixtures, benchmarks, smoke checks, and test-runner config. The archdoc skill has the agent find how each unconnected element is reached at runtime, list the entry points, trace the main flows through the code as journeys with a step per hop, and run the done check before it hands the model over. `scoreDiscovery` scores the same things for the evals.
- f668b61: Model where the system runs, and see it in the explorer. A new `environments:` section holds each environment (production, staging, local) and its infrastructure as nodes inside nodes (cloud, region, cluster, namespace, managed service), each with `kind`, `technology`, and the `code` that defines it. Containers, datastores, and queues say where they run with `deploy`: a node's path such as `production.aws.eks`, a list of them, or `{ to, replicas, url, technology, code }`. The explorer's new Infrastructure tab draws one environment at a time, with each container on its node and the uses between them, and nodes colored by what they are (cloud and network, compute, managed service, client) with a key; `archdoc show` prints an environment or a node with what runs on it, and where an element is deployed. `validate` fails on a `deploy` that names nothing and warns about containers that don't say where they run once a model has environments; `check` warns about deployment code that matches no file, and seals flag a node's or deployment's code when it changes.

### Patch Changes

- Updated dependencies [f668b61]
  - @archdoc/spec@0.6.0

## 0.5.1

### Patch Changes

- @archdoc/spec@0.5.1

## 0.5.0

### Minor Changes

- 11662c5: `archdoc init` sweeps every layer: containers, the components inside each container (its code directories, or in a flat package its files), and the code inside each component (its files, or a file's functions and classes), with uses from imports declared at the level where the two sides part. The model format gains `kind: code` for that layer, and `archdoc check` warns about a component outside a container (`model/component-outside-container`) and code outside a component (`model/code-outside-component`). Code needs no relationships of its own, so it isn't reported as an orphan.
- c59e030: Add `scoreModel` and `formatScore`, which score a model against a golden one for the same repository: containers, components, datastores, uses, nesting, and code placement, with elements matched by the files they cover. The new evals for `archdoc init` and the agent that finishes its model use them.

### Patch Changes

- Updated dependencies [11662c5]
  - @archdoc/spec@0.5.0

## 0.4.1

### Patch Changes

- 6df5f40: A model that describes no data yet no longer gets a warning per journey step that doesn't say what it sends: there's nothing it could send. It gets one info note instead, which `validate` prints and the explorer, `check`, and the PR comment leave out. Before, every new model opened in `archdoc view` on a list of these warnings. Once the model has `data:` entries, each such step is a warning again.
- @archdoc/spec@0.4.1

## 0.4.0

### Minor Changes

- 02d583c: `context` names the data rules that apply to the brief's data, with the fields they apply to, such as `no-personal-data-out — Shoppers' personal data stays in the shop. (applies to Order.email (pii))`. Before, a brief listed only rules that name its elements, so an agent about to send personal data somewhere wasn't told the rule it would break.
- c672281: `context` names journeys in other repos' models that pass through the elements a task touches (`journeysElsewhere` in the brief, and a line per journey under Journeys).
- 5b72266: `check` and `init` leave out build tooling: devDependencies in a manifest, and imports in a tool's config file (`eslint.config.js`, `tailwind.config.ts`, `vite.config.ts`). On a Turborepo monorepo, `init` went from 47 uses, most of them every package using its lint and tsconfig packages, to the 14 between its apps and packages. A runtime import of the same package still counts. Core exports `isDevTooling`.
  
  The warning for an element nothing connects to says to connect it only with a use the code shows, or remove it, and the skill tells agents never to add a use to quiet a warning, and that describing what `init` wrote is the work. In first runs, agents had invented uses to clear these warnings.
- 8f5359b: The model format is split into stable and experimental parts. `imports`, `landscape`, `domains`, rules with `scope: org`, `mappings`, `logic`, and journey steps' `decides` and `branches` are experimental: their JSON Schema descriptions start "Experimental", and `archdoc validate` (and its `--json`) names the ones a model uses in a note that doesn't fail `--strict`. Core's `experimentalUses(model)` lists them. The JSON Schema is at https://cdn.jsdelivr.net/npm/@archdoc/spec@0/schema/archdoc.v2.schema.json for editors.

### Patch Changes

- b434769: Python and Go analysis. `check` finds imports between elements the model doesn't declare in Python and Go code, the way it does for TS/JS: Python imports resolve through project roots (`src/`, each `pyproject.toml`), packages, and relative imports; Go imports through every `go.mod`, with `replace` lines and `go.work`. The code index covers both, so `context` ranks their files and functions and seals fingerprint their exports. `init` adds uses from those imports, splits a flat Go module or Python project by its packages, skips a `pyproject.toml` that only declares a workspace, and claims a top-level `scripts/`, `tools/`, or `bin/` folder as one element. Core counts `_test.go`, `test_*.py`, and `*_test.py` as tests.
- b9fdff6: `check --base`, `report`, and the explorer's branch compare no longer fail with "Can't read <file>" when a change renames a file without changing it. Changed files now list a renamed file under both names, so the base reads the old one from git.
- 9c1bee7: The PR report still lists facts an agent suggested, but they no longer earn a comment on their own: with nothing else to check, the verdict is `info` (job summary only). Replaying this repo's merged PRs, they were the only item on most comments.
- Updated dependencies [8f5359b]
  - @archdoc/spec@0.4.0

## 0.3.0

### Minor Changes

- Moves to 0.3.0. Skips 0.2.x, whose git tags (v0.1.2 to v0.2.0) belong to the v0 viewer. From now on, all six @archdoc packages share one version.

## 0.1.1

### Patch Changes

- a0022a8: Packages are built from clean before they're released, so they no longer ship leftover files from removed sources (0.1.0's CLI included an unused `dist/commands/data.js`). Each package now publishes as public by default.
- Updated dependencies [a0022a8]
  - @archdoc/spec@0.1.1

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
- a87a18f: Cross-repo impact. A repo can import the landscape with `landscape:` in `archdoc.yaml`; `archdoc sync` reads it at its release tag with every model it vendors (checked against its lock), so one fetch brings every repo's model. `impact`, `show`, and the MCP tools then list consumers and journeys in other repos, and `show payments.charges` works for elements in other repos. The pull request report lists consumers in other repos, marks the ones a change breaks (an element they use is removed, or a contract they use `via`) or deprecates, adds their journeys and actors with sequence diagrams, and draws them in the change diagram. Model diffs name the contracts that changed. The spec adds `landscape:`, `lock.landscape`, and `includes` on bundles.
- a5810d6: Data, part one. Data entries (`entity`, `message`, `event`) have fields with a `classification`, enum `values`, and lifecycle `states`. Datastores map tables to entries with `stores`, relationships `send` data, contracts `accept`, `return`, or `carry` it, and journey steps say what they `send`, `create`, and `change`. Data in other repos is referenced by namespace and checked once synced. `validate` reports undefined data, unknown fields, values outside an enum, state changes the lifecycle doesn't allow, and data sent to an element that doesn't accept it. A new rule kind, `data: { classification, stored-in | not-sent-to }`, runs in `check` (and as an org rule from the landscape). Rule selectors can now name elements in other repos (`payments.charges`) and match `{ namespace }`. The PR report gains a Data section: entries that changed, and sensitive data a change sends or stores somewhere new, with external elements called out. `archdoc show` and `search` cover data entries, and `archdoc landscape build` composes every repo's data. `@archdoc/core` exports `resolveData`, `dataFlows`, `dataStores`, `checkData`, `evaluateDataRules`, and `sensitiveDataChanges`.
- 56bcc26: Data on the system canvas. A data field can point at another entry's field with `references: Charge.id` (or `Charge`, for its key); a field whose type names another entry points at it too, and SQL migrations and Prisma schemas fill references in from their foreign keys and relations. `validate` reports references that don't resolve, and the landscape keeps them pointing at the right entries. In the explorer, picking a message lights up the arrows it travels along and animates them; picking an entity opens the datastore that stores it into its tables, with a line for each foreign key, and any datastore's tables open from its card. A field's lineage now lights up on the same canvas, in every table and along every arrow on the way, instead of replacing it with a separate graph. `archdoc view` reads schema sources, so the explorer shows the types and foreign keys `check` sees.
- 59c4690: During a journey, a datastore it writes to switches between its schema (ERD) and its rows, from the datastore's card or the journey bar. Rows are the ones the sample starts with plus every record the journey creates or changes up to the current step, as a small table per table with a line per record, each line linked to the rows its foreign keys name; the current step's rows light up and the camera follows them. A sample can give a list of rows for an entry (the first is the one logic and mappings read), and a sample named after the journey (`samples/<journey>.json`) runs when the journey opens. A datastore with many tables shows compact tables (keys, foreign keys, and sensitive fields), and selecting one lights up the tables it's linked to. A mapping that writes a record with a different key from the one there creates a new record instead of overwriting it, and a step's message narrows to the entries it writes.
- 5d62016: Diff, drift, and the pull request loop. `@archdoc/core` adds a semantic model diff (`diffModels`), models at any git ref (`loadModelAtRef`), `check` (undeclared dependencies, `deny` and `allow-only` rules, stale code paths, orphan elements), and the pull request impact report. The new `@archdoc/analyzers` package finds workspace manifest dependencies and TS/JS imports. The CLI adds `archdoc check [--base]`, `archdoc diff [range]`, and `archdoc report --base`. `@archdoc/mcp` drops an unused dependency on `@archdoc/spec`.
- 32d17a6: The explorer has Explore and Changes tabs. Changes compares the model on any two branches, or a branch and the working tree, and lists what breaks, the journeys affected, elements and arrows, data, and suggested facts, in that order; click one to go to it. `archdoc view` serves the branches at `/api/refs` and the model at two of them at `/api/compare`, and core adds `listBranches`. The change count no longer counts data entries that only the working tree's imported schemas filled in.
- c3db021: `archdoc view [--watch] [--port] [--open]` serves the new explorer: a hierarchy you can open and close, an actor focus that shows what an actor uses and owns, journeys you can step through, search, and a resizable details panel. With `--watch`, it reloads as model files change. `@archdoc/core` adds `readModelSources` and a browser-safe entry point, `@archdoc/core/browser`.
- 3f624eb: Share models across repos. `archdoc sync` reads each import's model at the newest release tag its range allows (with git, from GitHub or any git URL), vendors it in `.archdoc/vendor/`, and pins it in `.archdoc/archdoc.lock`; `--update` takes new releases and `--frozen` checks the lock in CI. `archdoc publish` writes a validated, versioned bundle for `url:` imports. `validate` and `check` now report references into other repos that don't exist at the pinned version, deprecated targets and contracts, `via` contracts the target doesn't provide, journey steps that start in another repo but don't follow its relationships, and version skew between imports. The spec adds `provides` (api, topic, event), `via` on relationships, `git:` imports with an optional `path`, and the bundle and lockfile formats. A journey step from a publisher to a subscriber now follows the message. The new `@archdoc/federation` package holds sync and publish; `check` treats lockfile and vendor changes as model changes.
- 7e4b25c: The explorer's Changes tab reads a branch the way it reads the working tree: with its imported schemas, the other repos its lockfile pins, its sample data, and code links to its commit, so a branch no longer shows warnings the working tree doesn't. Core adds `listFilesAtRef` and `readFileAtRef`, and `readFederationInput` takes a reader for files that aren't on disk. Journey steps can open the data they send from one element to another, or the records they write: every value, with sensitive fields marked, or as JSON to copy. Example data now includes the messages a step's arrow sends, not only what the step itself sends.
- 5ccd0d8: `journeyBranches(model, journeyId, alsoIn?)` reads a journey as plain steps and, after a decision, one block per outcome in the order of its rules, with each outcome's condition and whether the block ends the journey. Journey sequence diagrams and the explorer's Journeys tab both draw branches from it.
- b9b658d: Every arrow on a journey carries a message. A step without `sends:` carries what the relationship it travels along sends (between its boxes, their parents, or what's inside them, and in another repo's model for a step that starts there), what the API it calls accepts (or returns, for a lookup), or what it writes through a mapping or creates and changes. `validate` warns about a step none of these name (`journey/step-without-message`), once the repos it goes into are synced, and `archdoc show <journey>` and the `archdoc_journey` MCP tool print each step's message and where it comes from. In the explorer, the current step's message travels along its arrow; opening a journey opens the tables it writes to, and each step lights up the row it adds or the fields it changes, with their values when the journey is simulated. The details panel expands each step to its message's fields.
- 71b92f5: The landscape repo. `archdoc landscape build` composes the landscape's model with every model it imports into one (each repo a system named by its namespace, its elements inside, references and journeys connected across repos, repo copies of landscape teams merged), checks it (journeys across repos, owners that resolve to no actor are errors, the landscape's rules across repos), and writes the explorer and the composed model as a static site for GitHub Pages. `archdoc view --landscape` serves it live, and the explorer now uses relative URLs so it runs from any path. The spec adds `domains:` and `scope: org` on rules: in a repo that imports the landscape, owners resolve against the landscape's teams and its org rules run in `check`. `@archdoc/core` exports `composeLandscape`. `integrations/landscape-template` is a starting point for a landscape repo.
- 030b5ce: Mappings, logic, lineage, and simulation. `mappings:` say how records become other records, field by field, as CEL expressions over named inputs, written to an entry or a datastore table. `logic:` blocks are an element's decisions on the data it receives, as CEL rules (first match wins, then `else`). Journey steps `decide` with a logic block and say what each outcome's `branches` create, change, or continue as; later steps run `when` an outcome was decided, and write `via` a mapping. `validate` checks inputs, targets, and fields, that expressions parse, that rules end with `else`, and that branches, `when`, and `via` name something real, in this repo and in synced imports. `archdoc lineage <Entry.field>` follows a value through every mapping across repos to the tables it lands in. `archdoc simulate <journey> --sample <file>` runs a journey against sample records: the branch each decision takes and why, the records each step creates and changes, and where they're stored, deterministically. The PR report shows changed mappings and decisions with their expressions before and after. The landscape composes every repo's mappings and logic. CEL runs on `@marcbachmann/cel-js`.
- e6a2e96: Agents close the loop, and reviewers see the change. `@archdoc/mcp` adds `archdoc_check`, `archdoc_diff`, and `archdoc_propose`, its first write tool: it adds elements and relationships to the model as suggestions with a rationale note in `.archdoc/proposals/`, never changes or removes what's there, keeps the YAML's formatting, and writes nothing that wouldn't validate. `@archdoc/core` adds `propose`, `planProposal`, `insertIntoMap`, and `readModelSourcesAtRef`. `@archdoc/analyzers` adds `checkRepository`, shared by the CLI and MCP. `archdoc view --base <ref>` shows the explorer's before/after view: changed boxes and relationships, removed ones as ghosts, suggested facts dashed, and affected journeys flagged.
- 1e8fc9f: Seals: know which parts of the model to re-check when code changes.
  
  `archdoc seal` records a fingerprint of the code each model fact points at in `.archdoc/archdoc.sum`. An element's paths are fingerprinted by the files it owns and the names they export, so a new file or a renamed export breaks the seal and a function body doesn't. Snippets, decisions, mappings, and contracts are fingerprinted by their lines (without comments and whitespace), journey steps by their entry file's exports, and data entries by their schema's fields.
  
  `archdoc check` reports `seal/changed` (with what changed) and `seal/unsealed` when a repository has an `archdoc.sum`, and with `--base` only what the change caused, so the PR comment lists them under "To check". `archdoc verify` lists the facts to re-check, with what changed and where each fact is in the model, and exits 1 while there are any. `archdoc seal <fact|element-id> --by <who>` records that someone checked. Without facts, it seals only new facts and keeps changed ones flagged, and `--all` seals everything. The PR comment says which facts a change sealed again, and who did. MCP adds `archdoc_verify` and `archdoc_seal`, which writes only `archdoc.sum`.
  
  `archdoc view` shows the same facts: the overview lists what to re-check, a box whose facts changed carries a "re-check" mark on the map, and its panel says what changed and which `archdoc seal` to run. When a change touches no code the model maps, the PR comment says so instead of "Touches the model only".
- 423d593: Each journey step is one interaction. `validate` warns about a step that also writes into a datastore it doesn't go to (`journey/step-writes-elsewhere`), naming who should store it there as a step of its own, and `stepStores` in core says which datastores those are. The explorer plays such a step as two interactions, the message and then the storing ("2" and "2.1"), so the camera follows the message before the rows. The industry examples are written that way.
  
  In the explorer, tables show their name and field count until opened, and a field's lineage opens the tables it goes through. A journey without a sample named after it runs on example data made up from each field's name and type, with keys and the fields that name them agreeing, so rows show values rather than a mapping's expressions; the simulator offers "Example data" next to the repo's samples. The journey card leads with what the current step does, then who it goes between and what it carries, with a progress strip, and keeps the datastore controls and which data it runs on in a footer.
- 7e01863: The pull request report now leads with Mermaid diagrams, which GitHub renders in comments and PR descriptions: a flowchart of the change (elements and relationships added, changed, or removed, suggested facts dotted, unchanged neighbors in grey, parts drawn on their container) and a sequence diagram of each of the three most important affected journeys, with the affected steps highlighted and added and removed steps marked. `@archdoc/core` exports `changeDiagram` and `journeyDiagram`; `prReport` takes `diagrams` and `maxJourneyDiagrams`. `archdoc report` takes `--no-diagrams`.
- 6dee848: The pull request comment only asks for attention when there's something to fix or check. Touching code that a critical journey passes through is now `info`, so the Action's `comment: quiet` writes it to the job summary instead of commenting. "Before merging" asks owners to approve only when a change spans more than one team, and asks whether a critical journey still works only when the change edits its steps (which is also a new thing to check, `journey/critical-changed`). Each finding shows once: the folds skip what's already above, and To check skips what Before merging asks. An import that the model doesn't declare and a rule forbids is one finding, the rule's, whose fix is to remove the import. A contract's spec file counts as touching the element that provides it. Copy fixes: "The code behind … changed since it was sealed", `type string → none` for a field a schema no longer has, suggested facts as a list, and "Touches" lists six elements and a count.
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

### Patch Changes

- 565c92d: The CLI drops the commands that other commands replaced, since none of them was ever released: `search`, `locate`, and `impact` are `context <words or paths>`; `lineage` and `simulate` are `show <Entry.field>` and `show <journey> --sample <file>`; `verify` is `check --seals`; `trace anchor`, `trace check`, and `trace show` are `context --error`, `check`, and `show <trace>`. `eval` and `migrate` still work but leave `--help`. `context --error` now says `--format json` doesn't apply instead of printing text, and messages and the suggested trace no longer name the removed commands.
- 748bedf: A journey step a subscriber takes to a topic's publisher carries what the topic carries. Simulations keep a field declared `number` as a CEL double even when its value is whole, so `kwh * tariff` works for 300 kWh.
- 41786cd: Reading a model at a git ref works through symlinked paths, such as macOS's temporary directory. `archdoc sync` no longer fails with "No ArchDoc model at .archdoc" on macOS, and `diff`, `check`, and `report --base` work in a checkout reached through a symlink.
- Updated dependencies [88b968a]
- Updated dependencies [a87a18f]
- Updated dependencies [a5810d6]
- Updated dependencies [56bcc26]
- Updated dependencies [3f624eb]
- Updated dependencies [71b92f5]
- Updated dependencies [030b5ce]
- Updated dependencies [1e8fc9f]
- Updated dependencies [527f9fe]
- Updated dependencies [a970b49]
- Updated dependencies [c942c74]
- Updated dependencies [b4d81ae]
  - @archdoc/spec@0.1.0
