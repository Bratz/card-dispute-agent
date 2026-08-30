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
        out = {
            "cases": g("SELECT COUNT(*) FROM dispute_case"),
            "actions_done": g("SELECT COUNT(*) FROM case_action WHERE status='done'"),
            "actions_compensated": g("SELECT COUNT(*) FROM case_action WHERE status='compensated'"),
            "audit_entries": g("SELECT COUNT(*) FROM audit_entry"),
        }
        out.update(service.llm_metrics(c))
        out["llm_enabled"] = os.environ.get("CARD_DISPUTE_LLM") == "1"
        return out
    finally:
        c.close()


@app.get("/api/agent-runs")
def agent_runs(case_id: str = None):
    c = db()
    try:
        return service.list_agent_runs(c, case_id)
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
        # whole-book lookups once, not per case
        rules = service.get_rules(c)
        pend = {}   # newest proposed/approved/executing action per case (rowid order — last wins)
        for a in service.rows(c, "SELECT case_id, params FROM case_action "
                                 "WHERE status IN ('proposed','approved','executing') ORDER BY rowid"):
            pend[a["case_id"]] = service.jl(a["params"])
        confl = {g["case_id"] for g in service.rows(
            c, "SELECT DISTINCT case_id FROM gap WHERE kind='contradiction' AND status='open'")}
        dl = service.days_left_map(c)
        out = []
        for case in service.list_cases(c):
            cid = case["case_id"]
            rule = rules.get(case["reason_code"]) or {"text": case["reason_code"]}
            out.append({
                "case_id": cid, "customer_id": case["customer_id"], "amount": case["amount"],
                "currency": case["currency"], "reason": case["reason_code"], "reason_text": rule["text"],
                "stage": case["stage"], "status": case["status"], "conflict": cid in confl,
                "assigned_to": case["assigned_to"],
                "assigned_name": service.USERS.get(case["assigned_to"], {}).get("name") if case["assigned_to"] else None,
                "days_left": dl.get(cid, 30),
                "recommended": (pend.get(cid) or {}).get("summary"),
            })
        # most urgent first: fewest days left on the window, then oldest case
        out.sort(key=lambda x: (x["days_left"], x["case_id"]))
        return out
    finally:
        c.close()


@app.get("/api/requests/outstanding")
def outstanding_requests():
    """Open asks across the book, by party — the ops chase list."""
    c = db()
    try:
        return service.rows(c, """SELECT p.name party, COUNT(*) open_requests,
            SUM(CASE WHEN sr.due_at < ? AND sr.status IN ('sent','chased') THEN 1 ELSE 0 END) overdue
            FROM service_request sr JOIN party p ON p.party_id = sr.party_id
            WHERE sr.status IN ('sent','chased','partially_fulfilled')
            GROUP BY p.name""", (service.now(),))
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
        confl = {g["case_id"] for g in service.rows(
            c, "SELECT DISTINCT case_id FROM gap WHERE kind='contradiction' AND status='open'")}
        out = []
        for case in service.list_cases(c):
            a = service.one(c, "SELECT * FROM case_action WHERE case_id=? AND status='proposed' ORDER BY rowid DESC LIMIT 1",
                            (case["case_id"],))
            if a:
                p = service.jl(a["params"]) or {}
                out.append({"case_id": case["case_id"], "action_id": a["action_id"], "type": a["type"],
                            "summary": p.get("summary"), "amount": case["amount"],
                            "currency": case["currency"], "reason": case["reason_code"],
                            # the basis for judging it: who proposed, how sure, what's open
                            "origin": p.get("origin"), "p_success": p.get("p_success"),
                            "needs": p.get("needs"), "conflict": case["case_id"] in confl})
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


@app.get("/api/skills")
def skills():
    """The no-code program, readable by its administrator."""
    import agent
    return agent.load_skills()


@app.get("/api/cardholder/{cid}")
def cardholder_case(cid: str):
    """The cardholder's own view — minimised server-side."""
    c = db()
    try:
        v = service.cardholder_view(c, cid)
        return v if v else JSONResponse({"error": "not found"}, status_code=404)
    finally:
        c.close()


@app.post("/api/cardholder/parse")
def cardholder_parse(payload: dict = Body(...)):
    """Conversational intake: the agent structures the story; a person confirms."""
    if os.environ.get("CARD_DISPUTE_LLM") != "1":
        return JSONResponse({"error": "Conversational intake needs the LLM (CARD_DISPUTE_LLM=1) — use the form instead."},
                            status_code=400)
    import agent
    try:
        return {"draft": agent.parse_dispute_text(payload.get("text") or "")}
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)


