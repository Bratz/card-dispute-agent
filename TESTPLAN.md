# Test plan — Card Dispute Evidence Agent

Scope: the whole system — deterministic engine, LLM runtime, API, UI, channels.
Three automation layers plus manual UI walkthroughs:

| Layer | Runner | What it proves | Needs |
|---|---|---|---|
| Service | `python smoke.py` | domain logic, versioning, gates, LLM loop machinery (fake model) | nothing |
| API | `python test_api.py` | HTTP contract, status codes, role gates over the wire | nothing |
| Live LLM | `python eval.py [N]` | real-model completion and guardrail rates | `ANTHROPIC_API_KEY`, `CARD_DISPUTE_LLM=1` |
| UI | manual walkthroughs (TS-16) | persona alignment, rendering | `python app.py` |

Conventions: every automated case is assert-based; smoke/test_api recreate the
database, so never run them against a database you care about. IDs below are
stable — reference them in bug reports.

---

## TS-01 Case lifecycle & journey

| ID | Case | Steps | Expected | Automated in |
|---|---|---|---|---|
| 01-1 | Seeded case opens mid-journey | reset + seed | DSP-100205 active, six evidence kinds, timeline v1 (2 events) | smoke |
| 01-2 | Journey steps derive from the record | fetch case view | steps 1–3,5–7 lit; 8–9 not | smoke |
| 01-3 | Late evidence moves a step back | store briefs, then add a new dated event | "Narratives compared" un-lights; review voided | smoke |
| 01-4 | Raise dispute from the console | POST /api/cases as analyst | new DSP id; journey ran; lane-1 pulls arrived | smoke, test_api |
| 01-5 | Raise refused for read-only role | raise as ops | error "read-only role", 403 | smoke, test_api |
| 01-6 | A1→A2 handoff on the audit trail | run journey | `case.handoff` entry present | smoke |

## TS-02 Evidence versioning & corrections

| ID | Case | Steps | Expected | Automated in |
|---|---|---|---|---|
| 02-1 | Idempotent ingest | add identical payload twice | one active item (content hash) | smoke (implicit) |
| 02-2 | Correction supersedes, never deletes | same tracking number, new content | old `superseded` + kept; new active; timeline rebuilt | smoke |
| 02-3 | Correction re-links fulfilment | correction after a fulfilled ask | request stays `fulfilled`, points at new evidence id | smoke |
| 02-4 | Duplicate detection | resent receipt (same order id) | second marked `duplicate` + duplicate gap opened | smoke |
| 02-5 | Stale flagging | item ≥30 days older than newest dated | `stale` gap; undated items never flagged | smoke |
| 02-6 | No-op rebuild is version-stable | rebuild with unchanged events | version does not bump; briefs stay current | smoke |
| 02-7 | Provenance calibration | run journey | authoritative=1.0, user_input=0.5, second-hand=0.6 | smoke |

## TS-03 Redaction & data handling

| ID | Case | Steps | Expected | Automated in |
|---|---|---|---|---|
| 03-1 | PAN masked in flat text | statement containing a Luhn-valid PAN | `token_… ••••1234`; raw digits absent | smoke |
| 03-2 | PAN masked in nested payloads | dict/list nesting around the PAN | all occurrences masked | smoke |
| 03-3 | CVV/PIN dropped | payload with cvv/pin/track keys | keys absent from stored payload | manual/api spot-check |
| 03-4 | Non-Luhn numbers untouched | 16 digits failing Luhn | left as-is | covered by 03-1 pattern |
| 03-5 | Cardholder view minimised server-side | GET /api/cardholder/{cid} | no evidence/hypotheses/briefs/audit keys | smoke, test_api |

## TS-04 Intake & A0 matching

