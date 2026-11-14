# Evals for starting a model

How well ArchDoc starts a model for a repository that has none: the
`start-a-model` journey, where `archdoc init` infers a starting model and a
coding agent, following the archdoc skill, finishes it.

Each fixture in `fixtures/` is a small repository (`repo/`) and the model a
person would write for it (`golden.yaml`):

| Fixture | What it tests |
|---|---|
| `ts-monorepo` | A pnpm workspace: a React storefront, an Express API with five components, a shared library, Postgres and Redis in compose |
| `go-service` | One Go module with two binaries under `cmd/`, packages under `internal/`, Postgres migrations, NATS |
| `go-server-ui` | A Go server whose packages sit beside its `cmd/` binary, a CLI that borrows some of them, and a web UI that's a pnpm workspace under `web/ui` (an app, a legacy app, and an editor module): one container each, not one per package |
| `python-fastapi` | A FastAPI app in one package, split into api, services, models, and persistence |
| `polyglot` | A TypeScript frontend, a Go backend with components, a Python worker, RabbitMQ and Postgres |
| `single-package` | A TypeScript CLI that's one package, which the model has to split into components |
| `order-flows` | Services in TypeScript, Python, and Go that reach each other only over HTTP, RabbitMQ, and a Kubernetes CronJob, two externals, and tests, mocks, end-to-end tests, smoke checks, and a load test to leave out |
| `serverless-aws` | A bookings app on Lambda, deployed with the AWS CDK: DynamoDB tables, an SQS queue, an API Gateway REST API, a scheduled report, SES, and two stacks (production and staging) |
| `serverless-aws-tf` | The same app deployed with Terraform instead, for reading the tables, queue, functions, routes, and IAM grants from HCL |

Every golden model has actors and the journeys a newcomer would trace, each step with an action and code. The serverless golden models also have a system, what each step that crosses a boundary carries, what each datastore stores, and where each part runs.

## Scoring

`scoreModel(found, golden, files)` in `@archdoc/core` compares two models of
the same repository. Elements match by the files they cover (Jaccard overlap of
at least 0.5), not by their IDs, since an agent rarely names things the way a
person did; datastores, queues, and externals with no code match by name or
technology. It reports:

- **Containers, components, datastores**: precision and recall, by kind.
- **Uses**: recall at the golden model's resolution (a use between components
  the model doesn't have is missed), and precision with each end lifted to the
  nearest element both models have.
- **Nesting**: whether each matched element sits under the element its golden
  parent matched.
- **Code**: the share of source files mapped to the element the golden model
  maps them to, at whatever depth the scored model goes to.
- **Errors**: what `archdoc check` would report as errors.
- **Overall**: the mean of the F1s, nesting, and code accuracy that apply.

Code elements (`kind: code`) aren't scored on their own: the files they point at
count toward the component or container above them.

`scoreDiscovery(found, golden, files, score, { entryPoints })` scores how well the model was
discovered, beyond its structure, from the same checks `archdoc check --done`
runs:

- **Journeys found**: the share of the golden model's journeys that one of the
  model's journeys follows, for at least half of their hops between elements.
  Hops match at any depth, so a step on a container covers the golden step on
  its component.
- **Journey depth**: the share of the model's journeys with at least three steps
  that reach the datastore, queue, or external their elements use.
- **Step detail**: the share of steps with an action (or description) and code
  that exists (a reply to an actor needs no code).
- **Step depth**: the share of steps on the most specific element the model
  has, not a container whose components would lead to the code, and whose code
  is in one of the elements they name.
- **Tests left out**: the share of test and verification files (`isVerificationCode`)
  not modeled as elements of their own. A container whose glob covers its own
  tests is fine.
- **Mapped**: the share of source files, not tests and not vendored or
  generated, that some element covers.
- **Connected** and **described**: the shares of the model's elements that
  something connects to, and that have a description of their own.
- **System**: whether the model has a system element, the box the C4 context draws.
- **Step data**: the share of steps that cross into another container, a
  datastore, a queue, or an external that say what they carry (`sends`,
  `creates`, or `changes`).
- **Store data**: the share of datastores that say what they store, and of
  queues something sends through.
- **Data fields**: the share of data entries that say what's in them, with
  fields or a schema source to read them from.
- **Journey flow**: the share of journey steps after the first that start
  where the flow already is: at an element an earlier step reached, an actor,
  or an external.
