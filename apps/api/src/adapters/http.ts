/**
 * HTTP adapters. The same Uber Ads adapter talks to the local simulator
 * (SIMULATED) or to a configured Uber endpoint (SANDBOX/LIVE) — the campaign
 * paths and shapes are the documented ones. Reporting differs (Uber's is
 * asynchronous) so non-simulated reporting fails closed.
 */
import { z } from "zod";
import { AdsCampaignWire, AdsPatchResponse } from "../../../../packages/contracts/src/index";
import type {
  AdAccount, AdsError, CampaignChange, CampaignReport, CampaignView, CostProfile, KitchenSnapshot, Observation, PatchOutcome,
  PosError, PosPort, Result, SimulatorConsolePort, SimulatorSnapshot, StoreProfile, UberAdsPort,
} from "./ports";
import { mapServing } from "./ports";
import { internalFetch } from "../security/internal";

const AdAccountsWire = z.object({ ad_accounts: z.array(z.object({ account_id: z.string(), name: z.string(), currency: z.string() })) });
const LedgerWire = z.object({
  ledger: z.array(z.object({
    request_id: z.string().nullable(), campaign_id: z.string(), field: z.string(), before_value: z.string().nullable(), after_value: z.string().nullable(),
    version_before: z.number().nullable(), version_after: z.number().nullable(), source: z.string(), at: z.string(),
  }).passthrough()),
});
const StoreProfileWire = z.object({ storeId: z.string(), name: z.string(), timezone: z.string() });
const KitchenSnapshotWire = z.object({
  snapshotId: z.string().min(1), storeId: z.string().min(1), capturedAt: z.string().min(1),
  p95PrepMinutes: z.number().finite().nonnegative(), activeTickets: z.number().int().nonnegative(),
  connectorHealth: z.enum(["HEALTHY", "DEGRADED", "DOWN"]),
});
const CostProfileWire = z.object({
  storeId: z.string(),
  avgFoodPackagingCostCents: z.number().int().nonnegative().nullable(),
  marketplaceFeeRateBps: z.number().int().nonnegative().nullable(),
}).passthrough();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const jitter = (attempt: number) => 40 * attempt + Math.floor(Math.random() * 60);

function toView(w: AdsCampaignWire, accountId: string): CampaignView {
  return {
    campaignId: w.campaign_id,
    accountId,
    name: w.name,
    product: w.product ?? null,
    configuredStatus: w.configured_status,
    effectiveStatusRaw: w.effective_status,
    effectiveStatusReasons: w.effective_status_reasons,
    serving: mapServing(w.effective_status),
    permissions: w.permissions,
    version: w.version,
    storeIds: w.store_ids ?? [],
    dailyBudgetCents: w.budget ? Math.round(w.budget.total.amount_e5 / 1000) : null,
    updatedAt: w.updated_at,
    updatedBy: w.updated_by_email ?? null,
  };
}

export class HttpUberAdsAdapter implements UberAdsPort {
  constructor(
    private readonly baseUrl: () => string,
    private readonly token: string,
    private readonly opts: { timeoutMs: number; simulated: boolean; label: string },
  ) {}
  get label() { return this.opts.label; }

  private headers(extra: Record<string, string> = {}) {
    return { authorization: `Bearer ${this.token}`, accept: "application/json", ...extra };
  }

