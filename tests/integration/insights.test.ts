/** CH-9 digest, CH-17 plan gate, CH-18 fleet, CH-20 metrics: read-only and store-scoped. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { boot, Booted } from "../helpers";
import { findBannedClaim } from "../../packages/contracts/src/index";
import { planAllows } from "../../packages/contracts/src/plans";

describe("digest and metrics (solo plan, the default)", () => {
  let t: Booted;
  beforeAll(async () => { t = await boot(); });
  afterAll(async () => { await t.close(); });

  it("counts only persisted outcomes; no money, no lift; reads write nothing", async () => {
    await t.api.load("A");
    const first = await t.api.emit();
    await t.api.approveAndPause(first.delivery.body.investigationId);
    // A second alert for the same store is recommended again; keep it active.
    const second = await t.api.emit();
    const id2 = second.delivery.body.investigationId;
    if ((await t.api.view(id2)).actions.canDismiss) await t.api.post(`/api/investigations/${id2}/dismiss`, { reason: "Rush is clearing" });
    const before = await t.api.get(`/api/investigations/${id2}/audit`);
    const dg = await t.api.get("/api/digest?store=SYN-STORE-104");
    expect(dg.status).toBe(200);
    expect(dg.body).toMatchObject({ investigated: 2, pausesVerified: 1, patchRequestsSent: 1, verificationRateBps: 10000, scope: { storeIds: ["SYN-STORE-104"], since: "SCENARIO_LOADED", scenario: "A" } });
    expect(dg.body.meanSecondsToDecision).toBeGreaterThanOrEqual(0);
    expect(findBannedClaim(JSON.stringify(dg.body))).toBeNull();
    expect(Object.keys(dg.body).join(" ")).not.toMatch(/sav|profit|revenue|roi|lift/i);
    const after = await t.api.get(`/api/investigations/${id2}/audit`);
    expect(after.body.events.length).toBe(before.body.events.length);
    expect(await t.api.patchCount()).toBe(1);
  });

  it("digest is store-scoped: another store's manager is refused", async () => {
    const r = await t.api.get("/api/digest?store=SYN-STORE-104", "mgr-cole");
    expect(r.status).toBe(403);
  });

  it("metrics are global counts only", async () => {
    const m = await t.api.get("/api/metrics");
    expect(m.body.scope.storeIds).toBe("ALL");
    expect(m.body.investigated).toBeGreaterThanOrEqual(2);
  });

  it("solo plan: the fleet view is refused with a truthful upgrade message, and health reports the plan", async () => {
    const r = await t.api.get("/api/fleet");
    expect(r.status).toBe(403);
    expect(r.body.error).toBe("PLAN_REQUIRED");
    expect(r.body.message).toMatch(/Group plan.*Solo plan.*still fully usable/);
    const h = await t.api.get("/api/health");
    expect(h.body).toMatchObject({ plan: "solo", demoMode: "normal", notifications: { enabled: false }, optionalProblems: [] });
  });

  it("existing controls are never plan-gated", () => {
    // Only the new fleet surface has a gate; there is no Feature key for approvals, pauses or evidence.
    expect(planAllows("solo", "fleet_view")).toBe(false);
    expect(planAllows("group", "fleet_view")).toBe(true);
  });
});

describe("fleet view (group plan, scenario T)", () => {
  let t: Booted;
  beforeAll(async () => { t = await boot({ plan: "group" }); });
  afterAll(async () => { await t.close(); });

  it("lists exactly the stores the identity is assigned to, read-only", async () => {
    await t.api.load("T");
    const { delivery } = await t.api.emit();
    const area = await t.api.get("/api/fleet", "area-dee");
    expect(area.status).toBe(200);
    expect(area.body.stores.map((s: { storeId: string }) => s.storeId)).toEqual(["SYN-STORE-104", "SYN-STORE-205"]);
    const downtown = area.body.stores[0];
    expect(downtown.lastInvestigation.id).toBe(delivery.body.investigationId);
    expect(downtown.needsAttention).toBe(1);
    expect(downtown.campaign).toMatchObject({ campaignId: "cmp-syn-4081", configuredStatus: "CAMPAIGN_CONFIGURED_STATUS_ACTIVE" });
    const single = await t.api.get("/api/fleet", "mgr-cole");
    expect(single.body.stores.map((s: { storeId: string }) => s.storeId)).toEqual(["SYN-STORE-205"]);
    expect(await t.api.patchCount()).toBe(0);
  });

  it("store scope is still enforced on actions: Uptown's manager cannot approve Downtown", async () => {
    await t.api.load("T");
    const { delivery } = await t.api.emit();
    const r = await t.api.post(`/api/investigations/${delivery.body.investigationId}/approve`, {}, "mgr-cole");
    expect(r.status).toBe(403);
    // The area manager is assigned to Downtown and may approve it.
    const ok = await t.api.approveAndPause(delivery.body.investigationId, "area-dee");
    expect(ok.pause?.status).toBe(200);
    expect((await t.api.view(delivery.body.investigationId)).status).toBe("PAUSE_VERIFIED");
  });

  it("scenario A is unchanged by the existence of scenario T", async () => {
    await t.api.load("A");
    const users = (await t.api.get("/api/session")).body.users.map((u: { user_id: string }) => u.user_id);
    expect(users).not.toContain("area-dee");
  });
});