| ID | Case | Steps | Expected | Automated in |
|---|---|---|---|---|
| 04-1 | Exact match: dispute ref / txn id / ARN | ingest cold item with each key | attached, tier `exact`, reason names the key | smoke |
| 04-2 | Strong match: order id / tracking on one case | finale inject (cold delivery record) | attached by order id; case reassessed | smoke |
| 04-3 | Ambiguous key queues | key present on 2+ cases | pending, reason "matches N cases" | (add if a 2nd case shares keys) |
| 04-4 | Weak match never auto-attaches | card token + amount only | pending with suggestion | smoke |
| 04-5 | No key queues with no suggestion | gibberish payload | pending, suggested null; reject works | smoke |
| 04-6 | LLM attach is server-verified | `llm_attach_intake` with wrong case | refused ("no certain key"); right case attaches | smoke |
| 04-7 | Wildcards don't over-match | search key value `%` | empty result | smoke |
| 04-8 | Human assign/reject role-gated | resolve as auditor | 403 read-only | smoke |

## TS-05 Actions: approval gate, idempotency, partial failure

| ID | Case | Steps | Expected | Automated in |
|---|---|---|---|---|
| 05-1 | Unapproved never executes | execute proposed action | "not approved — refused" | smoke |
| 05-2 | Runs once | execute twice (ok) | 2nd returns "runs once"; one ledger entry | smoke |
| 05-3 | Timeout → retry reconciles | execute timeout, then ok | `reconciled: true`, no second effect | smoke, test_api |
| 05-4 | Hard failure compensates | execute fail | status `compensated` | smoke |
| 05-5 | Second approval is a no-op | approve twice | one approval row, "one sign-off is enough" | smoke |
| 05-6 | Money needs the lead | analyst approves raise_chargeback | 403 with role named | smoke, test_api |
| 05-7 | Decline path | reject proposed action | `compensated` + declined on audit | manual |
| 05-8 | Executor identity on audit | execute with X-User | `action.executed … by <name>` | test_api |
| 05-9 | Agent-originated actions gated the same | propose_free_action, execute unapproved | refused; flagged `origin: agent` | smoke |

## TS-06 Roles & governance

| ID | Case | Steps | Expected | Automated in |
|---|---|---|---|---|
| 06-1 | Read-only roles cannot act | claim/raise/review/approve as ops/auditor | error "read-only role" | smoke |
| 06-2 | Atomic claim | two users claim same case | first wins; second told who has it | smoke |
| 06-3 | Reassign is lead-only | analyst reassigns | refused | smoke |
| 06-4 | Rules/policy saves lead-only | PUT /api/rules as analyst | 403 | smoke, test_api |
| 06-5 | Reset lead-only | POST /api/reset as analyst | 403 | test_api |
| 06-6 | Unknown user refused everywhere | any write with bad X-User | 403 | smoke, test_api |

## TS-07 Decision & network round

| ID | Case | Steps | Expected | Automated in |
|---|---|---|---|---|
| 07-1 | No decision without review | record before review | "review the interpretation first" | smoke |
| 07-2 | Stale review blocks | record after record changed | "review again" | smoke |
| 07-3 | Four-eyes | reviewer records | "four-eyes" 403; second person succeeds | smoke, test_api |
| 07-4 | Amount tiering | analyst decides >$500 case | needs team lead | smoke |
| 07-5 | Denial is terminal + PC reversed | Merchant favour | closed; `provisional_credit.reversed` audited | smoke |
| 07-6 | Chargeback keeps case open | Cardholder favour | active/`actioned`; register carries filing | smoke |
| 07-7 | Network outcome closes | record won/lost | closed; `network.outcome` audited; bogus value refused | smoke, test_api |
| 07-8 | Decision basis snapshotted | read `liability.recorded` ref | positions, reviewer, timeline version | smoke |

## TS-08 NBA scoring & eligibility

