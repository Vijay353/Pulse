/**
 * Read model for the UI. Everything here is derived from persisted records
 * and one live read of the campaign from the Ads adapter — React holds no
 * duplicated business state.
 */
import { all, Db, get } from "../db/db";
import { ageSeconds, Clock } from "../clock";
import type { PosPort, UberAdsPort } from "../adapters/ports";
import { auditFor } from "../audit/audit";
import { EXCLUSION_NOTE } from "../policy/contribution";
import { summarizeHistory } from "./history";
import { STEPS } from "../policy/policyEngine";
import { buildEvidenceMatrix } from "../policy/evidenceMatrix";

const j = (v: unknown) => (v === null || v === undefined ? null : JSON.parse(String(v)));

export async function buildInvestigationView(db: Db, clock: Clock, ads: UberAdsPort, pos: PosPort, id: string, viewerId: string | null = null) {
  const inv = get(db, "SELECT * FROM mp_investigations WHERE id = ?", id);
  if (!inv) return null;
  const event = j(get(db, "SELECT payload_json FROM mp_events WHERE event_id = ?", inv.event_id)?.payload_json);
  const eventRow = get(db, "SELECT delivery_count, received_at FROM mp_events WHERE event_id = ?", inv.event_id);
  const storeRead = await pos.getStoreProfile(String(inv.pos_store_id));
  const store = storeRead.ok ? storeRead.value : null;
  const facts = j(inv.facts_json) ?? {};
  const evidence = all(db, "SELECT evidence_id, kind, tool, args_json, payload_json, read_at FROM mp_evidence WHERE investigation_id = ? ORDER BY rowid", id).map((e) => ({
    evidenceId: String(e.evidence_id), kind: String(e.kind), tool: String(e.tool), args: j(e.args_json), payload: j(e.payload_json), readAt: String(e.read_at),
  }));
  const ev = (kind: string) => evidence.find((e) => e.kind === kind)?.payload ?? null;
  const kitchen = ev("KITCHEN_SNAPSHOT") as Record<string, unknown> | null;
  const policy = ev("POLICY") as Record<string, unknown> | null;
  const report = ev("CAMPAIGN_REPORT") as Record<string, unknown> | null;
  const reviewedCampaign = inv.candidate_campaign_id
    ? (evidence.find((e) => e.kind === "CAMPAIGN" && (e.payload as { campaignId?: string }).campaignId === inv.candidate_campaign_id)?.payload ?? null)
    : null;
  const campaignList = ev("CAMPAIGN_LIST") as { campaigns?: unknown[] } | null;

  let live: unknown = null;
  let liveError: string | null = null;
  if (inv.account_id && inv.candidate_campaign_id) {
    const r = await ads.getCampaign(String(inv.account_id), String(inv.candidate_campaign_id));
    if (r.ok) live = r.value;
    else liveError = `${r.error.kind}${"status" in r.error ? ` ${r.error.status}` : ""}`;
  }

  const approvals = all(db, "SELECT * FROM mp_approvals WHERE investigation_id = ? ORDER BY created_at", id);
  const mutations = all(db, "SELECT * FROM mp_mutations WHERE investigation_id = ? ORDER BY attempt", id).map((m) => ({
    attempt: Number(m.attempt), requestId: String(m.request_id), status: String(m.status), errorCode: m.error_code, request: j(m.request_json), response: j(m.response_json), startedAt: m.started_at, finishedAt: m.finished_at,
  }));
  const result = j(inv.result_json) ?? {};
  const nowMs = clock.nowMs();
  const status = String(inv.status);
  const lastMutation = mutations[mutations.length - 1];
  const actions = {
    canApprove: status === "AWAITING_APPROVAL",
    canDismiss: status === "AWAITING_APPROVAL" || status === "APPROVED",
    canPause: status === "APPROVED",
    canRetry: status === "PAUSE_REQUESTED_NOT_VERIFIED" && lastMutation?.status === "FAILED_NOT_APPLIED",
    canCheckAgain: status === "PAUSE_REQUESTED_NOT_VERIFIED" && Number(inv.extra_checks) < 5,
    canReassess: ["BLOCKED", "NEEDS_REVIEW", "NO_ACTION"].includes(status),
  };
  const children = all(db, "SELECT id FROM mp_investigations WHERE parent_id = ?", id).map((r) => String(r.id));
  // CH-13: who may approve here (demo identities only; the server still checks every action).
  const eligibleApprovers = all(db, "SELECT u.user_id, u.display_name FROM mp_users u JOIN mp_user_stores s ON s.user_id = u.user_id WHERE s.pos_store_id = ? AND u.role = 'MANAGER' ORDER BY u.user_id", inv.pos_store_id)
    .map((r) => ({ userId: String(r.user_id), displayName: String(r.display_name) }));
  const viewerRow = viewerId ? get(db, "SELECT user_id, display_name, role FROM mp_users WHERE user_id = ?", viewerId) : undefined;
  const viewer = viewerRow
    ? { userId: String(viewerRow.user_id), displayName: String(viewerRow.display_name), role: String(viewerRow.role), canApproveHere: eligibleApprovers.some((e) => e.userId === viewerRow.user_id) }
    : null;
  // CH-16: provenance only from persisted records; never invented.
  const policyRow = inv.policy_id ? get(db, "SELECT policy_id, version, effective_from FROM mp_policies WHERE policy_id = ? AND version = ?", inv.policy_id, inv.policy_version) : undefined;
  let changedBy: string | null = null;
  let changedAt: string | null = null;
  let changeSource: "POLICY_PUBLISHED" | "IMPORT" | null = null;
  if (policyRow) {
    const pub = all(db, "SELECT actor, at_sim, payload_json FROM mp_audit WHERE type = 'POLICY_PUBLISHED' ORDER BY seq DESC")
      .find((r) => { const p = JSON.parse(String(r.payload_json)) as { policyId?: string; to?: string }; return p.policyId === policyRow.policy_id && p.to === policyRow.version; });
    if (pub) { changedBy = String(pub.actor); changedAt = String(pub.at_sim); changeSource = "POLICY_PUBLISHED"; }
    else {
      const key = `${policyRow.policy_id}|${policyRow.version}`;
      const imp = all(db, "SELECT actor, committed_at, summary_json FROM mp_import_batches WHERE status IN ('COMMITTED','RESTORED') ORDER BY rowid DESC")
        .find((r) => ((JSON.parse(String(r.summary_json)) as { changes?: { sheet: string; key: string; change: string }[] }).changes ?? [])
          .some((c) => c.sheet === "merchant_policies" && c.key === key && (c.change === "added" || c.change === "updated")));
      if (imp) { changedBy = String(imp.actor); changedAt = String(imp.committed_at); changeSource = "IMPORT"; }
    }
  }
  const policyProvenance = policyRow
    ? { policyId: String(policyRow.policy_id), version: String(policyRow.version), effectiveFrom: String(policyRow.effective_from), checkCount: STEPS.length, changedBy, changedAt, changeSource }
    : null;
  const evidenceMatrix = evidenceMatrixFor(db, id);
  const storeHistory = summarizeHistory(
    all(db, "SELECT id, event_id, status, created_at, rowid AS seq FROM mp_investigations WHERE pos_store_id = ?", inv.pos_store_id)
      .map((r) => ({ id: String(r.id), eventId: String(r.event_id), status: String(r.status), createdAt: String(r.created_at), seq: Number(r.seq) })),
    String(inv.event_id),
    nowMs,
  );
  const repeat = evidence.find((e) => e.kind === "REPEAT_CHECK");
  const repeatPayload = repeat?.payload as { flagged?: boolean; prior?: { investigationId: string; eventId: string; snapshotId: string; p95: number; occurredAt: string }; matchedFields?: string[]; secondsApart?: number } | undefined;
  const warnings = repeatPayload?.flagged && repeatPayload.prior
    ? [{
        code: "POSSIBLE_REPEAT_ALERT",
        evidenceRef: repeat!.evidenceId,
        priorInvestigationId: repeatPayload.prior.investigationId,
        priorEventId: repeatPayload.prior.eventId,
        snapshotId: repeatPayload.prior.snapshotId,
        p95: repeatPayload.prior.p95,
        priorOccurredAt: repeatPayload.prior.occurredAt,
        secondsApart: repeatPayload.secondsApart ?? null,
        matchedFields: repeatPayload.matchedFields ?? [],
      }]
    : [];

  return {
    id,
    status,
    decision: inv.decision,
    decisionCode: inv.decision_code,
    parentId: inv.parent_id,
    childIds: children,
    createdAt: inv.created_at,
    updatedAt: inv.updated_at,
    dismissReason: inv.dismiss_reason,
    now: clock.nowIso(),
    store: store ? { posStoreId: store.storeId, name: store.name, timezone: store.timezone, uberStoreId: inv.uber_store_id, accountId: inv.account_id } : null,
    event: event ? { ...event, signature: `${String(event.signature).slice(0, 8)}…`, deliveryCount: Number(eventRow?.delivery_count ?? 1), receivedAt: eventRow?.received_at } : null,
    kitchen: kitchen
      ? {
          snapshotId: kitchen.snapshotId, p95PrepMinutes: kitchen.p95PrepMinutes, activeTickets: kitchen.activeTickets, connectorHealth: kitchen.connectorHealth,
          capturedAt: kitchen.capturedAt, ageSeconds: ageSeconds(nowMs, String(kitchen.capturedAt)), thresholdMinutes: policy?.p95ThresholdMinutes ?? null,
          posAlertThresholdMinutes: event?.configuredThresholdMinutes ?? null,
        }
      : null,
    kitchenAgeAtDecision: facts.snapshotAgeS ?? null,
    policy,
    campaign: reviewedCampaign,
    campaignsSeen: campaignList?.campaigns ?? [],
    liveCampaign: live,
    liveCampaignError: liveError,
    report: report ? { ...report, ageSecondsAtDecision: facts.reportAgeS ?? null } : null,
    contribution: j(inv.contribution_json),
    exclusionNote: EXCLUSION_NOTE,
    policyChecks: j(inv.policy_checks_json) ?? [],
    agent: { ...(j(inv.agent_report_json) ?? {}), validation: j(inv.agent_validation_json) },
    evidence,
    approvals: approvals.map((a) => ({ approvalId: a.approval_id, approvedBy: a.approved_by, campaignId: a.campaign_id, policyVersion: a.policy_version, createdAt: a.created_at, expiresAt: a.expires_at, consumedAt: a.consumed_at })),
    mutations,
    result,
    actions,
    warnings,
    storeHistory,
    eligibleApprovers,
    viewer,
    policyProvenance,
    evidenceMatrix,
    adsProvider: ads.label,
    posProvider: pos.label,
    audit: auditFor(db, id),
  };
}

