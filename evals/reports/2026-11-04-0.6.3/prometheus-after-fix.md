# ArchDoc agent evals: real-world repositories

2026-11-04T23:57:56.239Z · 3 runs per repository · judged by claude-opus-5-5, 3 passes

Each cell is init → agent: what archdoc init alone scores, then the agent's mean over its runs. Scored against each repository's partial reference.yaml, so containers, components, datastores, and uses are recall (a model may go further and isn't marked down); nesting and code are the share right; overall is their mean.

| Repository | Overall | Containers | Components | Datastores | Uses | Nesting | Code | Range | Errors | Minutes | Turns | Bash | Scripts | Cost |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| prometheus | 82% → **80%** | 100% → **100%** | 90% → **73%** | – → **–** | 24% → **30%** | 100% → **100%** | 98% → **97%** | 77%–83% | 0 | 4.3 | 94 | 6 | 1 | $0.88 |

Minutes is the agent's wall time; turns, its turns; Bash, its Bash calls; scripts, the Bash calls that ran a program it wrote (a heredoc, python -c, node -e) to explore the repository, which init and archdoc paths should make unnecessary. Each is a mean over runs.

Overall, mean over repositories: init 82% → agent 80%.

## Discovery

How well the model was discovered beyond its structure (scoreDiscovery in @archdoc/core), init → agent. Journeys found is the share of the golden model's journeys one of the model's journeys follows (half their hops or more; – when it has none); journeys is how many the model has, and journey depth the share of them long enough to follow that reach the datastore, queue, or external their elements use. Step detail is the share of steps with an action and code that exists; step depth, of steps on the most specific element. Tests left out is the share of test and verification files not modeled as elements of their own. Mapped is the share of source files (not tests, vendored, or generated) some element covers. Connected and described are shares of the model's elements. System is whether the model has a system element for the C4 context. Step data is the share of steps that cross into another container, datastore, queue, or external that say what they carry; store data, the share of datastores that say what they store and queues something sends through. Data fields is the share of data entries with fields or a schema source; journey flow, the share of steps after a journey's first that start where the flow already is. Deployed is the share of deployable elements an environment places (– when the repository has no deployment files). Entry points is the share of routes, consumers, schedules, commands, and pages a journey step starts at. Left to do is how many lines archdoc check --done still lists.

| Repository | Discovery | Journeys found | Journeys | Journey depth | Step detail | Step depth | Tests left out | Mapped | Connected | Described | System | Step data | Store data | Data fields | Journey flow | Deployed | Entry points | Left to do |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| prometheus | 58% → **97%** | – → **–** | 0 → **7.3** | 0% → **84%** | 0% → **100%** | 0% → **100%** | 97% → **99%** | 100% → **100%** | 59% → **88%** | 3% → **100%** | 100% → **100%** | 100% → **89%** | 100% → **100%** | 100% → **100%** | 100% → **100%** | – → **–** | 0% → **97%** | 34 → **11** |

Discovery, mean over repositories: init 58% → agent 97%.

## Judged

Digestibility is the mean of the rubric's dimensions (scripts/eval-judge.mjs), 1 to 5 mapped onto 0 to 100%; each dimension is the median of the judge's passes, then the mean over runs. Onboarding is how many of the newcomer questions the judge answered with an element that covers the answer, using only the model; files is how many files that element covers (fewer is less to read).

| Repository | Digestibility | Fidelity | Granularity | Coverage | Relationships | Infrastructure | Descriptions | Journeys | Onboarding | Files | Judge cost |
|---|---|---|---|---|---|---|---|---|---|---|---|
| prometheus | 11% → **49%** | 2 → **3.7** | 1 → **2.3** | 2 → **2.7** | 2 → **2** | 1 → **3.3** | 1 → **3.3** | 1 → **3.3** | 6 → **6** of 6 | 54 → **53.5** | $1.43 |

Each run's model, transcript, score (with what it missed), and judge.json are in its run-N/ directory.
