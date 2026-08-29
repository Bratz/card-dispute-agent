---
name: chargeback-rules
description: Apply the scheme reason-code rules for a dispute — which evidence is required, which actions are permitted at this stage, and which time windows apply. Deterministic reference data, not model guesswork.
license: internal
metadata:
  agent: card-dispute
  owner: A2 Dispute Case Planner
  invocation: implicit
  role: reference
  reads: [get_case, list_evidence, list_gaps]
  writes: [open_gap, request_intervention, log_audit]
  writes_external: false
  needs_approval: false
allowed-tools: get_case, list_evidence, list_gaps, open_gap, request_intervention, log_audit
---

# Chargeback rules

## When to use
A reference skill, consulted by `conflict-detection`, `deadline-tracking` and
`next-best-action`. Run it whenever the required evidence, permitted actions or
windows for the current stage are needed.

## Procedure
1. **Look up the rule set** for the case `reason_code` against the scheme
   reason-code reference data. This is deterministic lookup — never infer a rule
   the model has not been given.
2. **Return three things** for the current `stage`:
   - the **required evidence kinds**,
   - the **permitted actions** (e.g. request evidence, raise chargeback, submit
     representment, close),
   - the **applicable time windows**.
3. **Surface gaps.** For any required evidence kind with no active item,
   `open_gap(kind=missing)`.
4. `log_audit`.

## Output
The required-evidence set, the permitted-action set, and the windows for the
current stage — the guardrails `next-best-action` plans within.

## Guardrails
- Rules are deterministic reference data. If the `reason_code` is unknown or
  unsupported, `request_intervention` — do not guess a rule.
- This skill scopes what is *permitted*; it does not itself take any action.
