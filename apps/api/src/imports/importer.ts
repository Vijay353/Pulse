/**
 * Validate → preview → (confirm) → atomic commit → re-query.
 * Seeding uses the exact same path (applyDataset) so fixtures and workbook
 * imports can never drift apart.
 */
import { createHash, randomUUID } from "node:crypto";
import { all, Db, get, run, tx } from "../db/db";
import type { Dataset } from "../../../../packages/fixtures/src/seed";
import { coerceCell, ENTITY_NAMES, EntityName, ImportMode, IMPORT_LIMITS, SHEET_BY_NAME, SHEETS } from "./schema";
import type { Clock } from "../clock";

export interface RawSheet {
  headers: string[];
  rows: unknown[][];
}
export type RawWorkbook = Partial<Record<string, RawSheet>>;

export interface ImportIssue {
  sheet: string;
  row: number | null; // spreadsheet row number (header = 1)
  column: string | null;
  message: string;
}

export interface EntitySummary {
  added: number;
  updated: number;
  unchanged: number;
  removed: number;
  rejected: number;
}

export interface ValidationResult {
  ok: boolean;
  errors: ImportIssue[];
  warnings: ImportIssue[];
  summary: Partial<Record<EntityName, EntitySummary>>;
  normalized: Partial<Dataset>;
  changes: { sheet: EntityName; key: string; change: "added" | "updated" | "removed"; detail?: string }[];
}

type AnyRow = Record<string, unknown>;
const keyOf = (sheet: EntityName, r: AnyRow) => SHEET_BY_NAME[sheet].key.map((k) => String(r[k])).join("|");
const canon = (r: AnyRow) => JSON.stringify(Object.keys(r).sort().map((k) => [k, r[k]]));

/* ------------------------------------------------------------------ */
/* DB <-> dataset                                                      */
/* ------------------------------------------------------------------ */

const cents = (n: number | null) => (n === null ? null : Math.round(n * 100));
const dollars = (c: unknown) => (c === null || c === undefined ? null : Number(c) / 100);

