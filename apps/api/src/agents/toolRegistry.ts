/**
 * Read-only tools available to the investigator AND to the deterministic
 * fact-gathering step. Every call is a real adapter call; every result is
 * persisted as an evidence record with a stable id. Calls are memoized per
 * investigation so the agent and the policy see identical evidence.
 * There is NO mutating tool here — the orchestrator owns the single write.
 */
import { z } from "zod";
import { all, Db, get, nextCounter, run } from "../db/db";
import type { Clock } from "../clock";
import type { CampaignView, PosPort, UberAdsPort } from "../adapters/ports";
import { calculateContribution } from "../policy/contribution";

export interface ToolResult {
  evidenceRef: string;
  ok: boolean;
  data: unknown;
}

export interface ToolSpec {
  name: string;
  description: string;
  input: z.ZodType;
  /** JSON schema for model providers. */
  jsonSchema: Record<string, unknown>;
}

const storeArg = z.strictObject({ storeId: z.string().min(1).max(80) });
const campaignArg = z.strictObject({ storeId: z.string().min(1).max(80), campaignId: z.string().min(1).max(80) });
const storeSchema = { type: "object", properties: { storeId: { type: "string" } }, required: ["storeId"], additionalProperties: false };
const campaignSchema = { type: "object", properties: { storeId: { type: "string" }, campaignId: { type: "string" } }, required: ["storeId", "campaignId"], additionalProperties: false };

export const TOOL_SPECS: ToolSpec[] = [
  { name: "getKitchenSnapshot", description: "Latest KDS snapshot for the POS store (P95 prep minutes, active tickets, connector health, captured time).", input: storeArg, jsonSchema: storeSchema },
  { name: "getMerchantGuardrail", description: "The merchant's current rush-control policy for the store (thresholds, data-age limits, contribution floor, version).", input: storeArg, jsonSchema: storeSchema },
  { name: "getStoreCampaigns", description: "Store mapping plus Sponsored Listings campaigns for the mapped Uber store, with configured/effective status, permissions and version.", input: storeArg, jsonSchema: storeSchema },
  { name: "getCampaignReport", description: "Latest delayed reporting window for one campaign, with its watermark.", input: campaignArg, jsonSchema: campaignSchema },
  { name: "calculateContribution", description: "Deterministic contribution estimate for one campaign from the report and merchant cost profile. Returns cents; you must not do arithmetic yourself.", input: campaignArg, jsonSchema: campaignSchema },
];

export type ToolName = "getKitchenSnapshot" | "getMerchantGuardrail" | "getStoreCampaigns" | "getCampaignReport" | "calculateContribution";

export interface ToolContext {
  db: Db;
  clock: Clock;
  ads: UberAdsPort;
  pos: PosPort;
  investigationId: string;
  posStoreId: string;
}

export function currentPolicy(db: Db, posStoreId: string) {
  return get(db, "SELECT * FROM mp_policies WHERE pos_store_id = ? AND is_current = 1", posStoreId);
}

export function isEligible(c: CampaignView, uberStoreId: string) {
  return c.product === "SPONSORED_LISTING" && c.configuredStatus === "CAMPAIGN_CONFIGURED_STATUS_ACTIVE" && c.storeIds.includes(uberStoreId);
}

export class ToolRegistry {
  constructor(private readonly ctx: ToolContext) {}

  private record(kind: string, tool: string, args: unknown, evidenceId: string, payload: unknown): string {
    run(this.ctx.db, "INSERT OR IGNORE INTO mp_evidence(evidence_id, investigation_id, kind, tool, args_json, payload_json, read_at) VALUES(?,?,?,?,?,?,?)",
      evidenceId, this.ctx.investigationId, kind, tool, JSON.stringify(args), JSON.stringify(payload), this.ctx.clock.nowIso());
    return evidenceId;
  }

  private memo(tool: string, args: unknown): ToolResult | null {
    const row = get(this.ctx.db, "SELECT evidence_id, kind, payload_json FROM mp_evidence WHERE investigation_id = ? AND tool = ? AND args_json = ? AND kind <> 'CAMPAIGN' ORDER BY rowid LIMIT 1",
      this.ctx.investigationId, tool, JSON.stringify(args));
    if (!row) return null;
    return { evidenceRef: String(row.evidence_id), ok: row.kind !== "ERROR", data: JSON.parse(String(row.payload_json)) };
  }

  private errId(tool: string) {
    return `err-${tool}-${nextCounter(this.ctx.db, "evidence.err", 1)}`;
  }

