# ArchDoc

**Architecture your AI agents can read, and your PRs can't quietly break.**

ArchDoc keeps a model of your system's architecture next to its code. Your coding agent reads it before it edits, so it knows where a change belongs and what it affects, and every pull request is checked against it, so a change that breaks a rule or sends personal data somewhere new doesn't merge unnoticed. You stay in the driver's seat. It's open source and AI-first. It analyzes the current state of a system, proposes future-state changes, and maps architectural concepts to code. Developers of any experience level can use it to explore and learn the system they're building.

> **Status: v2 is under active development.** The v0 viewer (`@archdoc/archdoc-ui`) is frozen at [`v0.2.0`](https://github.com/ArchDoc/archdoc/releases/tag/v0.2.0) on the [`legacy/v0`](https://github.com/ArchDoc/archdoc/tree/legacy/v0) branch. The plan for v2 is in [`docs/revival/`](./docs/revival/README.md).

## Install

In Claude Code, install the plugin. It brings the skill and the MCP tools, pinned to a released CLI:

```
/plugin marketplace add ArchDoc/archdoc
/plugin install archdoc@archdoc
```

Then open a repository and ask your agent to start an architecture model (or, where there's one, just start a task). For Cursor, Codex, and other agents, see [`integrations/agent-skills`](./integrations/agent-skills). The CLI runs anywhere with Node 22.12+:

```bash
npx -y @archdoc/cli init     # start a model in this repository
npx -y @archdoc/cli view     # open it in the explorer
```

For pull requests, add the [GitHub Action](./integrations/github-action).

## Why

- AI agents change code faster than people can follow the architecture.
- Architecture docs drift away from the code and stop being trusted.
- Generated repo wikis describe the code, but nobody owns them.

## What

A **human-owned model** lives in each repo, in `.archdoc/` next to the code. It describes four things:

| Section | Answers |
|---|---|
| **Actors** | *Who* uses the system: people, roles, teams, partner orgs, and AI agents |
| **Elements** | *What* the system is made of: systems, containers, components, and datastores, each mapped to code paths |
| **Journeys** | *How* an actor reaches a goal, step by step across elements, checked against real relationships |
| **Data** | *With what*: what is sent and stored, how fields map between tables, and the logic that runs on request data |

A **deterministic engine** (`@archdoc/core`) answers every question about the model. It contains no LLM, so the same question gets the same answer in the IDE, the browser, and CI. Your own coding agent does the reasoning.

People and agents reach the engine through the surface that fits the moment:

- **AI agents, before editing:** an MCP server and agent skill. *Where am I? What depends on this? Which rules and journeys apply?*
- **Reviewers, before merging:** a PR comment that leads with a verdict: what blocks the merge and how to fix it, what to check, and who to involve. It stays quiet when the architecture didn't change.
- **Everyone, anytime:** the explorer, which starts from what people do: journeys as stories, a map one level at a time, data and its lineage, and click-through to code.
- **Enterprises, across teams** (experimental): the landscape, which composes every repo's model into one view.

## A taste of the model

```yaml
# .archdoc/archdoc.yaml
archdoc: "2.0"
namespace: rides
name: Rides Platform

actors:
  passenger:
    kind: person
    description: Books and pays for rides from the mobile app.
    uses:
      mobile-app: Requests rides, pays, rates drivers

elements:
  mobile-app:
    kind: container
    technology: React Native
    code: [{ path: apps/mobile/** }]
    uses:
      api-gateway: Calls all backend APIs
  api-gateway:
    kind: container
    code: [{ path: services/gateway/** }]

journeys:
  book-a-ride:
    actor: passenger
    goal: Get a ride to a destination
    importance: critical
    steps:
      - { from: passenger, to: mobile-app, action: Enters destination and confirms }
      - { from: mobile-app, to: api-gateway, action: POST /trips }
```

ArchDoc's own model is in [`.archdoc/`](./.archdoc). A model can live in one file, or be split across `.archdoc/` however the team likes: `actors.yaml`, `model/*.yaml`, `journeys/*.yaml`, `rules.yaml`.

## Try it

The quickest way to see everything is the playground: one command sets up the demo org in [`examples/org`](./examples/org) (four repos, released and synced, with a branch ready for each scenario) in `.playground/`:

```bash
pnpm install && pnpm playground --open      # builds if needed, then opens the whole org in the explorer
```

`.playground/PLAYGROUND.md` ([what it sets up](./examples/org/README.md#playground)) lists what to try: field lineage across repos, and what a pull request would be told when it sends personal data to a third party, breaks an API another repo uses, loosens a decision, or renames a classified column. Run it again for a fresh copy.

For single systems, [`examples/`](./examples) has one model per part of the platform. They are a quickstart, a modular monolith taken apart into components with code snippets, an event-driven system, a 24-table schema, and sensitive data. Each is one file you can open with `archdoc view examples/quickstart.yaml`. Three variants of the quickstart show what a change looks like to a reviewer, compared straight from the files: `archdoc diff examples/quickstart.yaml examples/quickstart.add-reviews.yaml`. [examples/README.md](./examples/README.md) says what each one shows.

To work on ArchDoc itself, run the CLI from a clone, on ArchDoc's own model:

```bash
pnpm install && pnpm build
pnpm archdoc view --watch --open            # explore ArchDoc's own model in your browser
pnpm archdoc view --detach --watch --open   # the same, in the background: prints the URL and returns
pnpm archdoc validate                       # check it
pnpm archdoc context pr report shows type undefined for data fields   # where to start a task
pnpm archdoc context packages/cli/src/commands   # where these files belong, and what changing them affects
pnpm archdoc context --error error.log      # which journey step an error showed up in, and a trace to start
pnpm archdoc show toolchain.cli             # one thing by ID: element, actor, journey, data, trace, fact
pnpm archdoc show report-false-data-changes # a bug, hop by hop, with its evidence
pnpm archdoc check                          # what's wrong or stale: drift, rules, Triage records, sealed facts
pnpm archdoc check --base main              # what your branch does: the PR comment's verdict, and its fixes
pnpm archdoc check --base main --format github   # findings as annotations on the diff in CI
pnpm archdoc check --seals                  # which model facts' code changed since they were sealed
pnpm archdoc seal toolchain.cli --by agent:me   # record that you checked them
pnpm archdoc map                            # how the repo's files map onto the model
pnpm archdoc diff main                      # what changed in the model since main
pnpm archdoc report --base main             # the PR comment, as markdown
pnpm archdoc site --base main --out site     # the explorer as a static site, opened on your branch's change
pnpm archdoc eval --min-recall 0.5          # how well context points at what recent commits changed
pnpm archdoc init /path/to/another/repo     # start a model for a repository that has none
pnpm archdoc validate examples/quickstart.yaml               # a single-file model
pnpm archdoc migrate packages/spec/test/fixtures/v1/blog.yaml  # convert a v0/v1 model to v2
pnpm archdoc schema -o archdoc.schema.json  # JSON Schema for editor validation, also at https://cdn.jsdelivr.net/npm/@archdoc/spec@0/schema/archdoc.v2.schema.json
```

`view` opens the explorer on an overview: what the system is, its journeys as cards (most important first, each with the path it takes and how many steps, repos, and decisions it has), and who owns what, beside a map of the top level. Hover a journey to light up its path on the map; click it to read it as a story on the Journeys tab: a lane per participant, a numbered arrow per step with the data it sends, and after a decision, a block per outcome with its condition. The panel beside it shows one step at a time: what it does, between whom and through which contract, the message's fields with their values, the records it writes, and its code. A journey opens on the system map, one step at a time, with what each step does on the line it takes; switch to Sequence for the lanes (the explorer remembers which you picked). A step that doesn't follow a use is drawn straight across between its boxes, in red, with the error in the step's panel. On the map, a box's shape and color say what it is (actors are pills, datastores have a lid, what lives in another repo is dashed; people, AI agents, automated systems that call in, systems, containers, components, datastores, and externals each have a color, named on the box and in the map's key), and every use says what it's for on its line, with room kept for it so rows of boxes sit far enough apart to see which way each arrow points (turn descriptions off from the map's key and layout box for a tighter map). The map starts at the C4 context: each system as one box, with the people who use it and the external systems it talks to (a model without a system element is drawn as one box named after it). Pick Containers above the map to open every system; open a container, or focus on it, for its components. Pick LR or TD in the same box to lay it out left to right (the default) or top down. Click one to see what it uses, who uses it, and which journeys pass through it, and open it to see what's inside, one level at a time. With `--watch`, the explorer updates as you save model files, and shows any problems at the top. The explorer has two top-level tabs: Explore (Overview, Journeys, Data, and Infrastructure) for the system as the model describes it, and Build (Plan, Triage, and Diff) for work on a change. Build's Diff tab compares the model on two branches, or a branch and your working tree, with the number of changes on the tab. It leads with the same verdict as the PR comment, then what blocks the merge and what to check, each with how to fix it, who to ask before merging, the journeys affected (other repos' too), elements and uses, data (including sensitive data that goes somewhere new), and facts an agent suggested. Click one to go to it. On the map, new and changed boxes and uses are marked, removed ones appear as ghosts, and suggested facts are dotted. Pick the branches at the top; `--base main` picks the base to start with, and the address keeps the tab and what's open (`#journeys=request-refund`, `#diff=main...feature`; older `#changes` links still work), so a link opens the same view. Designing a change gets a tab of its own, Plan, and bugs get Triage (both below). A branch is read from git the way the working tree is read from disk: with what its schema sources say, the other repos its lockfile pins, and code links to the files at its commit.

`validate` checks the schema, every reference, and every journey step against the declared relationships. It reports problems as `file:line:column` and exits nonzero on errors, so it works as a CI gate.

`show` prints the details of any element, actor, journey, data entry, trace, or sealed fact by ID; `show Entry.field` follows a field's lineage. An element's `code:` can point at whole paths and at snippets: a line range (`{ path: app/checkout.rb, lines: 40-88 }`) or a declaration (`{ path: app/checkout.rb, symbol: Checkout::PlaceOrder.call }`), each with what it's for. That lets a component inside a container say where its logic lives, even when the container is one deployable app. `show <element> --code` prints each snippet's text, the explorer links each one to its lines (finding where a symbol is declared), and `check` warns when a snippet no longer matches the code. `context` is where an agent starts a task: give it the task in words, the files it plans to change, or both, and it returns a short brief: the files and functions to open first (ranked from file names, exported symbols, tool names, the owning element, and the journey steps that name a file), other code that does the same job (other callers of the functions those files use from another element), the data and rules involved, the narrowest journeys (those whose steps name the files; the rest as a count), the tests to run, owners, and who uses it (other repos too). A path that doesn't exist yet says where a new file would belong; `--error` places an error instead (below); with nothing, it prints an overview. It reads an index of the code's exported symbols and named imports that the analyzers build for TypeScript and JavaScript, Python, and Go. `eval` measures it: it replays the last 50 commits, asks `context` with each subject, and reports how many of the source files each changed the brief named in Start here or under the elements it involved (recall), next to word search alone, using the model and code as they are now. `--min-recall` fails CI below a threshold. `map` shows how much of the repository the model covers, which files no element claims, and which code paths no longer match anything.

## Keep the model honest

`archdoc check` compares the model with the code. Analyzers read workspace manifests and the imports of TypeScript and JavaScript, Python, and Go files, and `check` reports dependencies between elements that the model doesn't declare, relationships that break the rules in `.archdoc/rules.yaml`, broken journeys, code paths that match nothing, elements nothing connects to, and layers out of place: a component outside a container, or code (`kind: code`) outside a component. With `--base main`, it checks the merge base the same way, marks what your change introduced (what the base didn't have), and fails only on that, so it works as a CI gate from day one.

### Seals: know which facts to re-check when code changes

A model drifts quietly: code moves, names change, a decision's threshold changes, a schema grows a field, and nobody remembers which parts of the model described them. Seals catch that. `archdoc seal --all` records a fingerprint of the code each model fact points at in `.archdoc/archdoc.sum` (commit it, like a lockfile). From then on, `archdoc check` says which facts' code changed since someone last checked them, and what changed:

| Fact | Fingerprint | Breaks when |
|---|---|---|
| An element's `code:` paths | the files it owns and the names they export | a file is added or removed, an export is renamed or added; not when a function body changes |
| A snippet (`symbol:` or `lines:`), a decision's or a mapping's `code:` | the exact lines, without comments and whitespace | the lines change |
| A journey step's `code:` | its entry file's exports | the entry point is renamed or gone |
| A data entry's `source:` | the schema's fields and types | a field is added, removed, or retyped |
| A contract (`provides: api: proto/charges.proto`) | the spec file | the spec changes |

The agent that changed the code (or you) reads what changed, updates the model where it no longer describes the code, and runs `archdoc seal <fact> --by agent:<name>`, or `archdoc seal <element-id>` for all of an element's facts. `archdoc seal` without facts seals only new facts and keeps changed ones flagged. With `--base`, only the facts a pull request touched count, and the PR comment lists them under "To check", then which facts the change sealed again and who did. Seals are opt-in: nothing happens until a repository has an `archdoc.sum`. In the explorer, the overview lists the facts to re-check, a box on the map whose facts changed carries a "re-check" mark, and its panel says what changed and which `archdoc seal` to run. In the playground, `payments` is sealed; its `try/cancel-refund` branch adds an RPC under a sealed contract.

`archdoc diff` shows what changed in the model itself, by element, use, actor, journey, data entry, and decision rather than by line. Both sides are read the same way, with what their schema sources say. `diff`, `report --base`, and `view --base` also take another model file in place of a git ref, to compare two versions side by side.

## Data: what's sent and stored

Boxes and arrows say *that* two things talk. Data says *what* they exchange and *where* it lands. Data entries are records (`entity`), requests and responses (`message`), and `event`s, with fields, a `classification` on sensitive ones, and an optional lifecycle:

```yaml
data:
  Charge:
    kind: entity
    fields:
      card_last4: { type: string, classification: pci }
      status: { type: enum, values: [authorized, captured, refunded] }
    states:
      - authorized -> captured -> refunded
elements:
  ledger:
    kind: datastore
    stores: { charges: { entity: Charge } }
  charges:
    kind: container
    provides:
      - { api: proto/charges.proto, accepts: RefundRequest, returns: Refund }
    uses:
      ledger: { description: Records charges, sends: Charge }
```

Fields don't have to be retyped. Point an entry at the schema it comes from, and keep only what the schema can't say, such as classifications:

```yaml
data:
  Charge:
    kind: entity
    source: { prisma: prisma/schema.prisma#Charge }
    fields:
      card_last4: { classification: pci }
```

`archdoc check` reads sources with schema importers: SQL migrations (`sql: migrations#charges`, replayed in order), Prisma, OpenAPI and JSON Schema (`openapi: openapi/trips.yaml#Trip`), and Protobuf (`proto: proto/charges.proto#RefundRequest`). It reports schema drift: a modeled field the schema no longer has (an error when it's classified, because a renamed column loses its classification), fields the schema has that the model doesn't, and types or enum values that differ.

A field can point at another entry's field, like a foreign key: `charge_id: { references: Charge.id }`, or `references: Charge` for its key. A field whose `type` names another entry points at it too, and SQL and Prisma sources fill `references` in from their foreign keys and relations. `validate` reports references that don't resolve.

A message is the same idea however it travels; how it travels is a detail on the arrow. Contracts and relationships can say their `transport` (`http`, `grpc`, `kafka`, `sqs`, `eventbridge`, or anything else). Pub-sub is a topic or event the publisher `provides`, which subscribers `use`, rather than a broker box every service points at. The explorer draws a subscription from the publisher to the subscriber, labelled with its channel and transport, and messages flow that way, even on a journey step written from the subscriber's side. Relationships `send` data, contracts `accept`, `return`, or `carry` it, datastores `store` it, and journey steps say what they `send`, `create`, and `change` (`Charge.status: captured -> refunded`). Every arrow on a journey carries a message. A step can say it (`sends:`); otherwise it carries what the relationship it travels along sends, what the API it calls accepts (or, for a lookup, returns), or what it writes through a mapping or creates and changes. `validate` warns about a step none of these name, and `archdoc show <journey>` prints each step's message and where it comes from. A step that's a request and its response says what comes back with `returns:` (or the API it calls says what it returns), and the explorer plays it to the callee and back. Messages move along their arrows at one speed, whatever the arrow's length. Each step is one interaction: a step from one service to another that also writes into a datastore neither of them is gets a warning, asking for storing it to be a step of its own (`order-service → erp-db`), and the explorer plays such a step as two arrows until it's split. Data in another repo is referenced by namespace, like elements (`payments.Charge`). `validate` reports data that isn't defined, fields that don't exist, values outside an enum, state changes the lifecycle doesn't allow, and data sent to an element that doesn't accept it. Rules can say where classified data may be stored and where it may never go:

```yaml
rules:
  - id: pci-stays-in-payments
    data: { classification: pci, stored-in: { namespace: payments } }
  - id: no-pii-to-external
    data: { classification: pii, not-sent-to: { kind: external } }
```

Mappings say how one record becomes another, field by field, as [CEL](https://cel.dev) expressions; logic blocks say how an element decides on the data it receives. Journey steps name the decision they take and what each outcome does:

```yaml
logic:
  refund-approval:
    runs-in: charges.refunds
    input: { request: RefundRequest, charge: Charge }
    rules:
      - when: "request.reason == 'safety'"
        then: escalate-to-safety
      - when: "request.amount_cents <= charge.amount_cents / 2"
        then: auto-approve
      - else: needs-finance-approval
mappings:
  refund-to-ledger:
    from: { refund: Refund }
    to: ledger.ledger_entries
    fields:
      account: "'charge:' + refund.charge_id"
      amount_cents: -refund.amount_cents
journeys:
  refund:
    steps:
      - from: api-gateway
        to: charges
        sends: RefundRequest
        decides: refund-approval
        branches:
          auto-approve: { changes: { Charge.status: captured -> partially_refunded } }
      - { from: charges, to: ledger, via: refund-to-ledger, when: auto-approve }
```

`archdoc show Refund.amount_cents` (and `archdoc_show` for agents) lists every place a value is copied or derived, across repos, and the tables it lands in. Running a journey on a sample (simulation) is experimental: core keeps it, but the CLI, MCP tools, and explorer don't run journeys for now. `validate` checks that mappings and logic read fields that exist, parse, and cover every case, and that journeys only take branches their logic can decide.

The explorer's Data tab lists every data entry, from this repo and the ones it imports, with sensitive fields marked. Its page starts with where the data lives: each datastore and queue with its tables, their keys, the entry each holds, and who writes and uses it, then what travels between the parts. Pick an entry for its own page: its schema (each field's type, key, classification, and the entry it points to), where it's stored, who makes and gets it, the journey steps that send or write it (each opens the journey there), and the entries related to it. Show it as Map to see it on the same map as the system: pick a message and the arrows it travels along light up and flow; pick an entity and the datastore that stores it opens into its tables, with a line for each foreign key (or open any datastore's tables from its box). Click a field, in a table or the details panel, and its lineage lights up: the field in every table on the way, and the arrows its value travels, while the panel lists each mapping expression. On the Journeys tab, each step shows the record it sends from one element to another (or, where a step stores what it wrote, the records it writes): its fields, nested objects included, with sensitive fields marked. On the map, each step's message travels along its arrow, while the datastores it writes to open into their tables and show the row each step adds or the fields it changes; any of them can switch between its schema (ERD) and its rows: each record the journey's steps declare they create or change, linked to the rows it points at. Tables show their names and how many fields they have until you open one, so a big schema reads at a glance; a field's lineage opens the tables it goes through. During a journey, the tables it doesn't write or read fold into one box, and in Rows only the rows it creates, changes, or reads stay, with the rows they point at; click a folded table to bring it back, or tick "All tables". Rows are ordered to keep the lines between them from crossing. Agents get the same answers from `archdoc_show`.

The pull request report lists the data entries a change touches, the mappings and decisions it changes (with the expressions before and after), and calls out sensitive data that goes somewhere new, external services first.

## Where it runs

Elements say what the system is made of; environments say where it runs. Each environment (production, staging, a developer's machine) holds its infrastructure as nodes inside nodes, such as a cloud region, a cluster, a namespace, or a managed service, each with its `kind`, `technology`, and the `code` that defines it (Terraform, Helm, Kubernetes manifests, compose files). Each container, datastore, and queue says where it's deployed with `deploy`: a node's path, a list of them, or a node with what's true of it there.

```yaml
environments:
  production:
    nodes:
      aws:
        kind: region
        technology: AWS us-east-1
        nodes:
          eks: { kind: cluster, technology: EKS 1.30, code: infra/terraform/eks.tf }
          rds: { kind: managed, technology: Amazon RDS }
  local:
    nodes:
      compose: { kind: host, code: docker-compose.yaml }

elements:
  api:
    kind: container
    deploy:
      - { to: production.aws.eks, replicas: 3-12, technology: Helm chart, url: "https://api.example.com" }
      - local.compose
  db:
    kind: datastore
    deploy: [production.aws.rds, local.compose]
```

The explorer's Infrastructure tab draws one environment at a time: its nodes as boxes inside boxes, each container on the node it runs on, the uses between them lifted from their components and labelled with how they travel, and what they talk to outside the environment (actors, externals, and elements that run elsewhere) around it. The sidebar picks the environment, lists its nodes as a tree, and names the containers that don't say they run there. `archdoc show production.aws.eks` lists a node's infrastructure and what runs on it, and `archdoc show api` says where an element runs (a component runs where its container does). `validate` fails on a `deploy` that names no environment or node, and once a model has environments, warns about a container that doesn't say where it's deployed. `check` warns about deployment code that matches no file, and with seals, a change to a node's or a deployment's code flags it for a re-check. [examples/deployment.yaml](./examples/deployment.yaml) shows a shop on a CDN, a cluster, and managed services, with staging and local alongside.

## Plan a change

Instead of asking your agent for an implementation plan and skimming a long markdown file, design the change with it on the map. Tell your agent the idea, and it runs `archdoc plan start` (or the `archdoc_plan` MCP tool), which writes `.archdoc/plans/<id>.yaml` and opens the explorer's Build → Plan tab. You don't fill in forms or draw the architecture: you say what you want, and your agent works out how.

- Click in a box on the map where something should change, at any level (the system, a container, a component, an actor), and a small window opens where you clicked: say what you want there in your own words, and press Enter. That's an **intent**, pinned in the box as a numbered pin.
- Click a pin to read or change it, see what carries it out, or remove it. Add as many as you like, and pin notes to any of it.

When you press **Send to agent**, your agent reads your intents (`archdoc plan wait`), works out the architecture for each one against the code, and answers on the map: the elements, arrows, data, and flows that carry it out, drawn dashed as suggestions you accept or dismiss, each saying which intent it's for, plus insights, questions, and risks pinned to what they're about. It never changes your intents. The map draws the model as it would be with the plan made, new parts marked as added and changed ones as changed, so you see the change in place. `archdoc check` checks every open plan: intents nothing carries out yet, parts without intent, changes the model can't take (removing an element a journey still goes through), what the plan would break (a step along no arrow), and what it reaches (journeys, actors, owners, other repos), with critical journeys called out. Go back and forth until nothing is open, then **Mark ready**: your agent writes the tasks that carry it out, each with the changes it makes, its files, and its tests, and works through them, editing the model as each lands. While it does, `archdoc check` says which planned changes the model doesn't show yet. A plan is never part of the model, and a published site shows plans read-only.

## Triage a bug

A journey walks through how the system works; a **Triage record** walks through how one bug happened, down to its root cause. Hand your agent a bug (an issue, a log, a stack trace, wrong output) and it runs `archdoc triage start` (or the `archdoc_triage` MCP tool): that reads the error's stack frames, paths, and the names it mentions, maps them to elements, ranks the journey steps it most likely showed up in, and writes `.archdoc/triage/<id>.yaml` for the agent to fill in as it follows the code:

- the report: `title`, `symptom` as given, `reported: { by, at, link }`, `severity`, and how to `reproduce` it;
- where it showed up: the journey step it opens up (`expands: review-ai-change#5`);
- the leads it followed, `hypotheses`, each `confirmed` or `ruled-out` with how that's known;
- the bug's journey: each hop the failing request took in journey step syntax, with a `description` of what happened there in the failing run and the data it carried (`sends`), which one is the `cause`, how each claim is known (`evidence: reproduced | read | inferred`), the values `observed` and `expected` on that data's fields, and any call that's `missing`;
- the `root-cause`, the `fix` (with its PR and test), and a `status`: `open`, `investigating`, `root-caused`, `fixed`, `wont-fix`, or `cannot-reproduce`.

Records are never part of the model. `archdoc check` checks every record against the model and the code: elements and the journey step exist, `code:` references (`path:line`) still match, hops the model doesn't declare (drift found while debugging), and what the status needs (a cause and a root cause once it's root-caused, a fix once it's fixed). `archdoc triage list` lists them, open ones first; `archdoc show <id>` prints one; `archdoc context` names the open ones on what a task touches; and the PR comment says which bug a change fixes. [`.archdoc/triage/report-false-data-changes.yaml`](./.archdoc/triage/report-false-data-changes.yaml) is a real one, and the demo org has one for a refund bug. Traces from before 0.8 (`.archdoc/traces/`) aren't read since 0.9: `archdoc triage migrate` moves them to Triage records.

The explorer's Build → Triage tab lists the records by status, open work first. A record reads like a journey: a short header with the root cause in brief and the fix (the report you gave the agent and how to reproduce it a click away), then the bug's journey, on the map of the system one step at a time (the cause in red, where it spreads in amber, a hop the model doesn't declare drawn straight across) or as lanes beneath the journey step it opens up, with calls that are missing dashed and, in green, where the same job is done right. Pick a step to see what happened there, the data it carried with the fields that went wrong, its code, what was observed and expected, and how it's known. **Start a triage** at the top of the list takes a pasted error and places it in the browser, with the journey steps it likely showed up in, the elements it names, and the records already there; **Send to agent** writes the record and hands it over, with what you want (find the root cause, fix it, or your own words). A record's header sends it again, say to fix it once it's root-caused. Your agent picks it up with `archdoc triage wait` (or `archdoc_triage` with `wait: true`), the same way it waits for a plan. A published site, which can't write, gives the prompt to copy instead. Old `#traces=` links open the record on the Triage tab.

## Across repos (experimental)

A repo can import other teams' models and refer to their elements by namespace (`payments.charges`); `archdoc sync` pins them in `archdoc.lock`, and a landscape repo composes every team's model into one view. It works, but it's experimental and left out of `--help` for now: see [docs/experimental.md](./docs/experimental.md#sharing-models-across-repos).

## Review pull requests

The [GitHub Action](./integrations/github-action) comments on every pull request with a verdict a reviewer can act on in seconds: what blocks the merge and how to fix it (rules the change breaks, imports the model doesn't declare, consumers in other repos it breaks), what to check (sensitive data going somewhere new, a changed decision, new warnings), and a Before merging checklist of who to involve: owners approve, other repos' teams know, critical journeys still work. Then a diagram of only what changed, and a link to the change in the explorer if you host the site `archdoc site --base` writes. The journeys (as sequence diagrams, with their branches), consumers, data, drift, model changes, and findings already on the base fold below. When a pull request doesn't change the architecture, the Action stays quiet. Introduced findings also show on their lines in Files changed, and the check can fail on them. `archdoc report --base main` (or `archdoc_check` with a base and `format: "markdown"`) writes the same comment, ready to paste into a PR description.

## Use it with your coding agent

`archdoc mcp` starts an MCP server with one tool per question an agent asks, each answering the way the CLI command of the same name does:

| Tool | Question |
|---|---|
| `archdoc_context` | Where do I start, and what does it affect? From a task in words, the files to change, or an error |
| `archdoc_show` | What is this one thing? An element (with its code), actor, journey, data entry, `Entry.field` (lineage), trace, or sealed fact |
| `archdoc_find` | Which parts of the model are these? By words, place, the file they own, or what they still lack; or the element tree |
| `archdoc_edit` | Change the model by ID: add, set, remove, rename (references follow), use, and step, writing only the lines that change |
| `archdoc_check` | What's wrong or stale, and with a base, what does my change do? The PR comment's verdict, each finding with its fix |
| `archdoc_seal` | I checked these facts against their code. Says what's left |
| `archdoc_triage` | I've been handed a bug: where does it start? Starts a Triage record to fill in, or waits for one sent from the explorer |
| `archdoc_plan` | Design a change with the person: start a plan, wait for what they want on the map, work out the architecture as suggestions, and carry out its tasks |
| `archdoc_init` | There's no model yet: start one, every fact marked inferred |

A task is `context`, edit, `check`, `seal`: three or four calls. The agent changes `.archdoc/` by ID with `archdoc_edit`, which marks what it adds `provenance: { source: suggested }`, writes only the lines it changes, and refuses an edit that doesn't validate; `check` catches the rest, such as drift from the code. Only `edit`, `seal`, `triage`, `plan`, and `init` write.

### Start a model

`archdoc init` (or `archdoc_init`) writes `.archdoc/` for a repository that has none, from what the repository declares: a container per package or module its manifests name (`package.json`, `go.mod` with one per `cmd/` binary, `Cargo.toml`, `pyproject.toml`, Maven and Gradle) or per code directory none claims, GitHub Actions included; inside each big container, a component per code directory (never one per file: files beside the directories, and a flat package's files, stay with the container); datastores and queues from compose images, with `depends_on` as uses; uses from imports at every level, between containers and between the components of one container; and data entries, the datastore that stores them, and contracts from Prisma, SQL migrations, OpenAPI, and protobuf files. It's deterministic, marks every fact `provenance: { source: inferred }` so reviewers see it as unaccepted, never writes over a model, and never seals. On ArchDoc itself it finds all 10 containers and 13 of the 19 uses between them. What it can't know (what each part is for, which functions a newcomer opens first, who uses the system, and how) it leaves to you or your agent, and says so.

The [Claude Code plugin](./integrations/claude-plugin) (see [Install](#install)) and [`integrations/agent-skills`](./integrations/agent-skills), for other agents, teach the workflows: a change (context, edit code and model, check, seal), a bug (context on the error, then a Triage record), a change to design (a plan: you say what you want on the map, the agent works out the architecture), and a repository with no model yet (init, then describe it, add actors and journeys, and check). This repository uses them itself (`.mcp.json`, `.claude/skills/archdoc`, `AGENTS.md`).

## Roadmap

ArchDoc is built in phases. Each phase ends with an exit test, not a date. The full roadmap is in [`docs/revival/04-roadmap.md`](./docs/revival/04-roadmap.md).

| Phase | Delivers |
|---|---|
| 0 · Reset | pnpm monorepo, Node 22/24 CI, this README |
| 1 · Model core + explorer | Spec v2, `archdoc validate`, `archdoc view`, ArchDoc modeling itself |
| 2 · Code mapping + MCP | `locate` and `impact` for agents, before they edit |
| 3 · Diff, drift, PR loop | Semantic diff, TypeScript import analysis, a verdict-first PR comment, a before/after view, agents proposing model changes, context briefs and eval, bug traces |
| 4 · Federation | Models published across repos, a landscape repo, cross-repo impact |
| 5 · Data | Entities, storage, field lineage, and logic (simulation is experimental) |
| 6 · Bootstrap + interop | Draft models from code, LikeC4/Structurizr importers |
| 7 · Learning | Tours, team onboarding pages, a static site |
| 8 · Reach | VS Code, OpenTelemetry checks, community spec process |

## Repository layout

```
packages/
  spec/   @archdoc/spec   v2 schema (Zod), TypeScript types, JSON Schema, v1 migration
  core/   @archdoc/core   load, validate, and query models (no LLM)
  cli/    @archdoc/cli    the `archdoc` command, including the `view` server
  mcp/    @archdoc/mcp    MCP server for coding agents
  analyzers/ @archdoc/analyzers  find the dependencies code actually has (manifests; TS/JS, Python, and Go imports)
  federation/ @archdoc/federation  share models across repos: sync, archdoc.lock, publish
apps/
  web/    @archdoc/web    the explorer (React, React Flow, ELK), served by `archdoc view`
integrations/
  claude-plugin/          the Claude Code plugin: the skill, and MCP pinned to the CLI (marketplace in .claude-plugin/)
  agent-skills/           AGENTS.md snippet and MCP configs for other agents
  landscape-template/     starting point for a landscape repo, with a sync-and-publish workflow
  github-action/          the pull request impact comment and drift gate
examples/                 one model per part of the platform, the quickstart's change variants, and org/, a demo org
docs/revival/             the relaunch plan: assessment, strategy, architecture, roadmap
.archdoc/                 ArchDoc's own model
```

## Development

You need Node 22.12+ (or 24) and pnpm 10 (`corepack enable` sets it up).

```bash
pnpm install
pnpm lint        # Biome
pnpm typecheck   # tsc -b, which also builds every package
pnpm test        # Vitest
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for how to propose changes.

## License

[MIT](./LICENSE)
