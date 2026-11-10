/**
 * Workbook schema v1 — single source of truth for the Excel template,
 * the import validator, the README sheet and docs/DATA-IMPORT-GUIDE.md.
 */
import { z } from "zod";
import { IsoInstant } from "../../../../packages/contracts/src/index";

export const WORKBOOK_SCHEMA_VERSION = "marginpulse-workbook/1";

type ColType = "id" | "text" | "enum" | "int" | "number" | "money" | "pct" | "instant" | "bool" | "list";

export interface ColumnSpec {
  name: string;
  type: ColType;
  required: boolean;
  /** Nullable columns accept an empty cell and store NULL (used to demo missing-cost review). */
  nullable?: boolean;
  allowed?: readonly string[];
  /** system-managed columns are validated but the simulator owns their next value */
  systemManaged?: boolean;
  description: string;
}

export interface SheetSpec {
  sheet: EntityName;
  description: string;
  key: string[];
  owner: "MarginPulse" | "Mock POS/KDS" | "Mock Uber Ads";
  columns: ColumnSpec[];
}

export const ENTITY_NAMES = [
  "users", "user_stores", "stores", "store_mappings", "kitchen_snapshots", "cost_profiles",
  "ad_accounts", "ad_account_stores", "campaigns", "campaign_reports", "merchant_policies",
] as const;
export type EntityName = (typeof ENTITY_NAMES)[number];

const id = (name: string, description: string): ColumnSpec => ({ name, type: "id", required: true, description });

