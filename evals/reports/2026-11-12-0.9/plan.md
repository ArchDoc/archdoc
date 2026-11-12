# ArchDoc agent evals: planning a change

## Review

2026-11-12T07:28:24.953Z · 1 run per scenario

Caught: the share of seeded flaws with a note from the agent pinned to the item, or the fix suggested. Worded: and the note says what's wrong. False alarms: risks or questions on items that are sound. Kept: the person's items left as they were. Clean: no code or model changed. Used: answered through archdoc_plan respond. Read: what the person changed is marked read.

| Scenario | Caught | Worded | False alarms | Kept | Clean | Used | Read | Notes | Suggestions | Minutes | Cost |
|---|---|---|---|---|---|---|---|---|---|---|---|
| order-confirmation | **100%** | 100% | 0.0 | 100% | 100% | 100% | 100% | 5.0 | 1.0 | 0.7 | $0.30 |
| settlement-webhooks | **100%** | 67% | 2.0 | 100% | 100% | 100% | 100% | 8.0 | 7.0 | 0.9 | $0.44 |


## Notes

- Both runs started from `archdoc_plan` read, answered through `respond`, and left the person's items, the code, and the model alone.
- order-confirmation: notes on all four seeded flaws (the browser sending email, emailing before the charge, the arrow with no intent, removing the cache), and a suggested arrow from `shop.api.orders` to the mailer.
- settlement-webhooks: it moved the webhook call to the worker's settle path (`ledger.postings → ledger.webhooks`), suggested going through `ledger.store`, and flagged the critical `post-a-posting` journey before touching it. It also asked how clients register a URL and how retries work with core NATS, which the plan's first change claims without saying how; the scenario no longer counts questions on that change as false alarms. It caught the step without intent by its order, not by naming the missing intent (Worded 67%).
- The run found an `archdoc edit` bug: `ledger.webhooks`, in a model whose namespace is `ledger`, was added at the top instead of inside the element `ledger`. Fixed in this release.

## Start

2026-11-12 · 3 runs

Started: one plan written, drafting. Used: through archdoc_plan start. Scoped: its scope reaches the part of the model the idea touches. Opened: the explorer started. Told how: the answer tells the person to sketch it in the Plan tab and send it. Drew: items the agent sketched itself (the sketch is the person's). Clean: no code, model, or markdown plan written.

| Scenario | Started | Used | Scoped | Opened | Told how | Drew | Clean | Minutes | Cost |
|---|---|---|---|---|---|---|---|---|---|
| start-order-confirmation | 100% | 100% | 100% | 100% | 100% | 0.0 | 100% | 0.5 | $0.29 |

- Every run started one drafting plan through `archdoc_plan`, with `api.orders` and the `checkout` journey in scope, opened the explorer itself with `archdoc view --detach --watch --open`, gave the URL and how to sketch, and left the sketch to the person (no changes or sequences drawn; notes on what it found in the code, such as `Order` having no email address).
- Earlier runs found two things, fixed before these: the start answer now says to run the explorer yourself rather than hand the person the command, and that the sketch is theirs. The eval also runs the agent as if on the person's machine (no `CLAUDE_CODE_REMOTE`), since on a remote one the skill rightly writes a static site instead.

## Carry out

2026-11-12 · 3 runs

Built: the share of the plan's changes and sequences the model shows after the run (ArchDoc's own drift check). Coded: the code the change needs is there. Done: the plan ended done, every task done. Tasks: how many it wrote; Described: each with the changes it carries out and its files; Covered: the plan's items some task carries out. Marked: tasks set through archdoc_plan task. Via edit: the model changed through archdoc edit, not by hand. Errors: archdoc check errors left. Kept: the person's items left as they were.

| Scenario | Built | Coded | Done | Tasks | Described | Covered | Marked | Via edit | Errors | Kept | Minutes | Cost |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| carry-out-order-confirmation | **100%** | 100% | 100% | 2.0 | 100% | 100% | 100% | 100% | 0.0 | 100% | 0.9 | $0.47 |
- Every run wrote two tasks, built `apps/api/src/notify/` and the call after the charge, made each change with `archdoc edit`, inserted both checkout steps, marked the tasks, and left the plan `done` with `archdoc check` clean.
- The first run found that once a planned change landed, `archdoc check` said it "can't be made" (the element already existed). A ready or executing plan now counts a change the model already shows as made, and `archdoc plan read` gives each agreed change as the `archdoc edit` op that makes it.
