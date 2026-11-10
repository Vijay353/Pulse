/**
 * Orchestrator: TRIGGER → AUTHORIZED CONTEXT → INVESTIGATION → POLICY →
 * APPROVAL → TOOL → READBACK → RESULT/AUDIT.
 * Owns the state machine. No UI or agent can change campaign state except
 * through approve() + pause() here.
 */
import { KitchenLoadEvent, InvestigationStatus } from "../../../../packages/contracts/src/index";
import { all, Db, get, nextCounter, Row, run } from "../db/db";
import { ageSeconds, Clock } from "../clock";
import type { PosPort, UberAdsPort } from "../adapters/ports";
import { appendAudit } from "../audit/audit";
import { verifySignature } from "../security/signature";
import { currentPolicy, ToolRegistry } from "../agents/toolRegistry";
import type { Investigator } from "../agents/investigators";
import { validateAgentReport } from "../agents/validateReport";
import { AlertRef, findPossibleRepeat, REPEAT_WARNING } from "../policy/repeatAlert";
import { CalculationData, CampaignListData, CampaignReportData, GuardrailData, KitchenSnapshotData, readTool, toolError } from "../agents/toolResults";
import { AssessmentFacts, evaluatePolicy } from "../policy/policyEngine";
import type { ContributionResult } from "../policy/contribution";
import { isVerified, pauseSponsoredListingCampaign, readbackOnce, resolveAmbiguous } from "../tools/pauseCampaign";

export interface OrchestratorDeps {
  db: Db;
  clock: Clock;
  ads: UberAdsPort;
  pos: PosPort;
  investigator: Investigator | null;
  investigatorProblem: string | null;
  webhookSecret: string;
  readbackAttempts: number;
  readbackIntervalMs: number;
}

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

const TRANSITIONS: Record<InvestigationStatus, InvestigationStatus[]> = {
  RECEIVED: ["ASSESSING"],
  ASSESSING: ["NO_ACTION", "NEEDS_REVIEW", "BLOCKED", "RECOMMENDATION_READY"],
  RECOMMENDATION_READY: ["AWAITING_APPROVAL"],
  AWAITING_APPROVAL: ["APPROVED", "DISMISSED", "BLOCKED"],
  APPROVED: ["PAUSE_REQUESTED", "BLOCKED", "DISMISSED"],
  PAUSE_REQUESTED: ["PAUSE_VERIFIED", "PAUSE_REQUESTED_NOT_VERIFIED", "BLOCKED"],
  PAUSE_REQUESTED_NOT_VERIFIED: ["PAUSE_VERIFIED", "PAUSE_REQUESTED", "BLOCKED"],
  PAUSE_VERIFIED: [],
  NO_ACTION: [],
  NEEDS_REVIEW: [],
  BLOCKED: [],
  DISMISSED: [],
};

export interface Actor { userId: string; role: string; stores: string[] }

export class Orchestrator {
  constructor(private readonly d: OrchestratorDeps) {}

  /* ---------------- state helpers ---------------- */

  private inv(id: string): Row {
    const r = get(this.d.db, "SELECT * FROM mp_investigations WHERE id = ?", id);
    if (!r) throw new HttpError(404, "NOT_FOUND", "Unknown investigation");
    return r;
  }

  private transition(id: string, to: InvestigationStatus, actor: string, extra: Record<string, unknown> = {}) {
    const cur = String(this.inv(id).status) as InvestigationStatus;
    if (!TRANSITIONS[cur].includes(to)) throw new HttpError(409, "INVALID_TRANSITION", `Cannot move from ${cur} to ${to}`);
    run(this.d.db, "UPDATE mp_investigations SET status = ?, updated_at = ? WHERE id = ?", to, this.d.clock.nowIso(), id);
    appendAudit(this.d.db, this.d.clock, { investigationId: id, type: "STATE_CHANGED", actor, payload: { from: cur, to, ...extra } });
  }

  private setDecision(id: string, decision: string, code: string) {
    run(this.d.db, "UPDATE mp_investigations SET decision = ?, decision_code = ?, updated_at = ? WHERE id = ?", decision, code, this.d.clock.nowIso(), id);
  }

  private mergeResult(id: string, patch: Record<string, unknown>) {
    const prev = JSON.parse(String(this.inv(id).result_json ?? "{}"));
    run(this.d.db, "UPDATE mp_investigations SET result_json = ? WHERE id = ?", JSON.stringify({ ...prev, ...patch }), id);
  }

  /* ---------------- 1. trigger ---------------- */

