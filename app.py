"""Card Dispute — one process serves the API and the UI (same origin).
Run: python app.py    then open http://127.0.0.1:8080
"""
import os, base64, logging
from fastapi import FastAPI, Body, Header
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
import service

logging.basicConfig(level=logging.INFO, format="%(message)s")
HERE = os.path.dirname(os.path.abspath(__file__))
app = FastAPI(title="Card Dispute Console")


def _boot():
    c = service.init_db()
    if not service.list_cases(c):
        service.seed(c)
    c.close()


_boot()


def db():
    return service.connect()


@app.get("/health")
def health():
    c = db()
    try:
        return {"status": "ok", "cases": len(service.list_cases(c))}
    finally:
        c.close()


@app.get("/metrics")
def metrics():
    c = db()
    try:
        g = lambda sql: c.execute(sql).fetchone()[0]
        return {
            "cases": g("SELECT COUNT(*) FROM dispute_case"),
            "actions_done": g("SELECT COUNT(*) FROM case_action WHERE status='done'"),
            "actions_compensated": g("SELECT COUNT(*) FROM case_action WHERE status='compensated'"),
            "audit_entries": g("SELECT COUNT(*) FROM audit_entry"),
        }
    finally:
        c.close()


@app.get("/api/agents")
def agents():
    # the two agents, their souls, and their skills — the no-code configuration
    return service.AGENTS


@app.get("/api/cases")
def cases():
    c = db()
    try:
        out = []
        for case in service.list_cases(c):
            cid = case["case_id"]
            rule = service.chargeback_rules(c, case["reason_code"])
            action = service.pending_action(c, cid)
            conflict = any(g["kind"] == "contradiction" and g["status"] == "open"
                           for g in service.list_gaps(c, cid, open_only=True))
            out.append({
                "case_id": cid, "customer_id": case["customer_id"], "amount": case["amount"],
                "currency": case["currency"], "reason": case["reason_code"], "reason_text": rule["text"],
                "stage": case["stage"], "status": case["status"], "conflict": conflict,
                "assigned_to": case["assigned_to"],
                "assigned_name": service.USERS.get(case["assigned_to"], {}).get("name") if case["assigned_to"] else None,
                "days_left": service._days_left(c, cid),
                "recommended": service.jl(action["params"]).get("summary") if action else None,
            })
        # most urgent first: fewest days left on the window, then oldest case
        out.sort(key=lambda x: (x["days_left"], x["case_id"]))
        return out
    finally:
        c.close()


@app.get("/api/workload")
def workload_ep():
    c = db()
    try:
        return service.workload(c)
    finally:
        c.close()


@app.post("/api/cases/{cid}/claim")
def claim(cid: str, x_user: str = Header(default="")):
    c = db()
    try:
        r = service.claim_case(c, cid, x_user)
        return JSONResponse(r, status_code=409) if r.get("error") else r
    finally:
        c.close()


@app.post("/api/cases/claim-next")
def claim_next_ep(x_user: str = Header(default="")):
    c = db()
    try:
        r = service.claim_next(c, x_user)
        return JSONResponse(r, status_code=404) if r.get("error") else r
    finally:
        c.close()


@app.post("/api/cases/{cid}/assign")
def assign(cid: str, assignee: str = Body(..., embed=True), x_user: str = Header(default="")):
    c = db()
    try:
        r = service.assign_case(c, cid, assignee, x_user)
        return JSONResponse(r, status_code=403) if r.get("error") else r
    finally:
        c.close()


@app.get("/api/approvals")
def approvals():
    c = db()
    try:
        out = []
        for case in service.list_cases(c):
            a = service.one(c, "SELECT * FROM case_action WHERE case_id=? AND status='proposed' ORDER BY rowid DESC LIMIT 1",
                            (case["case_id"],))
            if a:
                out.append({"case_id": case["case_id"], "action_id": a["action_id"], "type": a["type"],
                            "summary": service.jl(a["params"]).get("summary"), "amount": case["amount"],
                            "currency": case["currency"], "reason": case["reason_code"]})
        return out
    finally:
        c.close()


@app.get("/api/cases/{cid}")
def case(cid: str):
    c = db()
    try:
        v = service.case_view(c, cid)
        if not v:
            return JSONResponse({"error": "not found"}, status_code=404)
        v["timeline_version"] = service.timeline_version(c, cid)
        return v
    finally:
        c.close()


@app.post("/api/cases/{cid}/inject")
def inject(cid: str):
    c = db()
    try:
        service.inject_late_evidence(c, cid)
        v = service.case_view(c, cid)
        v["timeline_version"] = service.timeline_version(c, cid)
        return v
    finally:
        c.close()


@app.get("/api/users")
def users():
    return service.USERS


@app.get("/api/rules")
def rules_get():
    c = db()
    try:
        return {"reasons": service.get_rules(c), "policy": service.get_policy(c)}
    finally:
        c.close()


@app.put("/api/rules")
def rules_put(payload: dict = Body(...), x_user: str = Header(default="")):
    c = db()
    try:
        if payload.get("reasons") is not None:
            r = service.save_rules(c, payload["reasons"], x_user)
            if r.get("error"):
                return JSONResponse(r, status_code=403)
        if payload.get("policy") is not None:
            r = service.save_policy(c, payload["policy"], x_user)
            if r.get("error"):
                return JSONResponse(r, status_code=403)
        c.commit()
        return {"status": "saved"}
    finally:
        c.close()


