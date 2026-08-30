# Fix plan

From the principal-level review (2026-08-30). Ordered by severity; check off as fixed.

## Blockers

- [x] **1. Lock leak in `add_evidence`** — `service.py:1051-1070`
  Bare `lock.acquire()` / `lock.release()` around `run_journey`; any exception
  leaves the case RLock held forever and every later request on that case hangs.
  Fix: `with case_lock(cid):` (same pattern as `_attach_intake`).

- [x] **2. Case lock held across LLM network calls** — `agent.py:251`
  `run_agent` wraps up to 24 model turns (60s timeout each, × model chain) in
  `with S.case_lock(cid)` — the lock can be held for minutes, blocking FastAPI
  worker threads on any UI action for that case.
  Fix: hold the lock per tool execution, not per conversation.

- [x] **3. Nested payloads escape redaction** — `service.py:106-114`
  `redact()` walks only top-level string values; `{"note": {"text": "4111 …"}}`
  stores the PAN verbatim. `/api/ingest` accepts arbitrary JSON, so this is a
  live trust-boundary gap.
  Fix: recurse into dicts/lists.

- [x] **4. JSON matching by `LIKE` on serialized text** — `service.py:165`,
  `service.py:1297`, `service.py:1374`
  `payload LIKE '%"order_id":"…"%'` depends on `jd()`'s exact separators and is
  unescaped (`%`/`_` in values over-match). Feeds case attachment and
  supersession — a false positive attaches evidence to the wrong dispute.
  Fix: `WHERE json_extract(payload,'$.order_id')=?`.

## Fast-follows

- [x] **5. HTTP status inferred from error prose** — `app.py:366`, `app.py:417`
  `status_code=403 if "user" in r["error"] else 400`; service functions signal
  failure three ways ({"error"}, None, raise).
  Fix: one convention — e.g. raise `ServiceError(status, msg)` caught by a
  single FastAPI exception handler.

- [x] **6. Two sources of truth for the schema** — `schema.sql` vs `_ensure_*`
  (`service.py:861`, `service.py:1086`, `service.py:1259`)
  Five tables defined twice; already drifted (schema.sql's `intake_item` has
  CHECK constraints, `_ensure_intake`'s copy doesn't).
  Fix: fold the `_ensure_*` DDL into the defensive-migration block in `init_db`
  and delete the duplicates.

- [x] **7. `/api/actions/{aid}/execute` has no identity** — `app.py:320`
  No `X-User`, client-supplied `mode`; audit never records who executed.
  Fix: require a known user, record the executor in the audit entry.

## Smaller findings

- [x] **8. Timeline version churn** — `rebuild_timeline` runs on every
  `run_journey`, bumping the version even when the event set is unchanged —
  which flips `briefs_stale` and voids specialist reviews for a no-op change.
  Fix: skip the rebuild when the derived event set equals the current version's.

- [x] **9. CSV export escaping** — `app.py:296-317`
  `cases.csv` never quotes fields; `audit.csv` replaces `"` with `'` (lossy for
  an audit export). Fix: stdlib `csv.writer`.

- [x] **10. `/api/reset` unauthenticated + unsafe delete** — calls `os.remove`
  on the DB while other WAL connections may hold it open.
  Fix: require Team Lead (`X-User`), and prefer dropping/recreating content over
  removing the file under live connections.

- [x] **11. `ml.predict` lazily trains in a read path** — `ml.py:92-97`
  Scoring mutates `app_config` without owning the commit; harmless today only
  because seed always trains first.
  Fix: fail loudly (or train explicitly at boot) instead of training on read.

- [x] **12. `gap` kind `'duplicate'` declared but never opened** — duplicates
  are only marked on `evidence_item`. Fix: either open a duplicate gap in
  `duplicate_detection` or drop the kind from the schema CHECK.

- [x] **13. `/api/cases` N+1 queries** — `app.py:70-94`, ~4 queries per case.
  Fine at demo scale; flatten into one query if the case book grows.

## Functional gaps (SME review, 2026-08-30)

Domain-fit findings from the persona review. Ordered by leverage.

### High-leverage