  async receiveEvent(body: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
    const { db, clock } = this.d;
    const parsed = KitchenLoadEvent.safeParse(body);
    if (!parsed.success) {
      run(db, "INSERT INTO mp_rejected_events(received_at, reason, payload_excerpt) VALUES(?,?,?)", clock.nowIso(), `schema: ${parsed.error.issues[0]?.message}`, JSON.stringify(body ?? null).slice(0, 300));
      appendAudit(db, clock, { investigationId: null, type: "EVENT_REJECTED", actor: "webhook", payload: { reason: "schema", issue: parsed.error.issues[0]?.message } });
      return { status: 400, body: { error: "INVALID_EVENT", message: parsed.error.issues[0]?.message } };
    }
    const ev = parsed.data;
    if (!verifySignature(ev, this.d.webhookSecret)) {
      run(db, "INSERT INTO mp_rejected_events(received_at, reason, payload_excerpt) VALUES(?,?,?)", clock.nowIso(), "BLOCKED_INVALID_EVENT: signature", JSON.stringify({ eventId: ev.eventId, storeId: ev.storeId }));
      appendAudit(db, clock, { investigationId: null, type: "EVENT_REJECTED", actor: "webhook", payload: { reason: "BLOCKED_INVALID_EVENT", eventId: ev.eventId } });
      return { status: 401, body: { error: "BLOCKED_INVALID_EVENT", message: "Webhook signature is invalid; event ignored" } };
    }
    // Idempotency: the insert is synchronous, so concurrent deliveries cannot both pass.
    const prior = get(db, "SELECT * FROM mp_events WHERE event_id = ?", ev.eventId);
    if (prior) {
      run(db, "UPDATE mp_events SET delivery_count = delivery_count + 1 WHERE event_id = ?", ev.eventId);
      appendAudit(db, clock, { investigationId: String(prior.investigation_id), type: "DUPLICATE_EVENT_SUPPRESSED", actor: "webhook", payload: { eventId: ev.eventId, deliveryCount: Number(prior.delivery_count) + 1 } });
      return { status: 200, body: { duplicate: true, investigationId: prior.investigation_id, decision: "RETURN_PRIOR_RESULT" } };
    }
    const id = `inv-${nextCounter(db, "inv.seq", 1042)}`;
    run(db, "INSERT INTO mp_events(event_id, received_at, payload_json, investigation_id, delivery_count) VALUES(?,?,?,?,1)", ev.eventId, clock.nowIso(), JSON.stringify(ev), id);
    this.createInvestigation(id, ev.eventId, ev.storeId, null);
    appendAudit(db, clock, { investigationId: id, type: "EVENT_RECEIVED", actor: "webhook", payload: { eventId: ev.eventId, storeId: ev.storeId, snapshotId: ev.snapshotId, signature: "valid" } });
    await this.assess(id);
    const r = this.inv(id);
    return { status: 202, body: { duplicate: false, investigationId: id, status: r.status, decision: r.decision, decisionCode: r.decision_code } };
  }

  private createInvestigation(id: string, eventId: string, posStoreId: string, parentId: string | null) {
    const now = this.d.clock.nowIso();
    run(this.d.db, "INSERT INTO mp_investigations(id, event_id, parent_id, pos_store_id, status, created_at, updated_at) VALUES(?,?,?,?,'RECEIVED',?,?)", id, eventId, parentId, posStoreId, now, now);
  }

  /* ---------------- 2–4. investigate + decide ---------------- */

