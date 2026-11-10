/**
 * Canonical SYNTHETIC dataset. Every record is fictional.
 * The shape is identical to the Excel workbook sheets (see data/templates),
 * so seeding and spreadsheet import share one validated code path.
 * Money is entered in dollars with at most 2 decimals; rates in percent.
 */
export interface Dataset {
  users: { user_id: string; display_name: string; role: "MANAGER" | "STAFF" }[];
  user_stores: { user_id: string; pos_store_id: string }[];
  stores: { pos_store_id: string; name: string; timezone: string; alert_threshold_minutes: number }[];
  store_mappings: { mapping_id: string; pos_store_id: string; uber_store_id: string; ad_account_id: string }[];
  kitchen_snapshots: {
    snapshot_id: string; pos_store_id: string; captured_at: string; p95_prep_minutes: number;
    active_tickets: number; connector_health: "HEALTHY" | "DEGRADED" | "DOWN";
  }[];
  cost_profiles: { pos_store_id: string; avg_food_packaging_cost_usd: number | null; marketplace_fee_rate_pct: number | null }[];
  ad_accounts: { account_id: string; name: string; currency: string }[];
  ad_account_stores: { account_id: string; uber_store_id: string; store_name: string }[];
  campaigns: {
    campaign_id: string; account_id: string; name: string; product: string; configured_status: string;
    store_ids: string; permissions: string; budget_unit: string; daily_budget_usd: number; version: number;
  }[];
  campaign_reports: {
    report_id: string; account_id: string; campaign_id: string; window_start: string; window_end: string;
    watermark: string; attributed_orders: number | null; attributed_sales_usd: number | null; spend_usd: number | null;
  }[];
  merchant_policies: {
    policy_id: string; version: string; pos_store_id: string; p95_threshold_minutes: number;
    min_contribution_rate_pct: number; max_pos_snapshot_age_s: number; max_ads_report_age_s: number;
    max_event_age_s: number; approval_required: boolean; allowed_action: string; approval_ttl_s: number;
    recommendation_ttl_s: number; effective_from: string; is_current: boolean;
  }[];
}

export const SCENARIO_CLOCK = "2026-10-18T18:31:43-04:00";

