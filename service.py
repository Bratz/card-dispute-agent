"""Card Dispute — runnable service: DB + tools + deterministic skills + seed.

Ponytail: raw sqlite3, no ORM; skills are plain functions; the LLM is optional
and never on the happy path. One worked case is driven by real code end to end.
"""
import os, re, json, uuid, hashlib, logging, datetime

HERE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(HERE, "card_dispute.db")
SCHEMA = os.path.join(HERE, "schema.sql")

log = logging.getLogger("card_dispute")

def now():
    return datetime.datetime.now(datetime.timezone.utc).replace(microsecond=0).isoformat()

def uid():
    return uuid.uuid4().hex

def jd(o):  # json dump
    return json.dumps(o, separators=(",", ":"))

def jl(s):  # json load
    return json.loads(s) if s else None

def chash(payload):
    return hashlib.sha256(jd(payload).encode()).hexdigest()[:16]

# ---------------------------------------------------------------- db
import sqlite3

def connect(path=DB_PATH):
    c = sqlite3.connect(path)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA foreign_keys=ON")
    return c

def init_db(path=DB_PATH, reset=False):
    if reset and os.path.exists(path):
        os.remove(path)
    fresh = not os.path.exists(path)
    c = connect(path)
    if fresh:
        with open(SCHEMA, encoding="utf-8") as f:
            c.executescript(f.read())
        c.commit()
    return c

def rows(c, sql, args=()):
    return [dict(r) for r in c.execute(sql, args).fetchall()]

def one(c, sql, args=()):
    r = c.execute(sql, args).fetchone()
    return dict(r) if r else None

# ---------------------------------------------------------------- control tools
def log_audit(c, case_id, actor, event, reason=None, ref=None):
    c.execute("INSERT INTO audit_entry(case_id,at,actor,event,reason,ref) VALUES(?,?,?,?,?,?)",
              (case_id, now(), actor, event, reason, jd(ref) if ref else None))
    log.info(jd({"case": case_id, "actor": actor, "event": event, "reason": reason}))

def request_intervention(c, case_id, reason):
    log_audit(c, case_id, "system", "intervention.requested", reason)

# ---------------------------------------------------------------- redaction (intake)
PAN_RE = re.compile(r"\b(?:\d[ -]?){13,19}\b")

def luhn_ok(num):
    d = [int(x) for x in num if x.isdigit()]
    if len(d) < 13:
        return False
    s, alt = 0, False
    for x in reversed(d):
        if alt:
            x *= 2
            if x > 9:
                x -= 9
        s += x
        alt = not alt
    return s % 10 == 0

def _redact_str(s):
    def repl(m):
        raw = m.group(0)
        digits = re.sub(r"\D", "", raw)
        if luhn_ok(digits):
            return "token_" + hashlib.sha256(digits.encode()).hexdigest()[:6] + " ••••" + digits[-4:]
        return raw
    return PAN_RE.sub(repl, s)

def redact(payload):
    """Drop CVV/PIN/track; replace any card number (Luhn) with token + last 4."""
    p = dict(payload)
    for k in list(p.keys()):
        if k.lower() in ("cvv", "cvc", "pin", "track", "track2"):
            del p[k]
        elif isinstance(p[k], str):
            p[k] = _redact_str(p[k])
    return p

# ---------------------------------------------------------------- read tools
def get_case(c, cid):
    return one(c, "SELECT * FROM dispute_case WHERE case_id=?", (cid,))

def list_cases(c):
    return rows(c, "SELECT * FROM dispute_case ORDER BY opened_at")

def list_evidence(c, cid, active_only=True):
    q = "SELECT * FROM evidence_item WHERE case_id=?" + (" AND status='active'" if active_only else "") + " ORDER BY received_at"
    return rows(c, q, (cid,))

