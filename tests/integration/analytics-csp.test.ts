/** CH-21: CSP allows Clarity only when configured, and never on the gate page. */
import { describe, expect, it } from "vitest";
import { boot } from "../helpers";

describe("analytics CSP", () => {
  it("unconfigured: CSP is unchanged and names no third party", async () => {
    const t = await boot();
    const csp = (await fetch(`${t.base}/api/health`)).headers.get("content-security-policy")!;
    expect(csp).toContain("connect-src 'self';");
    expect(csp).not.toMatch(/clarity|bing/);
    await t.close();
  });

  it("configured: app responses allow Clarity's documented domains; the gate page stays strict", async () => {
    const t = await boot({}, { env: { VITE_CLARITY_PROJECT_ID: "abc123xyz9", ACCESS_GATE: "on", ACCESS_PIN: "4826", SESSION_SECRET: "csp-test-session-secret-0123456789abcd" } });
    const app = (await fetch(`${t.base}/api/health`, { headers: { cookie: t.cookie } })).headers.get("content-security-policy")!;
    expect(app).toContain("script-src 'self' https://www.clarity.ms https://*.clarity.ms");
    expect(app).toContain("connect-src 'self' https://*.clarity.ms https://c.bing.com");
    expect(app).not.toContain("unsafe-eval");
    const gate = (await fetch(`${t.base}/access`)).headers.get("content-security-policy")!;
    expect(gate).not.toMatch(/clarity|bing/);
    await t.close();
  });
});