  /** Validate arguments and enforce store scoping: tools only answer for the investigation's store. */
  async call(name: string, rawArgs: unknown): Promise<ToolResult> {
    const spec = TOOL_SPECS.find((t) => t.name === name);
    if (!spec) return { evidenceRef: "none", ok: false, data: { error: `Unknown tool ${name}. Available: ${TOOL_SPECS.map((t) => t.name).join(", ")}` } };
    const parsed = spec.input.safeParse(rawArgs);
    if (!parsed.success) return { evidenceRef: "none", ok: false, data: { error: `Invalid arguments: ${parsed.error.issues[0]?.message}` } };
    const args = parsed.data as { storeId: string; campaignId?: string };
    if (args.storeId !== this.ctx.posStoreId) return { evidenceRef: "none", ok: false, data: { error: "Tools are scoped to the investigation's store only" } };
    const cached = this.memo(name, args);
    if (cached) return cached;
    switch (name as ToolName) {
      case "getKitchenSnapshot": return this.kitchen(args);
      case "getMerchantGuardrail": return this.guardrail(args);
      case "getStoreCampaigns": return this.campaigns(args);
      case "getCampaignReport": return this.report(args as { storeId: string; campaignId: string });
      case "calculateContribution": return this.contribution(args as { storeId: string; campaignId: string });
    }
  }

  private async kitchen(args: { storeId: string }): Promise<ToolResult> {
    const r = await this.ctx.pos.getKitchenSnapshot(args.storeId);
    if (!r.ok) {
      const id = this.errId("getKitchenSnapshot");
      return { evidenceRef: this.record("ERROR", "getKitchenSnapshot", args, id, { error: r.error }), ok: false, data: { error: r.error } };
    }
    const id = this.record("KITCHEN_SNAPSHOT", "getKitchenSnapshot", args, r.value.snapshotId, r.value);
    return { evidenceRef: id, ok: true, data: r.value };
  }

  private async guardrail(args: { storeId: string }): Promise<ToolResult> {
    const p = currentPolicy(this.ctx.db, args.storeId);
    if (!p) {
      const id = this.errId("getMerchantGuardrail");
      return { evidenceRef: this.record("ERROR", "getMerchantGuardrail", args, id, { error: "no current policy" }), ok: false, data: { error: "no current policy" } };
    }
    const data = {
      policyId: p.policy_id, version: p.version, p95ThresholdMinutes: p.p95_threshold_minutes, minContributionRateBps: p.min_contribution_rate_bps,
      maxPosSnapshotAgeS: p.max_pos_snapshot_age_s, maxAdsReportAgeS: p.max_ads_report_age_s, maxEventAgeS: p.max_event_age_s,
      approvalRequired: Number(p.approval_required) === 1, allowedAction: p.allowed_action, approvalTtlS: p.approval_ttl_s, recommendationTtlS: p.recommendation_ttl_s,
    };
    const id = this.record("POLICY", "getMerchantGuardrail", args, `${p.policy_id}-${p.version}`, data);
    return { evidenceRef: id, ok: true, data };
  }

  private async campaigns(args: { storeId: string }): Promise<ToolResult> {
    const mappings = all(this.ctx.db, "SELECT * FROM mp_store_mappings WHERE pos_store_id = ? ORDER BY mapping_id", args.storeId);
    const mappingRef = this.record("STORE_MAPPING", "getStoreCampaigns", { ...args, part: "mapping" }, `mapping-${args.storeId}`, { mappings });
    if (mappings.length !== 1) {
      const id = this.errId("getStoreCampaigns");
      const data = { error: mappings.length === 0 ? "store is not mapped to an Uber store" : `store maps to ${mappings.length} Uber stores; refusing to guess`, mappingRef, mappings };
      return { evidenceRef: this.record("ERROR", "getStoreCampaigns", args, id, data), ok: false, data };
    }
    const m = mappings[0]!;
    const r = await this.ctx.ads.listCampaigns(String(m.ad_account_id));
    if (!r.ok) {
      const id = this.errId("getStoreCampaigns");
      const data = { error: r.error, mappingRef };
      return { evidenceRef: this.record("ERROR", "getStoreCampaigns", args, id, data), ok: false, data };
    }
    const uberStoreId = String(m.uber_store_id);
    const scoped = r.value.filter((c) => c.storeIds.includes(uberStoreId));
    const perCampaign = scoped.map((c) => ({
      evidenceRef: this.record("CAMPAIGN", "getStoreCampaigns", { ...args, campaignId: c.campaignId }, `campaign-read-${c.campaignId}-v${c.version}`, c),
      campaign: c,
      eligible: isEligible(c, uberStoreId),
    }));
    const data = {
      mapping: { posStoreId: args.storeId, uberStoreId, accountId: String(m.ad_account_id), mappingRef },
      campaigns: perCampaign.map((p) => ({
        evidenceRef: p.evidenceRef, campaignId: p.campaign.campaignId, name: p.campaign.name, product: p.campaign.product,
        configuredStatus: p.campaign.configuredStatus, effectiveStatus: p.campaign.effectiveStatusRaw, permissions: p.campaign.permissions,
        version: p.campaign.version, eligible: p.eligible,
      })),
      eligibleCampaignIds: perCampaign.filter((p) => p.eligible).map((p) => p.campaign.campaignId),
    };
    const id = this.record("CAMPAIGN_LIST", "getStoreCampaigns", args, `campaigns-${String(m.ad_account_id)}-${uberStoreId}`, data);
    return { evidenceRef: id, ok: true, data };
  }

