"""Card Dispute — one process serves the API and the UI (same origin).
Run: python app.py    then open http://127.0.0.1:8080
"""
import os, logging
from fastapi import FastAPI, Body
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


@app.get("/api/cases")
def cases():
    c = db()
    try:
        out = []
        for case in service.list_cases(c):
            cid = case["case_id"]
            rule = service.chargeback_rules(case["reason_code"])
            action = service.pending_action(c, cid)
            conflict = any(g["kind"] == "contradiction" and g["status"] == "open"
                           for g in service.list_gaps(c, cid, open_only=True))
            out.append({
                "case_id": cid, "customer_id": case["customer_id"], "amount": case["amount"],
                "currency": case["currency"], "reason": case["reason_code"], "reason_text": rule["text"],
                "stage": case["stage"], "status": case["status"], "conflict": conflict,
                "recommended": service.jl(action["params"]).get("summary") if action else None,
            })
        return out
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


@app.post("/api/actions/{aid}/approve")
def approve(aid: str):
    c = db()
    try:
        r = service.approve_action(c, aid)
        c.commit()
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
def decision(cid: str, outcome: str = Body(..., embed=True)):
    c = db()
    try:
        service.record_decision(c, cid, outcome)
        c.commit()
        v = service.case_view(c, cid)
        v["timeline_version"] = service.timeline_version(c, cid)
        return v
    finally:
        c.close()


@app.post("/api/reset")
def reset():
    c = service.init_db(reset=True)
    service.seed(c)
    c.close()
    return {"status": "reset"}


app.mount("/", StaticFiles(directory=os.path.join(HERE, "static"), html=True), name="ui")

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", "8137"))
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
