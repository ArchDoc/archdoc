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
| `python-fastapi` | A FastAPI app in one package, split into api, services, models, and persistence |
| `polyglot` | A TypeScript frontend, a Go backend with components, a Python worker, RabbitMQ and Postgres |
| `single-package` | A TypeScript CLI that's one package, which the model has to split into components |

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
count toward the component or container above them. Descriptions, actors,
journeys, and data aren't scored yet.

## Running them

**Init** runs with `pnpm test` (`packages/analyzers/test/evals.test.ts`):
`archdoc init` on each fixture, held to the scores it gets today. When init
finds more, raise the floors.

**Agent** calls a model, so it costs money and runs by hand:

```sh
pnpm build
pnpm eval:agent                       # every fixture, 3 runs each
pnpm eval:agent ts-monorepo --runs 1  # one fixture, once
pnpm eval:agent --model <model> --parallel 4
```

It copies each fixture to a scratch directory, runs Claude Code headless
(`claude -p`) there with the skill, the MCP server, and the CLI from this
checkout, and scores the `.archdoc/` it writes, next to what init alone
scores. The agent may use the file tools, the archdoc tools, and Bash for
`archdoc`, `git status`, `git diff`, and `ls`, and nothing else. Results go to
`evals/results/<time>/` (ignored by git): `report.md`, `results.json`, and
each run's model, transcript, and `score.txt` with what it missed.

## Adding a fixture

1. Add `fixtures/<name>/repo/` with a few files per element and real imports
   between them, so the uses are in the code.
2. Write `fixtures/<name>/golden.yaml` the way you'd want the model to be. Code
   paths are relative to `repo/`.
3. Add its floor to `packages/analyzers/test/evals.test.ts` from what init
   scores (`pnpm test evals` prints it when it fails).