def get_timeline(c, cid):
    mx = one(c, "SELECT MAX(version) v FROM timeline_event WHERE case_id=?", (cid,))
    if not mx or mx["v"] is None:
        return []
    return rows(c, "SELECT * FROM timeline_event WHERE case_id=? AND version=? ORDER BY occurred_at", (cid, mx["v"]))

def timeline_version(c, cid):
    mx = one(c, "SELECT MAX(version) v FROM timeline_event WHERE case_id=?", (cid,))
    return (mx["v"] or 0) if mx else 0

def list_hypotheses(c, cid):
    hs = rows(c, "SELECT * FROM hypothesis WHERE case_id=? ORDER BY confidence DESC", (cid,))
    for h in hs:
        h["links"] = rows(c, "SELECT * FROM evidence_link WHERE hypothesis_id=?", (h["hypothesis_id"],))
    return hs

def list_gaps(c, cid, open_only=False):
    q = "SELECT * FROM gap WHERE case_id=?" + (" AND status='open'" if open_only else "") + " ORDER BY opened_at"
    return rows(c, q, (cid,))

def list_deadlines(c, cid):
    return rows(c, "SELECT * FROM deadline WHERE case_id=?", (cid,))

def get_audit(c, cid):
    return rows(c, "SELECT * FROM audit_entry WHERE case_id=? ORDER BY audit_id", (cid,))

# ---------------------------------------------------------------- derive tools (safe, versioned)
def upsert_evidence(c, cid, kind, assertion_type, payload, source=None, effective_at=None, supersedes=None):
    payload = redact(payload)
    h = chash({"kind": kind, "payload": payload})
    existing = one(c, "SELECT * FROM evidence_item WHERE case_id=? AND content_hash=? AND status='active'", (cid, h))
    if existing:
        return existing["evidence_id"]          # idempotent ingest
    eid = uid()
    src = source or {}
    if supersedes:
        c.execute("UPDATE evidence_item SET status='superseded' WHERE evidence_id=?", (supersedes,))
    c.execute("""INSERT INTO evidence_item(evidence_id,case_id,kind,assertion_type,payload,source_system,
                 source_authority,supplied_by,effective_at,received_at,content_hash,confidence,supersedes,status)
                 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?, 'active')""",
              (eid, cid, kind, assertion_type, jd(payload), src.get("system"), src.get("authority"),
               src.get("supplied_by"), effective_at, now(), h, src.get("confidence", 1.0), supersedes))
    log_audit(c, cid, "assemble-evidence", "evidence.upsert", kind, {"evidence_id": eid})
    return eid

def rebuild_timeline(c, cid):
    # new version derived from the active evidence; previous versions are kept.
    ver = timeline_version(c, cid) + 1
    EVENT_KINDS = {"transaction_event": "Transaction authorised",
                   "delivery_record": "Carrier records the parcel delivered and signed",
                   "auth_event": "Cardholder authentication recorded"}
    ev = [e for e in list_evidence(c, cid) if e["kind"] in EVENT_KINDS]
    ev.sort(key=lambda e: e["effective_at"] or e["received_at"])
    for e in ev:
        p = jl(e["payload"])
        desc = EVENT_KINDS[e["kind"]]
        if e["kind"] == "transaction_event":
            desc = "Transaction authorised — %s %s at %s" % (p.get("amount"), p.get("currency"), p.get("merchant"))
        c.execute("""INSERT INTO timeline_event(timeline_event_id,case_id,occurred_at,description,derived_from,version)
                     VALUES(?,?,?,?,?,?)""",
                  (uid(), cid, e["effective_at"], desc, jd([e["evidence_id"]]), ver))
    log_audit(c, cid, "timeline-reconstruction", "timeline.rebuilt", "version %d — previous kept" % ver)
    clear_reeval(c, cid, "timeline")

