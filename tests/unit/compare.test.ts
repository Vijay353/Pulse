/** CH-10: comparison bar geometry. */
import { describe, expect, it } from "vitest";
import { compareGeometry } from "../../apps/web/src/state/compare";

describe("compareGeometry", () => {
  it("scenario A: $3.20 against a $5.60 floor is a shortfall of $2.40", () => {
    expect(compareGeometry(320, 560)).toEqual({ valuePct: 57.1, baselinePct: 100, gap: -240, state: "below", belowZero: false });
  });
  it("a value above the floor extends the scale, never clipped", () => {
    const g = compareGeometry(1120, 560);
    expect(g).toMatchObject({ valuePct: 100, baselinePct: 50, gap: 560, state: "above" });
  });
  it("equal and zero cases", () => {
    expect(compareGeometry(560, 560)).toMatchObject({ valuePct: 100, baselinePct: 100, state: "equal", gap: 0 });
    expect(compareGeometry(0, 0)).toMatchObject({ valuePct: 0, baselinePct: 0, state: "equal" });
    expect(compareGeometry(0, 560)).toMatchObject({ valuePct: 0, state: "below" });
  });
  it("negative contribution shows an empty bar flagged below zero", () => {
    expect(compareGeometry(-900, 560)).toMatchObject({ valuePct: 0, baselinePct: 62.2, gap: -1460, belowZero: true, state: "below" });
  });
  it("large values stay proportional", () => {
    expect(compareGeometry(1_000_000, 250_000)).toMatchObject({ valuePct: 100, baselinePct: 25 });
  });
});
