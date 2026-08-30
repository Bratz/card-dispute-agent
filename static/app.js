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
const PROFILES = {
  lead:    { name: "S. Iyer",   role: "team_lead", title: "Team lead",       home: "approvals" },
  user1:   { name: "R. Mehta",  role: "analyst",   title: "Dispute analyst", home: "queue" },
  user2:   { name: "A. Okafor", role: "analyst",   title: "Dispute analyst", home: "queue" },
  ops:     { name: "J. Cruz",   role: "ops",       title: "Ops manager",     home: "dashboard" },
  auditor: { name: "Auditor",   role: "auditor",   title: "Auditor",         home: "reports" },
};
const NAMES = Object.fromEntries(Object.entries(PROFILES).map(([k, p]) => [k, p.name]));
const myRole = () => (PROFILES[getMe()] || {}).role;
const canWork = () => myRole() === "analyst" || myRole() === "team_lead";
const isLead = () => myRole() === "team_lead";
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

/* audit rows with the ref payload (score breakdowns, decision basis) expandable */
function AuditList({ items, maxHeight }) {
  return html`<div class="aud" style=${maxHeight ? { maxHeight } : {}}>${items.map(a => html`<div class="a" key=${a.audit_id}>
    <span class="ac">${a.actor}</span>
    <span>${a.event}<span class="rr">${a.reason || ""}</span>
      ${a.ref ? html`<details><summary style=${{ fontSize: "10px", color: "var(--faint)", cursor: "pointer" }}>basis</summary>
        <div class="mono" style=${{ fontSize: "10.5px", color: "var(--muted)", whiteSpace: "pre-wrap" }}>${(() => { try { return JSON.stringify(JSON.parse(a.ref), null, 1); } catch (e) { return a.ref; } })()}</div></details>` : null}</span>
    <span class="tm">${(a.at || "").slice(11, 19)}</span></div>`)}</div>`;
}

/* one transcript line from an agent run */
function TrLine({ t }) {
  const s = t.tool ? "→ " + t.tool + " " + short(JSON.stringify(t.input || {}), 110)
    : t.nudge ? "⚠ nudge: " + short(t.nudge, 140)
    : t.fallback ? "⚠ fell back: " + t.fallback
    : t.final ? "✔ " + short(t.final, 220) : short(JSON.stringify(t), 120);
  return html`<div class="mono" style=${{ fontSize: "11px", padding: "2px 0", color: "var(--muted)" }}>${s}</div>`;
}

