# ArchDoc agent evals: planning a change

2026-11-13T21:36:09.946Z · 1 run per scenario

## Start

Started: one plan written, drafting. Used: through archdoc_plan start. Scoped: its scope reaches the part of the model the idea touches. Opened: the explorer started. Told how: the answer tells the person to say what they want in the Plan tab. Drew: items the agent sketched itself (the sketch is the person's). Clean: no code, model, or markdown plan written.

| Scenario | Started | Used | Scoped | Opened | Told how | Drew | Clean | Minutes | Cost |
|---|---|---|---|---|---|---|---|---|---|
| start-order-confirmation | 100% | 100% | 100% | 100% | 100% | 0.0 | 100% | 0.4 | $0.36 |

## Answer

First turn: Answered: the share of the person's intents with a suggestion for it (for) or a note on it. Carried: the clear intents with a suggestion for each. Asked: a question with options on the intent that leaves a choice open; Picked: suggestions for it with no question (choosing for the person). Kept: the person's box kept, with its ID. Questions: how many the agent asked (one at a time is best). Words: per note. Waited: waited again after answering. Second turn, after the person taps the first option and sends it: Picked up: the agent read it; Carried choice: a suggestion for the open intent. Minutes: to the first answer, and from the person's send to the second.

| Scenario | Answered | Carried | Asked | Picked | Kept | Questions | Words | Clean | Waited | Picked up | Carried choice | Turn 1 min | Turn 2 min | Minutes | Cost |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| answer-order-confirmation | **100%** | 67% | 100% | 0% | 100% | 1.0 | 50.7 | 100% | 100% | **100%** | 100% | 0.5 | 0.4 | 1.1 | $0.58 |

## Carry out

Built: the share of the plan's changes and sequences the model shows after the run (ArchDoc's own drift check). Coded: the code the change needs is there. Done: the plan ended done, every task done. Tasks: how many it wrote; Described: each with the changes it carries out and its files; Covered: the plan's items some task carries out. Marked: tasks set through archdoc_plan task. Via edit: the model changed through archdoc edit, not by hand. Errors: archdoc check errors left. Kept: the person's items left as they were.

| Scenario | Built | Coded | Done | Tasks | Described | Covered | Marked | Via edit | Errors | Kept | Minutes | Cost |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| carry-out-order-confirmation | **100%** | 100% | 100% | 3.0 | 100% | 100% | 100% | 100% | 0.0 | 100% | 0.9 | $0.39 |

## Notes

- This is the first run of the answer stage, which replaces the review stage (its two scenarios, `order-confirmation` and `settlement-webhooks`, are retired): in 0.9.2 the person drives the design a turn at a time, so the eval scores the agent's answer to what they drew, then a second turn after a scripted person taps an option.
- Answer, first turn (0.5 min): every intent answered. It suggested the email provider, the mailer's use of it, and the mailer's description and code for the person's box (i2), keeping `shop.mailer` and its ID; added an `OrderConfirmation` message for i1 and i3 that holds whichever handoff is chosen; and asked one question on i3 with three options (Redis on the existing cache, an outbox table in Postgres, a new queue) instead of picking. i1 and i4 got a risk and an insight rather than suggestions: the `Order` type has no shopper email, and the storefront has no order page yet. Those are real gaps in the fixture, so Carried (67%) counts i1 as answered by its message but i4 as not carried.
- Answer, second turn (0.4 min after the person sent): it read the tapped option, suggested the handoff on the existing Redis, waited again, and stopped when the person marked the plan ready.
- The first run of this report found two bugs, fixed in this release before this run: `archdoc_plan` `wait` didn't return when the person had already marked the plan ready (it waited out its timeout), and a wait through MCP asked for 600 seconds, past the 60 seconds Claude Code gives a tool call, so the call failed and the agent had to retry with a shorter one. A wait through MCP now holds at most 50 seconds and says to wait again.
- Start: the answer named Build → Plan rather than "Plan tab" or "Send to agent" (there's no Send button in 0.9.2: each thing the person adds goes at once), so Told how now accepts that wording; it read 0% on the first run.
- Carry out: unchanged from 0.9, built 100% with three tasks, each marked through `archdoc_plan task`.
