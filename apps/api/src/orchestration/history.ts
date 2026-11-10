/**
 * Trailing alert history for one store (V3 CH-8), from MarginPulse's own
 * investigation records only. Counting rules:
 *  - one alert per event id; a re-assessed alert counts once, by its latest investigation
 *  - the current alert is excluded from its own history
 *  - window: created_at within the last `days` days of the scenario clock, inclusive
 *  - buckets reconcile: alerts = paused + keptActive + noAction + needsReview + blocked + open
 */
export interface HistoryRow {
  id: string;
  eventId: string;
  status: string;
  createdAt: string;
  seq: number; // insertion order, to find the latest investigation per event
}

export interface StoreHistory {
  windowDays: number;
  excludesCurrentAlert: true;
  alerts: number;
  paused: number;
  keptActive: number;
  noAction: number;
  needsReview: number;
  blocked: number;
  open: number;
}

const BUCKET: Record<string, keyof Omit<StoreHistory, "windowDays" | "excludesCurrentAlert" | "alerts">> = {
  PAUSE_VERIFIED: "paused",
  DISMISSED: "keptActive",
  NO_ACTION: "noAction",
  NEEDS_REVIEW: "needsReview",
  BLOCKED: "blocked",
};

export function summarizeHistory(rows: HistoryRow[], currentEventId: string, nowMs: number, days = 90): StoreHistory {
  const from = nowMs - days * 86400 * 1000;
  const latest = new Map<string, HistoryRow>();
  for (const r of rows) {
    if (r.eventId === currentEventId) continue;
    const prev = latest.get(r.eventId);
    if (!prev || r.seq > prev.seq) latest.set(r.eventId, r);
  }
  const h: StoreHistory = { windowDays: days, excludesCurrentAlert: true, alerts: 0, paused: 0, keptActive: 0, noAction: 0, needsReview: 0, blocked: 0, open: 0 };
  for (const r of latest.values()) {
    // Window by when the alert first arrived: the earliest investigation for that event.
    const first = rows.filter((x) => x.eventId === r.eventId).reduce((a, b) => (a.seq <= b.seq ? a : b));
    const t = Date.parse(first.createdAt);
    if (!(t >= from && t <= nowMs)) continue;
    h.alerts++;
    h[BUCKET[r.status] ?? "open"]++;
  }
  return h;
}
