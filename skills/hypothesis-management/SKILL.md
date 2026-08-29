---
name: hypothesis-management
description: Hold the competing interpretations of a dispute open, wire evidence to them with polarity, and rescore; keep at least two live while the evidence is mixed. Never decide liability.
license: internal
metadata:
  agent: card-dispute
  owner: A2 Dispute Case Planner
  invocation: implicit
  reads: [list_hypotheses, list_evidence, get_timeline]
  writes: [upsert_hypothesis, link_evidence, score_hypotheses, clear_reeval, log_audit]
  writes_external: false
  needs_approval: false
allowed-tools: list_hypotheses, list_evidence, get_timeline, upsert_hypothesis, link_evidence, score_hypotheses, clear_reeval, log_audit
---

# Hypothesis management

## When to use
On a `flag_reeval(hypotheses)` trigger. Runs whenever evidence lands or changes.

## Procedure
1. **Ensure the candidate interpretations exist** as `Hypothesis` rows — for a
   card dispute typically: "merchant delivered / customer received", "goods or
   service not delivered", "transaction unauthorised". `upsert_hypothesis` for any
   missing; do not invent unsupported ones.
2. **Link the evidence.** For each new or changed `EvidenceItem`, call
   `link_evidence(hypothesis_id, evidence_id, polarity)` where polarity is
   `supports`, `weakens` or `neutralises`, with a `weight`.
3. **Rescore.** `score_hypotheses` recomputes each `confidence` from its links.
4. **Update status** to `strengthened` / `weakened`. Retire a hypothesis only when
   evidence conclusively removes it — and even then the row and its links stay
   (history is never deleted).
5. **Keep the field open.** While no hypothesis is decisive, keep at least two
   `open`. Surface the spread to `next-best-action`.
6. `clear_reeval(hypotheses)`; `log_audit`.

## Output
A live set of competing interpretations, each with its supporting and weakening
evidence and a confidence that moves only when evidence moves.

## Guardrails
- Never collapse to a single interpretation early.
- Never write `liability_outcome` — you rank plausibility, a person decides liability.
- Confidence changes must trace to an evidence link, not a hunch.
