# ArchDoc agent evals

2026-11-04T22:52:30.432Z · 2 runs per fixture

Each cell is init → agent: what archdoc init alone scores, then the agent's mean over its runs. Containers, components, datastores, and uses are F1; nesting and code are the share right.

| Fixture | Overall | Containers | Components | Datastores | Uses | Nesting | Code | Range | Errors | Minutes | Turns | Bash | Scripts | Cost |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| go-service | 88% → **94%** | 100% → **100%** | 100% → **100%** | 100% → **100%** | 35% → **76%** | 100% → **100%** | 90% → **90%** | 94%–95% | 0 | 1.5 | 53 | 3 | 1 | $0.35 |
| order-flows | 90% → **97%** | 100% → **100%** | 100% → **100%** | 100% → **100%** | 42% → **87%** | 100% → **100%** | 97% → **97%** | 97%–97% | 0 | 1.9 | 59 | 4 | 2 | $0.43 |
| polyglot | 94% → **94%** | 100% → **100%** | 100% → **100%** | 100% → **100%** | 71% → **71%** | 100% → **100%** | 92% → **92%** | 94%–94% | 0 | 1.5 | 55 | 5 | 1 | $0.30 |
| python-fastapi | 97% → **99%** | 100% → **100%** | 100% → **100%** | 100% → **100%** | 89% → **100%** | 100% → **100%** | 92% → **92%** | 99%–99% | 0 | 0.9 | 31 | 4 | 1 | $0.17 |
| single-package | 97% → **97%** | 100% → **100%** | 91% → **91%** | – → **–** | 93% → **93%** | 100% → **100%** | 100% → **100%** | 97%–97% | 0 | 0.2 | 10 | 3 | 1 | $0.04 |
| ts-monorepo (0/2 scored) | 96% → **–** | 100% → **–** | 100% → **–** | 100% → **–** | 82% → **–** | 100% → **–** | 94% → **–** | – | – | 0.0 | 1 | 0 | 0 | $0.00 |

Minutes is the agent's wall time; turns, its turns; Bash, its Bash calls; scripts, the Bash calls that ran a program it wrote (a heredoc, python -c, node -e) to explore the repository, which init and archdoc paths should make unnecessary. Each is a mean over runs.

Overall, mean over fixtures: init 93% → agent 96%.

## Discovery

How well the model was discovered beyond its structure (scoreDiscovery in @archdoc/core), init → agent. Journeys found is the share of the golden model's journeys one of the model's journeys follows (half their hops or more; – when it has none); journeys is how many the model has, and journey depth the share of them long enough to follow that reach the datastore, queue, or external their elements use. Step detail is the share of steps with an action and code that exists; step depth, of steps on the most specific element. Tests left out is the share of test and verification files not modeled as elements of their own. Mapped is the share of source files (not tests, vendored, or generated) some element covers. Connected and described are shares of the model's elements. System is whether the model has a system element for the C4 context. Step data is the share of steps that cross into another container, datastore, queue, or external that say what they carry; store data, the share of datastores that say what they store and queues something sends through. Data fields is the share of data entries with fields or a schema source; journey flow, the share of steps after a journey's first that start where the flow already is. Deployed is the share of deployable elements an environment places (– when the repository has no deployment files). Entry points is the share of routes, consumers, schedules, commands, and pages a journey step starts at. Left to do is how many lines archdoc check --done still lists.

| Fixture | Discovery | Journeys found | Journeys | Journey depth | Step detail | Step depth | Tests left out | Mapped | Connected | Described | System | Step data | Store data | Data fields | Journey flow | Deployed | Entry points | Left to do |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| go-service | 54% → **100%** | 0% → **100%** | 0 → **2.5** | 0% → **100%** | 0% → **100%** | 0% → **100%** | 100% → **100%** | 100% → **100%** | 100% → **100%** | 0% → **100%** | 100% → **100%** | 100% → **94%** | 50% → **100%** | 100% → **100%** | 100% → **100%** | 60% → **100%** | 0% → **100%** | 7 → **0.5** |
| order-flows | 50% → **100%** | 0% → **100%** | 0 → **4.5** | 0% → **100%** | 0% → **100%** | 0% → **100%** | 100% → **100%** | 100% → **100%** | 64% → **100%** | 0% → **100%** | 100% → **100%** | 100% → **100%** | 0% → **100%** | 100% → **100%** | 100% → **100%** | 86% → **100%** | 0% → **100%** | 10 → **0** |
| polyglot | 54% → **98%** | 0% → **100%** | 0 → **1** | 0% → **100%** | 0% → **100%** | 0% → **100%** | 100% → **100%** | 100% → **100%** | 100% → **100%** | 13% → **100%** | 100% → **100%** | 100% → **100%** | 0% → **100%** | 100% → **100%** | 100% → **100%** | 100% → **100%** | 0% → **75%** | 5 → **1.5** |
| python-fastapi | 53% → **100%** | 0% → **100%** | 0 → **2** | 0% → **100%** | 0% → **100%** | 0% → **100%** | 100% → **100%** | 100% → **100%** | 100% → **100%** | 0% → **100%** | 100% → **100%** | 100% → **100%** | 0% → **100%** | 100% → **100%** | 100% → **100%** | 100% → **100%** | 0% → **100%** | 5 → **0** |
| single-package | 58% → **58%** | 0% → **0%** | 0 → **0** | 0% → **0%** | 0% → **0%** | 0% → **0%** | 100% → **100%** | 100% → **100%** | 100% → **100%** | 17% → **17%** | 100% → **100%** | 100% → **100%** | 100% → **100%** | 100% → **100%** | 100% → **100%** | – → **–** | 0% → **0%** | 4 → **4** |
| ts-monorepo | 54% → **–** | 0% → **–** | 0 → **–** | 0% → **–** | 0% → **–** | 0% → **–** | 100% → **–** | 100% → **–** | 100% → **–** | 30% → **–** | 100% → **–** | 100% → **–** | 0% → **–** | 100% → **–** | 100% → **–** | 80% → **–** | 0% → **–** | 6 → **–** |

Discovery, mean over fixtures: init 54% → agent 91%.

Each run's model, transcript, score (with what it missed), and judge.json are in its run-N/ directory.

## Runs with problems

- single-package #1: You've hit your 5-hour limit · resets 11:20pm (UTC)
- single-package #2: You've hit your 5-hour limit · resets 11:20pm (UTC)
- ts-monorepo #1: You've hit your 5-hour limit · resets 11:20pm (UTC)
- ts-monorepo #2: You've hit your 5-hour limit · resets 11:20pm (UTC)
- polyglot #2: You've hit your 5-hour limit · resets 11:20pm (UTC)
