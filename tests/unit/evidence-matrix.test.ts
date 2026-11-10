/** CH-19: pure mapping from stored check records to matrix rows. */
import { describe, expect, it } from "vitest";
import { buildEvidenceMatrix } from "../../apps/api/src/policy/evidenceMatrix";

const base = {
  eventId: "evt-1", candidateCampaignId: "cmp-1", approvalIds: [] as string[], requestIds: [] as string[],
  decidedAt: "2026-10-18T18:31:43-04:00", executedAt: null as string | null, ruleVersion: "p-v3",
  evidence: [
    { evidenceId: "snap-1", kind: "KITCHEN_SNAPSHOT", payload: {} },
    { evidenceId: "pol-1", kind: "POLICY", payload: {} },
    { evidenceId: "cmp-a", kind: "CAMPAIGN", payload: { campaignId: "cmp-1" } },
    { evidenceId: "cmp-b", kind: "CAMPAIGN", payload: { campaignId: "cmp-2" } },
  ],
  executionChecks: null as { id: string; ok: boolean; detail: string }[] | null,
};

describe("buildEvidenceMatrix", () => {
  it("maps PASS/FAIL/SKIPPED and never gives evidence to a skipped check", () => {
    const m = buildEvidenceMatrix({ ...base, policyChecks: [
      { id: "threshold", label: "T", outcome: "PASS", observed: "34", required: "28" },
      { id: "snapshot_freshness", label: "S", outcome: "FAIL", failureCode: "BLOCKED_STALE" },
      { id: "contribution_floor", label: "C", outcome: "SKIPPED" },
    ] });
    const by = Object.fromEntries(m.checks.map((c) => [c.checkId, c]));
    expect(by.threshold).toMatchObject({ status: "PASS", evidenceRefs: ["snap-1", "pol-1"], evaluatedAt: base.decidedAt, ruleVersion: "p-v3" });
    expect(by.snapshot_freshness!.status).toBe("FAIL");
    expect(by.snapshot_freshness!.detail).toContain("BLOCKED_STALE");
    expect(by.contribution_floor).toMatchObject({ status: "NOT_EVALUATED", evidenceRefs: [], evaluatedAt: undefined });
  });

  it("only links the candidate campaign's evidence to the permission check", () => {
    const m = buildEvidenceMatrix({ ...base, policyChecks: [{ id: "campaign_permission", label: "P", outcome: "PASS" }] });
    expect(m.checks.find((c) => c.checkId === "campaign_permission")!.evidenceRefs).toEqual(["cmp-a"]);
  });

  it("no repeat check record means NOT_EVALUATED, not PASS", () => {
    const m = buildEvidenceMatrix({ ...base, policyChecks: [] });
    expect(m.checks.find((c) => c.checkId === "repeat_alert")!.status).toBe("NOT_EVALUATED");
  });

  it("flagged repeat check is WARN", () => {
    const m = buildEvidenceMatrix({ ...base, policyChecks: [], evidence: [...base.evidence, { evidenceId: "rc", kind: "REPEAT_CHECK", payload: { flagged: true, prior: { investigationId: "inv-1" } } }] });
    const r = m.checks.find((c) => c.checkId === "repeat_alert")!;
    expect(r).toMatchObject({ status: "WARN", evidenceRefs: ["rc"] });
    expect(m.summary.warned).toBe(1);
  });

  it("execution rows: approval aggregates, failure reported, missing rows not evaluated; summary counts add up", () => {
    const m = buildEvidenceMatrix({ ...base, policyChecks: [], approvalIds: ["apr-1"], requestIds: ["req-1"], executedAt: "x",
      executionChecks: [{ id: "approval_actor", ok: true, detail: "ok" }, { id: "approval_expiry", ok: false, detail: "expired" }, { id: "policy_unchanged", ok: true, detail: "p-v3" }] });
    const by = Object.fromEntries(m.checks.map((c) => [c.checkId, c]));
    expect(by.human_approval).toMatchObject({ status: "FAIL", evidenceRefs: ["approval:apr-1"] });
    expect(by.human_approval!.detail).toContain("approval_expiry");
    expect(by.policy_unchanged!.status).toBe("PASS");
    expect(by.prewrite_reread).toMatchObject({ status: "NOT_EVALUATED", evidenceRefs: [] });
    expect(by.warnings_acknowledged).toBeUndefined();
    const s = m.summary;
    expect(s.passed + s.warned + s.failed + s.notEvaluated).toBe(m.checks.length);
    expect(m.checks.every((c) => c.blocksAutoAction)).toBe(true);
  });
});
