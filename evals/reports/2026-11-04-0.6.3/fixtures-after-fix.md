# ArchDoc agent evals

2026-11-04T23:55:55.790Z · 2 runs per fixture

Each cell is init → agent: what archdoc init alone scores, then the agent's mean over its runs. Containers, components, datastores, and uses are F1; nesting and code are the share right.

| Fixture | Overall | Containers | Components | Datastores | Uses | Nesting | Code | Range | Errors | Minutes | Turns | Bash | Scripts | Cost |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| go-server-ui | 93% → **96%** | 100% → **100%** | 95% → **93%** | – → **–** | 71% → **89%** | 100% → **100%** | 100% → **98%** | 96%–96% | 0 | 2.4 | 72 | 6 | 1 | $0.55 |
| go-service | 88% → **95%** | 100% → **100%** | 100% → **100%** | 100% → **100%** | 35% → **78%** | 100% → **100%** | 90% → **90%** | 94%–95% | 0 | 1.6 | 57 | 3 | 1 | $0.31 |
| ts-monorepo | 96% → **97%** | 100% → **100%** | 100% → **100%** | 100% → **100%** | 82% → **81%** | 100% → **100%** | 94% → **100%** | 96%–98% | 0 | 1.8 | 63 | 4 | 1 | $0.37 |
| polyglot | 94% → **94%** | 100% → **100%** | 100% → **100%** | 100% → **100%** | 71% → **74%** | 100% → **100%** | 92% → **92%** | 94%–95% | 0 | 1.7 | 55 | 4 | 0 | $0.37 |

Minutes is the agent's wall time; turns, its turns; Bash, its Bash calls; scripts, the Bash calls that ran a program it wrote (a heredoc, python -c, node -e) to explore the repository, which init and archdoc paths should make unnecessary. Each is a mean over runs.

Overall, mean over fixtures: init 93% → agent 95%.

## Discovery

How well the model was discovered beyond its structure (scoreDiscovery in @archdoc/core), init → agent. Journeys found is the share of the golden model's journeys one of the model's journeys follows (half their hops or more; – when it has none); journeys is how many the model has, and journey depth the share of them long enough to follow that reach the datastore, queue, or external their elements use. Step detail is the share of steps with an action and code that exists; step depth, of steps on the most specific element. Tests left out is the share of test and verification files not modeled as elements of their own. Mapped is the share of source files (not tests, vendored, or generated) some element covers. Connected and described are shares of the model's elements. System is whether the model has a system element for the C4 context. Step data is the share of steps that cross into another container, datastore, queue, or external that say what they carry; store data, the share of datastores that say what they store and queues something sends through. Data fields is the share of data entries with fields or a schema source; journey flow, the share of steps after a journey's first that start where the flow already is. Deployed is the share of deployable elements an environment places (– when the repository has no deployment files). Entry points is the share of routes, consumers, schedules, commands, and pages a journey step starts at. Left to do is how many lines archdoc check --done still lists.

| Fixture | Discovery | Journeys found | Journeys | Journey depth | Step detail | Step depth | Tests left out | Mapped | Connected | Described | System | Step data | Store data | Data fields | Journey flow | Deployed | Entry points | Left to do |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| go-server-ui | 58% → **98%** | 0% → **100%** | 0 → **5** | 0% → **70%** | 0% → **100%** | 0% → **100%** | 100% → **100%** | 100% → **100%** | 100% → **100%** | 7% → **100%** | 100% → **100%** | 100% → **100%** | 100% → **100%** | 100% → **100%** | 100% → **100%** | – → **–** | 0% → **100%** | 4 → **1.5** |
| go-service | 54% → **100%** | 0% → **100%** | 0 → **2** | 0% → **100%** | 0% → **100%** | 0% → **100%** | 100% → **100%** | 100% → **100%** | 100% → **100%** | 0% → **100%** | 100% → **100%** | 100% → **100%** | 50% → **100%** | 100% → **100%** | 100% → **100%** | 60% → **100%** | 0% → **100%** | 7 → **0** |
| ts-monorepo | 54% → **100%** | 0% → **100%** | 0 → **2** | 0% → **100%** | 0% → **100%** | 0% → **100%** | 100% → **100%** | 100% → **100%** | 100% → **100%** | 30% → **100%** | 100% → **100%** | 100% → **100%** | 0% → **100%** | 100% → **100%** | 100% → **100%** | 80% → **100%** | 0% → **100%** | 6 → **0** |
| polyglot | 54% → **100%** | 0% → **100%** | 0 → **1** | 0% → **100%** | 0% → **100%** | 0% → **100%** | 100% → **100%** | 100% → **100%** | 100% → **100%** | 13% → **100%** | 100% → **100%** | 100% → **100%** | 0% → **100%** | 100% → **100%** | 100% → **100%** | 100% → **100%** | 0% → **100%** | 5 → **1** |

Discovery, mean over fixtures: init 55% → agent 99%.

Each run's model, transcript, score (with what it missed), and judge.json are in its run-N/ directory.
