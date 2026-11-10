/**
 * pauseSponsoredListingCampaign — the ONLY mutating tool (spec §13).
 * Called by the orchestrator after approval/policy checks, never by the agent.
 *
 * Safety sequence:
 *  1. re-read the campaign (stale-read guard: version, status, store scope, UPDATE)
 *  2. reserve the idempotency key BEFORE the call (IN_FLIGHT row, unique per attempt)
 *  3. PATCH once — never blindly retried
 *  4. read back; classify ambiguous outcomes FROM the readback
 *  5. verified only when configured=PAUSED and effective maps to NOT_SERVING
 *
 * Note (TO_VERIFY): Uber's documented PATCH body has no version/If-Match field,
 * so step 1 is the only concurrency guard and a small race window remains
 * between the re-read and the PATCH.
 */
import type { PauseSponsoredListingCampaignInput, PauseSponsoredListingCampaignOutput } from "../../../../packages/contracts/src/index";
import { all, Db, get, run } from "../db/db";
import type { Clock } from "../clock";
import type { CampaignView, PatchOutcome, UberAdsPort } from "../adapters/ports";

export interface Readback {
  attempt: number;
  at: string;
  ok: boolean;
  configuredStatus?: string;
  effectiveStatus?: string;
  serving?: string;
  version?: number;
  error?: string;
}