  async assess(id: string) {
    const { db, clock } = this.d;
    const inv = this.inv(id);
    const eventParsed = KitchenLoadEvent.safeParse(JSON.parse(String(get(db, "SELECT payload_json FROM mp_events WHERE event_id = ?", inv.event_id)?.payload_json ?? "null")));
    if (!eventParsed.success) {
      // Stored events were validated on arrival; a mismatch here means the record is corrupt.
      this.transition(id, "ASSESSING", "orchestrator");
      this.setDecision(id, "BLOCKED", "BLOCKED_INVALID_EVENT");
      this.transition(id, "BLOCKED", "orchestrator", { code: "BLOCKED_INVALID_EVENT", reason: "stored event failed validation" });
      return;
    }
    const event = eventParsed.data;
    const posStoreId = String(inv.pos_store_id);
    this.transition(id, "ASSESSING", "orchestrator");
    const policyStart = currentPolicy(db, posStoreId);
    const tools = new ToolRegistry({ db, clock, ads: this.d.ads, pos: this.d.pos, investigationId: id, posStoreId });

    // Agent investigates first (read-only tools, memoized evidence).
    let run_: Awaited<ReturnType<Investigator["investigate"]>> | null = null;
    if (this.d.investigator) {
      run_ = await this.d.investigator.investigate({ investigationId: id, posStoreId, event }, tools);
      appendAudit(db, clock, { investigationId: id, type: "AGENT_INVESTIGATED", actor: run_.provider, payload: { toolCalls: run_.trace.length, error: run_.error ?? null } });
    }

    // Deterministic fact gathering through the same tools (memoized: identical evidence).
    const kitchen = await tools.call("getKitchenSnapshot", { storeId: posStoreId });
    const guard = await tools.call("getMerchantGuardrail", { storeId: posStoreId });
    const camps = await tools.call("getStoreCampaigns", { storeId: posStoreId });
    const kRead = readTool(KitchenSnapshotData, kitchen);
    const gRead = readTool(GuardrailData, guard);
    const cdRead = readTool(CampaignListData, camps);
    const k = kRead.ok ? kRead.value : null;
    const g = gRead.ok ? gRead.value : null;
    const cd = cdRead.ok ? cdRead.value : null;
    const campsErr = camps.ok ? (cdRead.ok ? null : cdRead.problem) : toolError(camps);
    const readProblems = [kRead, gRead, cdRead].filter((x) => !x.ok && x.problem.includes("schema")).map((x) => (x as { problem: string }).problem);
    const mappingCount = all(db, "SELECT 1 FROM mp_store_mappings WHERE pos_store_id = ?", posStoreId).length;

    let report: { watermark: string } | null = null;
    let contribution: ContributionResult | null = null;
    let candidate: { campaignId: string; permissions: string[]; version: number } | null = null;
    if (cd && cd.eligibleCampaignIds.length === 1) {
      candidate = cd.campaigns.find((c) => c.campaignId === cd.eligibleCampaignIds[0]) ?? null;
    }
    if (candidate) {
      const rep = await tools.call("getCampaignReport", { storeId: posStoreId, campaignId: candidate.campaignId });
      const repRead = readTool(CampaignReportData, rep);
      report = repRead.ok ? repRead.value : null;
      const calc = await tools.call("calculateContribution", { storeId: posStoreId, campaignId: candidate.campaignId });
      // A failed calculation still carries a typed { ok: false, missing } result; read it either way.
      const calcRead = CalculationData.safeParse(calc.data);
      contribution = calcRead.success ? calcRead.data.result : null;
      if (!calcRead.success) readProblems.push(`${calc.evidenceRef}: calculation result did not match its schema`);
    }

    const validation = run_?.rawReport !== undefined && run_?.rawReport !== null
      ? validateAgentReport(db, id, posStoreId, run_.rawReport)
      : { schemaValid: false, citationsResolve: false, problems: [run_?.error ?? this.d.investigatorProblem ?? "no agent output"], report: null };
    const policyNow = currentPolicy(db, posStoreId);
    const nowMs = clock.nowMs();
    // A kitchen result that does not match its schema counts as unavailable (fail closed).
    const posAvailable = kRead.ok;

    const facts: AssessmentFacts = {
      signatureValid: true,
      eventAgeS: ageSeconds(nowMs, event.occurredAt),
      maxEventAgeS: g?.maxEventAgeS ?? null,
      mappingCount,
      policyPresent: !!policyStart,
      posAvailable,
      connectorHealth: k?.connectorHealth ?? null,
      snapshotAgeS: k ? ageSeconds(nowMs, k.capturedAt) : null,
      maxSnapshotAgeS: g?.maxPosSnapshotAgeS ?? null,
      policyVersionAtStart: policyStart ? `${policyStart.policy_id}-${policyStart.version}` : null,
      policyVersionNow: policyNow ? `${policyNow.policy_id}-${policyNow.version}` : null,
      p95: k?.p95PrepMinutes ?? null,
      thresholdMinutes: g?.p95ThresholdMinutes ?? null,
      adsReadOk: !!cd || (mappingCount !== 1),
      adsReadError: campsErr ? JSON.stringify(campsErr).slice(0, 160) : null,
      eligibleCampaignIds: cd?.eligibleCampaignIds ?? [],
      campaignPermissions: candidate?.permissions ?? null,
      reportPresent: !!report,
      reportAgeS: report ? ageSeconds(nowMs, report.watermark) : null,
      maxReportAgeS: g?.maxAdsReportAgeS ?? null,
      contribution,
      agent: {
        schemaValid: validation.schemaValid,
        citationsResolve: validation.citationsResolve,
        problems: validation.problems,
        action: validation.report?.candidateAction ?? null,
        campaignId: validation.report?.candidateCampaignId ?? null,
      },
      investigatorAvailable: !!this.d.investigator,
      readProblems,
      investigatorProblem: this.d.investigatorProblem,
    };
    const outcome = evaluatePolicy(facts);

    run(db, `UPDATE mp_investigations SET policy_id = ?, policy_version = ?, uber_store_id = ?, account_id = ?, candidate_campaign_id = ?, observed_campaign_version = ?,
             agent_report_json = ?, agent_validation_json = ?, policy_checks_json = ?, contribution_json = ?, facts_json = ? WHERE id = ?`,
      policyStart?.policy_id ?? null, policyStart?.version ?? null, cd?.mapping.uberStoreId ?? null, cd?.mapping.accountId ?? null,
      candidate?.campaignId ?? null, candidate?.version ?? null,
      JSON.stringify({ provider: run_?.provider ?? null, raw: run_?.rawReport ?? null, trace: run_?.trace ?? [], error: run_?.error ?? null }),
      JSON.stringify({ schemaValid: validation.schemaValid, citationsResolve: validation.citationsResolve, problems: validation.problems }),
      JSON.stringify(outcome.checks), JSON.stringify(contribution), JSON.stringify(facts), id);
    appendAudit(db, clock, { investigationId: id, type: "POLICY_EVALUATED", actor: "policy-engine", payload: { decision: outcome.decision, code: outcome.code } });
    this.recordRepeatCheck(id, event.eventId, posStoreId, event);

    this.setDecision(id, outcome.decision, outcome.code);
    if (outcome.decision === "RECOMMEND_PAUSE") {
      this.transition(id, "RECOMMENDATION_READY", "policy-engine");
      run(db, "UPDATE mp_investigations SET recommended_at = ? WHERE id = ?", clock.nowIso(), id);
      this.transition(id, "AWAITING_APPROVAL", "policy-engine", { campaignId: candidate?.campaignId });
    } else {
      this.transition(id, outcome.decision as InvestigationStatus, "policy-engine", { code: outcome.code });
    }
  }