export const SHEETS: SheetSpec[] = [
  {
    sheet: "users", owner: "MarginPulse", key: ["user_id"],
    description: "Demo identities. Configures the local demo identity switcher — NOT production authentication.",
    columns: [
      id("user_id", "Stable user id"),
      { name: "display_name", type: "text", required: true, description: "Name shown in the UI" },
      { name: "role", type: "enum", required: true, allowed: ["MANAGER", "STAFF"], description: "Only MANAGER may approve a pause" },
    ],
  },
  {
    sheet: "user_stores", owner: "MarginPulse", key: ["user_id", "pos_store_id"],
    description: "Which stores a user may act for.",
    columns: [
      { ...id("user_id", "FK → users.user_id") },
      { ...id("pos_store_id", "FK → stores.pos_store_id") },
    ],
  },
  {
    sheet: "stores", owner: "Mock POS/KDS", key: ["pos_store_id"],
    description: "POS store records.",
    columns: [
      id("pos_store_id", "POS store id"),
      { name: "name", type: "text", required: true, description: "Store display name" },
      { name: "timezone", type: "text", required: true, description: "IANA time zone, e.g. America/New_York" },
      { name: "alert_threshold_minutes", type: "number", required: true, description: "POS-side alert threshold placed in the event (MarginPulse re-checks against the merchant policy)" },
    ],
  },
  {
    sheet: "store_mappings", owner: "MarginPulse", key: ["mapping_id"],
    description: "POS store → Uber store + ad account. A POS store must map to exactly one Uber store or the investigation goes to review.",
    columns: [
      id("mapping_id", "Mapping id"),
      { ...id("pos_store_id", "FK → stores.pos_store_id") },
      { ...id("uber_store_id", "FK → ad_account_stores.uber_store_id (for this account)") },
      { ...id("ad_account_id", "FK → ad_accounts.account_id") },
    ],
  },
  {
    sheet: "kitchen_snapshots", owner: "Mock POS/KDS", key: ["snapshot_id"],
    description: "Synthetic KDS snapshots (mocked partner extension — not a universal POS API).",
    columns: [
      id("snapshot_id", "Snapshot id"),
      { ...id("pos_store_id", "FK → stores.pos_store_id") },
      { name: "captured_at", type: "instant", required: true, description: "ISO-8601 with offset, typed as TEXT" },
      { name: "p95_prep_minutes", type: "number", required: true, description: "P95 preparation minutes, ≥ 0" },
      { name: "active_tickets", type: "int", required: true, description: "Open tickets, ≥ 0" },
      { name: "connector_health", type: "enum", required: true, allowed: ["HEALTHY", "DEGRADED", "DOWN"], description: "POS connector health" },
    ],
  },
  {
    sheet: "cost_profiles", owner: "Mock POS/KDS", key: ["pos_store_id"],
    description: "Merchant-supplied variable costs. Blank values are allowed and route the decision to review.",
    columns: [
      { ...id("pos_store_id", "FK → stores.pos_store_id") },
      { name: "avg_food_packaging_cost_usd", type: "money", required: true, nullable: true, description: "Per attributed order, dollars (≤ 2 decimals)" },
      { name: "marketplace_fee_rate_pct", type: "pct", required: true, nullable: true, description: "Estimated marketplace fee, percent of item subtotal" },
    ],
  },
  {
    sheet: "ad_accounts", owner: "Mock Uber Ads", key: ["account_id"],
    description: "Synthetic ad accounts.",
    columns: [
      id("account_id", "Ad account id"),
      { name: "name", type: "text", required: true, description: "Account name" },
      { name: "currency", type: "enum", required: true, allowed: ["USD"], description: "Only USD in this slice" },
    ],
  },
  {
    sheet: "ad_account_stores", owner: "Mock Uber Ads", key: ["account_id", "uber_store_id"],
    description: "Stores linked to each ad account.",
    columns: [
      { ...id("account_id", "FK → ad_accounts.account_id") },
      { ...id("uber_store_id", "Uber store id") },
      { name: "store_name", type: "text", required: true, description: "Store name as the ad platform shows it" },
    ],
  },
  {
    sheet: "campaigns", owner: "Mock Uber Ads", key: ["campaign_id"],
    description: "Simulator configuration of what the ad platform would report. MarginPulse still enforces its own checks against these values.",
    columns: [
      id("campaign_id", "Campaign id"),
      { ...id("account_id", "FK → ad_accounts.account_id") },
      { name: "name", type: "text", required: true, description: "Campaign name (treated as untrusted text)" },
      { name: "product", type: "enum", required: true, allowed: ["SPONSORED_LISTING", "OTHER"], description: "Mock-only simplification of ad product" },
      { name: "configured_status", type: "enum", required: true, allowed: ["CAMPAIGN_CONFIGURED_STATUS_ACTIVE", "CAMPAIGN_CONFIGURED_STATUS_PAUSED", "CAMPAIGN_CONFIGURED_STATUS_DRAFT"], description: "Configured status" },
      { name: "store_ids", type: "list", required: true, description: "Semicolon-separated uber_store_ids the campaign targets (each must belong to the account)" },
      { name: "permissions", type: "list", required: true, allowed: ["READ", "UPDATE", "DELETE"], description: "What the integration token may do (READ;UPDATE)" },
      { name: "budget_unit", type: "enum", required: true, allowed: ["BUDGET_UNIT_DAILY", "BUDGET_UNIT_WEEKLY", "BUDGET_UNIT_FIXED"], description: "Budget unit" },
      { name: "daily_budget_usd", type: "money", required: true, description: "Budget amount, dollars" },
      { name: "version", type: "int", required: true, systemManaged: true, description: "Revision. Must equal the simulator's current version for existing campaigns (stale-revision guard). The simulator increments it on change." },
    ],
  },
  {
    sheet: "campaign_reports", owner: "Mock Uber Ads", key: ["report_id"],
    description: "Delayed reporting windows. The watermark is how fresh the data is.",
    columns: [
      id("report_id", "Report id"),
      { ...id("account_id", "FK → ad_accounts.account_id") },
      { ...id("campaign_id", "FK → campaigns.campaign_id (same account)") },
      { name: "window_start", type: "instant", required: true, description: "ISO-8601 with offset" },
      { name: "window_end", type: "instant", required: true, description: "ISO-8601 with offset, after window_start" },
      { name: "watermark", type: "instant", required: true, description: "Data complete up to this time; ≥ window_end" },
      { name: "attributed_orders", type: "int", required: true, nullable: true, description: "Attributed orders in window" },
      { name: "attributed_sales_usd", type: "money", required: true, nullable: true, description: "Item subtotal of attributed orders, dollars" },
      { name: "spend_usd", type: "money", required: true, nullable: true, description: "Ad spend in window, dollars" },
    ],
  },
  {
    sheet: "merchant_policies", owner: "MarginPulse", key: ["policy_id", "version"],
    description: "Merchant-owned guardrail. Exactly one current version per store.",
    columns: [
      id("policy_id", "Policy id"),
      { ...id("version", "Policy version label, e.g. v3") },
      { ...id("pos_store_id", "FK → stores.pos_store_id") },
      { name: "p95_threshold_minutes", type: "number", required: true, description: "Kitchen limit" },
      { name: "min_contribution_rate_pct", type: "pct", required: true, description: "Pause only when estimated contribution rate is below this" },
      { name: "max_pos_snapshot_age_s", type: "int", required: true, description: "Max KDS snapshot age, seconds" },
      { name: "max_ads_report_age_s", type: "int", required: true, description: "Max ads report watermark age, seconds" },
      { name: "max_event_age_s", type: "int", required: true, description: "Max webhook event age, seconds" },
      { name: "approval_required", type: "bool", required: true, description: "Must be TRUE in this slice" },
      { name: "allowed_action", type: "enum", required: true, allowed: ["PAUSE_SPONSORED_LISTING"], description: "The only action in the catalog" },
      { name: "approval_ttl_s", type: "int", required: true, description: "Approval validity, seconds" },
      { name: "recommendation_ttl_s", type: "int", required: true, description: "Recommendation validity, seconds" },
      { name: "effective_from", type: "instant", required: true, description: "ISO-8601 with offset" },
      { name: "is_current", type: "bool", required: true, description: "TRUE for the active version" },
    ],
  },
];

