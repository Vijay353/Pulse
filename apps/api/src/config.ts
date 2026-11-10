/**
 * Runtime configuration. Secrets are read on the server only and never sent
 * to the browser. Unsupported or unconfigured provider modes FAIL CLOSED:
 * the app still starts, but the health endpoint reports the problem and
 * investigations are BLOCKED instead of silently simulating success.
 */
export type AdsMode = "SIMULATED" | "SANDBOX" | "LIVE";
export type InvestigatorMode = "fixture" | "llm";

export interface AppConfig {
  port: number;
  host: string;
  dbPath: string;
  adsMode: AdsMode;
  /** Base URL for the Uber Ads adapter. In SIMULATED mode this is the local server itself. */
  adsBaseUrl: string | null;
  adsToken: string;
  adsLiveAllowed: boolean;
  posBaseUrl: string | null;
  posWebhookSecret: string;
  webhookUrl: string | null;
  investigator: InvestigatorMode;
  llm: { apiKey: string | null; model: string | null; baseUrl: string };
  readbackAttempts: number;
  readbackIntervalMs: number;
  adsTimeoutMs: number;
  serveWeb: boolean;
  /** V3 CH-22: NODE_ENV=production. Enables fail-closed startup checks and disables automatic seeding. */
  production: boolean;
  /** V3 CH-20: visitor access gate. On by default in production; off by default elsewhere. */
  access: { gate: boolean; gateSetting: string | null; pin: string | null; sessionSecret: string | null; ttlMinutes: number };
  /** V3 CH-20: Fastify trustProxy. Unset = trust no forwarded headers. A number = trusted hops; otherwise an address or CIDR list. */
  trustProxy: false | string;
  /** V3 CH-21: public Clarity project ID, read here only to allow Clarity's domains in the CSP. */
  clarityProjectId: string | null;
}

const DEV_ADS_TOKEN = "local-mock-ads-token-not-a-secret";
const DEV_WEBHOOK_SECRET = "local-mock-pos-webhook-secret-not-a-secret";

export function loadConfig(env: NodeJS.ProcessEnv = process.env, overrides: Partial<AppConfig> = {}): AppConfig {
  const adsMode = (env.ADS_MODE ?? "SIMULATED").toUpperCase() as AdsMode;
  return {
    port: Number(env.PORT ?? 8787),
    host: env.HOST ?? "127.0.0.1",
    dbPath: env.DATABASE_PATH ?? env.DB_PATH ?? "data/marginpulse.db",
    adsMode,
    adsBaseUrl: env.UBER_ADS_BASE_URL ?? null,
    adsToken: env.UBER_ADS_TOKEN ?? DEV_ADS_TOKEN,
    adsLiveAllowed: env.ALLOW_LIVE_UBER_WRITES === "true",
    posBaseUrl: env.POS_BASE_URL ?? null,
    posWebhookSecret: env.POS_WEBHOOK_SECRET ?? DEV_WEBHOOK_SECRET,
    webhookUrl: env.WEBHOOK_URL ?? null,
    investigator: (env.INVESTIGATOR ?? "fixture") as InvestigatorMode,
    llm: {
      apiKey: env.ANTHROPIC_API_KEY ?? null,
      model: env.LLM_MODEL ?? null,
      baseUrl: env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com",
    },
    readbackAttempts: Number(env.READBACK_ATTEMPTS ?? 3),
    readbackIntervalMs: Number(env.READBACK_INTERVAL_MS ?? 400),
    adsTimeoutMs: Number(env.ADS_TIMEOUT_MS ?? 3000),
    serveWeb: env.SERVE_WEB !== "false",
    production: env.NODE_ENV === "production",
    access: {
      gate: env.ACCESS_GATE ? env.ACCESS_GATE === "on" : env.NODE_ENV === "production",
      gateSetting: env.ACCESS_GATE ?? null,
      pin: env.ACCESS_PIN ?? null,
      sessionSecret: env.SESSION_SECRET ?? null,
      ttlMinutes: Number(env.ACCESS_SESSION_TTL_MINUTES ?? 120),
    },
    trustProxy: env.TRUST_PROXY ? env.TRUST_PROXY : false,
    clarityProjectId: env.VITE_CLARITY_PROJECT_ID || null,
    ...overrides,
  };
}

