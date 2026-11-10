/**
 * CH-1: domain reads go through ports, not around them.
 *  - architecture guard: decision-path code never queries simulator tables
 *  - adapter contract tests for the new port reads
 *  - patchCountForCampaign counts this campaign only (was a global count)
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { boot, Booted } from "../helpers";
import { HttpUberAdsAdapter } from "../../apps/api/src/adapters/http";

/** Files allowed to touch simulator tables, with the reason recorded in docs/ARCHITECTURE.md. */
const ALLOWED: Record<string, string> = {
  "apps/api/src/db/db.ts": "schema owner for the shared SQLite file",
  "apps/api/src/imports/importer.ts": "data studio seeds simulators inside one SQLite transaction (approved exception)",
  "apps/api/src/orchestration/world.ts": "scenario reset arms simulator faults (approved exception)",
};
const SIM_TABLE_SQL = /\b(FROM|INTO|UPDATE|JOIN|TABLE)\s+(ads|pos)_[a-z_]+/i;

function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

describe("architecture guard", () => {
  it("only the owning modules and approved exceptions query simulator tables", () => {
    const offenders = walk("apps/api/src")
      .filter((f) => !ALLOWED[f])
      .flatMap((f) => readFileSync(f, "utf8").split("\n").map((line, i) => ({ f, i: i + 1, line })))
      .filter(({ line }) => SIM_TABLE_SQL.test(line))
      .map(({ f, i, line }) => `${f}:${i}: ${line.trim()}`);
    expect(offenders).toEqual([]);
  });
});

let t: Booted;
beforeAll(async () => { t = await boot(); });
afterAll(async () => { await t.close(); });

describe("adapter contracts (simulated)", () => {
  it("lists ad accounts through the documented path", async () => {
    await t.api.load("A");
    const r = await t.ads.listAdAccounts();
    expect(r.ok && r.value).toEqual([
      { accountId: "SYN-AD-221", name: "Juniper Downtown Ads (synthetic)", currency: "USD" },
      { accountId: "SYN-AD-305", name: "Juniper Uptown Ads (synthetic)", currency: "USD" },
    ]);
  });

  it("reads the store profile from the POS, not from its tables", async () => {
    await t.api.load("A");
    const r = await t.pos.getStoreProfile("SYN-STORE-104");
    expect(r).toEqual({ ok: true, value: { storeId: "SYN-STORE-104", name: "Juniper Pizza — Downtown", timezone: "America/New_York" } });
    const missing = await t.pos.getStoreProfile("SYN-STORE-999");
    expect(missing.ok).toBe(false);
  });

  it("store profile reads do not consume armed POS outage faults", async () => {
    await t.api.load("A");
    await t.api.post("/mock-pos/faults", { mode: "POS_UNAVAILABLE", remaining: 1 });
    expect((await t.pos.getStoreProfile("SYN-STORE-104")).ok).toBe(true);
    expect((await t.pos.getKitchenSnapshot("SYN-STORE-104")).ok).toBe(false);
  });

  it("change log is filtered to one campaign", async () => {
    await t.api.load("A");
    await t.api.post("/mock-ads/simulate/external-edit", { campaign_id: "cmp-syn-5120" });
    const log = await t.ads.getCampaignChangeLog("SYN-AD-221", "cmp-syn-4081");
    expect(log).toEqual({ available: true, value: [] });
    const other = await t.ads.getCampaignChangeLog("SYN-AD-305", "cmp-syn-5120");
    expect(other.available && other.value.map((c) => c.source)).toEqual(["EXTERNAL_SIM"]);
  });

  it("view model and simulator state keep their shapes", async () => {
    await t.api.load("A");
    const { delivery } = await t.api.emit();
    const v = await t.api.view(delivery.body.investigationId);
    expect(v.store).toEqual({ posStoreId: "SYN-STORE-104", name: "Juniper Pizza — Downtown", timezone: "America/New_York", uberStoreId: "UE-SYN-104", accountId: "SYN-AD-221" });
    const s = (await t.api.get("/api/sim/state")).body;
    expect(Object.keys(s)).toEqual(expect.arrayContaining(["clock", "scenario", "adsFaults", "posFaults", "campaigns", "outbox", "ledger", "requests", "patchCount", "rejectedEvents", "policies", "latestInvestigation"]));
    expect(s.simulator).toBe("AVAILABLE");
    expect(s.campaigns.map((c: any) => c.campaignId)).toEqual(["cmp-syn-3990", "cmp-syn-4081", "cmp-syn-5120"]);
    expect(s.outbox[0]).toMatchObject({ event_id: "evt-kds-1831-001", delivery_count: 1, last_status: 202 });
  });
});

describe("patchCountForCampaign is per campaign", () => {
  it("counts applied changes to the paused campaign only, not every PATCH received", async () => {
    await t.api.load("A");
    await t.api.post("/mock-ads/faults", { op: "PATCH_CAMPAIGNS", mode: "DROP_BEFORE_APPLY" });
    const { delivery } = await t.api.emit();
    const id = delivery.body.investigationId;
    const { approve } = await t.api.approveAndPause(id);
    // An unrelated PATCH to another account's campaign
    await fetch(`${t.base}/v1/ads/SYN-AD-305/campaigns`, {
      method: "PATCH",
      headers: { authorization: `Bearer ${t.config.adsToken}`, "content-type": "application/json" },
      body: JSON.stringify({ campaigns: [{ campaign_id: "cmp-syn-5120", configured_status: "CAMPAIGN_CONFIGURED_STATUS_PAUSED" }] }),
    });
    await t.api.post(`/api/investigations/${id}/pause-campaign`, { approvalId: approve.body.approvalId });
    const v = await t.api.view(id);
    expect(v.status).toBe("PAUSE_VERIFIED");
    expect(await t.api.patchCount()).toBe(3); // dropped + unrelated + retry
    expect(v.result.patchCountForCampaign).toBe(1);
    expect(v.result.targetLedger).toEqual([
      { request_id: "req-pause-4081-002", field: "configured_status", before_value: "CAMPAIGN_CONFIGURED_STATUS_ACTIVE", after_value: "CAMPAIGN_CONFIGURED_STATUS_PAUSED", version_before: 12, version_after: 13, source: "API" },
    ]);
  });
});

describe("non-simulated providers never fall back to simulator data", () => {
  let s: Booted | null = null;
  afterEach(async () => { await s?.close(); s = null; });

  it("a real-provider adapter reports the change log as unavailable", async () => {
    await t.api.load("A");
    const real = new HttpUberAdsAdapter(() => t.base, t.config.adsToken, { timeoutMs: 1000, simulated: false, label: "test real" });
    const log = await real.getCampaignChangeLog("SYN-AD-221", "cmp-syn-4081");
    expect(log.available).toBe(false);
  });

  it("SANDBOX without configuration: simulator state is NOT_CONFIGURED and empty", async () => {
    s = await boot({}, { env: { ADS_MODE: "SANDBOX" } });
    const st = (await s.api.get("/api/sim/state")).body;
    expect(st.simulator).toBe("NOT_CONFIGURED");
    expect(st.campaigns).toEqual([]);
    expect(st.patchCount).toBeNull();
    expect((await s.ads.getCampaignChangeLog("SYN-AD-221", "cmp-syn-4081")).available).toBe(false);
  });
});
