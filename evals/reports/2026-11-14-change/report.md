# ArchDoc agent evals: the everyday loop

2026-11-14T02:04:44.825Z · 1 run per scenario

Model is the share of the scenario's facts about the model and code that hold after the run (mean over runs); clean, the share of runs where archdoc check against main finds nothing the change introduced that's an error, drift, or a sealed fact changed and not sealed again. Context first is the share of runs that asked archdoc context before changing code. Edit, hand edits, YAML reads, check, and seal count its archdoc edit calls, its Edit and Write calls on .archdoc/ files, its Read calls on them, and its archdoc check and seal calls.

| Scenario | Model | Clean | Context first | Edit | Hand edits | YAML reads | Check | Seal | Minutes | Turns | Cost |
|---|---|---|---|---|---|---|---|---|---|---|---|
| drop-cache | **100%** | **100%** | 100% | 1 | 0 | 1 | 2 | 1 | 0.5 | 16 | $0.26 |
| move-payments | **100%** | **100%** | 100% | 3 | 0 | 0 | 1 | 1 | 1.0 | 22 | $0.39 |
| order-emails | **100%** | **100%** | 100% | 3 | 0 | 0 | 2 | 1 | 1.0 | 17 | $0.38 |

Mean over scenarios: model 100%, clean 100%. Spent $1.03 in all.

Each run's answer, transcript, and score (what it missed and left) are in its run-N/ directory.
