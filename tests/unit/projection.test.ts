/** CH-7: read-only approval projection. */
import { describe, expect, it } from "vitest";
import { projectPause, PROJECTION_NOTE } from "../../apps/web/src/state/projection";

const actions = { canApprove: true, canDismiss: true, canPause: false, canRetry: false, canCheckAgain: false, canReassess: false };
const campaign = { campaignId: "cmp-syn-4081", name: "Downtown Sponsored Listing", configuredStatus: "CAMPAIGN_CONFIGURED_STATUS_ACTIVE", effectiveStatusRaw: "CAMPAIGN_EFFECTIVE_STATUS_ACTIVE", permissions: ["READ", "UPDATE"], version: 12, dailyBudgetCents: 4000 };
const live = { campaignId: "cmp-syn-4081", name: "Downtown Sponsored Listing", configuredStatus: "CAMPAIGN_CONFIGURED_STATUS_ACTIVE", effectiveStatusRaw: "CAMPAIGN_EFFECTIVE_STATUS_ACTIVE", serving: "SERVING", version: 12, updatedBy: null };
const seen = [
  { campaignId: "cmp-syn-3990", name: "Spring", configuredStatus: "CAMPAIGN_CONFIGURED_STATUS_PAUSED", eligible: false },
  { campaignId: "cmp-syn-4081", name: "Downtown", configuredStatus: "CAMPAIGN_CONFIGURED_STATUS_ACTIVE", eligible: true },
];

describe("projectPause", () => {
  it("scenario A values: exact integer money, nothing invented", () => {
    const p = projectPause({ actions, campaign, liveCampaign: live, campaignsSeen: seen });
    expect(p.available).toBe(true);
    if (!p.available) return;
    expect(p.note).toBe(PROJECTION_NOTE);
    const row = (l: string) => p.rows.find((r) => r.label === l)!;
    expect(row("Campaign status")).toMatchObject({ now: "Active", ifApproved: "Paused" });
    expect(row("Ads serving").now).toBe("Serving");
    expect(row("Daily budget")).toMatchObject({ now: "$40.00", ifApproved: "$40.00, not changed" });
    expect(row("Other campaigns for this store").now).toBe("1");
    expect(JSON.stringify(p)).not.toMatch(/sav|profit|lift|\$\d+\.\d\d (saved|less)/i);
  });

  it("odd cents are formatted exactly", () => {
    const p = projectPause({ actions, campaign: { ...campaign, dailyBudgetCents: 3999 }, liveCampaign: live, campaignsSeen: seen });
    expect(p.available && p.rows.find((r) => r.label === "Daily budget")!.now).toBe("$39.99");
  });

  it("missing budget and missing live read are shown as unknown, not guessed", () => {
    const p = projectPause({ actions, campaign: { ...campaign, dailyBudgetCents: null }, liveCampaign: null, campaignsSeen: [] });
    expect(p.available).toBe(true);
    if (!p.available) return;
    expect(p.rows.find((r) => r.label === "Daily budget")!.now).toBe("Not reported");
    expect(p.rows.find((r) => r.label === "Ads serving")!.now).toBe("Unknown");
    expect(p.rows.find((r) => r.label === "Campaign status")!.now).toBe("Active");
  });

  it("no projection when nothing is on offer", () => {
    const off = { ...actions, canApprove: false };
    expect(projectPause({ actions: off, campaign, liveCampaign: live, campaignsSeen: seen }).available).toBe(false);
    expect(projectPause({ actions, campaign: null, liveCampaign: null, campaignsSeen: seen }).available).toBe(false);
  });
});
