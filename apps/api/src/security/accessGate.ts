/**
 * V3 CH-20: four-digit visitor access gate for a hosted portfolio demo.
 *
 * Plainly: four digits are 10,000 combinations. This is a convenience gate in
 * front of synthetic data, not account security. It is separate from the demo
 * identity switcher (x-demo-user), which is not authentication either.
 *
 * - The PIN is checked on the server only. It never reaches the browser bundle and is never logged.
 * - Session: HMAC-signed cookie `mp_access` (HttpOnly, SameSite=Lax, Secure in production), short-lived.
 * - Every route is protected except /healthz and the gate's own /access routes and assets.
 * - Rate limit: per client progressive lockout plus a global failure budget; errors are generic.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { INTERNAL_HEADER, isInternalRequest } from "./internal";
import { GATE_CSS, GATE_JS, renderGate } from "./gatePage";

export const ACCESS_COOKIE = "mp_access";

export interface GateConfig {
  pin: string;
  secret: string;
  ttlSeconds: number;
  secureCookie: boolean;
  now?: () => number;
}

const b64 = (b: Buffer) => b.toString("base64url");
const mac = (secret: string, data: string) => b64(createHmac("sha256", secret).update(data).digest());
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function signSession(secret: string, expiresAtMs: number, id = b64(randomBytes(12))): string {
  const body = `v1.${expiresAtMs}.${id}`;
  return `${body}.${mac(secret, body)}`;
}

export function verifySession(secret: string, token: string | undefined, nowMs: number, revoked: Map<string, number>): { ok: true; id: string; exp: number } | { ok: false } {
  if (!token) return { ok: false };
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return { ok: false };
  const [, expRaw, id, sig] = parts as [string, string, string, string];
  if (!same(sig, mac(secret, `v1.${expRaw}.${id}`))) return { ok: false };
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp <= nowMs || revoked.has(id)) return { ok: false };
  return { ok: true, id, exp };
}

/** Progressive lockout per client, plus a global budget against spread-out guessing. */
export class AttemptLimiter {
  private perClient = new Map<string, { fails: number; lockedUntil: number; last: number }>();
  private globalFails: number[] = [];
  constructor(private opts = { freeFailures: 5, baseLockMs: 30_000, maxLockMs: 15 * 60_000, globalWindowMs: 10 * 60_000, globalMax: 100 }) {}

  /** ms to wait, or 0 if an attempt is allowed now. */
  waitMs(key: string, now: number): number {
    this.globalFails = this.globalFails.filter((t) => now - t < this.opts.globalWindowMs);
    const g = this.globalFails.length >= this.opts.globalMax ? this.globalFails[0]! + this.opts.globalWindowMs - now : 0;
    const c = this.perClient.get(key);
    return Math.max(g, c && c.lockedUntil > now ? c.lockedUntil - now : 0);
  }
  fail(key: string, now: number): void {
    this.globalFails.push(now);
    const c = this.perClient.get(key) ?? { fails: 0, lockedUntil: 0, last: now };
    c.fails++;
    c.last = now;
    if (c.fails >= this.opts.freeFailures) c.lockedUntil = now + Math.min(this.opts.maxLockMs, this.opts.baseLockMs * 2 ** (c.fails - this.opts.freeFailures));
    this.perClient.set(key, c);
    if (this.perClient.size > 10_000) for (const [k, v] of this.perClient) if (now - v.last > 3_600_000) this.perClient.delete(k);
  }
  succeed(key: string): void { this.perClient.delete(key); }
}

export function parseCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

/** Only same-site relative paths; never back to the gate; never protocol-relative. */
export function safeNext(v: unknown): string {
  const s = typeof v === "string" ? v : "";
  return /^\/(?!\/)[^\\\s]*$/.test(s) && s.length < 512 && !s.startsWith("/access") ? s : "/";
}

const EXEMPT = new Set(["/healthz", "/access", "/access/login", "/access/logout", "/access/gate.css", "/access/gate.js"]);
const FONT_FILES: Record<string, string> = {
  "public-sans-400.woff2": "@fontsource/public-sans/files/public-sans-latin-400-normal.woff2",
  "public-sans-700.woff2": "@fontsource/public-sans/files/public-sans-latin-700-normal.woff2",
  "barlow-600.woff2": "@fontsource/barlow-semi-condensed/files/barlow-semi-condensed-latin-600-normal.woff2",
  "barlow-700.woff2": "@fontsource/barlow-semi-condensed/files/barlow-semi-condensed-latin-700-normal.woff2",
};

