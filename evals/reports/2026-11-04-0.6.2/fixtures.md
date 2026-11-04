# ArchDoc agent evals

2026-11-04T18:27:23.233Z · 2 runs per fixture

Each cell is init → agent: what archdoc init alone scores, then the agent's mean over its runs. Containers, components, datastores, and uses are F1; nesting and code are the share right.

| Fixture | Overall | Containers | Components | Datastores | Uses | Nesting | Code | Range | Errors | Minutes | Turns | Bash | Scripts | Cost |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| go-service | 88% → **91%** | 100% → **100%** | 100% → **100%** | 100% → **100%** | 35% → **54%** | 100% → **100%** | 90% → **90%** | 86%–95% | 0 | 2.1 | 63 | 4 | 0 | $0.35 |
| order-flows | 90% → **97%** | 100% → **100%** | 100% → **100%** | 100% → **100%** | 42% → **87%** | 100% → **100%** | 97% → **97%** | 97%–97% | 0 | 2.2 | 74 | 5 | 2 | $0.44 |
| polyglot | 94% → **94%** | 100% → **100%** | 100% → **100%** | 100% → **100%** | 71% → **70%** | 100% → **100%** | 92% → **92%** | 92%–95% | 0 | 2.3 | 56 | 4 | 1 | $0.37 |
| python-fastapi | 97% → **98%** | 100% → **100%** | 100% → **100%** | 100% → **100%** | 89% → **94%** | 100% → **100%** | 92% → **92%** | 97%–99% | 0 | 1.1 | 34 | 4 | 1 | $0.18 |
| single-package | 97% → **97%** | 100% → **100%** | 91% → **91%** | – → **–** | 93% → **93%** | 100% → **100%** | 100% → **100%** | 97%–97% | 0 | 1.4 | 21 | 5 | 2 | $0.19 |
| ts-monorepo | 96% → **97%** | 100% → **100%** | 100% → **100%** | 100% → **100%** | 82% → **88%** | 100% → **100%** | 94% → **94%** | 97%–97% | 0 | 1.5 | 53 | 4 | 1 | $0.30 |

Minutes is the agent's wall time; turns, its turns; Bash, its Bash calls; scripts, the Bash calls that ran a program it wrote (a heredoc, python -c, node -e) to explore the repository, which init and archdoc paths should make unnecessary. Each is a mean over runs.

Overall, mean over fixtures: init 93% → agent 96%.

## Discovery

How well the model was discovered beyond its structure (scoreDiscovery in @archdoc/core), init → agent. Journeys found is the share of the golden model's journeys one of the model's journeys follows (half their hops or more; – when it has none); journeys is how many the model has, and journey depth the share of them long enough to follow that reach the datastore, queue, or external their elements use. Step detail is the share of steps with an action and code that exists; step depth, of steps on the most specific element. Tests left out is the share of test and verification files not modeled as elements of their own. Mapped is the share of source files (not tests, vendored, or generated) some element covers. Connected and described are shares of the model's elements. System is whether the model has a system element for the C4 context. Step data is the share of steps that cross into another container, datastore, queue, or external that say what they carry; store data, the share of datastores that say what they store and queues something sends through. Deployed is the share of deployable elements an environment places (– when the repository has no deployment files). Entry points is the share of routes, consumers, schedules, commands, and pages a journey step starts at. Left to do is how many lines archdoc check --done still lists.

| Fixture | Discovery | Journeys found | Journeys | Journey depth | Step detail | Step depth | Tests left out | Mapped | Connected | Described | System | Step data | Store data | Deployed | Entry points | Left to do |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| go-service | 47% → **94%** | 0% → **50%** | 0 → **2** | 0% → **75%** | 0% → **100%** | 0% → **100%** | 100% → **100%** | 100% → **100%** | 100% → **100%** | 0% → **100%** | 100% → **100%** | 100% → **100%** | 50% → **100%** | 60% → **100%** | 0% → **100%** | 7 → **0.5** |
| order-flows | 42% → **99%** | 0% → **100%** | 0 → **4** | 0% → **100%** | 0% → **100%** | 0% → **100%** | 100% → **100%** | 100% → **100%** | 64% → **100%** | 0% → **100%** | 100% → **100%** | 100% → **100%** | 0% → **100%** | 86% → **100%** | 0% → **90%** | 10 → **0** |
| polyglot | 47% → **98%** | 0% → **100%** | 0 → **2** | 0% → **75%** | 0% → **100%** | 0% → **100%** | 100% → **100%** | 100% → **100%** | 100% → **100%** | 13% → **100%** | 100% → **100%** | 100% → **100%** | 0% → **100%** | 100% → **100%** | 0% → **100%** | 5 → **0.5** |
| python-fastapi | 46% → **100%** | 0% → **100%** | 0 → **2** | 0% → **100%** | 0% → **100%** | 0% → **100%** | 100% → **100%** | 100% → **100%** | 100% → **100%** | 0% → **100%** | 100% → **100%** | 100% → **100%** | 0% → **100%** | 100% → **100%** | 0% → **100%** | 5 → **0** |
| single-package | 51% → **100%** | 0% → **100%** | 0 → **2** | 0% → **100%** | 0% → **100%** | 0% → **100%** | 100% → **100%** | 100% → **100%** | 100% → **100%** | 17% → **100%** | 100% → **100%** | 100% → **100%** | 100% → **100%** | – → **–** | 0% → **100%** | 4 → **0** |
| ts-monorepo | 47% → **99%** | 0% → **100%** | 0 → **2** | 0% → **100%** | 0% → **100%** | 0% → **100%** | 100% → **100%** | 100% → **100%** | 100% → **100%** | 30% → **100%** | 100% → **100%** | 100% → **100%** | 0% → **100%** | 80% → **90%** | 0% → **100%** | 6 → **0.5** |

Discovery, mean over fixtures: init 47% → agent 98%.

Each run's model, transcript, score (with what it missed), and judge.json are in its run-N/ directory.
