# ArchDoc agent evals: real-world repositories

2026-11-04T23:38:21.095Z · 2 runs per repository

Each cell is init → agent: what archdoc init alone scores, then the agent's mean over its runs. Scored against each repository's partial reference.yaml, so containers, components, datastores, and uses are recall (a model may go further and isn't marked down); nesting and code are the share right; overall is their mean.

| Repository | Overall | Containers | Components | Datastores | Uses | Nesting | Code | Range | Errors | Minutes | Turns | Bash | Scripts | Cost |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| prometheus | 69% → **69%** | 67% → **67%** | 90% → **80%** | – → **–** | 24% → **36%** | 100% → **100%** | 62% → **62%** | 64%–74% | 0 | 4.5 | 78 | 11 | 3 | $0.85 |

Minutes is the agent's wall time; turns, its turns; Bash, its Bash calls; scripts, the Bash calls that ran a program it wrote (a heredoc, python -c, node -e) to explore the repository, which init and archdoc paths should make unnecessary. Each is a mean over runs.

Overall, mean over repositories: init 69% → agent 69%.

## Discovery

How well the model was discovered beyond its structure (scoreDiscovery in @archdoc/core), init → agent. Journeys found is the share of the golden model's journeys one of the model's journeys follows (half their hops or more; – when it has none); journeys is how many the model has, and journey depth the share of them long enough to follow that reach the datastore, queue, or external their elements use. Step detail is the share of steps with an action and code that exists; step depth, of steps on the most specific element. Tests left out is the share of test and verification files not modeled as elements of their own. Mapped is the share of source files (not tests, vendored, or generated) some element covers. Connected and described are shares of the model's elements. System is whether the model has a system element for the C4 context. Step data is the share of steps that cross into another container, datastore, queue, or external that say what they carry; store data, the share of datastores that say what they store and queues something sends through. Data fields is the share of data entries with fields or a schema source; journey flow, the share of steps after a journey's first that start where the flow already is. Deployed is the share of deployable elements an environment places (– when the repository has no deployment files). Entry points is the share of routes, consumers, schedules, commands, and pages a journey step starts at. Left to do is how many lines archdoc check --done still lists.

| Repository | Discovery | Journeys found | Journeys | Journey depth | Step detail | Step depth | Tests left out | Mapped | Connected | Described | System | Step data | Store data | Data fields | Journey flow | Deployed | Entry points | Left to do |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| prometheus | 59% → **100%** | – → **–** | 0 → **7** | 0% → **100%** | 0% → **100%** | 0% → **100%** | 97% → **100%** | 100% → **99%** | 68% → **100%** | 4% → **100%** | 100% → **100%** | 100% → **100%** | 100% → **100%** | 100% → **100%** | 100% → **100%** | – → **–** | 0% → **97%** | 46 → **0** |

Discovery, mean over repositories: init 59% → agent 100%.

Each run's model, transcript, score (with what it missed), and judge.json are in its run-N/ directory.