export function registerAccessGate(app: FastifyInstance, cfg: GateConfig) {
  const now = cfg.now ?? Date.now;
  const limiter = new AttemptLimiter();
  const revoked = new Map<string, number>();
  const req0 = createRequire(import.meta.url);
  const fonts = new Map<string, Buffer>();
  for (const [name, mod] of Object.entries(FONT_FILES)) {
    try { fonts.set(name, readFileSync(req0.resolve(mod))); } catch { /* the gate falls back to system fonts */ }
  }

  const cookie = (value: string, maxAge: number) =>
    `${ACCESS_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${cfg.secureCookie ? "; Secure" : ""}`;
  const pathOf = (url: string) => url.split("?")[0]!;
  const html = (reply: FastifyReply, code: number, body: string) =>
    reply.code(code).header("cache-control", "no-store").type("text/html; charset=utf-8").send(body);

  app.addHook("onRequest", async (req: FastifyRequest, reply: FastifyReply) => {
    const path = pathOf(req.url);
    if (EXEMPT.has(path) || path.startsWith("/access/fonts/")) return;
    if (isInternalRequest(req.headers[INTERNAL_HEADER])) return;
    if (verifySession(cfg.secret, parseCookie(req.headers.cookie, ACCESS_COOKIE), now(), revoked).ok) return;
    const wantsPage = req.method === "GET" && !/^\/(api|mock-[a-z]+|v1|policies|approvals|assets)(\/|$)/.test(path) && String(req.headers.accept ?? "").includes("text/html");
    if (wantsPage) return reply.header("cache-control", "no-store").redirect(`/access?next=${encodeURIComponent(safeNext(req.url))}`, 302);
    return reply.code(401).header("cache-control", "no-store").send({ error: "ACCESS_REQUIRED", message: "Enter the access code to continue." });
  });

  app.addContentTypeParser("application/x-www-form-urlencoded", { parseAs: "string", bodyLimit: 2048 }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(String(body))));
  });

  app.get("/access/gate.css", async (_req, reply) => reply.header("cache-control", "public, max-age=3600").type("text/css; charset=utf-8").send(GATE_CSS));
  app.get("/access/gate.js", async (_req, reply) => reply.header("cache-control", "public, max-age=3600").type("text/javascript; charset=utf-8").send(GATE_JS));
  app.get<{ Params: { name: string } }>("/access/fonts/:name", async (req, reply) => {
    const f = fonts.get(req.params.name);
    if (!f) return reply.code(404).send({ error: "NOT_FOUND" });
    return reply.header("cache-control", "public, max-age=86400").type("font/woff2").send(f);
  });

  app.get<{ Querystring: { next?: string } }>("/access", async (req, reply) => {
    if (verifySession(cfg.secret, parseCookie(req.headers.cookie, ACCESS_COOKIE), now(), revoked).ok) return reply.redirect(safeNext(req.query.next), 303);
    return html(reply, 200, renderGate({ next: safeNext(req.query.next) }));
  });

  app.post<{ Body: { pin?: unknown; next?: unknown } }>("/access/login", async (req, reply) => {
    const origin = req.headers.origin;
    if (origin && origin !== "null" && new URL(origin).host !== req.headers.host) return reply.code(403).send({ error: "CROSS_SITE_LOGIN" });
    const next = safeNext(req.body?.next);
    const key = req.ip;
    const t = now();
    const wait = limiter.waitMs(key, t);
    if (wait > 0) {
      return html(reply.header("retry-after", String(Math.ceil(wait / 1000))), 429, renderGate({ next, error: "Too many attempts. Wait a few minutes, then try again." }));
    }
    const pin = typeof req.body?.pin === "string" ? req.body.pin : "";
    // Compare MACs so the comparison is constant-time regardless of input length.
    if (!/^\d{4}$/.test(pin) || !same(mac(cfg.secret, `pin:${pin}`), mac(cfg.secret, `pin:${cfg.pin}`))) {
      limiter.fail(key, t);
      return html(reply, 401, renderGate({ next, error: "That code did not work. Check it and try again." }));
    }
    limiter.succeed(key);
    return reply.header("set-cookie", cookie(signSession(cfg.secret, t + cfg.ttlSeconds * 1000), cfg.ttlSeconds)).header("cache-control", "no-store").redirect(next, 303);
  });

  app.post("/access/logout", async (req, reply) => {
    const s = verifySession(cfg.secret, parseCookie(req.headers.cookie, ACCESS_COOKIE), now(), revoked);
    if (s.ok) revoked.set(s.id, s.exp);
    for (const [id, exp] of revoked) if (exp <= now()) revoked.delete(id);
    return reply.header("set-cookie", cookie("", 0)).header("cache-control", "no-store").redirect("/access", 303);
  });
}