  async reassess(id: string, actor: Actor) {
    const inv = this.inv(id);
    this.requireStore(actor, String(inv.pos_store_id));
    if (!["BLOCKED", "NEEDS_REVIEW", "NO_ACTION"].includes(String(inv.status)))
      throw new HttpError(409, "INVALID_TRANSITION", "Only a blocked, review or no-action investigation can be re-assessed");
    const child = `inv-${nextCounter(this.d.db, "inv.seq", 1042)}`;
    this.createInvestigation(child, String(inv.event_id), String(inv.pos_store_id), id);
    run(this.d.db, "UPDATE mp_events SET investigation_id = ? WHERE event_id = ?", child, inv.event_id);
    appendAudit(this.d.db, this.d.clock, { investigationId: child, type: "REASSESSMENT_STARTED", actor: actor.userId, payload: { parentId: id } });
    await this.assess(child);
    return child;
  }

  /* ---------------- 5. approval ---------------- */

  private requireStore(actor: Actor, posStoreId: string) {
    if (!actor.stores.includes(posStoreId)) throw new HttpError(403, "NOT_AUTHORIZED", `${actor.userId} is not assigned to ${posStoreId}`);
  }
  private requireManager(actor: Actor, posStoreId: string) {
    this.requireStore(actor, posStoreId);
    if (actor.role !== "MANAGER") throw new HttpError(403, "NOT_AUTHORIZED", "Only a manager can approve a campaign pause");
  }

  /** CH-6: compare this alert with earlier alerts for the same store and store the result as evidence. */
  private recordRepeatCheck(id: string, eventId: string, posStoreId: string, event: { snapshotId: string; observedP95PrepMinutes: number; occurredAt: string }) {
    const { db, clock } = this.d;
    const priors: AlertRef[] = all(db, "SELECT e.event_id, e.payload_json, e.investigation_id FROM mp_events e WHERE e.event_id <> ?", eventId)
      .map((r) => ({ r, ev: KitchenLoadEvent.safeParse(JSON.parse(String(r.payload_json))) }))
      .filter((x) => x.ev.success && x.ev.data.storeId === posStoreId)
      .map((x) => {
        const ev = (x.ev as { data: KitchenLoadEvent }).data;
        return { investigationId: String(x.r.investigation_id), eventId: ev.eventId, posStoreId: ev.storeId, snapshotId: ev.snapshotId, p95: ev.observedP95PrepMinutes, occurredAt: ev.occurredAt };
      });
    const result = findPossibleRepeat(
      { investigationId: id, eventId, posStoreId, snapshotId: event.snapshotId, p95: event.observedP95PrepMinutes, occurredAt: event.occurredAt },
      priors,
    );
    run(db, "INSERT OR REPLACE INTO mp_evidence(evidence_id, investigation_id, kind, tool, args_json, payload_json, read_at) VALUES(?,?,?,?,?,?,?)",
      `repeat-check-${id}`, id, "REPEAT_CHECK", "findPossibleRepeat", JSON.stringify({ eventId, storeId: posStoreId }), JSON.stringify(result), clock.nowIso());
    if (result.flagged)
      appendAudit(db, clock, { investigationId: id, type: "POSSIBLE_REPEAT_FLAGGED", actor: "orchestrator", payload: { priorInvestigationId: result.prior.investigationId, priorEventId: result.prior.eventId, secondsApart: result.secondsApart } });
  }

