# System discovery evals, 2026-11-04

What changed for 0.6.0's "intelligent system discovery": `archdoc check --done`
(a deterministic list of what a new model still lacks), `archdoc init` leaving
out test and verification code, and a skill that has the agent trace the main
flows into journeys, investigate every unconnected element, and run the done
check before handing over. Run in a Claude Code cloud session with the default
agent model.

## Fixtures: main against this branch

Two runs per fixture each, with `pnpm eval:agent --runs 2`: main's skill, CLI,
and init on the left, this branch's on the right. Both sides' saved models are
rescored with this branch's `scoreDiscovery`, so the numbers compare. The
branch's runs used its first commit; the checks added after (a step's code in
another element, a journey that never reaches its datastore, unmapped code)
are in the scores but weren't in the agent's done check yet.

| | main | this branch |
|---|---|---|
| Structure (scoreModel overall) | 92% | 92% |
| Discovery (scoreDiscovery overall) | 85% | **96%** |
| Golden journeys found | 67% | **83%** |
| Step depth (on the most specific element, code in it) | 46% | **91%** |
| Step detail (action and code that exists) | 100% | 100% |
| Test and verification files left out (order-flows) | 70% | **100%** |
| Uses recall (order-flows, services joined over HTTP and RabbitMQ) | 66% | **100%** |
| Agent cost, 12 runs | $1.89 | $1.97 |

On main, both polyglot runs and one run each of ts-monorepo and go-service wrote
a single journey, and order-flows modeled its end-to-end tests and test helpers as elements.
go-service is the one fixture where neither side finds the golden journeys:
both put the hops on the binaries (`ledger-api → postgres`) though the code is
in `internal/postings`, which the done check now flags (`done/step-elsewhere`).

## Real-world repositories: the previous skill against this branch

One run each with `pnpm eval:agent --set real-world --runs 1`, judged by
`claude-opus-5-5` (3 passes), against 2026-11-03's second run (the skill
before this change, the same judge). $2.05 for the agents, $3.21 for judging.

| Repository | Digestibility, before → after | Journeys (judge) | Onboarding files | Discovery, before → after | Left on the done list, before → after |
|---|---|---|---|---|---|
| eshop | 21% → **54%** | 2 → **4** | 16 → 38 | 81% → **100%** | 25 → **0** |
| gson | 64% → **75%** | 2 → **4** | 17 → 19 | 69% → **99%** | 7 → **0** |
| online-boutique | 46% → **54%** | 3 → **4** | 4 → 4 | 81% → **93%** | 2 → **0** |
| prometheus | 25% → **61%** | 3 → **4** | 88 → **7.5** | 74% → **92%** | 69 → **2** |
| stripe-accept-a-payment | 29% → **57%** | 3 → **3** | 24.5 → 18.5 | 81% → **99%** | 25 → **0** |

Mean digestibility 37% → **60%**; the judge's journeys score went from 2.6 to
3.8 of 5. Every run now ends with the done check clean or nearly so, with two
to three journeys, 7 to 17 steps in all, on components (eShop's were two steps
each), no test elements (eShop had 8, Prometheus 23), and no unconnected
elements (Prometheus had 27, the Stripe sample 22).

Recall against the partial references fell on eShop (67% → 59%) and
Prometheus (69% → 36%): the agents rewrote init's model, as the skill now
says to when it's far over the limits, and Prometheus's agent mapped its
components to a few files each (`tsdb/db.go`, `tsdb/head.go`) instead of
their directories, so 22% of its source is in no element and the reference's
components don't match. The done check now lists that (`done/unmapped-code`),
and the skill says to map each element to its whole directory; neither was
in this run.

## Caveats

- One or two runs per repository, so the spread is wide; Online Boutique's
  reference gained its journeys after this run, so journey recall there
  (1 of 2 found) comes from rescoring.
- The real-world baseline is the previous skill (run 2 of 2026-11-03), not
  main's exact build; main has had no skill changes since.