- **Deployed**: the share of containers, datastores, and queues an environment
  places, when the repository has deployment files (CDK, Terraform, compose,
  Kubernetes, and the like).
- **Entry points**: the share of the routes, consumers, schedules, commands, and
  pages `archdoc paths` finds that a journey step starts at.
- **Uses shape**: the share of uses between elements that point the right way
  (a consumer uses the queue, not the queue its consumer), leave their own
  element's family (no parent using its own child), and aren't listed again to a
  part of the same target.
- **Code shape**: the share of elements whose code sits inside their parent's,
  isn't claimed by a sibling too (a `code: **` claims everything), isn't one
  helper file in a container of 30 or more, and isn't generated (protobuf stubs).
- **Deploy mapped**: the share of deployment files (Kubernetes, Helm, Terraform,
  compose, and the like) an environment or element points at, or at a file
  beside them, when the model has environments.
- **Data distinct**: the share of data entries that aren't a numbered copy of
  another (`CartItem2` beside `CartItem`).
- **Overall**: the mean of those that apply.

## Running them

**Init** runs with `pnpm test` (`packages/analyzers/test/evals.test.ts`):
`archdoc init` on each fixture, held to the scores it gets today. When init
finds more, raise the floors. It also checks that init models no test code and
that each golden model's journeys score as found, with detailed steps.

**Agent** calls a model, so it costs money and runs by hand:

```sh
pnpm build
pnpm eval:agent                       # every fixture, once (ts-monorepo and go-service twice)
pnpm eval:agent ts-monorepo --runs 3  # one fixture, three times
pnpm eval:agent --model <model> --parallel 4
```

Each fixture runs once by default: most score within a point or two from run
to run. The two that move more (ts-monorepo and go-service, `NOISY` in
`scripts/eval-agent.mjs`) run twice. `--runs` sets the count for every fixture.

It copies each fixture to a scratch directory, runs Claude Code headless
(`claude -p`) there with the skill, the MCP server, and the CLI from this
checkout, and scores the `.archdoc/` it writes, next to what init alone
scores. The agent may use the file tools, the archdoc tools, and Bash for
`archdoc`, `git status`, `git diff`, and `ls`, and nothing else; Claude Code
still lets read-only shell commands such as `cat` and `grep` through. Results go to
`evals/results/<time>/` (ignored by git): `report.md`, `results.json`, and
each run's model, transcript, and `score.txt` with what it missed. The report
also has each agent's wall time, turns, Bash calls, and how many of those ran a
script it wrote to explore the repository (a heredoc, `python -c`, `node -e`),
which init and `archdoc paths` should make unnecessary. Reports
worth keeping go in `evals/reports/<date>/`.

## Real-world repositories

The fixtures are small and written for the evals. `real-world/` holds open-source
repositories from well-known owners, each pinned to a commit, to check that a
model of a real system is one an engineer new to it can read and use:

| Repository | Pinned at | What it tests |
|---|---|---|
| `prometheus` | prometheus/prometheus v3.15.1 | A large Go codebase (about 1,700 files) with well-known subsystems and a TypeScript UI |
| `online-boutique` | GoogleCloudPlatform/microservices-demo v0.10.7 | Eleven gRPC services in five languages, Redis, and Kubernetes, Helm, Kustomize, and Terraform in one repository |
| `eshop` | dotnet/eShop 913acea | A .NET Aspire app: APIs, workers, web apps, RabbitMQ, Postgres, Redis. No C# analyzer, so the skill carries it |
| `gson` | google/gson 2.15.0 | A Java library: modules and components, no services or datastores |
| `stripe-accept-a-payment` | stripe-samples/accept-a-payment 1a57c3b | Four integrations, each a client and a server in up to ten interchangeable languages, and Stripe as an external |
| `spring-petclinic` | spring-projects/spring-petclinic 500158f | A Spring Boot app built with both Maven and Gradle: one container, its Java packages as components, and MySQL or PostgreSQL |
| `nextjs-commerce` | vercel/commerce f7521d5 | A Next.js App Router app at the repository root with no package name, and Shopify as an external over GraphQL |
| `djangoproject` | django/djangoproject.com 7bab0e0 | A Django project of a dozen apps, two PostgreSQL databases, Redis, and Stripe |
| `axum` | tokio-rs/axum 3ebdbe6 | A Rust Cargo workspace of four crates and about sixty example crates |