def upsert_hypothesis(c, cid, statement, stance):
    h = one(c, "SELECT * FROM hypothesis WHERE case_id=? AND statement=?", (cid, statement))
    if h:
        return h["hypothesis_id"]
    hid = uid()
    c.execute("INSERT INTO hypothesis(hypothesis_id,case_id,statement,stance,confidence,status) VALUES(?,?,?,?,0,'open')",
              (hid, cid, statement, stance))
    return hid

def link_evidence(c, hid, eid, polarity, weight=1.0):
    ex = one(c, "SELECT * FROM evidence_link WHERE hypothesis_id=? AND evidence_id=?", (hid, eid))
    if ex:
        c.execute("UPDATE evidence_link SET polarity=?, weight=? WHERE link_id=?", (polarity, weight, ex["link_id"]))
        return ex["link_id"]
    lid = uid()
    c.execute("INSERT INTO evidence_link(link_id,hypothesis_id,evidence_id,polarity,weight) VALUES(?,?,?,?,?)",
              (lid, hid, eid, polarity, weight))
    return lid

def score_hypotheses(c, cid):
    hs = rows(c, "SELECT * FROM hypothesis WHERE case_id=?", (cid,))
    raw = {}
    for h in hs:
        links = rows(c, "SELECT * FROM evidence_link WHERE hypothesis_id=?", (h["hypothesis_id"],))
        s = 1.0
        for l in links:
            if l["polarity"] == "supports":
                s += l["weight"]
            elif l["polarity"] == "weakens":
                s -= l["weight"]
        raw[h["hypothesis_id"]] = max(0.1, s)
    total = sum(raw.values()) or 1.0
    for h in hs:
        pct = round(raw[h["hypothesis_id"]] / total * 100)
        status = "open"
        c.execute("UPDATE hypothesis SET confidence=?, status=? WHERE hypothesis_id=?", (pct, status, h["hypothesis_id"]))
    log_audit(c, cid, "hypothesis-management", "hypothesis.rescored", "confidence recomputed from evidence")

def open_gap(c, cid, kind, text, about=None):
    ex = one(c, "SELECT * FROM gap WHERE case_id=? AND kind=? AND status='open' AND about=?",
             (cid, kind, jd(about or {"text": text})))
    if ex:
        return ex["gap_id"]
    gid = uid()
    c.execute("INSERT INTO gap(gap_id,case_id,kind,about,status,opened_at) VALUES(?,?,?,?,'open',?)",
              (gid, cid, kind, jd(about or {"text": text}), now()))
    log_audit(c, cid, "conflict-detection", "gap.open", "%s: %s" % (kind, text))
    return gid

def resolve_gap(c, gid):
    c.execute("UPDATE gap SET status='resolved', resolved_at=? WHERE gap_id=?", (now(), gid))

def set_deadline(c, cid, kind, due_at):
    ex = one(c, "SELECT * FROM deadline WHERE case_id=? AND kind=?", (cid, kind))
    if ex:
        return ex["deadline_id"]
    did = uid()
    c.execute("INSERT INTO deadline(deadline_id,case_id,kind,due_at,status) VALUES(?,?,?,?,'pending')",
              (did, cid, kind, due_at))
    return did

def flag_reeval(c, cid, scope, reason):
    ex = one(c, "SELECT * FROM reeval_trigger WHERE case_id=? AND scope=? AND cleared_at IS NULL", (cid, scope))
    if ex:
        return ex["trigger_id"]
    tid = uid()
    c.execute("INSERT INTO reeval_trigger(trigger_id,case_id,scope,reason,created_at) VALUES(?,?,?,?,?)",
              (tid, cid, scope, reason, now()))
    return tid

def clear_reeval(c, cid, scope):
    c.execute("UPDATE reeval_trigger SET cleared_at=? WHERE case_id=? AND scope=? AND cleared_at IS NULL",
              (now(), cid, scope))