  /** Warnings that need explicit acknowledgement before approval. */
  warningsFor(id: string): string[] {
    const ev = get(this.d.db, "SELECT payload_json FROM mp_evidence WHERE investigation_id = ? AND kind = 'REPEAT_CHECK'", id);
    if (!ev) return [];
    const r = JSON.parse(String(ev.payload_json)) as { flagged?: boolean };
    return r.flagged === true ? [REPEAT_WARNING] : [];
  }

  approve(id: string, actor: Actor, acknowledged: string[] = []) {
    const { db, clock } = this.d;
    const inv = this.inv(id);
    this.requireManager(actor, String(inv.pos_store_id));
    if (inv.decision !== "RECOMMEND_PAUSE") throw new HttpError(409, "NOT_RECOMMENDED", "This investigation has no pause recommendation");
    if (inv.status === "APPROVED") {
      const existing = get(db, "SELECT * FROM mp_approvals WHERE investigation_id = ? AND approved_by = ? AND consumed_at IS NULL ORDER BY created_at DESC LIMIT 1", id, actor.userId);
      if (existing && Date.parse(String(existing.expires_at)) > clock.nowMs()) return existing;
    }
    if (inv.status !== "AWAITING_APPROVAL") throw new HttpError(409, "INVALID_TRANSITION", `Cannot approve while ${inv.status}`);
    const warnings = this.warningsFor(id);
    const missingAck = warnings.filter((w) => !acknowledged.includes(w));
    if (missingAck.length)
      throw new HttpError(409, "WARNING_NOT_ACKNOWLEDGED", "This alert may repeat an earlier one. Review the earlier investigation and confirm before approving.");
    const policy = get(db, "SELECT * FROM mp_policies WHERE policy_id = ? AND version = ?", inv.policy_id, inv.policy_version)!;
    const approvalId = `apr-${nextCounter(db, "apr.seq", 501)}`;
    const expires = new Date(clock.nowMs() + Number(policy.approval_ttl_s) * 1000).toISOString();
    run(db, "INSERT INTO mp_approvals VALUES(?,?,?,?,?,?,?,?,?,NULL)", approvalId, id, inv.pos_store_id, inv.candidate_campaign_id, "PAUSE_SPONSORED_LISTING", inv.policy_version, actor.userId, clock.nowIso(), expires);
    appendAudit(db, clock, { investigationId: id, type: "MANAGER_APPROVED", actor: actor.userId, payload: { approvalId, campaignId: inv.candidate_campaign_id, policyVersion: inv.policy_version, expiresAt: expires, acknowledgedWarnings: warnings } });
    this.transition(id, "APPROVED", actor.userId, { approvalId });
    return get(db, "SELECT * FROM mp_approvals WHERE approval_id = ?", approvalId)!;
  }

  dismiss(id: string, actor: Actor, reason: string) {
    const inv = this.inv(id);
    this.requireStore(actor, String(inv.pos_store_id));
    if (!["AWAITING_APPROVAL", "APPROVED"].includes(String(inv.status))) throw new HttpError(409, "INVALID_TRANSITION", `Cannot dismiss while ${inv.status}`);
    run(this.d.db, "UPDATE mp_investigations SET dismiss_reason = ? WHERE id = ?", reason, id);
    run(this.d.db, "UPDATE mp_approvals SET consumed_at = ? WHERE investigation_id = ? AND consumed_at IS NULL", this.d.clock.nowIso(), id);
    appendAudit(this.d.db, this.d.clock, { investigationId: id, type: "MANAGER_DISMISSED", actor: actor.userId, payload: { reason } });
    this.setDecision(id, "DISMISSED", "DISMISSED_BY_MANAGER");
    this.transition(id, "DISMISSED", actor.userId);
  }

  /* ---------------- 6–7. execute + verify ---------------- */

  private blockExecution(id: string, actor: string, code: string, message: string) {
    appendAudit(this.d.db, this.d.clock, { investigationId: id, type: "EXECUTION_BLOCKED", actor, payload: { code, message } });
    this.mergeResult(id, { lastError: { code, message } });
    this.setDecision(id, "BLOCKED", code);
    this.transition(id, "BLOCKED", actor, { code });
  }

