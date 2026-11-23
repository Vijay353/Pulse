/**
 * Source-labeled status badges (V3 CH-12). Each badge names where its value
 * came from, and "Unknown" is never shown as a known state. Two sources are
 * never merged into one badge.
 */
export type Tone = "ok" | "live" | "warn" | "unknown";
export interface Badge { source: string; text: string; tone: Tone }

/** CH-6: when the provider is the local simulator the source says so ("Mock ..."). */
export function adsBadge(live: { configuredStatus: string; serving: string } | null, readError: string | null, simulated = false): Badge {
  const source = `${simulated ? "Mock " : ""}Uber Ads, live read`;
  if (!live) return { source, text: readError ? "Unknown (read failed)" : "Unknown", tone: "unknown" };
  const paused = live.configuredStatus === "CAMPAIGN_CONFIGURED_STATUS_PAUSED";
  const active = live.configuredStatus === "CAMPAIGN_CONFIGURED_STATUS_ACTIVE";
  if (live.serving === "UNKNOWN") return { source, text: `${paused ? "Paused" : active ? "Active" : "Other"}, serving unknown`, tone: "unknown" };
  if (paused) return live.serving === "NOT_SERVING" ? { source, text: "Paused, not serving", tone: "ok" } : { source, text: "Paused, still serving", tone: "warn" };
  if (active) return live.serving === "SERVING" ? { source, text: "Active, serving", tone: "live" } : { source, text: "Active, not serving", tone: "warn" };
  return { source, text: "Other status", tone: "unknown" };
}

export function posBadge(health: string | null | undefined, simulated = false): Badge {
  const source = `${simulated ? "Mock " : ""}POS connector, at decision`;
  switch (health) {
    case "HEALTHY": return { source, text: "Healthy", tone: "ok" };
    case "DEGRADED": return { source, text: "Degraded", tone: "warn" };
    case "DOWN": return { source, text: "Down", tone: "live" };
    default: return { source, text: "Unknown", tone: "unknown" };
  }
}

/** CH-6: provider labels from the server start with "Mock" for the local simulators. */
export const isSimulatedProvider = (label: string | null | undefined) => !!label && /^mock\b/i.test(label.trim());