/** Returns human-readable setup problems. Empty array = configuration is usable. */
export function configProblems(c: AppConfig): { component: string; problem: string }[] {
  const p: { component: string; problem: string }[] = [];
  if (!["SIMULATED", "SANDBOX", "LIVE"].includes(c.adsMode)) p.push({ component: "ads", problem: `Unknown ADS_MODE "${c.adsMode}"` });
  if (c.adsMode !== "SIMULATED") {
    if (!c.adsBaseUrl) p.push({ component: "ads", problem: `ADS_MODE=${c.adsMode} requires UBER_ADS_BASE_URL` });
    if (c.adsToken === DEV_ADS_TOKEN) p.push({ component: "ads", problem: `ADS_MODE=${c.adsMode} requires a real UBER_ADS_TOKEN (OAuth access token with ads.campaigns.read and ads.campaigns.write)` });
    if (c.adsMode === "LIVE" && !c.adsLiveAllowed) p.push({ component: "ads", problem: "ADS_MODE=LIVE also requires ALLOW_LIVE_UBER_WRITES=true" });
    p.push({ component: "ads", problem: `ADS_MODE=${c.adsMode}: campaign reporting uses Uber's asynchronous reporting API, which this slice does not implement (TO_VERIFY). Investigations will be blocked.` });
  }
  if (!["fixture", "llm"].includes(c.investigator)) p.push({ component: "investigator", problem: `Unknown INVESTIGATOR "${c.investigator}"` });
  if (c.investigator === "llm") {
    if (!c.llm.apiKey) p.push({ component: "investigator", problem: "INVESTIGATOR=llm requires ANTHROPIC_API_KEY" });
    if (!c.llm.model) p.push({ component: "investigator", problem: "INVESTIGATOR=llm requires LLM_MODEL (no default model is assumed)" });
  }
  return p;
}

export const isDevSecret = (c: AppConfig) => c.posWebhookSecret === DEV_WEBHOOK_SECRET || c.adsToken === DEV_ADS_TOKEN;

/**
 * V3 CH-22: settings that must be real before a production start. Values are
 * never echoed back, only the variable name. An empty list means startup may continue.
 */
export function productionProblems(c: AppConfig): string[] {
  const p0 = accessProblems(c);
  if (!c.production) return p0;
  const weak = (v: string) => v.length < 24 || /^replace-with/i.test(v) || /not-a-secret/.test(v);
  const p: string[] = [...p0];
  if (c.access.gateSetting === "off") p.push("ACCESS_GATE=off is not allowed in production; the visitor gate is required there");
  if (c.dbPath === ":memory:") p.push("DATABASE_PATH must point at a file on a persistent mount (for example /data/marginpulse.db), not :memory:");
  if (weak(c.posWebhookSecret)) p.push("POS_WEBHOOK_SECRET must be set to a random value of at least 24 characters");
  if (weak(c.adsToken)) p.push("UBER_ADS_TOKEN must be set (in SIMULATED mode any random value of at least 24 characters; it is only checked by the local mock)");
  return p;
}

/** V3 CH-20: gate settings. Checked whenever the gate is on, in any environment. Values are never echoed. */
export function accessProblems(c: AppConfig): string[] {
  const p: string[] = [];
  if (c.access.gateSetting !== null && !["on", "off"].includes(c.access.gateSetting)) p.push('ACCESS_GATE must be "on" or "off"');
  if (!c.access.gate) return p;
  if (!c.access.pin || !/^\d{4}$/.test(c.access.pin)) p.push("ACCESS_PIN must be exactly four digits");
  if (!c.access.sessionSecret || c.access.sessionSecret.length < 32 || /^replace-with/i.test(c.access.sessionSecret)) p.push("SESSION_SECRET must be a random value of at least 32 characters");
  if (!(c.access.ttlMinutes >= 5 && c.access.ttlMinutes <= 24 * 60)) p.push("ACCESS_SESSION_TTL_MINUTES must be between 5 and 1440");
  return p;
}