  async pause(id: string, actor: Actor, approvalId: string) {
    const { db, clock } = this.d;
    const inv = this.inv(id);
    this.requireManager(actor, String(inv.pos_store_id));
    const status = String(inv.status);
    const mutationKey = `${inv.pos_store_id}:${inv.candidate_campaign_id}:${inv.event_id}:PAUSE`;

    if (status === "PAUSE_VERIFIED") return { alreadyDone: true };
    if (status === "PAUSE_REQUESTED_NOT_VERIFIED") {
      const lastAttempt = get(db, "SELECT status FROM mp_mutations WHERE mutation_key = ? ORDER BY attempt DESC LIMIT 1", mutationKey);
      if (lastAttempt?.status !== "FAILED_NOT_APPLIED") throw new HttpError(409, "RETRY_NOT_ALLOWED", "A retry is only allowed after a readback proves the previous attempt was not applied. Use “Check again”.");
    } else if (status !== "APPROVED") {
      throw new HttpError(409, "APPROVAL_REQUIRED", status === "AWAITING_APPROVAL" ? "A manager approval is required before any change" : `Cannot pause while ${status}`);
    }

    const ap = get(db, "SELECT * FROM mp_approvals WHERE approval_id = ?", approvalId);
    const checks: { id: string; ok: boolean; detail: string }[] = [];
    const chk = (cid: string, ok: boolean, detail: string) => { checks.push({ id: cid, ok, detail }); return ok; };
    const approvalOk =
      chk("approval_exists", !!ap, ap ? String(ap.approval_id) : "missing") &&
      chk("approval_investigation", ap!.investigation_id === id, String(ap!.investigation_id)) &&
      chk("approval_store", ap!.pos_store_id === inv.pos_store_id, String(ap!.pos_store_id)) &&
      chk("approval_campaign", ap!.campaign_id === inv.candidate_campaign_id, String(ap!.campaign_id)) &&
      chk("approval_action", ap!.action === "PAUSE_SPONSORED_LISTING", String(ap!.action)) &&
      chk("approval_policy_version", ap!.policy_version === inv.policy_version, String(ap!.policy_version)) &&
      chk("approval_user", ap!.approved_by === actor.userId, String(ap!.approved_by)) &&
      chk("approval_not_expired", Date.parse(String(ap!.expires_at)) > clock.nowMs(), String(ap!.expires_at)) &&
      chk("approval_not_reused", !ap!.consumed_at || status === "PAUSE_REQUESTED_NOT_VERIFIED", ap!.consumed_at ? `consumed ${ap!.consumed_at}` : "unused");
    if (!approvalOk) {
      this.mergeResult(id, { executionChecks: checks });
      appendAudit(db, clock, { investigationId: id, type: "EXECUTION_REJECTED", actor: actor.userId, payload: { approvalId, checks } });
      throw new HttpError(403, "APPROVAL_INVALID", `Approval does not authorize this action (${checks.find((c) => !c.ok)?.id})`);
    }
    const warnings = this.warningsFor(id);
    if (warnings.length) {
      const approvedEv = all(db, "SELECT payload_json FROM mp_audit WHERE investigation_id = ? AND type = 'MANAGER_APPROVED'", id)
        .map((r) => JSON.parse(String(r.payload_json)) as { approvalId?: string; acknowledgedWarnings?: string[] })
        .find((p) => p.approvalId === approvalId);
      const acked = warnings.every((w) => approvedEv?.acknowledgedWarnings?.includes(w));
      if (!chk("warnings_acknowledged", acked, acked ? warnings.join(",") : "not acknowledged")) {
        this.mergeResult(id, { executionChecks: checks });
        throw new HttpError(403, "WARNING_NOT_ACKNOWLEDGED", "The approval does not acknowledge the repeat-alert warning");
      }
    }
    const policy = currentPolicy(db, String(inv.pos_store_id));
    if (!chk("policy_unchanged", !!policy && policy.version === inv.policy_version && policy.policy_id === inv.policy_id, policy ? `${policy.policy_id}-${policy.version}` : "none")) {
      this.mergeResult(id, { executionChecks: checks });
      this.blockExecution(id, actor.userId, "BLOCKED_POLICY_CHANGED", "The merchant policy changed after the recommendation. Re-assess.");
      return { blocked: true };
    }
    const recTtl = Number(get(db, "SELECT recommendation_ttl_s FROM mp_policies WHERE policy_id = ? AND version = ?", inv.policy_id, inv.policy_version)!.recommendation_ttl_s);
    if (!chk("recommendation_fresh", clock.nowMs() - Date.parse(String(inv.recommended_at)) <= recTtl * 1000, `recommended ${inv.recommended_at}`)) {
      this.mergeResult(id, { executionChecks: checks });
      this.blockExecution(id, actor.userId, "BLOCKED_RECOMMENDATION_EXPIRED", "The recommendation is older than the policy allows. Re-assess with fresh data.");
      return { blocked: true };
    }

    run(db, "UPDATE mp_approvals SET consumed_at = COALESCE(consumed_at, ?) WHERE approval_id = ?", clock.nowIso(), approvalId);
    const adsDigestBefore = await this.d.ads.stateDigest(String(inv.candidate_campaign_id));
    const posDigestBefore = await this.d.pos.stateDigest();
    this.transition(id, "PAUSE_REQUESTED", actor.userId, { approvalId });

    const { output, detail } = await pauseSponsoredListingCampaign(
      {
        investigationId: id, eventId: String(inv.event_id), approvalId, approvedBy: actor.userId,
        accountId: String(inv.account_id), storeId: String(inv.pos_store_id), campaignId: String(inv.candidate_campaign_id),
        observedCampaignVersion: Number(inv.observed_campaign_version), policyVersion: String(inv.policy_version), idempotencyKey: mutationKey,
      },
      { db, clock, ads: this.d.ads, uberStoreId: String(inv.uber_store_id), readbackAttempts: this.d.readbackAttempts, readbackIntervalMs: this.d.readbackIntervalMs },
    );
    checks.push({ id: "prewrite_reread", ok: detail.preWrite.ok, detail: detail.preWrite.reason ?? `ACTIVE v${detail.preWrite.campaign?.version} · store-scoped · UPDATE` });
    appendAudit(db, clock, { investigationId: id, type: detail.requestId ? "PATCH_SENT" : "PATCH_NOT_SENT", actor: "orchestrator", payload: { requestId: detail.requestId, attempt: detail.attempt, outcome: detail.writeOutcome?.kind ?? null, preWrite: detail.preWrite.reason } });
    for (const rb of detail.readbacks) appendAudit(db, clock, { investigationId: id, type: "READBACK", actor: "orchestrator", payload: rb });

    const patchCount = await this.patchCount(String(inv.account_id), String(inv.candidate_campaign_id));
    const base = { executionChecks: checks, tool: { output, detail }, patchCountForCampaign: patchCount, adsProvider: this.d.ads.label };

    if (!output.ok && !detail.preWrite.ok) {
      const map: Record<string, string> = { NOT_AUTHORIZED: "BLOCKED_MISSING_PERMISSION", STALE_CAMPAIGN: "BLOCKED_CONTEXT_CHANGED", WRONG_STORE: "BLOCKED_CONTEXT_CHANGED", ALREADY_PAUSED: "BLOCKED_CONTEXT_CHANGED" };
      if (map[output.code]) {
        this.mergeResult(id, base);
        appendAudit(db, clock, { investigationId: id, type: "EXECUTION_BLOCKED", actor: "orchestrator", payload: { code: map[output.code], message: output.message } });
        this.setDecision(id, "BLOCKED", map[output.code]!);
        this.transition(id, "BLOCKED", "orchestrator", { code: map[output.code] });
        return { output };
      }
      // Transient pre-write failure (rate limit / upstream): nothing was sent.
      this.mergeResult(id, { ...base, lastError: { code: output.code, message: output.message } });
      this.setDecision(id, "PAUSE_REQUESTED_NOT_VERIFIED", `PREWRITE_${output.code}`);
      this.transition(id, "PAUSE_REQUESTED_NOT_VERIFIED", "orchestrator");
      run(db, "INSERT INTO mp_mutations(mutation_key, attempt, investigation_id, approval_id, request_id, status, request_json, error_code, started_at, finished_at) VALUES(?,?,?,?,?,'FAILED_NOT_APPLIED','{}',?,?,?)",
        mutationKey, Number(get(db, "SELECT COUNT(*) n FROM mp_mutations WHERE mutation_key = ?", mutationKey)!.n) + 1, id, approvalId, "not-sent", `PREWRITE_${output.code}`, clock.nowIso(), clock.nowIso());
      return { output };
    }

    if (output.ok && output.verified) {
      await this.finishVerified(id, String(inv.account_id), String(inv.candidate_campaign_id), adsDigestBefore, posDigestBefore, base);
      return { output };
    }
    if (!output.ok && output.code === "NOT_AUTHORIZED") {
      this.mergeResult(id, base);
      this.setDecision(id, "BLOCKED", "BLOCKED_MISSING_PERMISSION");
      this.transition(id, "BLOCKED", "orchestrator", { code: "BLOCKED_MISSING_PERMISSION" });
      return { output };
    }
    const code = output.ok ? "PAUSE_REQUESTED_STILL_SERVING" : detail.mutationStatus === "FAILED_NOT_APPLIED" ? `PAUSE_NOT_APPLIED_${output.code}` : "PAUSE_OUTCOME_UNCONFIRMED";
    this.mergeResult(id, { ...base, digestsBefore: { ads: adsDigestBefore, pos: posDigestBefore }, lastError: output.ok ? null : { code: output.code, message: output.message } });
    this.setDecision(id, "PAUSE_REQUESTED_NOT_VERIFIED", code);
    this.transition(id, "PAUSE_REQUESTED_NOT_VERIFIED", "orchestrator", { code });
    return { output };
  }

