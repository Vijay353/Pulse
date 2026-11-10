/**
 * Deterministic decision policy (spec §12). Pure function of facts that were
 * read by tools and stored as evidence — never of the agent's prose.
 * Evaluated in order; the first failing check decides; later checks are SKIPPED.
 */
import type { PolicyCheck } from "../../../../packages/contracts/src/index";
import type { ContributionResult } from "./contribution";

export interface AssessmentFacts {
  signatureValid: boolean;
  eventAgeS: number;
  maxEventAgeS: number | null;
  mappingCount: number;
  policyPresent: boolean;
  posAvailable: boolean;
  connectorHealth: string | null;
  snapshotAgeS: number | null;
  maxSnapshotAgeS: number | null;
  policyVersionAtStart: string | null;
  policyVersionNow: string | null;
  p95: number | null;
  thresholdMinutes: number | null;
  adsReadOk: boolean;
  adsReadError: string | null;
  eligibleCampaignIds: string[];
  campaignPermissions: string[] | null;
  reportPresent: boolean;
  reportAgeS: number | null;
  maxReportAgeS: number | null;
  contribution: ContributionResult | null;
  agent: { schemaValid: boolean; citationsResolve: boolean; problems: string[]; action: string | null; campaignId: string | null };
  investigatorAvailable: boolean;
  investigatorProblem: string | null;
  /** Tool results that claimed success but failed their schema (V3 CH-2). Informational; the affected facts are already null. */
  readProblems?: string[];
}

export interface PolicyOutcome {
  decision: "RECOMMEND_PAUSE" | "NO_ACTION" | "NEEDS_REVIEW" | "BLOCKED";
  code: string;
  checks: PolicyCheck[];
}

type Step = {
  id: string;
  label: string;
  pass: (f: AssessmentFacts) => boolean;
  fail: string; // failure code
  observed: (f: AssessmentFacts) => string;
  required: (f: AssessmentFacts) => string;
};

const fmtAge = (s: number | null) => (s === null ? "unknown" : s < 120 ? `${s} s` : `${Math.round(s / 60)} min`);

