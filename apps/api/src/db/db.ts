/**
 * One local SQLite file with table prefixes that encode ownership:
 *   pos_*  – owned by the mock POS/KDS simulator
 *   ads_*  – owned by the mock Uber Ads simulator
 *   mp_*   – owned by MarginPulse (orchestrator, policy, approvals, audit)
 * Modules only touch their own prefix; cross-system access goes through
 * HTTP adapters (see apps/api/src/adapters). A single file keeps fixture
 * import atomic (one transaction) which separate files could not.
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type Db = DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS pos_stores (
  pos_store_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  timezone TEXT NOT NULL,
  alert_threshold_minutes REAL NOT NULL CHECK (alert_threshold_minutes >= 0)
);
CREATE TABLE IF NOT EXISTS pos_kitchen_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  pos_store_id TEXT NOT NULL REFERENCES pos_stores(pos_store_id),
  captured_at TEXT NOT NULL,
  p95_prep_minutes REAL NOT NULL CHECK (p95_prep_minutes >= 0),
  active_tickets INTEGER NOT NULL CHECK (active_tickets >= 0),
  connector_health TEXT NOT NULL CHECK (connector_health IN ('HEALTHY','DEGRADED','DOWN'))
);
CREATE TABLE IF NOT EXISTS pos_cost_profiles (
  pos_store_id TEXT PRIMARY KEY REFERENCES pos_stores(pos_store_id),
  avg_food_packaging_cost_cents INTEGER,
  marketplace_fee_rate_bps INTEGER,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pos_outbox (
  event_id TEXT PRIMARY KEY,
  pos_store_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  delivery_count INTEGER NOT NULL DEFAULT 0,
  last_status INTEGER
);
CREATE TABLE IF NOT EXISTS pos_faults (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mode TEXT NOT NULL,
  remaining INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS ads_accounts (
  account_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  currency TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ads_account_stores (
  account_id TEXT NOT NULL REFERENCES ads_accounts(account_id),
  uber_store_id TEXT NOT NULL,
  store_name TEXT NOT NULL,
  PRIMARY KEY (account_id, uber_store_id)
);
CREATE TABLE IF NOT EXISTS ads_tokens (
  token_sha256 TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  account_ids TEXT NOT NULL,
  scopes TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ads_campaigns (
  campaign_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES ads_accounts(account_id),
  name TEXT NOT NULL,
  product TEXT NOT NULL,
  configured_status TEXT NOT NULL CHECK (configured_status IN
    ('CAMPAIGN_CONFIGURED_STATUS_ACTIVE','CAMPAIGN_CONFIGURED_STATUS_PAUSED','CAMPAIGN_CONFIGURED_STATUS_DRAFT')),
  store_ids_json TEXT NOT NULL,
  permissions_json TEXT NOT NULL,
  budget_unit TEXT NOT NULL,
  budget_amount_e5 INTEGER NOT NULL CHECK (budget_amount_e5 >= 0),
  currency TEXT NOT NULL,
  version INTEGER NOT NULL CHECK (version >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  effective_visible_after_ms INTEGER
);
CREATE TABLE IF NOT EXISTS ads_reports (
  report_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES ads_accounts(account_id),
  campaign_id TEXT NOT NULL REFERENCES ads_campaigns(campaign_id),
  window_start TEXT NOT NULL,
  window_end TEXT NOT NULL,
  watermark TEXT NOT NULL,
  attributed_orders INTEGER,
  attributed_sales_cents INTEGER,
  spend_cents INTEGER
);
CREATE TABLE IF NOT EXISTS ads_mutation_ledger (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id TEXT,
  account_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  field TEXT NOT NULL,
  before_value TEXT,
  after_value TEXT,
  version_before INTEGER,
  version_after INTEGER,
  actor TEXT NOT NULL,
  source TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ads_request_log (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  status INTEGER,
  fault TEXT,
  at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ads_faults (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  op TEXT NOT NULL,
  mode TEXT NOT NULL,
  remaining INTEGER NOT NULL,
  param TEXT
);

CREATE TABLE IF NOT EXISTS mp_users (
  user_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('MANAGER','STAFF'))
);
CREATE TABLE IF NOT EXISTS mp_user_stores (
  user_id TEXT NOT NULL REFERENCES mp_users(user_id),
  pos_store_id TEXT NOT NULL,
  PRIMARY KEY (user_id, pos_store_id)
);
CREATE TABLE IF NOT EXISTS mp_store_mappings (
  mapping_id TEXT PRIMARY KEY,
  pos_store_id TEXT NOT NULL,
  uber_store_id TEXT NOT NULL,
  ad_account_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mp_policies (
  policy_id TEXT NOT NULL,
  version TEXT NOT NULL,
  pos_store_id TEXT NOT NULL,
  p95_threshold_minutes REAL NOT NULL,
  min_contribution_rate_bps INTEGER NOT NULL,
  max_pos_snapshot_age_s INTEGER NOT NULL,
  max_ads_report_age_s INTEGER NOT NULL,
  max_event_age_s INTEGER NOT NULL,
  approval_required INTEGER NOT NULL,
  allowed_action TEXT NOT NULL,
  approval_ttl_s INTEGER NOT NULL,
  recommendation_ttl_s INTEGER NOT NULL,
  effective_from TEXT NOT NULL,
  is_current INTEGER NOT NULL,
  PRIMARY KEY (policy_id, version)
);
CREATE TABLE IF NOT EXISTS mp_events (
  event_id TEXT PRIMARY KEY,
  received_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  investigation_id TEXT,
  delivery_count INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS mp_rejected_events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  received_at TEXT NOT NULL,
  reason TEXT NOT NULL,
  payload_excerpt TEXT
);
CREATE TABLE IF NOT EXISTS mp_investigations (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  parent_id TEXT,
  pos_store_id TEXT NOT NULL,
  status TEXT NOT NULL,
  decision TEXT,
  decision_code TEXT,
  policy_id TEXT,
  policy_version TEXT,
  uber_store_id TEXT,
  account_id TEXT,
  candidate_campaign_id TEXT,
  observed_campaign_version INTEGER,
  agent_report_json TEXT,
  agent_validation_json TEXT,
  policy_checks_json TEXT,
  contribution_json TEXT,
  facts_json TEXT,
  result_json TEXT,
  dismiss_reason TEXT,
  extra_checks INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  recommended_at TEXT
);
CREATE TABLE IF NOT EXISTS mp_evidence (
  evidence_id TEXT NOT NULL,
  investigation_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  tool TEXT NOT NULL,
  args_json TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  read_at TEXT NOT NULL,
  PRIMARY KEY (investigation_id, evidence_id)
);
CREATE TABLE IF NOT EXISTS mp_approvals (
  approval_id TEXT PRIMARY KEY,
  investigation_id TEXT NOT NULL,
  pos_store_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  action TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  approved_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT
);
CREATE TABLE IF NOT EXISTS mp_mutations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mutation_key TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  investigation_id TEXT NOT NULL,
  approval_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('IN_FLIGHT','SUCCEEDED','FAILED_NOT_APPLIED','AMBIGUOUS')),
  request_json TEXT NOT NULL,
  response_json TEXT,
  error_code TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  UNIQUE (mutation_key, attempt)
);
CREATE TABLE IF NOT EXISTS mp_audit (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  investigation_id TEXT,
  type TEXT NOT NULL,
  at_sim TEXT NOT NULL,
  at_wall TEXT NOT NULL,
  actor TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL,
  hash_version INTEGER
);
CREATE TRIGGER IF NOT EXISTS mp_audit_no_update BEFORE UPDATE ON mp_audit
BEGIN SELECT RAISE(ABORT, 'mp_audit is append-only'); END;
CREATE TRIGGER IF NOT EXISTS mp_audit_no_delete BEFORE DELETE ON mp_audit
BEGIN SELECT RAISE(ABORT, 'mp_audit is append-only'); END;
CREATE TABLE IF NOT EXISTS mp_import_batches (
  batch_id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  snapshot_json TEXT,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL,
  committed_at TEXT
);
CREATE TABLE IF NOT EXISTS mp_kv (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
`;

export const ALL_TABLES = [
  "pos_stores", "pos_kitchen_snapshots", "pos_cost_profiles", "pos_outbox", "pos_faults",
  "ads_accounts", "ads_account_stores", "ads_tokens", "ads_campaigns", "ads_reports",
  "ads_mutation_ledger", "ads_request_log", "ads_faults",
  "mp_users", "mp_user_stores", "mp_store_mappings", "mp_policies", "mp_events", "mp_rejected_events",
  "mp_investigations", "mp_evidence", "mp_approvals", "mp_mutations", "mp_audit", "mp_import_batches", "mp_kv",
];

export function openDb(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

/**
 * Additive, idempotent migrations for databases created by earlier versions.
 * V3 CH-17: mp_audit.hash_version (NULL on older rows means hash format 1).
 */