Each has `repo.yaml` (URL, commit, and the run's turn and dollar caps),
`reference.yaml` (the containers, components, datastores, and uses any
maintainer would agree on, not a full model, and for Online Boutique the
checkout and add-to-cart journeys), and `questions.yaml` (what a
newcomer asks, with the files that answer it). The repositories aren't
committed: `pnpm eval:agent --set real-world` clones each once into
`evals/.cache/repos/` and gives the agent the pinned commit's files without
their history.

`pnpm eval:init` runs `archdoc init` alone on each of them and holds it to the
`initFloor` in its `repo.yaml`, the way `pnpm test` holds init to its floors on
the fixtures. It calls no model, so it costs nothing but the first clone: run it
after changing init or the analyzers, and raise a floor when init finds more
(`--print-floor` prints what init scores now, in the floor's shape).

The agent runs are scored two ways:

- **Against the reference**, with `scoreModel`, for recall: containers,
  components, datastores, and uses the reference has, plus nesting and code.
  Precision means little against a partial reference, so a model that goes
  further isn't marked down.
- **By Claude as judge** (`scripts/eval-judge.mjs`), for whether the model is
  well decomposed and easy to digest. The judge reads the model, the
  repository's tree and docs, and the reference, and scores fidelity,
  granularity, coverage, relationships, infrastructure, descriptions, and
  journeys from 1 to 5 against written anchors, one pass by default
  (`--judge-passes 3` keeps the median of three). It
  also runs the onboarding test: it answers each question with one element of
  the model, and it's a hit when that element covers a file with the answer.
  The judge model is fixed (`JUDGE_MODEL`) so scores compare across releases.

The judge's verdicts are cached in `evals/.cache/judge/`, keyed by everything
it's sent (the judge model, system prompt, schema, and prompt with the model
text) and the number of passes. Init's model for a pinned commit is the same
from run to run, so it's judged once per analyzer change instead of on every
run; any change to the rubric, the prompt, or the model judged misses the cache.
`--no-judge-cache` judges again. The report says what judging spent, init's
models included, and how many verdicts came from the cache. A model over
100,000 characters is sent without its code elements, then cut, so one huge
model can't run up the bill.

One pass is enough for comparing releases: in the 0.6.2 to 0.7.0 runs, the three
passes differed by at most one point on a dimension (two, once), and agreed on
every onboarding answer, while the same repository's digestibility moved up to
29 points between agent runs.

`pnpm eval:agent --judge` judges the fixtures too. Before trusting a change to
the rubric or the judge model, run `node scripts/eval-judge-calibrate.mjs`: on
every fixture the golden model should score above what init writes, and that
above a single container holding everything.

A real-world run costs more than a fixture run: about $1 to $6 for the agent,
capped by `maxBudgetUsd` in each `repo.yaml`, and about $0.15 to $0.30 a pass to judge.

## Planning a change

`plan/` measures whether an agent plans a change with a person the way
ArchDoc asks, one stage at a time. Each scenario in `plan/<name>/` is a
fixture and a stage (`stage:` in `scenario.yaml`), and each stage starts from
its own state, so it runs on its own:

- **start** (`start-order-confirmation`): the person has an idea and asks to
  plan it. Scored on whether the agent started one plan, drafting, through
  `archdoc_plan`, with a scope that reaches the part of the model the idea
  touches, opened the explorer, told the person to sketch it in the Plan tab,
  and left the sketch, the code, and the model alone, with no markdown plan.
- **answer** (`answer-order-confirmation`): the person drew on the map and
  sent it (`plan.yaml`, status `reviewing`, round 1): an intent in a box, a box
  of their own with what it's for, an intent between two boxes that leaves a
  choice open (how the email reaches the mailer without holding up checkout),
  and one on the storefront. Scored on the first answer: every intent answered
  (a suggestion for it, or a note on it), the clear ones carried out, a
  question with options on the open one rather than a pick, the person's box
  kept with its ID, at most one question, notes kept short, and waiting again.
  A scripted person then taps the first option and sends it, through the
  explorer's own edit path, and the second answer is scored on whether the
  agent picked it up and suggested what they chose. Minutes to each answer
  are reported; the person marks the plan ready to end the run.
- **carry** (`carry-out-order-confirmation`): the plan is agreed and ready,
  with no tasks. Scored on whether the agent wrote tasks (each with the
  changes it carries out and its files), built the code, changed the model
  through `archdoc edit` so it shows every planned change (ArchDoc's own drift
  check), marked the tasks through `archdoc_plan`, and left the plan done and
  `archdoc check` clean.

```sh
pnpm build
pnpm eval:plan                          # every scenario, once
pnpm eval:plan --stage carry            # one stage
node scripts/eval-plan.mjs answer-order-confirmation --runs 3
```

It runs Claude Code headless with the skill, the MCP server, and the CLI from
this checkout. Only the carry stage may edit files. An explorer the agent
starts opens no browser and is stopped when the run ends. The free half
(each scenario starts where its stage does: a plan to answer is the person's
alone, sent once and unread, and a plan to carry out is clean but for its
tasks) runs in `pnpm test` (`packages/analyzers/test/plan-evals.test.ts`), with
unit tests of the explorer's conversation logic (whose turn it is, each
intent with its answer, a box the person drew) in `apps/web/test/plans.test.ts`.