export function datasetFromDb(db: Db): Dataset {
  return {
    users: all(db, "SELECT user_id, display_name, role FROM mp_users ORDER BY user_id") as Dataset["users"],
    user_stores: all(db, "SELECT user_id, pos_store_id FROM mp_user_stores ORDER BY user_id, pos_store_id") as Dataset["user_stores"],
    stores: all(db, "SELECT pos_store_id, name, timezone, alert_threshold_minutes FROM pos_stores ORDER BY pos_store_id") as Dataset["stores"],
    store_mappings: all(db, "SELECT mapping_id, pos_store_id, uber_store_id, ad_account_id FROM mp_store_mappings ORDER BY mapping_id") as Dataset["store_mappings"],
    kitchen_snapshots: all(db, "SELECT snapshot_id, pos_store_id, captured_at, p95_prep_minutes, active_tickets, connector_health FROM pos_kitchen_snapshots ORDER BY snapshot_id") as Dataset["kitchen_snapshots"],
    cost_profiles: all(db, "SELECT pos_store_id, avg_food_packaging_cost_cents, marketplace_fee_rate_bps FROM pos_cost_profiles ORDER BY pos_store_id").map((r) => ({
      pos_store_id: String(r.pos_store_id),
      avg_food_packaging_cost_usd: dollars(r.avg_food_packaging_cost_cents),
      marketplace_fee_rate_pct: r.marketplace_fee_rate_bps === null ? null : Number(r.marketplace_fee_rate_bps) / 100,
    })),
    ad_accounts: all(db, "SELECT account_id, name, currency FROM ads_accounts ORDER BY account_id") as Dataset["ad_accounts"],
    ad_account_stores: all(db, "SELECT account_id, uber_store_id, store_name FROM ads_account_stores ORDER BY account_id, uber_store_id") as Dataset["ad_account_stores"],
    campaigns: all(db, "SELECT * FROM ads_campaigns ORDER BY campaign_id").map((r) => ({
      campaign_id: String(r.campaign_id),
      account_id: String(r.account_id),
      name: String(r.name),
      product: String(r.product),
      configured_status: String(r.configured_status),
      store_ids: (JSON.parse(String(r.store_ids_json)) as string[]).join(";"),
      permissions: (JSON.parse(String(r.permissions_json)) as string[]).join(";"),
      budget_unit: String(r.budget_unit),
      daily_budget_usd: Number(r.budget_amount_e5) / 100000,
      version: Number(r.version),
    })),
    campaign_reports: all(db, "SELECT * FROM ads_reports ORDER BY report_id").map((r) => ({
      report_id: String(r.report_id),
      account_id: String(r.account_id),
      campaign_id: String(r.campaign_id),
      window_start: String(r.window_start),
      window_end: String(r.window_end),
      watermark: String(r.watermark),
      attributed_orders: r.attributed_orders === null ? null : Number(r.attributed_orders),
      attributed_sales_usd: dollars(r.attributed_sales_cents),
      spend_usd: dollars(r.spend_cents),
    })),
    merchant_policies: all(db, "SELECT * FROM mp_policies ORDER BY pos_store_id, policy_id, version").map((r) => ({
      policy_id: String(r.policy_id),
      version: String(r.version),
      pos_store_id: String(r.pos_store_id),
      p95_threshold_minutes: Number(r.p95_threshold_minutes),
      min_contribution_rate_pct: Number(r.min_contribution_rate_bps) / 100,
      max_pos_snapshot_age_s: Number(r.max_pos_snapshot_age_s),
      max_ads_report_age_s: Number(r.max_ads_report_age_s),
      max_event_age_s: Number(r.max_event_age_s),
      approval_required: Number(r.approval_required) === 1,
      allowed_action: String(r.allowed_action),
      approval_ttl_s: Number(r.approval_ttl_s),
      recommendation_ttl_s: Number(r.recommendation_ttl_s),
      effective_from: String(r.effective_from),
      is_current: Number(r.is_current) === 1,
    })),
  };
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export function validateWorkbook(raw: RawWorkbook, mode: ImportMode, db: Db): ValidationResult {
  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  const normalized: Partial<Dataset> = {};
  const rowNumbers: Partial<Record<EntityName, Map<string, number>>> = {};

  for (const name of Object.keys(raw)) {
    if (name === "README") continue;
    if (!(ENTITY_NAMES as readonly string[]).includes(name)) {
      warnings.push({ sheet: name, row: null, column: null, message: "Unknown sheet ignored" });
    }
  }

  for (const spec of SHEETS) {
    const sheet = raw[spec.sheet];
    if (!sheet) {
      if (mode === "replace") errors.push({ sheet: spec.sheet, row: null, column: null, message: "Required sheet is missing (replace mode needs every sheet)" });
      continue;
    }
    const headers = sheet.headers.map((h) => String(h ?? "").trim());
    if (headers.length > IMPORT_LIMITS.maxColumns) {
      errors.push({ sheet: spec.sheet, row: 1, column: null, message: `Too many columns (${headers.length} > ${IMPORT_LIMITS.maxColumns})` });
      continue;
    }
    if (sheet.rows.length > IMPORT_LIMITS.maxRowsPerSheet) {
      errors.push({ sheet: spec.sheet, row: null, column: null, message: `Too many rows (${sheet.rows.length} > ${IMPORT_LIMITS.maxRowsPerSheet})` });
      continue;
    }
    const colIndex = new Map<string, number>();
    headers.forEach((h, i) => { if (h) colIndex.set(h, i); });
    let structural = false;
    for (const col of spec.columns) {
      if (!colIndex.has(col.name)) {
        errors.push({ sheet: spec.sheet, row: 1, column: col.name, message: "Required column is missing" });
        structural = true;
      }
    }
    for (const h of headers) {
      if (h && !spec.columns.some((c) => c.name === h)) {
        errors.push({ sheet: spec.sheet, row: 1, column: h, message: "Unknown column (check spelling against the README sheet)" });
        structural = true;
      }
    }
    if (structural) continue;

    const out: AnyRow[] = [];
    const seen = new Map<string, number>();
    rowNumbers[spec.sheet] = new Map();
    sheet.rows.forEach((cells, i) => {
      const rowNo = i + 2;
      if (cells.every((c) => c === null || c === undefined || c === "")) return; // blank line
      const rec: AnyRow = {};
      let rowOk = true;
      for (const col of spec.columns) {
        const rawCell = cells[colIndex.get(col.name)!];
        if (rawCell !== null && typeof rawCell === "object" && "unsupported" in (rawCell as object)) {
          errors.push({ sheet: spec.sheet, row: rowNo, column: col.name, message: String((rawCell as { unsupported: string }).unsupported) });
          rowOk = false;
          continue;
        }
        const r = coerceCell(col, rawCell);
        if (!r.ok) {
          errors.push({ sheet: spec.sheet, row: rowNo, column: col.name, message: r.error });
          rowOk = false;
        } else rec[col.name] = r.value;
      }
      if (!rowOk) return;
      const k = keyOf(spec.sheet, rec);
      if (seen.has(k)) {
        errors.push({ sheet: spec.sheet, row: rowNo, column: spec.key.join("+"), message: `Duplicate key "${k}" (also on row ${seen.get(k)})` });
        return;
      }
      seen.set(k, rowNo);
      rowNumbers[spec.sheet]!.set(k, rowNo);
      out.push(rec);
    });
    (normalized as Record<string, AnyRow[]>)[spec.sheet] = out;
  }

  // Build the merged world the import would produce, then check references and invariants on it.
  const current = datasetFromDb(db) as unknown as Record<EntityName, AnyRow[]>;
  const merged: Record<EntityName, AnyRow[]> = {} as Record<EntityName, AnyRow[]>;
  for (const name of ENTITY_NAMES) {
    const incoming = (normalized as Record<string, AnyRow[] | undefined>)[name];
    if (mode === "replace") merged[name] = incoming ?? [];
    else {
      const m = new Map(current[name].map((r) => [keyOf(name, r), r]));
      for (const r of incoming ?? []) m.set(keyOf(name, r), r);
      merged[name] = [...m.values()];
    }
  }

  const refErr = (sheet: EntityName, r: AnyRow, column: string, message: string) => {
    const k = keyOf(sheet, r);
    const rowNo = rowNumbers[sheet]?.get(k) ?? null;
    errors.push({ sheet, row: rowNo, column, message: rowNo === null ? `${message} (existing record ${k})` : message });
  };
  const ids = (sheet: EntityName, col: string) => new Set(merged[sheet].map((r) => String(r[col])));
  const users = ids("users", "user_id");
  const stores = ids("stores", "pos_store_id");
  const accounts = ids("ad_accounts", "account_id");
  const accountStores = new Set(merged.ad_account_stores.map((r) => `${r.account_id}|${r.uber_store_id}`));
  const campaigns = new Map(merged.campaigns.map((r) => [String(r.campaign_id), r]));

  for (const r of merged.user_stores) {
    if (!users.has(String(r.user_id))) refErr("user_stores", r, "user_id", `Unknown user "${r.user_id}"`);
    if (!stores.has(String(r.pos_store_id))) refErr("user_stores", r, "pos_store_id", `Unknown store "${r.pos_store_id}"`);
  }
  for (const r of merged.store_mappings) {
    if (!stores.has(String(r.pos_store_id))) refErr("store_mappings", r, "pos_store_id", `Unknown store "${r.pos_store_id}"`);
    if (!accounts.has(String(r.ad_account_id))) refErr("store_mappings", r, "ad_account_id", `Unknown ad account "${r.ad_account_id}"`);
    else if (!accountStores.has(`${r.ad_account_id}|${r.uber_store_id}`)) refErr("store_mappings", r, "uber_store_id", `Uber store "${r.uber_store_id}" is not linked to account ${r.ad_account_id}`);
  }
  for (const s of ["kitchen_snapshots", "cost_profiles"] as const)
    for (const r of merged[s]) if (!stores.has(String(r.pos_store_id))) refErr(s, r, "pos_store_id", `Unknown store "${r.pos_store_id}"`);
  for (const r of merged.ad_account_stores)
    if (!accounts.has(String(r.account_id))) refErr("ad_account_stores", r, "account_id", `Unknown ad account "${r.account_id}"`);
  for (const r of merged.campaigns) {
    if (!accounts.has(String(r.account_id))) refErr("campaigns", r, "account_id", `Unknown ad account "${r.account_id}"`);
    for (const sid of String(r.store_ids).split(";"))
      if (!accountStores.has(`${r.account_id}|${sid}`)) refErr("campaigns", r, "store_ids", `Store "${sid}" is not linked to account ${r.account_id}`);
    if (Number(r.version) < 1) refErr("campaigns", r, "version", "version must be ≥ 1");
  }
  for (const r of merged.campaign_reports) {
    const c = campaigns.get(String(r.campaign_id));
    if (!c) refErr("campaign_reports", r, "campaign_id", `Unknown campaign "${r.campaign_id}"`);
    else if (c.account_id !== r.account_id) refErr("campaign_reports", r, "account_id", `Campaign ${r.campaign_id} belongs to ${c.account_id}, not ${r.account_id}`);
    if (Date.parse(String(r.window_end)) <= Date.parse(String(r.window_start))) refErr("campaign_reports", r, "window_end", "window_end must be after window_start");
    if (Date.parse(String(r.watermark)) < Date.parse(String(r.window_end))) refErr("campaign_reports", r, "watermark", "watermark must be at or after window_end");
  }
  const currentPolicies = new Map<string, number>();
  for (const r of merged.merchant_policies) {
    if (!stores.has(String(r.pos_store_id))) refErr("merchant_policies", r, "pos_store_id", `Unknown store "${r.pos_store_id}"`);
    if (r.approval_required !== true) refErr("merchant_policies", r, "approval_required", "Manager approval cannot be disabled in this slice");
    if (r.is_current === true) currentPolicies.set(String(r.pos_store_id), (currentPolicies.get(String(r.pos_store_id)) ?? 0) + 1);
  }
  for (const [store, n] of currentPolicies)
    if (n > 1) errors.push({ sheet: "merchant_policies", row: null, column: "is_current", message: `Store ${store} has ${n} current policies; exactly one may be current` });

  // Stale revision guard + diff
  const changes: ValidationResult["changes"] = [];
  const summary: ValidationResult["summary"] = {};
  const errorRowsBySheet = new Map<string, Set<number>>();
  for (const e of errors) if (e.row !== null) {
    if (!errorRowsBySheet.has(e.sheet)) errorRowsBySheet.set(e.sheet, new Set());
    errorRowsBySheet.get(e.sheet)!.add(e.row);
  }
  for (const name of ENTITY_NAMES) {
    const incoming = (normalized as Record<string, AnyRow[] | undefined>)[name];
    const sheetPresent = raw0(raw, name);
    if (!incoming && !sheetPresent) continue;
    const curMap = new Map(current[name].map((r) => [keyOf(name, r), r]));
    const s: EntitySummary = { added: 0, updated: 0, unchanged: 0, removed: 0, rejected: errorRowsBySheet.get(name)?.size ?? 0 };
    const incomingKeys = new Set<string>();
    for (const r of incoming ?? []) {
      const k = keyOf(name, r);
      incomingKeys.add(k);
      const prev = curMap.get(k);
      if (!prev) { s.added++; changes.push({ sheet: name, key: k, change: "added" }); continue; }
      if (name === "campaigns" && Number(prev.version) !== Number(r.version)) {
        errors.push({ sheet: name, row: rowNumbers[name]?.get(k) ?? null, column: "version", message: `Stale revision: workbook has v${r.version}, simulator has v${prev.version}. Export a fresh snapshot or reset the sample data.` });
        s.rejected++;
        continue;
      }
      if (canon(prev) === canon(r)) s.unchanged++;
      else {
        s.updated++;
        changes.push({ sheet: name, key: k, change: "updated", detail: name === "campaigns" ? `version ${prev.version} → ${Number(prev.version) + 1}` : undefined });
      }
    }
    if (mode === "replace") for (const k of curMap.keys()) if (!incomingKeys.has(k)) { s.removed++; changes.push({ sheet: name, key: k, change: "removed" }); }
    summary[name] = s;
  }

  return { ok: errors.length === 0, errors, warnings, summary, normalized, changes };
}
const raw0 = (raw: RawWorkbook, name: string) => raw[name];

/* ------------------------------------------------------------------ */
/* Apply (atomic)                                                      */
/* ------------------------------------------------------------------ */

const BUSINESS_DELETE_ORDER = [
  "ads_reports", "ads_campaigns", "ads_account_stores", "ads_accounts",
  "pos_kitchen_snapshots", "pos_cost_profiles", "pos_stores",
  "mp_user_stores", "mp_users", "mp_store_mappings", "mp_policies",
];

export function applyDataset(
  db: Db,
  ds: Partial<Dataset>,
  opts: { mode: ImportMode; actor: string; nowIso: string; source: "SEED" | "IMPORT" | "RESTORE" },
): void {
  const existingCampaigns = new Map(all(db, "SELECT * FROM ads_campaigns").map((r) => [String(r.campaign_id), r]));
  const writeOne = () => {
    if (opts.mode === "replace") for (const t of BUSINESS_DELETE_ORDER) run(db, `DELETE FROM ${t}`);
    const up = opts.mode === "merge" ? "INSERT OR REPLACE" : "INSERT";
    for (const r of ds.users ?? []) run(db, `${up} INTO mp_users(user_id, display_name, role) VALUES(?,?,?)`, r.user_id, r.display_name, r.role);
    for (const r of ds.stores ?? []) run(db, `${up} INTO pos_stores VALUES(?,?,?,?)`, r.pos_store_id, r.name, r.timezone, r.alert_threshold_minutes);
    for (const r of ds.user_stores ?? []) run(db, `${up} INTO mp_user_stores VALUES(?,?)`, r.user_id, r.pos_store_id);
    for (const r of ds.ad_accounts ?? []) run(db, `${up} INTO ads_accounts VALUES(?,?,?)`, r.account_id, r.name, r.currency);
    for (const r of ds.ad_account_stores ?? []) run(db, `${up} INTO ads_account_stores VALUES(?,?,?)`, r.account_id, r.uber_store_id, r.store_name);
    for (const r of ds.store_mappings ?? []) run(db, `${up} INTO mp_store_mappings VALUES(?,?,?,?)`, r.mapping_id, r.pos_store_id, r.uber_store_id, r.ad_account_id);
    for (const r of ds.kitchen_snapshots ?? [])
      run(db, `${up} INTO pos_kitchen_snapshots VALUES(?,?,?,?,?,?)`, r.snapshot_id, r.pos_store_id, r.captured_at, r.p95_prep_minutes, r.active_tickets, r.connector_health);
    for (const r of ds.cost_profiles ?? [])
      run(db, `${up} INTO pos_cost_profiles VALUES(?,?,?,?)`, r.pos_store_id, cents(r.avg_food_packaging_cost_usd), r.marketplace_fee_rate_pct === null ? null : Math.round(r.marketplace_fee_rate_pct * 100), opts.nowIso);
    for (const r of ds.campaigns ?? []) {
      const prev = existingCampaigns.get(r.campaign_id);
      const storeIds = JSON.stringify(r.store_ids.split(";"));
      const perms = JSON.stringify(r.permissions.split(";"));
      const amountE5 = Math.round(r.daily_budget_usd * 100) * 1000;
      let version = r.version;
      let createdAt = opts.nowIso;
      if (prev) {
        createdAt = String(prev.created_at);
        const changed =
          prev.name !== r.name || prev.product !== r.product || prev.configured_status !== r.configured_status ||
          prev.store_ids_json !== storeIds || prev.permissions_json !== perms || prev.budget_unit !== r.budget_unit ||
          Number(prev.budget_amount_e5) !== amountE5 || prev.account_id !== r.account_id;
        // Versions are monotonic: a change always moves forward, even on restore.
        version = changed ? Number(prev.version) + 1 : Number(prev.version);
        if (changed && prev.configured_status !== r.configured_status)
          run(db, "INSERT INTO ads_mutation_ledger(request_id, account_id, campaign_id, field, before_value, after_value, version_before, version_after, actor, source, at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            null, r.account_id, r.campaign_id, "configured_status", prev.configured_status, r.configured_status, prev.version, version, opts.actor, opts.source, opts.nowIso);
      }
      run(db, `INSERT OR REPLACE INTO ads_campaigns(campaign_id, account_id, name, product, configured_status, store_ids_json, permissions_json, budget_unit, budget_amount_e5, currency, version, created_at, updated_at, updated_by, effective_visible_after_ms)
               VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL)`,
        r.campaign_id, r.account_id, r.name, r.product, r.configured_status, storeIds, perms, r.budget_unit, amountE5, "USD", version, createdAt,
        prev && version === Number(prev.version) ? String(prev.updated_at) : opts.nowIso,
        prev && version === Number(prev.version) ? String(prev.updated_by) : opts.actor);
    }
    for (const r of ds.campaign_reports ?? [])
      run(db, `${up} INTO ads_reports VALUES(?,?,?,?,?,?,?,?,?)`, r.report_id, r.account_id, r.campaign_id, r.window_start, r.window_end, r.watermark, r.attributed_orders, cents(r.attributed_sales_usd), cents(r.spend_usd));
    for (const r of ds.merchant_policies ?? [])
      run(db, `${up} INTO mp_policies VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, r.policy_id, r.version, r.pos_store_id, r.p95_threshold_minutes, Math.round(r.min_contribution_rate_pct * 100), r.max_pos_snapshot_age_s, r.max_ads_report_age_s, r.max_event_age_s, r.approval_required ? 1 : 0, r.allowed_action, r.approval_ttl_s, r.recommendation_ttl_s, r.effective_from, r.is_current ? 1 : 0);
    if (opts.mode === "merge") {
      // merge must not leave two current policies; validation already rejected that case.
      const bad = get(db, "SELECT pos_store_id, COUNT(*) n FROM mp_policies WHERE is_current = 1 GROUP BY pos_store_id HAVING n > 1");
      if (bad) throw new Error(`two current policies for ${bad.pos_store_id}`);
    }
  };
  tx(db, writeOne);
}

/* ------------------------------------------------------------------ */
/* Batches: preview, commit, restore                                   */
/* ------------------------------------------------------------------ */

export function sha256(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

export function createPreviewBatch(db: Db, args: { filename: string; content: Buffer; mode: ImportMode; actor: string; result: ValidationResult; clock: Clock }) {
  const batchId = `imp-${randomUUID().slice(0, 8)}`;
  const { normalized, ...summary } = args.result;
  run(db, "INSERT INTO mp_import_batches(batch_id, filename, content_sha256, mode, status, summary_json, payload_json, snapshot_json, actor, created_at, committed_at) VALUES(?,?,?,?,?,?,?,NULL,?,?,NULL)",
    batchId, args.filename.slice(0, 120), sha256(args.content), args.mode, args.result.ok ? "PREVIEWED" : "REJECTED",
    JSON.stringify(summary), JSON.stringify(normalized), args.actor, args.clock.nowIso());
  return batchId;
}

export function commitBatch(db: Db, batchId: string, actor: string, clock: Clock) {
  const b = get(db, "SELECT * FROM mp_import_batches WHERE batch_id = ?", batchId);
  if (!b) return { ok: false as const, status: 404, message: "Unknown import batch" };
  if (b.status !== "PREVIEWED") return { ok: false as const, status: 409, message: `Batch is ${b.status}; only a clean preview can be committed` };
  const payload = JSON.parse(String(b.payload_json)) as Partial<Dataset>;
  // Re-validate against the CURRENT state: the world may have changed since the preview.
  const raw: RawWorkbook = {};
  for (const spec of SHEETS) {
    const rows = (payload as Record<string, AnyRow[] | undefined>)[spec.sheet];
    if (!rows) continue;
    raw[spec.sheet] = { headers: spec.columns.map((c) => c.name), rows: rows.map((r) => spec.columns.map((c) => r[c.name] ?? null)) };
  }
  const recheck = validateWorkbook(raw, b.mode as ImportMode, db);
  if (!recheck.ok) {
    run(db, "UPDATE mp_import_batches SET status = 'REJECTED', summary_json = ? WHERE batch_id = ?", JSON.stringify({ ...recheck, normalized: undefined }), batchId);
    return { ok: false as const, status: 409, message: "Data changed since preview; re-validate the file", errors: recheck.errors };
  }
  const snapshot = datasetFromDb(db);
  applyDataset(db, recheck.normalized, { mode: b.mode as ImportMode, actor, nowIso: clock.nowIso(), source: "IMPORT" });
  run(db, "UPDATE mp_import_batches SET status = 'COMMITTED', snapshot_json = ?, committed_at = ? WHERE batch_id = ?", JSON.stringify(snapshot), clock.nowIso(), batchId);
  // Independent re-query to confirm what landed.
  const after = datasetFromDb(db) as unknown as Record<string, unknown[]>;
  const counts = Object.fromEntries(ENTITY_NAMES.map((n) => [n, after[n]?.length ?? 0]));
  return { ok: true as const, counts, summary: recheck.summary };
}

export function restoreBatch(db: Db, batchId: string, actor: string, clock: Clock) {
  const b = get(db, "SELECT * FROM mp_import_batches WHERE batch_id = ?", batchId);
  if (!b || b.status !== "COMMITTED" || !b.snapshot_json) return { ok: false as const, status: 409, message: "Only a committed batch with a snapshot can be restored" };
  const snapshot = JSON.parse(String(b.snapshot_json)) as Dataset;
  applyDataset(db, snapshot, { mode: "replace", actor, nowIso: clock.nowIso(), source: "RESTORE" });
  run(db, "UPDATE mp_import_batches SET status = 'RESTORED' WHERE batch_id = ?", batchId);
  return { ok: true as const };
}
