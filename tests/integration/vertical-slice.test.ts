/**
 * G1 — the one complete transaction, end to end over real HTTP:
 * mock POS emits a signed webhook → investigation → policy → approval →
 * one PATCH into the stateful Uber Ads simulator → independent readback.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { boot, Booted } from "../helpers";

let t: Booted;
beforeAll(async () => { t = await boot(); });
afterAll(async () => { await t.close(); });

describe("vertical slice — Example A (success)", () => {
  beforeEach(async () => { await t.api.load("A"); });

  it("recommends, waits for approval, pauses exactly once and verifies by readback", async () => {
    const before = await t.api.campaign();
    expect(before.configured_status).toBe("CAMPAIGN_CONFIGURED_STATUS_ACTIVE");
    expect(before.version).toBe(12);

    const { event, delivery } = await t.api.emit();
    expect(event.eventId).toBe("evt-kds-1831-001");
    expect(delivery.status).toBe(202);
    const id = delivery.body.investigationId;
    expect(id).toBe("inv-1042");

    let v = await t.api.view(id);
    expect(v.status).toBe("AWAITING_APPROVAL");
    expect(v.decision).toBe("RECOMMEND_PAUSE");
    expect(v.kitchen.p95PrepMinutes).toBe(34);
    expect(v.kitchen.ageSeconds).toBe(23);
    expect(v.campaign.campaignId).toBe("cmp-syn-4081");
    expect(v.contribution.perOrder.contributionCents).toBe(320);
    expect(v.contribution.floorCentsPerOrder).toBe(560);
    expect(v.contribution.belowFloor).toBe(true);
    expect(v.agent.validation.schemaValid).toBe(true);
    expect(v.agent.raw.observations.map((o: any) => o.evidenceRef)).toEqual(["kds-snap-812", "campaign-read-cmp-syn-4081-v12", "calc-881"]);

    // No write before approval
    expect(await t.api.patchCount()).toBe(0);
    const early = await t.api.post(`/api/investigations/${id}/pause-campaign`, { approvalId: "apr-501" });
    expect(early.status).toBe(409);
    expect(early.body.error).toBe("APPROVAL_REQUIRED");
    expect(await t.api.patchCount()).toBe(0);

    const { approve, pause } = await t.api.approveAndPause(id);
    expect(approve.status).toBe(200);
    expect(pause!.status).toBe(200);
    expect(pause!.body.output.ok).toBe(true);
    expect(pause!.body.output.requestId).toBe("req-pause-4081-001");

    v = await t.api.view(id);
    expect(v.status).toBe("PAUSE_VERIFIED");
    expect(await t.api.patchCount()).toBe(1);
    const last = v.result.tool.detail.readbacks.at(-1);
    expect(last.configuredStatus).toBe("CAMPAIGN_CONFIGURED_STATUS_PAUSED");
    expect(last.effectiveStatus).toBe("CAMPAIGN_EFFECTIVE_STATUS_PAUSED");
    expect(last.version).toBe(13);
    expect(v.result.otherMutations).toBe("NONE");

    // Independent readback straight from the simulator API
    const after = await t.api.campaign();
    expect(after.configured_status).toBe("CAMPAIGN_CONFIGURED_STATUS_PAUSED");
    expect(after.effective_status).toBe("CAMPAIGN_EFFECTIVE_STATUS_PAUSED");
    expect(after.version).toBe(13);
    const other = await t.api.campaign("cmp-syn-5120", "SYN-AD-305");
    expect(other.configured_status).toBe("CAMPAIGN_CONFIGURED_STATUS_ACTIVE");
    expect(other.version).toBe(7);

    // Audit links event → approval → write → readback → verified, and the chain verifies
    const audit = await t.api.get(`/api/investigations/${id}/audit`);
    const types = audit.body.events.map((e: any) => e.type);
    for (const ty of ["EVENT_RECEIVED", "AGENT_INVESTIGATED", "POLICY_EVALUATED", "MANAGER_APPROVED", "PATCH_SENT", "READBACK", "PAUSE_VERIFIED"]) expect(types).toContain(ty);
    expect(audit.body.chain.ok).toBe(true);
    const ledger = (await t.api.get("/mock-ads/ledger")).body.ledger.filter((l: any) => l.source === "API");
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ campaign_id: "cmp-syn-4081", field: "configured_status", version_before: 12, version_after: 13, request_id: "req-pause-4081-001" });
  });
});

describe("vertical slice — Example C (negative)", () => {
  it("blocks on a stale kitchen snapshot and never offers approval", async () => {
    await t.api.load("C");
    const { delivery } = await t.api.emit();
    const v = await t.api.view(delivery.body.investigationId);
    expect(v.status).toBe("BLOCKED");
    expect(v.decisionCode).toBe("BLOCKED_STALE_KITCHEN_DATA");
    expect(v.actions.canApprove).toBe(false);
    const a = await t.api.post(`/api/investigations/${v.id}/approve`);
    expect(a.status).toBe(409);
    expect(await t.api.patchCount()).toBe(0);
  });
});
