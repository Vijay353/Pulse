/** CH-8: store history in the investigation view, from real records. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { boot, Booted } from "../helpers";

let t: Booted;
beforeAll(async () => { t = await boot(); });
afterAll(async () => { await t.close(); });

describe("store history", () => {
  it("seeded scenario A has no prior history", async () => {
    await t.api.load("A");
    const { delivery } = await t.api.emit();
    expect((await t.api.view(delivery.body.investigationId)).storeHistory).toMatchObject({ windowDays: 90, alerts: 0, excludesCurrentAlert: true });
  });

  it("counts earlier alerts per store, once each, and not other stores", async () => {
    await t.api.load("A");
    const first = await t.api.emit();
    await t.api.post(`/api/investigations/${first.delivery.body.investigationId}/dismiss`, { reason: "Rush is clearing" });
    await t.api.emit("SYN-STORE-205"); // other store: not counted
    t.clock.advance(180); // the next alert sees a stale snapshot and is blocked
    const blocked = await t.api.emit();
    const re = await t.api.post(`/api/investigations/${blocked.delivery.body.investigationId}/reassess`);
    expect(re.status).toBe(200);
    const last = await t.api.emit();
    const v = await t.api.view(last.delivery.body.investigationId);
    expect(v.storeHistory).toMatchObject({ alerts: 2, keptActive: 1, blocked: 1, paused: 0, open: 0 });
  });

  it("alerts older than 90 days drop out", async () => {
    await t.api.load("A");
    await t.api.emit();
    t.clock.advance(90 * 86400 + 1);
    const later = await t.api.emit();
    expect((await t.api.view(later.delivery.body.investigationId)).storeHistory.alerts).toBe(0);
  });
});
