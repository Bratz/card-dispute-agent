---
name: next-best-action
description: Choose the single most useful next step in a dispute from state, gaps, deadlines and permitted actions; do internal steps directly and propose external ones for human approval. Never execute an external action.
license: internal
metadata:
  agent: card-dispute
  owner: A2 Dispute Case Planner
  invocation: implicit
  reads: [get_case, list_gaps, list_deadlines, list_hypotheses, get_audit]
  writes: [propose_action, request_approval, request_intervention, log_audit]
  writes_external: false
  needs_approval: false
allowed-tools: get_case, list_gaps, list_deadlines, list_hypotheses, get_audit, propose_action, request_approval, request_intervention, log_audit
---

# Next best action

## When to use
After reconciliation has run, to decide the one next step that most advances the
case.

## Procedure
1. **Read the state.** `get_case`, `list_gaps`, `list_deadlines`,
   `list_hypotheses`, `get_audit`.
2. **Build the candidate steps**, restricted to the permitted-action set from
   `chargeback-rules` at the current stage: request a specific missing evidence
   item; raise a chargeback; submit a representment; escalate to a human; or wait.
3. **Rank them** by:
   - **expected value** — does it close the top open `Gap` or decide between the
     leading hypotheses?
   - **deadline urgency** — from `deadline-tracking`.
   - **permission** — only permitted actions.
   - **dependency** — is it blocked on something else?
4. **Idempotency at the planning layer.** Before proposing, check `get_audit` and
   open `CaseAction`s. Never re-propose an action already proposed or done for the
   same purpose.
5. **Act or propose — never execute.**
   - Internal step (e.g. trigger more analysis): do it.
   - External or irreversible step: `propose_action(type, params, idempotency_key)`
     then `request_approval`. Then **stop**.
   - Ambiguous or out-of-policy: `request_intervention`.
6. `log_audit`.

## Output
Exactly one next step: performed if internal, or a proposed `CaseAction` awaiting
human approval if external.

## Guardrails
- **Never call `execute_action`.** External effects run in orchestration *after* a
  human approves.
- Propose exactly one next step, not a batch.
- Never move money or contact a merchant, scheme or customer without an approval.
- Never write `liability_outcome`.
