# 0.6.3 evals

Run on 2026-11-04 against the 0.6.2 reports in `../2026-11-04-0.6.2/`.

- `fixtures-a.md`: the first fixture run. The account's usage limit cut off single-package, ts-monorepo, and polyglot's second run, so only go-service, order-flows, and python-fastapi count from it.
- `fixtures-b.md`: polyglot, single-package, and ts-monorepo, rerun after the limit reset.
- `real-world.md`: eshop, online-boutique, and prometheus, one run each, judged.
- `prometheus-reruns.md`: two more prometheus runs (not judged), to check its drop.

| | 0.6.2 | 0.6.3 |
|---|---|---|
| Fixtures, overall | 96% | 96% |
| Fixtures, discovery | 98% | 99.7% (two new parts: data fields, journey flow) |
| Fixtures, cost for one run of each | $1.83 | $1.81 |
| Real-world, overall | 94% | 88% (prometheus 83% → 69%, mean of 3 runs) |
| Real-world, discovery | 98% | 96% |
| Real-world, digestibility | 61% | 60% |
| Real-world, cost per run (eshop, online-boutique, prometheus) | $1.38, $0.39, $0.92 | $1.34, $0.38, $1.22 |

Prometheus loses its structure score in all three runs: the agent splits `web/ui` into one container per package (mantine-ui, react-app, codemirror-promql, lezer-promql), so the reference's `web-ui` doesn't match, and leaves storage and rules inside other components. That's decomposition, which this release didn't change; its journeys went from 6 to 7–10 and each step now starts where the flow is.
