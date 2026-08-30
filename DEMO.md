# Demo run-of-show

A timed script for the finale demo. Every beat is one click, one line to say,
and the thing it proves. Rehearsed end to end; the whole spine takes about ten
minutes, the optional LLM beats add three more.

## Before the judges arrive

```bash
python app.py          # open http://127.0.0.1:8137
```

- Sign in as **S. Iyer · Team lead** and press **Reset demo** (lead-only).
  Confirm four cases in the queue, DSP-100205 on top (its window, anchored on
  the July transaction, has honestly expired — 0d).
- Sign in as **R. Mehta · Dispute analyst** (top-right); the nav trims to the
  analyst's screens.
- If showing the LLM beats: `CARD_DISPUTE_LLM=1` and `ANTHROPIC_API_KEY` set
  before starting the server. The spine works fully offline without them.
- Keep a screen recording of a full rehearsal as the backup.
- Click deliberately; let each panel settle before the next click.

---

## The spine (~10 minutes)

### 1. The queue is a workload, not a list — 60s
**Click:** nothing yet — point at the queue.
**Say:** "Four open disputes, most urgent first — the clocks anchor on the
disputed transaction, not on today, so the oldest case honestly shows an
expired window. The header shows who is carrying what. Nobody is assigned yet."
**Proves:** long-running state; event-anchored deadlines; work queues.

### 2. Take the urgent one — 30s
**Click:** **Take next case**.
**Say:** "I press one button and the system hands me the most urgent unassigned
case — the one with the expired window. If a colleague pressed it at the same
moment, they'd get the next one — first come, first served, atomically."
**Proves:** pull-based balancing; atomic claim. *(You now own DSP-100205 —
that's beat 5's case. Go back to the queue for beat 3.)*

### 3. The approval gate is real — 45s
**Click:** on the Approvals screen, DSP-100198's proposed chargeback — note
the basis chips (scored, P%, needs team lead) — press **Approve** (as R. Mehta).
**Say:** *read the refusal toast aloud* — "raising a chargeback needs a team
lead, and I'm signed in as an analyst. The server refused me; this is not a
UI convention."
**Click:** switch profile to **S. Iyer**, press **Approve** again.
**Say:** "Approved — recorded under S. Iyer's name. Every approval row shows
its basis: who proposed it, how sure the model is, whether a conflict is open."
**Proves:** role-based approval, enforced server-side; named approvers; the
basis to judge on the approval row itself.

### 4. The scary moment: a timeout — 90s
**Click:** open DSP-100198, set the dropdown to **external: timeout**, press
**Execute**, then set it back to **ok** and press **Retry**.
**Say:** "We sent the chargeback and the reply never came back — did it happen?
The system doesn't guess. The retry asks the network's own record first: it had
gone through, so we adopt that result. No second chargeback. A refund can be
retried all day and still happen once."
**Proves:** idempotency; safe recovery from partial failure.

### 5. The main case, as it stands — 60s
**Click:** open **DSP-100205** (claimed in beat 2; switch back to R. Mehta).
**Say:** "The strip at the top is the judges' own nine-step journey, computed
from the record — not a status field anyone sets. Cardholder says the item
never arrived. Every piece of evidence shows its source; the card number is
already a token. Two working positions, both on screen. The Waiting-on panel
carries three clocks — the scheme window plus the provisional-credit and
investigation deadlines. Open exceptions: no delivery proof yet, a stale
merchant snapshot, a duplicate receipt caught. The recommended step carries
the model's estimate of success, and it waits for a person."
**Proves:** the nine-step journey on screen; provenance; redaction; competing
positions; regulatory clocks; exceptions; scored next-best action.

### 6. THE INJECT — the late evidence arrives cold — 2 min
**Click:** **Demo scenarios** (bottom bar) → **Late merchant evidence**.
**Say:** "The merchant's delivery record just arrived — with no case number on
it. Intake Triage matched it by the order id already on the case. Watch what it
did: timeline rebuilt to version two, the previous version kept; a contradiction
opened — the cardholder says never arrived, the carrier says delivered and
signed; the stronger position flipped to the merchant, but both stayed on file;
and the recommended step changed — ask the cardholder who signed. Nothing was
lost, nothing acted without approval, and liability is still blank."
*Point at the **What changed** panel — timeline v1 → v2 line by line, and 'the
assessment moved: the cardholder's account leads → the merchant's account
leads'. If the advocate briefs were written, they are now flagged stale —
written against v1 — and the planner proposes hearing both sides again.*
**Proves:** the finale inject; automatic case assignment; targeted
re-evaluation; versioning; the change made visible; dependent conclusions
reassessed, not silently rewritten.

### 7. The merchant corrects the record — 45s
**Click:** **Demo scenarios** → **Merchant corrects the record**.
**Say:** "Now the merchant corrects their own record — signed by the neighbour,
not the cardholder. Same tracking number, so it supersedes the earlier version;
timeline is at version three; the old versions are still there. History never
disappears, it accumulates."
**Proves:** corrections without losing earlier evidence.

### 8. Not everything matches — a person triages — 45s
**Click:** **Demo scenarios** → **Unmatched evidence**, then on the Queue's
Intake panel press **Assign to case** (the suggestion is pre-filled).
**Say:** "This one only matched on card token and amount — too weak to attach
automatically. Attaching evidence to the wrong case is worse than leaving it
unattached, so it waits for a person, with the system's best suggestion. I
confirm it, under my name."
**Proves:** the triage boundary; human intervention; nothing guessed.

