/* Disputes Console — React frontend (React 18 UMD + htm, no build step). */
/* global React, ReactDOM, htm */
const { useState, useEffect, useCallback } = React;
const html = htm.bind(React.createElement);

/* ---------------- identity, api, toasts ---------------- */
function getMe() { try { return localStorage.getItem("dc-user") || "user1"; } catch (e) { return "user1"; } }
function setMeStore(v) { try { localStorage.setItem("dc-user", v); } catch (e) {} }
const hdrs = () => ({ "Content-Type": "application/json", "X-User": getMe() });
const jget = (u) => fetch(u, { headers: hdrs() }).then(r => r.json());
const jpost = (u) => fetch(u, { method: "POST", headers: hdrs() }).then(r => r.json());
const jbody = (u, b, m = "POST") => fetch(u, { method: m, headers: hdrs(), body: JSON.stringify(b) }).then(r => r.json());

let notify = () => {};
const NAMES = { lead: "Team Lead", user1: "User 1", user2: "User 2" };
const money = (a, c) => a == null ? "" : Number(a).toFixed(2) + " " + (c || "");
const short = (t, n) => (t || "").length > n ? t.slice(0, n) + "…" : (t || "");

/* ---------------- shared bits ---------------- */
function Panel({ title, x, children, pad = true }) {
  return html`<div class="panel"><header><h2>${title}</h2>${x ? html`<span class="x">${x}</span>` : null}</header>
    <div class="body" style=${pad ? {} : { padding: 0 }}>${children}</div></div>`;
}

function Toasts({ items }) {
  return html`<div class="toasts">${items.map(t => html`<div class="toast" key=${t.id}>${t.text}</div>`)}</div>`;
}

