"""The challenge spec as a test suite: the nine-step End-to-End Journey and the
National Finale Inject, with explicit test data and stubs.

Test cases
    J1..J9   one per journey step, each asserted at the moment it lights up
    FI1      the late evidence is INCORPORATED (cold, no case reference)
    FI2      dependent conclusions are REASSESSED
    FI3      the change is made VISIBLE
    FI4      a later correction supersedes without losing history
    JL1      the same journey runs on the no-code engine (stub model)

Test data
    Fixtures below. All dates are computed relative to today, so staleness
    (>30 days older than the newest dated item) and the clocks behave the same
    on any day this runs.

Stubs (nothing external is touched)
    External world   service._external_call + the external_ledger table:
                     modes ok / timeout / fail, reconciled on retry.
    Systems of record service._switch_lookup / _ledger_lookup answer lane-1
                     pulls for any transaction id.
    The model        FakeClient below scripts the Anthropic client for JL1
                     (same pattern as smoke.py); no key, no network.
    Advocate briefs  plain text via store_briefs — the narrative step needs
                     both sides on file, not a live model.

Runs on its OWN database file (journey_test.db), never the demo's.
Run: python test_journey.py
"""
import datetime
import os
from types import SimpleNamespace as NS

import service as s
import agent
import ml

DB = os.path.join(s.HERE, "journey_test.db")


def days_ago(n):
    return (datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=n)) \
        .replace(microsecond=0).isoformat()


# ---------------------------------------------------------------- test data
CASE = {"customer_id": "CUST-J-001", "card_token": "tok_j_4242", "txn_id": "TXN-J-9001",
        "arn": "74999912345678", "amount": 249.99, "reason_code": "13.1"}   # services not received

STATEMENT = {"text": "I never received the parcel. My card is 4242 4242 4242 4242.",
             "effective_at": days_ago(5)}                                   # PAN: proves redaction
RECEIPT = {"order_id": "ORD-J-777", "items": ["Espresso machine"], "total": 249.99,
           "effective_at": days_ago(20)}
RECEIPT_RESENT = {**RECEIPT, "note": "resend", "effective_at": days_ago(19)}  # duplicate by order id
OLD_SNAPSHOT = {"store": "BeanHouse", "order_status": "processing",
                "effective_at": days_ago(60)}                               # >30d older -> stale

# The National Finale Inject: material, late, contradicting — and COLD:
# no case reference at all. Only the order id links it to the case.
FINALE_INJECT = {"carrier": "FastShip", "tracking": "FS-J-500", "status": "delivered",
                 "signed_by": "K. Rao", "order_id": "ORD-J-777",
                 "delivered_at": days_ago(18)}
FINALE_CORRECTION = {**FINALE_INJECT, "signed_by": "K. Rao (neighbour)",
                     "note": "carrier corrects: signed by the neighbour"}

BRIEF_FOR_CUSTOMER = "The customer states non-receipt [stmt]; no delivery proof was on file."
BRIEF_FOR_MERCHANT = "The order and payment are evidenced [rcpt]; delivery proof was pending."


# ---------------------------------------------------------------- model stub
def _blk_text(t): return NS(type="text", text=t)
def _blk_tool(n, i): return NS(type="tool_use", name=n, input=i, id=s.uid())
def _resp(blocks, stop): return NS(content=blocks, stop_reason=stop,
                                   usage=NS(input_tokens=10, output_tokens=5))


class FakeClient:
    """Scripted stand-in for the Anthropic client — returns canned turns."""
    def __init__(self, script):
        self.script = list(script)
        self.messages = NS(create=lambda **kw: self.script.pop(0))


def steps(c, cid):
    return {j["step"]: j["done"] for j in s.journey_steps(c, cid)}


