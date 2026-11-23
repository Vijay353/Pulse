/**
 * Per-browser display preferences (CH-7, CH-12). These are conveniences only:
 * nothing here is business state, and every read tolerates storage being
 * unavailable (private mode, blocked storage) by returning the default.
 */
const KEYS = { demoTools: "mp.demoTools", welcomeDismissed: "mp.welcomeDismissed" } as const;
type Key = keyof typeof KEYS;

export function readPref(key: Key): boolean {
  try { return window.localStorage.getItem(KEYS[key]) === "1"; } catch { return false; }
}
export function writePref(key: Key, on: boolean) {
  try { window.localStorage.setItem(KEYS[key], on ? "1" : "0"); } catch { /* storage unavailable: preference lasts for this page only */ }
}
/** `?onboarding=0` hides the first-run welcome (used by demos and tests). */
export function onboardingDisabledByUrl(search = typeof location === "undefined" ? "" : location.search) {
  return new URLSearchParams(search).get("onboarding") === "0";
}