@app.post("/api/cardholder/raise")
def cardholder_raise(payload: dict = Body(...)):
    c = db()
    try:
        r = service.raise_from_cardholder(c, payload.get("fields") or {}, payload.get("statement") or "")
        if r.get("error"):
            return JSONResponse(r, status_code=400)
        return r
    finally:
        c.close()


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
    if not service.can_work(x_user):
        return JSONResponse({"error": "pick an analyst or team-lead profile to add evidence"}, status_code=403)
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


@app.post("/api/actions/{aid}/reject")
def reject(aid: str, x_user: str = Header(default="")):
    c = db()
    try:
        r = service.reject_action(c, aid, x_user)
        c.commit()
        if r.get("error"):
            return JSONResponse(r, status_code=403)
        return r
    finally:
        c.close()


@app.get("/api/cases/{cid}/history")
def history(cid: str):
    c = db()
    try:
        h = service.case_history(c, cid)
        return h if h else JSONResponse({"error": "not found"}, status_code=404)
    finally:
        c.close()


@app.get("/api/export/{what}")
def export(what: str, case_id: str = None):
    """Real exports: cases.csv, or audit.csv?case_id=DSP-…"""
    import csv, io
    from fastapi.responses import PlainTextResponse
    c = db()
    try:
        buf = io.StringIO()
        w = csv.writer(buf, lineterminator="\n")
        if what == "cases.csv":
            cols = ("case_id", "customer_id", "amount", "currency", "reason_code",
                    "stage", "status", "assigned_to", "liability_outcome", "opened_at")
            w.writerow(cols)
            for x in service.list_cases(c):
                w.writerow([x[k] if x[k] is not None else "" for k in cols])
        elif what == "audit.csv" and case_id:
            w.writerow(["at", "actor", "event", "reason", "ref"])
            for a in service.get_audit(c, case_id):
                w.writerow([a["at"], a["actor"], a["event"], a["reason"] or "", a["ref"] or ""])
        else:
            return JSONResponse({"error": "unknown export"}, status_code=404)
        return PlainTextResponse(buf.getvalue(), media_type="text/csv",
                                 headers={"Content-Disposition": "attachment; filename=%s" % what})
    finally:
        c.close()


@app.post("/api/actions/{aid}/execute")
def execute(aid: str, mode: str = "ok", x_user: str = Header(default="")):
    if not service.can_work(x_user):
        return JSONResponse({"error": "pick an analyst or team-lead profile to execute"}, status_code=403)
    c = db()
    try:
        r = service.execute_action(c, aid, mode=mode, user_key=x_user)
        c.commit()
        return r
    finally:
        c.close()


@app.post("/api/cases/{cid}/review-interpretation")
def review_interpretation(cid: str, note: str = Body(default="", embed=True), x_user: str = Header(default="")):
    c = db()
    try:
        r = service.review_interpretation(c, cid, x_user, note=note)
        if r.get("error"):
            return JSONResponse(r, status_code=403)
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


@app.post("/api/cases/{cid}/network-outcome")
def network_outcome(cid: str, result: str = Body(..., embed=True), x_user: str = Header(default="")):
    c = db()
    try:
        r = service.record_network_outcome(c, cid, result, user_key=x_user)
        if r.get("error"):
            return JSONResponse({"error": r["error"]}, status_code=r.get("code", 400))
        c.commit()
        return r
    finally:
        c.close()


@app.get("/api/reports")
def reports():
    c = db()
    try:
        return service.report_summary(c)
    finally:
        c.close()


@app.post("/api/cases")
def raise_case(payload: dict = Body(...), x_user: str = Header(default="")):
    c = db()
    try:
        r = service.raise_dispute(c, payload, x_user)
        if r.get("error"):
            return JSONResponse({"error": r["error"]}, status_code=r.get("code", 400))
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
        r = service.triage_intake(c, payload.get("fields") or {}, kind=payload.get("kind"),
                                  supplied_by=payload.get("supplied_by", "merchant"),
                                  source_system=payload.get("source_system", "intake_feed"))
        # LLM-first autonomy: when deterministic triage queues an item and the LLM
        # is on, the A0 agent takes over automatically. Any failure leaves the item
        # in the human queue — fail closed.
        if (r.get("status") == "pending" and os.environ.get("CARD_DISPUTE_LLM") == "1"
                and payload.get("auto_agent", True)):
            try:
                import agent
                agent.run_triage_agent(c, r["intake_id"])
                item = service.intake_get(c, r["intake_id"])
                r = {"intake_id": item["intake_id"], "status": item["status"],
                     "case_id": item["matched_case"] if item["status"] == "attached" else None,
                     "suggested_case": item["matched_case"] if item["status"] == "pending" else None,
                     "reason": item["match_reason"], "a0_llm": True}
            except Exception as e:
                logging.getLogger("card_dispute").warning("A0 llm failed; item stays queued: %s", e)
        return r
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
            return JSONResponse({"error": r["error"]}, status_code=r.get("code", 400))
        return r
    finally:
        c.close()


