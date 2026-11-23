/** CH-12: source-labeled badges; unknown is distinct from any known state. */
import { describe, expect, it } from "vitest";
import { adsBadge, isSimulatedProvider, posBadge } from "../../apps/web/src/state/badges";

const A = "CAMPAIGN_CONFIGURED_STATUS_ACTIVE";
const P = "CAMPAIGN_CONFIGURED_STATUS_PAUSED";

describe("adsBadge", () => {
  it.each([
    [{ configuredStatus: A, serving: "SERVING" }, "Active, serving", "live"],
    [{ configuredStatus: P, serving: "NOT_SERVING" }, "Paused, not serving", "ok"],
    [{ configuredStatus: P, serving: "SERVING" }, "Paused, still serving", "warn"],
    [{ configuredStatus: A, serving: "UNKNOWN" }, "Active, serving unknown", "unknown"],
  ])("%j", (live, text, tone) => {
    expect(adsBadge(live, null)).toEqual({ source: "Uber Ads, live read", text, tone });
  });
  it("no live read is Unknown, with the failure called out", () => {
    expect(adsBadge(null, null).text).toBe("Unknown");
    expect(adsBadge(null, "HTTP 500")).toMatchObject({ text: "Unknown (read failed)", tone: "unknown" });
  });
});

describe("posBadge", () => {
  it("names its source and keeps unknown distinct", () => {
    expect(posBadge("HEALTHY")).toEqual({ source: "POS connector, at decision", text: "Healthy", tone: "ok" });
    expect(posBadge("DOWN").text).toBe("Down");
    expect(posBadge(null)).toMatchObject({ text: "Unknown", tone: "unknown" });
    expect(posBadge("SOMETHING_NEW").text).toBe("Unknown");
  });
});

describe("CH-6: simulator sources are labeled as mock", () => {
  it("adds a Mock prefix only when the provider is the local simulator", () => {
    expect(adsBadge(null, null, true).source).toBe("Mock Uber Ads, live read");
    expect(posBadge("HEALTHY", true).source).toBe("Mock POS connector, at decision");
    expect(isSimulatedProvider("Mock Uber Ads (local simulator)")).toBe(true);
    expect(isSimulatedProvider("Mock POS/KDS (local simulator · mocked partner extension)")).toBe(true);
    expect(isSimulatedProvider("Uber Ads LIVE (https://api.uber.com)")).toBe(false);
    expect(isSimulatedProvider(undefined)).toBe(false);
  });
});
