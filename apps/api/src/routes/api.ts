import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { all, Db, get, kvGet, run } from "../db/db";
import type { Clock } from "../clock";
import type { AppConfig } from "../config";
import { Actor, HttpError, Orchestrator } from "../orchestration/orchestrator";
import type { PosPort, SimulatorConsolePort, UberAdsPort } from "../adapters/ports";
import { buildInvestigationView } from "../orchestration/viewModel";
import { resetWorld } from "../orchestration/world";
import { auditFor, appendAudit, verifyChain } from "../audit/audit";
import { buildEvidencePackage, serializePackage } from "../audit/evidencePackage";
import { SCENARIOS } from "../../../../packages/fixtures/src/scenarios";
import { currentPolicy } from "../agents/toolRegistry";

export interface ApiDeps {
  db: Db;
  clock: Clock;
  config: AppConfig;
  orchestrator: Orchestrator;
  ads: UberAdsPort;
  pos: PosPort;
  simConsole: SimulatorConsolePort;
  problems: { component: string; problem: string }[];
  investigatorName: string | null;
}

const parseCookies = (h?: string) =>
  Object.fromEntries((h ?? "").split(";").map((p) => p.trim().split("=")).filter((x) => x.length === 2).map(([k, v]) => [k, decodeURIComponent(v!)]));

export function requireCsrf(req: FastifyRequest) {
  const cookie = parseCookies(req.headers.cookie).mp_csrf ?? "";
  const header = String(req.headers["x-csrf-token"] ?? "");
  if (!cookie || cookie.length !== header.length || !timingSafeEqual(Buffer.from(cookie), Buffer.from(header)))
    throw new HttpError(403, "CSRF", "Missing or invalid CSRF token. Reload the page.");
}

/** LOCAL DEMO IDENTITY — not authentication. The header picks a synthetic user. */
export function resolveActor(db: Db, req: FastifyRequest): Actor {
  const userId = String(req.headers["x-demo-user"] ?? "");
  const u = get(db, "SELECT * FROM mp_users WHERE user_id = ?", userId);
  if (!u) throw new HttpError(401, "UNKNOWN_USER", "Choose a demo identity");
  const stores = all(db, "SELECT pos_store_id FROM mp_user_stores WHERE user_id = ?", userId).map((r) => String(r.pos_store_id));
  return { userId, role: String(u.role), stores };
}

export function sendError(reply: FastifyReply, e: unknown) {
  if (e instanceof HttpError) return reply.code(e.status).send({ error: e.code, message: e.message });
  console.error(e);
  return reply.code(500).send({ error: "INTERNAL", message: "Unexpected error; see server log" });
}

