/** CH-16: provenance shows only what is persisted; seeded policies have no author. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { boot, Booted } from "../helpers";
import { fixtures } from "../../scripts/workbook-fixtures";
import { STEPS } from "../../apps/api/src/policy/policyEngine";
import { provenanceLine } from "../../apps/web/src/state/format";

let t: Booted;
beforeAll(async () => { t = await boot(); });
afterAll(async () => { await t.close(); });

describe("policy provenance", () => {
  it("seeded policy: version and effective date, no invented author", async () => {
    await t.api.load("A");
    const { delivery } = await t.api.emit();
    const p = (await t.api.view(delivery.body.investigationId)).policyProvenance;
    expect(p).toEqual({ policyId: "policy-rush-control", version: "v3", effectiveFrom: "2026-10-01T00:00:00-04:00", checkCount: 18, changedBy: null, changedAt: null, changeSource: null });
    expect(STEPS).toHaveLength(18);
    expect(provenanceLine(p)).toBe("Merchant policy policy-rush-control-v3, effective Oct 1, 2026, runs 18 ordered checks. Provenance unavailable: no author was recorded for this version.");
  });

  it("a published policy version names who published it", async () => {
    await t.api.load("A");
    await t.api.post("/api/sim/policy/bump", { storeId: "SYN-STORE-104" });
    const { delivery } = await t.api.emit();
    expect((await t.api.view(delivery.body.investigationId)).policyProvenance).toMatchObject({ version: "v4", changedBy: "mgr-ana", changeSource: "POLICY_PUBLISHED" });
  });

  it("a policy changed through an import names the importer", async () => {
    await t.api.load("A");
    const fx = await fixtures();
    const s = await fetch(`${t.base}/api/session`);
    const cookie = (s.headers.get("set-cookie") ?? "").split(";")[0]!;
    const { csrfToken } = (await s.json()) as { csrfToken: string };
    const pv = (await (await fetch(`${t.base}/api/data/import/preview?filename=p.xlsx&mode=merge`, { method: "POST", headers: { "content-type": "application/octet-stream", cookie, "x-csrf-token": csrfToken, "x-demo-user": "mgr-ana" }, body: new Uint8Array(fx["valid/merge-threshold-40.xlsx"]!.buf) })).json()) as { batchId: string };
    await t.api.post(`/api/data/import/${pv.batchId}/commit`);
    const { delivery } = await t.api.emit();
    expect((await t.api.view(delivery.body.investigationId)).policyProvenance).toMatchObject({ version: "v3", changedBy: "mgr-ana", changeSource: "IMPORT" });
  });
});
