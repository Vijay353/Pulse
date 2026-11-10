/**
 * Mock Uber Ads — a stateful behavioral simulator of the narrow part of the
 * Uber Ads API this slice uses. NOT a clone and NOT vendor-certified.
 *
 * Mirrors (VERIFIED against the public OpenAPI, 2026-10-18):
 *   GET   /v1/ads/ad-accounts
 *   GET   /v1/ads/{ad_account_id}/stores
 *   GET   /v1/ads/{account_id}/campaigns?campaign_id=   (single campaign = list filter)
 *   PATCH /v1/ads/{account_id}/campaigns  body {campaigns:[{campaign_id, configured_status}]}
 *         → {results:[{success:{id}} | {failure:{error_code,error_message}}]}
 *   429 error body {code:"RateLimitExceeded", message}
 * Mock-only (clearly not Uber):
 *   GET  /mock-ads/{account_id}/reports        (real reporting is async: POST /reporting/report)
 *   POST /mock-ads/faults, GET, DELETE          fault injection
 *   POST /mock-ads/simulate/external-edit       "another manager edits the campaign"
 *   GET  /mock-ads/ledger, /mock-ads/requests   observability
 *   GET  /mock-ads/admin/digest                 simulator-only verification probe
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { all, Db, get, run } from "../../../apps/api/src/db/db";
import type { Clock } from "../../../apps/api/src/clock";
import type { AdsCampaignWire } from "../../contracts/src/index";

export const FAULT_MODES = [
  "HTTP_401", "HTTP_403", "HTTP_404", "HTTP_429", "HTTP_500",
  "HTTP_500_AFTER_APPLY", "DROP_BEFORE_APPLY", "DROP_AFTER_APPLY", "LATENCY", "DELAYED_EFFECTIVE",
] as const;
export const FAULT_OPS = ["PATCH_CAMPAIGNS", "GET_CAMPAIGNS", "GET_REPORTS", "ANY"] as const;

const FaultInput = z.strictObject({
  op: z.enum(FAULT_OPS),
  mode: z.enum(FAULT_MODES),
  remaining: z.number().int().min(1).max(100).default(1),
  param: z.string().max(40).optional(),
});

const PatchBody = z.strictObject({
  campaigns: z
    .array(
      z.object({
        campaign_id: z.string().min(1).max(80),
        name: z.string().max(200).optional(),
        configured_status: z.string().optional(),
        budget: z.unknown().optional(),
      }),
    )
    .min(1)
    .max(50),
});

const tokenHash = (t: string) => createHash("sha256").update(t).digest("hex");

export function seedAdsToken(db: Db, token: string, label = "marginpulse-integration") {
  run(db, "INSERT OR REPLACE INTO ads_tokens VALUES(?,?,?,?)", tokenHash(token), label, "*", "ads.campaigns.read ads.campaigns.write");
}

export function computeEffective(row: Record<string, unknown>, nowWallMs = Date.now()): { status: string; reasons: string[] } {
  const cfg = String(row.configured_status);
  if (cfg === "CAMPAIGN_CONFIGURED_STATUS_DRAFT") return { status: "CAMPAIGN_EFFECTIVE_STATUS_NOT_ELIGIBLE", reasons: ["CAMPAIGN_DRAFT"] };
  if (cfg === "CAMPAIGN_CONFIGURED_STATUS_PAUSED") {
    const after = row.effective_visible_after_ms as number | null;
    if (after && nowWallMs < after) return { status: "CAMPAIGN_EFFECTIVE_STATUS_ACTIVE", reasons: [] }; // propagation delay
    return { status: "CAMPAIGN_EFFECTIVE_STATUS_PAUSED", reasons: ["CAMPAIGN_PAUSED"] };
  }
  return { status: "CAMPAIGN_EFFECTIVE_STATUS_ACTIVE", reasons: [] };
}

export function toWire(row: Record<string, unknown>): AdsCampaignWire {
  const eff = computeEffective(row);
  return {
    campaign_id: String(row.campaign_id),
    name: String(row.name),
    configured_status: String(row.configured_status),
    effective_status: eff.status,
    effective_status_reasons: eff.reasons,
    permissions: JSON.parse(String(row.permissions_json)),
    version: Number(row.version),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    updated_by_email: String(row.updated_by),
    budget: { unit: String(row.budget_unit), total: { amount_e5: Number(row.budget_amount_e5), currency_code: String(row.currency) } },
    product: String(row.product),
    store_ids: JSON.parse(String(row.store_ids_json)),
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function registerMockUberAds(app: FastifyInstance, deps: { db: Db; clock: Clock }) {
  const { db, clock } = deps;

  const takeFault = (op: (typeof FAULT_OPS)[number]) => {
    const f = get(db, "SELECT * FROM ads_faults WHERE remaining > 0 AND (op = ? OR op = 'ANY') ORDER BY id LIMIT 1", op);
    if (!f) return null;
    run(db, "UPDATE ads_faults SET remaining = remaining - 1 WHERE id = ?", f.id);
    return { mode: String(f.mode), param: f.param === null ? null : String(f.param) };
  };
  const logReq = (req: FastifyRequest, status: number | null, fault: string | null) =>
    run(db, "INSERT INTO ads_request_log(method, path, status, fault, at) VALUES(?,?,?,?,?)", req.method, req.url.slice(0, 300), status, fault, clock.nowIso());

  const errorReply = (reply: FastifyReply, req: FastifyRequest, status: number, code: string, message: string, fault: string | null = null) => {
    logReq(req, status, fault);
    return reply.code(status).send({ code, message });
  };

  /** Applies HTTP_* / DROP_BEFORE / LATENCY faults. Returns true if the request was already answered. */
  const preFault = async (req: FastifyRequest, reply: FastifyReply, f: { mode: string; param: string | null } | null) => {
    if (!f) return false;
    switch (f.mode) {
      case "LATENCY": await sleep(Math.min(Number(f.param ?? 1000), 10000)); return false;
      case "HTTP_401": errorReply(reply, req, 401, "Unauthenticated", "Invalid or expired access token.", f.mode); return true;
      case "HTTP_403": errorReply(reply, req, 403, "PermissionDenied", "Caller lacks permission.", f.mode); return true;
      case "HTTP_404": errorReply(reply, req, 404, "NotFound", "Resource not found.", f.mode); return true;
      case "HTTP_429": errorReply(reply, req, 429, "RateLimitExceeded", "Request limit exceeded.", f.mode); return true;
      case "HTTP_500": errorReply(reply, req, 500, "Internal", "Internal error.", f.mode); return true;
      case "DROP_BEFORE_APPLY":
        logReq(req, null, f.mode);
        req.raw.socket.destroy();
        reply.hijack();
        return true;
      default: return false;
    }
  };

  /** Authenticate bearer token and account access. */
  const auth = (req: FastifyRequest, reply: FastifyReply, accountId: string | null, needScope: string) => {
    const h = req.headers.authorization ?? "";
    const m = /^Bearer (.+)$/.exec(h);
    if (!m) { errorReply(reply, req, 401, "Unauthenticated", "Missing bearer token."); return null; }
    const t = get(db, "SELECT * FROM ads_tokens WHERE token_sha256 = ?", tokenHash(m[1]!));
    if (!t) { errorReply(reply, req, 401, "Unauthenticated", "Invalid or expired access token."); return null; }
    if (!String(t.scopes).split(" ").includes(needScope)) { errorReply(reply, req, 403, "PermissionDenied", `Token lacks scope ${needScope}.`); return null; }
    if (accountId) {
      const acct = get(db, "SELECT account_id FROM ads_accounts WHERE account_id = ?", accountId);
      if (!acct) { errorReply(reply, req, 404, "NotFound", "Ad account not found."); return null; }
      const allowed = String(t.account_ids);
      if (allowed !== "*" && !allowed.split(",").includes(accountId)) { errorReply(reply, req, 403, "PermissionDenied", "Token has no access to this ad account."); return null; }
    }
    return { label: String(t.label) };
  };

  app.get("/v1/ads/ad-accounts", async (req, reply) => {
    if (!auth(req, reply, null, "ads.campaigns.read")) return reply;
    logReq(req, 200, null);
    return { ad_accounts: all(db, "SELECT account_id, name, currency FROM ads_accounts ORDER BY account_id") };
  });

  app.get<{ Params: { ad_account_id: string } }>("/v1/ads/:ad_account_id/stores", async (req, reply) => {
    if (!auth(req, reply, req.params.ad_account_id, "ads.campaigns.read")) return reply;
    logReq(req, 200, null);
    return { stores: all(db, "SELECT uber_store_id AS store_id, store_name AS name FROM ads_account_stores WHERE account_id = ? ORDER BY uber_store_id", req.params.ad_account_id) };
  });

  app.get<{ Params: { account_id: string }; Querystring: { campaign_id?: string; page_limit?: string } }>(
    "/v1/ads/:account_id/campaigns",
    async (req, reply) => {
      if (!auth(req, reply, req.params.account_id, "ads.campaigns.read")) return reply;
      if (await preFault(req, reply, takeFault("GET_CAMPAIGNS"))) return reply;
      const limit = Math.min(Number(req.query.page_limit ?? 2000) || 2000, 2000);
      const rows = req.query.campaign_id
        ? all(db, "SELECT * FROM ads_campaigns WHERE account_id = ? AND campaign_id = ?", req.params.account_id, req.query.campaign_id)
        : all(db, "SELECT * FROM ads_campaigns WHERE account_id = ? ORDER BY campaign_id LIMIT ?", req.params.account_id, limit);
      logReq(req, 200, null);
      return { campaigns: rows.map(toWire) };
    },
  );

  app.patch<{ Params: { account_id: string } }>("/v1/ads/:account_id/campaigns", async (req, reply) => {
    const who = auth(req, reply, req.params.account_id, "ads.campaigns.write");
    if (!who) return reply;
    const parsed = PatchBody.safeParse(req.body);
    if (!parsed.success) return errorReply(reply, req, 400, "InvalidArgument", parsed.error.issues[0]?.message ?? "invalid body");
    const fault = takeFault("PATCH_CAMPAIGNS");
    if (await preFault(req, reply, fault)) return reply;
    const requestId = String(req.headers["x-request-id"] ?? `mock-${randomUUID().slice(0, 8)}`);
    const results: unknown[] = [];
    for (const item of parsed.data.campaigns) {
      const row = get(db, "SELECT * FROM ads_campaigns WHERE campaign_id = ? AND account_id = ?", item.campaign_id, req.params.account_id);
      if (!row) { results.push({ failure: { error_code: "NOT_FOUND", error_message: "Campaign not found in this account." } }); continue; }
      const perms = JSON.parse(String(row.permissions_json)) as string[];
      if (!perms.includes("UPDATE")) { results.push({ failure: { error_code: "PERMISSION_DENIED", error_message: "Caller lacks UPDATE on this campaign." } }); continue; }
      if (item.configured_status !== undefined && !["CAMPAIGN_CONFIGURED_STATUS_ACTIVE", "CAMPAIGN_CONFIGURED_STATUS_PAUSED"].includes(item.configured_status)) {
        results.push({ failure: { error_code: "INVALID_ARGUMENT", error_message: "configured_status must be ACTIVE or PAUSED." } }); continue;
      }
      if (item.budget !== undefined) { results.push({ failure: { error_code: "UNSUPPORTED_IN_MOCK", error_message: "Budget updates are not modeled by this simulator." } }); continue; }
      const next = item.configured_status ?? String(row.configured_status);
      const nextName = item.name ?? String(row.name);
      if (next === row.configured_status && nextName === row.name) { results.push({ success: { id: item.campaign_id } }); continue; }
      const vNext = Number(row.version) + 1;
      const delayMs = fault?.mode === "DELAYED_EFFECTIVE" && next === "CAMPAIGN_CONFIGURED_STATUS_PAUSED" ? Date.now() + Math.min(Number(fault.param ?? 4000), 600000) : null;
      run(db, "UPDATE ads_campaigns SET configured_status = ?, name = ?, version = ?, updated_at = ?, updated_by = ?, effective_visible_after_ms = ? WHERE campaign_id = ?",
        next, nextName, vNext, clock.nowIso(), who.label, delayMs, item.campaign_id);
      if (next !== row.configured_status)
        run(db, "INSERT INTO ads_mutation_ledger(request_id, account_id, campaign_id, field, before_value, after_value, version_before, version_after, actor, source, at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
          requestId, req.params.account_id, item.campaign_id, "configured_status", row.configured_status, next, row.version, vNext, who.label, "API", clock.nowIso());
      if (nextName !== row.name)
        run(db, "INSERT INTO ads_mutation_ledger(request_id, account_id, campaign_id, field, before_value, after_value, version_before, version_after, actor, source, at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
          requestId, req.params.account_id, item.campaign_id, "name", row.name, nextName, row.version, vNext, who.label, "API", clock.nowIso());
      results.push({ success: { id: item.campaign_id } });
    }
    if (fault?.mode === "DROP_AFTER_APPLY") {
      logReq(req, null, fault.mode);
      req.raw.socket.destroy();
      reply.hijack();
      return reply;
    }
    if (fault?.mode === "HTTP_500_AFTER_APPLY") return errorReply(reply, req, 500, "Internal", "Internal error.", fault.mode);
    logReq(req, 200, fault?.mode ?? null);
    return { results };
  });

  // ---- Mock-only reporting (real API is asynchronous) ----
  app.get<{ Params: { account_id: string }; Querystring: { campaign_id?: string } }>("/mock-ads/:account_id/reports", async (req, reply) => {
    if (!auth(req, reply, req.params.account_id, "ads.campaigns.read")) return reply;
    if (await preFault(req, reply, takeFault("GET_REPORTS"))) return reply;
    const rows = req.query.campaign_id
      ? all(db, "SELECT * FROM ads_reports WHERE account_id = ? AND campaign_id = ? ORDER BY watermark DESC", req.params.account_id, req.query.campaign_id)
      : all(db, "SELECT * FROM ads_reports WHERE account_id = ? ORDER BY watermark DESC", req.params.account_id);
    logReq(req, 200, null);
    return { reports: rows };
  });

  // ---- Simulator controls ----
  app.post("/mock-ads/faults", async (req, reply) => {
    const p = FaultInput.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: p.error.issues[0]?.message });
    run(db, "INSERT INTO ads_faults(op, mode, remaining, param) VALUES(?,?,?,?)", p.data.op, p.data.mode, p.data.remaining, p.data.param ?? null);
    return { armed: all(db, "SELECT * FROM ads_faults WHERE remaining > 0") };
  });
  app.get("/mock-ads/faults", async () => ({ armed: all(db, "SELECT * FROM ads_faults WHERE remaining > 0") }));
  app.delete("/mock-ads/faults", async () => { run(db, "DELETE FROM ads_faults"); return { armed: [] }; });

  app.post("/mock-ads/simulate/external-edit", async (req, reply) => {
    const b = z.strictObject({ campaign_id: z.string() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "campaign_id required" });
    const row = get(db, "SELECT * FROM ads_campaigns WHERE campaign_id = ?", b.data.campaign_id);
    if (!row) return reply.code(404).send({ error: "unknown campaign" });
    const newName = String(row.name).endsWith(" (edited)") ? String(row.name) : `${row.name} (edited)`;
    const v = Number(row.version) + 1;
    run(db, "UPDATE ads_campaigns SET name = ?, version = ?, updated_at = ?, updated_by = ? WHERE campaign_id = ?", newName, v, clock.nowIso(), "other-manager@synthetic.example", b.data.campaign_id);
    run(db, "INSERT INTO ads_mutation_ledger(request_id, account_id, campaign_id, field, before_value, after_value, version_before, version_after, actor, source, at) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
      null, row.account_id, b.data.campaign_id, "name", row.name, newName, row.version, v, "other-manager@synthetic.example", "EXTERNAL_SIM", clock.nowIso());
    return { campaign: toWire(get(db, "SELECT * FROM ads_campaigns WHERE campaign_id = ?", b.data.campaign_id)!) };
  });

  app.get<{ Querystring: { campaign_id?: string; order?: string; limit?: string } }>("/mock-ads/ledger", async (req) => {
    const desc = req.query.order === "desc";
    const limit = Math.min(Math.max(Number(req.query.limit ?? 100000) || 100000, 1), 100000);
    const rows = req.query.campaign_id
      ? all(db, `SELECT * FROM ads_mutation_ledger WHERE campaign_id = ? ORDER BY seq ${desc ? "DESC" : "ASC"} LIMIT ?`, req.query.campaign_id, limit)
      : all(db, `SELECT * FROM ads_mutation_ledger ORDER BY seq ${desc ? "DESC" : "ASC"} LIMIT ?`, limit);
    return { ledger: rows };
  });
  app.get("/mock-ads/requests", async () => ({ requests: all(db, "SELECT * FROM ads_request_log ORDER BY seq") }));

  /** Simulator-only probe: digest of all campaign/account/report state except one campaign. */
  app.get<{ Querystring: { exclude_campaign?: string } }>("/mock-ads/admin/digest", async (req) => {
    const ex = req.query.exclude_campaign ?? "";
    const parts = [
      all(db, "SELECT campaign_id, account_id, name, product, configured_status, store_ids_json, permissions_json, budget_unit, budget_amount_e5, version FROM ads_campaigns WHERE campaign_id <> ? ORDER BY campaign_id", ex),
      all(db, "SELECT * FROM ads_reports ORDER BY report_id"),
      all(db, "SELECT * FROM ads_accounts ORDER BY account_id"),
      all(db, "SELECT * FROM ads_account_stores ORDER BY account_id, uber_store_id"),
    ];
    return { digest: createHash("sha256").update(JSON.stringify(parts)).digest("hex") };
  });
}
