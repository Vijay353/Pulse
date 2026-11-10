/** CH-13: viewer block tells the UI who may approve; the server still enforces it. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { boot, Booted } from "../helpers";

let t: Booted;
beforeAll(async () => { t = await boot(); });
afterAll(async () => { await t.close(); });

describe("viewer and eligible approvers", () => {
  it("lists the store's managers and marks whether the viewer is one", async () => {
    await t.api.load("A");
    const { delivery } = await t.api.emit();
    const id = delivery.body.investigationId;
    const asAna = (await t.api.get(`/api/investigations/${id}`, "mgr-ana")).body;
    expect(asAna.eligibleApprovers).toEqual([{ userId: "mgr-ana", displayName: "Ana Reyes (synthetic shift manager)" }]);
    expect(asAna.viewer).toMatchObject({ userId: "mgr-ana", canApproveHere: true });
    const asBen = (await t.api.get(`/api/investigations/${id}`, "staff-ben")).body;
    expect(asBen.viewer).toMatchObject({ userId: "staff-ben", role: "STAFF", canApproveHere: false });
    const asCole = (await t.api.get(`/api/investigations/${id}`, "mgr-cole")).body;
    expect(asCole.viewer).toMatchObject({ role: "MANAGER", canApproveHere: false });
    expect(asBen.actions).toEqual(asAna.actions); // actions stay viewer-independent
  });

  it("the viewer hint is not authority: a forged header still fails at the server", async () => {
    await t.api.load("A");
    const { delivery } = await t.api.emit();
    const id = delivery.body.investigationId;
    expect((await t.api.post(`/api/investigations/${id}/approve`, {}, "staff-ben")).status).toBe(403);
    expect((await t.api.post(`/api/investigations/${id}/approve`, {}, "mgr-cole")).status).toBe(403);
    expect((await t.api.post(`/api/investigations/${id}/approve`, {}, "nobody")).status).toBe(401);
    expect((await t.api.get(`/api/investigations/${id}`, "nobody")).body.viewer).toBeNull();
    expect(await t.api.patchCount()).toBe(0);
  });
});
