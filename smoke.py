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

    # ---- opening state, from the journey (six active kinds; delivery arrives later) ----
    v = s.case_view(c, cid)
    kinds = {e["kind"] for e in v["evidence"]}
    assert kinds == {"customer_statement", "transaction_event", "receipt",
                     "auth_event", "merchant_record", "correspondence"}, kinds
    assert s.timeline_version(c, cid) == 1
    assert len(v["timeline"]) == 2                      # authentication + transaction events
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

    # ---- the rebuild: provenance calibration, duplicate detection, two agents / nine skills ----
    conf = {e["kind"]: e["confidence"] for e in v["evidence"]}
    assert conf["transaction_event"] == 1.0 and conf["customer_statement"] == 0.5 and conf["receipt"] == 0.6, conf
    assert count(c, "SELECT COUNT(*) FROM evidence_item WHERE case_id=? AND status='duplicate'", (cid,)) == 1
    assert len(s.AGENTS) == 3 and sum(len(a["skills"]) for a in s.AGENTS.values()) == 10
    assert all(a["soul"] for a in s.AGENTS.values())

    # ---- the visible A1 -> A2 handoff ----
    assert any(a["event"] == "case.handoff" for a in v["audit"]), "no handoff event"

    # ---- the inject, COLD: no case reference; A0 matches it by order id ----
    r = s.inject_late_evidence(c, cid)
    assert r["status"] == "attached" and "order id" in r["reason"], r
    v = s.case_view(c, cid)
    assert any(a["actor"] == "A0 Intake Triage" and a["event"] == "evidence.attached" for a in v["audit"])
    assert any(a["actor"] == "A0 Intake Triage" and a["event"] == "case.handoff" for a in v["audit"])
    assert {e["kind"] for e in v["evidence"]} == set(s.EVIDENCE_KINDS), "all seven kinds now on the case"
    assert s.timeline_version(c, cid) >= 2             # rebuilt; earlier versions kept
    assert count(c, "SELECT COUNT(*) FROM timeline_event WHERE case_id=? AND version=1", (cid,)) == 2
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

    # ---- A0 triage: weak match waits for a person; assignment and rejection work ----
    r = s.triage_intake(c, {"note": "refund copy", "card_token": "tok_9f2a6b_4321", "amount": 129.99})
    assert r["status"] == "pending" and r["suggested_case"] == cid, r     # weak -> never auto-attach
    assert s.resolve_intake(c, r["intake_id"], cid, "nobody").get("error")  # unknown user refused
    a = s.resolve_intake(c, r["intake_id"], cid, "user1")
    assert a.get("status") == "attached", a
    r2 = s.triage_intake(c, {"gibberish": "no keys at all"})
    assert r2["status"] == "pending" and r2["suggested_case"] is None
    assert s.resolve_intake(c, r2["intake_id"], None, "user2", reject=True)["status"] == "rejected"
    assert s._classify_intake({"tracking": "X1", "carrier": "Y"}) == "delivery_record"
    assert s._classify_intake({"order_id": "O1", "total": 5}) == "receipt"

    # ---- NBA demo ML model: trained, sane, and on the record ----
    import ml
    info = ml.model_info(c)
    assert info and info["train_accuracy"] > 0.6 and "synthetic" in info["trained_on"], info
    f = {"b_submit_representment": 1.0, "has_required": 1.0, "contradiction_open": 0.0,
         "merchant_conf": 0.9, "cardholder_conf": 0.1, "amount_norm": 0.5, "days_left_norm": 0.5}
    p_good = ml.predict(c, f)
    f2 = dict(f, contradiction_open=1.0, merchant_conf=0.3, cardholder_conf=0.7)
    p_bad = ml.predict(c, f2)
    assert 0.0 < p_bad < p_good < 1.0, (p_bad, p_good)   # learned the right direction
    assert v["recommended"]["params"].get("p_success") is not None      # estimate on the proposal
    scored = [a for a in v["audit"] if a["event"] == "action.scored"]
    assert scored, "no score breakdown in the audit"
    ref = s.jl(scored[-1]["ref"])
    assert {"p_success", "score", "urgency", "authority", "blocked"} <= set(ref), ref
    assert any(b["atype"] == "submit_representment" and "contradiction" in b["why"]
               for b in ref["blocked"]), ref["blocked"]                 # dependency named

    # ---- role-based approval: money needs the Team Lead ----
    aid5 = s.propose_action(c, cid, "raise_chargeback", {"summary": "role test"}, "test-role")
    r = s.approve_action(c, aid5, user_key="user1")
    assert r.get("error") and "team lead" in r["error"].lower(), r
    r = s.approve_action(c, aid5, user_key="lead")
    assert r.get("approval_id") and r.get("approved_by") == "Team Lead", r
    # an analyst CAN approve an evidence request
    aid6 = s.propose_action(c, cid, "request_evidence", {"summary": "analyst ok"}, "test-role-2")
    assert s.approve_action(c, aid6, user_key="user2").get("approval_id")

    # ---- reason-code rules are configurable (Team Lead only) ----
    rules = s.get_rules(c)
    rules["13.1"]["window_days"] = 10
    assert s.save_rules(c, rules, "user1").get("error")            # analyst refused
    assert s.save_rules(c, rules, "lead").get("status") == "saved" # lead allowed
    assert s.chargeback_rules(c, "13.1")["window_days"] == 10
    assert s.save_policy(c, s.get_policy(c), "user2").get("error")

    # ---- evidence intake: a charge-slip photo + redaction on typed text ----
    r = s.add_evidence(c, cid, "receipt",
                       {"text": "slip shows card 4111 1111 1111 1111", "merchant": "ACME Store", "amount": 129.99},
                       supplied_by="customer", image_name="slip.jpg", image_bytes=b"\xff\xd8fakejpg")
    assert r.get("evidence_id"), r
    item = s.one(c, "SELECT * FROM evidence_item WHERE evidence_id=?", (r["evidence_id"],))
    p = s.jl(item["payload"])
    assert "4111" not in p["text"] and "token_" in p["text"], p    # PAN masked
    assert p.get("image", "").startswith("uploads/") and \
           __import__("os").path.exists(__import__("os").path.join(s.HERE, p["image"]))
    assert item["assertion_type"] == "user_input"                   # customer-supplied
    assert s.add_evidence(c, cid, "not_a_kind", {}).get("error")    # unknown kind refused

    # ---- decision is human-owned; liability was never set by the journey ----
    assert s.get_case(c, cid)["liability_outcome"] is None
    s.record_decision(c, cid, "Merchant favour", user_key="user1")
    case = s.get_case(c, cid)
    assert case["liability_outcome"] == "Merchant favour" and case["stage"] == "resolved"

    # ---- no-code runtime loads (offline parts; the LLM loop needs a key) ----
    import agent
    sk = agent.load_skills()
    assert len(sk) == 10 and all(sk[n]["body"] for n in sk), list(sk)
    assert len(agent.anthropic_tools(agent.TOOL_NAMES)) == len(agent.TOOL_NAMES)

    # ---- audit is append-only and complete ----
    assert count(c, "SELECT COUNT(*) FROM audit_entry WHERE case_id=?", (cid,)) >= 12
    c.commit()
    print("SMOKE PASS —", count(c, "SELECT COUNT(*) FROM audit_entry WHERE case_id=?", (cid,)), "audit entries")

if __name__ == "__main__":
    main()
