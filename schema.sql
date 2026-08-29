-- Card Dispute domain model — SQLite port of card-dispute-schema.sql.
-- Enums -> TEXT + CHECK; jsonb -> TEXT(JSON); uuid -> TEXT; identity -> INTEGER PK.
-- Append-only audit is enforced in code (no update/delete path to audit_entry).
PRAGMA foreign_keys = ON;

CREATE TABLE dispute_case (
  case_id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  card_id TEXT NOT NULL,                 -- token, never a real PAN
  disputed_txn_id TEXT NOT NULL,
  reason_code TEXT NOT NULL,
  amount REAL, currency TEXT,
  stage TEXT NOT NULL DEFAULT 'raised'
    CHECK (stage IN ('raised','gathering','reconstructed','interpreting','awaiting_approval','actioned','resolved','withdrawn')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','on_hold','closed')),
  liability_outcome TEXT,                -- human-only; set by the decision path
  version INTEGER NOT NULL DEFAULT 1,
  opened_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

CREATE TABLE evidence_item (
  evidence_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES dispute_case(case_id),
  kind TEXT NOT NULL CHECK (kind IN ('customer_statement','merchant_record','transaction_event','receipt','delivery_record','auth_event','correspondence')),
  assertion_type TEXT NOT NULL CHECK (assertion_type IN ('recorded_fact','ai_inference','user_input')),
  payload TEXT NOT NULL,                 -- JSON, redacted on intake
  source_system TEXT, source_authority TEXT, supplied_by TEXT,
  effective_at TEXT, received_at TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 1.0,
  supersedes TEXT REFERENCES evidence_item(evidence_id),
  duplicate_of TEXT REFERENCES evidence_item(evidence_id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','superseded','duplicate'))
);
CREATE INDEX ev_case ON evidence_item(case_id);
CREATE UNIQUE INDEX ev_active_hash ON evidence_item(case_id, content_hash) WHERE status='active';

CREATE TABLE timeline_event (
  timeline_event_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES dispute_case(case_id),
  occurred_at TEXT, description TEXT NOT NULL,
  derived_from TEXT NOT NULL DEFAULT '[]',
  assertion_type TEXT NOT NULL DEFAULT 'ai_inference' CHECK (assertion_type='ai_inference'),
  version INTEGER NOT NULL DEFAULT 1,
  supersedes TEXT REFERENCES timeline_event(timeline_event_id)
);
CREATE INDEX tl_case ON timeline_event(case_id);

CREATE TABLE hypothesis (
  hypothesis_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES dispute_case(case_id),
  statement TEXT NOT NULL, stance TEXT,
  confidence REAL NOT NULL DEFAULT 0.0,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','strengthened','weakened','retired'))
);
CREATE INDEX hy_case ON hypothesis(case_id);

CREATE TABLE evidence_link (
  link_id TEXT PRIMARY KEY,
  hypothesis_id TEXT NOT NULL REFERENCES hypothesis(hypothesis_id),
  evidence_id TEXT NOT NULL REFERENCES evidence_item(evidence_id),
  polarity TEXT NOT NULL CHECK (polarity IN ('supports','weakens','neutralises')),
  weight REAL NOT NULL DEFAULT 1.0,
  UNIQUE (hypothesis_id, evidence_id)
);

CREATE TABLE gap (
  gap_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES dispute_case(case_id),
  kind TEXT NOT NULL CHECK (kind IN ('missing','stale','duplicate','contradiction')),
  about TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  opened_at TEXT NOT NULL, resolved_at TEXT
);
CREATE INDEX gp_case ON gap(case_id);

CREATE TABLE deadline (
  deadline_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES dispute_case(case_id),
  kind TEXT NOT NULL CHECK (kind IN ('evidence_due','representment_window','response_sla')),
  due_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','met','missed')),
  UNIQUE (case_id, kind)
);
CREATE INDEX dl_case ON deadline(case_id);

CREATE TABLE case_action (
  action_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES dispute_case(case_id),
  type TEXT NOT NULL CHECK (type IN ('request_evidence','raise_chargeback','submit_representment','send_correspondence','close_case')),
  params TEXT NOT NULL DEFAULT '{}',
  idempotency_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'proposed' CHECK (status IN ('proposed','approved','executing','done','failed','compensated')),
  approval_id TEXT,
  external_ref TEXT, result TEXT,
  created_at TEXT NOT NULL, executed_at TEXT
);
CREATE INDEX ca_case ON case_action(case_id);

CREATE TABLE approval (
  approval_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES dispute_case(case_id),
  action_id TEXT NOT NULL REFERENCES case_action(action_id),
  decision TEXT NOT NULL CHECK (decision IN ('approve','reject','modify')),
  approver_role TEXT NOT NULL, approver_id TEXT NOT NULL,
  note TEXT, decided_at TEXT NOT NULL
);

CREATE TABLE audit_entry (
  audit_id INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id TEXT NOT NULL REFERENCES dispute_case(case_id),
  at TEXT NOT NULL, actor TEXT NOT NULL, event TEXT NOT NULL,
  reason TEXT, ref TEXT
);
CREATE INDEX au_case ON audit_entry(case_id, audit_id);

CREATE TABLE reeval_trigger (
  trigger_id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL REFERENCES dispute_case(case_id),
  scope TEXT NOT NULL CHECK (scope IN ('timeline','hypotheses')),
  reason TEXT, created_at TEXT NOT NULL, cleared_at TEXT
);
CREATE UNIQUE INDEX rt_pending ON reeval_trigger(case_id, scope) WHERE cleared_at IS NULL;

-- Runtime configuration edited from the Administration screen (reason-code
-- rules, approval policy). Values are JSON.
CREATE TABLE app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- The mock external world, so partial-failure recovery can reconcile against a
-- record that is separate from our own action state.
CREATE TABLE external_ledger (
  idempotency_key TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('unknown','completed','failed')),
  ref TEXT, at TEXT NOT NULL
);