/** CH-19: evidence matrix for one investigation, from persisted records (shared by the view and the evidence package). */
export function evidenceMatrixFor(db: Db, id: string) {
  const inv = get(db, "SELECT * FROM mp_investigations WHERE id = ?", id);
  if (!inv) return null;
  const evidence = all(db, "SELECT evidence_id, kind, payload_json FROM mp_evidence WHERE investigation_id = ? ORDER BY rowid", id)
    .map((e) => ({ evidenceId: String(e.evidence_id), kind: String(e.kind), payload: j(e.payload_json) as unknown }));
  const auditRows = auditFor(db, id);
  const lastAt = (types: string[]) => [...auditRows].reverse().find((a) => types.includes(a.type))?.atSim ?? null;
  return buildEvidenceMatrix({
    eventId: String(inv.event_id),
    candidateCampaignId: (inv.candidate_campaign_id as string | null) ?? null,
    policyChecks: j(inv.policy_checks_json) ?? [],
    executionChecks: (j(inv.result_json) ?? {}).executionChecks ?? null,
    evidence,
    approvalIds: all(db, "SELECT approval_id FROM mp_approvals WHERE investigation_id = ? ORDER BY created_at", id).map((r) => String(r.approval_id)),
    requestIds: all(db, "SELECT request_id FROM mp_mutations WHERE investigation_id = ? AND request_id <> 'not-sent' ORDER BY attempt", id).map((r) => String(r.request_id)),
    decidedAt: lastAt(["POLICY_EVALUATED"]),
    executedAt: lastAt(["PATCH_SENT", "PATCH_NOT_SENT", "EXECUTION_REJECTED", "EXECUTION_BLOCKED"]),
    ruleVersion: inv.policy_id ? `${inv.policy_id}-${inv.policy_version}` : null,
  });
}
