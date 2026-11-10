/** CH-6: possible repeat alert detector. */
import { describe, expect, it } from "vitest";
import { AlertRef, findPossibleRepeat, REPEAT_WINDOW_S } from "../../apps/api/src/policy/repeatAlert";

const base: AlertRef = { investigationId: "inv-1042", eventId: "evt-1", posStoreId: "S1", snapshotId: "snap-1", p95: 34, occurredAt: "2026-10-18T18:31:43-04:00" };
const at = (sec: number) => new Date(Date.parse(base.occurredAt) + sec * 1000).toISOString();
const cur = (patch: Partial<AlertRef> = {}): AlertRef => ({ ...base, investigationId: "inv-1043", eventId: "evt-2", ...patch });

describe("findPossibleRepeat", () => {
  it("flags the same store, snapshot and P95 under a different event id", () => {
    const r = findPossibleRepeat(cur(), [base]);
    expect(r.flagged).toBe(true);
    if (r.flagged) expect(r.prior.investigationId).toBe("inv-1042");
  });
  it("does not flag a different store with the same values", () => {
    expect(findPossibleRepeat(cur({ posStoreId: "S2" }), [base]).flagged).toBe(false);
  });
  it("does not flag a genuinely new condition (new snapshot), like a legitimate second rush", () => {
    expect(findPossibleRepeat(cur({ snapshotId: "snap-2" }), [base]).flagged).toBe(false);
  });
  it("does not flag the same snapshot reported with a different P95", () => {
    expect(findPossibleRepeat(cur({ p95: 35 }), [base]).flagged).toBe(false);
  });
  it("excludes the same event id (redelivery or re-assessment) and self", () => {
    expect(findPossibleRepeat(cur({ eventId: "evt-1" }), [base]).flagged).toBe(false);
    expect(findPossibleRepeat(base, [base]).flagged).toBe(false);
  });
  it("window boundary: exactly at the window flags, one second over does not", () => {
    expect(findPossibleRepeat(cur({ occurredAt: at(REPEAT_WINDOW_S) }), [base]).flagged).toBe(true);
    expect(findPossibleRepeat(cur({ occurredAt: at(REPEAT_WINDOW_S + 1) }), [base]).flagged).toBe(false);
    expect(findPossibleRepeat(cur({ occurredAt: at(-REPEAT_WINDOW_S) }), [base]).flagged).toBe(true);
  });
  it("picks the closest prior when several match, deterministically", () => {
    const older = { ...base, investigationId: "inv-1040", eventId: "evt-0", occurredAt: at(-300) };
    const r = findPossibleRepeat(cur({ occurredAt: at(60) }), [older, base]);
    expect(r.flagged && r.prior.investigationId).toBe("inv-1042");
    expect(r.flagged && r.secondsApart).toBe(60);
  });
});
