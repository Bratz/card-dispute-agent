---
name: duplicate-detection
description: Find EvidenceItems that state the same underlying fact and mark the redundant ones duplicate_of, so nothing is counted twice; never merge a genuine conflict.
license: internal
metadata:
  agent: card-dispute
  owner: A1 Evidence Reconciliation
  invocation: implicit
  reads: [list_evidence]
  writes: [upsert_evidence, open_gap, log_audit]
  writes_external: false
  needs_approval: false
allowed-tools: list_evidence, upsert_evidence, open_gap, mark_duplicates, log_audit
---

# Duplicate detection

## When to use
After new evidence lands, before timeline and hypothesis work, so counts and
conflicts are not distorted by the same fact appearing twice.

## Procedure
1. `list_evidence` (active). Group items by `content_hash`; then apply a
   near-duplicate heuristic — same `kind` + same transaction/order reference +
   `effective_at` within a small tolerance.
2. In each group, keep the highest-authority, most-recent item active. Set the
   others `status = duplicate_of` the kept id via `upsert_evidence`.
3. **Do not merge a conflict.** If two items look like duplicates but disagree on
   a material field, leave both active and `open_gap(kind=contradiction, about=[ids])`.
   Resolving it is `conflict-detection`'s job, not yours.
4. `log_audit`.

## Output
One active item per distinct fact; redundant copies marked `duplicate_of`;
genuine conflicts surfaced as Gaps rather than hidden by a merge.

## Guardrails
- A correction (`supersedes`) is **not** a duplicate — never mark a superseding
  version as duplicate.
- When in doubt between "duplicate" and "conflict", treat it as a conflict.
