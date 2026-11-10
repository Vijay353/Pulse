/**
 * Agent output gate. A report is accepted only if it is schema-valid, scoped to
 * this investigation, every citation resolves to stored evidence, cited values
 * match that evidence, and the text makes no banned claims.
 */
import { AgentReport, findBannedClaim } from "../../../../packages/contracts/src/index";
import type { Db } from "../db/db";
import { evidenceRow } from "./toolRegistry";

export interface AgentValidation {
  schemaValid: boolean;
  citationsResolve: boolean;
  problems: string[];
  report: AgentReport | null;
}

export function validateAgentReport(db: Db, investigationId: string, posStoreId: string, raw: unknown): AgentValidation {
  const problems: string[] = [];
  const parsed = AgentReport.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { schemaValid: false, citationsResolve: false, problems: [`schema: ${issue?.path.join(".")} ${issue?.message}`], report: null };
  }
  const r = parsed.data;
  if (r.investigationId !== investigationId) problems.push("report is for a different investigation");
  if (r.storeId !== posStoreId) problems.push("report is for a different store");
  const banned = findBannedClaim([r.summary, ...r.assumptions].join(" "));
  if (banned) problems.push(`banned claim in text (${banned})`);
  const schemaValid = problems.length === 0;

  let citationsResolve = true;
  for (const o of r.observations) {
    const ev = evidenceRow(db, investigationId, o.evidenceRef);
    if (!ev) { citationsResolve = false; problems.push(`citation ${o.evidenceRef} does not resolve`); continue; }
    const p = ev.payload;
    const kind = String(ev.kind);
    if (o.type === "KITCHEN_THRESHOLD_BREACH" || o.type === "KITCHEN_BELOW_THRESHOLD") {
      if (kind !== "KITCHEN_SNAPSHOT" || Number(p.p95PrepMinutes) !== Number(o.value)) { citationsResolve = false; problems.push(`${o.type} value ${o.value} does not match ${o.evidenceRef}`); }
    }
    if (o.type === "ACTIVE_SPONSORED_LISTING") {
      if (kind !== "CAMPAIGN" || p.campaignId !== o.value) { citationsResolve = false; problems.push(`ACTIVE_SPONSORED_LISTING ${o.value} does not match ${o.evidenceRef}`); }
    }
    if (o.type === "CONTRIBUTION_BELOW_FLOOR" || o.type === "CONTRIBUTION_AT_OR_ABOVE_FLOOR") {
      const res = (p.result ?? {}) as { ok?: boolean; rateBps?: number };
      if (kind !== "CALCULATION" || !res.ok || Math.abs(Number(res.rateBps) / 10000 - Number(o.value)) > 0.0006) {
        citationsResolve = false; problems.push(`${o.type} value ${o.value} does not match ${o.evidenceRef}`);
      }
    }
  }
  if (r.candidateAction === "PAUSE_SPONSORED_LISTING") {
    if (!r.candidateCampaignId) { citationsResolve = false; problems.push("pause proposed without a campaign"); }
    else if (!evidenceRow(db, investigationId, `campaign-read-${r.candidateCampaignId}-v${findVersion(db, investigationId, r.candidateCampaignId)}`)) {
      citationsResolve = false; problems.push(`candidate campaign ${r.candidateCampaignId} was never read in this investigation`);
    }
  }
  return { schemaValid, citationsResolve, problems, report: r };
}

function findVersion(db: Db, investigationId: string, campaignId: string): string {
  const row = db.prepare("SELECT evidence_id FROM mp_evidence WHERE investigation_id = ? AND kind = 'CAMPAIGN' AND evidence_id LIKE ? ORDER BY rowid DESC LIMIT 1")
    .get(investigationId, `campaign-read-${campaignId}-v%`) as { evidence_id?: string } | undefined;
  return row?.evidence_id ? row.evidence_id.split("-v").pop()! : "none";
}
