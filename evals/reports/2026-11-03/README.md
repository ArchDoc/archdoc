# Agent evals, 2026-11-03

First full run of `pnpm eval:agent` against a real model: every fixture, 3 runs
each, on `main` at 664b0b9 (after #56). Command:
`pnpm eval:agent --runs 3 --parallel 3`. Run in a Claude Code cloud session with
the default model; 15 runs took about 5 minutes and cost $3.45 in total.
`results.json` here is the script's output; the per-run models and transcripts
weren't committed.

Each cell is init → agent: what archdoc init alone scores, then the agent's
mean over its runs. Containers, components, datastores, and uses are F1;
nesting and code are the share right.

| Fixture | Overall | Containers | Components | Datastores | Uses | Nesting | Code | Range | Errors | Turns | Cost |
|---|---|---|---|---|---|---|---|---|---|---|---|
| go-service | 88% → **89%** | 100% → **100%** | 100% → **100%** | 100% → **100%** | 35% → **44%** | 100% → **100%** | 90% → **90%** | 87%–92% | 0 | 24 | $0.25 |
| polyglot | 87% → **87%** | 100% → **100%** | 60% → **60%** | 100% → **100%** | 71% → **71%** | 100% → **100%** | 92% → **92%** | 87%–87% | 0 | 22 | $0.22 |
| python-fastapi | 97% → **99%** | 100% → **100%** | 100% → **100%** | 100% → **100%** | 89% → **100%** | 100% → **100%** | 92% → **92%** | 99%–99% | 0 | 33 | $0.23 |
| single-package | 97% → **98%** | 100% → **100%** | 91% → **94%** | 100% → **100%** | 93% → **96%** | 100% → **100%** | 100% → **100%** | 97%–100% | 0 | 25 | $0.21 |
| ts-monorepo | 91% → **91%** | 100% → **100%** | 71% → **71%** | 100% → **100%** | 82% → **82%** | 100% → **100%** | 94% → **94%** | 91%–91% | 0 | 29 | $0.24 |

Overall, mean over fixtures: init 92% → agent 93%.

## What the runs show

- **The agent barely changes the structure init gives it.** It spends its turns
  on descriptions, actors, and journeys, which aren't scored yet, and leaves
  the elements and uses as init wrote them.
- **Extra components stay.** On polyglot and ts-monorepo the agent keeps the
  components init split out that the golden model doesn't have
  (`tickets-frontend.client`, `tickets-worker.triage`, `web.pages`,
  `shared.money`, ...), which holds components precision at 43–56%.
- **Uses stay on the container.** Uses that compose puts on a container
  (`api -> db`, `tickets -> rabbitmq`) aren't moved down to the component whose
  code makes them (`shop.api.storage -> shop.db`,
  `tickets.backend.publisher -> tickets.rabbitmq`).
- **Init has passed its floors.** python-fastapi scores 97% overall against a
  0.82 floor in `packages/analyzers/test/evals.test.ts`, and single-package 97%
  against 0.91; the floors can be raised.

## Caveat: the tool allowlist didn't hold

In every run the agent ran Bash commands outside `--allowedTools` (`cat`,
`python3`, `grep`, `git ls-files`, `cd`), and they ran. The nested `claude` in
this environment seems to inherit the session's permission settings, so
`--permission-mode dontAsk` with the allowlist didn't restrict it. These
commands only read files or edited `.archdoc/`, so they likely didn't change
the scores, but the run isn't the fenced setup `evals/README.md` describes.
