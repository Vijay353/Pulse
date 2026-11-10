import { describe, expect, it } from "vitest";
import { calculateContribution, EXCLUSION_NOTE } from "../../apps/api/src/policy/contribution";
import { evaluatePolicy, AssessmentFacts } from "../../apps/api/src/policy/policyEngine";
import { signEvent, verifySignature } from "../../apps/api/src/security/signature";
import { mapServing } from "../../apps/api/src/adapters/ports";
import { toZonedIso } from "../../apps/api/src/clock";
import { findBannedClaim } from "../../packages/contracts/src/index";
import { openDb } from "../../apps/api/src/db/db";
import { appendAudit, verifyChain } from "../../apps/api/src/audit/audit";
import { simClock } from "../../apps/api/src/clock";

describe("contribution calculator (integer cents)", () => {
  const base = { attributedOrders: 10, attributedSalesCents: 28000, spendCents: 7800, avgFoodPackagingCostCents: 1140, marketplaceFeeRateBps: 2000, minContributionRateBps: 2000 };
  it("reproduces the spec fixture exactly: 28.00 − 5.60 − 11.40 − 7.80 = 3.20 (11.4%)", () => {
    const r = calculateContribution(base);
    if (!r.ok) throw new Error("expected ok");
    expect(r.perOrder).toEqual({ subtotalCents: 2800, feeCents: 560, foodCents: 1140, adCents: 780, contributionCents: 320 });
    expect(r.totals.contributionCents).toBe(3200);
    expect(r.rateBps).toBe(1143);
    expect(r.floorCentsPerOrder).toBe(560);
    expect(r.belowFloor).toBe(true);
    expect(r.exclusions).toBe(EXCLUSION_NOTE);
    expect(r.formula.join(" ")).not.toMatch(/profit\b(?! *\.)/i);
  });
  it("uses exact comparison at the boundary (exactly 20% is NOT below the floor)", () => {
    const r = calculateContribution({ ...base, spendCents: 7800 - 2400 }); // contribution 5600 / 28000 = 20.0%
    expect(r.ok && r.belowFloor).toBe(false);
  });
  it("abstains on missing or invalid inputs instead of guessing", () => {
    const r = calculateContribution({ ...base, avgFoodPackagingCostCents: null, attributedOrders: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toEqual(["attributed orders", "food & packaging cost"]);
  });
  it("handles negative contribution", () => {
    const r = calculateContribution({ ...base, spendCents: 20000 });
    expect(r.ok && r.totals.contributionCents).toBe(-9000);
    expect(r.ok && r.belowFloor).toBe(true);
  });
});

const passing = (): AssessmentFacts => ({
  signatureValid: true, eventAgeS: 0, maxEventAgeS: 120, mappingCount: 1, policyPresent: true, posAvailable: true, connectorHealth: "HEALTHY",
  snapshotAgeS: 23, maxSnapshotAgeS: 120, policyVersionAtStart: "p-v3", policyVersionNow: "p-v3", p95: 34, thresholdMinutes: 28,
  adsReadOk: true, adsReadError: null, eligibleCampaignIds: ["c1"], campaignPermissions: ["READ", "UPDATE"], reportPresent: true, reportAgeS: 703, maxReportAgeS: 900,
  contribution: calculateContribution({ attributedOrders: 10, attributedSalesCents: 28000, spendCents: 7800, avgFoodPackagingCostCents: 1140, marketplaceFeeRateBps: 2000, minContributionRateBps: 2000 }),
  agent: { schemaValid: true, citationsResolve: true, problems: [], action: "PAUSE_SPONSORED_LISTING", campaignId: "c1" },
  investigatorAvailable: true, investigatorProblem: null,
});

describe("policy engine ordering", () => {
  it("all checks pass → RECOMMEND_PAUSE with approval and re-read pending", () => {
    const o = evaluatePolicy(passing());
    expect(o.code).toBe("RECOMMEND_PAUSE");
    expect(o.checks.filter((c) => c.outcome === "FAIL")).toHaveLength(0);
    expect(o.checks.at(-2)!.id).toBe("human_approval");
  });
  it.each<[string, Partial<AssessmentFacts>, string]>([
    ["stale event", { eventAgeS: 121 }, "BLOCKED_STALE_EVENT"],
    ["mapping", { mappingCount: 2 }, "NEEDS_REVIEW_STORE_MAPPING"],
    ["pos degraded", { connectorHealth: "DEGRADED" }, "BLOCKED_POS_UNAVAILABLE"],
    ["snapshot boundary", { snapshotAgeS: 121 }, "BLOCKED_STALE_KITCHEN_DATA"],
    ["policy changed", { policyVersionNow: "p-v4" }, "BLOCKED_POLICY_CHANGED"],
    ["below threshold", { p95: 27.9 }, "NO_ACTION_BELOW_THRESHOLD"],
    ["two campaigns", { eligibleCampaignIds: ["c1", "c2"] }, "NEEDS_REVIEW_CAMPAIGN_SELECTION"],
    ["read only", { campaignPermissions: ["READ"] }, "BLOCKED_MISSING_PERMISSION"],
    ["ads stale", { reportAgeS: 901 }, "NEEDS_REVIEW_STALE_ADS_DATA"],
    ["agent fabricated", { agent: { schemaValid: true, citationsResolve: false, problems: ["x"], action: "PAUSE_SPONSORED_LISTING", campaignId: "c1" } }, "BLOCKED_INVALID_AGENT_OUTPUT"],
    ["agent picks other campaign", { agent: { schemaValid: true, citationsResolve: true, problems: [], action: "PAUSE_SPONSORED_LISTING", campaignId: "c9" } }, "NEEDS_REVIEW_AGENT_ABSTAINED"],
  ])("%s → %s", (_n, patch, code) => {
    const o = evaluatePolicy({ ...passing(), ...patch });
    expect(o.code).toBe(code);
    const failIdx = o.checks.findIndex((c) => c.outcome === "FAIL");
    expect(o.checks.slice(failIdx + 1, -2).every((c) => c.outcome === "SKIPPED")).toBe(true);
  });
  it("threshold is inclusive (p95 == limit breaches)", () => {
    expect(evaluatePolicy({ ...passing(), p95: 28 }).code).toBe("RECOMMEND_PAUSE");
  });
});

describe("security and mapping helpers", () => {
  it("HMAC signature verifies and detects tampering", () => {
    const ev: Record<string, unknown> = { eventId: "e1", storeId: "s", observedP95PrepMinutes: 34 };
    ev.signature = signEvent(ev, "secret");
    expect(verifySignature(ev, "secret")).toBe(true);
    expect(verifySignature({ ...ev, observedP95PrepMinutes: 35 }, "secret")).toBe(false);
    expect(verifySignature(ev, "other")).toBe(false);
    expect(verifySignature({ ...ev, signature: "fixture-valid" }, "secret")).toBe(false);
  });
  it("effective status mapping fails closed on unknown values", () => {
    expect(mapServing("CAMPAIGN_EFFECTIVE_STATUS_PAUSED")).toBe("NOT_SERVING");
    expect(mapServing("CAMPAIGN_EFFECTIVE_STATUS_ELIGIBLE")).toBe("SERVING");
    expect(mapServing("CAMPAIGN_EFFECTIVE_STATUS_SOMETHING_NEW")).toBe("UNKNOWN");
  });
  it("banned claims are detected; neutral language passes", () => {
    expect(findBannedClaim("This saves $40 tonight")).not.toBeNull();
    expect(findBannedClaim("guaranteed profit")).not.toBeNull();
    expect(findBannedClaim("Recent estimated contribution is below the configured floor.")).toBeNull();
  });
  it("time-zone aware ISO formatting", () => {
    expect(toZonedIso(Date.parse("2026-10-18T22:31:43Z"), "America/New_York")).toBe("2026-10-18T18:31:43-04:00");
    expect(toZonedIso(Date.parse("2026-12-18T22:31:43Z"), "America/New_York")).toBe("2026-12-18T17:31:43-05:00");
  });
});

describe("audit log", () => {
  it("is hash-chained and append-only at the database level", () => {
    const db = openDb(":memory:");
    const clock = simClock(db);
    appendAudit(db, clock, { investigationId: "i", type: "A", actor: "x", payload: { n: 1 } });
    appendAudit(db, clock, { investigationId: "i", type: "B", actor: "x", payload: { n: 2 } });
    expect(verifyChain(db)).toMatchObject({ ok: true, length: 2 });
    expect(() => db.exec("UPDATE mp_audit SET actor = 'evil'")).toThrow(/append-only/);
    expect(() => db.exec("DELETE FROM mp_audit")).toThrow(/append-only/);
  });
});