  private async mappingFor(storeId: string) {
    const ms = all(this.ctx.db, "SELECT * FROM mp_store_mappings WHERE pos_store_id = ?", storeId);
    return ms.length === 1 ? ms[0]! : null;
  }

  private async report(args: { storeId: string; campaignId: string }): Promise<ToolResult> {
    const m = await this.mappingFor(args.storeId);
    if (!m) {
      const id = this.errId("getCampaignReport");
      return { evidenceRef: this.record("ERROR", "getCampaignReport", args, id, { error: "store mapping not unique" }), ok: false, data: { error: "store mapping not unique" } };
    }
    // Store scoping: the campaign must belong to the mapped account and target the mapped store.
    const c = await this.ctx.ads.getCampaign(String(m.ad_account_id), args.campaignId);
    if (!c.ok || !c.value || !c.value.storeIds.includes(String(m.uber_store_id))) {
      const id = this.errId("getCampaignReport");
      const data = { error: c.ok ? "campaign not found for this store" : c.error };
      return { evidenceRef: this.record("ERROR", "getCampaignReport", args, id, data), ok: false, data };
    }
    const r = await this.ctx.ads.getLatestReport(String(m.ad_account_id), args.campaignId);
    if (!r.ok || !r.value) {
      const id = this.errId("getCampaignReport");
      const data = { error: r.ok ? "no report available" : r.error };
      return { evidenceRef: this.record("ERROR", "getCampaignReport", args, id, data), ok: false, data };
    }
    const id = this.record("CAMPAIGN_REPORT", "getCampaignReport", args, r.value.reportId, r.value);
    return { evidenceRef: id, ok: true, data: r.value };
  }

  private async contribution(args: { storeId: string; campaignId: string }): Promise<ToolResult> {
    const rep = await this.call("getCampaignReport", args);
    const policy = await this.call("getMerchantGuardrail", { storeId: args.storeId });
    const cost = await this.ctx.pos.getCostProfile(args.storeId);
    const costRef = cost.ok
      ? this.record("COST_PROFILE", "getCostProfile", { storeId: args.storeId }, `cost-${args.storeId}`, cost.value)
      : this.record("ERROR", "getCostProfile", { storeId: args.storeId }, this.errId("getCostProfile"), { error: cost.error });
    const report = rep.ok ? (rep.data as { attributedOrders: number | null; attributedSalesCents: number | null; spendCents: number | null }) : null;
    const pol = policy.ok ? (policy.data as { minContributionRateBps: number }) : null;
    const result = calculateContribution({
      attributedOrders: report?.attributedOrders ?? null,
      attributedSalesCents: report?.attributedSalesCents ?? null,
      spendCents: report?.spendCents ?? null,
      avgFoodPackagingCostCents: cost.ok ? cost.value.avgFoodPackagingCostCents : null,
      marketplaceFeeRateBps: cost.ok ? cost.value.marketplaceFeeRateBps : null,
      minContributionRateBps: pol?.minContributionRateBps ?? 2000,
    });
    const data = { result, inputs: { reportRef: rep.evidenceRef, costRef, policyRef: policy.evidenceRef } };
    const id = this.record(result.ok ? "CALCULATION" : "ERROR", "calculateContribution", args, `calc-${nextCounter(this.ctx.db, "evidence.calc", 881)}`, data);
    return { evidenceRef: id, ok: result.ok, data };
  }
}

export function evidenceIds(db: Db, investigationId: string): Set<string> {
  return new Set(all(db, "SELECT evidence_id FROM mp_evidence WHERE investigation_id = ?", investigationId).map((r) => String(r.evidence_id)));
}
export function evidenceRow(db: Db, investigationId: string, evidenceId: string) {
  const r = get(db, "SELECT * FROM mp_evidence WHERE investigation_id = ? AND evidence_id = ?", investigationId, evidenceId);
  return r ? { kind: String(r.kind), payload: JSON.parse(String(r.payload_json)) as Record<string, unknown> } : null;
}
