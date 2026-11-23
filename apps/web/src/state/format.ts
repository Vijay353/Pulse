/** Plain-language copy for every decision code. One job per message: what happened, what to do. */
export const CODE_COPY: Record<string, { title: string; body: string }> = {
  RECOMMEND_PAUSE: { title: "Recommendation ready", body: "Kitchen and campaign evidence meet your pause rule. Nothing changes until a manager approves." },
  NO_ACTION_BELOW_THRESHOLD: { title: "No action needed", body: "The kitchen is busy but still under your limit. The campaign stays as it is." },
  NO_ACTION_CONTRIBUTION_OK: { title: "No action needed", body: "The kitchen is over your limit, but recent orders from this campaign still clear your contribution floor." },
  NEEDS_REVIEW_STALE_ADS_DATA: { title: "Needs review: ad report is too old", body: "The latest campaign report is older than your policy allows, so cost evidence can’t support a pause." },
  NEEDS_REVIEW_CAMPAIGN_SELECTION: { title: "Needs review: more than one campaign", body: "Two or more Sponsored Listings campaigns are active for this store. Choose in Uber Ads; MarginPulse won’t pick one for you." },
  NEEDS_REVIEW_STORE_MAPPING: { title: "Needs review: store mapping", body: "This POS store maps to more than one Uber store. Fix the mapping before any campaign can be selected." },
  NEEDS_REVIEW_COST_DATA: { title: "Needs review: cost data missing", body: "Some merchant cost inputs are blank, so the contribution estimate was not calculated." },
  NEEDS_REVIEW_AGENT_ABSTAINED: { title: "Needs review: investigator abstained", body: "The facts meet the rule, but the investigator did not propose the pause. A person should look." },
  BLOCKED_STALE_KITCHEN_DATA: { title: "Blocked: kitchen data is stale", body: "The latest KDS snapshot is older than your policy allows. Ads data is never used to guess kitchen load." },
  BLOCKED_STALE_EVENT: { title: "Blocked: alert arrived too late", body: "The kitchen alert is older than your policy allows." },
  BLOCKED_POS_UNAVAILABLE: { title: "Blocked: POS unavailable", body: "MarginPulse couldn’t re-read the kitchen from the POS, so it won’t act on the alert alone." },
  BLOCKED_MISSING_PERMISSION: { title: "Blocked: no permission to update", body: "The integration can read this campaign but not change it. Ask the ad account owner for UPDATE access." },
  BLOCKED_POLICY_CHANGED: { title: "Blocked: your policy changed", body: "The merchant policy was edited after this recommendation. Re-assess with the new policy." },
  BLOCKED_CONTEXT_CHANGED: { title: "Blocked: campaign changed", body: "Someone changed the campaign after you reviewed it. No change was sent. Re-assess and approve again." },
  BLOCKED_RECOMMENDATION_EXPIRED: { title: "Blocked: recommendation expired", body: "Too much time passed since the recommendation. Re-assess with fresh data." },
  BLOCKED_INVALID_AGENT_OUTPUT: { title: "Blocked: investigation failed validation", body: "The investigator’s report cited evidence that doesn’t check out, so it was discarded." },
  BLOCKED_INVESTIGATOR_UNAVAILABLE: { title: "Blocked: investigator not configured", body: "The selected investigator is missing configuration. Switch back to the fixture investigator or add the settings." },
  BLOCKED_ADS_UNAVAILABLE: { title: "Blocked: Uber Ads unavailable", body: "Campaigns couldn’t be read from the selected Uber Ads provider." },
  BLOCKED_NO_POLICY: { title: "Blocked: no merchant policy", body: "This store has no current rush-control policy." },
  PAUSE_REQUESTED_STILL_SERVING: { title: "Pause requested, still serving", body: "Uber Ads accepted the pause but still reports the campaign as serving. Check again in a few seconds." },
  PAUSE_OUTCOME_UNCONFIRMED: { title: "Pause outcome not confirmed", body: "No reliable answer came back. MarginPulse will not resend the change until a check shows what happened." },
  DISMISSED_BY_MANAGER: { title: "Kept active", body: "The manager chose to keep the campaign running. Nothing was changed." },
  PAUSE_VERIFIED: { title: "Campaign paused and verified", body: "Uber Ads confirms the campaign is paused and no longer serving." },
};

