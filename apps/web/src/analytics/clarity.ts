/**
 * Optional Microsoft Clarity analytics (V3 CH-21).
 *
 * - Lives in the app bundle, which the server only serves after the visitor gate (CH-20),
 *   so nothing here can run on the gate page.
 * - Loads nothing until the visitor chooses "Allow". Declining or withdrawing keeps it off.
 * - Off when no project ID is configured, under automation (navigator.webdriver), and on
 *   localhost unless VITE_CLARITY_ALLOW_LOCAL=true.
 * - Only the event names in ALLOWED_EVENTS are sent, with no values or tags.
 * Snippet shape and API calls follow Microsoft's Clarity docs (checked 2026-11-09).
 */
export const ALLOWED_EVENTS = ["project_entered", "scenario_started", "scenario_completed", "audit_export_clicked"] as const;
export type AnalyticsEvent = (typeof ALLOWED_EVENTS)[number];
export type Consent = "granted" | "denied";
export const CONSENT_KEY = "mp_analytics_consent";
const ENTERED_KEY = "mp_analytics_entered";

type Q = ((...args: unknown[]) => void) & { q?: unknown[][] };
export interface WinLike {
  clarity?: Q;
  location: { hostname: string };
  navigator: { webdriver?: boolean };
  localStorage?: Pick<Storage, "getItem" | "setItem">;
  sessionStorage?: Pick<Storage, "getItem" | "setItem">;
  __mpClarityInstalled?: boolean;
}
export interface DocLike {
  createElement(tag: "script"): { async: boolean; src: string };
  head: { appendChild(n: unknown): unknown };
}

export function availability(projectId: string | undefined, win: WinLike, allowLocal = false): { available: boolean; reason: string } {
  if (!projectId) return { available: false, reason: "no project ID configured" };
  if (!/^[a-z0-9]{6,20}$/i.test(projectId)) return { available: false, reason: "project ID is not in the expected format" };
  if (win.navigator.webdriver) return { available: false, reason: "automated browser" };
  if (!allowLocal && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(win.location.hostname)) return { available: false, reason: "local development" };
  return { available: true, reason: "" };
}

const safeGet = (s: WinLike["localStorage"], k: string) => { try { return s?.getItem(k) ?? null; } catch { return null; } };
const safeSet = (s: WinLike["localStorage"], k: string, v: string) => { try { s?.setItem(k, v); } catch { /* storage blocked: choice lasts for this page only */ } };

export function createAnalytics(o: { projectId: string | undefined; win: WinLike; doc: DocLike; allowLocal?: boolean }) {
  const { win, doc } = o;
  const avail = availability(o.projectId, win, o.allowLocal);
  let consent: Consent | null = avail.available ? ((safeGet(win.localStorage, CONSENT_KEY) as Consent | null) ?? null) : null;
  if (consent !== "granted" && consent !== "denied") consent = null;

  const install = () => {
    if (win.__mpClarityInstalled) return;
    win.__mpClarityInstalled = true;
    const q: Q = win.clarity ?? (function (...args: unknown[]) { (q.q = q.q ?? []).push(args); } as Q);
    win.clarity = q;
    const s = doc.createElement("script");
    s.async = true;
    s.src = `https://www.clarity.ms/tag/${encodeURIComponent(o.projectId!)}`;
    doc.head.appendChild(s);
    q("consentv2", { ad_Storage: "denied", analytics_Storage: "granted" });
  };

  const api = {
    available: avail.available,
    reason: avail.reason,
    consent: () => consent,
    /** Call once the app shell is shown. Installs only with prior consent. */
    start() {
      if (avail.available && consent === "granted") { install(); api.enteredOnce(); }
    },
    grant() {
      if (!avail.available) return;
      consent = "granted";
      safeSet(win.localStorage, CONSENT_KEY, "granted");
      if (win.__mpClarityInstalled) win.clarity?.("consentv2", { ad_Storage: "denied", analytics_Storage: "granted" });
      install();
      api.enteredOnce();
    },
    deny() {
      if (!avail.available) return;
      const wasOn = consent === "granted" && win.__mpClarityInstalled;
      consent = "denied";
      safeSet(win.localStorage, CONSENT_KEY, "denied");
      if (wasOn) win.clarity?.("consent", false); // documented withdrawal: clears Clarity cookies, stops tracking
    },
    enteredOnce() {
      if (safeGet(win.sessionStorage, ENTERED_KEY)) return;
      if (api.track("project_entered")) safeSet(win.sessionStorage, ENTERED_KEY, "1");
    },
    /** Sends a whitelisted event name only; returns whether it was sent. */
    track(name: AnalyticsEvent): boolean {
      if (!avail.available || consent !== "granted" || !win.__mpClarityInstalled) return false;
      if (!(ALLOWED_EVENTS as readonly string[]).includes(name)) return false;
      win.clarity?.("event", name);
      return true;
    },
  };
  return api;
}

export type Analytics = ReturnType<typeof createAnalytics>;

/** No-op instance used before the app shell decides (and in tests). */
export const noAnalytics: Analytics = createAnalytics({ projectId: undefined, win: { location: { hostname: "" }, navigator: {} }, doc: { createElement: () => ({ async: false, src: "" }), head: { appendChild: () => undefined } } });
