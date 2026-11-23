/**
 * One local process hosts three logically separate systems:
 *   /api/*                 MarginPulse (orchestrator, policy, approvals, audit)
 *   /policies, /approvals  MarginPulse policy + approval services
 *   /mock-pos/*            Mock POS/KDS simulator
 *   /v1/ads/*, /mock-ads/* Mock Uber Ads simulator
 * MarginPulse reaches the simulators over real HTTP through adapters, so the
 * PATCH and readbacks are observable network calls. Binds to 127.0.0.1.
 */
import Fastify, { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AppConfig, configProblems, loadConfig, notifyEnabled, productionProblems } from "./config";
import { assertWritableDataDir, isBootstrapped } from "./ops/storage";
import { registerAccessGate } from "./security/accessGate";
import { registerInternalOrigin } from "./security/internal";
import { Db, openDb } from "./db/db";
import { Clock, simClock } from "./clock";
import { registerMockUberAds } from "../../../packages/mock-uber-ads/src/plugin";
import { registerMockPos } from "../../../packages/mock-pos/src/plugin";
import { HttpPosAdapter, HttpSimulatorConsole, HttpUberAdsAdapter, UnconfiguredAdsAdapter } from "./adapters/http";
import type { PosPort, SimulatorConsolePort, UberAdsPort } from "./adapters/ports";
import { AnthropicProvider, FixtureInvestigator, Investigator, LlmInvestigator, ModelProvider } from "./agents/investigators";
import { Orchestrator } from "./orchestration/orchestrator";
import { resetWorld } from "./orchestration/world";
import { registerApiRoutes } from "./routes/api";
import { registerDataRoutes } from "./routes/data";
import { createRateLimiter } from "./security/rateLimit";
import { registerInsightRoutes } from "./routes/insights";
import { createNotifier, NOOP_NOTIFIER, Notifier } from "./notify/notify";
import { buildInvestigationView } from "./orchestration/viewModel";

export interface BuiltApp {
  app: FastifyInstance;
  db: Db;
  clock: Clock;
  config: AppConfig;
  orchestrator: Orchestrator;
  /** CH-19: notifications on final states (no-op unless configured). */
  notifier: Notifier;
  ads: UberAdsPort;
  pos: PosPort;
  baseUrl: () => string;
  setBaseUrl: (u: string) => void;
}