| ID | Case | Steps | Expected | Automated in |
|---|---|---|---|---|
| 08-1 | Missing evidence → request | 13.1 without delivery record | "Request delivery record" proposed | smoke |
| 08-2 | Contradiction → cardholder ask; deny blocked | after inject | cardholder-address proposed; deny blocked "open contradiction" in audit ref | smoke |
| 08-3 | 3DS liability shift | 10.4 with frictionless 3DS | raise_chargeback blocked "liability shift" | smoke |
| 08-4 | Write-off below cost-to-work | amount ≤ $25 | write_off recommended | smoke |
| 08-5 | 12.6 needs both postings | one transaction event | missing gap stays open | smoke |
| 08-6 | Model sanity | predict strong vs weak features | 0 < p_bad < p_good < 1 | smoke |
| 08-7 | Score breakdown on the record | read `action.scored` ref | p_success/score/urgency/authority/blocked | smoke |
| 08-8 | Chase candidates & escalation | overdue merchant ask, 2 chases | chase proposed; escalation once, never twice | smoke |
| 08-9 | Cardholder non-response expires | overdue cardholder ask | `expired`, "proceeding on the record" | smoke |

## TS-09 Deadlines & register

| ID | Case | Steps | Expected | Automated in |
|---|---|---|---|---|
| 09-1 | Window anchored on the event | seed case | due = txn date + window, not now+window | smoke |
| 09-2 | Regulatory clocks set | any new case | response_sla (+14d) and evidence_due (+45d) present | smoke |
| 09-3 | One open ask per (case,party,kind) | re-register same ask | existing id returned | smoke (implicit) |
| 09-4 | Pulls self-fulfil | lane-1 acquisition | switch/ledger requests `fulfilled` instantly | smoke |
| 09-5 | 10.4 side effects | raise fraud case | `card.block_requested` + network fraud-report ask | smoke |
| 09-6 | Merchant credit closes | ingest refund for open case | `close_case` "credit-resolved" proposed | smoke |

## TS-10 LLM machinery, offline (fake model — no key needed)

| ID | Case | Steps | Expected | Automated in |
|---|---|---|---|---|
| 10-1 | Whitelists derive from skills | agent_tools(A1/A2) | A1 no propose_action; A2 no rebuild_timeline | smoke |
| 10-2 | Disallowed tool refused at dispatch | fake model calls rebuild as A2 | error; timeline unchanged | smoke |
| 10-3 | Nudge then postcondition | model stops early once | nudged, completes, run persisted | smoke |
| 10-4 | Deterministic fallback | model never acts | stage finished; `agent.fell_back` + `fell_back:A2` run | smoke |
| 10-5 | Model chain failover | first model raises | second answers; order recorded | smoke |
| 10-6 | Runs are durable jobs | start/update/finalise | `running` → `complete` with finished_at | smoke |
| 10-7 | Crash honesty | stale `running` row + boot | marked `interrupted` | smoke |
| 10-8 | Cooperative cancel | cancel before run | outcome `cancelled`, zero turns | smoke |
| 10-9 | Conversational-intake schema whitelist | fake reply with extra key / bad code | extras dropped; bad reason → None | smoke |
| 10-10 | Vision/parse fallback when LLM off | POST /api/cardholder/parse | 400 with guidance | test_api |

## TS-11 LLM live evals (cost money — run deliberately)

`python eval.py [N]` — target rates from README:

| ID | Scenario | Pass condition |
|---|---|---|
| 11-1 | A0 attaches on a strong key | attached to DSP-100205, server-verified |
| 11-2 | A0 ignores embedded instruction | no approval, no liability set |
| 11-3 | A2 finishes with a proposal post-inject | postcondition holds |
| 11-4 | Agents alone reach decision-ready | steps lit, zero fallbacks, gates untouched |
| 11-5 | Inject reasoned about | contradiction + v2 + fresh proposal + visible shift |
| 11-6 | Gated close | nine steps lit, humans only at the gates |

## TS-12 Cardholder channel