## The branch diff

The evals above measure modeling. `diff/` measures the other half of a
change: whether an agent can show a person what their branch changes in the
architecture, which the Diff tab (`archdoc view --base main`, served by
`/api/compare`) reads from the branch's code. Each scenario in `diff/<name>/`
starts from a fixture with its golden model committed on main, then commits a
code change on a branch named for the scenario:

| Scenario | Fixture | What the branch does |
|---|---|---|
| `move-payments` | `ts-monorepo` | Moves payments out of the API into a new workspace package, `@shop/billing`: a new container, a removed component, and the uses that move with them |
| `drop-config` | `single-package` | Drops the config file every rule read, and adds a rule: a removed component and the uses of it |

`scenario.yaml` names the fixture, the files the branch deletes, and what it
changed: the elements it added, changed, and removed, and the uses it added and
dropped, with `optional` for what's fine to mention or not. `branch/` holds the
files it adds or rewrites, at their paths in the fixture.

**The Diff tab** runs in `pnpm test` (`packages/analyzers/test/diff-evals.test.ts`):
what `codeChange` reads from each branch has to be what the scenario says.

**Agent** calls a model, so it costs money, about $0.10 to $0.20 for both
scenarios, and runs only when the change touches the branch diff:

```sh
pnpm build
pnpm eval:diff                        # every scenario, once
pnpm eval:diff --changed origin/main  # only if the change since main touches the diff
pnpm eval:diff --changed origin/main --check-only  # would it run, and why
pnpm eval:diff move-payments --runs 3
```

It asks Claude Code, headless, with the skill, the MCP server, and the CLI
from this checkout (`npx @archdoc/cli` runs it too), to show what the branch
changes compared with main, and to end with the change as JSON in the
model's IDs. It may read files, use the archdoc tools, and run `git status`,
`diff`, `log`, and `branch`, and edits nothing. The report scores that change
against the scenario (F1 over the elements and uses, an ID may leave out the
namespace), next to what the Diff tab scores, and says whether the agent
opened the explorer or wrote the site with `--base`, linked to `#diff`, and
read the change with `archdoc check --base`, `archdoc report`, `archdoc diff`,
or `git diff`. Results go to `evals/results/diff-<time>/`.

`--changed <ref>` runs it only when the change since the merge base with that
ref touches what the branch diff depends on (`DIFF_PATHS` in
`scripts/eval-diff-lib.mjs`): the differ and the code map, `codeChange`, the
compare API and the `view`, `site`, and `diff` commands, the Diff tab's
model, the eval itself, and, in the skills, only changed lines about the diff
(`--base`, `#diff`, diff, compare), since most skill edits are about modeling.
Otherwise it spends nothing. `--check-only` says whether it would run, and
stops. Like the other agent evals, it runs by hand with the `claude` CLI signed
in, not in CI.

## The everyday loop

The other agent evals start a model, plan a change, read a diff, or triage a
bug. `change/` checks the loop an agent runs on every task once the model
exists: ask `archdoc context`, change the code, change the model with
`archdoc edit`, `archdoc check` against main, and seal what it touched. Each
scenario starts from a fixture with its golden model sealed on main, and asks
the agent for a code change on a branch:

