# Feature list

Every feature below exists in this repository and is covered by `smoke.py` or a
demo control in the UI. The seven headings are the challenge's own capability
expectations, word for word in short form.

## 1. A durable domain model — late, corrected or conflicting versions, nothing lost

- **Seven evidence kinds in one model** — customer statements, merchant records,
  transaction events, receipts, delivery records, authentication events and
  correspondence, linked to the case with a common shape.
- **Version chain** — a corrected item (same tracking number, new content)
  supersedes the earlier version; the old one is kept, never deleted, and the
  audit says `evidence.corrected`.
- **Late arrival handled cold** — evidence with no case reference is matched to
  its case by the A0 Intake Triage agent; the finale scenario runs this way.
- **Conflicting versions surfaced, not merged** — a delivery record that
  contradicts the cardholder opens a contradiction exception; nobody quietly
  picks a side.
- **Duplicates marked, not counted twice** — a resent receipt is tagged
  `duplicate` and points at the original.
- **Idempotent ingest** — the same item arriving twice (same content hash) is
  stored once.
- **Charge-slip photos** — an image is stored with the evidence and shown on the
  case; with the LLM enabled, a vision read fills missing typed fields.
- **Card data redacted at intake** — card numbers become a token plus last four;
  CVV, PIN and track data are dropped before anything is stored.

## 2. Next-best action from state, deadlines, dependencies, authority and expected value

- **A scored ranking, not a fixed path** —
  `score = P(success) × amount factor × deadline urgency × authority`.
- **Expected value** — the success probability comes from a small ML model
  (pure-Python logistic regression; trained on synthetic outcomes and labelled
  as such; retrains on real outcomes without a refactor).
- **Dependencies are a hard filter** — a representment is excluded while required
  evidence is missing or a contradiction is open, and the blocker is named.
- **Deadlines drive urgency** — the score rises as the representment window
  closes; under 48 hours with no possible action, the case escalates to a person.
- **Authority-aware** — the ranking reads the live approval policy, and each
  proposal says who must sign it off.
- **Every proposal shows its working** — probability, urgency, authority, amount
  factor and the blocked list are written to the audit trail; the UI shows the
  estimated chance of success.

## 3. Long-running state, deadlines and no repeated actions

- **The case is the database** — evidence, positions, gaps, deadlines, actions
  and approvals are durable rows; a restart loses nothing, and an approval can
  wait a day for a different person.
- **Deadlines per reason code** — the representment window is derived from the
  configurable rules and tracked to met or missed.
- **Actions run once, ever** — every external action carries a unique idempotency
  key; firing it twice returns the first result.
- **No duplicate requests** — proposals are keyed by purpose, so the planner
  never re-proposes what is already proposed or done.
- **Cross-step dependencies** — an action blocked by missing evidence stays
  excluded until the evidence lands.

## 4. Competing interpretations, uncertainty in the open

- **Both positions stay on file** — cardholder-favour and merchant-favour, each
  with a confidence score; neither is hidden when the other leads.
- **Evidence linked with a direction** — each item supports, weakens or
  neutralises a position, with a weight; confidence moves only when the links move.
- **Four kinds of exception, all explicit** — missing, stale (dated evidence far
  older than the newest), duplicate, and contradiction.
- **Reassessment is visible** — after the late evidence, the leading position
  flips on screen and the shift is in the audit trail.

## 5. Versioned state, provenance, and the five-way separation

- **Source-level provenance** — every item records its source system, authority
  tier (first party, second party, authoritative) and supplier.
- **Recorded fact vs AI inference vs user input** — tagged on every evidence item;
  the reconstructed timeline is always marked as inference.
- **Automated action and human decision kept apart** — actions live in their own
  table with their approval; the liability outcome has no machine path at all
  and is written only by a named analyst.
- **Timeline versions** — every rebuild is a new version; earlier versions stay
  readable.

## 6. Coordinated tools and agents, safe through partial failure

- **Three agents with audited handoffs** — A0 Intake Triage matches, A1 Evidence
  Reconciliation rebuilds, A2 Dispute Case Planner proposes; each handoff is an
  audit event.
- **Two engines for the same journey** — deterministic skills by default, or the
  no-code runtime where the LLM reads each agent's `SKILL.md` and calls the same
  tools; editing a skill file changes behaviour with no code change.
- **Permission checks before execution** — an action refuses to run without an
  approval on file from someone whose role the policy accepts.
- **Timeouts reconciled, not retried blind** — after a timeout the retry checks
  the external record first and completes with no second effect if the far side
  already acted.
- **Compensation on hard failure** — a failed external action is marked
  compensated, on the record.
- **A server-verified attach for the LLM path** — A0's attach tool re-runs the
  deterministic matcher and refuses unless a certain key links the item to the
  case, so a wrong guess cannot reach the wrong dispute.

## 7. Roles, approval gates, audit replay, configurable boundaries

- **Three working profiles** — Team Lead, User 1 and User 2, enforced
  server-side: money-moving actions need the Team Lead; approvals and the
  liability decision record the person's name.
- **Configurable action boundaries** — the reason-code rules (required evidence,
  windows, permitted actions) and the approval policy are data, edited in the
  Administration screen by the Team Lead, no code change.
- **Append-only audit trail** — every evidence change, score, approval, handoff,
  refusal and decision, in order, with reasons; together with the version
  history a reviewer can reconstruct what the system knew, why it acted and what
  changed afterward.
- **Human triage queue** — items the matcher will not attach wait for a person,
  with the agent's best suggestion; anything unclear escalates rather than guesses.
- **Observability** — `/health`, `/metrics` and structured JSON logs.
