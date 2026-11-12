# ArchDoc agent evals: plan review

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