# ---------------------------------------------------------------- reference data
REASON_RULES = {
    "13.1": {"text": "Services not received", "required": ["delivery_record"], "window_days": 30,
             "actions": ["request_evidence", "raise_chargeback", "submit_representment"]},
    "13.3": {"text": "Not as described", "required": ["correspondence"], "window_days": 30,
             "actions": ["request_evidence", "raise_chargeback"]},
    "10.4": {"text": "Fraud — card absent", "required": ["auth_event"], "window_days": 30,
             "actions": ["raise_chargeback"]},
    "12.6": {"text": "Duplicate processing", "required": ["transaction_event"], "window_days": 30,
             "actions": ["raise_chargeback"]},
}

def chargeback_rules(reason_code):
    return REASON_RULES.get(reason_code, {"text": reason_code, "required": [], "window_days": 30, "actions": []})

# ---------------------------------------------------------------- action tools
def propose_action(c, cid, atype, params, purpose):
    key = "%s:%s:%s" % (cid, atype, purpose)
    ex = one(c, "SELECT * FROM case_action WHERE idempotency_key=?", (key,))
    if ex:
        return ex["action_id"]
    aid = uid()
    c.execute("""INSERT INTO case_action(action_id,case_id,type,params,idempotency_key,status,created_at)
                 VALUES(?,?,?,?,?, 'proposed', ?)""", (aid, cid, atype, jd(params), key, now()))
    log_audit(c, cid, "next-best-action", "action.proposed", params.get("summary", atype))
    return aid

def pending_action(c, cid):
    # newest proposed/approved action is the current recommendation (rowid = insertion order)
    return one(c, "SELECT * FROM case_action WHERE case_id=? AND status IN ('proposed','approved','executing') ORDER BY rowid DESC LIMIT 1", (cid,))

def approve_action(c, aid, role="team_lead", who="user_4471"):
    a = one(c, "SELECT * FROM case_action WHERE action_id=?", (aid,))
    if not a:
        return None
    if a["status"] in ("done", "compensated"):
        return {"note": "already actioned — runs once"}
    apid = uid()
    c.execute("INSERT INTO approval(approval_id,case_id,action_id,decision,approver_role,approver_id,decided_at) VALUES(?,?,?,?,?,?,?)",
              (apid, a["case_id"], aid, "approve", role, who, now()))
    c.execute("UPDATE case_action SET status='approved', approval_id=? WHERE action_id=?", (apid, aid))
    log_audit(c, a["case_id"], "approval", "action.approved", a["type"])
    return {"approval_id": apid}

def _external_call(c, key, mode):
    """Mock external world. 'timeout' completes on the far side but the reply is
    lost to us — so a retry must reconcile against the ledger, not act again."""
    if mode == "ok":
        c.execute("INSERT OR REPLACE INTO external_ledger(idempotency_key,status,ref,at) VALUES(?,?,?,?)",
                  (key, "completed", "EXT-" + key[-6:], now()))
        return "ok"
    if mode == "timeout":
        c.execute("INSERT OR REPLACE INTO external_ledger(idempotency_key,status,ref,at) VALUES(?,?,?,?)",
                  (key, "completed", "EXT-" + key[-6:], now()))     # far side DID complete
        return "timeout"                                            # ...but we didn't hear back
    c.execute("INSERT OR REPLACE INTO external_ledger(idempotency_key,status,ref,at) VALUES(?,?,?,?)",
              (key, "failed", None, now()))
    return "fail"