/* ---------------- screens ---------------- */
function Queue({ open, tick, refresh }) {
  const [cases, setCases] = useState([]);
  const [intake, setIntake] = useState([]);
  const [filter, setFilter] = useState("all");
  const [raise_, setRaise] = useState(false);
  const [rd, setRd] = useState({ customer_id: "", card_token: "", txn_id: "", amount: "", reason_code: "13.1" });
  useEffect(() => { jget("/api/cases").then(setCases); jget("/api/intake").then(setIntake); }, [tick]);
  const shown = cases.filter(c => filter === "mine" ? c.assigned_to === getMe() : filter === "unassigned" ? !c.assigned_to : true);
  const takeNext = async () => {
    const r = await jpost("/api/cases/claim-next");
    notify(r.error || ("You took " + r.case_id + ".")); if (!r.error) open(r.case_id); refresh();
  };
  const doRaise = async () => {
    const r = await jbody("/api/cases", rd);
    notify(r.error || ("Dispute " + r.case_id + " raised."));
    if (!r.error) { setRaise(false); open(r.case_id); } refresh();
  };
  const assign = async (iid, cid) => {
    const r = await jbody(`/api/intake/${iid}/assign`, { case_id: cid });
    notify(r.error || ("Attached to " + r.case_id + ".")); refresh();
  };
  const reject = async (iid) => { const r = await jpost(`/api/intake/${iid}/reject`); notify(r.error || "Rejected."); refresh(); };
  const runA0 = async (iid) => {
    const r = await jpost(`/api/intake/${iid}/run-agent`);
    notify(r.error || (r.item.status === "attached" ? "A0 attached it to " + r.item.matched_case : "A0 held it: " + (r.item.match_reason || "needs a person")));
    refresh();
  };
  return html`<div>
    <h1>Case Queue</h1><p class="sub">Open card disputes, most urgent first. Select a case to work it.</p>
    ${raise_ && html`<${Panel} title="Raise a dispute">
      <div class="grid3">
        <input placeholder="Cardholder id" value=${rd.customer_id} onInput=${e => setRd({ ...rd, customer_id: e.target.value })}/>
        <input placeholder="Card token" value=${rd.card_token} onInput=${e => setRd({ ...rd, card_token: e.target.value })}/>
        <input placeholder="Transaction id" value=${rd.txn_id} onInput=${e => setRd({ ...rd, txn_id: e.target.value })}/>
        <input placeholder="Amount" value=${rd.amount} onInput=${e => setRd({ ...rd, amount: e.target.value })}/>
        <select value=${rd.reason_code} onChange=${e => setRd({ ...rd, reason_code: e.target.value })}>
          <option value="13.1">13.1 — Services not received</option><option value="13.3">13.3 — Not as described</option>
          <option value="10.4">10.4 — Fraud, card absent</option><option value="12.6">12.6 — Duplicate processing</option>
        </select>
        <button class="btn pri" onClick=${doRaise}>Raise</button>
      </div><//>`}
    ${intake.length > 0 && html`<${Panel} title="Intake — evidence awaiting a case" x=${intake.length + " pending · A0 Intake Triage"}>
      ${intake.map(i => html`<div class="item" key=${i.intake_id}>
        <div class="t"><span class="k">${i.kind || "unknown"}</span><span class="chip">${i.supplied_by || ""}</span>
          <span class="chip">${short(i.match_reason || "no match", 60)}</span></div>
        <div class="p mono">${short(JSON.stringify(i.payload), 170)}</div>
        <div style=${{ marginTop: "8px", display: "flex", gap: "8px", alignItems: "center" }}>
          <input style=${{ width: "140px" }} placeholder="Case id (DSP-…)" defaultValue=${i.matched_case || ""} id=${"as-" + i.intake_id}/>
          <button class="btn sm" onClick=${() => assign(i.intake_id, document.getElementById("as-" + i.intake_id).value.trim())}>Assign to case</button>
          <button class="btn sm" onClick=${() => reject(i.intake_id)}>Reject</button>
          <button class="btn sm" onClick=${() => runA0(i.intake_id)}>Run A0 (LLM)</button>
        </div></div>`)}<//>`}
    <${Panel} pad=${false} title="Open disputes" x=${html`<span style=${{ display: "flex", gap: "6px", alignItems: "center" }}>
        ${["all", "mine", "unassigned"].map(f => html`<button key=${f} class="btn sm" style=${f === filter ? { borderColor: "var(--accent)", color: "var(--accent)" } : {}}
            onClick=${() => setFilter(f)}>${f === "all" ? "All" : f === "mine" ? "My queue" : "Unassigned"}</button>`)}
        <button class="btn sm pri" onClick=${takeNext}>Take next case</button>
        <button class="btn sm" onClick=${() => setRaise(!raise_)}>Raise dispute</button>
        <span class="mono" style=${{ fontSize: "11px", color: "var(--faint)" }}>${shown.length} of ${cases.length}</span></span>`}>
      <table><thead><tr><th>Dispute</th><th>Cardholder</th><th>Amount</th><th>Reason</th><th>Stage</th><th>Window</th><th>Assigned</th><th>Recommended</th></tr></thead>
      <tbody>${shown.map(c => html`<tr class="row" key=${c.case_id} onClick=${() => open(c.case_id)}>
        <td class="mono">${c.case_id}</td><td>${c.customer_id}</td><td class="num">${money(c.amount, c.currency)}</td>
        <td>${c.reason} · ${c.reason_text}</td>
        <td><span class="badge">${c.stage}</span>${c.conflict ? html` <span class="badge hi">conflict</span>` : null}</td>
        <td class="num" style=${c.days_left < 7 ? { color: "var(--alert)" } : {}}>${c.days_left}d</td>
        <td>${c.assigned_name || "—"}</td><td style=${{ color: "var(--muted)" }}>${short(c.recommended, 60)}</td></tr>`)}</tbody></table><//>
  </div>`;
}

function Approvals({ open, tick, refresh }) {
  const [items, setItems] = useState([]);
  useEffect(() => { jget("/api/approvals").then(setItems); }, [tick]);
  const act = async (aid, kind) => {
    const r = await jpost(`/api/actions/${aid}/${kind}`);
    notify(r.error || r.note || (kind === "approve" ? "Approved by " + (r.approved_by || NAMES[getMe()]) + "." : "Declined."));
    refresh();
  };
  return html`<div><h1>Approvals</h1>
    <p class="sub">Actions awaiting a human decision before anything leaves the bank. ${items.length} pending.</p>
    ${items.length === 0 ? html`<${Panel} title="Nothing waiting"><span style=${{ color: "var(--muted)" }}>No items awaiting approval.</span><//>`
      : html`<${Panel} pad=${false} title="Awaiting sign-off">
        <table><thead><tr><th>Dispute</th><th>Requested action</th><th>Amount</th><th>Reason</th><th>Decision</th></tr></thead>
        <tbody>${items.map(a => html`<tr key=${a.action_id}>
          <td class="mono row" onClick=${() => open(a.case_id)} style=${{ cursor: "pointer" }}>${a.case_id}</td>
          <td>${a.summary}</td><td class="num">${money(a.amount, a.currency)}</td><td>${a.reason}</td>
          <td><button class="btn pri sm" onClick=${() => act(a.action_id, "approve")}>Approve</button>${" "}
              <button class="btn sm" onClick=${() => act(a.action_id, "reject")}>Decline</button></td></tr>`)}</tbody></table><//>`}
  </div>`;
}

function Dashboard({ tick }) {
  const [cases, setCases] = useState([]); const [m, setM] = useState({}); const [w, setW] = useState({ counts: {} });
  useEffect(() => { jget("/api/cases").then(setCases); jget("/metrics").then(setM); jget("/api/workload").then(setW); }, [tick]);
  const byStage = {}; const byReason = {};
  cases.forEach(c => { byStage[c.stage] = (byStage[c.stage] || 0) + 1; byReason[c.reason + " · " + c.reason_text] = (byReason[c.reason + " · " + c.reason_text] || 0) + 1; });
  const due = cases.filter(c => c.days_left < 7).length, conf = cases.filter(c => c.conflict).length;
  const kpi = (l, v) => html`<div class="kpi" key=${l}><div class="l">${l}</div><div class="v">${v}</div></div>`;
  return html`<div><h1>Operations Dashboard</h1><p class="sub">The dispute book as it stands — live figures from this system.</p>
    <div class="kpis">${kpi("Open cases", cases.length)}${kpi("Window under 7 days", due)}${kpi("Cases with conflict", conf)}
      ${kpi("Actions executed", m.actions_done ?? 0)}${kpi("Agent runs", m.llm_runs ?? 0)}${kpi("Unassigned", w.unassigned ?? 0)}</div>
    <div class="grid2">
      <${Panel} pad=${false} title="By stage"><table><thead><tr><th>Stage</th><th class="num">Cases</th></tr></thead>
        <tbody>${Object.entries(byStage).map(([k, v]) => html`<tr key=${k}><td>${k}</td><td class="num">${v}</td></tr>`)}</tbody></table><//>
      <${Panel} pad=${false} title="By reason code"><table><thead><tr><th>Reason</th><th class="num">Cases</th></tr></thead>
        <tbody>${Object.entries(byReason).map(([k, v]) => html`<tr key=${k}><td>${k}</td><td class="num">${v}</td></tr>`)}</tbody></table><//>
    </div>
    <${Panel} title="Workload" x="open cases per person">
      <div class="kv">${Object.entries(w.counts).map(([n, v]) => html`<dt key=${n}>${n}</dt><dd key=${n + "v"}>${v}</dd>`)}</div><//>
  </div>`;
}

function Reports() {
  const [cid, setCid] = useState("DSP-100205");
  return html`<div><h1>Reports</h1><p class="sub">Real exports from the live data, as CSV.</p>
    <${Panel} pad=${false} title="Available exports"><table>
      <thead><tr><th>Report</th><th>Contents</th><th></th></tr></thead><tbody>
      <tr><td>Dispute book</td><td style=${{ color: "var(--muted)" }}>Every case: amounts, reason codes, stages, owners, outcomes</td>
        <td><a class="btn sm" href="/api/export/cases.csv" download>Export CSV</a></td></tr>
      <tr><td>Case audit trail</td><td style=${{ color: "var(--muted)" }}>
          The complete audit record for <input style=${{ width: "120px" }} value=${cid} onInput=${e => setCid(e.target.value)}/></td>
        <td><a class="btn sm" href=${"/api/export/audit.csv?case_id=" + encodeURIComponent(cid)} download>Export CSV</a></td></tr>
      </tbody></table><//>
  </div>`;
}

function Admin({ tick }) {
  const [rules, setRules] = useState(null);
  const [agents, setAgents] = useState(null);
  useEffect(() => { jget("/api/rules").then(setRules); jget("/api/agents").then(setAgents); }, [tick]);
  if (!rules) return html`<div><h1>Administration</h1></div>`;
  const setReason = (code, f, v) => setRules({ ...rules, reasons: { ...rules.reasons, [code]: { ...rules.reasons[code], [f]: v } } });
  const save = async () => {
    const reasons = {};
    Object.entries(rules.reasons).forEach(([k, x]) => {
      reasons[k] = { ...x, window_days: parseInt(x.window_days) || 30,
        required: Array.isArray(x.required) ? x.required : String(x.required).split(",").map(s => s.trim()).filter(Boolean),
        actions: Array.isArray(x.actions) ? x.actions : String(x.actions).split(",").map(s => s.trim()).filter(Boolean) };
    });
    const r = await jbody("/api/rules", { reasons, policy: rules.policy }, "PUT");
    notify(r.error || "Rules saved.");
  };
  return html`<div><h1>Administration</h1>
    <p class="sub">The operating rules are configuration, not code. Only the Team Lead can save.</p>
    ${agents && html`<${Panel} pad=${false} title="Agents" x="soul + skills — the no-code configuration">
      <table><thead><tr><th>Agent</th><th>Role (soul, opening line)</th><th>Skills</th></tr></thead>
      <tbody>${Object.entries(agents).map(([k, a]) => html`<tr key=${k}>
        <td><span class="mono">${k}</span> ${a.name}</td>
        <td style=${{ color: "var(--muted)", fontSize: "12.5px" }}>${short(a.soul, 150)}</td>
        <td>${a.skills.length} — <span class="mono" style=${{ fontSize: "11px" }}>${a.skills.join(", ")}</span></td></tr>`)}
      <tr><td>Advocate pair</td><td style=${{ color: "var(--muted)", fontSize: "12.5px" }}>Two opposite souls argue both sides of a conflict from the evidence on file. They argue; a person decides.</td><td>on demand</td></tr>
      </tbody></table><//>`}
    <${Panel} pad=${false} title="Reason-code rules">
      <table><thead><tr><th>Code</th><th>Meaning</th><th>Window (days)</th><th>Required evidence</th><th>Permitted actions</th></tr></thead>
      <tbody>${Object.entries(rules.reasons).map(([code, x]) => html`<tr key=${code}>
        <td class="mono">${code}</td><td>${x.text}</td>
        <td><input style=${{ width: "56px" }} value=${x.window_days} onInput=${e => setReason(code, "window_days", e.target.value)}/></td>
        <td><input style=${{ width: "180px" }} value=${Array.isArray(x.required) ? x.required.join(", ") : x.required} onInput=${e => setReason(code, "required", e.target.value)}/></td>
        <td><input style=${{ width: "270px" }} value=${Array.isArray(x.actions) ? x.actions.join(", ") : x.actions} onInput=${e => setReason(code, "actions", e.target.value)}/></td></tr>`)}</tbody></table><//>
    <${Panel} pad=${false} title="Approval policy">
      <table style=${{ maxWidth: "460px" }}><thead><tr><th>Action</th><th>Needs sign-off from</th></tr></thead>
      <tbody>${Object.entries(rules.policy).map(([act, role]) => html`<tr key=${act}>
        <td>${act.replace(/_/g, " ")}</td>
        <td><select value=${role} onChange=${e => setRules({ ...rules, policy: { ...rules.policy, [act]: e.target.value } })}>
          <option value="analyst">Analyst</option><option value="team_lead">Team Lead</option></select></td></tr>`)}</tbody></table><//>
    <button class="btn pri" onClick=${save}>Save rules</button>
    <div style=${{ height: "12px" }}></div>
    <${Panel} pad=${false} title="Data handling" x="enforced in code, not toggles">
      <table><thead><tr><th>Data</th><th>How it is handled</th></tr></thead><tbody>
        <tr><td>Card number</td><td>Stored as a token plus last four only — replaced at every intake door before anything is written.</td></tr>
        <tr><td>CVV / PIN / track data</td><td>Never stored; dropped on intake, even inside free text.</td></tr>
        <tr><td>Text redaction</td><td>Card numbers in any text field are found (pattern + Luhn check) and masked.</td></tr>
        <tr><td>Evidence acquisition</td><td>Bank systems of record are pulled read-only by keys the case holds; external parties are reached only through an approved request.</td></tr>
        <tr><td>Retention</td><td>Case history is kept — corrections supersede, nothing is deleted; sensitive fields are tokenised, not erased.</td></tr>
      </tbody></table><//>
  </div>`;
}

/* ---------------- case view ---------------- */
function CaseTab({ v, cid, reload, refresh }) {
  const [mode, setMode] = useState("ok");
  const [ev, setEv] = useState({ kind: "receipt", supplied_by: "merchant", text: "", merchant: "", amount: "", date: "" });
  const [busy, setBusy] = useState("");
  const [runs, setRuns] = useState(null);
  const c = v.case, rec = v.recommended, last = v.last_action;
  const act = async (label, fn) => { setBusy(label); try { await fn(); } finally { setBusy(""); } };
  const approve = () => act("approve", async () => {
    const r = await jpost(`/api/actions/${rec.action_id}/approve`);
    notify(r.error || r.note || ("Approved by " + (r.approved_by || NAMES[getMe()]) + ".")); reload(); refresh();
  });
  const execute = () => act("exec", async () => {
    const r = await jpost(`/api/actions/${rec.action_id}/execute?mode=${mode}`);
    notify(r.error ? "Refused: " + r.error : r.reconciled ? "Reconciled — no second effect." : r.note ? "Executing: " + r.note : "Action " + r.status + ".");
    reload(); refresh();
  });
  const inject = () => act("inject", async () => { await jpost(`/api/cases/${cid}/inject`); notify("Merchant evidence recorded — case updated."); reload(); refresh(); });
  const correct = () => act("correct", async () => {
    const r = await jbody("/api/ingest", { supplied_by: "merchant", source_system: "merchant_portal",
      fields: { carrier: "FastShip", tracking: "FS-99001", status: "delivered", signed_by: "J. Doe (neighbour)",
        order_id: "ORD-5567", delivered_at: "2026-07-22T09:41:00Z", note: "Correction: signed by the neighbour" } });
    notify(r.status === "attached" ? "Correction recorded — earlier version kept, case reassessed." : "Held for a person — " + r.reason);
    reload(); refresh();
  });
  const cold = () => act("cold", async () => {
    const r = await jbody("/api/ingest", { supplied_by: "merchant", source_system: "merchant_portal",
      fields: { note: "Refund receipt copy", card_token: "tok_9f2a6b_4321", amount: 129.99, channel: "portal", text: "see attached" } });
    notify(r.a0_llm ? (r.status === "attached" ? "A0 matched it by itself — attached to " + r.case_id + "." : "A0 held it for a person — " + (r.reason || ""))
      : (r.status === "pending" ? "Held for a person — " + r.reason : "Attached to " + r.case_id));
    reload(); refresh();
  });
  const runAgents = () => act("agents", async () => {
    const r = await jpost(`/api/cases/${cid}/run-agent`);
    notify(r.error || "No-code agents finished."); reload(); refresh();
  });
  const advocates = () => act("adv", async () => {
    const r = await jpost(`/api/cases/${cid}/advocates`);
    notify(r.error || "Both briefs written — the decision is still yours."); reload();
  });
  const showRuns = () => act("runs", async () => {
    const r = await jget(`/api/agent-runs?case_id=${cid}`);
    if (!r.length) { notify("No agent runs on this case yet."); setRuns(null); } else setRuns(r);
  });
  const claim = () => act("claim", async () => { const r = await jpost(`/api/cases/${cid}/claim`); notify(r.error || "Claimed by " + r.by + "."); reload(); refresh(); });
  const reassign = (who) => act("reassign", async () => { const r = await jbody(`/api/cases/${cid}/assign`, { assignee: who }); notify(r.error || "Assigned to " + r.to + "."); reload(); refresh(); });
  const addEvidence = () => act("addev", async () => {
    const fields = {};
    if (ev.text) fields.text = ev.text; if (ev.merchant) fields.merchant = ev.merchant;
    if (ev.amount) fields.amount = parseFloat(ev.amount) || ev.amount; if (ev.date) fields.date = ev.date;
    const body = { kind: ev.kind, supplied_by: ev.supplied_by, fields };
    const f = document.getElementById("ev-photo").files[0];
    if (f) { body.filename = f.name; body.image_base64 = await new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.readAsDataURL(f); }); }
    const r = await jbody(`/api/cases/${cid}/evidence`, body);
    notify(r.error || "Evidence added — the case re-reconciled."); reload(); refresh();
  });
  const lead = v.hypotheses.reduce((a, b) => (b.confidence > (a?.confidence ?? -1) ? b : a), null);
  const contradiction = v.gaps.some(g => g.kind === "contradiction" && g.status === "open");
  return html`<div>
    ${contradiction && !v.liability && html`<div class="banner"><b>The late evidence updated the case.</b> ${" "}The stronger position moved to the merchant, both positions stayed on file, every earlier version was kept, and liability is still an analyst decision.</div>`}
    <div class="two"><div>
      <${Panel} title="Case"><div class="kv">
        <dt>Cardholder</dt><dd class="mono">${c.customer_id}</dd>
        <dt>Card</dt><dd><span class="chip tok">${c.card_id}</span></dd>
        <dt>Amount</dt><dd>${money(c.amount, c.currency)}</dd><dt>Reason</dt><dd>${c.reason_code}</dd>
        <dt>Owner</dt><dd>${c.assigned_to ? (NAMES[c.assigned_to] || c.assigned_to) : "unassigned"}
          ${!c.assigned_to && html` <button class="btn sm" onClick=${claim}>Claim</button>`}
          <select style=${{ marginLeft: "8px" }} value="" onChange=${e => e.target.value && reassign(e.target.value)}>
            <option value="">reassign…</option><option value="lead">Team Lead</option>
            <option value="user1">User 1</option><option value="user2">User 2</option></select></dd>
      </div><//>
      <${Panel} title="Event timeline" x=${"v" + v.timeline_version + (v.timeline_version > 1 ? " · previous kept" : "")}>
        <div class="tl">${v.timeline.length ? v.timeline.map((t, i) => html`<div class="e" key=${i}>
          <div class="d">${(t.occurred_at || "").replace("T", " ").slice(0, 16)}</div>${t.description}</div>`)
          : html`<span style=${{ color: "var(--muted)" }}>no events yet</span>`}</div><//>
      <${Panel} title="Evidence" x=${v.evidence.length + " items"}>
        ${v.evidence.map(e => html`<div class="item" key=${e.evidence_id}>
          <div class="t"><span class="k">${e.kind}</span><span class="chip">${e.assertion_type}</span>
            <span class="chip">${e.source_authority || ""}</span>
            ${e.kind === "delivery_record" ? html`<span class="chip new">late · new</span>` : null}
            <span class="w">${(e.effective_at || "").slice(0, 10)}</span></div>
          <div class="p mono">${short(JSON.stringify(e.payload), 200)}</div>
          ${e.payload && e.payload.image ? html`<div style=${{ marginTop: "6px" }}>
            <a href=${"/" + e.payload.image} target="_blank"><img src=${"/" + e.payload.image} alt="attached photo"
              style=${{ maxHeight: "70px", border: "1px solid var(--line)", borderRadius: "4px" }}/></a></div>` : null}
        </div>`)}<//>
      <${Panel} title="Add evidence" x="all seven kinds · photo optional">
        <div class="grid2">
          <select value=${ev.kind} onChange=${e => setEv({ ...ev, kind: e.target.value })}>
            <option value="customer_statement">Cardholder statement</option><option value="merchant_record">Merchant record</option>
            <option value="transaction_event">Transaction record</option><option value="receipt">Receipt / charge slip</option>
            <option value="delivery_record">Delivery record</option><option value="auth_event">Authentication event</option>
            <option value="correspondence">Correspondence</option></select>
          <select value=${ev.supplied_by} onChange=${e => setEv({ ...ev, supplied_by: e.target.value })}>
            <option value="customer">From the cardholder</option><option value="merchant">From the merchant</option>
            <option value="analyst">Keyed by analyst</option></select>
          <input style=${{ gridColumn: "1 / 3" }} placeholder="Description / text" value=${ev.text} onInput=${e => setEv({ ...ev, text: e.target.value })}/>
          <input placeholder="Merchant" value=${ev.merchant} onInput=${e => setEv({ ...ev, merchant: e.target.value })}/>
          <input placeholder="Amount" value=${ev.amount} onInput=${e => setEv({ ...ev, amount: e.target.value })}/>
          <input placeholder="Date (YYYY-MM-DD)" value=${ev.date} onInput=${e => setEv({ ...ev, date: e.target.value })}/>
          <input type="file" accept="image/*" id="ev-photo"/>
        </div>
        <div style=${{ marginTop: "9px" }}><button class="btn pri" disabled=${busy === "addev"} onClick=${addEvidence}>Add to the case</button>
          <span style=${{ fontSize: "11px", color: "var(--faint)", marginLeft: "8px" }}>Card numbers in text are masked on intake.</span></div><//>
    </div><div>
      <${Panel} title="Case assessment" x="both kept">
        ${v.hypotheses.map(h => html`<div class=${"pos" + (h === lead ? " lead" : "")} key=${h.statement}>
          <div class="r"><span class="s">${h.statement}</span><span class="pc">${h.confidence}%</span></div>
          <div class="track"><div class="fill" style=${{ width: h.confidence + "%" }}></div></div></div>`)}<//>
      ${v.briefs && html`<${Panel} title="Both sides, argued" x="argument, not finding · cites evidence ids">
        <div class="grid2">
          <div><div class="rec-h" style=${{ fontSize: "11px", textTransform: "uppercase", color: "var(--muted)", marginBottom: "5px" }}>For the cardholder</div>
            <div style=${{ fontSize: "12.5px", whiteSpace: "pre-wrap" }}>${v.briefs.cardholder}</div></div>
          <div><div style=${{ fontSize: "11px", textTransform: "uppercase", color: "var(--muted)", marginBottom: "5px" }}>For the merchant</div>
            <div style=${{ fontSize: "12.5px", whiteSpace: "pre-wrap" }}>${v.briefs.merchant}</div></div></div>
        <div style=${{ fontSize: "11px", color: "var(--faint)", marginTop: "8px" }}>Written by the advocate pair from the evidence on file. The liability decision stays with the analyst.</div><//>`}
      <${Panel} title="Exceptions">
        ${v.gaps.length ? v.gaps.map(g => {
          const ab = typeof g.about === "string" ? JSON.parse(g.about || "{}") : (g.about || {});
          return html`<div class=${"exc " + g.kind + (g.status === "resolved" ? " resolved" : "")} key=${g.gap_id}>
            <span class="tag">${g.kind}</span><span>${ab.text || (g.kind === "contradiction" ? "cardholder vs delivery record" : "delivery evidence")}</span></div>`;
        }) : html`<span style=${{ color: "var(--muted)", fontSize: "12.5px" }}>No open exceptions.</span>`}<//>
      <${Panel} title="Next best action">
        ${rec && rec.status === "proposed" ? html`<div class="rec"><div class="h">recommended action · proposed</div>
            <div class="w">${rec.params.summary}</div>
            <div class="btns"><button class="btn pri" disabled=${busy === "approve"} onClick=${approve}>Approve</button></div>
            ${rec.params.p_success != null && html`<div class="gate">Estimated chance of success ${Math.round(rec.params.p_success * 100)}% · needs ${(rec.params.needs || "analyst").replace("_", " ")} · demo model, synthetic training data</div>`}
            <div class="gate">Requires approval before anything leaves the bank</div></div>`
        : rec && (rec.status === "approved" || rec.status === "executing") ? html`<div class="rec">
            <div class="h">recommended action · ${rec.status === "executing" ? "awaiting reconciliation" : "approved"}</div>
            <div class="w">${rec.params.summary}</div>
            <div class="btns"><select value=${mode} onChange=${e => setMode(e.target.value)}>
              <option value="ok">external: ok</option><option value="timeout">external: timeout</option><option value="fail">external: fail</option></select>
              <button class="btn pri" disabled=${busy === "exec"} onClick=${execute}>${rec.status === "executing" ? "Retry" : "Execute"}</button></div>
            <div class="gate">Runs once, on the record. Try timeout then retry to see it reconcile.</div></div>`
        : last && (last.status === "done" || last.status === "compensated") ? html`<div class="rec"><div class="h">last action</div>
            <div class="w">${last.params.summary}</div>
            <div class="gate"><span class="ok">${last.status}</span>${last.external_ref ? " · " + last.external_ref : ""}</div></div>`
        : html`<div class="rec"><div class="h">recommended action</div><div class="w" style=${{ color: "var(--muted)" }}>none pending</div></div>`}<//>
      <${Panel} title="Liability decision">
        ${v.liability ? html`<div class="liab set"><div class="v">${v.liability}</div><div class="n">Recorded by an analyst · case closed</div></div>`
          : html`<div class="liab"><div class="v">Not decided</div>
              <div class="n">Liability is recorded by an analyst on the Decision tab, not by the system.</div></div>`}<//>
      ${runs && html`<${Panel} pad=${false} title="Agent runs" x="every run on the record">
        <table><thead><tr><th>Agent</th><th>Outcome</th><th>Turns</th><th>Calls</th><th>Tokens</th></tr></thead>
        <tbody>${runs.map(r => html`<tr key=${r.run_id}><td class="mono">${r.agent}</td>
          <td><span class=${"badge" + ((r.outcome || "").startsWith("fell_back") ? " hi" : "")}>${r.outcome}</span></td>
          <td class="num">${r.turns || 0}</td><td class="num">${r.tool_calls || 0}</td>
          <td class="num">${(r.tokens_in || 0) + (r.tokens_out || 0)}</td></tr>`)}</tbody></table><//>`}
      <${Panel} title="Audit trail" x="append-only">
        <div class="aud">${v.audit.map(a => html`<div class="a" key=${a.audit_id}>
          <span class="ac">${a.actor}</span><span>${a.event}<span class="rr">${a.reason || ""}</span></span>
          <span class="tm">${(a.at || "").slice(11, 19)}</span></div>`)}</div><//>
    </div></div>
    <div class="actionbar">
      <button class="btn pri" disabled=${busy === "inject"} onClick=${inject}>Merchant evidence arrives (late)</button>
      <button class="btn" disabled=${busy === "correct"} onClick=${correct}>Merchant corrects the record</button>
      <button class="btn" disabled=${busy === "cold"} onClick=${cold}>Unmatched evidence arrives</button>
      <button class="btn" disabled=${busy === "agents"} onClick=${runAgents}>${busy === "agents" ? "Agents working…" : "Run no-code (LLM)"}</button>
      <button class="btn" disabled=${busy === "adv"} onClick=${advocates}>${busy === "adv" ? "Advocates writing…" : "Hear both sides (LLM)"}</button>
      <button class="btn" onClick=${showRuns}>Agent runs</button>
      <span class="note">The late delivery record arrives with no case reference — Intake Triage finds the case by its order id.</span>
    </div>
  </div>`;
}

function DecisionTab({ v, cid, reload, refresh }) {
  const [choice, setChoice] = useState("");
  const lead = v.hypotheses.reduce((a, b) => (b.confidence > (a?.confidence ?? -1) ? b : a), null);
  const openGaps = v.gaps.filter(g => g.status === "open").length;
  const record = async () => {
    const r = await jbody(`/api/cases/${cid}/decision`, { outcome: choice });
    notify(r.error || ("Liability recorded by " + (r.decided_by || NAMES[getMe()]) + " — case closed."));
    reload(); refresh();
  };
  const opts = [["Cardholder favour", "Chargeback stands; the cardholder keeps the credit."],
    ["Merchant favour", "Represent the case; the charge is upheld."],
    ["No recovery", "Close without pursuing; write off the amount."]];
  return html`<div class="two"><div>
    <${Panel} title="Case summary"><div class="kv">
      <dt>Dispute</dt><dd class="mono">${cid}</dd><dt>Amount</dt><dd>${money(v.case.amount, v.case.currency)}</dd>
      <dt>Strongest position</dt><dd>${lead ? lead.statement + " (" + lead.confidence + "%)" : "—"}</dd>
      <dt>Open exceptions</dt><dd>${openGaps}</dd></div>
      <div class="banner" style=${{ marginTop: "10px" }}>The assessment is advisory. The liability decision is made by the analyst and can differ from the strongest position.</div><//>
  </div><div>
    <${Panel} title="Record liability">
      ${v.liability ? html`<div class="liab set"><div class="v">${v.liability}</div><div class="n">Recorded · case closed</div></div>`
        : html`<div>
          ${opts.map(([o, d]) => html`<label key=${o} style=${{ display: "flex", gap: "9px", alignItems: "flex-start", padding: "9px 11px",
              border: "1px solid " + (choice === o ? "var(--accent)" : "var(--line)"), borderRadius: "4px", marginBottom: "8px", cursor: "pointer",
              background: choice === o ? "var(--accent-soft)" : "transparent" }}>
            <input type="radio" name="dec" checked=${choice === o} onChange=${() => setChoice(o)} style=${{ marginTop: "2px" }}/>
            <span>${o}<span style=${{ color: "var(--muted)", fontSize: "12px", display: "block" }}>${d}</span></span></label>`)}
          <button class="btn pri" disabled=${!choice} onClick=${record}>Record decision & close</button>
          ${" "}<button class="btn" onClick=${() => notify("Cardholder notice generated (PDF).")}>Generate cardholder notice</button>
        </div>`}<//>
  </div></div>`;
}

function HistoryTab({ cid }) {
  const [h, setH] = useState(null);
  useEffect(() => { jget(`/api/cases/${cid}/history`).then(setH); }, [cid]);
  if (!h) return html`<div/>`;
  return html`<div>
    <${Panel} pad=${false} title="Timeline versions" x="rebuilt, never edited — every version kept">
      <table><thead><tr><th>Version</th><th>Events</th></tr></thead>
      <tbody>${h.timeline_versions.map(tv => html`<tr key=${tv.version}><td class="mono">v${tv.version}</td>
        <td>${tv.events.map((e, i) => html`<div key=${i} style=${{ fontSize: "12.5px" }}>
          <span class="mono" style=${{ color: "var(--faint)", fontSize: "10.5px" }}>${(e.at || "").slice(0, 16).replace("T", " ")}</span> ${e.event}</div>`)}</td></tr>`)}</tbody></table><//>
    <${Panel} pad=${false} title="Every evidence version" x="active, superseded and duplicates — nothing deleted">
      <table><thead><tr><th>Kind</th><th>Status</th><th>Source</th><th>Payload</th></tr></thead>
      <tbody>${h.evidence.map(e => html`<tr key=${e.evidence_id}>
        <td>${e.kind}</td><td><span class=${"badge" + (e.status === "active" ? " okb" : "")}>${e.status}</span></td>
        <td>${e.source_authority || ""}</td><td class="mono" style=${{ fontSize: "11.5px" }}>${short(JSON.stringify(e.payload), 90)}</td></tr>`)}</tbody></table><//>
    ${h.agent_runs.length > 0 && html`<${Panel} pad=${false} title="Agent runs">
      <table><thead><tr><th>Agent</th><th>Outcome</th><th>Turns</th><th>Tokens</th><th>Started</th></tr></thead>
      <tbody>${h.agent_runs.map(r => html`<tr key=${r.run_id}><td class="mono">${r.agent}</td>
        <td><span class=${"badge" + ((r.outcome || "").startsWith("fell_back") ? " hi" : "")}>${r.outcome}</span></td>
        <td class="num">${r.turns || 0}</td><td class="num">${(r.tokens_in || 0) + (r.tokens_out || 0)}</td>
        <td class="mono">${(r.started_at || "").slice(11, 19)}</td></tr>`)}</tbody></table><//>`}
    <${Panel} title="Full audit trail" x=${h.audit.length + " entries · append-only"}>
      <div class="aud" style=${{ maxHeight: "360px" }}>${h.audit.map(a => html`<div class="a" key=${a.audit_id}>
        <span class="ac">${a.actor}</span><span>${a.event}<span class="rr">${a.reason || ""}</span></span>
        <span class="tm">${(a.at || "").slice(11, 19)}</span></div>`)}</div><//>
  </div>`;
}

function CaseView({ cid, tick, refresh }) {
  const [v, setV] = useState(null);
  const [tab, setTab] = useState("case");
  const reload = useCallback(() => jget(`/api/cases/${cid}`).then(setV), [cid]);
  useEffect(() => { setTab("case"); reload(); }, [cid, tick]);
  if (!v || v.error) return html`<div><h1>${cid}</h1><p class="sub">loading…</p></div>`;
  const c = v.case;
  return html`<div>
    <h1>${cid} — ${c.customer_id}</h1>
    <p class="sub">${c.reason_code} · ${money(c.amount, c.currency)} · ${c.stage}</p>
    <div class="tabs">
      ${["case", "decision", "history"].map(t => html`<a key=${t} class=${t === tab ? "on" : ""} onClick=${() => setTab(t)}>
        ${t === "case" ? "Case" : t === "decision" ? "Decision" : "History & audit"}</a>`)}
    </div>
    ${tab === "case" ? html`<${CaseTab} v=${v} cid=${cid} reload=${reload} refresh=${refresh}/>`
      : tab === "decision" ? html`<${DecisionTab} v=${v} cid=${cid} reload=${reload} refresh=${refresh}/>`
      : html`<${HistoryTab} cid=${cid} key=${tick}/>`}
  </div>`;
}

/* ---------------- app shell ---------------- */
function App() {
  const [screen, setScreen] = useState("queue");
  const [caseId, setCaseId] = useState(null);
  const [meKey, setMeKey] = useState(getMe());
  const [toasts, setToasts] = useState([]);
  const [tick, setTick] = useState(0);
  const [meta, setMeta] = useState("");
  const [counts, setCounts] = useState({ cases: 0, approvals: 0 });
  const refresh = useCallback(() => setTick(t => t + 1), []);
  notify = useCallback((text) => {
    const id = Math.random();
    setToasts(ts => [...ts, { id, text }]);
    setTimeout(() => setToasts(ts => ts.filter(t => t.id !== id)), 3200);
  }, []);
  useEffect(() => {
    jget("/metrics").then(m => {
      const llm = m.llm_runs ? ` · agents: ${m.llm_runs} runs${m.llm_fallbacks ? ` (${m.llm_fallbacks} fell back)` : ""}` : "";
      setMeta(`${m.cases} cases · ${m.actions_done} executed · ${m.audit_entries} audit${llm}`);
    });
    jget("/api/cases").then(cs => setCounts(x => ({ ...x, cases: cs.length })));
    jget("/api/approvals").then(a => setCounts(x => ({ ...x, approvals: a.length })));
  }, [tick]);
  const open = (cid) => { setCaseId(cid); setScreen("case"); refresh(); };
  const nav = (s) => { setScreen(s); refresh(); };
  const theme = () => {
    const cur = document.documentElement.getAttribute("data-theme") ||
      (matchMedia("(prefers-color-scheme:dark)").matches ? "dark" : "light");
    const n = cur === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", n);
    try { localStorage.setItem("dc-theme", n); } catch (e) {}
  };
  const resetDemo = async () => { await jpost("/api/reset"); notify("Demo reset."); setScreen("queue"); setCaseId(null); refresh(); };
  const names = { queue: "Case Queue", approvals: "Approvals", dashboard: "Dashboard", reports: "Reports", admin: "Administration" };
  return html`<div class="app">
    <aside class="side">
      <div class="logo">Disputes Console<small>Cards & Payments · Operations</small></div>
      <nav>
        <div class="grp">Operations</div>
        <a class=${screen === "queue" ? "on" : ""} onClick=${() => nav("queue")}>Case Queue <span class="b">${counts.cases}</span></a>
        <a class=${screen === "approvals" ? "on" : ""} onClick=${() => nav("approvals")}>Approvals <span class="b">${counts.approvals}</span></a>
        <div class="grp">Oversight</div>
        <a class=${screen === "dashboard" ? "on" : ""} onClick=${() => nav("dashboard")}>Dashboard</a>
        <a class=${screen === "reports" ? "on" : ""} onClick=${() => nav("reports")}>Reports</a>
        <div class="grp">Platform</div>
        <a class=${screen === "admin" ? "on" : ""} onClick=${() => nav("admin")}>Administration</a>
      </nav>
    </aside>
    <div>
      <div class="top">
        <span class="crumb">${screen === "case" ? html`<b onClick=${() => nav("queue")} style=${{ cursor: "pointer" }}>Case Queue</b>` : html`<b>${names[screen]}</b>`}
          ${screen === "case" ? " / " + caseId : ""}</span>
        <span class="m">${meta}</span><span class="sp"></span>
        <label style=${{ fontSize: "12px", color: "var(--muted)" }}>Signed in as</label>
        <select value=${meKey} onChange=${e => { setMeStore(e.target.value); setMeKey(e.target.value); notify("Now working as " + NAMES[e.target.value] + "."); refresh(); }}>
          <option value="lead">Team Lead · team lead</option><option value="user1">User 1 · analyst</option>
          <option value="user2">User 2 · analyst</option></select>
        <button class="btn sm" onClick=${resetDemo}>Reset demo</button>
        <button class="btn sm" onClick=${theme}>Theme</button>
      </div>
      <main class="view">
        ${screen === "queue" ? html`<${Queue} open=${open} tick=${tick} refresh=${refresh}/>`
          : screen === "approvals" ? html`<${Approvals} open=${open} tick=${tick} refresh=${refresh}/>`
          : screen === "dashboard" ? html`<${Dashboard} tick=${tick}/>`
          : screen === "reports" ? html`<${Reports}/>`
          : screen === "admin" ? html`<${Admin} tick=${tick}/>`
          : html`<${CaseView} cid=${caseId} tick=${tick} refresh=${refresh}/>`}
      </main>
    </div>
    <${Toasts} items=${toasts}/>
  </div>`;
}

try { const s = localStorage.getItem("dc-theme"); if (s) document.documentElement.setAttribute("data-theme", s); } catch (e) {}
ReactDOM.createRoot(document.getElementById("root")).render(html`<${App}/>`);
