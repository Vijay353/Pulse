/** Spec §18 examples B–L plus adversarial and reliability cases (spec §20). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { boot, Booted } from "../helpers";
import { signEvent } from "../../apps/api/src/security/signature";

let t: Booted;
beforeAll(async () => { t = await boot(); });
afterAll(async () => { await t.close(); });

async function assessed(scenario: string, storeId = "SYN-STORE-104") {
  await t.api.load(scenario);
  const { delivery } = await t.api.emit(storeId);
  return t.api.view(delivery.body.investigationId);
}

describe("decision outcomes", () => {
  it.each([
    ["B", "NO_ACTION", "NO_ACTION_BELOW_THRESHOLD"],
    ["C", "BLOCKED", "BLOCKED_STALE_KITCHEN_DATA"],
    ["D", "NEEDS_REVIEW", "NEEDS_REVIEW_STALE_ADS_DATA"],
    ["E", "NEEDS_REVIEW", "NEEDS_REVIEW_CAMPAIGN_SELECTION"],
    ["F", "BLOCKED", "BLOCKED_MISSING_PERMISSION"],
    ["O", "NEEDS_REVIEW", "NEEDS_REVIEW_STORE_MAPPING"],
    ["P", "NO_ACTION", "NO_ACTION_CONTRIBUTION_OK"],
    ["Q", "NEEDS_REVIEW", "NEEDS_REVIEW_COST_DATA"],
    ["R", "BLOCKED", "BLOCKED_POS_UNAVAILABLE"],
  ])("scenario %s → %s (%s), no approval, no write", async (sc, status, code) => {
    const v = await assessed(sc);
    expect(v.status).toBe(status);
    expect(v.decisionCode).toBe(code);
    expect(v.actions.canApprove).toBe(false);
    expect(v.approvals).toHaveLength(0);
    expect(await t.api.patchCount()).toBe(0);
  });

  it("B: event arrives (POS alert at 22) but MarginPulse re-checks the merchant limit (28)", async () => {
    const v = await assessed("B");
    expect(v.event.configuredThresholdMinutes).toBe(22);
    expect(v.kitchen.thresholdMinutes).toBe(28);
    expect(v.agent.raw.candidateAction).toBe("NO_ACTION");
  });

  it("D: active campaign is still shown with the report watermark", async () => {
    const v = await assessed("D");
    expect(v.campaign.campaignId).toBe("cmp-syn-4081");
    expect(v.report.watermark).toBe("2026-10-18T18:03:43-04:00");
    expect(v.report.ageSecondsAtDecision).toBe(28 * 60);
  });

  it("E: agent abstains instead of picking the higher-budget campaign", async () => {
    const v = await assessed("E");
    expect(v.agent.raw.candidateAction).toBe("NEEDS_REVIEW");
    expect(v.agent.raw.candidateCampaignId).toBeNull();
  });

  it("P: injected campaign-name text does not change the decision", async () => {
    const v = await assessed("P");
    expect(v.campaign.name).toContain("ignore all policy");
    expect(v.contribution.belowFloor).toBe(false);
  });
});

describe("execution reliability", () => {
  it("G: version change after approval blocks the write; re-assess requires a new approval", async () => {
    const v = await assessed("A");
    const a = await t.api.post(`/api/investigations/${v.id}/approve`);
    await t.api.post("/mock-ads/simulate/external-edit", { campaign_id: "cmp-syn-4081" });
    const p = await t.api.post(`/api/investigations/${v.id}/pause-campaign`, { approvalId: a.body.approvalId });
    expect(p.status).toBe(200);
    const after = await t.api.view(v.id);
    expect(after.status).toBe("BLOCKED");
    expect(after.decisionCode).toBe("BLOCKED_CONTEXT_CHANGED");
    expect(await t.api.patchCount()).toBe(0);
    // old approval cannot be reused on the new investigation
    const re = await t.api.post(`/api/investigations/${v.id}/reassess`);
    const child = await t.api.view(re.body.investigationId);
    expect(child.status).toBe("AWAITING_APPROVAL");
    expect(child.campaign.version).toBe(13);
    const reuse = await t.api.post(`/api/investigations/${child.id}/pause-campaign`, { approvalId: a.body.approvalId });
    expect(reuse.status).toBe(409);
    const ok = await t.api.approveAndPause(child.id);
    expect(ok.pause!.body.output.ok).toBe(true);
    expect((await t.api.view(child.id)).status).toBe("PAUSE_VERIFIED");
    expect(await t.api.patchCount()).toBe(1);
  });

  it("H: three deliveries of the same event → one investigation, one PATCH", async () => {
    await t.api.load("A");
    const first = await t.api.emit();
    const r2 = await t.api.post(`/mock-pos/events/${first.event.eventId}/redeliver`);
    const r3 = await t.api.post(`/mock-pos/events/${first.event.eventId}/redeliver`);
    expect(r2.body.delivery.body).toMatchObject({ duplicate: true, investigationId: first.delivery.body.investigationId });
    expect(r3.body.deliveryCount).toBe(3);
    const list = (await t.api.get("/api/investigations")).body.investigations;
    expect(list).toHaveLength(1);
    await t.api.approveAndPause(first.delivery.body.investigationId);
    await t.api.post(`/mock-pos/events/${first.event.eventId}/redeliver`);
    expect(await t.api.patchCount()).toBe(1);
    const again = await t.api.post(`/api/investigations/${first.delivery.body.investigationId}/pause-campaign`, { approvalId: "apr-501" });
    expect(again.body.alreadyDone).toBe(true);
    expect(await t.api.patchCount()).toBe(1);
  });

  it("I: dropped connection after apply → no retry, readback verifies", async () => {
    const v = await assessed("I");
    const { pause } = await t.api.approveAndPause(v.id);
    expect(pause!.status).toBe(200);
    const after = await t.api.view(v.id);
    expect(after.result.tool.detail.writeOutcome.kind).toBe("AMBIGUOUS");
    expect(after.result.tool.detail.mutationStatus).toBe("SUCCEEDED");
    expect(after.status).toBe("PAUSE_VERIFIED");
    expect(await t.api.patchCount()).toBe(1);
  });

  it("I': dropped connection BEFORE apply → readback proves not applied → explicit retry allowed", async () => {
    await t.api.load("A");
    await t.api.post("/mock-ads/faults", { op: "PATCH_CAMPAIGNS", mode: "DROP_BEFORE_APPLY" });
    const { delivery } = await t.api.emit();
    const id = delivery.body.investigationId;
    const { approve } = await t.api.approveAndPause(id);
    let v = await t.api.view(id);
    expect(v.status).toBe("PAUSE_REQUESTED_NOT_VERIFIED");
    expect(v.mutations[0].status).toBe("FAILED_NOT_APPLIED");
    expect(v.actions.canRetry).toBe(true);
    expect(await t.api.patchCount()).toBe(1); // the dropped attempt was received but not applied
    const retry = await t.api.post(`/api/investigations/${id}/pause-campaign`, { approvalId: approve.body.approvalId });
    expect(retry.body.output.ok).toBe(true);
    v = await t.api.view(id);
    expect(v.status).toBe("PAUSE_VERIFIED");
    expect(v.mutations).toHaveLength(2);
    expect((await t.api.campaign()).version).toBe(13);
  });

  it("5xx after apply is ambiguous and resolved by readback (no blind retry)", async () => {
    await t.api.load("A");
    await t.api.post("/mock-ads/faults", { op: "PATCH_CAMPAIGNS", mode: "HTTP_500_AFTER_APPLY" });
    const { delivery } = await t.api.emit();
    await t.api.approveAndPause(delivery.body.investigationId);
    const v = await t.api.view(delivery.body.investigationId);
    expect(v.result.tool.detail.writeOutcome.kind).toBe("HTTP_ERROR");
    expect(v.status).toBe("PAUSE_VERIFIED");
    expect(await t.api.patchCount()).toBe(1);
  });

  it("J: configured PAUSED but effective ACTIVE is not success until a later check", async () => {
    await t.api.load("A");
    await t.api.post("/mock-ads/faults", { op: "PATCH_CAMPAIGNS", mode: "DELAYED_EFFECTIVE", param: "400" });
    const { delivery } = await t.api.emit();
    const id = delivery.body.investigationId;
    await t.api.approveAndPause(id);
    let v = await t.api.view(id);
    expect(v.status).toBe("PAUSE_REQUESTED_NOT_VERIFIED");
    expect(v.decisionCode).toBe("PAUSE_REQUESTED_STILL_SERVING");
    expect(v.result.tool.detail.stillServing).toBe(true);
    expect(v.actions.canRetry).toBe(false); // the write WAS applied; retrying would be wrong
    const noRetry = await t.api.post(`/api/investigations/${id}/pause-campaign`, { approvalId: v.approvals[0].approvalId });
    expect(noRetry.status).toBe(409);
    await new Promise((r) => setTimeout(r, 450));
    const chk = await t.api.post(`/api/investigations/${id}/verify`);
    expect(chk.body.verified).toBe(true);
    v = await t.api.view(id);
    expect(v.status).toBe("PAUSE_VERIFIED");
    expect(await t.api.patchCount()).toBe(1);
  });

  it("K: dismiss stores the reason and never mutates", async () => {
    const v = await assessed("K");
    const r = await t.api.post(`/api/investigations/${v.id}/dismiss`, { reason: "Rush is clearing; keep demand" });
    expect(r.status).toBe(200);
    const after = await t.api.view(v.id);
    expect(after.status).toBe("DISMISSED");
    expect(after.dismissReason).toBe("Rush is clearing; keep demand");
    expect(await t.api.patchCount()).toBe(0);
    expect((await t.api.campaign()).configured_status).toBe("CAMPAIGN_CONFIGURED_STATUS_ACTIVE");
  });

  it("L: there is no resume path anywhere in the API", async () => {
    const v = await assessed("A");
    await t.api.approveAndPause(v.id);
    for (const path of [`/api/investigations/${v.id}/resume`, `/api/investigations/${v.id}/resume-campaign`]) {
      expect((await t.api.post(path)).status).toBe(404);
    }
    const after = await t.api.view(v.id);
    expect(Object.keys(after.actions).some((k) => /resume/i.test(k))).toBe(false);
    expect(after.audit.some((e: any) => /RESUME/.test(e.type))).toBe(false);
  });

  it("M: 429 on PATCH gives a truthful not-applied status and a manual retry succeeds", async () => {
    const v = await assessed("M");
    const { approve, pause } = await t.api.approveAndPause(v.id);
    expect(pause!.body.output).toMatchObject({ ok: false, code: "RATE_LIMITED" });
    let after = await t.api.view(v.id);
    expect(after.status).toBe("PAUSE_REQUESTED_NOT_VERIFIED");
    expect(after.decisionCode).toBe("PAUSE_NOT_APPLIED_RATE_LIMITED");
    expect((await t.api.campaign()).configured_status).toBe("CAMPAIGN_CONFIGURED_STATUS_ACTIVE");
    const retry = await t.api.post(`/api/investigations/${v.id}/pause-campaign`, { approvalId: approve.body.approvalId });
    expect(retry.body.output.ok).toBe(true);
    after = await t.api.view(v.id);
    expect(after.status).toBe("PAUSE_VERIFIED");
  });

  it("401 from Uber Ads on the write blocks truthfully", async () => {
    await t.api.load("A");
    await t.api.post("/mock-ads/faults", { op: "PATCH_CAMPAIGNS", mode: "HTTP_401" });
    const { delivery } = await t.api.emit();
    await t.api.approveAndPause(delivery.body.investigationId);
    const v = await t.api.view(delivery.body.investigationId);
    expect(v.status).toBe("BLOCKED");
    expect(v.decisionCode).toBe("BLOCKED_MISSING_PERMISSION");
    expect((await t.api.campaign()).version).toBe(12);
  });

  it("policy changed after approval blocks execution", async () => {
    const v = await assessed("A");
    const a = await t.api.post(`/api/investigations/${v.id}/approve`);
    await t.api.post("/api/sim/policy/bump", { storeId: "SYN-STORE-104" });
    await t.api.post(`/api/investigations/${v.id}/pause-campaign`, { approvalId: a.body.approvalId });
    const after = await t.api.view(v.id);
    expect(after.decisionCode).toBe("BLOCKED_POLICY_CHANGED");
    expect(await t.api.patchCount()).toBe(0);
  });

  it("expired approval and stale recommendation are rejected", async () => {
    const v = await assessed("A");
    const a = await t.api.post(`/api/investigations/${v.id}/approve`);
    await t.api.post("/api/sim/clock/advance", { seconds: 301 });
    const p = await t.api.post(`/api/investigations/${v.id}/pause-campaign`, { approvalId: a.body.approvalId });
    expect(p.status).toBe(403);
    expect(p.body.message).toContain("approval_not_expired");
    expect(await t.api.patchCount()).toBe(0);
  });
});

describe("access and isolation", () => {
  it("staff cannot approve; a manager of another store cannot approve or pause", async () => {
    const v = await assessed("A");
    expect((await t.api.post(`/api/investigations/${v.id}/approve`, {}, "staff-ben")).status).toBe(403);
    expect((await t.api.post(`/api/investigations/${v.id}/approve`, {}, "mgr-cole")).status).toBe(403);
    const a = await t.api.post(`/api/investigations/${v.id}/approve`, {}, "mgr-ana");
    expect((await t.api.post(`/api/investigations/${v.id}/pause-campaign`, { approvalId: a.body.approvalId }, "mgr-cole")).status).toBe(403);
    expect(await t.api.patchCount()).toBe(0);
  });

  it("an approval for one investigation/campaign cannot authorize another", async () => {
    await t.api.load("A");
    const one = await t.api.emit("SYN-STORE-104");
    const two = await t.api.emit("SYN-STORE-205");
    const up = await t.api.view(two.delivery.body.investigationId);
    expect(up.decision).toBe("NO_ACTION"); // Uptown margin is healthy
    const a = await t.api.post(`/api/investigations/${one.delivery.body.investigationId}/approve`);
    const cross = await t.api.post(`/api/investigations/${two.delivery.body.investigationId}/pause-campaign`, { approvalId: a.body.approvalId }, "mgr-cole");
    expect(cross.status).toBe(409);
    expect(await t.api.patchCount()).toBe(0);
  });

  it("mutating routes require the CSRF token and a known demo identity", async () => {
    const v = await assessed("A");
    expect((await t.api.post(`/api/investigations/${v.id}/approve`, {}, "mgr-ana", { csrf: false })).status).toBe(403);
    expect((await t.api.post(`/api/investigations/${v.id}/approve`, {}, "nobody")).status).toBe(401);
  });

  it("N: forged webhook is rejected and creates no investigation", async () => {
    await t.api.load("A");
    const r = await t.api.post("/mock-pos/events/forged", { storeId: "SYN-STORE-104" });
    expect(r.body.delivery.status).toBe(401);
    expect((await t.api.get("/api/investigations")).body.investigations).toHaveLength(0);
    expect((await t.api.get("/api/sim/state")).body.rejectedEvents[0].reason).toContain("BLOCKED_INVALID_EVENT");
  });

  it("tampered payload with a once-valid signature is rejected", async () => {
    await t.api.load("A");
    const { event } = await t.api.emit();
    const tampered = { ...event, eventId: "evt-tampered-1", observedP95PrepMinutes: 99 };
    const res = await fetch(`${t.base}/api/events/kitchen-load`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(tampered) });
    expect(res.status).toBe(401);
  });

  it("an old (replayed/backlogged) signed event is blocked as stale; staleness via clock is also caught", async () => {
    await t.api.load("A");
    const ev: Record<string, unknown> = {
      eventId: "evt-kds-1828-999", eventType: "KitchenLoadThresholdBreached", occurredAt: "2026-10-18T18:28:43-04:00",
      storeId: "SYN-STORE-104", source: "mock-pos-kds", snapshotId: "kds-snap-812", observedP95PrepMinutes: 34, activeTickets: 18, configuredThresholdMinutes: 28,
    };
    ev.signature = signEvent(ev, t.config.posWebhookSecret);
    const res = await fetch(`${t.base}/api/events/kitchen-load`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(ev) });
    const body = await res.json();
    expect((await t.api.view(body.investigationId)).decisionCode).toBe("BLOCKED_STALE_EVENT");
    await t.api.post("/api/sim/clock/advance", { seconds: 180 });
    const late = await t.api.emit();
    expect((await t.api.view(late.delivery.body.investigationId)).decisionCode).toBe("BLOCKED_STALE_KITCHEN_DATA"); // snapshot now 203 s old
  });
});