def execute_action(c, aid, mode="ok"):
    a = one(c, "SELECT * FROM case_action WHERE action_id=?", (aid,))
    if not a:
        return {"error": "no such action"}
    if a["status"] == "done":
        return {"status": "done", "note": "already executed — runs once", "external_ref": a["external_ref"]}
    ap = one(c, "SELECT * FROM approval WHERE action_id=? AND decision='approve'", (aid,))
    if not ap:
        return {"status": a["status"], "error": "not approved — refused"}
    key = a["idempotency_key"]
    # reconcile uncertain external state BEFORE (re)trying
    led = one(c, "SELECT * FROM external_ledger WHERE idempotency_key=?", (key,))
    if led and led["status"] == "completed":
        c.execute("UPDATE case_action SET status='done', external_ref=?, result=?, executed_at=? WHERE action_id=?",
                  (led["ref"], jd({"reconciled": True}), now(), aid))
        log_audit(c, a["case_id"], "orchestration", "action.reconciled", "external state was completed; no second effect")
        return {"status": "done", "reconciled": True, "external_ref": led["ref"]}
    c.execute("UPDATE case_action SET status='executing' WHERE action_id=?", (aid,))
    res = _external_call(c, key, mode)
    if res == "ok":
        led = one(c, "SELECT * FROM external_ledger WHERE idempotency_key=?", (key,))
        c.execute("UPDATE case_action SET status='done', external_ref=?, result=?, executed_at=? WHERE action_id=?",
                  (led["ref"], jd({"ok": True}), now(), aid))
        log_audit(c, a["case_id"], "orchestration", "action.executed", a["type"])
        return {"status": "done", "external_ref": led["ref"]}
    if res == "timeout":
        log_audit(c, a["case_id"], "orchestration", "action.timeout", "uncertain — will reconcile on retry")
        return {"status": "executing", "note": "timed out — state uncertain; retry to reconcile"}
    # fail -> compensate
    c.execute("UPDATE case_action SET status='compensated', result=? WHERE action_id=?", (jd({"failed": True}), aid))
    log_audit(c, a["case_id"], "orchestration", "action.compensated", "external call failed; compensated")
    return {"status": "compensated"}

# ---------------------------------------------------------------- decision (human only)
def record_decision(c, cid, outcome, who="analyst_jpatel"):
    assert outcome in ("Cardholder favour", "Merchant favour", "No recovery")
    c.execute("UPDATE dispute_case SET liability_outcome=?, stage='resolved', status='closed', updated_at=? WHERE case_id=?",
              (outcome, now(), cid))
    log_audit(c, cid, "analyst", "liability.recorded", outcome + " — case closed")

# ---------------------------------------------------------------- skills (deterministic) & journey
CANDIDATE_HYPS = [
    ("Goods were not delivered to the customer", "customer_favour"),
    ("The merchant delivered and the customer received the goods", "merchant_favour"),
]

def conflict_detection(c, cid):
    case = get_case(c, cid)
    rule = chargeback_rules(case["reason_code"])
    kinds = {e["kind"] for e in list_evidence(c, cid)}
    for req in rule["required"]:
        if req not in kinds:
            open_gap(c, cid, "missing", "%s not yet provided" % req, {"required": req})
        else:
            # requirement now met — resolve the matching missing gap
            for g in list_gaps(c, cid, open_only=True):
                if g["kind"] == "missing" and jl(g["about"]).get("required") == req:
                    resolve_gap(c, g["gap_id"])
    # contradiction: delivery says delivered, customer says not received
    ev = {e["kind"]: jl(e["payload"]) for e in list_evidence(c, cid)}
    if "delivery_record" in ev and "customer_statement" in ev:
        if ev["delivery_record"].get("status") == "delivered":
            open_gap(c, cid, "contradiction", "cardholder states not received; delivery record shows delivered",
                     {"between": ["customer_statement", "delivery_record"]})
            flag_reeval(c, cid, "hypotheses", "delivery record conflicts with cardholder statement")

def hypothesis_management(c, cid):
    ids = {}
    for stmt, stance in CANDIDATE_HYPS:
        ids[stmt] = upsert_hypothesis(c, cid, stmt, stance)
    ev = {e["kind"]: e for e in list_evidence(c, cid)}
    h_not = ids[CANDIDATE_HYPS[0][0]]
    h_del = ids[CANDIDATE_HYPS[1][0]]
    if "customer_statement" in ev:
        link_evidence(c, h_not, ev["customer_statement"]["evidence_id"], "supports", 1.0)
    if "delivery_record" in ev:
        link_evidence(c, h_del, ev["delivery_record"]["evidence_id"], "supports", 1.0)
        link_evidence(c, h_not, ev["delivery_record"]["evidence_id"], "weakens", 1.0)
    score_hypotheses(c, cid)
    clear_reeval(c, cid, "hypotheses")

