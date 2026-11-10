/** CH-11: execution history is the write-related audit events, in order, unchanged. */
import { describe, expect, it } from "vitest";
import { executionHistory } from "../../apps/web/src/state/history";

const ev = (seq: number, type: string, payload: unknown) => ({ seq, type, atSim: "2026-10-18T18:31:43-04:00", atWall: "", actor: "x", payload, hash: "h" });

describe("executionHistory", () => {
  it("zero: no write-related events", () => {
    expect(executionHistory([ev(1, "EVENT_RECEIVED", {}), ev(2, "POLICY_EVALUATED", {})])).toEqual([]);
  });
  it("one event", () => {
    expect(executionHistory([ev(5, "PATCH_NOT_SENT", { preWrite: "STALE_CAMPAIGN: changed" })])).toEqual([
      { seq: 5, at: "2026-10-18T18:31:43-04:00", title: "Pause not sent", detail: "STALE_CAMPAIGN: changed" },
    ]);
  });
  it("retry sequence keeps every attempt and readback in audit order", () => {
    const h = executionHistory([
      ev(10, "PATCH_SENT", { requestId: "req-1", attempt: 1, outcome: "AMBIGUOUS" }),
      ev(11, "READBACK", { ok: true, configuredStatus: "CAMPAIGN_CONFIGURED_STATUS_ACTIVE", effectiveStatus: "CAMPAIGN_EFFECTIVE_STATUS_ACTIVE", version: 12 }),
      ev(12, "STATE_CHANGED", {}),
      ev(13, "PATCH_SENT", { requestId: "req-2", attempt: 2, outcome: "SUCCESS" }),
      ev(14, "READBACK", { ok: false, error: "NETWORK: dropped" }),
      ev(15, "PAUSE_VERIFIED", {}),
    ]);
    expect(h.map((x) => x.seq)).toEqual([10, 11, 13, 14, 15]);
    expect(h[1]!.detail).toBe("configured active, effective active, version 12");
    expect(h[3]!.detail).toBe("read failed: NETWORK: dropped");
  });
});