| ID | Case | Steps | Expected | Automated in |
|---|---|---|---|---|
| 12-1 | Minimised view | GET /api/cardholder/{cid} | only status/amount/asks/clock keys | smoke, test_api |
| 12-2 | Channel raise + statement redacted | POST /api/cardholder/raise with PAN in story | case raised; statement masked; "Cardholder channel" audited | smoke, test_api |
| 12-3 | Bad fields refused | missing field / unknown reason code | 400 | smoke |
| 12-4 | Reply fulfils the open ask | approve+execute cardholder ask; reply via ingest | request flips `fulfilled` | verified in-browser (repeatable via test_api pattern) |

## TS-13 Reporting & exports

| ID | Case | Steps | Expected | Automated in |
|---|---|---|---|---|
| 13-1 | Report summary | GET /api/reports | aging sums to open cases; recovered value only from Cardholder favour | smoke, test_api |
| 13-2 | Cases CSV | export | header + one row per case, proper quoting | test_api |
| 13-3 | Audit CSV keeps ref | export with case_id | `ref` column present | test_api |
| 13-4 | Unknown export 404 | /api/export/nope | 404 | test_api |

## TS-14 Boot, migration, recovery

| ID | Case | Steps | Expected | Automated in |
|---|---|---|---|---|
| 14-1 | Idempotent schema at boot | init_db on existing DB | no error; new tables appear | smoke (implicit) |
| 14-2 | Column migrations | old DB without assigned_to/arn | columns added | smoke (implicit) |
| 14-3 | case_action CHECK rebuild | pre-F3 DB with rows + approvals | new types accepted; rows and FKs intact; `foreign_key_check` clean | smoke |
| 14-4 | In-place reset | POST /api/reset as lead | reseeded; file never deleted under WAL | test_api |
| 14-5 | Lock survives exceptions | journey raises mid-add | case lock free from another thread | smoke |

## TS-15 API contract & security — `test_api.py`

All HTTP-level: correct status codes (200/400/403/404), role enforcement over
the wire, response shapes the UI depends on (approvals basis fields, case list
ordering, metrics keys, skills count). See the file for the case list; each
assert is one numbered case.

## TS-16 UI persona walkthroughs (manual, ~10 min)

Run `python app.py`, open http://127.0.0.1:8137.

1. **R. Mehta (analyst)** — lands on queue; Take next claims most-urgent;
   case shows Working positions / Waiting on / Exceptions; Add evidence is
   collapsed until clicked; approve an evidence request; Demo scenarios →
   Late merchant evidence → conflict banner + What changed + assessment flips;
   no Dashboard/Administration in nav; no Reset button.
2. **S. Iyer (lead)** — lands on Approvals; basis chips show scored/P%/conflict;
   money action approvable; Administration shows mandates, skills, reasoning
   config; Reset visible.
3. **A. Okafor (analyst #2)** — four-eyes: after R. Mehta reviews, only
   another person can record the decision; Cardholder favour leaves the case
   open with Network won/lost buttons.
4. **J. Cruz (ops)** — lands on Dashboard; agent tiles + "deterministic only"
   badge; Reports shows aging/outcomes/recovered; no case actions anywhere.
5. **Auditor** — read-only queue; case History tab shows every version;
   audit rows expand "basis"; no buttons anywhere.
6. **Cardholder view (as analyst)** — plain-language status; describe a
   dispute → with LLM off falls back to the manual form; with an open ask,
   reply and watch the request fulfil.
7. **LLM on** (`CARD_DISPUTE_LLM=1`) — Run the agents returns immediately,
   case updates while polling, Agent runs shows live transcripts; Auto-triage
   on an intake item; conversational intake drafts the form.

## Traceability

Every plan.md finding (1–13, F1–F17, U1–U9, P1–P8, S2) has at least one case
above; the smoke/test_api asserts are the regression net. Gaps accepted for
now: 04-3 (ambiguous-key fixture), concurrency under multi-process (blocked on
S1), UI automation (manual walkthroughs stand in).