export function seedDataset(): Dataset {
  return {
    users: [
      { user_id: "mgr-ana", display_name: "Ana Reyes (synthetic shift manager)", role: "MANAGER" },
      { user_id: "staff-ben", display_name: "Ben Ortiz (synthetic line staff)", role: "STAFF" },
      { user_id: "mgr-cole", display_name: "Cole Park (synthetic manager, Uptown only)", role: "MANAGER" },
    ],
    user_stores: [
      { user_id: "mgr-ana", pos_store_id: "SYN-STORE-104" },
      { user_id: "staff-ben", pos_store_id: "SYN-STORE-104" },
      { user_id: "mgr-cole", pos_store_id: "SYN-STORE-205" },
    ],
    stores: [
      { pos_store_id: "SYN-STORE-104", name: "Juniper Pizza — Downtown", timezone: "America/New_York", alert_threshold_minutes: 28 },
      { pos_store_id: "SYN-STORE-205", name: "Juniper Pizza — Uptown", timezone: "America/New_York", alert_threshold_minutes: 28 },
    ],
    store_mappings: [
      { mapping_id: "map-104", pos_store_id: "SYN-STORE-104", uber_store_id: "UE-SYN-104", ad_account_id: "SYN-AD-221" },
      { mapping_id: "map-205", pos_store_id: "SYN-STORE-205", uber_store_id: "UE-SYN-205", ad_account_id: "SYN-AD-305" },
    ],
    kitchen_snapshots: [
      { snapshot_id: "kds-snap-811", pos_store_id: "SYN-STORE-104", captured_at: "2026-10-18T18:26:20-04:00", p95_prep_minutes: 29, active_tickets: 15, connector_health: "HEALTHY" },
      { snapshot_id: "kds-snap-812", pos_store_id: "SYN-STORE-104", captured_at: "2026-10-18T18:31:20-04:00", p95_prep_minutes: 34, active_tickets: 18, connector_health: "HEALTHY" },
      { snapshot_id: "kds-snap-901", pos_store_id: "SYN-STORE-205", captured_at: "2026-10-18T18:31:00-04:00", p95_prep_minutes: 31, active_tickets: 14, connector_health: "HEALTHY" },
    ],
    cost_profiles: [
      { pos_store_id: "SYN-STORE-104", avg_food_packaging_cost_usd: 11.4, marketplace_fee_rate_pct: 20 },
      { pos_store_id: "SYN-STORE-205", avg_food_packaging_cost_usd: 10.0, marketplace_fee_rate_pct: 20 },
    ],
    ad_accounts: [
      { account_id: "SYN-AD-221", name: "Juniper Downtown Ads (synthetic)", currency: "USD" },
      { account_id: "SYN-AD-305", name: "Juniper Uptown Ads (synthetic)", currency: "USD" },
    ],
    ad_account_stores: [
      { account_id: "SYN-AD-221", uber_store_id: "UE-SYN-104", store_name: "Juniper Pizza — Downtown" },
      { account_id: "SYN-AD-305", uber_store_id: "UE-SYN-205", store_name: "Juniper Pizza — Uptown" },
    ],
    campaigns: [
      { campaign_id: "cmp-syn-4081", account_id: "SYN-AD-221", name: "Downtown Sponsored Listing", product: "SPONSORED_LISTING", configured_status: "CAMPAIGN_CONFIGURED_STATUS_ACTIVE", store_ids: "UE-SYN-104", permissions: "READ;UPDATE", budget_unit: "BUDGET_UNIT_DAILY", daily_budget_usd: 40, version: 12 },
      { campaign_id: "cmp-syn-3990", account_id: "SYN-AD-221", name: "Downtown Spring Listing", product: "SPONSORED_LISTING", configured_status: "CAMPAIGN_CONFIGURED_STATUS_PAUSED", store_ids: "UE-SYN-104", permissions: "READ;UPDATE", budget_unit: "BUDGET_UNIT_DAILY", daily_budget_usd: 25, version: 4 },
      { campaign_id: "cmp-syn-5120", account_id: "SYN-AD-305", name: "Uptown Sponsored Listing", product: "SPONSORED_LISTING", configured_status: "CAMPAIGN_CONFIGURED_STATUS_ACTIVE", store_ids: "UE-SYN-205", permissions: "READ;UPDATE", budget_unit: "BUDGET_UNIT_DAILY", daily_budget_usd: 30, version: 7 },
    ],
    campaign_reports: [
      { report_id: "rpt-4081-1820", account_id: "SYN-AD-221", campaign_id: "cmp-syn-4081", window_start: "2026-10-18T17:20:00-04:00", window_end: "2026-10-18T18:20:00-04:00", watermark: "2026-10-18T18:20:00-04:00", attributed_orders: 10, attributed_sales_usd: 280.0, spend_usd: 78.0 },
      { report_id: "rpt-5120-1820", account_id: "SYN-AD-305", campaign_id: "cmp-syn-5120", window_start: "2026-10-18T17:20:00-04:00", window_end: "2026-10-18T18:20:00-04:00", watermark: "2026-10-18T18:20:00-04:00", attributed_orders: 8, attributed_sales_usd: 232.0, spend_usd: 52.0 },
    ],
    merchant_policies: [
      { policy_id: "policy-rush-control", version: "v3", pos_store_id: "SYN-STORE-104", p95_threshold_minutes: 28, min_contribution_rate_pct: 20, max_pos_snapshot_age_s: 120, max_ads_report_age_s: 900, max_event_age_s: 120, approval_required: true, allowed_action: "PAUSE_SPONSORED_LISTING", approval_ttl_s: 300, recommendation_ttl_s: 600, effective_from: "2026-10-01T00:00:00-04:00", is_current: true },
      { policy_id: "policy-rush-control-uptown", version: "v1", pos_store_id: "SYN-STORE-205", p95_threshold_minutes: 28, min_contribution_rate_pct: 20, max_pos_snapshot_age_s: 120, max_ads_report_age_s: 900, max_event_age_s: 120, approval_required: true, allowed_action: "PAUSE_SPONSORED_LISTING", approval_ttl_s: 300, recommendation_ttl_s: 600, effective_from: "2026-10-01T00:00:00-04:00", is_current: true },
    ],
  };
}
