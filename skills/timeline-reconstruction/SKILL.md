---
name: timeline-reconstruction
description: Derive the ordered account of what happened from the active evidence into versioned TimelineEvents, each citing the evidence that supports it; rebuild, never edit in place.
license: internal
metadata:
  agent: card-dispute
  owner: A1 Evidence Reconciliation
  invocation: implicit
  reads: [list_evidence, get_timeline]
  writes: [rebuild_timeline, clear_reeval, log_audit]
  writes_external: false
  needs_approval: false
allowed-tools: list_evidence, get_timeline, rebuild_timeline, clear_reeval, log_audit
---

# Timeline reconstruction

## When to use
On a `flag_reeval(timeline)` trigger, or once the case first has enough evidence
to order the events.

## Procedure
1. `list_evidence` (active). Order by `effective_at`. Where `effective_at` is
   unknown, place the item by `received_at` and mark the resulting event
   low-confidence.
2. Build `TimelineEvent`s (`assertion_type = ai_inference`). Each event has an
   `occurred_at`, a plain factual `description`, and `derived_from = [evidence_ids]`
   listing every item that supports it.
3. `rebuild_timeline` — this writes a **new version** and supersedes the prior
   timeline. Never edit an existing event in place.
4. `clear_reeval(timeline)`.
5. `log_audit`.

## Output
A single current, versioned timeline whose every event cites its evidence; all
earlier versions retained and replayable.

## Guardrails
- Every event must cite evidence in `derived_from`. If nothing supports it, it is
  not an event.
- Descriptions state what happened, not who is at fault — no liability language.
- The timeline is inference; keep it tagged `ai_inference`, never `recorded_fact`.