- [x] **F1. Liability decision has no authority tiering** — `service.py:524`
  `record_decision` accepts any known user; raising a chargeback needs the Team
  Lead but deciding the case outcome needs nobody. Fix: role/amount-tier the
  decision (analyst to $X, lead above) via the same configurable policy table.

- [x] **F2. No maker–checker separation on the decision** — nothing compares
  `interpretation_reviewed.by` against the decider; one person can review and
  decide. Fix: reviewer ≠ decider enforced in `record_decision`.

- [x] **F3. Action menu lacks the most common real actions** — `schema.sql:91`
  No **deny dispute** (with compliant denial notice), **write off** (below
  cost-to-work threshold), or **credit-resolved close** (merchant credit already
  issued). "No recovery" exists as an outcome but the NBA can never recommend
  it. Fix: add the three action types; let the scorer consider write-off for
  low amounts.

- [x] **F4. Hypotheses/contradictions are hardcoded to delivery disputes** —
  `service.py:589`, `service.py:691`
  `CANDIDATE_HYPS` and the contradiction rule only model delivered-vs-not-
  received; for 13.3/10.4/12.6 the "competing positions" are nonsense. Fix:
  drive candidate hypotheses and contradiction rules from the reason-code rules
  config (they're already editable in Administration).

- [x] **F5. 10.4 recommends a chargeback the network would bounce** —
  `chargeback_rules` only checks an `auth_event` *exists*, not what it says; a
  successful 3DS auth generally removes the issuer's fraud chargeback right.
  Fix: eligibility check on auth-event content blocks `raise_chargeback` for
  10.4 with a successful 3DS, with the blocker named in the audit (the blocked-
  list machinery already exists).

- [x] **F6. Time limits anchor on "now" and reset on every journey run** —
  `service.py:723`
  `deadline_tracking` computes `now + window_days` (though `set_deadline` is
  first-write-wins, the anchor is still run time, not the event). Real limits
  anchor on transaction date, or expected-delivery date for 13.1, and never
  move. Fix: anchor on the case's transaction/expected-delivery date.

### Structural

- [x] **F7. Issuer and acquirer conflated into one actor** — the same menu
  offers `raise_chargeback` (issuer) and `submit_representment` (acquirer);
  one bank sits on one side. Fix: commit to the issuer side; action space
  becomes deny / write off / raise / pre-arb / accept re-presentment.

- [x] **F8. Lifecycle ends at the internal decision** — a raised chargeback
  lives on (re-presentment, pre-arb); closing at `record_decision` conflates
  "decided internally" with "dispute over" and corrupts the outcome label the
  README proposes retraining the NBA on. Fix: keep the case open through the
  network lifecycle; record network outcome separately from the internal
  liability decision.

- [x] **F9. No regulatory clocks** — Reg E 10-business-day provisional credit
  and 45/90-day investigation limits absent; `deadline` kinds `evidence_due`
  and `response_sla` exist in the schema but nothing sets them.
  (Acknowledged out of scope in README — listing so the scope decision stays
  deliberate.)

- [x] **F10. No provisional credit / accounting hooks** — no provisional
  credit, reversal-with-notice on denial, write-off posting, or GL linkage.
  A "Merchant favour" close is really a *claim denial* with mandated notice —
  currently indistinguishable from any other close.

### Smaller domain fixes

- [x] **F11. 12.6 required evidence is self-defeating** — duplicate processing
  requires `transaction_event`, which lane-1 auto-pull always supplies; proving
  a duplicate needs BOTH transactions (matching ARN/auth code). Fix: require
  two transaction events with distinct references.

- [x] **F12. No ARN on the case** — matching runs on txn_id/order_id/tracking;
  the Acquirer Reference Number is the key the dispute ecosystem matches on.
  Fix: add `arn` to the case + A0 exact-match tier.

- [x] **F13. Decision rationale not captured** — `record_decision` stores an
  outcome enum only. Fix: snapshot the basis (leading hypothesis + confidence,
  timeline version, brief ids) into the `liability.recorded` audit ref.
  (Pairs with fix 9 — the audit CSV must keep `ref`.)

- [x] **F14. `amount_factor` saturates at $500** — `service.py:764`
  a $500 and a $50,000 dispute prioritize identically. Fix: log-scale or raise
  the cap; keep the floor for write-off logic (F3).

- [x] **F15. No card-status linkage on fraud claims** — a 10.4 leaves the
  disputed card live; no block/reissue flag, no scheme fraud-report marker.
  Fix: minimal `card_status` note + audit entry on 10.4 open.

- [x] **F16. No merchant-credit resolution path in intake** — real unmatched
  queues are full of merchant credits that resolve disputes without a
  chargeback. Fix: A0 recognizes a credit matching a disputed amount and
  suggests credit-resolved close (F3's new action).

- [x] **F17. Ops reporting lacks the numbers ops runs on** — aging buckets,
  SLA breaches, recovery rate/value, win-loss by reason code. Fix: extend the
  Reports screen from the existing audit + case data; no new tables needed.

## UI & channels (UI review, 2026-08-30)

The console is strong on honesty labels, weakest where a human judges agent
output. Plus the cardholder channel and the LLM-first intake showpiece.

- [x] **U1. Approvals rows lack the basis to judge** — `static/app.js:110`
  No agent-originated flag, P(success), needs-role, or open-conflict marker on
  the row where the lead actually approves. Fix: extend `/api/approvals` +
  render provenance and basis chips.

- [x] **U2. Agent reasoning invisible** — transcripts persisted in `agent_run`
  and returned by the API are never rendered; audit `ref` payloads (score
  breakdowns, decision basis) dropped. Fix: expandable transcripts in the
  Agent-runs panel; a "basis" expander on audit rows.

- [x] **U3. Deadlines never rendered** — `v.deadlines` is in every case payload
  and no component reads it; F9's clocks are invisible. Fix: a Clocks panel on
  the case view.

- [x] **U4. Decision tab contradicts the fixed backend** — `static/app.js:400`
  Representment wording (F7), "& close" on a decision that now stays open (F8),
  no network-outcome control, no four-eyes hint (F2), fake "Generate cardholder
  notice" button. Fix wording, add network won/lost controls, self-review note,
  delete the fake button.

- [x] **U5. Reports/Dashboard ignore the ops and agent-health numbers** —
  `/api/reports` (F17) unrendered; no LLM on/off indicator; fallbacks/tokens
  only in the 11px top-bar string. Fix: render reports; agent-health KPIs;
  `llm_enabled` in `/metrics`.

- [x] **U6. The no-code program is invisible to its administrator** — souls
  truncated at 150 chars, skills unviewable, F4's hypotheses/contradiction
  config absent from the rules editor. Fix: full souls, read-only skill viewer
  (`/api/skills`), reasoning-config summary per reason code.

- [x] **U7. Cardholder view (simulated channel)** — the register's cardholder
  asks currently dead-end. New screen: minimal server-side view (status, their
  asks, their clock — never the merchant's evidence or the assessment), and a
  respond box wired to `/api/ingest` so an answer fulfils the open ask.

- [x] **U8. Conversational-intake agent (LLM-first showpiece)** — cardholder
  describes the dispute in plain language; the agent structures it into the
  fixed form (reason code, amount, merchant); the person confirms before the
  case is raised; free text is recorded as the statement, redacted, never
  executed. Falls back to the manual form when the LLM is off.

- [x] **U9. Small staleness fixes** — every delivery record shows "late · new"
  (`app.js:305`); contradiction banner hardcodes "moved to the merchant"
  (`app.js:279`); exception fallback text is delivery-specific (`app.js:354`);
  Reset rendered for non-leads; no ARN field on the raise form (F12).

## Personas & minimalist pass (UI/UX review, 2026-08-30)

Personas map to roles, not separate UIs. Copy test: would this persona say
this sentence to a colleague?

- [x] **P1. Named persona users + roles** — replace "User 1/User 2" with named
  users (R. Mehta, A. Okafor — analysts; S. Iyer — team lead) and add read-only
  roles: J. Cruz (ops manager), Auditor. Server-side `can_work` gate on
  claim/raise/intake-resolve/review/evidence/execute for read-only roles.

- [x] **P2. Role-aligned navigation and controls** — nav filtered per role;
  landing screen per role (analyst→queue, lead→approvals, ops→dashboard,
  auditor→reports); controls a role cannot use are not rendered (reassign,
  rules save, approve/execute, decide, raise, intake actions).

- [x] **P3. Cardholder page speaks to the cardholder** — remove the
  architecture narration from the page voice; one short operator line marks it
  a simulated channel; nav group "Channels" → "Simulation".

- [x] **P4. Demo controls off the primary action bar** — simulation buttons
  (inject/correct/cold) behind a "Demo scenarios" expander; the bar keeps the
  operator actions (run agents, advocate briefs, agent runs).

- [x] **P5. Add-evidence form collapsed** — seven standing inputs become one
  button on the Evidence panel.

- [x] **P6. One "Waiting on" panel** — merge Clocks and Requests (both are
  waiting-on-time/parties views).

- [x] **P7. Trim the narration** — panel captions that re-explain virtues
  ("both kept", "the visible delta", "anchored on the event…") cut or shortened
  to data; drop the audit-entry counter and "N of M" tally; Case-tab Liability
  panel becomes a status suffix on the case header (Decision tab owns the act).

- [x] **P8. Business vocabulary** — souls→Mandate; "Run no-code (LLM)"→"Run
  the agents"; "Hear both sides (LLM)"→"Prepare advocate briefs"; "Run A0
  (LLM)"→"Auto-triage"; "Case assessment · both kept"→"Working positions";
  named sign-in ("R. Mehta · Dispute analyst"); cardholder-page copy in the
  cardholder's own words.

## Solution Architect (2026-08-30)

Runtime is single-node by construction; logical seams are production-shaped.
Phase 1 = must land before any topology change or real deployment.

### Phase 1 — unpin the runtime

- [ ] **S1. DB-level per-case locking** — `service.py:43`
  `threading.RLock` is process-local: two workers/replicas interleave journeys
  on the same case silently (double timeline versions, racing supersessions).
  Fix: `BEGIN IMMEDIATE` per case transaction (SQLite) /
  `pg_advisory_xact_lock(hash(case_id))` (Postgres). Gate scale-out on this.

- [x] **S2. Async agent runs** — `/run-agent` holds an HTTP thread for up to
  24 model turns; gateway timeouts kill runs mid-flight with no resumable
  record. Fix: enqueue → return run_id → UI polls `agent_run` (the table is
  already the job record); grow the `CARD_DISPUTE_WORKER` sweeper into the
  worker tier.

  **Design note (from the ii-agent PiNativeAgent review, 2026-08-30).**
  What to adopt from `awsbancs-mcp-server/ii-agent`:
  - *Transport never executes*: the handler does `asyncio.create_task(...)` /
    `anyio.to_thread.run_sync(agent.run_agent, ..., abandon_on_cancel=True)`
    and returns; execution lives on a worker thread (ws_server.py:2004,2792).
    Ours: POST /run-agent → insert `agent_run(status='queued')` → return
    run_id → daemon worker executes → UI polls.
  - *Incremental durable event log*: they `save_event()` per event as the run
    progresses; we insert the transcript once at completion — a crash loses
    the partial record. Write transcript entries incrementally with a
    `status` column (queued/running/complete/fell_back).
  - *Cooperative cancellation*: an `interrupted` flag checked at turn
    boundaries (pi_native_agent.py:434,601,644). Cheap to add to run_agent.
  - What NOT to adopt: WebSocket transport (our events are tool-call-grained,
    polling suffices); in-memory session/task registries keyed by connection
    (same process-local trap as our RLock — their construct is also
    single-node); in-memory approval gates (RunEventBus.wait_approval is a
    threading.Event with a 120s timeout, lost on restart — our DB-backed
    approvals are already the stronger, bank-grade construct; keep ours).

- [ ] **S3. Real identity** — swap `X-User` for OIDC/JWT; `USERS` becomes a
  directory lookup, roles come from claims. Boundary is already server-side,
  change is localized.

- [ ] **S4. Govern the control plane** — `save_rules`/`save_policy` write
  config with NO audit entry (audit_entry requires case_id — the schema gap).
  A lead can silently change who approves a chargeback. Fix: caseless audit
  path + dual control on policy changes; move `DECISION_LEAD_LIMIT` into the
  policy config with everything else.

- [ ] **S5. Version the agent's instructions** — `agent_run` records tool
  calls but not which SKILL.md/mandate text the agent followed. Fix: content
  hash of each skill read + mandate, stamped into the transcript.

- [ ] **S6. Cost/abuse controls on ingest** — unauthenticated `/api/ingest`
  auto-triggers paid A0 model runs when the LLM is on (`app.py:385`). Fix:
  channel auth (mTLS/API key) + a spend budget; the behaviour guardrails do
  not guard cost.

- [ ] **S7. Authorization on the cardholder endpoint** —
  `/api/cardholder/{cid}` returns any case's minimized view to anyone (IDOR).
  Bind to channel identity when the simulation becomes real.

### Phase 2 — join the estate

- [ ] **S8. Postgres port** — json_extract→jsonb, INSERT OR REPLACE→ON
  CONFLICT, replace PRAGMA-based migrations with a schema_version table.
- [ ] **S9. Transactional outbox** — nothing emits events (case decided,
  chargeback raised) for downstream consumers; write outbox rows in the same
  transaction as the audit entry.
- [ ] **S10. Observability retrofit** — `/metrics` in Prometheus exposition
  format; correlation id from HTTP request → journey → audit → agent run.
- [ ] **S11. Executing-action reconciliation sweep** — an action left
  `executing` after a timeout waits for a human Retry; production wants a
  periodic reconcile pass over `status='executing'`.
- [ ] **S12. Split derived artifacts out of the audit table** — briefs and
  review stamps live in audit rows; retention/archival on audit would delete
  them. Audit stays append-only evidence; artifacts get their own table.

### Phase 3 — scale and operate

- [ ] **S13. Worker fleet** for journeys + agent runs; audit archival; spend
  budgets and scheduled eval.py runs as drift monitoring.

## Regulatory SLA & reporting gaps (domain Q&A, 2026-08-30)

SLAs are fixed by the regulator and vary by country; today's clocks are
hardcoded Reg E-flavour constants and nothing happens when they breach.

- [ ] **R1. Per-jurisdiction SLA config** — `service.py` `deadline_tracking`
  hardcodes +14d (provisional-credit decision) and +45d (investigation);
  regulators differ (Reg E 10 business days / 45–90d; RBI limited-liability
  shadow credit in 10 working days + TAT harmonisation; PSD2 D+1 refund).
  Fix: move the clock set into `app_config` beside the reason rules, editable
  in Administration (team lead, dual-control per S4); pick the set per
  deployment, not per code change. Include business-day arithmetic — the
  "+14 calendar ≈ 10 business days" shortcut is marked ponytail already.

- [ ] **R2. Clock breaches have no consequence** — `deadline.status` is never
  set to `met`/`missed`; a passed `response_sla` (provisional-credit decision
  due) or `evidence_due` (investigation limit) changes nothing. Fix: a review
  pass alongside `review_requests` that marks breached clocks `missed`, opens
  an intervention for regulatory clocks (a missed Reg E clock is a compliance
  event, not a backlog item), and records `met` with the date when the gating
  event lands (PC decision = the liability decision or denial; investigation
  end = case resolution). Show breach state on the Waiting-on panel.

- [ ] **R3. Regulatory MIS pack** — regulators receive complaint volumes,
  ageing, and TAT compliance; `/api/reports` has aging/outcomes/breaches but
  no TAT view and no export. Fix: extend `report_summary` with per-clock
  compliance (met/missed/pending counts, median days-to-decision, cases past
  the investigation limit) and add `regulatory.csv` to the export endpoint —
  the period pack an ops manager files, built from the audit trail that
  already timestamps every event.

## Verify

- `python smoke.py` after each fix; add one assert per behavioral fix
  (1: exception during journey releases the lock; 3: nested PAN masked;
  4: `%` in a tracking value doesn't over-match; 8: no version bump on a
  no-op rebuild).
- Functional gaps: extend smoke.py per fix — F1/F2: analyst-over-limit and
  self-review both refused; F4: a 10.4 case gets fraud hypotheses, not
  delivery ones; F5: successful 3DS blocks `raise_chargeback` with the
  blocker in the audit; F6: deadline unchanged after a second journey run;
  F11: one transaction event no longer satisfies 12.6.