  /** Safe reads only: retried on 429/5xx/network with jitter (max 3 tries). */
  private async getJson(path: string): Promise<Result<unknown>> {
    let last: AdsError = { kind: "NETWORK", message: "not attempted" };
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await internalFetch(this.baseUrl() + path, { headers: this.headers(), signal: AbortSignal.timeout(this.opts.timeoutMs) });
        const body = await res.json().catch(() => ({}));
        if (res.ok) return { ok: true, value: body };
        last = { kind: "HTTP", status: res.status, code: String((body as { code?: string }).code ?? res.status), message: String((body as { message?: string }).message ?? res.statusText) };
        if (res.status !== 429 && res.status < 500) return { ok: false, error: last };
      } catch (e) {
        last = { kind: "NETWORK", message: (e as Error).message };
      }
      if (attempt < 3) await sleep(jitter(attempt));
    }
    return { ok: false, error: last };
  }

  async listCampaigns(accountId: string): Promise<Result<CampaignView[]>> {
    const r = await this.getJson(`/v1/ads/${encodeURIComponent(accountId)}/campaigns?page_limit=2000`);
    if (!r.ok) return r;
    const parsed = AdsCampaignWire.array().safeParse((r.value as { campaigns?: unknown }).campaigns);
    if (!parsed.success) return { ok: false, error: { kind: "CONTRACT", message: "campaign list did not match the expected shape" } };
    return { ok: true, value: parsed.data.map((w) => toView(w, accountId)) };
  }

  async getCampaign(accountId: string, campaignId: string): Promise<Result<CampaignView | null>> {
    const r = await this.getJson(`/v1/ads/${encodeURIComponent(accountId)}/campaigns?campaign_id=${encodeURIComponent(campaignId)}`);
    if (!r.ok) return r;
    const parsed = AdsCampaignWire.array().safeParse((r.value as { campaigns?: unknown }).campaigns);
    if (!parsed.success) return { ok: false, error: { kind: "CONTRACT", message: "campaign readback did not match the expected shape" } };
    const match = parsed.data.find((c) => c.campaign_id === campaignId);
    return { ok: true, value: match ? toView(match, accountId) : null };
  }

  async getLatestReport(accountId: string, campaignId: string): Promise<Result<CampaignReport | null>> {
    if (!this.opts.simulated)
      return { ok: false, error: { kind: "CONFIG", message: "Uber reporting is asynchronous (POST /v1/ads/{account_id}/reporting/report); not implemented in this slice (TO_VERIFY)" } };
    const r = await this.getJson(`/mock-ads/${encodeURIComponent(accountId)}/reports?campaign_id=${encodeURIComponent(campaignId)}`);
    if (!r.ok) return r;
    const rows = (r.value as { reports?: Record<string, unknown>[] }).reports ?? [];
    const top = rows[0];
    if (!top) return { ok: true, value: null };
    const n = (x: unknown) => (x === null || x === undefined ? null : Number(x));
    return {
      ok: true,
      value: {
        reportId: String(top.report_id), campaignId: String(top.campaign_id), windowStart: String(top.window_start),
        windowEnd: String(top.window_end), watermark: String(top.watermark), attributedOrders: n(top.attributed_orders),
        attributedSalesCents: n(top.attributed_sales_cents), spendCents: n(top.spend_cents),
      },
    };
  }

  /** The ONE write. Never retried here — the caller decides after a readback. */
  async setConfiguredStatus(accountId: string, campaignId: string, status: "CAMPAIGN_CONFIGURED_STATUS_PAUSED", requestId: string): Promise<PatchOutcome> {
    let res: Response;
    try {
      res = await internalFetch(`${this.baseUrl()}/v1/ads/${encodeURIComponent(accountId)}/campaigns`, {
        method: "PATCH",
        headers: this.headers({ "content-type": "application/json", "x-request-id": requestId }),
        body: JSON.stringify({ campaigns: [{ campaign_id: campaignId, configured_status: status }] }),
        signal: AbortSignal.timeout(this.opts.timeoutMs),
      });
    } catch (e) {
      return { kind: "AMBIGUOUS", message: `No response (${(e as Error).message}); the update may or may not have been applied` };
    }
    const body = await res.json().catch(() => null);
    if (!res.ok) {
      const code = String((body as { code?: string } | null)?.code ?? res.status);
      const message = String((body as { message?: string } | null)?.message ?? res.statusText);
      // 4xx responses are definitive rejections; 5xx may have been partially processed.
      return { kind: "HTTP_ERROR", httpStatus: res.status, code, message, definitelyNotApplied: res.status < 500 };
    }
    const parsed = AdsPatchResponse.safeParse(body);
    if (!parsed.success) return { kind: "AMBIGUOUS", message: "PATCH returned 2xx but the body did not match the documented results[] shape" };
    const first = parsed.data.results[0];
    if (first && "failure" in first) return { kind: "ITEM_FAILURE", httpStatus: res.status, errorCode: first.failure.error_code, message: first.failure.error_message, body };
    return { kind: "SUCCESS", httpStatus: res.status, body };
  }

  async listAdAccounts(): Promise<Result<AdAccount[]>> {
    const r = await this.getJson("/v1/ads/ad-accounts");
    if (!r.ok) return r;
    const parsed = AdAccountsWire.safeParse(r.value);
    if (!parsed.success) return { ok: false, error: { kind: "CONTRACT", message: "ad account list did not match the expected shape" } };
    return { ok: true, value: parsed.data.ad_accounts.map((a) => ({ accountId: a.account_id, name: a.name, currency: a.currency })) };
  }

  async getCampaignChangeLog(accountId: string, campaignId: string): Promise<Observation<CampaignChange[]>> {
    if (!this.opts.simulated) return { available: false, reason: "The Uber Ads API offers no campaign change log; only the local simulator can show one." };
    const r = await this.getJson(`/mock-ads/ledger?campaign_id=${encodeURIComponent(campaignId)}`);
    if (!r.ok) return { available: false, reason: `Simulator change log could not be read (${r.error.kind})` };
    const parsed = LedgerWire.safeParse(r.value);
    if (!parsed.success) return { available: false, reason: "Simulator change log did not match the expected shape" };
    void accountId;
    return {
      available: true,
      value: parsed.data.ledger.map((l) => ({
        requestId: l.request_id, field: l.field, before: l.before_value, after: l.after_value,
        versionBefore: l.version_before, versionAfter: l.version_after, source: l.source, at: l.at,
      })),
    };
  }

  async stateDigest(excludeCampaignId: string): Promise<string | null> {
    if (!this.opts.simulated) return null;
    try {
      const res = await internalFetch(`${this.baseUrl()}/mock-ads/admin/digest?exclude_campaign=${encodeURIComponent(excludeCampaignId)}`);
      return ((await res.json()) as { digest: string }).digest;
    } catch {
      return null;
    }
  }
}

