"""One assert-based check: journey -> inject -> idempotent action -> recovery.
Run: python smoke.py    (recreates the db each time)
"""
import service as s

def count(c, sql, args=()):
    return c.execute(sql, args).fetchone()[0]

def main():
    c = s.init_db(reset=True)
    s.seed(c)
    cid = "DSP-100205"

    # ---- opening state, from the journey ----
    v = s.case_view(c, cid)
    assert len(v["evidence"]) == 3, v["evidence"]
    assert s.timeline_version(c, cid) == 1
    assert len(v["timeline"]) == 1                      # only the transaction is a timeline event yet
    hyps = {h["statement"]: h["confidence"] for h in v["hypotheses"]}
    assert len(hyps) == 2
    not_del = "Goods were not delivered to the customer"
    delivered = "The merchant delivered and the customer received the goods"
    assert hyps[not_del] > hyps[delivered], hyps       # cardholder leads before the merchant evidence
    assert any(g["kind"] == "missing" and g["status"] == "open" for g in v["gaps"])
    assert v["recommended"] and "merchant" in v["recommended"]["params"]["summary"].lower()

    # ---- redaction actually happened ----
    cust = next(e for e in v["evidence"] if e["kind"] == "customer_statement")
    assert "4111" not in s.jd(cust["payload"]) and "token_" in s.jd(cust["payload"]), cust["payload"]

    # ---- the inject ----
    s.inject_late_evidence(c, cid)
    v = s.case_view(c, cid)
    assert len(v["evidence"]) == 4
    assert s.timeline_version(c, cid) == 2             # rebuilt; v1 kept
    assert count(c, "SELECT COUNT(*) FROM timeline_event WHERE case_id=? AND version=1", (cid,)) == 1
    hyps = {h["statement"]: h["confidence"] for h in v["hypotheses"]}
    assert hyps[delivered] > hyps[not_del], hyps        # shifted to the merchant
    assert any(g["kind"] == "contradiction" and g["status"] == "open" for g in v["gaps"])
    assert any(g["kind"] == "missing" and g["status"] == "resolved" for g in v["gaps"])
    assert v["recommended"] and "cardholder" in v["recommended"]["params"]["summary"].lower()

    # ---- idempotent action: execute twice -> runs once ----
    aid = s.propose_action(c, cid, "request_evidence", {"summary": "idem test"}, "test-idem")
    s.approve_action(c, aid)
    r1 = s.execute_action(c, aid, mode="ok"); assert r1["status"] == "done", r1
    r2 = s.execute_action(c, aid, mode="ok"); assert "runs once" in r2.get("note", ""), r2
    key = s.one(c, "SELECT idempotency_key k FROM case_action WHERE action_id=?", (aid,))["k"]
    assert count(c, "SELECT COUNT(*) FROM external_ledger WHERE idempotency_key=?", (key,)) == 1

    # ---- partial failure: timeout then retry reconciles (no second effect) ----
    aid2 = s.propose_action(c, cid, "request_evidence", {"summary": "timeout test"}, "test-timeout")
    s.approve_action(c, aid2)
    t1 = s.execute_action(c, aid2, mode="timeout"); assert t1["status"] == "executing", t1
    t2 = s.execute_action(c, aid2, mode="ok"); assert t2["status"] == "done" and t2.get("reconciled"), t2
    key2 = s.one(c, "SELECT idempotency_key k FROM case_action WHERE action_id=?", (aid2,))["k"]
    assert count(c, "SELECT COUNT(*) FROM external_ledger WHERE idempotency_key=?", (key2,)) == 1

    # ---- hard failure: compensated ----
    aid3 = s.propose_action(c, cid, "request_evidence", {"summary": "fail test"}, "test-fail")
    s.approve_action(c, aid3)
    f1 = s.execute_action(c, aid3, mode="fail"); assert f1["status"] == "compensated", f1

    # ---- unapproved action is refused ----
    aid4 = s.propose_action(c, cid, "request_evidence", {"summary": "no approval"}, "test-noapp")
    r = s.execute_action(c, aid4, mode="ok"); assert r.get("error") == "not approved — refused", r

    # ---- decision is human-owned; liability was never set by the journey ----
    assert s.get_case(c, cid)["liability_outcome"] is None
    s.record_decision(c, cid, "Merchant favour")
    case = s.get_case(c, cid)
    assert case["liability_outcome"] == "Merchant favour" and case["stage"] == "resolved"

    # ---- audit is append-only and complete ----
    assert count(c, "SELECT COUNT(*) FROM audit_entry WHERE case_id=?", (cid,)) >= 12
    c.commit()
    print("SMOKE PASS —", count(c, "SELECT COUNT(*) FROM audit_entry WHERE case_id=?", (cid,)), "audit entries")

if __name__ == "__main__":
    main()
