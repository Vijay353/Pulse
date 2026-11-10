/**
 * Domain-oriented ports. The orchestrator depends only on these interfaces;
 * provider choice (simulator vs real sandbox) is injected at startup.
 */
import type { ServingState } from "../../../../packages/contracts/src/index";

export type AdsError =
  | { kind: "HTTP"; status: number; code: string; message: string }
  | { kind: "NETWORK"; message: string } // timeout / dropped connection: outcome unknown
  | { kind: "CONFIG"; message: string }
  | { kind: "CONTRACT"; message: string }; // response did not match the expected shape

export type Result<T, E = AdsError> = { ok: true; value: T } | { ok: false; error: E };

export interface CampaignView {
  campaignId: string;
  accountId: string;
  name: string;
  product: string | null;
  configuredStatus: string;
  effectiveStatusRaw: string;
  effectiveStatusReasons: string[];
  serving: ServingState;
  permissions: string[];
  version: number;
  storeIds: string[];
  dailyBudgetCents: number | null;
  updatedAt: string;
  updatedBy: string | null;
}

export interface CampaignReport {
  reportId: string;
  campaignId: string;
  windowStart: string;
  windowEnd: string;
  watermark: string;
  attributedOrders: number | null;
  attributedSalesCents: number | null;
  spendCents: number | null;
}

export interface AdAccount {
  accountId: string;
  name: string;
  currency: string;
}

/** One recorded change to a campaign field (simulator change log). */
export interface CampaignChange {
  requestId: string | null;
  field: string;
  before: string | null;
  after: string | null;
  versionBefore: number | null;
  versionAfter: number | null;
  source: string;
  at: string;
}

/**
 * Observability that only a simulator can offer. Real providers answer
 * { available: false } and callers must show that, never substitute data.
 */
export type Observation<T> = { available: true; value: T } | { available: false; reason: string };

export type PatchOutcome =
  | { kind: "SUCCESS"; httpStatus: number; body: unknown }
  | { kind: "ITEM_FAILURE"; httpStatus: number; errorCode: string; message: string; body: unknown }
  | { kind: "HTTP_ERROR"; httpStatus: number; code: string; message: string; definitelyNotApplied: boolean }
  | { kind: "AMBIGUOUS"; message: string };

export interface UberAdsPort {
  readonly label: string; // shown in the inspector, e.g. "Mock Uber Ads (local simulator)"
  listCampaigns(accountId: string): Promise<Result<CampaignView[]>>;
  getCampaign(accountId: string, campaignId: string): Promise<Result<CampaignView | null>>;
  getLatestReport(accountId: string, campaignId: string): Promise<Result<CampaignReport | null>>;
  setConfiguredStatus(accountId: string, campaignId: string, status: "CAMPAIGN_CONFIGURED_STATUS_PAUSED", requestId: string): Promise<PatchOutcome>;
  /** Simulator-only probe used to prove "no other mutations". Real providers return null. */
  stateDigest(excludeCampaignId: string): Promise<string | null>;
  /** GET /v1/ads/ad-accounts (documented path; response shape TO_VERIFY for real Uber). */
  listAdAccounts(): Promise<Result<AdAccount[]>>;
  /** Simulator change log for one campaign. Uber offers no such API, so real providers are unavailable. */
  getCampaignChangeLog(accountId: string, campaignId: string): Promise<Observation<CampaignChange[]>>;
}

export interface KitchenSnapshot {
  snapshotId: string;
  storeId: string;
  capturedAt: string;
  p95PrepMinutes: number;
  activeTickets: number;
  connectorHealth: "HEALTHY" | "DEGRADED" | "DOWN";
}
export interface CostProfile {
  storeId: string;
  avgFoodPackagingCostCents: number | null;
  marketplaceFeeRateBps: number | null;
}

export interface StoreProfile {
  storeId: string;
  name: string;
  timezone: string;
}

export type PosError = { kind: "UNAVAILABLE" | "NOT_FOUND" | "NETWORK"; message: string };

export interface PosPort {
  readonly label: string;
  getKitchenSnapshot(storeId: string): Promise<Result<KitchenSnapshot, PosError>>;
  getCostProfile(storeId: string): Promise<Result<CostProfile, PosError>>;
  getStoreProfile(storeId: string): Promise<Result<StoreProfile, PosError>>;
  stateDigest(): Promise<string | null>;
}

/** Demo-only view of simulator internals (faults, outbox, request log). Never used by decisions. */
export interface SimulatorSnapshot {
  adsFaults: { op: string; mode: string; remaining: number; param: string | null }[];
  posFaults: { mode: string; remaining: number }[];
  outbox: { event_id: string; pos_store_id: string; created_at: string; delivery_count: number; last_status: number | null }[];
  ledger: Record<string, unknown>[];
  requests: { method: string; path: string; status: number | null; fault: string | null; at: string }[];
  patchCount: number;
}

export interface SimulatorConsolePort {
  snapshot(): Promise<Observation<SimulatorSnapshot>>;
}

/** Map Uber's effective_status string to a domain serving state. Unknown strings fail closed. */
export const SERVING_STATUSES = ["CAMPAIGN_EFFECTIVE_STATUS_ACTIVE", "CAMPAIGN_EFFECTIVE_STATUS_ELIGIBLE"];
export const NOT_SERVING_STATUSES = ["CAMPAIGN_EFFECTIVE_STATUS_PAUSED", "CAMPAIGN_EFFECTIVE_STATUS_NOT_ELIGIBLE"];
export function mapServing(raw: string): ServingState {
  if (SERVING_STATUSES.includes(raw)) return "SERVING";
  if (NOT_SERVING_STATUSES.includes(raw)) return "NOT_SERVING";
  return "UNKNOWN";
}
