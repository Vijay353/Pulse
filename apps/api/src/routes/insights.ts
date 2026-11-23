/**
 * Read-only insight routes (CH-9 digest, CH-18 fleet, CH-20 metrics).
 * Nothing here writes. Store-scoped reads use the same demo-identity store
 * assignment as the evidence package; the fleet view is additionally gated by
 * plan (CH-17), on the server.
 */
import type { FastifyInstance } from "fastify";
import { all, Db, get } from "../db/db";
import type { AppConfig } from "../config";
import type { PosPort, UberAdsPort } from "../adapters/ports";
import { HttpError } from "../orchestration/orchestrator";
import { summarize } from "../orchestration/digest";
import { resolveActor, sendError } from "./api";
import { planAllows, planName, requiredPlan } from "../../../../packages/contracts/src/plans";

export function registerInsightRoutes(app: FastifyInstance, d: { db: Db; config: AppConfig; ads: UberAdsPort; pos: PosPort }) {
  const { db, config } = d;

  /** CH-9: shift digest for one store the identity is assigned to. */
  app.get<{ Querystring: { store?: string } }>("/api/digest", async (req, reply) => {
    try {
      const actor = resolveActor(db, req);
      const store = String(req.query.store ?? "");
      if (!actor.stores.includes(store)) throw new HttpError(403, "NOT_AUTHORIZED", `${actor.userId} is not assigned to ${store || "that store"}`);
      return summarize(db, [store]);
    } catch (e) {
      return sendError(reply, e);
    }
  });

  /** CH-20: counts across every store, for the pitch metrics strip. Counts only; no ids, names or money. */
  app.get("/api/metrics", async () => summarize(db, null));

  /** CH-18: the stores this identity is assigned to, with the last alert and a live campaign read. Group plan and up. */
  app.get("/api/fleet", async (req, reply) => {
    try {
      const actor = resolveActor(db, req);
      if (!planAllows(config.plan, "fleet_view")) {
        const need = requiredPlan("fleet_view");
        throw new HttpError(403, "PLAN_REQUIRED", `The fleet view is part of the ${planName(need)} plan. This deployment runs the ${planName(config.plan)} plan. Each store is still fully usable on its own.`);
      }
      const stores = [];
      for (const storeId of actor.stores) {
        const profile = await d.pos.getStoreProfile(storeId);
        const last = get(db, "SELECT id, status, decision_code, created_at, account_id, candidate_campaign_id FROM mp_investigations WHERE pos_store_id = ? ORDER BY rowid DESC LIMIT 1", storeId);
        let campaign: { campaignId: string; configuredStatus: string; serving: string; version: number } | null = null;
        let campaignReadError: string | null = null;
        if (last?.account_id && last.candidate_campaign_id) {
          const r = await d.ads.getCampaign(String(last.account_id), String(last.candidate_campaign_id));
          if (r.ok && r.value) campaign = { campaignId: r.value.campaignId, configuredStatus: r.value.configuredStatus, serving: r.value.serving, version: r.value.version };
          else if (!r.ok) campaignReadError = r.error.kind;
        }
        const openCount = Number(get(db, "SELECT COUNT(*) AS n FROM mp_investigations WHERE pos_store_id = ? AND status IN ('AWAITING_APPROVAL','APPROVED','PAUSE_REQUESTED_NOT_VERIFIED')", storeId)?.n ?? 0);
        stores.push({
          storeId,
          name: profile.ok ? profile.value.name : null,
          lastInvestigation: last ? { id: String(last.id), status: String(last.status), decisionCode: last.decision_code ? String(last.decision_code) : null, createdAt: String(last.created_at) } : null,
          needsAttention: openCount,
          campaign, campaignReadError,
          canApprove: actor.role === "MANAGER",
        });
      }
      return { plan: config.plan, stores, investigationsTotal: all(db, "SELECT id FROM mp_investigations").length };
    } catch (e) {
      return sendError(reply, e);
    }
  });
}
