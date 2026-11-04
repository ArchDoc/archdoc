# 0.6.3 evals

Run on 2026-11-04 against the 0.6.2 reports in `../2026-11-04-0.6.2/`.

- `fixtures-a.md`: the first fixture run. The account's usage limit cut off single-package, ts-monorepo, and polyglot's second run, so only go-service, order-flows, and python-fastapi count from it.
- `fixtures-b.md`: polyglot, single-package, and ts-monorepo, rerun after the limit reset.
- `real-world.md`: eshop, online-boutique, and prometheus, one run each, judged.
- `prometheus-reruns.md`: two more prometheus runs (not judged), to check its drop.
- `prometheus-after-fix.md` and `fixtures-after-fix.md`: after the fix below, three judged prometheus runs, and the new `go-server-ui` fixture with go-service, ts-monorepo, and polyglot.

| | 0.6.2 | 0.6.3 |
|---|---|---|
| Fixtures, overall | 96% | 96% |
| Fixtures, discovery | 98% | 99.7% (two new parts: data fields, journey flow) |
| Fixtures, cost for one run of each | $1.83 | $1.81 |
| Real-world, overall | 94% | 88% (prometheus 83% → 69%, mean of 3 runs) |
| Real-world, discovery | 98% | 96% |
| Real-world, digestibility | 61% | 60% |
| Real-world, cost per run (eshop, online-boutique, prometheus) | $1.38, $0.39, $0.92 | $1.34, $0.38, $1.22 |

## The prometheus drop, and its fix

Before the fix, prometheus lost its structure score in all three runs: the agent split `web/ui` into one container per package (mantine-ui, react-app, codemirror-promql, lezer-promql), so the reference's `web-ui` didn't match, and it left the server's packages in a `core` container beside a one-file `cmd/prometheus` container. Init had started it that way: a container per `package.json`, and a Go module as a container of its own beside its binaries.

The fix (`fix(init): keep one app in one container`): init makes a workspace below the top of the repository one container with its packages as components, and folds a Go module into the binary named after it (`cmd/prometheus` in `github.com/prometheus/prometheus`). The skill says the same for when init can't tell. The new `go-server-ui` fixture has both shapes, so a change that splits them again fails `evals.test.ts`.

| prometheus | Before the fix (3 runs) | After (3 runs) | 0.6.2 (1 run) |
|---|---|---|---|
| Init alone | 69% | 82% | 69% |
| Agent | 69% (64%–74%) | 80% (77%–83%) | 83% |
| Containers | 67% | 100% | 100% |
| Cost per run | $1.22 | $0.88 | $0.92 |
| Digestibility | 54% (1 run) | 49% (57%, 57%, and 32% for a run that stopped with 32 lines left) | 57% |

What's left on prometheus is components: agents fold notifier into rules and remote storage into storage, which the reference keeps apart.

| Fixture after the fix | Init | Agent |
|---|---|---|
| go-server-ui (new) | 93% | 96% |
| go-service | 88% | 95% |
| ts-monorepo | 96% | 97% |
| polyglot | 94% | 94% |
