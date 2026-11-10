import { start } from "../apps/api/src/server";
import type { AppConfig } from "../apps/api/src/config";
import type { ModelProvider } from "../apps/api/src/agents/investigators";

export type Booted = Awaited<ReturnType<typeof boot>>;

export async function boot(overrides: Partial<AppConfig> = {}, extra: { env?: NodeJS.ProcessEnv; modelProvider?: ModelProvider } = {}) {
  const built = await start({
    config: { port: 0, dbPath: ":memory:", readbackIntervalMs: 15, adsTimeoutMs: 1500, serveWeb: false, ...overrides },
    env: extra.env ?? {},
    modelProvider: extra.modelProvider,
  });
  const base = built.address;
  // V3 CH-20: when the visitor gate is on, enter the code first (the gate is not the subject of most tests).
  let access = "";
  if (built.config.access.gate) {
    const r = await fetch(`${base}/access/login`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `pin=${built.config.access.pin}` });
    access = (r.headers.get("set-cookie") ?? "").split(";")[0]!;
  }
  const s = await fetch(`${base}/api/session`, { headers: access ? { cookie: access } : {} });
  const cookie = [(s.headers.get("set-cookie") ?? "").split(";")[0]!, access].filter(Boolean).join("; ");
  const { csrfToken } = (await s.json()) as { csrfToken: string };

  const req = async (method: string, path: string, body?: unknown, user = "mgr-ana", opts: { csrf?: boolean } = {}) => {
    const headers: Record<string, string> = { cookie, "x-demo-user": user };
    if (opts.csrf !== false) headers["x-csrf-token"] = csrfToken;
    if (body !== undefined) headers["content-type"] = "application/json";
    const res = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json: any;
    try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json };
  };

  const api = {
    get: (p: string, user?: string) => req("GET", p, undefined, user),
    post: (p: string, b?: unknown, user?: string, opts?: { csrf?: boolean }) => req("POST", p, b ?? {}, user, opts),
    del: (p: string) => req("DELETE", p),
    async load(scenario: string) {
      const r = await req("POST", `/api/scenarios/${scenario}/load`, {});
      if (r.status !== 200) throw new Error(`load failed ${JSON.stringify(r.body)}`);
    },
    /** Real trigger: the mock POS builds, signs and delivers the webhook. */
    async emit(storeId = "SYN-STORE-104") {
      const r = await req("POST", "/mock-pos/events", { storeId });
      return r.body as { event: any; delivery: { status: number; body: any } };
    },
    async view(id: string) { return (await req("GET", `/api/investigations/${id}`)).body; },
    async approveAndPause(id: string, user = "mgr-ana") {
      const a = await req("POST", `/api/investigations/${id}/approve`, {}, user);
      if (a.status !== 200) return { approve: a, pause: null };
      const p = await req("POST", `/api/investigations/${id}/pause-campaign`, { approvalId: a.body.approvalId }, user);
      return { approve: a, pause: p };
    },
    async patchCount() { return (await req("GET", "/api/sim/state")).body.patchCount as number; },
    async campaign(id = "cmp-syn-4081", account = "SYN-AD-221") {
      const res = await fetch(`${base}/v1/ads/${account}/campaigns?campaign_id=${id}`, { headers: { authorization: `Bearer ${built.config.adsToken}`, cookie } });
      return ((await res.json()) as { campaigns: any[] }).campaigns[0];
    },
  };
  return { ...built, base, api, cookie, close: () => built.app.close() };
}
