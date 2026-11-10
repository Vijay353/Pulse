/** CH-2: typed readers never turn malformed tool output into usable values. */
import { describe, expect, it } from "vitest";
import { CalculationData, KitchenSnapshotData, readTool, toolError } from "../../apps/api/src/agents/toolResults";

const ok = (data: unknown) => ({ evidenceRef: "ev-1", ok: true, data });
const kitchen = { snapshotId: "s", storeId: "st", capturedAt: "2026-10-18T18:31:20-04:00", p95PrepMinutes: 34, activeTickets: 18, connectorHealth: "HEALTHY" };

describe("readTool", () => {
  it("returns typed values for a valid result", () => {
    const r = readTool(KitchenSnapshotData, ok(kitchen));
    expect(r).toEqual({ ok: true, value: kitchen });
  });

  it.each([
    ["number as string", { ...kitchen, p95PrepMinutes: "34" }],
    ["missing field", { ...kitchen, capturedAt: undefined }],
    ["unknown health value", { ...kitchen, connectorHealth: "FINE" }],
    ["negative tickets", { ...kitchen, activeTickets: -1 }],
    ["null body", null],
  ])("rejects %s instead of defaulting", (_name, data) => {
    const r = readTool(KitchenSnapshotData, ok(data));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem).toContain("did not match its schema");
  });

  it("a failed tool call is never read as a value, even if its data looks valid", () => {
    expect(readTool(KitchenSnapshotData, { evidenceRef: "err-1", ok: false, data: kitchen }).ok).toBe(false);
  });

  it("calculation results keep the typed abstain shape", () => {
    expect(CalculationData.safeParse({ result: { ok: false, missing: ["ad spend"] } }).success).toBe(true);
    expect(CalculationData.safeParse({ result: { ok: true, orders: 0 } }).success).toBe(false);
  });

  it("toolError reads the error payload of a failed call only", () => {
    expect(toolError({ evidenceRef: "e", ok: false, data: { error: { kind: "NETWORK" } } })).toEqual({ kind: "NETWORK" });
    expect(toolError({ evidenceRef: "e", ok: false, data: "garbage" })).toBe("unreadable tool error");
    expect(toolError(ok(kitchen))).toBeNull();
  });
});