@app.post("/api/cases/{cid}/evidence")
def add_evidence_ep(cid: str, payload: dict = Body(...), x_user: str = Header(default="")):
    if x_user not in service.USERS:
        return JSONResponse({"error": "unknown user — pick a profile first"}, status_code=403)
    fields = payload.get("fields") or {}
    image_bytes, image_name = None, payload.get("filename")
    if payload.get("image_base64"):
        try:
            image_bytes = base64.b64decode(payload["image_base64"])
        except Exception:
            return JSONResponse({"error": "the photo could not be read"}, status_code=400)
        # optional vision read of a charge slip: typed fields win, gaps are filled
        if os.environ.get("CARD_DISPUTE_LLM") == "1" and payload.get("kind") == "receipt":
            import agent
            media = "image/png" if (image_name or "").lower().endswith(".png") else "image/jpeg"
            seen = agent.read_charge_slip(payload["image_base64"], media)
            if seen:
                for k, v in seen.items():
                    fields.setdefault(k, v)
                fields["read_by"] = "vision"
    c = db()
    try:
        r = service.add_evidence(c, cid, payload.get("kind"), fields,
                                 supplied_by=payload.get("supplied_by", "analyst"),
                                 image_name=image_name, image_bytes=image_bytes)
        if r.get("error"):
            return JSONResponse(r, status_code=400)
        v = service.case_view(c, cid)
        v["timeline_version"] = service.timeline_version(c, cid)
        v["evidence_id"] = r["evidence_id"]
        return v
    finally:
        c.close()


@app.post("/api/actions/{aid}/approve")
def approve(aid: str, x_user: str = Header(default="")):
    c = db()
    try:
        r = service.approve_action(c, aid, user_key=x_user)
        c.commit()
        if r and r.get("error"):
            return JSONResponse(r, status_code=403)
        return r or {"error": "no such action"}
    finally:
        c.close()


@app.post("/api/actions/{aid}/execute")
def execute(aid: str, mode: str = "ok"):
    c = db()
    try:
        r = service.execute_action(c, aid, mode=mode)
        c.commit()
        return r
    finally:
        c.close()


@app.post("/api/cases/{cid}/decision")
def decision(cid: str, outcome: str = Body(..., embed=True), x_user: str = Header(default="")):
    c = db()
    try:
        r = service.record_decision(c, cid, outcome, user_key=x_user)
        if r.get("error"):
            return JSONResponse(r, status_code=403)
        c.commit()
        v = service.case_view(c, cid)
        v["timeline_version"] = service.timeline_version(c, cid)
        v["decided_by"] = r.get("by")
        return v
    finally:
        c.close()


@app.post("/api/cases")
def raise_case(payload: dict = Body(...), x_user: str = Header(default="")):
    c = db()
    try:
        r = service.raise_dispute(c, payload, x_user)
        if r.get("error"):
            return JSONResponse(r, status_code=403 if "user" in r["error"] else 400)
        return r
    finally:
        c.close()


@app.post("/api/ingest")
def ingest(payload: dict = Body(...)):
    """Evidence arriving cold, with no case reference — the connector path.
    A0 Intake Triage classifies it, attaches it when the match is certain, and
    queues the rest for a person."""
    c = db()
    try:
        return service.triage_intake(c, payload.get("fields") or {}, kind=payload.get("kind"),
                                     supplied_by=payload.get("supplied_by", "merchant"),
                                     source_system=payload.get("source_system", "intake_feed"))
    finally:
        c.close()


@app.get("/api/intake")
def intake_list():
    c = db()
    try:
        return service.list_intake(c)
    finally:
        c.close()


@app.post("/api/intake/{iid}/assign")
def intake_assign(iid: str, case_id: str = Body(..., embed=True), x_user: str = Header(default="")):
    c = db()
    try:
        r = service.resolve_intake(c, iid, case_id, x_user)
        if r.get("error"):
            return JSONResponse(r, status_code=403 if "user" in r["error"] else 400)
        return r
    finally:
        c.close()


@app.post("/api/intake/{iid}/reject")
def intake_reject(iid: str, x_user: str = Header(default="")):
    c = db()
    try:
        r = service.resolve_intake(c, iid, None, x_user, reject=True)
        if r.get("error"):
            return JSONResponse(r, status_code=403 if "user" in r["error"] else 400)
        return r
    finally:
        c.close()


@app.post("/api/intake/{iid}/run-agent")
def intake_run_agent(iid: str):
    """Triage one pending intake item with the no-code A0 loop (LLM)."""
    if os.environ.get("CARD_DISPUTE_LLM") != "1":
        return JSONResponse({"error": "No-code LLM runtime is off. Set CARD_DISPUTE_LLM=1 and ANTHROPIC_API_KEY."}, status_code=400)
    c = db()
    try:
        import agent
        transcript = agent.run_triage_agent(c, iid)
        return {"item": service.intake_get(c, iid), "transcript": transcript}
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)
    finally:
        c.close()


@app.post("/api/cases/{cid}/run-agent")
def run_agent_ep(cid: str):
    """Run the case with the no-code LLM runtime instead of the deterministic engine."""
    if os.environ.get("CARD_DISPUTE_LLM") != "1":
        return JSONResponse({"error": "No-code LLM runtime is off. Set CARD_DISPUTE_LLM=1 and ANTHROPIC_API_KEY."}, status_code=400)
    c = db()
    try:
        import agent
        transcript = agent.run_journey_llm(c, cid)
        v = service.case_view(c, cid)
        v["timeline_version"] = service.timeline_version(c, cid)
        v["agent_transcript"] = transcript
        return v
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)
    finally:
        c.close()


@app.post("/api/reset")
def reset():
    c = service.init_db(reset=True)
    service.seed(c)
    c.close()
    return {"status": "reset"}


os.makedirs(os.path.join(HERE, "uploads"), exist_ok=True)
app.mount("/uploads", StaticFiles(directory=os.path.join(HERE, "uploads")), name="uploads")
app.mount("/", StaticFiles(directory=os.path.join(HERE, "static"), html=True), name="ui")

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", "8137"))
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
