/** CH-8: trailing store history counting rules. */
import { describe, expect, it } from "vitest";
import { HistoryRow, summarizeHistory } from "../../apps/api/src/orchestration/history";
import { historyLine } from "../../apps/web/src/state/format";

const NOW = Date.parse("2026-10-18T18:31:43-04:00");
const ago = (s: number) => new Date(NOW - s * 1000).toISOString();
let seq = 0;
const row = (eventId: string, status: string, createdAt = ago(60)): HistoryRow => ({ id: `inv-${++seq}`, eventId, status, createdAt, seq });

describe("summarizeHistory", () => {
  it("zero data", () => {
    const h = summarizeHistory([], "cur", NOW);
    expect(h.alerts).toBe(0);
    expect(historyLine(h)).toBe("No earlier alerts for this store in the last 90 days.");
  });

  it("multiple outcomes reconcile and exclude the current alert", () => {
    const rows = [row("e1", "PAUSE_VERIFIED"), row("e2", "DISMISSED"), row("e3", "BLOCKED"), row("e4", "AWAITING_APPROVAL"), row("cur", "AWAITING_APPROVAL")];
    const h = summarizeHistory(rows, "cur", NOW);
    expect(h).toMatchObject({ alerts: 4, paused: 1, keptActive: 1, blocked: 1, open: 1, noAction: 0, needsReview: 0 });
    expect(h.paused + h.keptActive + h.noAction + h.needsReview + h.blocked + h.open).toBe(h.alerts);
    expect(historyLine(h)).toBe("Earlier alerts for this store (last 90 days, not counting this one): 4. 1 paused, 1 kept active, 1 blocked, 1 still open.");
  });

  it("a re-assessed alert counts once, by its latest outcome", () => {
    const rows = [row("e1", "BLOCKED"), row("e1", "PAUSE_VERIFIED")];
    expect(summarizeHistory(rows, "cur", NOW)).toMatchObject({ alerts: 1, paused: 1, blocked: 0 });
  });

  it("window edges: exactly 90 days counts, one second older does not, future rows do not", () => {
    const d90 = 90 * 86400;
    expect(summarizeHistory([row("e1", "NO_ACTION", ago(d90))], "cur", NOW).alerts).toBe(1);
    expect(summarizeHistory([row("e1", "NO_ACTION", ago(d90 + 1))], "cur", NOW).alerts).toBe(0);
    expect(summarizeHistory([row("e1", "NO_ACTION", ago(-5))], "cur", NOW).alerts).toBe(0);
  });

  it("a re-assessment inside the window of an alert that first arrived outside it is not counted", () => {
    const rows = [row("e1", "BLOCKED", ago(91 * 86400)), row("e1", "NO_ACTION", ago(60))];
    expect(summarizeHistory(rows, "cur", NOW).alerts).toBe(0);
  });
});
