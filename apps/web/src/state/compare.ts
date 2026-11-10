/**
 * Geometry for a value-versus-baseline bar (V3 CH-10). Integer inputs (cents).
 * Widths are true proportions of a shared scale; a value above the baseline
 * extends the scale instead of being clipped at 100 percent.
 */
export interface CompareGeometry {
  valuePct: number; // 0..100, width of the value bar
  baselinePct: number; // 0..100, position of the baseline marker
  gap: number; // value - baseline, same unit as inputs
  state: "below" | "equal" | "above";
  belowZero: boolean;
}

export function compareGeometry(value: number, baseline: number): CompareGeometry {
  const scale = Math.max(Math.abs(value), Math.abs(baseline), 1);
  const pct = (x: number) => Math.round((Math.max(x, 0) / scale) * 1000) / 10;
  const gap = value - baseline;
  return {
    valuePct: pct(value),
    baselinePct: pct(baseline),
    gap,
    state: gap < 0 ? "below" : gap === 0 ? "equal" : "above",
    belowZero: value < 0,
  };
}
