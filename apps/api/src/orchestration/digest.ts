/**
 * CH-9 / CH-20: read-only aggregates over persisted MarginPulse rows.
 *
 * Allow-listed metrics only: counts of investigations by outcome, PATCH
 * requests actually sent, verification rate and time to a manager decision on
 * the scenario clock. No money saved, orders rescued, ROI or any other figure
 * that would need evidence MarginPulse does not have. Rates are integer basis
 * points so nothing is rounded on the server.
 *
 * Scope note: "Load scenario" rebuilds the database, so in the demo these
 * numbers cover everything since the scenario was loaded.
 */
import { all, Db, kvGet } from "../db/db";

export interface Digest {
  scope: { storeIds: string[] | "ALL"; since: "SCENARIO_LOADED"; scenario: string | null };
  investigated: number;
  recommended: number;
  pausesVerified: number;
  pausesNotVerified: number;
  keptActive: number;
  noAction: number;
  needsReview: number;
  blocked: number;
  open: number;
  patchRequestsSent: number;
  /** Investigations where a pause was sent and the result was checked. */
  verificationRateBps: number | null;
  /** Investigations that ended without any change (no action, review, blocked, kept active) / closed investigations. */
  nonActionRateBps: number | null;
  /** Mean seconds from recommendation to the manager's approve/keep decision, scenario clock. null when none. */
  meanSecondsToDecision: number | null;
  decisionsTimed: number;
}

const bps = (n: number, d: number) => (d === 0 ? null : Math.round((n * 10000) / d));

export function summarize(db: Db, storeIds: string[] | null): Digest {
  const where = storeIds ? `WHERE pos_store_id IN (${storeIds.map(() => "?").join(",") || "NULL"})` : "";
  const args = storeIds ?? [];
  const invs = all(db, `SELECT id, status, recommended_at FROM mp_investigations ${where}`, ...args);
  const ids = invs.map((i) => String(i.id));
  const count = (s: string) => invs.filter((i) => i.status === s).length;
  const inList = ids.map(() => "?").join(",") || "NULL";
  const sent = ids.length ? all(db, `SELECT investigation_id, COUNT(*) AS n FROM mp_mutations WHERE request_id <> 'not-sent' AND investigation_id IN (${inList}) GROUP BY investigation_id`, ...ids) : [];
  const patchRequestsSent = sent.reduce((a, r) => a + Number(r.n), 0);
  const attempted = new Set(sent.map((r) => String(r.investigation_id)));
  const verified = invs.filter((i) => i.status === "PAUSE_VERIFIED").length;

  // Time to decision: recommendation time → first MANAGER_APPROVED or MANAGER_DISMISSED audit entry.
  const decisions = ids.length ? all(db, `SELECT investigation_id, MIN(at_sim) AS at FROM mp_audit WHERE type IN ('MANAGER_APPROVED','MANAGER_DISMISSED') AND investigation_id IN (${inList}) GROUP BY investigation_id`, ...ids) : [];
  const durations: number[] = [];
  for (const d of decisions) {
    const rec = invs.find((i) => i.id === d.investigation_id)?.recommended_at;
    if (!rec) continue;
    const s = Math.round((Date.parse(String(d.at)) - Date.parse(String(rec))) / 1000);
    if (Number.isFinite(s) && s >= 0) durations.push(s);
  }
  const noAction = count("NO_ACTION"), needsReview = count("NEEDS_REVIEW"), blocked = count("BLOCKED"), keptActive = count("DISMISSED");
  const closed = noAction + needsReview + blocked + keptActive + verified;
  return {
    scope: { storeIds: storeIds ?? "ALL", since: "SCENARIO_LOADED", scenario: kvGet(db, "scenario") ?? null },
    investigated: invs.length,
    recommended: invs.filter((i) => i.recommended_at).length,
    pausesVerified: verified,
    pausesNotVerified: count("PAUSE_REQUESTED_NOT_VERIFIED"),
    keptActive, noAction, needsReview, blocked,
    open: invs.filter((i) => ["RECEIVED", "ASSESSING", "RECOMMENDATION_READY", "AWAITING_APPROVAL", "APPROVED", "PAUSE_REQUESTED"].includes(String(i.status))).length,
    patchRequestsSent,
    verificationRateBps: bps([...attempted].filter((id) => invs.find((i) => i.id === id)?.status === "PAUSE_VERIFIED").length, attempted.size),
    nonActionRateBps: bps(noAction + needsReview + blocked + keptActive, closed),
    meanSecondsToDecision: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
    decisionsTimed: durations.length,
  };
}
