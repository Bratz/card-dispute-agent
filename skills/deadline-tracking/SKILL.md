---
name: deadline-tracking
description: Derive and track the scheme, regulatory and operational clocks for a dispute; mark them met or missed and raise urgency as a window approaches so no representment lapses silently.
license: internal
metadata:
  agent: card-dispute
  owner: A2 Dispute Case Planner
  invocation: implicit
  reads: [get_case, list_deadlines]
  writes: [set_deadline, mark_deadline, log_audit]
  writes_external: false
  needs_approval: false
allowed-tools: get_case, list_deadlines, set_deadline, mark_deadline, log_audit
---

# Deadline tracking

## When to use
At case open, on every stage change, and on a schedule.

## Procedure
1. **Derive the clocks** from `reason_code` and `stage` via `chargeback-rules` —
   typically `evidence_due`, `representment_window`, `response_sla`. `set_deadline`
   for any that do not yet exist on the case.
2. **Track `due_at`.** `mark_deadline` met or missed as each passes.
3. **Escalate on approach.** When a deadline is within its warning threshold, raise
   its urgency so `next-best-action` weights it. A representment window nearing
   `due_at` with no action proposed is the strongest possible urgency signal.

## Output
A current set of `Deadline` rows with status, and an urgency signal feeding the
planner before anything can lapse.

## Guardrails
- Never let a representment or evidence window pass silently. If nothing else is
  possible, ensure `next-best-action` proposes an escalation before `due_at`.
- Deadlines are derived from the rules, not guessed.