export interface PauseDetail {
  requestId: string | null;
  attempt: number | null;
  preWrite: { ok: boolean; campaign: CampaignView | null; reason: string | null };
  writeRequest: unknown;
  writeOutcome: PatchOutcome | null;
  mutationStatus: "SUCCEEDED" | "FAILED_NOT_APPLIED" | "AMBIGUOUS" | null;
  readbacks: Readback[];
  verified: boolean;
  stillServing: boolean;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function requestIdFor(campaignId: string, attempt: number) {
  const suffix = campaignId.split("-").pop() ?? campaignId;
  return `req-pause-${suffix}-${String(attempt).padStart(3, "0")}`;
}

export async function readbackOnce(ads: UberAdsPort, accountId: string, campaignId: string, attempt: number, clock: Clock): Promise<Readback> {
  const r = await ads.getCampaign(accountId, campaignId);
  if (!r.ok) return { attempt, at: clock.nowIso(), ok: false, error: `${r.error.kind}: ${"message" in r.error ? r.error.message : ""}` };
  if (!r.value) return { attempt, at: clock.nowIso(), ok: false, error: "campaign not found on readback" };
  return { attempt, at: clock.nowIso(), ok: true, configuredStatus: r.value.configuredStatus, effectiveStatus: r.value.effectiveStatusRaw, serving: r.value.serving, version: r.value.version };
}

export const isVerified = (rb: Readback) => rb.ok && rb.configuredStatus === "CAMPAIGN_CONFIGURED_STATUS_PAUSED" && rb.serving === "NOT_SERVING";

export async function pauseSponsoredListingCampaign(
  input: PauseSponsoredListingCampaignInput,
  deps: { db: Db; clock: Clock; ads: UberAdsPort; uberStoreId: string; readbackAttempts: number; readbackIntervalMs: number },
): Promise<{ output: PauseSponsoredListingCampaignOutput; detail: PauseDetail }> {
  const { db, clock, ads } = deps;
  const detail: PauseDetail = {
    requestId: null, attempt: null, preWrite: { ok: false, campaign: null, reason: null }, writeRequest: null,
    writeOutcome: null, mutationStatus: null, readbacks: [], verified: false, stillServing: false,
  };
  const fail = (code: Extract<PauseSponsoredListingCampaignOutput, { ok: false }>["code"], message: string) => {
    if (!detail.preWrite.reason) detail.preWrite.reason = `${code}: ${message}`;
    return { output: { ok: false as const, code, message }, detail };
  };

  // 1. Pre-write re-read
  const pre = await ads.getCampaign(input.accountId, input.campaignId);
  if (!pre.ok) {
    if (pre.error.kind === "HTTP" && pre.error.status === 429) return fail("RATE_LIMITED", "Uber Ads rate-limited the pre-write read; nothing was changed");
    if (pre.error.kind === "HTTP" && (pre.error.status === 401 || pre.error.status === 403)) return fail("NOT_AUTHORIZED", "Uber Ads rejected the integration credentials; nothing was changed");
    return fail("UPSTREAM_ERROR", `Pre-write read failed (${pre.error.kind}); nothing was changed`);
  }
  const c = pre.value;
  detail.preWrite.campaign = c;
  if (!c || !c.storeIds.includes(deps.uberStoreId)) return fail("WRONG_STORE", "Campaign is not scoped to the approved store");
  if (c.configuredStatus === "CAMPAIGN_CONFIGURED_STATUS_PAUSED") return fail("ALREADY_PAUSED", "Campaign was already paused by someone else");
  if (c.configuredStatus !== "CAMPAIGN_CONFIGURED_STATUS_ACTIVE") return fail("STALE_CAMPAIGN", `Campaign is ${c.configuredStatus}, not ACTIVE`);
  if (c.version !== input.observedCampaignVersion) return fail("STALE_CAMPAIGN", `Campaign changed since review (version ${input.observedCampaignVersion} → ${c.version})`);
  if (!c.permissions.includes("UPDATE")) return fail("NOT_AUTHORIZED", "Integration lacks UPDATE permission on this campaign");
  detail.preWrite.ok = true;

  // 2. Idempotency reservation
  const attempts = all(db, "SELECT * FROM mp_mutations WHERE mutation_key = ? ORDER BY attempt", input.idempotencyKey);
  if (attempts.some((a) => a.status === "SUCCEEDED")) return fail("ALREADY_PAUSED", "This pause was already applied for this event");
  if (attempts.some((a) => a.status === "AMBIGUOUS" || a.status === "IN_FLIGHT")) return fail("UPSTREAM_ERROR", "A previous attempt has an unresolved outcome; check the campaign status first");
  if (attempts.length >= 3) return fail("UPSTREAM_ERROR", "Attempt limit reached for this event");
  const attempt = attempts.length + 1;
  const requestId = requestIdFor(input.campaignId, attempt);
  detail.requestId = requestId;
  detail.attempt = attempt;
  detail.writeRequest = {
    method: "PATCH",
    path: `/v1/ads/${input.accountId}/campaigns`,
    headers: { authorization: "Bearer [REDACTED]", "content-type": "application/json", "x-request-id": requestId },
    body: { campaigns: [{ campaign_id: input.campaignId, configured_status: "CAMPAIGN_CONFIGURED_STATUS_PAUSED" }] },
  };
  run(db, "INSERT INTO mp_mutations(mutation_key, attempt, investigation_id, approval_id, request_id, status, request_json, started_at) VALUES(?,?,?,?,?,'IN_FLIGHT',?,?)",
    input.idempotencyKey, attempt, input.investigationId, input.approvalId, requestId, JSON.stringify(detail.writeRequest), clock.nowIso());

  // 3. The single write
  const outcome = await ads.setConfiguredStatus(input.accountId, input.campaignId, "CAMPAIGN_CONFIGURED_STATUS_PAUSED", requestId);
  detail.writeOutcome = outcome;
  let status: PauseDetail["mutationStatus"] =
    outcome.kind === "SUCCESS" ? "SUCCEEDED"
      : outcome.kind === "ITEM_FAILURE" ? "FAILED_NOT_APPLIED"
        : outcome.kind === "HTTP_ERROR" && outcome.definitelyNotApplied ? "FAILED_NOT_APPLIED"
          : "AMBIGUOUS";

  // 4. Readback (always — an HTTP 200 alone is never treated as success)
  for (let i = 1; i <= Math.max(1, deps.readbackAttempts); i++) {
    if (i > 1) await sleep(deps.readbackIntervalMs);
    const rb = await readbackOnce(ads, input.accountId, input.campaignId, i, clock);
    detail.readbacks.push(rb);
    if (status === "AMBIGUOUS" && rb.ok) {
      // Resolve the ambiguity from observed state, not by retrying the write.
      if (rb.configuredStatus === "CAMPAIGN_CONFIGURED_STATUS_PAUSED" && (rb.version ?? 0) > input.observedCampaignVersion) status = "SUCCEEDED";
      else if (rb.configuredStatus === "CAMPAIGN_CONFIGURED_STATUS_ACTIVE" && rb.version === input.observedCampaignVersion) status = "FAILED_NOT_APPLIED";
    }
    if (isVerified(rb)) { detail.verified = true; break; }
    if (status === "FAILED_NOT_APPLIED") break; // nothing to wait for
  }
  const last = detail.readbacks[detail.readbacks.length - 1];
  detail.stillServing = status === "SUCCEEDED" && !detail.verified && !!last?.ok && last.configuredStatus === "CAMPAIGN_CONFIGURED_STATUS_PAUSED";
  detail.mutationStatus = status;
  run(db, "UPDATE mp_mutations SET status = ?, response_json = ?, error_code = ?, finished_at = ? WHERE mutation_key = ? AND attempt = ?",
    status, JSON.stringify(outcome), outcome.kind === "SUCCESS" ? null : outcome.kind === "ITEM_FAILURE" ? outcome.errorCode : outcome.kind === "HTTP_ERROR" ? outcome.code : "AMBIGUOUS",
    clock.nowIso(), input.idempotencyKey, attempt);

  if (status === "SUCCEEDED" && last?.ok) {
    return {
      output: { ok: true, requestId, campaignId: input.campaignId, configuredStatus: "CAMPAIGN_CONFIGURED_STATUS_PAUSED", effectiveStatus: String(last.effectiveStatus), version: Number(last.version), verified: detail.verified },
      detail,
    };
  }
  if (outcome.kind === "ITEM_FAILURE") {
    if (outcome.errorCode === "PERMISSION_DENIED") return fail("NOT_AUTHORIZED", outcome.message);
    if (outcome.errorCode === "NOT_FOUND") return fail("WRONG_STORE", outcome.message);
    return fail("UPSTREAM_ERROR", `${outcome.errorCode}: ${outcome.message}`);
  }
  if (outcome.kind === "HTTP_ERROR") {
    if (outcome.httpStatus === 429) return fail("RATE_LIMITED", "Uber Ads rate-limited the update; the campaign was not changed");
    if (outcome.httpStatus === 401 || outcome.httpStatus === 403) return fail("NOT_AUTHORIZED", `Uber Ads rejected the update (${outcome.httpStatus})`);
    if (status === "FAILED_NOT_APPLIED") return fail("UPSTREAM_ERROR", `Uber Ads returned ${outcome.httpStatus}; readback shows the campaign was not changed`);
  }
  if (status === "FAILED_NOT_APPLIED") return fail("UPSTREAM_ERROR", "No response from Uber Ads; readback shows the campaign was not changed");
  return fail("READBACK_TIMEOUT", "The outcome could not be confirmed; the write will not be retried until a readback resolves it");
}

/** Resolve a previously AMBIGUOUS attempt from a fresh readback (used by "Check again"). */
export function resolveAmbiguous(db: Db, mutationKey: string, rb: Readback, observedVersion: number) {
  const a = get(db, "SELECT * FROM mp_mutations WHERE mutation_key = ? AND status = 'AMBIGUOUS' ORDER BY attempt DESC LIMIT 1", mutationKey);
  if (!a || !rb.ok) return null;
  let next: string | null = null;
  if (rb.configuredStatus === "CAMPAIGN_CONFIGURED_STATUS_PAUSED" && (rb.version ?? 0) > observedVersion) next = "SUCCEEDED";
  else if (rb.configuredStatus === "CAMPAIGN_CONFIGURED_STATUS_ACTIVE" && rb.version === observedVersion) next = "FAILED_NOT_APPLIED";
  if (next) run(db, "UPDATE mp_mutations SET status = ? WHERE id = ?", next, a.id);
  return next;
}
