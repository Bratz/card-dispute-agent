"""TS-15: HTTP contract & security — status codes, role gates over the wire,
response shapes the UI depends on. Assert-based, no framework, recreates the
database (same convention as smoke.py). Run: python test_api.py
"""
import service as s

# fresh DB before the app boots (its _boot seeds only when empty)
_c = s.init_db(reset=True)
s.seed(_c)
_c.close()

import app as app_module            # noqa: E402 — must import after reset
from fastapi.testclient import TestClient  # noqa: E402

t = TestClient(app_module.app)
H = lambda k: {"X-User": k}
CID = "DSP-100205"


def main():
    # 15-1 health & metrics
    r = t.get("/health").json()
    assert r["status"] == "ok" and r["cases"] >= 4, r
    m = t.get("/metrics").json()
    assert {"cases", "actions_done", "audit_entries", "llm_runs", "llm_enabled"} <= set(m), m

    # 15-2 case list: shape + most-urgent-first ordering
    cases = t.get("/api/cases").json()
    assert {"case_id", "days_left", "recommended", "conflict", "reason_text"} <= set(cases[0]), cases[0]
    assert [c["days_left"] for c in cases] == sorted(c["days_left"] for c in cases)
    assert t.get("/api/cases/NOPE").status_code == 404

    # 15-3 approvals carry the basis the lead judges by
    ap = t.get("/api/approvals").json()
    assert ap and {"origin", "p_success", "needs", "conflict"} <= set(ap[0]), ap[0]

    # 15-4 role gates over the wire
    assert t.post("/api/reset", headers=H("user1")).status_code == 403          # lead-only
    assert t.post("/api/actions/x/execute").status_code == 403                  # no profile
    assert t.post(f"/api/cases/{CID}/evidence", json={"kind": "receipt", "fields": {}},
                  headers=H("auditor")).status_code == 403                      # read-only role
    assert t.put("/api/rules", json={"policy": {}}, headers=H("auditor")).status_code == 403  # read-only can't propose
    assert t.post(f"/api/cases/{CID}/claim", headers=H("ops")).status_code == 409  # read-only claim refused
    assert t.post("/api/cases", json={}, headers=H("nobody")).status_code == 403

    # 15-5 inject → conflict visible; what_changed present
    v = t.post(f"/api/cases/{CID}/inject").json()
    assert v["timeline_version"] >= 2 and v["what_changed"]["direction_moved"], v["what_changed"]
    assert any(c["case_id"] == CID and c["conflict"] for c in t.get("/api/cases").json())

    # 15-6 approve → timeout → retry reconciles, executor on the audit (05-3, 05-8)
    aid = v["recommended"]["action_id"]
    r = t.post(f"/api/actions/{aid}/approve", headers=H("user1")).json()
    assert r.get("approved_by") == "R. Mehta", r
    assert t.post(f"/api/actions/{aid}/execute?mode=timeout", headers=H("user1")).json()["status"] == "executing"
    r = t.post(f"/api/actions/{aid}/execute?mode=ok", headers=H("user1")).json()
    assert r["status"] == "done" and r.get("reconciled"), r
    audit = t.get(f"/api/cases/{CID}").json()["audit"]
    assert any("R. Mehta" in (a["reason"] or "") and a["event"] == "action.reconciled" for a in audit)

    # 15-7 money approval needs the lead (05-6)
    cheap = next(a for a in t.get("/api/approvals").json() if a["type"] == "raise_chargeback")
    assert t.post(f"/api/actions/{cheap['action_id']}/approve", headers=H("user2")).status_code == 403

    # 15-8 decision flow: review → four-eyes 403 → second person records → network outcome (07-3, 07-7)
    assert t.post(f"/api/cases/{CID}/review-interpretation", json={"note": "read"}, headers=H("user1")).json()["by"] == "R. Mehta"
    r = t.post(f"/api/cases/{CID}/decision", json={"outcome": "Cardholder favour"}, headers=H("user1"))
    assert r.status_code == 403 and "four-eyes" in r.json()["error"], r.json()
    v = t.post(f"/api/cases/{CID}/decision", json={"outcome": "Cardholder favour"}, headers=H("user2")).json()
    assert v["case"]["status"] == "active" and v["case"]["stage"] == "actioned"   # network round open
    assert t.post(f"/api/cases/{CID}/network-outcome", json={"result": "bogus"}, headers=H("lead")).status_code == 400
    r = t.post(f"/api/cases/{CID}/network-outcome", json={"result": "won"}, headers=H("lead")).json()
    assert r["status"] == "closed", r

    # 15-9 cardholder channel: minimised view, redacted channel raise, parse off (12-1, 12-2, 10-10)
    cv = t.get(f"/api/cardholder/{CID}").json()
    assert not any(k in cv for k in ("evidence", "hypotheses", "briefs", "audit")), cv
    assert t.get("/api/cardholder/NOPE").status_code == 404
    r = t.post("/api/cardholder/raise", json={
        "fields": {"customer_id": "CUST-API", "card_token": "tok_api", "txn_id": "TXN-API",
                   "amount": 42, "reason_code": "13.1"},
        "statement": "Never arrived. Card 4111 1111 1111 1111."}).json()
    ch = t.get(f"/api/cases/{r['case_id']}").json()
    stmt = next(e for e in ch["evidence"] if e["kind"] == "customer_statement")
    assert "4111 1111" not in str(stmt["payload"]) and "token_" in str(stmt["payload"])
    assert t.post("/api/cardholder/parse", json={"text": "x"}).status_code == 400  # LLM off

    # 15-10 intake over the wire: cold ingest attaches; pending item assign/reject role-gated
    r = t.post("/api/ingest", json={"fields": {"txn_id": "TXN-API", "note": "merchant record copy"}}).json()
    assert r["status"] == "attached" and r["case_id"] == ch["case"]["case_id"], r
    r = t.post("/api/ingest", json={"fields": {"gibberish": "no keys"}}).json()
    assert r["status"] == "pending"
    assert t.post(f"/api/intake/{r['intake_id']}/assign", json={"case_id": CID},
                  headers=H("auditor")).status_code == 403
    assert t.post(f"/api/intake/{r['intake_id']}/reject", headers=H("user1")).json()["status"] == "rejected"

    # 15-11 exports (13-2..4)
    r = t.get("/api/export/cases.csv")
    assert r.status_code == 200 and r.text.startswith("case_id,customer_id,")
    r = t.get(f"/api/export/audit.csv?case_id={CID}")
    assert r.text.splitlines()[0] == "at,actor,event,reason,ref"
    assert t.get("/api/export/nope.csv").status_code == 404

    # 15-12 reports, skills, agents, users (13-1) + regulatory surface (R1-R3)
    rep = t.get("/api/reports").json()
    assert sum(rep["aging_by_days_left"].values()) == rep["open_cases"], rep
    assert "tat" in rep and "jurisdiction" in rep and "past_investigation_limit" in rep
    r = t.get("/api/rules").json()
    assert r["sla"]["provisional_credit_business_days"], r.get("sla")
    # S4 maker-checker over the wire: propose (analyst) -> maker can't check -> lead applies
    sla = {**r["sla"], "jurisdiction": "API test"}
    assert t.put("/api/rules", json={"sla": sla}, headers=H("user2")).json()["status"] == "proposed"
    assert t.post("/api/rules/confirm", headers=H("user2")).status_code == 403
    assert t.get("/api/rules").json()["pending"]["proposed_by"] == "A. Okafor"
    assert t.post("/api/rules/confirm", headers=H("lead")).json()["status"] == "applied"
    assert t.get("/api/rules").json()["sla"]["jurisdiction"] == "API test"
    assert any(a["event"] == "config.applied" for a in t.get("/api/config-audit").json())
    # S9: the outbox carries the earlier decision flow, cursor-pollable
    ob = t.get("/api/outbox").json()
    assert any(e["topic"] == "case.decided" and e["payload"]["case_id"] == CID for e in ob), ob[:3]
    last_id = ob[-1]["event_id"]
    assert t.get(f"/api/outbox?after={last_id}").json() == []
    r = t.get("/api/export/regulatory.csv")
    assert r.status_code == 200 and r.text.splitlines()[0].startswith("case_id,opened_at,reason_code"), r.text[:80]
    assert len(t.get("/api/skills").json()) == 10
    assert set(t.get("/api/agents").json()) == {"A0", "A1", "A2"}
    assert t.get("/api/users").json()["ops"]["role"] == "ops"

    # 15-13 async agent endpoints when LLM is off (S2 surface)
    assert t.post(f"/api/cases/{CID}/run-agent").status_code == 400
    assert t.post(f"/api/cases/{CID}/cancel-agents", headers=H("auditor")).status_code == 403
    assert t.post(f"/api/cases/{CID}/cancel-agents", headers=H("user1")).json()["status"] == "cancel requested"

    # 15-14 in-place reset as lead reseeds (14-4)
    assert t.post("/api/reset", headers=H("lead")).json()["status"] == "reset"
    assert t.get("/health").json()["cases"] == 4

    print("API PASS — TS-15 complete")


if __name__ == "__main__":
    main()