def main():
    if os.path.exists(DB):
        os.remove(DB)
    c = s.init_db(path=DB)
    ml.train(c)                        # the scorer needs the (synthetic) model
    passed = []
    ok = lambda name: (passed.append(name), print("PASS ", name))

    # ---- J1 Dispute raised ----
    cid = s.raise_dispute(c, CASE, "user1")["case_id"]
    st = steps(c, cid)
    assert st["Dispute raised"] and not st["Specialist reviewed"]
    assert any(a["event"] == "case.raised" for a in s.get_audit(c, cid))
    ok("J1 Dispute raised — journey starts, clocks set")

    # ---- J2 Evidence gathered (intake + lane-1 pulls; redaction at the door) ----
    s.add_evidence(c, cid, "customer_statement", STATEMENT, supplied_by="customer")
    s.add_evidence(c, cid, "receipt", RECEIPT, supplied_by="merchant")
    s.add_evidence(c, cid, "receipt", RECEIPT_RESENT, supplied_by="merchant")
    s.add_evidence(c, cid, "merchant_record", OLD_SNAPSHOT, supplied_by="merchant")
    ev = s.list_evidence(c, cid)
    kinds = {e["kind"] for e in ev}
    assert {"customer_statement", "receipt", "merchant_record",
            "transaction_event", "auth_event"} <= kinds, kinds   # pulls arrived by themselves
    stmt = next(e for e in ev if e["kind"] == "customer_statement")
    assert "4242 4242" not in stmt["payload"] and "token_" in stmt["payload"]
    assert steps(c, cid)["Evidence gathered"]
    ok("J2 Evidence gathered — five kinds on file, card number masked")

    # ---- J3 Event reconstructed (versioned timeline, derived from evidence) ----
    assert s.timeline_version(c, cid) >= 1 and s.get_timeline(c, cid)
    assert steps(c, cid)["Event reconstructed"]
    ok("J3 Event reconstructed — timeline v%d" % s.timeline_version(c, cid))

    # ---- J5 Gaps identified (missing / stale / duplicate — before J4 by design:
    #      the narratives are written against a case whose gaps are known) ----
    gaps = {g["kind"] for g in s.list_gaps(c, cid, open_only=True)}
    assert "missing" in gaps, gaps                         # 13.1 needs a delivery record
    assert "stale" in gaps, gaps                           # the 60-day-old snapshot
    assert s.one(c, "SELECT COUNT(*) n FROM evidence_item WHERE case_id=? AND status='duplicate'",
                 (cid,))["n"] == 1                         # the resent receipt
    assert steps(c, cid)["Gaps identified"]
    ok("J5 Gaps identified — missing, stale and duplicate all surfaced")

    # ---- J6 Evidence requested (lane-2: proposed, approved, executed once) ----
    act = s.one(c, "SELECT * FROM case_action WHERE idempotency_key=?",
                (cid + ":request_evidence:merchant-delivery_record",))
    assert act, "the scorer proposed asking the merchant for the delivery record"
    assert s.approve_action(c, act["action_id"], "user1").get("approval_id")
    assert s.execute_action(c, act["action_id"], mode="ok", user_key="user1")["status"] == "done"
    reqs = s.list_requests(c, cid)
    merchant_ask = next(r for r in reqs if r["party_id"] == "merchant")
    assert merchant_ask["status"] == "sent" and merchant_ask["kinds"] == ["delivery_record"]
    assert steps(c, cid)["Evidence requested"]
    ok("J6 Evidence requested — merchant ask sent through the gate, runs once")

    # ---- J4 Narratives compared (both sides on file, or neither) ----
    assert s.store_briefs(c, cid, {"cardholder": BRIEF_FOR_CUSTOMER}).get("error")
    s.store_briefs(c, cid, {"cardholder": BRIEF_FOR_CUSTOMER, "merchant": BRIEF_FOR_MERCHANT})
    assert steps(c, cid)["Narratives compared"]
    ok("J4 Narratives compared — both briefs stored, one side alone refused")

    # ---- J7 Interpretation prepared (scored positions + a recommended step) ----
    hyps = {h["statement"]: h["confidence"] for h in s.list_hypotheses(c, cid)}
    lead0 = max(hyps, key=hyps.get)
    assert "not delivered" in lead0, hyps                  # the customer's account leads, pre-inject
    assert steps(c, cid)["Interpretation prepared"]
    ok("J7 Interpretation prepared — customer's account leads at %d%%" % hyps[lead0])

    # ---- J8 Specialist reviewed (stamped against the record version) ----
    s.review_interpretation(c, cid, "user1", note="read the assessment and both narratives")
    assert s.interpretation_reviewed(c, cid)["current"]
    assert steps(c, cid)["Specialist reviewed"]
    ok("J8 Specialist reviewed — signed against timeline v%d" % s.timeline_version(c, cid))

    pre = {"tlv": s.timeline_version(c, cid), "lead": lead0}

    # ================= THE NATIONAL FINALE INJECT =================
    # ---- FI1 incorporated: cold arrival, matched by the order id already on file ----
    r = s.triage_intake(c, dict(FINALE_INJECT), supplied_by="merchant",
                        source_system="merchant_portal")
    assert r["status"] == "attached" and r["case_id"] == cid, r
    assert "order id" in r["reason"]
    merchant_ask = next(x for x in s.list_requests(c, cid) if x["party_id"] == "merchant")
    assert merchant_ask["status"] == "fulfilled"           # the late evidence answers the open ask
    ok("FI1 Incorporated — cold item found its case by order id and answered the ask")

    # ---- FI2 dependent conclusions reassessed ----
    hyps = {h["statement"]: h["confidence"] for h in s.list_hypotheses(c, cid)}
    lead1 = max(hyps, key=hyps.get)
    assert lead1 != pre["lead"] and "delivered" in lead1, hyps        # the assessment flipped
    gaps = s.list_gaps(c, cid)
    assert any(g["kind"] == "contradiction" and g["status"] == "open" for g in gaps)
    assert any(g["kind"] == "missing" and g["status"] == "resolved" for g in gaps)
    rec = s.pending_action(c, cid)
    assert rec and "cardholder" in s.jl(rec["params"])["summary"].lower()  # new next step
    assert s.briefs_meta(c, cid)["stale"]                  # the narratives no longer current
    assert not s.interpretation_reviewed(c, cid)["current"]            # the review is void
    assert s.record_decision(c, cid, "Merchant favour", "user2").get("error")  # and it blocks
    ok("FI2 Reassessed — leader flipped, contradiction open, briefs stale, review void")

    # ---- FI3 the change is visible ----
    wc = s.what_changed(c, cid)
    assert wc and wc["to_version"] == pre["tlv"] + 1 and wc["from_version"] == pre["tlv"]
    assert any("delivered" in a.lower() for a in wc["added"]), wc["added"]
    assert wc["direction_moved"] and wc["briefs_stale"]
    st = steps(c, cid)
    assert not st["Narratives compared"] and not st["Specialist reviewed"]  # honestly un-lit
    assert any(a["actor"] == "A0 Intake Triage" and a["event"] == "evidence.attached"
               for a in s.get_audit(c, cid))
    ok("FI3 Visible — v%d to v%d, direction moved, steps un-lit, on the audit trail" %
       (wc["from_version"], wc["to_version"]))

    # ---- FI4 a correction supersedes; nothing is lost ----
    r = s.triage_intake(c, dict(FINALE_CORRECTION), supplied_by="merchant")
    assert r["status"] == "attached"
    dl = s.rows(c, "SELECT status, payload FROM evidence_item WHERE case_id=? AND kind='delivery_record'", (cid,))
    assert sorted(x["status"] for x in dl) == ["active", "superseded"]
    assert "neighbour" in next(x["payload"] for x in dl if x["status"] == "active")
    ok("FI4 Correction — same tracking supersedes, the earlier version is kept")

    # ---- J9 Resolution progressed (hear both sides AGAIN, fresh review, second person decides) ----
    s.store_briefs(c, cid, {   # the stale narratives are rewritten against the changed record
        "cardholder": BRIEF_FOR_CUSTOMER + " The delivery record is now contested: signed by a neighbour.",
        "merchant": BRIEF_FOR_MERCHANT + " A signed delivery record [dlv] is now on file."})
    assert not s.briefs_meta(c, cid)["stale"]              # current again
    s.review_interpretation(c, cid, "user1", note="re-read after the late evidence")
    assert s.record_decision(c, cid, "Merchant favour", "user1").get("error")   # four-eyes
    assert s.record_decision(c, cid, "Merchant favour", "user2")["status"] == "recorded"
    st = steps(c, cid)
    assert all(st.values()), st                            # all nine steps lit
    assert any(a["event"] == "provisional_credit.reversed" for a in s.get_audit(c, cid))
    assert any(o["topic"] == "case.decided" for o in s.rows(c, "SELECT topic FROM outbox"))
    ok("J9 Resolution progressed — all nine steps lit; denial reversed the credit")

    # ---- JL1 the same journey on the no-code engine (stub model, no network) ----
    cid2 = s.raise_dispute(c, {"customer_id": "CUST-J-002", "card_token": "tok_j2",
                               "txn_id": "TXN-J-9002", "amount": 80,
                               "reason_code": "13.3"}, "user1")["case_id"]
    c.execute("DELETE FROM case_action WHERE case_id=?", (cid2,))
    c.commit()
    scripts = iter([
        [_resp([_blk_text("the facts are straight")], "end_turn")],                 # A1
        [_resp([_blk_tool("propose_action", {"atype": "request_evidence",          # A2
                "summary": "ask the merchant for the correspondence", "purpose": "jl1"})], "tool_use"),
         _resp([_blk_text("proposed")], "end_turn")],
    ])
    agent.CLIENT_FACTORY = lambda: FakeClient(next(scripts))
    try:
        agent.run_journey_llm(c, cid2)
    finally:
        agent.CLIENT_FACTORY = None
    runs = s.list_agent_runs(c, cid2)
    assert {r_["agent"] for r_ in runs} == {"A1", "A2"}
    assert all(r_["outcome"] == "complete" for r_ in runs), runs
    assert s.pending_action(c, cid2)
    assert all("instructions" in r_["transcript"][0] for r_ in runs)   # versioned instructions
    ok("JL1 No-code engine — scripted model runs the journey, contracts hold")

    c.close()
    os.remove(DB)
    print("\nJOURNEY PASS — %d/%d cases" % (len(passed), 14))


if __name__ == "__main__":
    main()
