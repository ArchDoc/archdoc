# A bug: triage it to its root cause

Part of the archdoc skill ([SKILL.md](../SKILL.md)), for a bug. The tools are the ones SKILL.md lists.


When you're handed a bug to explain or fix (an issue, a log line, a stack trace, wrong output), triage it: find the root cause and record the bug's journey, step by step, the way a journey records a flow. People read it in the explorer's Triage tab, on the map, one step at a time, so each step says what happened there and what it carried.

Do it whenever you're handed a bug, also when you're asked to fix it: the record comes first, and the fix isn't done until the record says it's fixed. Everything you need is here and in `archdoc_triage`'s answer, which repeats how to fill the record in; you don't need to look for this file again.

1. **Start the record, before you read the code.** Call `archdoc_triage` with `symptom` set to the bug as the user gave it, and `title`, `link`, and `reportedBy` when you know them (CLI: `archdoc triage start bug.txt -t "..." --link ...`, or `-` for stdin). It places the error on the journey steps it most likely showed up in, writes `.archdoc/triage/<id>.yaml` with status `investigating`, the best journey step, the elements the error names as open leads, and steps from the stack, and tells you where to start.
2. **Follow the code** from that step, and fill in the record as you go:

```yaml
triage: refund-waits-for-finance
title: A $4 refund waits for finance instead of going through
status: root-caused                # open, investigating, root-caused, fixed, wont-fix, cannot-reproduce
severity: high                     # low, normal, high, critical
reported: { by: rider, at: 2026-10-02, link: https://support.example.com/tickets/4812 }
symptom: |
  refund ref-ch-81: status pending_approval (expected approved)
reproduce: 'POST /refunds { "charge_id": "ch-81", "amount": 4.00 }'
expands: request-refund#4          # the journey step where it showed up (1-based)
hypotheses:                        # every lead you followed, ruled in or out
  - { claim: refund-approval sends small refunds to finance, element: payments.charges.refunds, verdict: ruled-out, evidence: read, note: It auto-approves up to half the charge }
  - { claim: The amount is converted to cents twice, element: api-gateway, verdict: confirmed, evidence: reproduced }
steps:
  - from: app
    to: api-gateway
    action: Sends the refund request
    description: The app posts the refund in dollars, as the gateway's API says it should.
    sends: RefundRequest
    code: apps/rider/src/refunds.ts#requestRefund
    evidence: read
    observed: { RefundRequest.amount: 4.00 }
  - from: api-gateway
    to: payments.charges
    action: Forwards the request, multiplying the amount by 100
    description: The gateway converts dollars to cents, but the amount it got was already in cents for this client, so $4 becomes 40000 cents.
    sends: RefundRequest            # the data entry it passes, by its name under data:
    code: services/gateway/src/refunds.ts:42
    role: cause                    # ok (default), cause, spreads, symptom
    evidence: reproduced           # reproduced, read, or inferred (default)
    observed: { RefundRequest.amount_cents: 40000 }
    expected: { RefundRequest.amount_cents: 400 }
root-cause: { summary: The gateway converts the amount to cents a second time., step: 2 }
fix: { summary: Pass amount_cents through unchanged., link: https://github.com/acme/rides/pull/88, test: services/gateway/src/refunds.test.ts }
```

   Give every step what a reader needs to walk through it: `action`, a few words on what it does; `description`, a sentence or two on what happened at that hop in the failing run (the value it had, what the code did with it, and why that's right or wrong there); `sends`, the data entry it carries, by its name under the model's `data:` (the journey step it opens up usually names it; `creates` or `changes` for a write); and `observed` and `expected` on that entry's fields where they differ (`RefundRequest.amount_cents`). `archdoc_check` warns about a step without a description or without what it carries. Put each step on the most specific element the model has (the component, not the container it's in), with the `code` where it happens; the cause step needs it most, since that's where the reader opens the code. Give every step and every lead evidence, and be honest about it: `reproduced` only for what you saw run, `read` for what you followed in the code, `inferred` for the rest. Keep a lead you ruled out, with what showed it: the next person won't follow it again. `missing: { to, call }` marks a call that should have happened and didn't, and `works-in: { element, code, note }` points at code that does the same job right. A record is evidence of one bug, not the design, so it's never part of the model.
3. **Set the status as you go.** `root-caused` once a step has `role: cause` and `root-cause` says why. If you were asked only to explain the bug, stop there and report. If you fix it, keep the record: set `status: fixed` and `fix`, with the PR and the test that shows it. A fix without its record isn't done. `wont-fix` and `cannot-reproduce` say why in `root-cause`.
4. **Check it** with `archdoc_check`, which checks records too: unknown elements and journeys, stale code references, and what the status needs. A hop the model doesn't declare is drift you found while debugging: say so, and add it to the model if the code is right. `archdoc_triage` with only `id`, or `archdoc_show` with the ID, shows it as the explorer will.
5. **Commit the record with the fix.** The PR comment then says which bug the change fixes, or whose root cause it found.

The user can also paste a bug in the explorer's Triage tab and press Send to agent, or send a record again with what they want now (find the root cause, fix it). That writes the record, marked sent, with what they asked in `ask`. When they say they sent one, or you're waiting for one, call `archdoc_triage` with `wait: true` (`archdoc triage wait`): it returns the record, what they asked, and the steps above, and marks it picked up.

`archdoc_context` on a task lists the open records on what it touches, as known bugs, and `archdoc_triage` with `list: true` lists them all. Traces from before 0.8 (`.archdoc/traces/`) aren't read since 0.9: `archdoc triage migrate` moves them.
