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

### How the dynamic selection works

The planner (`next_best_action` in `service.py`) runs a **build → filter →
score → propose** cycle every time the case changes.

**Current state generates the candidates.** Each run re-reads the case fresh —
open exceptions, evidence present, position confidences, the reason-code rules —
and candidates only exist if the state creates them: an open contradiction
produces "ask the cardholder who signed"; a missing required item produces
"request it from the merchant"; a merchant position of 70% or more with complete
evidence and no contradiction makes representment eligible. Different state,
different candidate set.

**Dependencies are a hard filter, applied before any scoring.** An action whose
precondition is not met is excluded, not down-ranked, and the blocker is written
down — `submit_representment: blocked by an open contradiction` — so "why didn't
you represent?" always has an audit-trail answer.

**Deadlines, authority and expected value are the score:**

```
score = P(success) × amount factor × deadline urgency × authority
```

- *Expected value* = the model's success probability × an amount factor
  (`min(amount/500, 1)`), so the same move is worth more on a bigger dispute.
- *Deadlines* multiply the score as the representment window closes (×1.2 inside
  15 days, ×1.5 inside 7, ×2.0 inside 48 hours) — and under 48 hours with no
  eligible action, the planner escalates to a person instead of proposing.
- *Authority* reads the live approval policy from the database: an action only
  the Team Lead can sign scores ×0.9 and the proposal says "needs team lead".
  Change the policy in Administration and the ranking follows, no code.

The winner is proposed with its full working attached to the audit entry:
`{"p_success": 0.692, "score": 0.18, "urgency": 1.0, "authority": 1.0,
"amount_factor": 0.26, "blocked": [...]}`.

**Why this is not a fixed happy path:** the recommendation changes as the state
does. At case open the planner asks the merchant for the delivery record
(P 76%). When that record arrives late and contradicts the cardholder, the
missing exception resolves, a contradiction opens, the positions flip — and the
planner drops the old recommendation and asks the cardholder who signed (P 69%),
while representment stays blocked by name. Resolve the contradiction with the
merchant position at 70%+ and representment becomes the top candidate. The same
code ran every time; the state chose a different action each time. The
re-evaluation trigger makes this automatic: any material evidence change re-runs
the journey, and the planner is its last step, so an outdated recommendation
cannot survive new facts.

One honest boundary: the candidate types are the permitted dispute actions from
the reason-code rules. The planner chooses dynamically *among permitted actions*
— which is what the requirement asks — and does not invent new action types.

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

### How partial-failure recovery works

The dangerous moment in a dispute system is not a clean failure — it is a
**timeout**. The bank sends "raise chargeback", the reply never comes back, and
now nobody knows whether the far side acted. Retry blind and you may raise it
twice; give up and you may miss the window. `execute_action` in `service.py` is
built around that moment.

**Every external action carries an idempotency key** — a unique name for the
business intent (`case : action type : purpose`), created when the action is
proposed, long before anything leaves the bank.

**Nothing executes without an approval on file.** The first thing
`execute_action` checks is a recorded `approve` decision from someone whose role
the policy accepts. No approval, no call — refused, on the record.

**The call has three honest outcomes, and each is handled:**

- **ok** — the far side confirms; the action is marked `done` with the external
  reference.
- **timeout** — the far side may or may not have acted. The action stays in
  `executing`, and the audit says so plainly:
  `action.timeout — uncertain, will reconcile on retry`. Nothing is assumed.
- **fail** — the far side rejected it; the action is marked `compensated` and
  the failure is on the record.

**A retry reconciles before it acts.** This is the heart of it. Before touching
the external world again, `execute_action` looks the idempotency key up in the
external system's own record. If the far side *did* complete the first time —
the reply was simply lost — the retry adopts that result, marks the action
`done`, and writes `action.reconciled — external state was completed; no second
effect`. Only if the external record shows nothing does the retry actually send
again. A refund can be retried all day and still happen once.

**You can run this live in the UI.** On an approved action, set the dropdown to
`external: timeout`, press **Execute** — the action hangs in `executing` with
the uncertainty audited — then press **Retry** and watch it reconcile with no
second effect. Set `external: fail` to see compensation instead. `smoke.py`
asserts all three paths, including that the external ledger holds exactly one
entry after a double execution.

**Why the external record is separate.** The demo's mock external world keeps
its own ledger, deliberately outside the case state — because that is the real
shape of the problem: your state and the network's state can disagree, and
recovery means asking *them*, not trusting yourself. The timeout mode even
completes on the far side while losing the reply, which is precisely the case
that breaks naive retry logic.

One honest boundary: the external world here is a mock, as the challenge
permits. A real connector would implement the same contract — accept an
idempotency key, answer "what happened to this key?" — which is the standard
pattern the card networks' APIs support, so the recovery logic carries over
unchanged.

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
- **Work queues with ownership** — a case can be **claimed** (atomic: first come,
  first served; a second claim is refused with the owner's name) and **reassigned
  by the Team Lead only**. The queue offers All / My queue / Unassigned views.
- **Urgency-ordered queue** — cases are listed with the days left on their
  representment window, most urgent first, not just oldest first.
- **Pull-based balancing** — "Take next case" claims the most urgent unassigned
  case for whoever presses it; a workload line shows open cases per person and
  how many sit unassigned. Two people pressing at once get two different cases.
- **One sign-off is enough** — approving an already-approved action is a no-op
  with a plain message, so a simultaneous double-approval cannot record twice.
- **Observability** — `/health`, `/metrics` and structured JSON logs.
