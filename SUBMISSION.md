# Submission note — Card Dispute Evidence Agent

**Challenge:** Card Dispute Evidence Reconstruction & Resolution.

This is a working, runnable slice — not a slide deck or a mock. The dispute
journey runs in real code over a database, and the finale scenario (late,
contradicting merchant evidence) is handled live.

A full timed run-of-show for the live demo — every flow, with the narration and
what each beat proves — is in [DEMO.md](DEMO.md).

## How to evaluate (about five minutes)

```bash
pip install -r requirements.txt
python app.py            # then open http://127.0.0.1:8137
python smoke.py          # one-command end-to-end check
```

In the UI, open **DSP-100205** and follow this path:

1. **Read the case.** Evidence with its source, an event timeline, two competing
   positions, an open exception (proof of delivery missing), and a recommended
   action awaiting approval. The card number is already stored as a token.
2. **Fire the inject** — “Merchant evidence arrives (late)”. Watch the case
   reassess itself: the timeline rebuilds to **v2 (previous kept)**, a
   **contradiction** exception opens, the stronger position moves to the merchant
   (both stay on file), and a new action is proposed — every step written to the
   audit trail.
3. **Approve** the recommended action, set the Execute dropdown to **timeout**,
   press **Execute**, then **Retry**. The action **reconciles** against the
   external record and completes with **no second effect**. Try **fail** to see
   compensation.
4. **Record a liability decision** to close the case. Note the machine never sets
   it — only the analyst does. **Reset demo** restarts everything.

## How it meets the requirements

| Requirement | Where to see it |
|---|---|
| Reconstruct the event from the evidence | Event timeline, built from the evidence |
| Late / corrected / conflicting evidence, no loss | Timeline `v1 → v2`, previous kept; the inject |
| Gaps and contradictions made explicit | Exceptions panel (missing / contradiction) |
| Competing interpretations, evidence for and against | Case assessment — both positions, with strengths |
| Next best action, dynamically | Recommended action changes after the inject |
| Prevent duplicate transactions / repeated actions | Idempotent `execute_action` (runs once) |
| Safe recovery from partial failure | The timeout → reconcile → retry path; compensation |
| Provenance, approvals, full audit replay | Source on each item, approval gate, append-only audit |
| Final liability human-owned | Liability is set only by the analyst’s decision |
| Production concerns (observability) | `/health`, `/metrics`, structured logs |

## Data & security

Synthetic data only — no real cardholder or transaction data. Card numbers are
redacted on intake (token + last four; CVV/PIN dropped), so nothing that could
rebuild a card is stored.

## Scope

One reason code (13.1, services not received) is worked end to end; the other
queue rows are read-only. Direct card-network integration, the regulatory clocks,
and production scale are out of scope for this slice, and mock interfaces stand in
for external systems. The design for the full model is in `docs/DESIGN.md`.

## Continuous integration

Every push runs `smoke.py` in GitHub Actions (see `.github/workflows/ci.yml`), so
the end-to-end path is checked automatically.

---

**Team / contact:** _[add your team name and contact here]_