@app.post("/api/intake/{iid}/reject")
def intake_reject(iid: str, x_user: str = Header(default="")):
    c = db()
    try:
        r = service.resolve_intake(c, iid, None, x_user, reject=True)
        if r.get("error"):
            return JSONResponse({"error": r["error"]}, status_code=r.get("code", 400))
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


@app.post("/api/cases/{cid}/advocates")
def advocates_ep(cid: str):
    """Run the advocate pair: the strongest honest case for each side, stored on
    the audit trail. Arguments, not findings; the person still decides."""
    if os.environ.get("CARD_DISPUTE_LLM") != "1":
        return JSONResponse({"error": "No-code LLM runtime is off. Set CARD_DISPUTE_LLM=1 and ANTHROPIC_API_KEY."}, status_code=400)
    c = db()
    try:
        import agent
        r = agent.run_advocates(c, cid)
        if r.get("error"):
            return JSONResponse(r, status_code=500)
        v = service.case_view(c, cid)
        v["timeline_version"] = service.timeline_version(c, cid)
        return v
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)
    finally:
        c.close()


@app.post("/api/cases/{cid}/run-agent")
def run_agent_ep(cid: str):
    """Start the no-code LLM journey as a background job (ii-agent pattern:
    the transport schedules, it never executes). The run is a durable record —
    poll GET /api/agent-runs?case_id=… ; each turn updates the row."""
    if os.environ.get("CARD_DISPUTE_LLM") != "1":
        return JSONResponse({"error": "No-code LLM runtime is off. Set CARD_DISPUTE_LLM=1 and ANTHROPIC_API_KEY."}, status_code=400)
    c = db()
    try:
        if not service.get_case(c, cid):
            return JSONResponse({"error": "not found"}, status_code=404)
    finally:
        c.close()

    def _job():
        cj = service.connect()
        try:
            import agent
            agent.run_journey_llm(cj, cid)
        except Exception as e:
            logging.getLogger("card_dispute").warning("agent journey failed for %s: %s", cid, e)
        finally:
            cj.close()

    import threading
    threading.Thread(target=_job, daemon=True).start()
    return {"status": "started", "case_id": cid, "poll": "/api/agent-runs?case_id=" + cid}


@app.post("/api/cases/{cid}/cancel-agents")
def cancel_agents(cid: str, x_user: str = Header(default="")):
    """Cooperative cancel: stops LLM spend at the next turn boundary; the
    deterministic engine finishes the stage so the case stays workable."""
    if not service.can_work(x_user):
        return JSONResponse({"error": "pick an analyst or team-lead profile"}, status_code=403)
    import agent
    agent.cancel_case_runs(cid)
    return {"status": "cancel requested"}


@app.post("/api/reset")
def reset(x_user: str = Header(default="")):
    if service.USERS.get(x_user, {}).get("role") != "team_lead":
        return JSONResponse({"error": "only the Team Lead can reset the demo"}, status_code=403)
    c = service.init_db(reset=True)
    service.seed(c)
    c.close()
    return {"status": "reset"}


os.makedirs(os.path.join(HERE, "uploads"), exist_ok=True)
app.mount("/uploads", StaticFiles(directory=os.path.join(HERE, "uploads")), name="uploads")
app.mount("/", StaticFiles(directory=os.path.join(HERE, "static"), html=True), name="ui")

def _worker():
    """Optional sweeper (CARD_DISPUTE_WORKER=1): retries A0 on intake items that
    have sat pending for two minutes — recovery for missed or failed triage."""
    import time
    while True:
        time.sleep(60)
        if os.environ.get("CARD_DISPUTE_LLM") != "1":
            continue
        try:
            import datetime as dt
            cutoff = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=2)).replace(microsecond=0).isoformat()
            c = db()
            try:
                import agent
                for item in service.list_intake(c):
                    if item["received_at"] < cutoff:
                        agent.run_triage_agent(c, item["intake_id"])
            finally:
                c.close()
        except Exception as e:
            logging.getLogger("card_dispute").warning("worker sweep failed: %s", e)


if os.environ.get("CARD_DISPUTE_WORKER") == "1":
    import threading
    threading.Thread(target=_worker, daemon=True).start()

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", "8137"))
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
