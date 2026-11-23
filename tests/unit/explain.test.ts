/** CH-8: the explainer prints only values from executed checks and falls back when a check is absent. */
import { describe, expect, it } from "vitest";
import { explainVerdict, ExplainCheck } from "../../packages/contracts/src/explain";
import { findBannedClaim } from "../../packages/contracts/src/index";

const pass = (id: string, observed: string, required: string): ExplainCheck => ({ id, label: id, outcome: "PASS", observed, required });
const fail = (id: string, observed: string, required: string): ExplainCheck => ({ id, label: id, outcome: "FAIL", observed, required, failureCode: "X" });

describe("explainVerdict", () => {
  it("RECOMMEND_PAUSE uses the observed P95 and contribution values", () => {
    const e = explainVerdict({
      status: "AWAITING_APPROVAL", decisionCode: "RECOMMEND_PAUSE",
      policyChecks: [pass("threshold", "P95 34 min", "≥ 28 min"), pass("contribution_floor", "11.4%", "< 20%")],
      contribution: { ok: true, perOrder: { contributionCents: 320 }, floorCentsPerOrder: 560, rateBps: 1140, minRateBps: 2000 },
      evidenceMatrix: { checks: [{ checkId: "threshold", evidenceRefs: ["ev-1"] }, { checkId: "contribution_floor", evidenceRefs: ["ev-2", "ev-1"] }] },
    });
    expect(e.source).toBe("checks");
    expect(e.detail).toBe("Kitchen prep time (P95) is 34 min, over your 28 min limit. This campaign's estimated contribution is 11.4% per attributed order ($3.20 against a $5.60 floor), below your 20% floor.");
    expect(e.evidenceIds).toEqual(["ev-1", "ev-2"]);
  });

  it("falls back to the generic text when a referenced check is absent (never invents)", () => {
    const e = explainVerdict({ status: "AWAITING_APPROVAL", decisionCode: "RECOMMEND_PAUSE", policyChecks: [pass("threshold", "P95 34 min", "≥ 28 min")] });
    expect(e.source).toBe("generic");
    expect(e.detail).toBe("Open the evidence checks below for details.");
    expect(e.detail).not.toMatch(/34/);
  });

  it("falls back when the check row lacks the values the sentence needs", () => {
    const e = explainVerdict({ status: "BLOCKED", decisionCode: "BLOCKED_STALE_KITCHEN_DATA", policyChecks: [{ id: "snapshot_freshness", label: "x", outcome: "FAIL" }] });
    expect(e.source).toBe("generic");
  });

  it("stale kitchen data is stated with both values in minutes", () => {
    const e = explainVerdict({ status: "BLOCKED", decisionCode: "BLOCKED_STALE_KITCHEN_DATA", policyChecks: [fail("snapshot_freshness", "6 min", "≤ 120 s")] });
    expect(e.detail).toBe("The kitchen report is 6 min old; your policy accepts at most 2 min.");
  });

  it("an execution-time block explains the failed execution check", () => {
    const e = explainVerdict({ status: "BLOCKED", decisionCode: "BLOCKED_CONTEXT_CHANGED", policyChecks: [], result: { executionChecks: [{ id: "approval_exists", ok: true, detail: "apr-1" }, { id: "prewrite_reread", ok: false, detail: "version 13, expected 12" }] } });
    expect(e.detail).toMatch(/^A final re-read of the campaign did not match what you reviewed \(version 13, expected 12\)/);
  });

  it("no generated sentence contains a banned claim", () => {
    const samples = [
      explainVerdict({ status: "NO_ACTION", decisionCode: "NO_ACTION_CONTRIBUTION_OK", policyChecks: [pass("threshold", "P95 34 min", "≥ 28 min"), fail("contribution_floor", "28.6%", "< 20%")] }),
      explainVerdict({ status: "DISMISSED", decisionCode: "DISMISSED_BY_MANAGER", policyChecks: [], dismissReason: "Rush is clearing" }),
    ];
    for (const s of samples) expect(findBannedClaim(`${s.headline} ${s.detail}`)).toBeNull();
  });
});
