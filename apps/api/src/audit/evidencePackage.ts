/**
 * Audit evidence package for one investigation (V3 CH-18).
 * Built only from MarginPulse's own persisted records. Canonical JSON (keys
 * sorted at every level) so the same records always give the same bytes.
 * The SHA-256 digest is a file checksum, not a signature.
 */
import { createHash } from "node:crypto";
import { all, Db, get } from "../db/db";
import type { Clock } from "../clock";
import { verifyChain } from "./audit";
import { evidenceMatrixFor } from "../orchestration/viewModel";

export const PACKAGE_SCHEMA = "marginpulse-evidence-package/1";
const TERMINAL = ["PAUSE_VERIFIED", "DISMISSED", "NO_ACTION", "NEEDS_REVIEW", "BLOCKED"];
const j = (v: unknown) => (v === null || v === undefined ? null : JSON.parse(String(v)));

/** Deterministic JSON: object keys sorted recursively; arrays keep their order. */
export function canonicalJson(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === "object") return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, norm((v as Record<string, unknown>)[k])]));
    return v;
  };
  return JSON.stringify(norm(value), null, 2) + "\n";
}

export function buildEvidencePackage(db: Db, clock: Clock, id: string, exportedBy: { userId: string; role: string }) {
  const inv = get(db, "SELECT * FROM mp_investigations WHERE id = ?", id);
  if (!inv) return null;
  const eventRow = get(db, "SELECT payload_json, received_at, delivery_count FROM mp_events WHERE event_id = ?", inv.event_id);
  const event = j(eventRow?.payload_json) as Record<string, unknown> | null;
  const evidence = all(db, "SELECT evidence_id, kind, tool, args_json, payload_json, read_at FROM mp_evidence WHERE investigation_id = ? ORDER BY rowid", id)
    .map((e) => ({ evidenceId: String(e.evidence_id), kind: String(e.kind), tool: String(e.tool), args: j(e.args_json), payload: j(e.payload_json), readAt: String(e.read_at) }));
  const policyEv = evidence.find((e) => e.kind === "POLICY");
  const approvals = all(db, "SELECT * FROM mp_approvals WHERE investigation_id = ? ORDER BY created_at, approval_id", id);
  const writes = all(db, "SELECT attempt, request_id, status, error_code, request_json, response_json, started_at, finished_at, approval_id FROM mp_mutations WHERE investigation_id = ? ORDER BY attempt", id)
    .map((m) => ({ attempt: Number(m.attempt), requestId: String(m.request_id), approvalId: String(m.approval_id), status: String(m.status), errorCode: m.error_code ?? null, request: j(m.request_json), response: j(m.response_json), startedAt: m.started_at, finishedAt: m.finished_at ?? null }));
  const result = (j(inv.result_json) ?? {}) as Record<string, unknown>;
  const tool = result.tool as { detail?: { readbacks?: unknown[] } } | undefined;
  const readbacks = [...(tool?.detail?.readbacks ?? []), ...((result.extraReadbacks as unknown[] | undefined) ?? [])];
  const audit = all(db, "SELECT seq, type, at_sim, at_wall, actor, payload_json, prev_hash, hash, hash_version FROM mp_audit WHERE investigation_id = ? ORDER BY seq", id)
    .map((a) => ({ seq: Number(a.seq), type: String(a.type), atSim: String(a.at_sim), atWall: String(a.at_wall), actor: String(a.actor), payload: j(a.payload_json), prevHash: String(a.prev_hash), hash: String(a.hash), hashFormat: a.hash_version === null ? 1 : Number(a.hash_version) }));
  const chain = verifyChain(db);
  const children = all(db, "SELECT id FROM mp_investigations WHERE parent_id = ? ORDER BY rowid", id).map((r) => String(r.id));

  const reasons: string[] = [];
  if (!TERMINAL.includes(String(inv.status))) reasons.push(`the investigation is still open (${inv.status})`);
  if (!policyEv) reasons.push("no policy snapshot was recorded at decision time");
  if (writes.some((w) => w.requestId !== "not-sent") && readbacks.length === 0) reasons.push("a write was attempted but no readback was recorded");
  if (!event) reasons.push("the triggering event record is missing");
  const evidenceStatus = !chain.ok ? "unverifiable" : reasons.length ? "partial" : "complete";
  if (!chain.ok) reasons.unshift(`the audit chain does not verify (entry ${chain.brokenAt}: ${chain.problem})`);

  return {
    schema: PACKAGE_SCHEMA,
    title: "Audit evidence package",
    notice: "Built from synthetic demo records. The digest is a SHA-256 file checksum, not a digital signature. Not a compliance certification.",
    exported: { scenarioTime: clock.nowIso(), wallTime: new Date().toISOString(), by: { ...exportedBy, identity: "demo identity header, not authentication" } },
    evidenceStatus: { status: evidenceStatus, reasons },
    investigation: {
      id, parentId: inv.parent_id ?? null, childIds: children, eventId: String(inv.event_id), posStoreId: String(inv.pos_store_id),
      uberStoreId: inv.uber_store_id ?? null, accountId: inv.account_id ?? null, campaignId: inv.candidate_campaign_id ?? null,
      observedCampaignVersion: inv.observed_campaign_version ?? null, status: String(inv.status), decision: inv.decision ?? null,
      decisionCode: inv.decision_code ?? null, dismissReason: inv.dismiss_reason ?? null, createdAt: String(inv.created_at), updatedAt: String(inv.updated_at),
    },
    event: event ? { ...event, signature: `${String(event.signature).slice(0, 8)}... (HMAC, truncated)`, receivedAt: eventRow?.received_at ?? null, deliveryCount: Number(eventRow?.delivery_count ?? 0) } : null,
    policyAtDecision: policyEv
      ? { available: true, evidenceRef: policyEv.evidenceId, snapshot: policyEv.payload }
      : { available: false, note: "No policy snapshot was recorded; today's policy is not substituted." },
    decisionChecks: j(inv.policy_checks_json) ?? [],
    evidenceMatrix: evidenceMatrixFor(db, id),
    executionChecks: result.executionChecks ?? [],
    investigator: { ...((j(inv.agent_report_json) as object | null) ?? {}), validation: j(inv.agent_validation_json) },
    evidence,
    approvals: approvals.map((a) => ({ approvalId: String(a.approval_id), approvedBy: String(a.approved_by), campaignId: String(a.campaign_id), action: String(a.action), policyVersion: String(a.policy_version), createdAt: String(a.created_at), expiresAt: String(a.expires_at), consumedAt: a.consumed_at ?? null })),
    writes,
    readbacks,
    outcome: { verifiedAt: result.verifiedAt ?? null, otherMutations: result.otherMutations ?? null, campaignChangeLog: result.targetLedger ?? null, appliedChangesToCampaign: result.patchCountForCampaign ?? null },
    audit,
    integrity: {
      chain: { ok: chain.ok, length: chain.length, firstSeq: chain.firstSeq, headSeq: chain.headSeq, head: chain.head, coverage: chain.coverage, brokenAt: chain.brokenAt, problem: chain.problem, gaps: chain.gaps },
      thisInvestigation: { entries: audit.length, firstSeq: audit[0]?.seq ?? null, lastSeq: audit[audit.length - 1]?.seq ?? null },
      limits: chain.limits,
      howToCheckDigest: "Compute SHA-256 of this exact file (for example: sha256sum <file>) and compare it with the X-Evidence-SHA256 response header recorded at download.",
    },
  };
}

export function serializePackage(pkg: object) {
  const body = canonicalJson(pkg);
  return { body, sha256: createHash("sha256").update(body, "utf8").digest("hex") };
}