  /** Bounded extra readback ("Check again"), max 5 per investigation. Never writes. */
  async verify(id: string, actor: Actor) {
    const { db, clock } = this.d;
    const inv = this.inv(id);
    this.requireStore(actor, String(inv.pos_store_id));
    if (inv.status !== "PAUSE_REQUESTED_NOT_VERIFIED") throw new HttpError(409, "INVALID_TRANSITION", `Nothing to verify while ${inv.status}`);
    if (Number(inv.extra_checks) >= 5) throw new HttpError(429, "CHECK_LIMIT", "Readback check limit reached; escalate to Uber Ads support");
    run(db, "UPDATE mp_investigations SET extra_checks = extra_checks + 1 WHERE id = ?", id);
    const rb = await readbackOnce(this.d.ads, String(inv.account_id), String(inv.candidate_campaign_id), 100 + Number(inv.extra_checks) + 1, clock);
    appendAudit(db, clock, { investigationId: id, type: "READBACK", actor: actor.userId, payload: rb });
    const mutationKey = `${inv.pos_store_id}:${inv.candidate_campaign_id}:${inv.event_id}:PAUSE`;
    const resolved = resolveAmbiguous(db, mutationKey, rb, Number(inv.observed_campaign_version));
    if (resolved) appendAudit(db, clock, { investigationId: id, type: "AMBIGUOUS_WRITE_RESOLVED", actor: "orchestrator", payload: { resolvedAs: resolved } });
    const prev = JSON.parse(String(inv.result_json ?? "{}"));
    const extraReadbacks = [...(prev.extraReadbacks ?? []), rb];
    const applied = get(db, "SELECT 1 FROM mp_mutations WHERE mutation_key = ? AND status = 'SUCCEEDED'", mutationKey);
    if (applied && isVerified(rb)) {
      await this.finishVerified(id, String(inv.account_id), String(inv.candidate_campaign_id), prev.digestsBefore?.ads ?? null, prev.digestsBefore?.pos ?? null, { ...prev, extraReadbacks, patchCountForCampaign: await this.patchCount(String(inv.account_id), String(inv.candidate_campaign_id)) });
      return { verified: true, readback: rb };
    }
    const code = resolved === "FAILED_NOT_APPLIED" ? "PAUSE_NOT_APPLIED_UPSTREAM_ERROR" : String(inv.decision_code);
    this.mergeResult(id, { extraReadbacks });
    this.setDecision(id, "PAUSE_REQUESTED_NOT_VERIFIED", code);
    return { verified: false, readback: rb };
  }