/** Fail-closed adapter used when the selected provider is not configured. */
export class UnconfiguredAdsAdapter implements UberAdsPort {
  constructor(private readonly reason: string) {}
  get label() { return `Uber Ads (UNCONFIGURED: ${this.reason})`; }
  private err<T>(): Promise<Result<T>> { return Promise.resolve({ ok: false, error: { kind: "CONFIG", message: this.reason } }); }
  listCampaigns() { return this.err<CampaignView[]>(); }
  getCampaign() { return this.err<CampaignView | null>(); }
  getLatestReport() { return this.err<CampaignReport | null>(); }
  setConfiguredStatus(): Promise<PatchOutcome> { return Promise.resolve({ kind: "HTTP_ERROR", httpStatus: 0, code: "CONFIG", message: this.reason, definitelyNotApplied: true }); }
  stateDigest() { return Promise.resolve(null); }
  listAdAccounts() { return this.err<AdAccount[]>(); }
  getCampaignChangeLog(): Promise<Observation<CampaignChange[]>> { return Promise.resolve({ available: false, reason: this.reason }); }
}

export class HttpPosAdapter implements PosPort {
  constructor(private readonly baseUrl: () => string, private readonly timeoutMs: number) {}
  readonly label = "Mock POS/KDS (local simulator · mocked partner extension)";
  private async getJson<T>(path: string): Promise<Result<T, PosError>> {
    try {
      const res = await internalFetch(this.baseUrl() + path, { signal: AbortSignal.timeout(this.timeoutMs) });
      const body = await res.json().catch(() => ({}));
      if (res.ok) return { ok: true, value: body as T };
      if (res.status === 404) return { ok: false, error: { kind: "NOT_FOUND", message: String((body as { error?: string }).error ?? "not found") } };
      return { ok: false, error: { kind: "UNAVAILABLE", message: `HTTP ${res.status}` } };
    } catch (e) {
      return { ok: false, error: { kind: "NETWORK", message: (e as Error).message } };
    }
  }
  /** Parse a POS body with its schema; a mismatch is reported as unavailable, never coerced. */
  private async getParsed<S extends z.ZodType>(path: string, schema: S, what: string): Promise<Result<z.infer<S>, PosError>> {
    const r = await this.getJson<unknown>(path);
    if (!r.ok) return r;
    const parsed = schema.safeParse(r.value);
    if (!parsed.success) return { ok: false, error: { kind: "UNAVAILABLE", message: `${what} did not match the expected shape (${parsed.error.issues[0]?.path.join(".")})` } };
    return { ok: true, value: parsed.data };
  }
  getKitchenSnapshot(storeId: string): Promise<Result<KitchenSnapshot, PosError>> {
    return this.getParsed(`/mock-pos/stores/${encodeURIComponent(storeId)}/kitchen-snapshot`, KitchenSnapshotWire, "kitchen snapshot");
  }
  async getCostProfile(storeId: string): Promise<Result<CostProfile, PosError>> {
    const r = await this.getParsed(`/mock-pos/stores/${encodeURIComponent(storeId)}/cost-profile`, CostProfileWire, "cost profile");
    if (!r.ok) return r;
    return { ok: true, value: { storeId: r.value.storeId, avgFoodPackagingCostCents: r.value.avgFoodPackagingCostCents, marketplaceFeeRateBps: r.value.marketplaceFeeRateBps } };
  }
  async getStoreProfile(storeId: string): Promise<Result<StoreProfile, PosError>> {
    const r = await this.getJson<unknown>(`/mock-pos/stores/${encodeURIComponent(storeId)}`);
    if (!r.ok) return r;
    const parsed = StoreProfileWire.safeParse(r.value);
    if (!parsed.success) return { ok: false, error: { kind: "UNAVAILABLE", message: "store profile did not match the expected shape" } };
    return { ok: true, value: parsed.data };
  }
  async stateDigest() {
    try { return ((await (await internalFetch(this.baseUrl() + "/mock-pos/admin/digest")).json()) as { digest: string }).digest; } catch { return null; }
  }
}