/* ---------------- screens ---------------- */
function Queue({ open, tick, refresh }) {
  const [cases, setCases] = useState([]);
  const [intake, setIntake] = useState([]);
  const [filter, setFilter] = useState("all");
  const [raise_, setRaise] = useState(false);
  const [rd, setRd] = useState({ customer_id: "", card_token: "", txn_id: "", arn: "", amount: "", reason_code: "13.1" });
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
        <input placeholder="ARN (optional)" value=${rd.arn} onInput=${e => setRd({ ...rd, arn: e.target.value })}/>
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
        ${canWork() && html`<div style=${{ marginTop: "8px", display: "flex", gap: "8px", alignItems: "center" }}>
          <input style=${{ width: "140px" }} placeholder="Case id (DSP-…)" defaultValue=${i.matched_case || ""} id=${"as-" + i.intake_id}/>
          <button class="btn sm" onClick=${() => assign(i.intake_id, document.getElementById("as-" + i.intake_id).value.trim())}>Assign to case</button>
          <button class="btn sm" onClick=${() => reject(i.intake_id)}>Reject</button>
          <button class="btn sm" onClick=${() => runA0(i.intake_id)}>Auto-triage</button>
        </div>`}</div>`)}<//>`}
    <${Panel} pad=${false} title="Open disputes" x=${html`<span style=${{ display: "flex", gap: "6px", alignItems: "center" }}>
        ${["all", "mine", "unassigned"].map(f => html`<button key=${f} class="btn sm" style=${f === filter ? { borderColor: "var(--accent)", color: "var(--accent)" } : {}}
            onClick=${() => setFilter(f)}>${f === "all" ? "All" : f === "mine" ? "My queue" : "Unassigned"}</button>`)}
        ${canWork() && html`<button class="btn sm pri" onClick=${takeNext}>Take next case</button>
        <button class="btn sm" onClick=${() => setRaise(!raise_)}>Raise dispute</button>`}</span>`}>
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
        <table><thead><tr><th>Dispute</th><th>Requested action</th><th>Basis</th><th>Amount</th><th>Reason</th><th>Decision</th></tr></thead>
        <tbody>${items.map(a => html`<tr key=${a.action_id}>
          <td class="mono row" onClick=${() => open(a.case_id)} style=${{ cursor: "pointer" }}>${a.case_id}</td>
          <td>${a.summary}</td>
          <td>${a.origin === "agent" ? html`<span class="badge hi">agent-originated</span>` : html`<span class="badge">scored</span>`}
            ${a.p_success != null ? html` <span class="chip">P ${Math.round(a.p_success * 100)}%</span>` : null}
            ${a.conflict ? html` <span class="badge hi">conflict open</span>` : null}
            ${a.needs ? html` <span class="chip">needs ${(a.needs || "").replace("_", " ")}</span>` : null}</td>
          <td class="num">${money(a.amount, a.currency)}</td><td>${a.reason}</td>
          <td>${canWork() ? html`<button class="btn pri sm" onClick=${() => act(a.action_id, "approve")}>Approve</button>${" "}
              <button class="btn sm" onClick=${() => act(a.action_id, "reject")}>Decline</button>` : "—"}</td></tr>`)}</tbody></table><//>`}
  </div>`;
}

function Dashboard({ tick }) {
  const [cases, setCases] = useState([]); const [m, setM] = useState({}); const [w, setW] = useState({ counts: {} });
  const [reqs, setReqs] = useState([]);
  useEffect(() => { jget("/api/cases").then(setCases); jget("/metrics").then(setM); jget("/api/workload").then(setW);
    jget("/api/requests/outstanding").then(setReqs); }, [tick]);
  const byStage = {}; const byReason = {};
  cases.forEach(c => { byStage[c.stage] = (byStage[c.stage] || 0) + 1; byReason[c.reason + " · " + c.reason_text] = (byReason[c.reason + " · " + c.reason_text] || 0) + 1; });
  const due = cases.filter(c => c.days_left < 7).length, conf = cases.filter(c => c.conflict).length;
  const kpi = (l, v) => html`<div class="kpi" key=${l}><div class="l">${l}</div><div class="v">${v}</div></div>`;
  return html`<div><h1>Operations Dashboard</h1>
    <p class="sub">The dispute book as it stands.
      ${" "}<span class="badge" style=${m.llm_enabled ? { color: "var(--ok)", borderColor: "var(--ok)" } : {}}>
        agents: ${m.llm_enabled ? "LLM on" : "deterministic only"}</span></p>
    <div class="kpis">${kpi("Open cases", cases.length)}${kpi("Window under 7 days", due)}${kpi("Cases with conflict", conf)}
      ${kpi("Actions executed", m.actions_done ?? 0)}${kpi("Unassigned", w.unassigned ?? 0)}${kpi("Agent runs", m.llm_runs ?? 0)}
      ${kpi("Agent fallbacks", m.llm_fallbacks ?? 0)}${kpi("Agent tokens", (m.llm_tokens_in ?? 0) + (m.llm_tokens_out ?? 0))}</div>
    <div class="grid2">
      <${Panel} pad=${false} title="By stage"><table><thead><tr><th>Stage</th><th class="num">Cases</th></tr></thead>
        <tbody>${Object.entries(byStage).map(([k, v]) => html`<tr key=${k}><td>${k}</td><td class="num">${v}</td></tr>`)}</tbody></table><//>
      <${Panel} pad=${false} title="By reason code"><table><thead><tr><th>Reason</th><th class="num">Cases</th></tr></thead>
        <tbody>${Object.entries(byReason).map(([k, v]) => html`<tr key=${k}><td>${k}</td><td class="num">${v}</td></tr>`)}</tbody></table><//>
    </div>
    <div class="grid2">
      <${Panel} title="Workload" x="open cases per person">
        <div class="kv">${Object.entries(w.counts).map(([n, v]) => html`<dt key=${n}>${n}</dt><dd key=${n + "v"}>${v}</dd>`)}</div><//>
      <${Panel} pad=${false} title="Outstanding requests" x="the chase list, by party">
        ${reqs.length ? html`<table><thead><tr><th>Party</th><th class="num">Open</th><th class="num">Overdue</th></tr></thead>
          <tbody>${reqs.map(r => html`<tr key=${r.party}><td>${r.party}</td><td class="num">${r.open_requests}</td>
            <td class="num" style=${r.overdue ? { color: "var(--alert)" } : {}}>${r.overdue}</td></tr>`)}</tbody></table>`
          : html`<div class="body" style=${{ color: "var(--muted)" }}>Nothing outstanding.</div>`}<//>
    </div>
  </div>`;
}

function Reports({ tick }) {
  const [cid, setCid] = useState("DSP-100205");
  const [rep, setRep] = useState(null);
  useEffect(() => { jget("/api/reports").then(setRep); }, [tick]);
  const kpi = (l, v) => html`<div class="kpi" key=${l}><div class="l">${l}</div><div class="v">${v}</div></div>`;
  return html`<div><h1>Reports</h1><p class="sub">Aging, outcomes, and exports.</p>
    ${rep && html`<div>
      <div class="kpis">${kpi("Open cases", rep.open_cases)}${kpi("SLA breaches on the register", rep.sla_breaches)}
        ${kpi("Recovered value", Object.values(rep.outcomes_by_reason).reduce((a, r) => a + (r.recovered_value || 0), 0).toFixed(2))}</div>
      <div class="grid2">
        <${Panel} pad=${false} title="Aging" x="open cases by days left on the window">
          <table><thead><tr><th>Days left</th><th class="num">Cases</th></tr></thead>
          <tbody>${Object.entries(rep.aging_by_days_left).map(([b, n]) => html`<tr key=${b}><td>${b}</td><td class="num">${n}</td></tr>`)}</tbody></table><//>
        <${Panel} pad=${false} title="TAT compliance" x=${(rep.jurisdiction || "") + " · median " + (rep.median_days_to_decision ?? "—") + "d to decision · " + rep.past_investigation_limit + " past the investigation limit"}>
          <table><thead><tr><th>Regulatory clock</th><th class="num">Met</th><th class="num">Missed</th><th class="num">Pending</th></tr></thead>
          <tbody>${Object.entries(rep.tat || {}).map(([k, v]) => html`<tr key=${k}>
            <td>${k.replace(/_/g, " ")}</td><td class="num">${v.met}</td>
            <td class="num" style=${v.missed ? { color: "var(--alert)" } : {}}>${v.missed}</td>
            <td class="num">${v.pending}</td></tr>`)}</tbody></table><//>
        <${Panel} pad=${false} title="Outcomes by reason code" x="decided cases · recovered value">
          <table><thead><tr><th>Reason</th><th class="num">Cardholder</th><th class="num">Merchant</th><th class="num">No recovery</th><th class="num">Recovered</th></tr></thead>
          <tbody>${Object.entries(rep.outcomes_by_reason).map(([rc, r]) => html`<tr key=${rc}>
            <td class="mono">${rc}</td><td class="num">${r["Cardholder favour"]}</td><td class="num">${r["Merchant favour"]}</td>
            <td class="num">${r["No recovery"]}</td><td class="num">${(r.recovered_value || 0).toFixed(2)}</td></tr>`)}</tbody></table><//>
      </div></div>`}
    <${Panel} pad=${false} title="Available exports"><table>
      <thead><tr><th>Report</th><th>Contents</th><th></th></tr></thead><tbody>
      <tr><td>Dispute book</td><td style=${{ color: "var(--muted)" }}>Every case: amounts, reason codes, stages, owners, outcomes</td>
        <td><a class="btn sm" href="/api/export/cases.csv" download>Export CSV</a></td></tr>
      <tr><td>Regulatory pack</td><td style=${{ color: "var(--muted)" }}>Per-case regulatory clocks and their compliance state — the period filing</td>
        <td><a class="btn sm" href="/api/export/regulatory.csv" download>Export CSV</a></td></tr>
      <tr><td>Case audit trail</td><td style=${{ color: "var(--muted)" }}>
          The complete audit record for <input style=${{ width: "120px" }} value=${cid} onInput=${e => setCid(e.target.value)}/></td>
        <td><a class="btn sm" href=${"/api/export/audit.csv?case_id=" + encodeURIComponent(cid)} download>Export CSV</a></td></tr>
      </tbody></table><//>
  </div>`;
}

function Admin({ tick, refresh }) {
  const [rules, setRules] = useState(null);
  const [agents, setAgents] = useState(null);
  const [skills, setSkills] = useState(null);
  const [cfgAudit, setCfgAudit] = useState([]);
  useEffect(() => { jget("/api/rules").then(setRules); jget("/api/agents").then(setAgents);
    jget("/api/skills").then(setSkills); jget("/api/config-audit").then(setCfgAudit); }, [tick]);
  const confirmCfg = async () => { const r = await jpost("/api/rules/confirm"); notify(r.error || ("Applied by " + r.by + ".")); refresh(); };
  const discardCfg = async () => { const r = await jpost("/api/rules/discard"); notify(r.error || "Change discarded."); refresh(); };
  if (!rules) return html`<div><h1>Administration</h1></div>`;
  const setReason = (code, f, v) => setRules({ ...rules, reasons: { ...rules.reasons, [code]: { ...rules.reasons[code], [f]: v } } });
  const save = async () => {
    const reasons = {};
    Object.entries(rules.reasons).forEach(([k, x]) => {
      reasons[k] = { ...x, window_days: parseInt(x.window_days) || 30,
        required: Array.isArray(x.required) ? x.required : String(x.required).split(",").map(s => s.trim()).filter(Boolean),
        actions: Array.isArray(x.actions) ? x.actions : String(x.actions).split(",").map(s => s.trim()).filter(Boolean) };
    });
    const r = await jbody("/api/rules", { reasons, policy: rules.policy, sla: rules.sla }, "PUT");
    notify(r.error || "Change proposed — a second person (team lead) confirms it.");
    refresh();
  };
  const setSla = (k, v) => setRules({ ...rules, sla: { ...rules.sla, [k]: v } });
  return html`<div><h1>Administration</h1>
    <p class="sub">Changes are maker-checker: one person proposes, a different team lead confirms.</p>
    ${rules.pending && html`<div class="banner"><b>Awaiting confirmation.</b>
      ${" " + rules.pending.proposed_by + " proposed a change to " + Object.keys(rules.pending.change).join(", ").replace(/_/g, " ") + ". "}
      ${isLead() && html`<button class="btn sm pri" onClick=${confirmCfg}>Confirm & apply</button>`}
      ${" "}<button class="btn sm" onClick=${discardCfg}>Discard</button></div>`}
    ${agents && html`<${Panel} pad=${false} title="Agents" x="mandate + skills">
      <table><thead><tr><th>Agent</th><th>Mandate</th><th>Skills</th></tr></thead>
      <tbody>${Object.entries(agents).map(([k, a]) => html`<tr key=${k}>
        <td><span class="mono">${k}</span> ${a.name}</td>
        <td style=${{ color: "var(--muted)", fontSize: "12.5px" }}><details><summary style=${{ cursor: "pointer" }}>${short(a.soul, 110)}</summary>
          <div style=${{ whiteSpace: "pre-wrap", marginTop: "5px" }}>${a.soul}</div></details></td>
        <td>${a.skills.length} — <span class="mono" style=${{ fontSize: "11px" }}>${a.skills.join(", ")}</span></td></tr>`)}
      <tr><td>Advocate pair</td><td style=${{ color: "var(--muted)", fontSize: "12.5px" }}>Two opposite souls argue both sides of a conflict from the evidence on file. They argue; a person decides.</td><td>on demand</td></tr>
      </tbody></table><//>`}
    ${skills && html`<${Panel} pad=${false} title="Skills" x="what the agents read at runtime">
      <div class="body">${Object.entries(skills).map(([n, sk]) => html`<details key=${n} style=${{ marginBottom: "6px" }}>
        <summary style=${{ cursor: "pointer", fontSize: "12.5px" }}><span class="mono">${n}</span>
          <span style=${{ color: "var(--muted)" }}> — ${sk.description}</span>
          ${sk.allowed_tools && sk.allowed_tools.length ? html` <span class="chip">${sk.allowed_tools.length} tools</span>` : null}</summary>
        <div class="mono" style=${{ whiteSpace: "pre-wrap", fontSize: "11px", color: "var(--muted)", padding: "6px 0 0 14px" }}>${sk.body}</div>
      </details>`)}</div><//>`}
    <${Panel} pad=${false} title="Reason-code rules">
      <table><thead><tr><th>Code</th><th>Meaning</th><th>Window (days)</th><th>Required evidence</th><th>Permitted actions</th><th>Reasoning config</th></tr></thead>
      <tbody>${Object.entries(rules.reasons).map(([code, x]) => html`<tr key=${code}>
        <td class="mono">${code}</td><td>${x.text}</td>
        <td><input style=${{ width: "56px" }} value=${x.window_days} onInput=${e => setReason(code, "window_days", e.target.value)}/></td>
        <td><input style=${{ width: "180px" }} value=${Array.isArray(x.required) ? x.required.join(", ") : x.required} onInput=${e => setReason(code, "required", e.target.value)}/></td>
        <td><input style=${{ width: "230px" }} value=${Array.isArray(x.actions) ? x.actions.join(", ") : x.actions} onInput=${e => setReason(code, "actions", e.target.value)}/></td>
        <td style=${{ fontSize: "11.5px", color: "var(--muted)" }}>
          <details><summary style=${{ cursor: "pointer" }}>${(x.hypotheses || []).length} hypotheses · ${x.contradiction ? "contradiction rule" : "no contradiction rule"}</summary>
            <div class="mono" style=${{ whiteSpace: "pre-wrap", fontSize: "10.5px" }}>${JSON.stringify({ hypotheses: x.hypotheses, links: x.links, contradiction: x.contradiction }, null, 1)}</div></details></td></tr>`)}</tbody></table><//>
    ${rules.sla && html`<${Panel} pad=${false} title="Regulatory clocks" x="fixed by the regulator — varies by jurisdiction">
      <table style=${{ maxWidth: "560px" }}><tbody>
        <tr><td>Jurisdiction</td>
          <td><input style=${{ width: "200px" }} value=${rules.sla.jurisdiction} onInput=${e => setSla("jurisdiction", e.target.value)}/></td></tr>
        <tr><td>Provisional-credit decision (business days)</td>
          <td><input style=${{ width: "56px" }} value=${rules.sla.provisional_credit_business_days}
            onInput=${e => setSla("provisional_credit_business_days", parseInt(e.target.value) || 0)}/></td></tr>
        <tr><td>Investigation limit (days)</td>
          <td><input style=${{ width: "56px" }} value=${rules.sla.investigation_days}
            onInput=${e => setSla("investigation_days", parseInt(e.target.value) || 0)}/></td></tr>
      </tbody></table><//>`}
    <${Panel} pad=${false} title="Approval policy">
      <table style=${{ maxWidth: "460px" }}><thead><tr><th>Action</th><th>Needs sign-off from</th></tr></thead>
      <tbody>${Object.entries(rules.policy).map(([act, role]) => html`<tr key=${act}>
        <td>${act.replace(/_/g, " ")}</td>
        <td>${act === "decision_lead_limit"
          ? html`<input style=${{ width: "80px" }} value=${role}
              onInput=${e => setRules({ ...rules, policy: { ...rules.policy, [act]: parseFloat(e.target.value) || 0 } })}/>`
          : html`<select value=${role} onChange=${e => setRules({ ...rules, policy: { ...rules.policy, [act]: e.target.value } })}>
              <option value="analyst">Analyst</option><option value="team_lead">Team Lead</option></select>`}</td></tr>`)}</tbody></table><//>
    <button class="btn pri" onClick=${save}>Propose change</button>
    ${cfgAudit.length > 0 && html`<div style=${{ height: "12px" }}></div>
      <${Panel} title="Change log" x="the control plane's own trail — caseless audit">
        <${AuditList} items=${cfgAudit} maxHeight="220px"/><//>`}
    <div style=${{ height: "12px" }}></div>
    <${Panel} pad=${false} title="Data handling">
      <table><thead><tr><th>Data</th><th>How it is handled</th></tr></thead><tbody>
        <tr><td>Card number</td><td>Stored as a token plus last four only — replaced at every intake door before anything is written.</td></tr>
        <tr><td>CVV / PIN / track data</td><td>Never stored; dropped on intake, even inside free text.</td></tr>
        <tr><td>Text redaction</td><td>Card numbers in any text field are found (pattern + Luhn check) and masked.</td></tr>
        <tr><td>Evidence acquisition</td><td>Bank systems of record are pulled read-only by keys the case holds; external parties are reached only through an approved request.</td></tr>
        <tr><td>Retention</td><td>Case history is kept — corrections supersede, nothing is deleted; sensitive fields are tokenised, not erased.</td></tr>
      </tbody></table><//>
  </div>`;
}

/* ---------------- cardholder view (simulated channel) ---------------- */
const STAGE_PLAIN = { raised: "We have your dispute", gathering: "We're gathering the facts",
  reconstructed: "We've pieced together what happened", interpreting: "We're weighing the evidence",
  awaiting_approval: "A specialist is reviewing the next step", actioned: "We've acted on your dispute",
  resolved: "Resolved" };

function Cardholder({ tick, refresh }) {
  const [cases, setCases] = useState([]);
  const [cid, setCid] = useState("");
  const [cv, setCv] = useState(null);
  const [reply, setReply] = useState("");
  const [story, setStory] = useState("");
  const [draft, setDraft] = useState(null);
  const [manual, setManual] = useState(false);
  const [chat, setChat] = useState([]);
  const [q, setQ] = useState("");
  const ask = async () => {
    const question = q.trim(); if (!question) return;
    setQ("");
    const r = await jbody(`/api/cardholder/${cid}/chat`, { text: question });
    setChat(cs => [...cs, { q: question, a: r.answer || r.error }]);
    if (r.filed) refresh();               // the reply landed on the case — asks update
  };
  useEffect(() => { jget("/api/cases").then(cs => { setCases(cs); setCid(x => x || (cs[0] && cs[0].case_id) || ""); }); }, [tick]);
  useEffect(() => { if (cid) jget(`/api/cardholder/${cid}`).then(setCv); }, [cid, tick]);
  const respond = async () => {
    const r = await jbody("/api/ingest", { supplied_by: "customer", source_system: "cardholder_channel",
      fields: { txn_id: cv.txn_id, text: reply, channel: "cardholder portal" } });
    notify(r.error || (r.status === "attached" ? "Thank you — your reply is on the case." : "Received — a person will place it."));
    setReply(""); refresh();
  };
  const parse = async () => {
    const r = await jbody("/api/cardholder/parse", { text: story });
    if (r.error) { notify(r.error); setManual(true); return; }
    setDraft({ customer_id: "CUST-DEMO", card_token: "tok_demo_0000", txn_id: "",
      amount: r.draft.amount ?? "", currency: r.draft.currency || "USD",
      reason_code: r.draft.reason_code || "13.1", merchant: r.draft.merchant || "", summary: r.draft.summary || "" });
  };
  const confirmRaise = async () => {
    const r = await jbody("/api/cardholder/raise", { fields: draft, statement: story });
    notify(r.error || ("Dispute " + r.case_id + " raised — we'll keep you posted."));
    if (!r.error) { setCid(r.case_id); setDraft(null); setStory(""); setManual(false); }
    refresh();
  };
  const setD = (k, v) => setDraft({ ...draft, [k]: v });
  return html`<div><h1>Cardholder view</h1>
    <p class="sub">Simulated channel — operator preview.</p>
    <${Panel} title="Tell us what happened">
      ${!draft && html`<div>
        <textarea rows="3" style=${{ width: "100%", fontFamily: "inherit", fontSize: "13px", border: "1px solid var(--line)",
            borderRadius: "4px", background: "var(--surface)", color: "var(--ink)", padding: "7px" }}
          placeholder="e.g. I ordered a lamp from BrightHome on the 3rd, paid 84 dollars, and it never arrived…"
          value=${story} onInput=${e => setStory(e.target.value)}></textarea>
        <div style=${{ marginTop: "8px", display: "flex", gap: "8px", alignItems: "center" }}>
          <button class="btn pri" disabled=${!story.trim()} onClick=${parse}>Continue</button>
          <button class="btn sm" onClick=${() => { setManual(true); setDraft({ customer_id: "CUST-DEMO", card_token: "tok_demo_0000",
            txn_id: "", amount: "", currency: "USD", reason_code: "13.1", merchant: "", summary: "" }); }}>Enter details myself</button>
          <span style=${{ fontSize: "11px", color: "var(--faint)" }}>Your words are kept as your statement. Card numbers are hidden automatically.</span>
        </div></div>`}
      ${draft && html`<div>
        ${!manual && html`<div class="banner" style=${{ marginBottom: "8px" }}><b>Here's what we understood.</b>
          ${draft.summary ? " " + draft.summary : ""} Check the details — nothing is sent until you confirm.</div>`}
        <div class="grid3">
          <select value=${draft.reason_code} onChange=${e => setD("reason_code", e.target.value)}>
            <option value="13.1">Item or service not received</option><option value="13.3">Not as described</option>
            <option value="10.4">I didn't make this payment</option><option value="12.6">Charged twice</option></select>
          <input placeholder="Amount" value=${draft.amount} onInput=${e => setD("amount", e.target.value)}/>
          <input placeholder="Transaction id (from your statement)" value=${draft.txn_id} onInput=${e => setD("txn_id", e.target.value)}/>
        </div>
        <div style=${{ marginTop: "8px" }}>
          <button class="btn pri" disabled=${!draft.amount || !draft.txn_id} onClick=${confirmRaise}>Submit dispute</button>
          ${" "}<button class="btn sm" onClick=${() => { setDraft(null); setManual(false); }}>Start over</button>
        </div></div>`}<//>
    <${Panel} title="Your dispute" x=${html`<select value=${cid} onChange=${e => setCid(e.target.value)}>
        ${cases.map(x => html`<option key=${x.case_id} value=${x.case_id}>${x.case_id}</option>`)}</select>`}>
      ${cv ? html`<div>
        <div class="kv">
          <dt>Status</dt><dd>${STAGE_PLAIN[cv.stage] || cv.stage}${cv.outcome ? " — " + cv.outcome : ""}</dd>
          <dt>Disputed amount</dt><dd>${money(cv.amount, cv.currency)}</dd>
          <dt>What it's about</dt><dd>${cv.reason_text}</dd>
          ${cv.provisional_credit_by && !cv.outcome ? html`<dt>Provisional credit</dt><dd>decision due by <span class="mono">${(cv.provisional_credit_by || "").slice(0, 10)}</span></dd>` : null}
        </div>
        ${cv.open_asks.length > 0 ? html`<div style=${{ marginTop: "10px" }}>
          <div style=${{ fontSize: "11px", textTransform: "uppercase", color: "var(--muted)", marginBottom: "5px" }}>We need something from you</div>
          ${cv.open_asks.map((a, i) => html`<div class="item" key=${i}><div class="t"><span class="k">${a.purpose || (a.asked_for || []).join(", ").replace(/_/g, " ")}</span>
            <span class="w">reply by ${a.due}</span></div></div>`)}
          <textarea rows="2" style=${{ width: "100%", fontFamily: "inherit", fontSize: "13px", border: "1px solid var(--line)",
              borderRadius: "4px", background: "var(--surface)", color: "var(--ink)", padding: "7px" }}
            placeholder="Type your reply…" value=${reply} onInput=${e => setReply(e.target.value)}></textarea>
          <button class="btn pri" style=${{ marginTop: "7px" }} disabled=${!reply.trim()} onClick=${respond}>Send reply</button></div>`
          : html`<div style=${{ marginTop: "10px", color: "var(--muted)", fontSize: "12.5px" }}>Nothing needed from you right now.</div>`}
        <div style=${{ marginTop: "14px", borderTop: "1px solid var(--line-2)", paddingTop: "10px" }}>
          <div style=${{ fontSize: "11px", textTransform: "uppercase", color: "var(--muted)", marginBottom: "6px" }}>Ask about your dispute</div>
          ${chat.map((m, i) => html`<div key=${i} style=${{ marginBottom: "7px", fontSize: "12.5px" }}>
            <div style=${{ fontWeight: "600" }}>You: ${m.q}</div>
            <div class="chat-a" style=${{ color: "var(--muted)" }}>${m.a}</div></div>`)}
          <div style=${{ display: "flex", gap: "8px" }}>
            <input style=${{ flex: 1 }} placeholder="e.g. What is happening with my dispute?"
              value=${q} onInput=${e => setQ(e.target.value)}
              onKeyDown=${e => { if (e.key === "Enter") ask(); }}/>
            <button class="btn" disabled=${!q.trim()} onClick=${ask}>Ask</button>
          </div>
        </div>
      </div>` : html`<span style=${{ color: "var(--muted)" }}>No case selected.</span>`}<//>
  </div>`;
}

/* ---------------- case view ---------------- */
function CaseTab({ v, cid, reload, refresh }) {
  const [mode, setMode] = useState("ok");
  const [showAdd, setShowAdd] = useState(false);
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
    const before = (await jget(`/api/agent-runs?case_id=${cid}`)).length;
    const r = await jpost(`/api/cases/${cid}/run-agent`);
    if (r.error) { notify(r.error); return; }
    notify("Agents started — the run is on the record; the case updates as they work.");
    let polls = 0;
    const t = setInterval(async () => {
      polls += 1;
      const runs = await jget(`/api/agent-runs?case_id=${cid}`);
      const active = runs.some(x => x.outcome === "running" || x.outcome === "queued");
      if (runs.length > before && !active) {
        clearInterval(t); notify("Agents finished."); reload(); refresh();
      } else if (polls > 60) {          // ~2.5 min: stop polling, the record persists
        clearInterval(t); notify("Still running — see Agent runs for progress.");
      } else if (polls % 4 === 0) { reload(); }
    }, 2500);
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
  const wc = v.what_changed;
  return html`<div>
    ${v.journey && html`<div title="Derived from the record — late evidence can move a step back."
        style=${{ display: "flex", flexWrap: "wrap", gap: "5px", alignItems: "center", marginBottom: "10px" }}>
      ${v.journey.map((s, i) => html`<span key=${s.step} class=${"badge" + (s.done ? " okb" : "")}
        title=${s.done ? "done" : "not yet"}>${(i + 1) + " " + s.step}</span>`)}</div>`}
    ${contradiction && !v.liability && html`<div class="banner"><b>The evidence is in conflict.</b>
      ${wc && wc.direction_moved ? " The assessment moved: " + wc.direction_moved.from + " → " + wc.direction_moved.to + "." : ""}
      ${" "}Both positions stay on file, every earlier version is kept, and liability is still a person's decision.</div>`}
    ${wc && html`<${Panel} title="What changed" x=${"timeline v" + wc.from_version + " → v" + wc.to_version + " — the visible delta"}>
      ${wc.added.map(d => html`<div key=${d} style=${{ fontSize: "12.5px" }}><span class="badge okb">+</span> ${" " + d}</div>`)}
      ${wc.removed.map(d => html`<div key=${d} style=${{ fontSize: "12.5px" }}><span class="badge hi">−</span> ${" " + d}</div>`)}
      ${wc.superseded.length > 0 && html`<div style=${{ fontSize: "12.5px", marginTop: "5px" }}>Superseded (kept, never deleted): ${wc.superseded.map(s => s.kind.replace(/_/g, " ") + " [" + s.id + "]").join(", ")}</div>`}
      ${wc.direction_moved && html`<div style=${{ fontSize: "12.5px", marginTop: "5px" }}><b>The assessment moved:</b> ${wc.direction_moved.from} → ${wc.direction_moved.to}</div>`}
      ${wc.briefs_stale && html`<div style=${{ fontSize: "12.5px", marginTop: "5px", color: "var(--alert)" }}>The advocate briefs were written against the earlier record — hear both sides again.</div>`}<//>`}
    <div class="two"><div>
      <${Panel} title="Case"><div class="kv">
        <dt>Cardholder</dt><dd class="mono">${c.customer_id}</dd>
        <dt>Card</dt><dd><span class="chip tok">${c.card_id}</span></dd>
        <dt>Amount</dt><dd>${money(c.amount, c.currency)}</dd><dt>Reason</dt><dd>${c.reason_code}</dd>
        <dt>Owner</dt><dd>${c.assigned_to ? (NAMES[c.assigned_to] || c.assigned_to) : "unassigned"}
          ${!c.assigned_to && canWork() && html` <button class="btn sm" onClick=${claim}>Claim</button>`}
          ${isLead() && html`<select style=${{ marginLeft: "8px" }} value="" onChange=${e => e.target.value && reassign(e.target.value)}>
            <option value="">reassign…</option>
            ${Object.entries(PROFILES).filter(([, p]) => p.role === "analyst" || p.role === "team_lead")
              .map(([k, p]) => html`<option key=${k} value=${k}>${p.name}</option>`)}</select>`}</dd>
      </div><//>
      <${Panel} title="Event timeline" x=${"v" + v.timeline_version + (v.timeline_version > 1 ? " · previous kept" : "")}>
        <div class="tl">${v.timeline.length ? v.timeline.map((t, i) => html`<div class="e" key=${i}>
          <div class="d">${(t.occurred_at || "").replace("T", " ").slice(0, 16)}</div>${t.description}</div>`)
          : html`<span style=${{ color: "var(--muted)" }}>no events yet</span>`}</div><//>
      <${Panel} title="Evidence" x=${html`<span>${v.evidence.length} items
          ${canWork() && html` <button class="btn sm" onClick=${() => setShowAdd(!showAdd)}>${showAdd ? "Close" : "Add evidence"}</button>`}</span>`}>
        ${v.evidence.map(e => html`<div class="item" key=${e.evidence_id}>
          <div class="t"><span class="k">${e.kind}</span><span class="chip">${e.assertion_type}</span>
            <span class="chip">${e.source_authority || ""}</span>
            <span class="w">${(e.effective_at || "").slice(0, 10)}</span></div>
          <div class="p mono">${short(JSON.stringify(e.payload), 200)}</div>
          ${e.payload && e.payload.image ? html`<div style=${{ marginTop: "6px" }}>
            <a href=${"/" + e.payload.image} target="_blank"><img src=${"/" + e.payload.image} alt="attached photo"
              style=${{ maxHeight: "70px", border: "1px solid var(--line)", borderRadius: "4px" }}/></a></div>` : null}
        </div>`)}<//>
      ${showAdd && canWork() && html`<${Panel} title="Add evidence">
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
          <span style=${{ fontSize: "11px", color: "var(--faint)", marginLeft: "8px" }}>Card numbers in text are masked on intake.</span></div><//>`}
    </div><div>
      <${Panel} title="Working positions">
        ${v.hypotheses.map(h => html`<div class=${"pos" + (h === lead ? " lead" : "")} key=${h.statement}>
          <div class="r"><span class="s">${h.statement}</span><span class="pc">${h.confidence}%</span></div>
          <div class="track"><div class="fill" style=${{ width: h.confidence + "%" }}></div></div></div>`)}<//>
      ${v.briefs && html`<${Panel} title="Advocate briefs"
        x=${v.briefs_meta && v.briefs_meta.stale ? "written against v" + v.briefs_meta.against_version + " — the record has changed" : ""}>
        ${v.briefs_meta && v.briefs_meta.stale && html`<div class="banner" style=${{ marginBottom: "8px" }}>These briefs argue the record as it stood at v${v.briefs_meta.against_version}. New evidence arrived since — hear both sides again before relying on them.</div>`}
        <div class="grid2">
          <div><div class="rec-h" style=${{ fontSize: "11px", textTransform: "uppercase", color: "var(--muted)", marginBottom: "5px" }}>For the cardholder</div>
            <div style=${{ fontSize: "12.5px", whiteSpace: "pre-wrap" }}>${v.briefs.cardholder}</div></div>
          <div><div style=${{ fontSize: "11px", textTransform: "uppercase", color: "var(--muted)", marginBottom: "5px" }}>For the merchant</div>
            <div style=${{ fontSize: "12.5px", whiteSpace: "pre-wrap" }}>${v.briefs.merchant}</div></div></div><//>`}
      ${((v.deadlines && v.deadlines.length > 0) || (v.requests && v.requests.length > 0)) && html`<${Panel} pad=${false} title="Waiting on">
        ${v.deadlines && v.deadlines.length > 0 && html`<table><thead><tr><th>Deadline</th><th>Due</th><th>Status</th></tr></thead>
          <tbody>${v.deadlines.map(d => html`<tr key=${d.deadline_id}>
            <td>${({ representment_window: "Scheme response window", response_sla: "Provisional credit decision",
                     evidence_due: "Investigation limit" })[d.kind] || d.kind}</td>
            <td class="mono">${(d.due_at || "").slice(0, 10)}</td>
            <td><span class=${"badge" + (d.status === "missed" || (d.status === "pending" && (d.due_at || "") < new Date().toISOString()) ? " hi"
              : d.status === "met" ? " okb" : "")}>${d.status}</span></td></tr>`)}</tbody></table>`}
        ${v.requests && v.requests.length > 0 && html`<table><thead><tr><th>Party</th><th>Asked for</th><th>Status</th><th>Due</th></tr></thead>
          <tbody>${v.requests.map(r => html`<tr key=${r.request_id}>
            <td>${r.party_name}</td><td>${r.kinds.join(", ").replace(/_/g, " ")}</td>
            <td><span class=${"badge" + (r.status === "fulfilled" ? " okb" : r.overdue ? " hi" : "")}>${r.status}${r.chase_count ? " ·" + r.chase_count + " chased" : ""}</span></td>
            <td class="mono" style=${r.overdue ? { color: "var(--alert)" } : {}}>${r.status === "fulfilled" ? "—" : (r.due_at || "").slice(0, 10)}</td></tr>`)}</tbody></table>`}<//>`}
      <${Panel} title="Exceptions">
        ${v.gaps.length ? v.gaps.map(g => {
          const ab = typeof g.about === "string" ? JSON.parse(g.about || "{}") : (g.about || {});
          return html`<div class=${"exc " + g.kind + (g.status === "resolved" ? " resolved" : "")} key=${g.gap_id}>
            <span class="tag">${g.kind}</span><span>${ab.text || g.kind.replace(/_/g, " ")}</span></div>`;
        }) : html`<span style=${{ color: "var(--muted)", fontSize: "12.5px" }}>No open exceptions.</span>`}<//>
      <${Panel} title="Next best action">
        ${rec && rec.status === "proposed" ? html`<div class="rec"><div class="h">recommended action · proposed${rec.params.origin === "agent" ? " · agent-originated" : ""}</div>
            <div class="w">${rec.params.summary}</div>
            ${canWork() && html`<div class="btns"><button class="btn pri" disabled=${busy === "approve"} onClick=${approve}>Approve</button></div>`}
            ${rec.params.p_success != null && html`<div class="gate">Estimated success ${Math.round(rec.params.p_success * 100)}% · needs ${(rec.params.needs || "analyst").replace("_", " ")} · demo model</div>`}
            <div class="gate">Requires approval before anything leaves the bank</div></div>`
        : rec && (rec.status === "approved" || rec.status === "executing") ? html`<div class="rec">
            <div class="h">recommended action · ${rec.status === "executing" ? "awaiting reconciliation" : "approved"}</div>
            <div class="w">${rec.params.summary}</div>
            ${canWork() && html`<div class="btns"><select value=${mode} onChange=${e => setMode(e.target.value)}>
              <option value="ok">external: ok</option><option value="timeout">external: timeout</option><option value="fail">external: fail</option></select>
              <button class="btn pri" disabled=${busy === "exec"} onClick=${execute}>${rec.status === "executing" ? "Retry" : "Execute"}</button></div>`}
            <div class="gate">Runs once, on the record.</div></div>`
        : last && (last.status === "done" || last.status === "compensated") ? html`<div class="rec"><div class="h">last action</div>
            <div class="w">${last.params.summary}</div>
            <div class="gate"><span class="ok">${last.status}</span>${last.external_ref ? " · " + last.external_ref : ""}</div></div>`
        : html`<div class="rec"><div class="h">recommended action</div><div class="w" style=${{ color: "var(--muted)" }}>none pending</div></div>`}<//>
      ${runs && html`<${Panel} pad=${false} title="Agent runs" x="every run on the record — expand a run for its transcript">
        <table><thead><tr><th>Agent</th><th>Outcome</th><th>Turns</th><th>Calls</th><th>Tokens</th></tr></thead>
        <tbody>${runs.map(r => html`<tr key=${r.run_id}><td class="mono">${r.agent}</td>
          <td><span class=${"badge" + ((r.outcome || "").startsWith("fell_back") ? " hi" : "")}>${r.outcome}</span></td>
          <td class="num">${r.turns || 0}</td><td class="num">${r.tool_calls || 0}</td>
          <td class="num">${(r.tokens_in || 0) + (r.tokens_out || 0)}</td></tr>`)}</tbody></table>
        <div class="body">${runs.map(r => html`<details key=${"t" + r.run_id}>
          <summary class="mono" style=${{ fontSize: "11px", color: "var(--faint)", cursor: "pointer" }}>${r.agent} · ${(r.started_at || "").slice(11, 19)} · what it did</summary>
          ${(r.transcript || []).map((t, i) => html`<${TrLine} key=${i} t=${t}/>`)}</details>`)}</div><//>`}
      <${Panel} title="Audit trail" x="append-only">
        <${AuditList} items=${v.audit}/><//>
    </div></div>
    <div class="actionbar">
      ${canWork() && html`<button class="btn pri" disabled=${busy === "agents"} onClick=${runAgents}>${busy === "agents" ? "Agents working…" : "Run the agents"}</button>
      <button class="btn" disabled=${busy === "adv"} onClick=${advocates}>${busy === "adv" ? "Writing briefs…" : "Prepare advocate briefs"}</button>`}
      <button class="btn" onClick=${showRuns}>Agent runs</button>
      ${canWork() && html`<details style=${{ marginLeft: "auto" }}>
        <summary class="btn sm" style=${{ display: "inline-block", listStyle: "none" }}>Demo scenarios</summary>
        <span style=${{ display: "inline-flex", gap: "8px", marginLeft: "8px", flexWrap: "wrap" }}>
          <button class="btn sm" disabled=${busy === "inject"} onClick=${inject}>Late merchant evidence</button>
          <button class="btn sm" disabled=${busy === "correct"} onClick=${correct}>Merchant corrects the record</button>
          <button class="btn sm" disabled=${busy === "cold"} onClick=${cold}>Unmatched evidence</button></span></details>`}
    </div>
  </div>`;
}

function DecisionTab({ v, cid, reload, refresh }) {
  const [choice, setChoice] = useState("");
  const [note, setNote] = useState("");
  const lead = v.hypotheses.reduce((a, b) => (b.confidence > (a?.confidence ?? -1) ? b : a), null);
  const openGaps = v.gaps.filter(g => g.status === "open").length;
  const ir = v.interpretation_reviewed, reviewed = !!(ir && ir.current);
  const review = async () => {
    const r = await jbody(`/api/cases/${cid}/review-interpretation`, { note });
    notify(r.error || ("Interpretation reviewed by " + (r.by || NAMES[getMe()]) + "."));
    reload();
  };
  const record = async () => {
    const r = await jbody(`/api/cases/${cid}/decision`, { outcome: choice });
    notify(r.error || ("Liability recorded by " + (r.decided_by || NAMES[getMe()]) + "."));
    reload(); refresh();
  };
  const netOutcome = async (result) => {
    const r = await jbody(`/api/cases/${cid}/network-outcome`, { result });
    notify(r.error || r.note || ("Network outcome " + result + " — case closed."));
    reload(); refresh();
  };
  const selfReviewed = reviewed && ir.by === NAMES[getMe()];
  const opts = [["Cardholder favour", "Chargeback raised with the network; the case stays open for the network round."],
    ["Merchant favour", "Claim denied; provisional credit reversed with notice."],
    ["No recovery", "Close without pursuing; write off the amount."]];
  return html`<div class="two"><div>
    <${Panel} title="Case summary"><div class="kv">
      <dt>Dispute</dt><dd class="mono">${cid}</dd><dt>Amount</dt><dd>${money(v.case.amount, v.case.currency)}</dd>
      <dt>Strongest position</dt><dd>${lead ? lead.statement + " (" + lead.confidence + "%)" : "—"}</dd>
      <dt>Open exceptions</dt><dd>${openGaps}</dd></div>
      <div class="banner" style=${{ marginTop: "10px" }}>The assessment is advisory. The liability decision is made by the analyst and can differ from the strongest position.</div><//>
    <${Panel} title="Specialist review" x="read the assessment and both narratives, then sign">
      ${reviewed ? html`<div style=${{ fontSize: "12.5px" }}><span class="badge okb">reviewed</span>
          ${" Reviewed by " + ir.by + " against the current record (v" + ir.against_version + ")."}
          ${ir && html`<div style=${{ color: "var(--muted)", marginTop: "4px" }}>Late evidence voids a review — a new version of the record needs a fresh look.</div>`}</div>`
        : html`<div>
          ${ir && !ir.current && html`<div class="banner" style=${{ marginBottom: "8px" }}>The record changed after ${ir.by}'s review (v${ir.against_version}) — it must be reviewed again before deciding.</div>`}
          <div style=${{ fontSize: "12.5px", marginBottom: "8px" }}>
            Assessment: ${lead ? lead.statement + " (" + lead.confidence + "%)" : "not prepared yet"}.
            ${" "}Narratives: ${v.briefs ? "both sides on file" + (v.briefs_meta && v.briefs_meta.stale ? " (stale — the record changed)" : "") : "not written yet"}.</div>
          ${canWork() && html`<input placeholder="Note (optional)" value=${note} onInput=${e => setNote(e.target.value)} style=${{ width: "100%", marginBottom: "8px" }}/>
          <button class="btn pri" onClick=${review}>Mark interpretation reviewed</button>`}
        </div>`}<//>
  </div><div>
    <${Panel} title="Record liability">
      ${v.liability ? html`<div class="liab set"><div class="v">${v.liability}</div>
          <div class="n">${v.case.status === "closed" ? "Recorded · case closed"
            : "Recorded · chargeback filed — the network round is still live."}</div>
          ${v.case.status === "active" && canWork() && html`<div class="decbtns">
            <button class="btn pri" onClick=${() => netOutcome("won")}>Network outcome: won</button>
            <button class="btn" onClick=${() => netOutcome("lost")}>Network outcome: lost</button>
            <span style=${{ fontSize: "11px", color: "var(--faint)" }}>Recorded separately from the internal decision.</span></div>`}
        </div>`
        : !canWork() ? html`<div class="liab"><div class="v">Not decided</div></div>`
        : html`<div>
          ${opts.map(([o, d]) => html`<label key=${o} style=${{ display: "flex", gap: "9px", alignItems: "flex-start", padding: "9px 11px",
              border: "1px solid " + (choice === o ? "var(--accent)" : "var(--line)"), borderRadius: "4px", marginBottom: "8px", cursor: "pointer",
              background: choice === o ? "var(--accent-soft)" : "transparent" }}>
            <input type="radio" name="dec" checked=${choice === o} onChange=${() => setChoice(o)} style=${{ marginTop: "2px" }}/>
            <span>${o}<span style=${{ color: "var(--muted)", fontSize: "12px", display: "block" }}>${d}</span></span></label>`)}
          <button class="btn pri" disabled=${!choice || !reviewed} onClick=${record}
            title=${reviewed ? "" : "review the interpretation first"}>Record decision</button>
          ${!reviewed && html`<div style=${{ fontSize: "11px", color: "var(--faint)", marginTop: "6px" }}>Enabled once the interpretation is reviewed against the current record — enforced by the server, not just this button.</div>`}
          ${selfReviewed && html`<div style=${{ fontSize: "11px", color: "var(--warn, var(--muted))", marginTop: "6px" }}>You reviewed this interpretation — four-eyes: a second person records the decision (enforced by the server).</div>`}
        </div>`}<//>
  </div></div>`;
}

