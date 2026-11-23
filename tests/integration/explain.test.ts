/** CH-8: every scenario's decision gets an explanation built from its own executed checks, never a generic one. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { boot, Booted } from "../helpers";
import { SCENARIOS } from "../../packages/fixtures/src/scenarios";
import { explainVerdict } from "../../packages/contracts/src/explain";
import { findBannedClaim } from "../../packages/contracts/src/index";

let t: Booted;
beforeAll(async () => { t = await boot(); });
afterAll(async () => { await t.close(); });

describe("explanations for scenarios A–S", () => {
  it.each(SCENARIOS.map((s) => s.id))("scenario %s", async (id) => {
    await t.api.load(id);
    const { delivery } = await t.api.emit();
    if (!delivery.body.investigationId) return; // N: forged webhook never creates an investigation
    const v = await t.api.view(delivery.body.investigationId);
    const e = explainVerdict(v);
    expect(e.source, `${id} ${v.decisionCode}`).toBe("checks");
    expect(findBannedClaim(`${e.headline} ${e.detail}`)).toBeNull();
    // The sentence quotes at least one observed value from a check it used.
    const observed = v.policyChecks.filter((c: any) => e.checkIds.includes(c.id)).map((c: any) => String(c.observed ?? ""));
    const digits = observed.flatMap((o: string) => o.match(/\d+(\.\d+)?/g) ?? []);
    if (digits.length) expect(digits.some((d: string) => e.detail!.includes(d))).toBe(true);
  });

  it("A after approval and pause: explanation comes from the verified readback", async () => {
    await t.api.load("A");
    const { delivery } = await t.api.emit();
    await t.api.approveAndPause(delivery.body.investigationId);
    const e = explainVerdict(await t.api.view(delivery.body.investigationId));
    expect(e.detail).toBe("A readback shows the campaign paused and not serving, version 13. It stays paused until someone resumes it.");
  });

  it("G after an external edit: explanation names the failed execution check", async () => {
    await t.api.load("A");
    const { delivery } = await t.api.emit();
    const id = delivery.body.investigationId;
    const a = await t.api.post(`/api/investigations/${id}/approve`);
    await t.api.post("/mock-ads/simulate/external-edit", { campaign_id: "cmp-syn-4081" });
    await t.api.post(`/api/investigations/${id}/pause-campaign`, { approvalId: a.body.approvalId });
    const v = await t.api.view(id);
    expect(v.status).toBe("BLOCKED");
    const e = explainVerdict(v);
    expect(e.source).toBe("checks");
    expect(e.headline).toBe("The pause was stopped before anything was sent.");
  });
});