def deadline_tracking(c, cid):
    case = get_case(c, cid)
    rule = chargeback_rules(case["reason_code"])
    due = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(days=rule["window_days"])).date().isoformat()
    set_deadline(c, cid, "representment_window", due)

def next_best_action(c, cid):
    case = get_case(c, cid)
    rule = chargeback_rules(case["reason_code"])
    gaps = list_gaps(c, cid, open_only=True)
    contradiction = next((g for g in gaps if g["kind"] == "contradiction"), None)
    missing = next((g for g in gaps if g["kind"] == "missing"), None)
    if contradiction:
        return propose_action(c, cid, "request_evidence",
                              {"summary": "Ask the cardholder to confirm the delivery address and who signed",
                               "authority": "analyst", "expected_value": "resolve contradiction"},
                              "cardholder-address")
    if missing:
        req = jl(missing["about"]).get("required", "evidence")
        return propose_action(c, cid, "request_evidence",
                              {"summary": "Request %s from the merchant" % req.replace("_", " "),
                               "authority": "analyst", "expected_value": "close the open exception"},
                              "merchant-" + req)
    if "submit_representment" in rule["actions"]:
        return propose_action(c, cid, "submit_representment",
                              {"summary": "Submit representment with compelling evidence", "authority": "team_lead"},
                              "representment")
    return None

def run_journey(c, cid):
    conflict_detection(c, cid)
    rebuild_timeline(c, cid)
    hypothesis_management(c, cid)
    deadline_tracking(c, cid)
    next_best_action(c, cid)

def open_case(c, cid, **k):
    c.execute("""INSERT INTO dispute_case(case_id,customer_id,card_id,disputed_txn_id,reason_code,amount,currency,stage,opened_at,updated_at)
                 VALUES(?,?,?,?,?,?,?, 'gathering', ?, ?)""",
              (cid, k["customer_id"], k["card_id"], k["txn"], k["reason"], k["amount"], k["ccy"], now(), now()))
    log_audit(c, cid, "intake", "case.raised", k.get("reason"))

def assemble_evidence(c, cid, kind, assertion_type, payload, source, effective_at, material=True):
    eid = upsert_evidence(c, cid, kind, assertion_type, payload, source, effective_at)
    if material:
        flag_reeval(c, cid, "timeline", "new evidence: %s" % kind)
    return eid

