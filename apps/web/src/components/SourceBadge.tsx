import type { Badge } from "../state/badges";

/** A status with its source written out; color is never the only signal. */
export function SourceBadge({ badge }: { badge: Badge }) {
  return (
    <span className="source-badge">
      <span className="source-badge-source">{badge.source}:</span>{" "}
      <span className={`chip chip-${badge.tone}`}>{badge.text}</span>
    </span>
  );
}