export function migrate(db: Db): void {
  const cols = (db.prepare("PRAGMA table_info(mp_audit)").all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes("hash_version")) db.exec("ALTER TABLE mp_audit ADD COLUMN hash_version INTEGER");
}

/** Drop and recreate every table. Demo reset only — the audit trigger forbids row deletes, not DROP. */
export function recreateSchema(db: Db): void {
  db.exec("PRAGMA foreign_keys = OFF;");
  for (const t of [...ALL_TABLES].reverse()) db.exec(`DROP TABLE IF EXISTS ${t};`);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
}

export function tx<T>(db: Db, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

export type Row = Record<string, unknown>;
export const all = (db: Db, sql: string, ...p: unknown[]) =>
  db.prepare(sql).all(...(p as never[])) as Row[];
export const get = (db: Db, sql: string, ...p: unknown[]) =>
  db.prepare(sql).get(...(p as never[])) as Row | undefined;
export const run = (db: Db, sql: string, ...p: unknown[]) => db.prepare(sql).run(...(p as never[]));

/** Small key-value store for counters, clock and scenario. */
export function kvGet(db: Db, k: string): string | undefined {
  return get(db, "SELECT v FROM mp_kv WHERE k = ?", k)?.v as string | undefined;
}
export function kvSet(db: Db, k: string, v: string): void {
  run(db, "INSERT INTO mp_kv(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", k, v);
}
export function nextCounter(db: Db, k: string, start: number): number {
  const cur = Number(kvGet(db, k) ?? start - 1) + 1;
  kvSet(db, k, String(cur));
  return cur;
}