### 9. Evidence in through the front door — 45s
**Click:** on the Evidence panel press **Add evidence** (the form unfolds),
pick *Correspondence*, *From the cardholder*, type:
`The signature J. Doe is not mine, card 4111 1111 1111 1111` — press
**Add to the case**.
**Say:** "Watch the card number — stored as a token and last four before it ever
hits the database. And the case just re-reconciled with the new statement."
**Proves:** intake for all seven kinds; live redaction.

### 10. The rules are settings, not code — 45s
**Click:** **Administration** (as S. Iyer), change 13.1's window from 30 to
21, **Save**. Point at the reasoning-config column and the agents' mandates.
**Say:** "Required evidence, windows, who approves what — and even what each
reason code argues about: the hypotheses and what counts as a contradiction.
A team lead edits them here. When the scheme changes its rules, this is a
form, not a release. The agents' mandates and skills are readable on the
same screen."
**Proves:** configurable action boundaries and reasoning; the no-code
program is inspectable.

### 11. A new dispute, from step one — 45s
**Click:** **Raise dispute**, fill the small form (reason 13.3), **Raise**.
**Say:** "A brand-new dispute. The journey started by itself — it already knows
correspondence is required for this reason code, and it has already proposed
requesting it, with a success estimate."
**Proves:** journey step 1 live; the dynamic planner on a second reason code.

### 12. The decision — two people, then the close — 90s
**Click:** back on DSP-100205, **Decision** tab, switch to **A. Okafor**.
Press **Mark interpretation reviewed**, then pick **Merchant favour** and
press **Record decision** — *read the refusal aloud*: "four-eyes — the person
who reviewed cannot also decide." Switch to **R. Mehta**, press **Record
decision**.
**Say:** "The decision is gated three ways. A named person signs that they
read the assessment and both narratives — stamped against the record version,
so late evidence voids the review. A second person records the outcome — the
reviewer never decides, and above five hundred dollars it needs the team
lead. And a denial is not just a close: the provisional credit reversal and
the outcome notice just landed on the record — the same register that tracked
every ask. Back on the Case tab, all nine journey steps are lit."
*(If you pick **Cardholder favour** instead: the case stays open — the
chargeback is filed, and the network round closes it later with the **Network
outcome: won/lost** buttons, recorded separately so win-rate data stays honest.)*
**Proves:** human-owned liability; review gate; four-eyes; amount tiering;
denial with provisional-credit reversal; the network round.

*(Optional close: press **Reset demo** — "and we can run it again from zero.")*

---

## The LLM beats (optional, +3 min, needs a key)

### A. The same case, run by reading the skills — 90s
**Click:** **Run the agents** on a case.
**Say:** "Second engine, same case — and notice the button came back
immediately: the run is a background job, on the record from its first turn.
The case updates as they work; **Agent runs** shows the live transcript —
which skills were read, which tools were called, what it cost. Edit a skill
file and the behaviour changes with no code. If it ever tries to attach
evidence to the wrong case, the server refuses — we watched it fail closed
under an injected instruction. And if I change my mind, cancel stops the
spend and the deterministic engine still finishes the stage."
**Proves:** the no-code runtime; durable background runs; the substrate
guardrails.

### B. Both sides, argued — 90s
**Click:** **Prepare advocate briefs** on DSP-100205 after the inject.
**Say:** "Two advocates, opposite briefs, same case file. Each cites the
evidence by id — checkable — and each names the strongest point against its
own side. They argue; they don't decide — the decision buttons are still
mine, and if the record moves after they wrote, the briefs are flagged stale."
**Proves:** the advocate pair; conflict argued for the human, never settled by
the machine.

### C. The cardholder's side — 60s
**Click:** **Cardholder view** (Simulation group). Describe a dispute in the
box; with the LLM on, **Continue** drafts the form — confirm to raise. If an
ask is open on the selected case, type a reply and **Send reply**.
**Say:** "The same register the analysts chase is what the customer answers.
Their reply lands, matches its case, and fulfils the open ask — the loop
closes. And they see only their own side: status, amount, what we need —
never the merchant's evidence or our assessment, enforced on the server."
**Proves:** the cardholder channel; conversational intake behind a human
confirm; server-side minimisation.

---

## If something goes wrong

- Any panel looks stale → click the case row again (it re-reads from the API).
- The LLM beats error → say "the agents run the case; if the model is ever
  unavailable, the case still runs — the deterministic engine is the always-on
  floor, and the fallback lands on the audit trail" — and continue.
- Total failure → the recorded rehearsal.

## Questions to expect, and the honest answers

- **"Is this a framework — LangGraph?"** No framework. The orchestration is a
  few dozen lines; the state machine is the database; the audit trail is the
  trace. At two-to-three agents a graph engine adds abstraction, not capability.
- **"Is the next-best action ML?"** The decision is a transparent score; the ML
  model supplies one number in it — the success probability — trained on
  synthetic outcomes and labelled as such. It retrains on real outcomes without
  a refactor, because every proposal already logs its features.
- **"Is that real login?"** A profile switch with server-side role enforcement —
  a stand-in for the bank's SSO, which is out of scope for a synthetic demo. The
  role checks, the named approvals and the audit are real.
- **"What's mocked?"** The external card-network call — as the brief permits.
  It implements the contract a real connector needs anyway: accept an
  idempotency key, answer "what happened to this key?".
