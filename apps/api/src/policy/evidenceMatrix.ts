/**
 * Evidence verification matrix (V3 CH-19). Derived from persisted records of
 * checks that actually ran: the decision checks stored at assessment, the
 * execution checks stored at approval time, and the repeat-alert check.
 * Nothing is recomputed here, so the matrix cannot disagree with the trace.
 */
import type { EvidenceCheck, EvidenceMatrix, PolicyCheck } from "../../../../packages/contracts/src/index";

interface Ev { evidenceId: string; kind: string; payload: unknown }
interface ExecCheck { id: string; ok: boolean; detail: string }

const REFS: Record<string, string[]> = {
  policy_present: ["POLICY"], guardrail_version: ["POLICY"], event_freshness: ["POLICY"],
  store_mapping: ["STORE_MAPPING"],
  pos_health: ["KITCHEN_SNAPSHOT"], snapshot_freshness: ["KITCHEN_SNAPSHOT", "POLICY"], threshold: ["KITCHEN_SNAPSHOT", "POLICY"],
  ads_read: ["CAMPAIGN_LIST"], campaign_count: ["CAMPAIGN_LIST"], campaign_permission: ["CAMPAIGN"],
  report_freshness: ["CAMPAIGN_REPORT", "POLICY"],
  contribution_inputs: ["CALCULATION", "COST_PROFILE", "CAMPAIGN_REPORT"], contribution_floor: ["CALCULATION", "POLICY"],
};

export function buildEvidenceMatrix(args: {
  eventId: string;
  candidateCampaignId: string | null;
  policyChecks: PolicyCheck[];
  executionChecks: ExecCheck[] | null;
  evidence: Ev[];
  approvalIds: string[];
  requestIds: string[];
  decidedAt: string | null;
  executedAt: string | null;
  ruleVersion: string | null;
}): EvidenceMatrix {
  const refsFor = (checkId: string): string[] => {
    const out: string[] = [];
    if (checkId.startsWith("event_")) out.push(`event:${args.eventId}`);
    for (const kind of REFS[checkId] ?? []) {
      const rows = args.evidence.filter((e) => e.kind === kind && (kind !== "CAMPAIGN" || (e.payload as { campaignId?: string })?.campaignId === args.candidateCampaignId));
      out.push(...rows.map((r) => r.evidenceId));
    }
    return [...new Set(out)];
  };
  const base = (c: { checkId: string; label: string }) => ({ ...c, ruleVersion: args.ruleVersion ?? undefined, blocksAutoAction: true });

  const checks: EvidenceCheck[] = [];
  for (const c of args.policyChecks) {
    if (c.id === "human_approval" || c.id === "prewrite_reread") continue; // reported from execution records below
    checks.push({
      ...base({ checkId: c.id, label: c.label }),
      status: c.outcome === "PASS" ? "PASS" : c.outcome === "FAIL" ? "FAIL" : "NOT_EVALUATED",
      evidenceRefs: c.outcome === "SKIPPED" ? [] : refsFor(c.id),
      detail: c.outcome === "SKIPPED" ? "Not evaluated: an earlier check decided the outcome." : `Observed ${c.observed ?? "n/a"}; required ${c.required ?? "n/a"}.${c.failureCode ? ` Result ${c.failureCode}.` : ""}`,
      evaluatedAt: c.outcome === "SKIPPED" ? undefined : args.decidedAt ?? undefined,
    });
  }

  const repeat = args.evidence.find((e) => e.kind === "REPEAT_CHECK");
  const rp = repeat?.payload as { flagged?: boolean; prior?: { investigationId: string }; compared?: number } | undefined;
  checks.push({
    ...base({ checkId: "repeat_alert", label: "Possible repeat alert" }),
    status: !repeat ? "NOT_EVALUATED" : rp?.flagged ? "WARN" : "PASS",
    evidenceRefs: repeat ? [repeat.evidenceId] : [],
    detail: !repeat ? "Not evaluated." : rp?.flagged ? `Same kitchen snapshot as ${rp.prior?.investigationId}. Approval requires an explicit confirmation.` : `Compared with ${rp?.compared ?? 0} earlier alert(s); no repeat found.`,
    evaluatedAt: repeat ? args.decidedAt ?? undefined : undefined,
  });

  const ex = args.executionChecks;
  const group = (ids: (c: ExecCheck) => boolean) => (ex ?? []).filter(ids);
  const approvalRows = group((c) => c.id.startsWith("approval_"));
  const approvalFail = approvalRows.find((c) => !c.ok);
  checks.push({
    ...base({ checkId: "human_approval", label: "Manager approval matches" }),
    status: approvalRows.length === 0 ? "NOT_EVALUATED" : approvalFail ? "FAIL" : "PASS",
    evidenceRefs: approvalRows.length ? args.approvalIds.map((a) => `approval:${a}`) : [],
    detail: approvalRows.length === 0 ? "Not evaluated: no pause has been attempted." : approvalFail ? `Failed ${approvalFail.id}: ${approvalFail.detail}.` : `All ${approvalRows.length} approval conditions matched.`,
    evaluatedAt: approvalRows.length ? args.executedAt ?? undefined : undefined,
  });
  for (const [id, label] of [["warnings_acknowledged", "Warnings acknowledged"], ["policy_unchanged", "Policy unchanged since the recommendation"], ["recommendation_fresh", "Recommendation still fresh"], ["prewrite_reread", "Campaign re-read just before the write"]] as const) {
    const row = (ex ?? []).find((c) => c.id === id);
    if (id === "warnings_acknowledged" && !row) continue; // only exists when a warning was raised
    checks.push({
      ...base({ checkId: id, label }),
      status: !row ? "NOT_EVALUATED" : row.ok ? "PASS" : "FAIL",
      evidenceRefs: row && id === "prewrite_reread" ? args.requestIds.map((r) => `request:${r}`) : [],
      detail: !row ? "Not evaluated: runs only when a manager sends the pause." : row.detail,
      evaluatedAt: row ? args.executedAt ?? undefined : undefined,
    });
  }

  const summary = { passed: 0, warned: 0, failed: 0, notEvaluated: 0 };
  for (const c of checks) {
    if (c.status === "PASS") summary.passed++;
    else if (c.status === "WARN") summary.warned++;
    else if (c.status === "FAIL") summary.failed++;
    else summary.notEvaluated++;
  }
  return { summary, checks };
}
