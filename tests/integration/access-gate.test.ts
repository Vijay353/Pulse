/** CH-20: visitor access gate. Server-enforced, rate-limited, separate from the demo identity switcher. */
import { createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { boot, Booted } from "../helpers";
import { buildApp } from "../../apps/api/src/server";
import { AttemptLimiter, safeNext, signSession } from "../../apps/api/src/security/accessGate";
import { INTERNAL_HEADER, internalFetch } from "../../apps/api/src/security/internal";

// Test-only values for a non-production instance.
const PIN = "4826";
const SECRET = "gate-test-session-secret-0123456789abcdef";
const env = { ACCESS_GATE: "on", ACCESS_PIN: PIN, SESSION_SECRET: SECRET };

let t: Booted;
beforeAll(async () => { t = await boot({}, { env }); });
afterAll(async () => { await t.close(); });

const login = (pin: string, extra: Record<string, string> = {}) =>
  fetch(`${t.base}/access/login`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", ...extra }, body: new URLSearchParams({ pin, next: "/data" }).toString() });
const cookieOf = (r: Response) => (r.headers.get("set-cookie") ?? "").split(";")[0]!;

describe("access gate", () => {
  it("without a session: pages redirect to the gate, API and bundle are refused, health stays open", async () => {
    const page = await fetch(`${t.base}/data?x=1`, { redirect: "manual", headers: { accept: "text/html" } });
    expect(page.status).toBe(302);
    expect(page.headers.get("location")).toBe("/access?next=%2Fdata%3Fx%3D1");
    for (const p of ["/api/investigations", "/api/health", "/api/session", "/assets/index.js", "/mock-ads/ledger", "/v1/ads/SYN-AD-221/campaigns"]) {
      const r = await fetch(t.base + p, { redirect: "manual", headers: { accept: "text/html" } });
      expect(r.status, p).toBe(401);
      expect(await r.json()).toEqual({ error: "ACCESS_REQUIRED", message: "Enter the access code to continue." });
    }
    expect(await (await fetch(`${t.base}/healthz`)).json()).toEqual({ ok: true });
    const gate = await fetch(`${t.base}/access?next=/data`);
    const html = await gate.text();
    expect(gate.status).toBe(200);
    expect(html).toContain('autocomplete="one-time-code"');
    expect(html).toContain('value="/data"');
    expect(html).not.toContain(PIN);
    expect(html).not.toMatch(/clarity|googletagmanager|analytics/i);
  });

  it("wrong code: generic 401 and no cookie; right code: signed HttpOnly SameSite=Lax cookie and redirect to next", async () => {
    const bad = await login("1111", { "x-forwarded-for": "10.9.9.1" });
    expect(bad.status).toBe(401);
    expect(bad.headers.get("set-cookie")).toBeNull();
    expect(await bad.text()).toContain("That code did not work. Check it and try again.");
    const ok = await login(PIN);
    expect(ok.status).toBe(303);
    expect(ok.headers.get("location")).toBe("/data");
    const sc = ok.headers.get("set-cookie")!;
    expect(sc).toMatch(/^mp_access=v1\.\d+\.[\w-]+\.[\w-]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=7200$/);
    expect(sc).not.toContain("Secure"); // only in production
    const api = await fetch(`${t.base}/api/investigations`, { headers: { cookie: cookieOf(ok) } });
    expect(api.status).toBe(200);
  });

  it("full workflow runs through the gate: internal simulator calls pass with the per-process token", async () => {
    await t.api.load("A");
    const { delivery } = await t.api.emit();
    await t.api.approveAndPause(delivery.body.investigationId);
    expect((await t.api.view(delivery.body.investigationId)).status).toBe("PAUSE_VERIFIED");
  });

  it("tampered, expired and logged-out sessions return to the gate", async () => {
    const good = cookieOf(await login(PIN));
    const tampered = good.replace(/\.(\d+)\./, (_m, n) => `.${Number(n) + 1000}.`);
    expect((await fetch(`${t.base}/api/investigations`, { headers: { cookie: tampered } })).status).toBe(401);
    const expired = `mp_access=${signSession(SECRET, Date.now() - 1000)}`;
    expect((await fetch(`${t.base}/api/investigations`, { headers: { cookie: expired } })).status).toBe(401);
    const out = await fetch(`${t.base}/access/logout`, { method: "POST", redirect: "manual", headers: { cookie: good } });
    expect(out.status).toBe(303);
    expect(out.headers.get("location")).toBe("/access");
    expect(out.headers.get("set-cookie")).toMatch(/^mp_access=; .*Max-Age=0/);
    expect((await fetch(`${t.base}/api/investigations`, { headers: { cookie: good } })).status).toBe(401); // replay after logout
  });

  it("brute force: after five failures even the right code is refused with 429 and the same wording", async () => {
    const t2 = await boot({}, { env });
    const L = (pin: string) => fetch(`${t2.base}/access/login`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `pin=${pin}` });
    const texts = new Set<string>();
    for (const p of ["0000", "4825", "4827", "9999", "1234"]) { const r = await L(p); expect(r.status).toBe(401); texts.add((await r.text()).replace(/value="[^"]*"/g, "")); }
    expect(texts.size).toBe(1); // a near miss reads exactly like any other miss
    const locked = await L(PIN);
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(locked.headers.get("set-cookie")).toBeNull();
    expect(await locked.text()).toContain("Too many attempts.");
    await t2.close();
  });

  it("limiter: progressive per-client lockout and a global failure budget", () => {
    const l = new AttemptLimiter({ freeFailures: 2, baseLockMs: 1000, maxLockMs: 8000, globalWindowMs: 60_000, globalMax: 5 });
    l.fail("a", 0); expect(l.waitMs("a", 0)).toBe(0);
    l.fail("a", 0); expect(l.waitMs("a", 0)).toBe(1000);
    l.fail("a", 1000); expect(l.waitMs("a", 1000)).toBe(2000);
    l.fail("b", 2000); l.fail("c", 2000);
    expect(l.waitMs("fresh-client", 2000)).toBe(58_000); // 5 failures in the window lock everyone
    l.succeed("a");
  });

  it("next is limited to same-site paths and never the gate itself", () => {
    expect(safeNext("/data")).toBe("/data");
    for (const bad of ["//evil.example", "https://evil.example", "/\\evil", "/access/login", "data", "", 5]) expect(safeNext(bad)).toBe("/");
  });

  it("cross-site login posts are refused", async () => {
    const r = await login(PIN, { origin: "https://evil.example" });
    expect(r.status).toBe(403);
  });

  it("the internal token is never sent to other origins", async () => {
    let seen: string | undefined = "unset";
    const srv = createServer((req, res) => { seen = req.headers[INTERNAL_HEADER] as string | undefined; res.end("ok"); });
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
    const port = (srv.address() as { port: number }).port;
    await internalFetch(`http://127.0.0.1:${port}/x`);
    expect(seen).toBeUndefined();
    srv.close();
  });

  it("configuration: gate on needs a 4-digit PIN and a long secret; production refuses ACCESS_GATE=off; errors never echo values", () => {
    const tryEnv = (e: NodeJS.ProcessEnv) => () => buildApp({ env: e, config: { dbPath: ":memory:", serveWeb: false } });
    expect(tryEnv({ ACCESS_GATE: "on", ACCESS_PIN: "48261", SESSION_SECRET: SECRET })).toThrow(/ACCESS_PIN must be exactly four digits/);
    expect(tryEnv({ ACCESS_GATE: "on", ACCESS_PIN: PIN, SESSION_SECRET: "short" })).toThrow(/SESSION_SECRET must be/);
    expect(tryEnv({ ACCESS_GATE: "yes" })).toThrow(/ACCESS_GATE must be "on" or "off"/);
    const prod = { NODE_ENV: "production", POS_WEBHOOK_SECRET: SECRET, UBER_ADS_TOKEN: SECRET, DATABASE_PATH: "/tmp/mp-never-created/x.db" };
    expect(tryEnv({ ...prod, ACCESS_GATE: "off" })).toThrow(/ACCESS_GATE=off is not allowed in production/);
    expect(tryEnv({ ...prod })).toThrow(/ACCESS_PIN must be exactly four digits/); // gate defaults on in production
    expect(tryEnv({ ...prod, ACCESS_PIN: "12a4", SESSION_SECRET: SECRET })).not.toThrow(/12a4/);
  });

  it("local default is unchanged: no gate unless asked for", async () => {
    const plain = await boot();
    expect(plain.config.access.gate).toBe(false);
    expect((await fetch(`${plain.base}/api/health`)).status).toBe(200);
    await plain.close();
  });
});
