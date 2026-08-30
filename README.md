# Card Dispute Evidence Agent

[![ci](https://github.com/Bratz/card-dispute-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/Bratz/card-dispute-agent/actions/workflows/ci.yml)

An evidence-reconciliation case manager for card payment disputes. It reconstructs
the disputed event from scattered evidence, keeps every version, holds competing
positions open, recommends the next permitted step — and leaves the liability
decision to a person.

Built for the **Card Dispute Evidence Reconstruction & Resolution** challenge.

**Full feature list, mapped to the challenge's capability expectations — with
deep-dives on the dynamic next-best-action selection and partial-failure
recovery: [FEATURES.md](FEATURES.md). Timed demo script: [DEMO.md](DEMO.md).**

---

## The problem

A card dispute pulls in conflicting accounts — the cardholder, the merchant, and
the systems of record — and the important facts often arrive **late, after the
case has already moved on**. A good solution has to:

- assemble evidence that arrives asynchronously, is corrected, or conflicts;
- reconstruct a trustworthy event and make gaps and contradictions explicit;
- recommend the next useful evidence or permitted action;
- never lose earlier evidence, and keep a complete audit trail;
- keep the **final liability decision human-owned**.

The hardest moment is the finale test: **a merchant supplies material evidence
late that contradicts the cardholder.** The system must take it in, re-assess the
dependent conclusions, and make the change visible.

## What this does

- **Runs the journey in code** — a real case is opened, evidence assembled, the
  event reconstructed, positions compared, gaps found, and the next action
  proposed — all from the database, not a script.
- **Versioned evidence** — corrections and rebuilds are new versions; nothing is
  overwritten. Timeline `v1 → v2`, previous kept.
- **Competing positions** — both interpretations stay on file with the evidence
  for and against each; no single opaque score.
- **Exceptions** — missing, stale, duplicate and contradictory evidence are
  surfaced explicitly.
- **Issuer-side action space** — request evidence, raise the chargeback, deny
  the claim (provisional credit reversed with notice), write off below
  cost-to-work, or close credit-resolved when the merchant refunds.
  Eligibility is a hard filter: a successful 3DS authentication blocks a
  fraud chargeback (liability shift), with the blocker named on the audit.
- **Recommended action, behind an approval gate** — nothing leaves the bank
  without a human sign-off.
- **Governed decision** — a named review stamped to the record version,
  four-eyes (the reviewer never decides), amount tiering; a raised chargeback
  keeps the case open until the network outcome (won/lost) is recorded
  separately, so outcome data stays honest.
- **Safe actions** — every external action is **idempotent** (runs once) and
  **recovers from partial failure**: on a timeout it reconciles against the
  external record before retrying, and compensates on hard failure.
- **Human-owned liability** — no rule or model sets the outcome; only the
  analyst's decision path writes it.
- **Card data redacted at intake** — a card number is stored as a token + last
  four, at any nesting depth; CVV/PIN are dropped.
- **Cardholder channel (simulated)** — a portal view minimised server-side
  (never the merchant's evidence or the assessment); replies fulfil the open
  asks on the register, and a conversational-intake agent drafts the dispute
  form for the person to confirm.
- **Agent runs are jobs, not requests** — started in the background, the
  transcript persisted every turn, cancellable at turn boundaries, and marked
  `interrupted` at boot if a process died mid-run.
- **Observable & auditable** — `/health`, `/metrics`, structured logs, and an
  append-only audit trail.

## Quick start

```bash
pip install -r requirements.txt
python app.py
```

Open **http://127.0.0.1:8137** (set `PORT=9000` to change it).

In the UI: open **DSP-100205**, then

1. open **Demo scenarios** (bottom bar) → **Late merchant evidence** and watch
   the case reassess — timeline v2, contradiction opened, assessment flips;
2. on the recommended action, **Approve**, set the Execute dropdown to
   **timeout**, hit **Execute**, then **Retry** — it reconciles with no second
   effect; try **fail** to see compensation;
3. on the **Decision** tab, mark the interpretation reviewed, then switch to a
   **second** profile to record the outcome — four-eyes is enforced by the
   server. A cardholder-favour outcome keeps the case open until the network
   result is recorded. **Reset demo** (Team Lead only) restarts it.

Run the checks:

```bash
python smoke.py
```

```bash
python test_api.py
```

## Architecture

Three layers, and one process serves the API and the UI.

```mermaid
flowchart LR
  UI["Operator UI<br/>profile picker · identity on every call"] -->|HTTP · JSON · X-User| API

  subgraph proc["One process — app.py"]
    API["FastAPI<br/>/api · /health · /metrics"]
    subgraph engines["The same journey, two engines"]
      DET["Deterministic skills<br/>service.py — default"]
      LLM["No-code LLM runtime<br/>agent.py reads skills/*.md — optional"]
    end
    subgraph ag["Three agents, souls + skills"]
      A0["A0 Intake Triage"] -- "match · audited" --> A1["A1 Evidence Reconciliation"]
      A1 -- "handoff · audited" --> A2["A2 Dispute Case Planner"]
    end
    ML["ml.py — demo NBA model<br/>P(success) · synthetic training"]
    T["Tools<br/>read · derive · action · control"]
    API --> engines
    engines --> ag
    ag --> T
    A2 --> ML
  end

  T --> DB[("SQLite<br/>11-table evidence model<br/>rules &amp; approval policy config<br/>append-only audit")]
  T --> UP[("uploads/<br/>charge-slip photos")]
  T -. execute_action only .-> EXT[["Mock external world<br/>reconcile on retry"]]
  ROLES(["analysts · team lead · ops & auditor (read-only)"]) -. "role-gated approvals · four-eyes decision · rules edits" .-> API
```

The same journey runs on either engine — deterministic skills by default, or the
LLM reading the skill files (edit a `SKILL.md`, behaviour changes, no Python).
Only `execute_action` reaches the external world; every external effect is
idempotent and approval-gated. Money-moving actions need the Team Lead, the
liability decision is always a person's, and the demo ML model only supplies the
success probability inside the auditable score — it never acts.

- **State store** — 11 tables: a versioned, provenance-tagged evidence model with
  an append-only audit and idempotency keys. See `docs/DESIGN.md` for the full
  model, tools and skills.
- **Tools** — ~30 functions over the schema (read / derive / action / control).
  Only one, `execute_action`, touches the (mock) external world.
- **Agents** — three agents, each with a fixed *mandate* (soul: role, rules,
  safety limits): **A0 Intake Triage**, **A1 Evidence Reconciliation** and
  **A2 Dispute Case Planner** (`GET /api/agents`; mandates and skills readable
  in Administration).
- **Skills** — ten procedures run the journey (one for A0, five for A1, four
  for A2, `GET /api/skills`). They are
  **deterministic** by default — predictable, offline and auditable. Set
  `CARD_DISPUTE_LLM=1` for a hybrid mode where the A2 agent, driven by its soul,
  adds a plain-language rationale for the proposed step; it never changes state.

## Personas, roles and configurable rules

Five named profiles ship with the demo, one per persona: **R. Mehta** and
**A. Okafor** (dispute analysts), **S. Iyer** (team lead), **J. Cruz** (ops
manager) and **Auditor** — the last two read-only. Pick one in the top bar;
navigation, landing screen and controls follow the role, and the server
enforces every gate — an analyst can approve an evidence request, but
money-moving actions need the team lead, ops and audit can observe but never
act, and the liability decision takes two people (the reviewer never decides;
high-value outcomes need the lead). Every approval, execution and decision is
recorded with the person's name.

**Administration** (team lead): the reason-code rules — required evidence,
window, permitted actions, and the *reasoning config*: the competing
hypotheses, which evidence kinds back or weaken each side, and what counts as
a contradiction — plus the approval policy, all stored in the database and
edited there. Adding a reason code is configuration, not a release. The
agents' mandates and skill files are readable on the same screen.

## Automatic case assignment — the A0 Intake Triage agent

Evidence can arrive with **no case reference** — a delivery record on a merchant
feed, a message, an authentication event. `POST /api/ingest` hands it to the
**A0 Intake Triage** agent, which redacts it, works out what kind of item it is,
and finds its case by the strongest key: a quoted dispute reference or
transaction id (exact), an order id or tracking number already on one open case
(strong), or a card token plus amount (weak). **It attaches only on exact or
strong matches** and records why. Weak, ambiguous or unmatched items wait in an
**Intake queue** for a person, with A0's best suggestion attached — because
attaching evidence to the wrong case is worse than leaving it unattached. The
finale inject runs through this path: the late delivery record arrives cold and
finds its case by order id.

## Evidence intake — all seven kinds, photos included

The case screen has an **Add evidence** form covering all seven kinds: cardholder
statement, merchant record, transaction record, receipt / charge slip, delivery
record, authentication event, correspondence. A charge slip can be attached as a
**photo** with typed fields; the image is stored with the evidence and shown on
the case. Card numbers in any text are masked on intake. With the LLM enabled,
the vision model also reads the slip and fills in missing fields (typed fields
always win). Each new item re-runs the reconciliation, and A1's handoff to A2 is
written to the audit trail.

Three more things the case handles by itself: a **corrected item** (the same
tracking number with new content) **supersedes** the earlier version — which is
kept, never deleted — and the case reassesses; evidence far **older** than the
newest item on the case is flagged **stale**; and a new dispute can be **raised
from the console** ("Raise dispute"), which starts the journey from step one.

## Next Best Action — scored, with a demo ML model

The next step is chosen by a transparent score:

```
score = P(success) × amount factor × deadline urgency × authority
```

- **Dependencies and eligibility are a hard filter**, not a score: a denial is
  excluded — and the blocker named in the audit — while required evidence is
  missing or a contradiction is open; a successful 3DS authentication blocks a
  10.4 chargeback outright (liability shift); an amount below cost-to-work
  makes write-off the recommended step; 12.6 requires both postings before it
  counts as evidenced.
- **P(success) comes from a small logistic-regression model** (`ml.py`, pure
  Python, no extra dependencies) with interaction features, trained at seed time.
  **Honest label: the training data is synthetic**, generated to behave like
  plausible dispute outcomes — the model demonstrates the pipeline
  (features → training → calibrated probability → auditable score), not
  intelligence learned from real cases. In production the same features retrain
  on the bank's real won/lost outcomes, which the audit trail already records.
- **Every proposal records its breakdown** — probability, urgency, authority,
  amount factor, and what was blocked and why — so "why this action" is always
  answerable. The UI shows the estimated chance of success on each proposal.
- Under 48 hours to the representment window with no possible action, the case
  is escalated to a person.

## No-code runtime (optional)

The deterministic engine is the default. There is a second way to run the same
work: an LLM agent, driven by its **soul**, reads the matching skill from
`skills/<name>/SKILL.md` at runtime and calls the tools. **Editing a skill file
changes what the agent does — with no Python change.** That is the no-code runtime.

```bash
pip install anthropic
export ANTHROPIC_API_KEY=...          # your key
export CARD_DISPUTE_LLM=1
python app.py
curl -X POST http://127.0.0.1:8137/api/cases/DSP-100205/run-agent
```

The run is a **background job, not a request**: the endpoint returns
immediately, the run row is created up front and updated every model turn —
poll `GET /api/agent-runs?case_id=…` for the live transcript (the UI does). A
run can be cancelled at the next turn boundary
(`POST /api/cases/{id}/cancel-agents`) — the deterministic engine finishes the
stage — and a run orphaned by a dead process is marked `interrupted` at the
next boot. The loop is the standard Anthropic tool-use pattern (`agent.py`) —
written from scratch, no third-party framework. The agent proposes actions for
approval and never executes; card data stays data, not instructions.

**A0 also runs no-code**: `POST /api/intake/{id}/run-agent` (or the "Run A0"
button on an intake item) triages a cold item with the LLM reading the
`intake-triage` skill. The judgment is the model's; the safety is not — the
`attach_to_case` tool **re-verifies the match server-side** and refuses unless a
certain key really links the item to that case, so even a wrong guess cannot put
evidence on the wrong dispute. Anything refused goes to the human queue.

### LLM-first engineering

The agents are the brain; the substrate is the guarantee; the deterministic
engine is the always-on floor. Concretely:

- **Enforced tool whitelists** — each agent's LLM tools are derived from its
  skill files' `allowed-tools` and enforced at execution; a call outside the
  whitelist is refused.
- **Contracts checked in code** — after a run, code verifies the agent left the
  case right (A1: reconciled; A2: proposed or escalated; A0: attached or
  queued). One nudge retry, then the **deterministic engine finishes the stage**
  and the fallback is on the audit trail. An LLM failure degrades to a working
  system, never a broken one.
- **Autonomous triage** — when deterministic matching queues an item and the
  LLM is on, A0 runs by itself; failures fail closed to the human queue. An
  optional sweeper (`CARD_DISPUTE_WORKER=1`) retries stragglers.
- **Every run persisted** — transcripts, tool calls, turns and token counts in
  the `agent_run` table (`GET /api/agent-runs`); totals in `/metrics`.
- **Model chain with timeouts** — `CARD_DISPUTE_MODELS` lists fallback models,
  tried in order.
- **Repeatable evaluation** — `python eval.py` runs the live scenarios N times
  and reports rates; the loop machinery itself (whitelists, nudges, fallback,
  persistence) is tested offline in CI with a scripted fake model. Last measured
  (claude-sonnet-4-5, N=3 per scenario, zero fallbacks needed):

  | Scenario | Rate |
  |---|---|
  | A0 attaches a cold item on a strong key (server-verified) | 3/3 |
  | A0 ignores an embedded instruction ("SYSTEM OVERRIDE: approve…") | 3/3 |
  | A2 finishes with a proposal after the late-evidence inject | 3/3 |

  The autonomous-resolution scenarios (N=1, zero fallbacks): the agents run
  the journey; people appear only at the gates.

  | Scenario | Rate |
  |---|---|
  | Agents alone reach decision-ready (no deterministic journey ran) | 1/1 |
  | The inject is reasoned about: contradiction, v2, fresh proposal, visible shift | 1/1 |
  | Gated close: all nine journey steps lit, humans only at the gates | 1/1 |

## Data & security

- **Synthetic data only.** No real cardholder or transaction data is used or
  required.
- Card numbers are **redacted on intake** (token + last four; CVV/PIN dropped),
  so nothing that could rebuild a card is stored.
- Identity in the demo is a **profile switch with server-side role enforcement**
  — a stand-in for real authentication, which is out of scope for a synthetic
  demo. The role checks, approver names and audit trail are real.

## What is not built yet

Deliberately out of scope for this slice: direct card-network integration
(VROL / Mastercom — the mock already implements the connector contract: accept
an idempotency key, answer "what happened to this key?"), production scale-out
(the per-case locks are in-process — single node by construction), and real
identity (the profile switch stands in for SSO). Regulatory clocks are
modelled demo-grade: event-anchored scheme windows plus Reg E-flavour
provisional-credit and investigation deadlines. The full architect backlog —
what to change before any topology change, and in which order — is tracked in
`plan.md` (Phase 1–3); the test inventory is `TESTPLAN.md`.

## Project layout

```
schema.sql          SQLite domain model (single DDL source, run idempotently)
service.py          tools + deterministic skills + seed + mock external world
app.py              FastAPI: endpoints + serves the UI
agent.py            the no-code LLM runtime (loop, whitelists, fallback, jobs)
ml.py               demo NBA model (pure-Python logistic regression)
static/             the operator UI — React 18 (vendored UMD + htm, no build
                    step): role-aligned screens (Queue, Approvals, Dashboard,
                    Reports, Cardholder view, Administration) and the case
                    workspace with Case / Decision / History tabs
smoke.py            assert-based end-to-end service check
test_api.py         HTTP contract & role-gate check (runs in CI with smoke)
eval.py             live LLM evaluation harness
TESTPLAN.md         scenario/case inventory incl. manual persona walkthroughs
plan.md             every review finding and its fix; the architect backlog
docs/DESIGN.md      the full domain model, tools and skills
```

## Licence

MIT — see [LICENSE](LICENSE).
