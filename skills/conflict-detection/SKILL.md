---
name: conflict-detection
description: Make uncertainty explicit — open Gaps for missing, stale and contradictory evidence, and flag the affected hypotheses for rescoring; never silently pick a side.
license: internal
metadata:
  agent: card-dispute
  owner: A1 Evidence Reconciliation
  invocation: implicit
  reads: [list_evidence, get_timeline, list_hypotheses, list_gaps]
  writes: [open_gap, resolve_gap, flag_reeval, log_audit]
  writes_external: false
  needs_approval: false
allowed-tools: list_evidence, get_timeline, list_hypotheses, list_gaps, open_gap, resolve_gap, flag_reeval, log_audit
---

# Conflict detection

## When to use
On a `flag_reeval(hypotheses)` trigger, after a timeline rebuild, or as a sweep.

## Procedure
1. **Missing.** For the case `reason_code`, take the required-evidence set from
   `chargeback-rules`. For each required kind with no active item →
   `open_gap(kind=missing, about=<kind>)`.
2. **Stale.** An item whose `effective_at` is far behind the current stage, or one
   a newer item supersedes yet is still cited → `open_gap(kind=stale, about=<id>)`.
3. **Contradiction.** Compare active items across kinds on shared facts —
   `delivery_record.delivered=true` vs `customer_statement.received=false`; an
   `auth_event` that places the card present vs a customer "not me". On any clash →
   `open_gap(kind=contradiction, about=[ids])`.
4. For each contradiction, `flag_reeval(hypotheses)` so scoring reflects it.
5. Close gaps with `resolve_gap` when a later item settles them.
6. `log_audit`.

## Output
Every gap and contradiction is an explicit `Gap` on the case; the hypotheses are
re-queued for scoring wherever evidence now conflicts.

## Guardrails
- Make uncertainty explicit — never resolve a contradiction by quietly choosing a side.
- A contradiction is a `Gap`, not a decision. Deciding it is human-owned.
