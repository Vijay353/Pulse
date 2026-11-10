/**
 * CH-2: a POS that answers with the wrong shape is treated as unavailable or
 * missing, never as zeros. A fake POS server stands in for the real one;
 * the webhook still comes from the in-process mock POS.
 */
import Fastify, { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { boot, Booted } from "../helpers";

let fake: FastifyInstance;
let fakeUrl = "";
let t: Booted | null = null;
let snapshotBody: unknown;
let costBody: unknown;

beforeEach(async () => {
  fake = Fastify();
  fake.get("/mock-pos/stores/:id", async () => ({ storeId: "SYN-STORE-104", name: "Fake POS store", timezone: "America/New_York" }));
  fake.get("/mock-pos/stores/:id/kitchen-snapshot", async () => snapshotBody);
  fake.get("/mock-pos/stores/:id/cost-profile", async () => costBody);
  fake.get("/mock-pos/admin/digest", async () => ({ digest: "fake" }));
  fakeUrl = await fake.listen({ port: 0, host: "127.0.0.1" });
  snapshotBody = { snapshotId: "kds-snap-812", storeId: "SYN-STORE-104", capturedAt: "2026-10-18T18:31:20-04:00", p95PrepMinutes: 34, activeTickets: 18, connectorHealth: "HEALTHY" };
  costBody = { storeId: "SYN-STORE-104", avgFoodPackagingCostCents: 1140, marketplaceFeeRateBps: 2000, updatedAt: "2026-10-18T18:31:43-04:00" };
});
afterEach(async () => { await t?.close(); t = null; await fake.close(); });

async function run() {
  t = await boot({ posBaseUrl: fakeUrl });
  await t.api.load("A");
  const { delivery } = await t.api.emit();
  return t.api.view(delivery.body.investigationId);
}

describe("malformed POS payloads fail closed", () => {
  it("control: a well-formed fake POS gives the normal recommendation", async () => {
    const v = await run();
    expect(v.decisionCode).toBe("RECOMMEND_PAUSE");
    expect(v.store.name).toBe("Fake POS store");
  });

  it("P95 sent as a string blocks as POS unavailable", async () => {
    snapshotBody = { ...(snapshotBody as object), p95PrepMinutes: "34" };
    const v = await run();
    expect(v.decisionCode).toBe("BLOCKED_POS_UNAVAILABLE");
    expect(v.actions.canApprove).toBe(false);
    expect((await t!.api.campaign()).version).toBe(12); // no PATCH reached the campaign
  });

  it("an empty snapshot body blocks; nothing defaults to zero", async () => {
    snapshotBody = {};
    const v = await run();
    expect(v.decisionCode).toBe("BLOCKED_POS_UNAVAILABLE");
    expect(v.kitchen).toBeNull();
  });

  it("a cost profile with a text fee rate routes to cost-data review", async () => {
    costBody = { ...(costBody as object), marketplaceFeeRateBps: "20%" };
    const v = await run();
    expect(v.decisionCode).toBe("NEEDS_REVIEW_COST_DATA");
  });
});
