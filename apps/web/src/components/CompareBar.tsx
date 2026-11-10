import { compareGeometry } from "../state/compare";
import { usd } from "../state/format";

/** Value against a baseline, with printed numbers. Color is never the only signal. */
export function CompareBar({ value, baseline, valueLabel, baselineLabel }: { value: number; baseline: number; valueLabel: string; baselineLabel: string }) {
  const g = compareGeometry(value, baseline);
  const gapText = g.state === "equal" ? "exactly at the floor" : `${usd(Math.abs(g.gap))} ${g.state === "below" ? "below" : "above"} the floor`;
  const summary = `${valueLabel} ${usd(value)}${g.belowZero ? " (below zero)" : ""}; ${baselineLabel} ${usd(baseline)}; ${gapText}.`;
  return (
    <figure className="compare" aria-label={summary}>
      <div className="compare-track" aria-hidden="true">
        <div className={`compare-value compare-${g.state}`} style={{ width: `${g.valuePct}%` }} />
        <div className="compare-baseline" style={{ left: `${g.baselinePct}%` }} />
      </div>
      <figcaption className="compare-caption">
        <span>{valueLabel} <strong>{usd(value)}</strong>{g.belowZero ? " (below zero)" : ""}</span>
        <span>{baselineLabel} <strong>{usd(baseline)}</strong></span>
        <span className={g.state === "below" ? "bad" : "good"}>{gapText}</span>
      </figcaption>
    </figure>
  );
}