  /**
   * Number of applied API changes to this campaign, from the provider's change log
   * (distinct request ids with source API). null when the provider cannot tell.
   */
  private async patchCount(accountId: string, campaignId: string): Promise<number | null> {
    const log = await this.d.ads.getCampaignChangeLog(accountId, campaignId);
    if (!log.available) return null;
    return new Set(log.value.filter((c) => c.source === "API").map((c) => c.requestId ?? `unnamed-${c.at}`)).size;
  }

  private async finishVerified(id: string, accountId: string, campaignId: string, adsBefore: string | null, posBefore: string | null, base: Record<string, unknown>) {
    const adsAfter = await this.d.ads.stateDigest(campaignId);
    const posAfter = await this.d.pos.stateDigest();
    const log = await this.d.ads.getCampaignChangeLog(accountId, campaignId);
    // Same row shape as before CH-1; null when the provider has no change log.
    const ledger = log.available
      ? log.value.filter((c) => c.source === "API").map((c) => ({
          request_id: c.requestId, field: c.field, before_value: c.before, after_value: c.after,
          version_before: c.versionBefore, version_after: c.versionAfter, source: c.source,
        }))
      : null;
    const otherMutations = adsBefore && adsAfter && posBefore && posAfter
      ? (adsBefore === adsAfter && posBefore === posAfter ? "NONE" : "DETECTED")
      : "NOT_VERIFIABLE_WITH_THIS_PROVIDER";
    this.mergeResult(id, { ...base, verifiedAt: this.d.clock.nowIso(), otherMutations, digests: { adsBefore, adsAfter, posBefore, posAfter }, targetLedger: ledger });
    appendAudit(this.d.db, this.d.clock, { investigationId: id, type: "PAUSE_VERIFIED", actor: "orchestrator", payload: { campaignId, otherMutations } });
    this.setDecision(id, "PAUSE_VERIFIED", "PAUSE_VERIFIED");
    this.transition(id, "PAUSE_VERIFIED", "orchestrator");
  }
}