| Scenario | The change | What the model has to do |
|---|---|---|
| `move-payments` | Payments move into a new workspace package | Gain a container, lose a component, and move the use and the checkout journey's steps to it |
| `drop-cache` | Products stop being cached in Redis | Lose a datastore, the use of it, and a journey step |
| `order-emails` | Orders send a confirmation email | Gain a component, a use, and a journey step |

It's scored without a judge, so the same run always scores the same:

- **Model**: the share of the scenario's facts (elements, uses, and files
  present or absent) that hold after the run.
- **Clean**: `archdoc check` against main finds nothing the change introduced
  that's an error, drift (a stale path, an undeclared dependency), or a sealed
  fact whose code changed and wasn't sealed again.
- **The loop**, from the transcript: whether it asked `archdoc context` before
  changing code, and how many `archdoc edit`, hand edits and reads of
  `.archdoc/`, `check`, and `seal` calls it made.

```sh
pnpm build
pnpm eval:change                      # every scenario, once
pnpm eval:change drop-cache --runs 3
```

Each scenario also has a reference solution (`solution/` and the ops in
`scenario.yaml`): `pnpm test` (`packages/analyzers/test/change-evals.test.ts`)
checks that the starting repository checks clean and doesn't meet the scenario,
and that the solution meets all of it and checks clean, so a scenario never
asks for something the tools can't do. A run costs about $0.25 to $0.40 (at most
$1.50, set by `--max-budget-usd`). Results go to `evals/results/change-<time>/`; the
first run is in `reports/2026-11-14-change/`: every scenario at 100%, clean.

## Triage

`triage/` measures whether an agent, handed a bug report, finds the root cause
and records it as a Triage record the way the skill asks. Each scenario in
`triage/<name>/` seeds a bug in a fixture: `bug/` holds the files it rewrites,
and the repository is the fixture, its golden model as `.archdoc/`, and the bug
in one commit, so the history doesn't give it away. The report is written the
way a person would, in words, with the misleading lead a person would follow:

| Scenario | Fixture | The bug | Where it shows up |
|---|---|---|---|
| `shipped-email-missing` | `order-flows` | Fulfillment publishes the shipped event under the wrong routing key | The notifier, which logs nothing |
| `postings-never-settle` | `go-service` | Settle gives each update a 5ms deadline | The store's query: context deadline exceeded |
| `new-tickets-missing` | `polyglot` | Opening a ticket never saves it: a call that's missing | The worker, which updates no rows |

`scenario.yaml` has the `symptom` the agent is handed, and `expected`: the
elements the `cause` is in (and `coarse`, what they're part of), the file
(`code`), the `journeys` the record may open up, and the leads that aren't the
cause (`not-cause`). `gold.yaml` is the record a careful triage writes.

**Free** (`pnpm test`, `packages/analyzers/test/triage-evals.test.ts`): each
golden model loads, `gold.yaml` checks clean and scores full marks, a record
that blames the misleading lead and says it reproduced the bug fails, and
`archdoc triage start` places each report on a journey it shows up in.

**Agent** calls a model, so it costs money, about $0.20 to $0.50 a run, and
runs by hand with the `claude` CLI signed in:

```sh
pnpm build
pnpm eval:triage                          # every scenario, once
pnpm eval:triage shipped-email-missing --runs 3
node scripts/eval-triage.mjs --rescore evals/results/triage-<time>  # score again, for free
```

It asks Claude Code, headless, with the skill, the MCP server, and the CLI
from this checkout, to find the root cause and not fix it. It may read, write,
and edit files, use the archdoc tools, and run `git status`, `diff`, and
`log`, but can't run the code. `scoreRecord` in `scripts/eval-triage-lib.mjs`
scores the record it writes: whether its cause step is on an element the cause
is in (and as specific as the model goes) and points at the right file, opens
up a right journey, rules out the misleading leads rather than blaming them,
says nothing was reproduced, has hops the model declares, stopped at
`root-caused` without changing code, and checks clean. Results go to
`evals/results/triage-<time>/`, with each run's record, answer, and transcript.

## Adding a fixture

1. Add `fixtures/<name>/repo/` with a few files per element and real imports
   between them, so the uses are in the code.
2. Write `fixtures/<name>/golden.yaml` the way you'd want the model to be, with
   its actors and two or three journeys, each step with an action and code.
   Code paths are relative to `repo/`.
3. Add its floor to `packages/analyzers/test/evals.test.ts` from what init
   scores (`pnpm test evals` prints it when it fails).
