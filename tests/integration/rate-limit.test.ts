/** CH-5: mutating routes are rate limited per demo identity + address; reads and other identities are not affected. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { boot, Booted } from "../helpers";

let t: Booted;
beforeAll(async () => { t = await boot({ mutationRateLimitPerMin: 30 }); });
afterAll(async () => { await t.close(); });

describe("mutation rate limit", () => {
  it("a burst of 40 pause attempts: the first 30 are processed, the rest get 429, and no extra write happens", async () => {
    await t.api.load("A");
    const { delivery } = await t.api.emit();
    const id = delivery.body.investigationId;
    const statuses: number[] = [];
    for (let i = 0; i < 40; i++) statuses.push((await t.api.post(`/api/investigations/${id}/pause-campaign`, { approvalId: "apr-none" })).status);
    expect(statuses.slice(0, 30).every((s) => s !== 429)).toBe(true);
    expect(statuses.slice(30).every((s) => s === 429)).toBe(true);
    const r = await t.api.post(`/api/investigations/${id}/approve`);
    expect(r.status).toBe(429);
    expect(r.body.error).toBe("RATE_LIMITED");
    expect(r.body.message).toMatch(/Nothing was changed by this request/);
    expect(await t.api.patchCount()).toBe(0);
    // Reads are never limited.
    expect((await t.api.get(`/api/investigations/${id}`)).status).toBe(200);
    // Another identity has its own budget (it is refused for authorization, not for rate).
    const staff = await t.api.post(`/api/investigations/${id}/approve`, {}, "staff-ben");
    expect(staff.status).toBe(403);
  });
});