/**
 * Demo-only reader for simulator internals, over the simulators' own HTTP routes.
 * Unavailable when the matching system is not simulated.
 */
export class HttpSimulatorConsole implements SimulatorConsolePort {
  constructor(private readonly opts: { adsBaseUrl: (() => string) | null; posBaseUrl: (() => string) | null; timeoutMs: number }) {}

  private async get(base: () => string, path: string): Promise<unknown> {
    const res = await internalFetch(base() + path, { signal: AbortSignal.timeout(this.opts.timeoutMs) });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
    return res.json();
  }

  async snapshot(): Promise<Observation<SimulatorSnapshot>> {
    const { adsBaseUrl, posBaseUrl } = this.opts;
    if (!adsBaseUrl || !posBaseUrl) return { available: false, reason: "Simulator controls need ADS_MODE=SIMULATED and the local mock POS." };
    try {
      const [af, pf, ob, lg, rq] = await Promise.all([
        this.get(adsBaseUrl, "/mock-ads/faults"),
        this.get(posBaseUrl, "/mock-pos/faults"),
        this.get(posBaseUrl, "/mock-pos/outbox?order=desc&limit=10"),
        this.get(adsBaseUrl, "/mock-ads/ledger?order=desc&limit=20"),
        this.get(adsBaseUrl, "/mock-ads/requests"),
      ]);
      const requests = (rq as { requests: (SimulatorSnapshot["requests"][number] & { seq: number })[] }).requests;
      return {
        available: true,
        value: {
          adsFaults: (af as { armed: SimulatorSnapshot["adsFaults"] }).armed.map((f) => ({ op: f.op, mode: f.mode, remaining: f.remaining, param: f.param })),
          posFaults: (pf as { armed: SimulatorSnapshot["posFaults"] }).armed.map((f) => ({ mode: f.mode, remaining: f.remaining })),
          outbox: (ob as { outbox: SimulatorSnapshot["outbox"] }).outbox,
          ledger: (lg as { ledger: Record<string, unknown>[] }).ledger,
          requests: [...requests].reverse().slice(0, 30).map((r) => ({ method: r.method, path: r.path, status: r.status, fault: r.fault, at: r.at })),
          patchCount: requests.filter((r) => r.method === "PATCH").length,
        },
      };
    } catch (e) {
      return { available: false, reason: `Simulator state could not be read (${(e as Error).message})` };
    }
  }
}
