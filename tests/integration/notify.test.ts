/** CH-19: signed notifications on final states. Notification only; failures never change a decision. */
import { createServer, Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { boot, Booted } from "../helpers";
import { NOTIFY_SIGNATURE_HEADER, signNotification } from "../../apps/api/src/notify/notify";

const SECRET = "test-notify-secret-0123456789abcdef";
let echo: Server;
let echoUrl = "";
const received: { body: string; sig: string }[] = [];

beforeAll(async () => {
  echo = createServer((req, res) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => { received.push({ body: b, sig: String(req.headers[NOTIFY_SIGNATURE_HEADER] ?? "") }); res.writeHead(204).end(); });
  });
  await new Promise<void>((r) => echo.listen(0, "127.0.0.1", r));
  const a = echo.address();
  echoUrl = `http://127.0.0.1:${typeof a === "object" && a ? a.port : 0}/hook`;
});
afterAll(() => new Promise<void>((r) => echo.close(() => r())));

describe("configured notifier", () => {
  let t: Booted;
  beforeAll(async () => { t = await boot({ notify: { url: echoUrl, secret: SECRET, timeoutMs: 2000 }, publicBaseUrl: "https://demo.example" }); });
  afterAll(async () => { await t.close(); });

  it("a verified pause sends exactly one signed notification with the plain-English reason", async () => {
    received.length = 0;
    await t.api.load("A");
    const { delivery } = await t.api.emit();
    const id = delivery.body.investigationId;
    await t.notifier.drain();
    expect(received).toHaveLength(0); // AWAITING_APPROVAL is not final
    await t.api.approveAndPause(id);
    await t.notifier.drain();
    expect(received).toHaveLength(1);
    const n = received[0]!;
    expect(n.sig).toBe(signNotification(n.body, SECRET));
    const body = JSON.parse(n.body);
    expect(body).toMatchObject({ type: "marginpulse.investigation.final", investigationId: id, status: "PAUSE_VERIFIED", decisionCode: "PAUSE_VERIFIED", headline: "The pause went through and was checked." });
    expect(body.evidencePackage).toBe(`https://demo.example/api/investigations/${id}/evidence-package`);
    const audit = (await t.api.get(`/api/investigations/${id}/audit`)).body;
    expect(audit.events.filter((e: { type: string }) => e.type === "NOTIFICATION_SENT")).toHaveLength(1);
    expect(audit.chain.ok).toBe(true);
    expect(await t.api.patchCount()).toBe(1);
  });

  it("a NO_ACTION decision also notifies once", async () => {
    received.length = 0;
    await t.api.load("B");
    await t.api.emit();
    await t.notifier.drain();
    expect(received.map((r) => JSON.parse(r.body).status)).toEqual(["NO_ACTION"]);
  });
});

describe("failing endpoint", () => {
  let t: Booted;
  beforeAll(async () => { t = await boot({ notify: { url: "http://127.0.0.1:9/unreachable", secret: SECRET, timeoutMs: 500 } }); });
  afterAll(async () => { await t.close(); });

  it("a failed notification is audited and does not change the outcome", async () => {
    await t.api.load("A");
    const { delivery } = await t.api.emit();
    const r = await t.api.approveAndPause(delivery.body.investigationId);
    expect(r.pause?.status).toBe(200);
    await t.notifier.drain();
    const v = await t.api.view(delivery.body.investigationId);
    expect(v.status).toBe("PAUSE_VERIFIED");
    const failed = v.audit.filter((e: { type: string }) => e.type === "NOTIFICATION_FAILED");
    expect(failed).toHaveLength(1);
    expect(JSON.stringify(failed[0].payload)).not.toContain(SECRET);
  });
});

describe("unconfigured", () => {
  let t: Booted;
  beforeAll(async () => { t = await boot(); });
  afterAll(async () => { await t.close(); });

  it("is a silent no-op: scenario A's audit trail has no notification entries", async () => {
    await t.api.load("A");
    const { delivery } = await t.api.emit();
    await t.api.approveAndPause(delivery.body.investigationId);
    await t.notifier.drain();
    const v = await t.api.view(delivery.body.investigationId);
    expect(v.audit.some((e: { type: string }) => e.type.startsWith("NOTIFICATION"))).toBe(false);
  });

  it("a URL without a secret is reported and stays off (never sent unsigned)", async () => {
    const t2 = await boot({ notify: { url: echoUrl, secret: null, timeoutMs: 500 } });
    const h = await t2.api.get("/api/health");
    expect(h.body.notifications.enabled).toBe(false);
    expect(h.body.optionalProblems[0].component).toBe("notify");
    expect(h.body.ok).toBe(true);
    await t2.close();
  });
});