export const STEPS: Step[] = [
  { id: "event_authenticity", label: "Event authenticity", pass: (f) => f.signatureValid, fail: "BLOCKED_INVALID_EVENT", observed: (f) => (f.signatureValid ? "signature valid" : "signature invalid"), required: () => "valid HMAC signature" },
  { id: "event_idempotency", label: "Event idempotency", pass: () => true, fail: "RETURN_PRIOR_RESULT", observed: () => "first delivery", required: () => "event not processed before" },
  { id: "investigator", label: "Investigator available", pass: (f) => f.investigatorAvailable, fail: "BLOCKED_INVESTIGATOR_UNAVAILABLE", observed: (f) => f.investigatorProblem ?? "available", required: () => "configured investigator" },
  { id: "policy_present", label: "Merchant guardrail present", pass: (f) => f.policyPresent, fail: "BLOCKED_NO_POLICY", observed: (f) => (f.policyPresent ? `${f.policyVersionAtStart}` : "no current policy"), required: () => "one current policy" },
  { id: "event_freshness", label: "Event freshness", pass: (f) => f.maxEventAgeS !== null && f.eventAgeS <= f.maxEventAgeS, fail: "BLOCKED_STALE_EVENT", observed: (f) => fmtAge(f.eventAgeS), required: (f) => `≤ ${f.maxEventAgeS ?? "?"} s` },
  { id: "store_mapping", label: "Store mapping", pass: (f) => f.mappingCount === 1, fail: "NEEDS_REVIEW_STORE_MAPPING", observed: (f) => `${f.mappingCount} Uber store mapping(s)`, required: () => "exactly 1" },
  { id: "pos_health", label: "POS connector health", pass: (f) => f.posAvailable && f.connectorHealth === "HEALTHY", fail: "BLOCKED_POS_UNAVAILABLE", observed: (f) => (f.posAvailable ? String(f.connectorHealth) : "unreachable"), required: () => "HEALTHY" },
  { id: "snapshot_freshness", label: "Kitchen snapshot freshness", pass: (f) => f.snapshotAgeS !== null && f.maxSnapshotAgeS !== null && f.snapshotAgeS <= f.maxSnapshotAgeS, fail: "BLOCKED_STALE_KITCHEN_DATA", observed: (f) => fmtAge(f.snapshotAgeS), required: (f) => `≤ ${f.maxSnapshotAgeS ?? "?"} s` },
  { id: "guardrail_version", label: "Guardrail version unchanged", pass: (f) => f.policyVersionAtStart === f.policyVersionNow, fail: "BLOCKED_POLICY_CHANGED", observed: (f) => `${f.policyVersionAtStart} → ${f.policyVersionNow}`, required: () => "same version" },
  { id: "threshold", label: "Kitchen threshold", pass: (f) => f.p95 !== null && f.thresholdMinutes !== null && f.p95 >= f.thresholdMinutes, fail: "NO_ACTION_BELOW_THRESHOLD", observed: (f) => `P95 ${f.p95 ?? "?"} min`, required: (f) => `≥ ${f.thresholdMinutes ?? "?"} min` },
  { id: "ads_read", label: "Uber Ads read", pass: (f) => f.adsReadOk, fail: "BLOCKED_ADS_UNAVAILABLE", observed: (f) => (f.adsReadOk ? "ok" : String(f.adsReadError)), required: () => "campaigns readable" },
  { id: "campaign_count", label: "Eligible active Sponsored Listings", pass: (f) => f.eligibleCampaignIds.length === 1, fail: "NEEDS_REVIEW_CAMPAIGN_SELECTION", observed: (f) => `${f.eligibleCampaignIds.length} (${f.eligibleCampaignIds.join(", ") || "none"})`, required: () => "exactly 1" },
  { id: "campaign_permission", label: "Campaign UPDATE permission", pass: (f) => !!f.campaignPermissions?.includes("UPDATE"), fail: "BLOCKED_MISSING_PERMISSION", observed: (f) => (f.campaignPermissions ?? []).join(", ") || "none", required: () => "UPDATE" },
  { id: "report_freshness", label: "Ads report watermark age", pass: (f) => f.reportPresent && f.reportAgeS !== null && f.maxReportAgeS !== null && f.reportAgeS <= f.maxReportAgeS, fail: "NEEDS_REVIEW_STALE_ADS_DATA", observed: (f) => (f.reportPresent ? fmtAge(f.reportAgeS) : "no report"), required: (f) => `≤ ${Math.round((f.maxReportAgeS ?? 0) / 60)} min` },
  { id: "contribution_inputs", label: "Contribution inputs present", pass: (f) => !!f.contribution?.ok, fail: "NEEDS_REVIEW_COST_DATA", observed: (f) => (f.contribution?.ok ? "complete" : `missing: ${f.contribution && !f.contribution.ok ? f.contribution.missing.join(", ") : "all"}`), required: () => "all present, non-negative" },
  { id: "contribution_floor", label: "Contribution below merchant floor", pass: (f) => !!(f.contribution?.ok && f.contribution.belowFloor), fail: "NO_ACTION_CONTRIBUTION_OK", observed: (f) => (f.contribution?.ok ? `${(f.contribution.rateBps / 100).toFixed(1)}%` : "n/a"), required: (f) => (f.contribution?.ok ? `< ${(f.contribution.minRateBps / 100).toFixed(0)}%` : "n/a") },
  { id: "agent_schema", label: "Agent output valid and cited", pass: (f) => f.agent.schemaValid && f.agent.citationsResolve, fail: "BLOCKED_INVALID_AGENT_OUTPUT", observed: (f) => (f.agent.problems.length ? f.agent.problems.slice(0, 2).join("; ") : "valid"), required: () => "schema-valid, citations resolve" },
  { id: "agent_action", label: "Agent proposes the catalog action", pass: (f) => f.agent.action === "PAUSE_SPONSORED_LISTING" && f.agent.campaignId === f.eligibleCampaignIds[0], fail: "NEEDS_REVIEW_AGENT_ABSTAINED", observed: (f) => `${f.agent.action} ${f.agent.campaignId ?? ""}`.trim(), required: (f) => `PAUSE_SPONSORED_LISTING ${f.eligibleCampaignIds[0] ?? ""}`.trim() },
];

export function decisionFromCode(code: string): PolicyOutcome["decision"] {
  if (code.startsWith("BLOCKED")) return "BLOCKED";
  if (code.startsWith("NEEDS_REVIEW")) return "NEEDS_REVIEW";
  if (code.startsWith("NO_ACTION")) return "NO_ACTION";
  return "RECOMMEND_PAUSE";
}

export function evaluatePolicy(f: AssessmentFacts): PolicyOutcome {
  const checks: PolicyCheck[] = [];
  let failed: string | null = null;
  for (const s of STEPS) {
    if (failed) {
      checks.push({ id: s.id, label: s.label, outcome: "SKIPPED" });
      continue;
    }
    const ok = s.pass(f);
    checks.push({ id: s.id, label: s.label, outcome: ok ? "PASS" : "FAIL", observed: s.observed(f), required: s.required(f), failureCode: ok ? undefined : s.fail });
    if (!ok) failed = s.fail;
  }
  // Execution-time checks are shown as pending until the manager acts.
  checks.push({ id: "human_approval", label: "Manager approval", outcome: "SKIPPED", observed: failed ? "not requested" : "awaiting manager", required: "matching approval" });
  checks.push({ id: "prewrite_reread", label: "Pre-write re-read", outcome: "SKIPPED", observed: failed ? "not applicable" : "runs at execution", required: "still ACTIVE, same version, store-scoped" });
  const code = failed ?? "RECOMMEND_PAUSE";
  return { decision: decisionFromCode(code), code, checks };
}
