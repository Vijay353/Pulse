/**
 * Read-only projection of what approving the pause would change (V3 CH-7).
 * Pure function of the server view; it makes no network calls and changes
 * nothing. It never estimates money saved or orders avoided: the system has
 * no data that could support such a number.
 */
import type { InvestigationView } from "../api/client";

export interface ProjectionRow {
  label: string;
  now: string;
  ifApproved: string;
}

export type PauseProjection =
  | { available: true; rows: ProjectionRow[]; note: string }
  | { available: false; reason: string };

export const PROJECTION_NOTE = "Projection only. No records changed. Approval may allow the action, subject to final checks.";

const servingWord = (s: string | undefined) => (s === "SERVING" ? "Serving" : s === "NOT_SERVING" ? "Not serving" : "Unknown");
const configuredWord = (s: string | undefined) =>
  s === "CAMPAIGN_CONFIGURED_STATUS_ACTIVE" ? "Active" : s === "CAMPAIGN_CONFIGURED_STATUS_PAUSED" ? "Paused" : s ? "Other" : "Unknown";
const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export function projectPause(v: Pick<InvestigationView, "actions" | "campaign" | "liveCampaign" | "campaignsSeen">): PauseProjection {
  if (!(v.actions.canApprove || v.actions.canPause)) return { available: false, reason: "No pause is on offer for this investigation." };
  const c = v.campaign;
  if (!c) return { available: false, reason: "No single campaign was selected." };
  const live = v.liveCampaign;
  const configuredNow = live?.configuredStatus ?? c.configuredStatus;
  const others = v.campaignsSeen.filter((x) => x.campaignId !== c.campaignId).length;
  const budget = c.dailyBudgetCents;
  return {
    available: true,
    note: PROJECTION_NOTE,
    rows: [
      { label: "Campaign status", now: configuredWord(configuredNow), ifApproved: "Paused" },
      { label: "Ads serving", now: servingWord(live?.serving), ifApproved: "Stops once Uber applies the pause (confirmed by readback)" },
      { label: "Daily budget", now: budget === null ? "Not reported" : dollars(budget), ifApproved: budget === null ? "Not changed" : `${dollars(budget)}, not changed` },
      { label: "Other campaigns for this store", now: String(others), ifApproved: "Not changed" },
      { label: "Promotions, menu, store hours, prep time", now: "As they are", ifApproved: "Not touched" },
      { label: "How long it stays paused", now: "", ifApproved: "Until someone resumes it" },
    ],
  };
}