export function copyFor(code: string | null) {
  if (!code) return { title: "Assessing", body: "" };
  if (CODE_COPY[code]) return CODE_COPY[code]!;
  if (code.startsWith("PAUSE_NOT_APPLIED")) return { title: "Pause not applied", body: "Uber Ads did not apply the change. The campaign is still active; you can retry with the same approval." };
  if (code.startsWith("PREWRITE_")) return { title: "Pause not sent", body: "A pre-check against Uber Ads failed, so nothing was sent. You can retry." };
  return { title: code.replace(/_/g, " ").toLowerCase(), body: "" };
}

export const usd = (cents: number | null | undefined) => (cents === null || cents === undefined ? "n/a" : `${cents < 0 ? "−" : ""}$${(Math.abs(cents) / 100).toFixed(2)}`);
export const pct = (bps: number) => `${(bps / 100).toFixed(1)}%`;

export function clock(iso: string | null | undefined, tz = "America/New_York") {
  if (!iso) return "n/a";
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", second: "2-digit" }).format(new Date(iso));
}
export function shortClock(iso: string | null | undefined, tz = "America/New_York") {
  if (!iso) return "n/a";
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}
export function age(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined) return "n/a";
  if (seconds < 120) return `${seconds} sec`;
  return `${Math.round(seconds / 60)} min`;
}
export const statusWord = (s: string | null | undefined) =>
  s ? s.replace("CAMPAIGN_CONFIGURED_STATUS_", "").replace("CAMPAIGN_EFFECTIVE_STATUS_", "").replace(/_/g, " ") : "n/a";

/** One plain line for the store's trailing alert history (V3 CH-8). Only non-zero parts are listed. */
export function historyLine(h: { windowDays: number; alerts: number; paused: number; keptActive: number; noAction: number; needsReview: number; blocked: number; open: number }) {
  if (h.alerts === 0) return `No earlier alerts for this store in the last ${h.windowDays} days.`;
  const parts = [
    [h.paused, "paused"], [h.keptActive, "kept active"], [h.noAction, "no action needed"],
    [h.needsReview, "needed review"], [h.blocked, "blocked"], [h.open, "still open"],
  ].filter(([n]) => (n as number) > 0).map(([n, w]) => `${n} ${w}`);
  return `Earlier alerts for this store (last ${h.windowDays} days, not counting this one): ${h.alerts}. ${parts.join(", ")}.`;
}

/** Policy provenance line (V3 CH-16). Only states what was recorded. */
export function provenanceLine(p: { policyId: string; version: string; effectiveFrom: string; checkCount: number; changedBy: string | null; changedAt: string | null; changeSource: string | null } | null) {
  if (!p) return "Merchant policy not available.";
  const day = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", year: "numeric" }).format(new Date(p.effectiveFrom));
  const who = p.changedBy
    ? `Changed by ${p.changedBy} ${p.changeSource === "IMPORT" ? "through a data studio import" : "in the policy settings"} at ${clock(p.changedAt)}.`
    : "Provenance unavailable: no author was recorded for this version.";
  return `Merchant policy ${p.policyId}-${p.version}, effective ${day}, runs ${p.checkCount} ordered checks. ${who}`;
}

/** CH-9: "1 min 20 sec" style durations for the digest. */
export function duration(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined) return "n/a";
  if (seconds < 60) return `${seconds} sec`;
  const m = Math.floor(seconds / 60), s = seconds % 60;
  return s ? `${m} min ${s} sec` : `${m} min`;
}
export const rate = (bps: number | null | undefined) => (bps === null || bps === undefined ? "n/a" : `${Math.round(bps / 100)}%`);

/** CH-9: plural-safe count phrase. */
export const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