export function buildApp(opts: { config?: Partial<AppConfig>; env?: NodeJS.ProcessEnv; modelProvider?: ModelProvider } = {}): BuiltApp {
  const config = loadConfig(opts.env ?? process.env, opts.config);
  const prodProblems = productionProblems(config);
  if (prodProblems.length) throw new Error(`Refusing to start:\n - ${prodProblems.join("\n - ")}`);
  if (config.production) assertWritableDataDir(config.dbPath);
  const db = openDb(config.dbPath);
  const clock = simClock(db);
  let selfBase = `http://${config.host}:${config.port}`;
  registerInternalOrigin(selfBase);
  const baseUrl = () => selfBase;

  const problems = configProblems(config);
  const adsProblem = problems.find((p) => p.component === "ads");
  const ads: UberAdsPort =
    config.adsMode === "SIMULATED"
      ? new HttpUberAdsAdapter(baseUrl, config.adsToken, { timeoutMs: config.adsTimeoutMs, simulated: true, label: "Mock Uber Ads (local simulator)" })
      : adsProblem
        ? new UnconfiguredAdsAdapter(adsProblem.problem)
        : new HttpUberAdsAdapter(() => config.adsBaseUrl!, config.adsToken, { timeoutMs: config.adsTimeoutMs, simulated: false, label: `Uber Ads ${config.adsMode} (${config.adsBaseUrl})` });
  const pos: PosPort = new HttpPosAdapter(() => config.posBaseUrl ?? selfBase, config.adsTimeoutMs);
  const simConsole: SimulatorConsolePort = new HttpSimulatorConsole({
    adsBaseUrl: config.adsMode === "SIMULATED" ? baseUrl : null,
    posBaseUrl: config.posBaseUrl ? null : baseUrl,
    timeoutMs: config.adsTimeoutMs,
  });

  const invProblem = problems.find((p) => p.component === "investigator");
  let investigator: Investigator | null = null;
  if (config.investigator === "fixture" && !invProblem) investigator = new FixtureInvestigator();
  else if (config.investigator === "llm" && (opts.modelProvider || !invProblem))
    investigator = new LlmInvestigator(opts.modelProvider ?? new AnthropicProvider({ apiKey: config.llm.apiKey!, model: config.llm.model!, baseUrl: config.llm.baseUrl }));

  // CH-19: signed notifications on final states. A silent no-op unless configured.
  const notifier: Notifier = notifyEnabled(config)
    ? createNotifier({ db, clock, url: config.notify.url!, secret: config.notify.secret!, timeoutMs: config.notify.timeoutMs, publicBaseUrl: config.publicBaseUrl,
        loadView: (id) => buildInvestigationView(db, clock, ads, pos, id) as Promise<Record<string, unknown> | null> })
    : NOOP_NOTIFIER;

  const orchestrator = new Orchestrator({
    onFinal: (id, status) => notifier.onFinal(id, status),
    db, clock, ads, pos, investigator,
    investigatorProblem: investigator ? null : invProblem?.problem ?? "investigator unavailable",
    webhookSecret: config.posWebhookSecret,
    readbackAttempts: config.readbackAttempts,
    readbackIntervalMs: config.readbackIntervalMs,
  });

  // Development seeds an empty database automatically. Production never seeds or resets on start (V3 CH-22):
  // first installation runs `npm run bootstrap` once.
  if (!isBootstrapped(db)) {
    if (config.production) throw new Error(`Refusing to start in production: the database at ${config.dbPath} has not been bootstrapped. Run "npm run bootstrap" once on first installation.`);
    resetWorld(db, clock, config.adsToken, "A");
  }

  const app = Fastify({ logger: false, bodyLimit: 256 * 1024, trustProxy: trustProxyOption(config.trustProxy) });
  // V3 CH-20: registered first so every route below it is behind the gate.
  if (config.access.gate) registerAccessGate(app, { pin: config.access.pin!, secret: config.access.sessionSecret!, ttlSeconds: config.access.ttlMinutes * 60, secureCookie: config.production });

  const baseCsp = "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
  // V3 CH-21: Clarity's documented domains, only when a project ID is configured and never on the gate page.
  const clarityCsp = "default-src 'self'; script-src 'self' https://www.clarity.ms https://*.clarity.ms; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.clarity.ms https://c.bing.com; connect-src 'self' https://*.clarity.ms https://c.bing.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
  app.addHook("onSend", async (req, reply, payload) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", "DENY");
    reply.header("referrer-policy", "no-referrer");
    reply.header("content-security-policy", config.clarityProjectId && !req.url.startsWith("/access") ? clarityCsp : baseCsp);
    return payload;
  });

  // V3 CH-22: lightweight read-only readiness check (no business data).
  app.get("/healthz", async (_req, reply) => {
    try {
      db.prepare("SELECT 1").get();
      return { ok: true };
    } catch {
      return reply.code(503).send({ ok: false });
    }
  });

  registerMockUberAds(app, { db, clock });
  registerMockPos(app, { db, clock, secret: config.posWebhookSecret, webhookUrl: () => config.webhookUrl ?? `${selfBase}/api/events/kitchen-load` });
  // CH-5: one limiter shared by every mutating route (in-memory, this process only).
  const limiter = createRateLimiter({ limit: config.mutationRateLimitPerMin });
  registerApiRoutes(app, { db, clock, config, orchestrator, ads, pos, simConsole, problems, investigatorName: investigator?.name ?? null, limiter });
  registerDataRoutes(app, { db, clock, limiter });
  registerInsightRoutes(app, { db, config, ads, pos });

  const webDist = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../web/dist");
  if (config.serveWeb && existsSync(webDist)) {
    app.register(fastifyStatic, { root: webDist, prefix: "/" });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !/^\/(api|mock-|v1|policies|approvals)/.test(req.url)) return reply.type("text/html").sendFile("index.html");
      return reply.code(404).send({ error: "NOT_FOUND" });
    });
  }

  // CH-19: let in-flight notifications finish (each has its own timeout) before shutdown completes.
  app.addHook("onClose", async () => { await notifier.drain(); });

  return { app, db, clock, config, orchestrator, ads, pos, notifier, baseUrl, setBaseUrl: (u) => { selfBase = u; registerInternalOrigin(u); } };
}

/** TRUST_PROXY: unset trusts nothing; "1" trusts one hop (the panel's proxy); otherwise an address or CIDR list. */
function trustProxyOption(v: false | string): boolean | string | ((addr: string, hop: number) => boolean) {
  if (v === false) return false;
  if (/^\d+$/.test(v)) { const hops = Number(v); return (_addr: string, hop: number) => hop < hops; }
  return v;
}

export async function start(opts: Parameters<typeof buildApp>[0] = {}) {
  const built = buildApp(opts);
  const address = await built.app.listen({ port: built.config.port, host: built.config.host });
  built.setBaseUrl(address.replace("[::1]", "127.0.0.1"));
  return { ...built, address };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  start().then(({ address, config }) => {
    const p = configProblems(config);
    console.log(`MarginPulse running at ${address}  (ads=${config.adsMode}, investigator=${config.investigator}, db=${config.dbPath})`);
    for (const x of p) console.warn(`[setup] ${x.component}: ${x.problem}`);
  }).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