# ---------------------------------------------------------------- seed + inject
def seed(c):
    cid = "DSP-100205"
    open_case(c, cid, customer_id="CUST-100205", card_id="tok_9f2a6b_4321", txn="TXN-88231",
              reason="13.1", amount=129.99, ccy="USD")
    assemble_evidence(c, cid, "customer_statement", "user_input",
                      {"text": "I never received the item.", "card": "4111 1111 1111 1111"},
                      {"system": "dispute_portal", "authority": "first_party", "supplied_by": "customer", "confidence": 0.5},
                      "2026-08-01T10:00:00+00:00")
    assemble_evidence(c, cid, "transaction_event", "recorded_fact",
                      {"amount": 129.99, "currency": "USD", "merchant": "ACME Store", "auth": "approved"},
                      {"system": "card_switch", "authority": "authoritative", "supplied_by": "switch"},
                      "2026-07-20T14:12:00+00:00")
    assemble_evidence(c, cid, "receipt", "recorded_fact",
                      {"order_id": "ORD-5567", "items": ["Widget"], "total": 129.99},
                      {"system": "merchant_portal", "authority": "second_party", "supplied_by": "merchant", "confidence": 0.9},
                      "2026-07-20T14:13:00+00:00")
    run_journey(c, cid)
    # a few queue-only cases with a proposed action, to populate the list
    extra = [
        ("DSP-100211", "R. Cole", "TravelNow", 542.00, "13.3", "Request itinerary and terms from the merchant", "gathering"),
        ("DSP-100198", "M. Diaz", "QuickMart", 38.50, "10.4", "Raise chargeback under reason 10.4 (fraud, card absent)", "awaiting_approval"),
        ("DSP-100187", "P. Nolan", "GadgetHub", 299.00, "13.1", "Submit representment with compelling evidence", "actioned"),
    ]
    for xid, who, merch, amt, rc, summ, stg in extra:
        c.execute("""INSERT INTO dispute_case(case_id,customer_id,card_id,disputed_txn_id,reason_code,amount,currency,stage,opened_at,updated_at)
                     VALUES(?,?,?,?,?,?,?,?,?,?)""",
                  (xid, who, "tok_" + xid[-4:], "TXN-" + xid[-4:], rc, amt, "USD", stg, now(), now()))
        propose_action(c, xid, "request_evidence" if rc != "10.4" else "raise_chargeback", {"summary": summ}, "seed")
    c.commit()

def inject_late_evidence(c, cid):
    """The finale inject, in code: a late, signed delivery record contradicting the customer."""
    assemble_evidence(c, cid, "delivery_record", "recorded_fact",
                      {"carrier": "FastShip", "tracking": "FS-99001", "status": "delivered",
                       "signed_by": "J. Doe", "delivered_at": "2026-07-22T09:40:00Z"},
                      {"system": "merchant_portal", "authority": "second_party", "supplied_by": "merchant", "confidence": 0.85},
                      "2026-07-22T09:40:00+00:00")
    # targeted re-evaluation (the fan-out): conflict, timeline, hypotheses, next step
    conflict_detection(c, cid)
    rebuild_timeline(c, cid)
    hypothesis_management(c, cid)
    next_best_action(c, cid)
    c.commit()

# ---------------------------------------------------------------- optional LLM (off by default)
def llm_summary(case_view):
    """Optional narrative; used only if CARD_DISPUTE_LLM=1 and a key is present."""
    if os.environ.get("CARD_DISPUTE_LLM") != "1":
        return None
    try:
        import anthropic
        client = anthropic.Anthropic()
        pos = ", ".join("%s %d%%" % (p["statement"], p["confidence"]) for p in case_view["hypotheses"])
        msg = client.messages.create(model="claude-sonnet-4-5", max_tokens=120,
              messages=[{"role": "user", "content": "In two plain sentences, summarise this card dispute for an analyst. Positions: " + pos}])
        return msg.content[0].text
    except Exception as e:
        log.warning("llm off: %s", e)
        return None

# ---------------------------------------------------------------- view assembly (for API/UI)
def case_view(c, cid):
    case = get_case(c, cid)
    if not case:
        return None
    hyps = [{"statement": h["statement"], "stance": h["stance"], "confidence": h["confidence"], "status": h["status"]}
            for h in list_hypotheses(c, cid)]
    action = pending_action(c, cid)
    if action:
        action = {**action, "params": jl(action["params"])}
    last = one(c, "SELECT * FROM case_action WHERE case_id=? ORDER BY rowid DESC LIMIT 1", (cid,))
    if last:
        last = {**last, "params": jl(last["params"])}
    return {
        "last_action": last,
        "case": case,
        "evidence": [{**e, "payload": jl(e["payload"])} for e in list_evidence(c, cid)],
        "timeline": get_timeline(c, cid),
        "hypotheses": hyps,
        "gaps": list_gaps(c, cid),
        "deadlines": list_deadlines(c, cid),
        "recommended": action,
        "audit": get_audit(c, cid),
        "liability": case["liability_outcome"],
    }
