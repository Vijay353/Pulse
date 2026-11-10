/** CH-21: analytics loader. Pure and injectable; checked with fakes, no network. */
import { describe, expect, it } from "vitest";
import { ALLOWED_EVENTS, CONSENT_KEY, createAnalytics, WinLike } from "../../apps/web/src/analytics/clarity";

function fakes(o: { host?: string; webdriver?: boolean; stored?: string | null; storageThrows?: boolean } = {}) {
  const store = new Map<string, string>(o.stored ? [[CONSENT_KEY, o.stored]] : []);
  const session = new Map<string, string>();
  const mk = (m: Map<string, string>) => ({
    getItem: (k: string) => { if (o.storageThrows) throw new Error("blocked"); return m.get(k) ?? null; },
    setItem: (k: string, v: string) => { if (o.storageThrows) throw new Error("blocked"); m.set(k, v); },
  });
  const win: WinLike = { location: { hostname: o.host ?? "demo.example.com" }, navigator: { webdriver: o.webdriver }, localStorage: mk(store), sessionStorage: mk(session) };
  const scripts: { async: boolean; src: string }[] = [];
  const doc = { createElement: () => ({ async: false, src: "" }), head: { appendChild: (n: unknown) => { scripts.push(n as never); return n; } } };
  const calls = () => (win.clarity?.q ?? []).map((a) => a);
  return { win, doc, scripts, calls, store, session };
}
const ID = "abc123xyz9";

describe("analytics loader", () => {
  it("absent or malformed project ID: silent no-op", () => {
    for (const projectId of [undefined, "", "bad id!", "x"]) {
      const f = fakes();
      const a = createAnalytics({ projectId, win: f.win, doc: f.doc });
      a.start(); a.grant();
      expect(a.available).toBe(false);
      expect(a.track("project_entered")).toBe(false);
      expect(f.scripts).toHaveLength(0);
      expect(f.win.clarity).toBeUndefined();
    }
  });

  it("off under automation and on localhost unless explicitly allowed", () => {
    expect(createAnalytics({ projectId: ID, ...fakes({ webdriver: true }) }).reason).toBe("automated browser");
    expect(createAnalytics({ projectId: ID, ...fakes({ host: "localhost" }) }).reason).toBe("local development");
    expect(createAnalytics({ projectId: ID, allowLocal: true, ...fakes({ host: "127.0.0.1" }) }).available).toBe(true);
  });

  it("nothing loads or queues before consent; declining keeps it off", () => {
    const f = fakes();
    const a = createAnalytics({ projectId: ID, win: f.win, doc: f.doc });
    a.start();
    expect(a.consent()).toBeNull();
    expect(a.track("scenario_started")).toBe(false);
    a.deny();
    expect(f.scripts).toHaveLength(0);
    expect(f.win.clarity).toBeUndefined();
    expect(f.store.get(CONSENT_KEY)).toBe("denied");
  });

  it("consent installs the official tag once, sets consent mode, and sends project_entered once per tab", () => {
    const f = fakes();
    const a = createAnalytics({ projectId: ID, win: f.win, doc: f.doc });
    a.grant(); a.start(); a.grant();
    expect(f.scripts).toEqual([{ async: true, src: `https://www.clarity.ms/tag/${ID}` }]);
    expect(f.calls()[0]).toEqual(["consentv2", { ad_Storage: "denied", analytics_Storage: "granted" }]);
    expect(f.calls().filter((c) => c[0] === "event")).toEqual([["event", "project_entered"]]);
    // a second page load in the same tab (new instance, same storage) installs once again but does not resend project_entered
    f.win.__mpClarityInstalled = false;
    const b = createAnalytics({ projectId: ID, win: f.win, doc: f.doc });
    b.start();
    expect(f.calls().filter((c) => c[0] === "event")).toHaveLength(1);
  });

  it("only whitelisted names are sent, with no values attached", () => {
    const f = fakes({ stored: "granted" });
    const a = createAnalytics({ projectId: ID, win: f.win, doc: f.doc });
    a.start();
    for (const e of ALLOWED_EVENTS) expect(a.track(e)).toBe(true);
    expect(a.track("record inv-1042 $3.20" as never)).toBe(false);
    const events = f.calls().filter((c) => c[0] === "event");
    expect(events.every((c) => c.length === 2 && (ALLOWED_EVENTS as readonly string[]).includes(c[1] as string))).toBe(true);
    expect(f.calls().some((c) => c[0] === "set" || c[0] === "identify")).toBe(false);
  });

  it("withdrawal calls consent(false) and stops later events", () => {
    const f = fakes({ stored: "granted" });
    const a = createAnalytics({ projectId: ID, win: f.win, doc: f.doc });
    a.start();
    a.deny();
    expect(f.calls()).toContainEqual(["consent", false]);
    expect(a.track("scenario_completed")).toBe(false);
    expect(f.store.get(CONSENT_KEY)).toBe("denied");
  });

  it("blocked storage does not break the page; the choice holds for this page only", () => {
    const f = fakes({ storageThrows: true });
    const a = createAnalytics({ projectId: ID, win: f.win, doc: f.doc });
    expect(a.consent()).toBeNull();
    a.grant();
    expect(a.track("scenario_started")).toBe(true);
  });
});