export const SHEET_BY_NAME: Record<EntityName, SheetSpec> = Object.fromEntries(
  SHEETS.map((s) => [s.sheet, s]),
) as Record<EntityName, SheetSpec>;

/* ---------- cell coercion ---------- */

const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

export type CellIssue = string;

/** Coerce one raw cell (string/number/boolean/null) to the column type. Returns [value] or an error message. */
export function coerceCell(col: ColumnSpec, raw: unknown): { ok: true; value: unknown } | { ok: false; error: CellIssue } {
  let v = raw;
  if (typeof v === "string") {
    v = v.trim();
    // Round-trip of our own export escaping: '=foo  -> =foo is still rejected below for ids, kept for text.
    if (typeof v === "string" && v.startsWith("'") && FORMULA_TRIGGER.test(v.slice(1))) v = v.slice(1);
  }
  const empty = v === null || v === undefined || v === "";
  if (empty) {
    if (col.nullable) return { ok: true, value: null };
    if (col.required) return { ok: false, error: "required value is missing" };
    return { ok: true, value: null };
  }
  const asNum = (x: unknown) => (typeof x === "number" ? x : typeof x === "string" && x !== "" ? Number(x) : NaN);
  switch (col.type) {
    case "id": {
      const s = String(v);
      if (!/^[A-Za-z0-9._:-]{1,80}$/.test(s)) return { ok: false, error: `"${trunc(s)}" is not a valid id (letters, digits, . _ : - ; max 80)` };
      return { ok: true, value: s };
    }
    case "text": {
      const s = String(v);
      if (s.length > 200) return { ok: false, error: "text longer than 200 characters" };
      return { ok: true, value: s };
    }
    case "enum": {
      const s = String(v);
      if (!col.allowed!.includes(s)) return { ok: false, error: `"${trunc(s)}" is not allowed; use one of ${col.allowed!.join(", ")}` };
      return { ok: true, value: s };
    }
    case "int": {
      const n = asNum(v);
      if (!Number.isInteger(n) || n < 0) return { ok: false, error: `"${trunc(String(v))}" is not a non-negative whole number` };
      return { ok: true, value: n };
    }
    case "number": case "pct": {
      const n = asNum(v);
      if (!Number.isFinite(n) || n < 0) return { ok: false, error: `"${trunc(String(v))}" is not a non-negative number` };
      if (col.type === "pct" && n > 100) return { ok: false, error: "percent must be between 0 and 100" };
      return { ok: true, value: n };
    }
    case "money": {
      const n = asNum(v);
      if (!Number.isFinite(n) || n < 0) return { ok: false, error: `"${trunc(String(v))}" is not a non-negative dollar amount` };
      if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) return { ok: false, error: "dollar amounts may have at most 2 decimals" };
      if (n > 1_000_000) return { ok: false, error: "amount exceeds 1,000,000" };
      return { ok: true, value: n };
    }
    case "instant": {
      if (typeof v !== "string") return { ok: false, error: "timestamps must be TEXT in ISO-8601 with an offset (Excel date cells are ambiguous and rejected)" };
      const r = IsoInstant.safeParse(v);
      if (!r.success) return { ok: false, error: r.error.issues[0]?.message ?? "invalid timestamp" };
      return { ok: true, value: v };
    }
    case "bool": {
      if (typeof v === "boolean") return { ok: true, value: v };
      const s = String(v).toUpperCase();
      if (s === "TRUE" || s === "1") return { ok: true, value: true };
      if (s === "FALSE" || s === "0") return { ok: true, value: false };
      return { ok: false, error: `"${trunc(String(v))}" is not TRUE or FALSE` };
    }
    case "list": {
      const items = String(v).split(";").map((x) => x.trim()).filter(Boolean);
      if (items.length === 0) return { ok: false, error: "list is empty" };
      for (const it of items) {
        if (col.allowed && !col.allowed.includes(it)) return { ok: false, error: `"${trunc(it)}" is not allowed; use ${col.allowed.join(", ")}` };
        if (!/^[A-Za-z0-9._:-]{1,80}$/.test(it)) return { ok: false, error: `"${trunc(it)}" is not a valid id` };
      }
      if (new Set(items).size !== items.length) return { ok: false, error: "list contains duplicates" };
      return { ok: true, value: items.join(";") };
    }
  }
}

const trunc = (s: string) => (s.length > 40 ? s.slice(0, 37) + "…" : s);

export const ImportMode = z.enum(["replace", "merge"]);
export type ImportMode = z.infer<typeof ImportMode>;

export const IMPORT_LIMITS = { maxBytes: 2 * 1024 * 1024, maxRowsPerSheet: 2000, maxColumns: 30 } as const;