function HistoryTab({ cid }) {
  const [h, setH] = useState(null);
  useEffect(() => { jget(`/api/cases/${cid}/history`).then(setH); }, [cid]);
  if (!h) return html`<div/>`;
  return html`<div>
    <${Panel} pad=${false} title="Timeline versions" x="every version kept">
      <table><thead><tr><th>Version</th><th>Events</th></tr></thead>
      <tbody>${h.timeline_versions.map(tv => html`<tr key=${tv.version}><td class="mono">v${tv.version}</td>
        <td>${tv.events.map((e, i) => html`<div key=${i} style=${{ fontSize: "12.5px" }}>
          <span class="mono" style=${{ color: "var(--faint)", fontSize: "10.5px" }}>${(e.at || "").slice(0, 16).replace("T", " ")}</span> ${e.event}</div>`)}</td></tr>`)}</tbody></table><//>
    <${Panel} pad=${false} title="Every evidence version" x="nothing deleted">
      <table><thead><tr><th>Kind</th><th>Status</th><th>Source</th><th>Payload</th></tr></thead>
      <tbody>${h.evidence.map(e => html`<tr key=${e.evidence_id}>
        <td>${e.kind}</td><td><span class=${"badge" + (e.status === "active" ? " okb" : "")}>${e.status}</span></td>
        <td>${e.source_authority || ""}</td><td class="mono" style=${{ fontSize: "11.5px" }}>${short(JSON.stringify(e.payload), 90)}</td></tr>`)}</tbody></table><//>
    ${h.requests && h.requests.length > 0 && html`<${Panel} pad=${false} title="Service requests" x="every ask, per party">
      <table><thead><tr><th>Party</th><th>Asked for</th><th>Status</th><th>Sent</th><th>Answered by</th></tr></thead>
      <tbody>${h.requests.map(r => html`<tr key=${r.request_id}>
        <td>${r.party_name}</td><td>${r.kinds.join(", ").replace(/_/g, " ")}</td>
        <td><span class=${"badge" + (r.status === "fulfilled" ? " okb" : r.overdue ? " hi" : "")}>${r.status}</span></td>
        <td class="mono">${(r.sent_at || "").slice(0, 10)}</td>
        <td class="mono" style=${{ fontSize: "11px" }}>${(r.fulfilled_by || []).map(f => f.evidence_id.slice(0, 8)).join(", ") || "—"}</td></tr>`)}</tbody></table><//>`}
    ${h.agent_runs.length > 0 && html`<${Panel} pad=${false} title="Agent runs">
      <table><thead><tr><th>Agent</th><th>Outcome</th><th>Turns</th><th>Tokens</th><th>Started</th></tr></thead>
      <tbody>${h.agent_runs.map(r => html`<tr key=${r.run_id}><td class="mono">${r.agent}</td>
        <td><span class=${"badge" + ((r.outcome || "").startsWith("fell_back") ? " hi" : "")}>${r.outcome}</span></td>
        <td class="num">${r.turns || 0}</td><td class="num">${(r.tokens_in || 0) + (r.tokens_out || 0)}</td>
        <td class="mono">${(r.started_at || "").slice(11, 19)}</td></tr>`)}</tbody></table><//>`}
    <${Panel} title="Full audit trail" x=${h.audit.length + " entries · append-only"}>
      <${AuditList} items=${h.audit} maxHeight="360px"/><//>
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
    <p class="sub">${c.reason_code} · ${money(c.amount, c.currency)} · ${c.stage}${v.liability ? " · " + v.liability : ""}</p>
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
  const [screen, setScreen] = useState((PROFILES[getMe()] || {}).home || "queue");
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
      setMeta(`${m.cases} cases${llm}`);
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
  const names = { queue: "Case Queue", approvals: "Approvals", dashboard: "Dashboard", reports: "Reports",
    cardholder: "Cardholder view", admin: "Administration" };
  return html`<div class="app">
    <aside class="side">
      <div class="logo">Disputes Console<small>Cards & Payments · Operations</small></div>
      <nav>
        ${[["Operations", [["queue", "Case Queue", ["analyst", "team_lead", "auditor"], counts.cases],
                           ["approvals", "Approvals", ["analyst", "team_lead"], counts.approvals]]],
           ["Oversight", [["dashboard", "Dashboard", ["team_lead", "ops"]],
                          ["reports", "Reports", ["team_lead", "ops", "auditor"]]]],
           ["Simulation", [["cardholder", "Cardholder view", ["analyst", "team_lead"]]]],
           ["Platform", [["admin", "Administration", ["team_lead"]]]]]
          .map(([grp, items]) => {
            const mine = items.filter(([, , roles]) => roles.includes(myRole()));
            return mine.length === 0 ? null : html`<div key=${grp}>
              <div class="grp">${grp}</div>
              ${mine.map(([s, label, , n]) => html`<a key=${s} class=${screen === s ? "on" : ""} onClick=${() => nav(s)}>
                ${label}${n != null ? html` <span class="b">${n}</span>` : null}</a>`)}</div>`;
          })}
      </nav>
    </aside>
    <div>
      <div class="top">
        <span class="crumb">${screen === "case" ? html`<b onClick=${() => nav("queue")} style=${{ cursor: "pointer" }}>Case Queue</b>` : html`<b>${names[screen]}</b>`}
          ${screen === "case" ? " / " + caseId : ""}</span>
        <span class="m">${meta}</span><span class="sp"></span>
        <label style=${{ fontSize: "12px", color: "var(--muted)" }}>Signed in as</label>
        <select value=${meKey} onChange=${e => { const k = e.target.value; setMeStore(k); setMeKey(k);
            notify("Now working as " + PROFILES[k].name + " · " + PROFILES[k].title + "."); setScreen(PROFILES[k].home); setCaseId(null); refresh(); }}>
          ${Object.entries(PROFILES).map(([k, p]) => html`<option key=${k} value=${k}>${p.name} · ${p.title}</option>`)}</select>
        ${meKey === "lead" && html`<button class="btn sm" onClick=${resetDemo}>Reset demo</button>`}
        <button class="btn sm" onClick=${theme}>Theme</button>
      </div>
      <main class="view">
        ${screen === "queue" ? html`<${Queue} open=${open} tick=${tick} refresh=${refresh}/>`
          : screen === "approvals" ? html`<${Approvals} open=${open} tick=${tick} refresh=${refresh}/>`
          : screen === "dashboard" ? html`<${Dashboard} tick=${tick}/>`
          : screen === "reports" ? html`<${Reports} tick=${tick}/>`
          : screen === "cardholder" ? html`<${Cardholder} tick=${tick} refresh=${refresh}/>`
          : screen === "admin" ? html`<${Admin} tick=${tick} refresh=${refresh}/>`
          : html`<${CaseView} cid=${caseId} tick=${tick} refresh=${refresh}/>`}
      </main>
    </div>
    <${Toasts} items=${toasts}/>
  </div>`;
}

try { const s = localStorage.getItem("dc-theme"); if (s) document.documentElement.setAttribute("data-theme", s); } catch (e) {}
ReactDOM.createRoot(document.getElementById("root")).render(html`<${App}/>`);
