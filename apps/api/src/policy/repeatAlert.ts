/**
 * Possible repeat alert detection (V3 CH-6).
 *
 * A POS can resend the same kitchen condition under a new event id (for
 * example after a restart), which webhook idempotency on eventId cannot catch.
 * This flags a candidate when another alert exists for:
 *   same store + same kitchen snapshot + same P95 value + different event id
 *   + event times no more than REPEAT_WINDOW_S apart.
 * A genuinely new condition always has a new snapshot id, so it is never
 * flagged. The flag is a warning for a person, not a finding of wrongdoing:
 * it never blocks or approves anything by itself, but approval then requires
 * an explicit acknowledgement.
 */
export const REPEAT_WINDOW_S = 600;
export const REPEAT_WARNING = "POSSIBLE_REPEAT_ALERT" as const;

export interface AlertRef {
  investigationId: string;
  eventId: string;
  posStoreId: string;
  snapshotId: string;
  p95: number;
  occurredAt: string;
}

export type RepeatCheck =
  | { flagged: false; compared: number; windowS: number }
  | {
      flagged: true;
      compared: number;
      windowS: number;
      prior: AlertRef;
      matchedFields: string[];
      secondsApart: number;
    };

export function findPossibleRepeat(current: AlertRef, priors: AlertRef[], windowS = REPEAT_WINDOW_S): RepeatCheck {
  const t = Date.parse(current.occurredAt);
  const candidates = priors
    .filter((p) => p.eventId !== current.eventId) // same event (redelivery or re-assessment) is not a repeat
    .filter((p) => p.posStoreId === current.posStoreId && p.snapshotId === current.snapshotId && p.p95 === current.p95)
    .map((p) => ({ p, secondsApart: Math.abs(Math.round((t - Date.parse(p.occurredAt)) / 1000)) }))
    .filter((x) => Number.isFinite(x.secondsApart) && x.secondsApart <= windowS)
    .sort((a, b) => a.secondsApart - b.secondsApart || a.p.investigationId.localeCompare(b.p.investigationId));
  const best = candidates[0];
  if (!best) return { flagged: false, compared: priors.length, windowS };
  return {
    flagged: true,
    compared: priors.length,
    windowS,
    prior: best.p,
    matchedFields: ["store", "kitchen snapshot", "P95 prep time", "event time within window"],
    secondsApart: best.secondsApart,
  };
}