export function registerApiRoutes(app: FastifyInstance, d: ApiDeps) {
  const { db, clock, orchestrator } = d;

  const guarded = (handler: (req: FastifyRequest, reply: FastifyReply, actor: Actor) => Promise<unknown> | unknown, opts: { csrf?: boolean } = { csrf: true }) =>
    async (req: FastifyRequest, reply: FastifyReply) => {
      try {
        if (opts.csrf !== false) requireCsrf(req);
        const actor = resolveActor(db, req);
        return await handler(req, reply, actor);
      } catch (e) {
        return sendError(reply, e);
      }
    };

  app.get("/api/health", async () => ({
    ok: d.problems.length === 0,
    adsMode: d.config.adsMode,
    adsProvider: d.ads.label,
    posProvider: d.pos.label,
    investigator: d.investigatorName,
    problems: d.problems,
    clock: clock.nowIso(),
    scenario: kvGet(db, "scenario"),
    accessGate: d.config.access.gate,
  }));

  app.get("/api/session", async (req, reply) => {
    let token = parseCookies(req.headers.cookie).mp_csrf;
    if (!token || !/^[0-9a-f]{32}$/.test(token)) {
      token = randomBytes(16).toString("hex");
      reply.header("set-cookie", `mp_csrf=${token}; Path=/; SameSite=Strict; HttpOnly`);
    }
    return {
      csrfToken: token,
      users: all(db, "SELECT u.user_id, u.display_name, u.role, GROUP_CONCAT(s.pos_store_id) AS stores FROM mp_users u LEFT JOIN mp_user_stores s ON s.user_id = u.user_id GROUP BY u.user_id ORDER BY u.user_id"),
      notice: "Demo identity switcher — not production authentication.",
    };
  });

  /* ---- webhook: authenticated by HMAC signature, not CSRF ---- */
  app.post("/api/events/kitchen-load", async (req, reply) => {
    try {
      const r = await orchestrator.receiveEvent(req.body);
      return reply.code(r.status).send(r.body);
    } catch (e) {
      return sendError(reply, e);
    }
  });

  app.get("/api/investigations", async () => ({
    investigations: all(db, "SELECT id, event_id, parent_id, pos_store_id, status, decision, decision_code, created_at FROM mp_investigations ORDER BY rowid DESC LIMIT 50"),
  }));

  app.get<{ Params: { id: string } }>("/api/investigations/:id", async (req, reply) => {
    const viewerId = typeof req.headers["x-demo-user"] === "string" ? req.headers["x-demo-user"].slice(0, 80) : null;
    const v = await buildInvestigationView(db, clock, d.ads, d.pos, req.params.id, viewerId);
    if (!v) return reply.code(404).send({ error: "NOT_FOUND" });
    return v;
  });

  app.get<{ Params: { id: string } }>("/api/investigations/:id/audit", async (req, reply) => {
    if (!get(db, "SELECT 1 FROM mp_investigations WHERE id = ?", req.params.id)) return reply.code(404).send({ error: "NOT_FOUND" });
    return { investigationId: req.params.id, events: auditFor(db, req.params.id), chain: verifyChain(db) };
  });
  app.get("/api/audit/verify", async () => verifyChain(db));

  /** CH-18: evidence package for one investigation. Read scope = demo identity assigned to the store. No mutation. */
  app.get<{ Params: { id: string } }>("/api/investigations/:id/evidence-package", async (req, reply) => {
    try {
      const actor = resolveActor(db, req);
      const inv = get(db, "SELECT pos_store_id FROM mp_investigations WHERE id = ?", req.params.id);
      if (!inv) return reply.code(404).send({ error: "NOT_FOUND" });
      if (!actor.stores.includes(String(inv.pos_store_id))) throw new HttpError(403, "NOT_AUTHORIZED", `${actor.userId} is not assigned to ${inv.pos_store_id}`);
      const pkg = buildEvidencePackage(db, clock, req.params.id, { userId: actor.userId, role: actor.role });
      const { body, sha256 } = serializePackage(pkg!);
      const safeId = req.params.id.replace(/[^A-Za-z0-9._-]/g, "_");
      reply.header("content-disposition", `attachment; filename="audit-evidence-${safeId}.json"`);
      reply.header("x-evidence-sha256", sha256);
      reply.header("x-evidence-status", pkg!.evidenceStatus.status);
      reply.header("cache-control", "no-store");
      return reply.type("application/json; charset=utf-8").send(body);
    } catch (e) {
      return sendError(reply, e);
    }
  });

  const ApproveBody = z.object({ acknowledgeWarnings: z.array(z.string().max(40)).max(5).optional() });
  app.post<{ Params: { id: string } }>("/api/investigations/:id/approve", guarded((req, _r, actor) => {
    const b = ApproveBody.safeParse(req.body ?? {});
    if (!b.success) throw new HttpError(400, "BAD_REQUEST", "acknowledgeWarnings must be a short list of warning codes");
    const a = orchestrator.approve((req.params as { id: string }).id, actor, b.data.acknowledgeWarnings ?? []);
    return { approvalId: a.approval_id, expiresAt: a.expires_at };
  }));

  const DismissBody = z.strictObject({ reason: z.string().trim().min(1).max(200) });
  app.post<{ Params: { id: string } }>("/api/investigations/:id/dismiss", guarded((req, _r, actor) => {
    const b = DismissBody.safeParse(req.body);
    if (!b.success) throw new HttpError(400, "REASON_REQUIRED", "A short reason is required");
    orchestrator.dismiss((req.params as { id: string }).id, actor, b.data.reason);
    return { ok: true };
  }));

  const PauseBody = z.strictObject({ approvalId: z.string().min(1).max(40) });
  app.post<{ Params: { id: string } }>("/api/investigations/:id/pause-campaign", guarded(async (req, _r, actor) => {
    const b = PauseBody.safeParse(req.body);
    if (!b.success) throw new HttpError(400, "APPROVAL_REQUIRED", "approvalId is required; approve first");
    const r = await orchestrator.pause((req.params as { id: string }).id, actor, b.data.approvalId);
    return { ok: true, ...r };
  }));

  app.post<{ Params: { id: string } }>("/api/investigations/:id/verify", guarded(async (req, _r, actor) => orchestrator.verify((req.params as { id: string }).id, actor)));
  app.post<{ Params: { id: string } }>("/api/investigations/:id/reassess", guarded(async (req, _r, actor) => ({ investigationId: await orchestrator.reassess((req.params as { id: string }).id, actor) })));

  /* ---- policy + approval services (spec §15.3, §15.4) ---- */
  app.get<{ Params: { storeId: string } }>("/policies/:storeId/rush-control", async (req, reply) => {
    const p = currentPolicy(db, req.params.storeId);
    if (!p) return reply.code(404).send({ error: "NO_POLICY" });
    return { ...p, approval_required: Number(p.approval_required) === 1, is_current: true, id: `${p.policy_id}-${p.version}` };
  });
  app.post("/approvals", guarded((req, _r, actor) => {
    const b = z.strictObject({ investigationId: z.string(), acknowledgeWarnings: z.array(z.string().max(40)).max(5).optional() }).safeParse(req.body);
    if (!b.success) throw new HttpError(400, "BAD_REQUEST", "investigationId required");
    return orchestrator.approve(b.data.investigationId, actor, b.data.acknowledgeWarnings ?? []);
  }));
  app.get<{ Params: { approvalId: string } }>("/approvals/:approvalId", async (req, reply) => {
    const a = get(db, "SELECT * FROM mp_approvals WHERE approval_id = ?", req.params.approvalId);
    return a ?? reply.code(404).send({ error: "NOT_FOUND" });
  });

  /* ---- simulator controls (demo only) ---- */
  app.get("/api/scenarios", async () => ({ scenarios: SCENARIOS.map(({ overlay: _o, faults, ...s }) => ({ ...s, faults: faults ?? [] })), current: kvGet(db, "scenario") }));

  app.post<{ Params: { id: string } }>("/api/scenarios/:id/load", async (req, reply) => {
    try {
      requireCsrf(req);
      const s = resetWorld(db, clock, d.config.adsToken, req.params.id);
      return { loaded: s.id, clock: clock.nowIso() };
    } catch (e) {
      if (e instanceof HttpError) return sendError(reply, e);
      return reply.code(404).send({ error: "UNKNOWN_SCENARIO", message: (e as Error).message });
    }
  });

  app.post("/api/sim/clock/advance", async (req, reply) => {
    try {
      requireCsrf(req);
      const b = z.strictObject({ seconds: z.number().int().min(1).max(86400) }).parse(req.body);
      clock.advance(b.seconds);
      appendAudit(db, clock, { investigationId: null, type: "CLOCK_ADVANCED", actor: "demo", payload: { seconds: b.seconds } });
      return { clock: clock.nowIso() };
    } catch (e) {
      if (e instanceof z.ZodError) return reply.code(400).send({ error: "BAD_REQUEST" });
      return sendError(reply, e);
    }
  });

  /** "The merchant edits the policy": publish a new version (copy of current, version bumped). */
  app.post("/api/sim/policy/bump", guarded((req, _r, actor) => {
    const b = z.strictObject({ storeId: z.string() }).parse(req.body);
    const p = currentPolicy(db, b.storeId);
    if (!p) throw new HttpError(404, "NO_POLICY", "No current policy");
    const n = Number(String(p.version).replace(/\D/g, "")) + 1;
    const next = `v${n}`;
    run(db, "UPDATE mp_policies SET is_current = 0 WHERE policy_id = ? AND version = ?", p.policy_id, p.version);
    run(db, `INSERT INTO mp_policies SELECT policy_id, ?, pos_store_id, p95_threshold_minutes, min_contribution_rate_bps, max_pos_snapshot_age_s, max_ads_report_age_s, max_event_age_s, approval_required, allowed_action, approval_ttl_s, recommendation_ttl_s, ?, 1 FROM mp_policies WHERE policy_id = ? AND version = ?`,
      next, clock.nowIso(), p.policy_id, p.version);
    appendAudit(db, clock, { investigationId: null, type: "POLICY_PUBLISHED", actor: actor.userId, payload: { policyId: p.policy_id, from: p.version, to: next } });
    return { policyId: p.policy_id, version: next };
  }));

  /** Demo-only. Simulator internals come from the simulators' own routes via SimulatorConsolePort. */
  app.get("/api/sim/state", async () => {
    const campaigns = [];
    const accounts = await d.ads.listAdAccounts();
    if (accounts.ok) {
      for (const a of accounts.value) {
        const r = await d.ads.listCampaigns(a.accountId);
        if (r.ok) campaigns.push(...r.value);
      }
    }
    const sim = await d.simConsole.snapshot();
    const s = sim.available ? sim.value : null;
    return {
      clock: clock.nowIso(),
      scenario: kvGet(db, "scenario"),
      simulator: sim.available ? "AVAILABLE" : "NOT_CONFIGURED",
      simulatorProblem: sim.available ? null : sim.reason,
      adsFaults: s?.adsFaults ?? [],
      posFaults: s?.posFaults ?? [],
      campaigns,
      outbox: s?.outbox ?? [],
      ledger: s?.ledger ?? [],
      requests: s?.requests ?? [],
      patchCount: s ? s.patchCount : null,
      rejectedEvents: all(db, "SELECT received_at, reason FROM mp_rejected_events ORDER BY seq DESC LIMIT 10"),
      policies: all(db, "SELECT policy_id, version, pos_store_id, is_current FROM mp_policies ORDER BY pos_store_id, version"),
      latestInvestigation: get(db, "SELECT id FROM mp_investigations ORDER BY rowid DESC LIMIT 1")?.id ?? null,
    };
  });
}
