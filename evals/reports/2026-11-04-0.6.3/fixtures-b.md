# ArchDoc agent evals

2026-11-04T23:25:39.397Z · 2 runs per fixture

Each cell is init → agent: what archdoc init alone scores, then the agent's mean over its runs. Containers, components, datastores, and uses are F1; nesting and code are the share right.

| Fixture | Overall | Containers | Components | Datastores | Uses | Nesting | Code | Range | Errors | Minutes | Turns | Bash | Scripts | Cost |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| polyglot | 94% → **93%** | 100% → **100%** | 100% → **100%** | 100% → **100%** | 71% → **67%** | 100% → **100%** | 92% → **92%** | 92%–94% | 0 | 2.1 | 64 | 5 | 1 | $0.43 |
| single-package | 97% → **97%** | 100% → **100%** | 91% → **91%** | – → **–** | 93% → **93%** | 100% → **100%** | 100% → **100%** | 97%–97% | 0 | 0.9 | 26 | 4 | 1 | $0.18 |
| ts-monorepo | 96% → **96%** | 100% → **100%** | 100% → **100%** | 100% → **100%** | 82% → **81%** | 100% → **100%** | 94% → **97%** | 96%–96% | 0 | 1.2 | 44 | 4 | 1 | $0.25 |

Minutes is the agent's wall time; turns, its turns; Bash, its Bash calls; scripts, the Bash calls that ran a program it wrote (a heredoc, python -c, node -e) to explore the repository, which init and archdoc paths should make unnecessary. Each is a mean over runs.

Overall, mean over fixtures: init 96% → agent 95%.

## Discovery

How well the model was discovered beyond its structure (scoreDiscovery in @archdoc/core), init → agent. Journeys found is the share of the golden model's journeys one of the model's journeys follows (half their hops or more; – when it has none); journeys is how many the model has, and journey depth the share of them long enough to follow that reach the datastore, queue, or external their elements use. Step detail is the share of steps with an action and code that exists; step depth, of steps on the most specific element. Tests left out is the share of test and verification files not modeled as elements of their own. Mapped is the share of source files (not tests, vendored, or generated) some element covers. Connected and described are shares of the model's elements. System is whether the model has a system element for the C4 context. Step data is the share of steps that cross into another container, datastore, queue, or external that say what they carry; store data, the share of datastores that say what they store and queues something sends through. Data fields is the share of data entries with fields or a schema source; journey flow, the share of steps after a journey's first that start where the flow already is. Deployed is the share of deployable elements an environment places (– when the repository has no deployment files). Entry points is the share of routes, consumers, schedules, commands, and pages a journey step starts at. Left to do is how many lines archdoc check --done still lists.

| Fixture | Discovery | Journeys found | Journeys | Journey depth | Step detail | Step depth | Tests left out | Mapped | Connected | Described | System | Step data | Store data | Data fields | Journey flow | Deployed | Entry points | Left to do |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| polyglot | 54% → **100%** | 0% → **100%** | 0 → **1.5** | 0% → **100%** | 0% → **100%** | 0% → **100%** | 100% → **100%** | 100% → **100%** | 100% → **100%** | 13% → **100%** | 100% → **100%** | 100% → **100%** | 0% → **100%** | 100% → **100%** | 100% → **100%** | 100% → **100%** | 0% → **100%** | 5 → **0.5** |
| single-package | 58% → **100%** | 0% → **100%** | 0 → **2** | 0% → **100%** | 0% → **100%** | 0% → **100%** | 100% → **100%** | 100% → **100%** | 100% → **100%** | 17% → **100%** | 100% → **100%** | 100% → **100%** | 100% → **100%** | 100% → **100%** | 100% → **100%** | – → **–** | 0% → **100%** | 4 → **0** |
| ts-monorepo | 54% → **98%** | 0% → **75%** | 0 → **2** | 0% → **100%** | 0% → **100%** | 0% → **100%** | 100% → **100%** | 100% → **100%** | 100% → **100%** | 30% → **100%** | 100% → **100%** | 100% → **100%** | 0% → **100%** | 100% → **100%** | 100% → **100%** | 80% → **90%** | 0% → **100%** | 6 → **0.5** |

Discovery, mean over fixtures: init 56% → agent 99%.

Each run's model, transcript, score (with what it missed), and judge.json are in its run-N/ directory.
