---
name: provenance-tagging
description: Ensure every EvidenceItem carries complete source provenance and a calibrated confidence; down-weight weak or unattributed sources without judging their truth.
license: internal
metadata:
  agent: card-dispute
  owner: A1 Evidence Reconciliation
  invocation: implicit
  reads: [list_evidence]
  writes: [upsert_evidence, log_audit]
  writes_external: false
  needs_approval: false
allowed-tools: list_evidence, upsert_evidence, log_audit
---

# Provenance tagging

## When to use
Right after `assemble-evidence`, or as a sweep across the case, to guarantee
provenance is complete and confidence is calibrated before anything is reasoned on.

## Procedure
1. `list_evidence` (active). For each item missing `source_system`,
   `source_authority` or `supplied_by`, enrich from the ingest envelope. If it
   cannot be recovered, set `source_authority = "unattributed"`.
2. **Calibrate `confidence`:**
   - `recorded_fact` from a first-party or authoritative source → `1.0`
   - `recorded_fact` that is second-hand or unattributed → lower (e.g. `0.6`)
   - `user_input` → `0.5` baseline
3. `upsert_evidence` with the enriched provenance and confidence (a new version if
   the values changed).
4. `log_audit`.

## Output
Every active item carries source, authority, supplier, timestamps, and a
confidence that reflects how much weight downstream skills should give it.

## Guardrails
- Provenance is descriptive, not a verdict on truth.
- Do **not** down-weight an item merely because it is inconvenient to a hypothesis.
- Confidence is an input to scoring, never a decision.
