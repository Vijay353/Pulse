/**
 * Simulated world clock shared by MarginPulse and both simulators.
 * It is FROZEN at the scenario's start time and only moves when a user or test
 * advances it explicitly. This keeps freshness checks deterministic and lets a
 * reviewer demonstrate staleness on purpose ("advance clock 5 min").
 * Wall-clock time is still recorded beside every audit event.
 */
import { Db, kvGet, kvSet } from "./db/db";

export const DEFAULT_TZ = "America/New_York";

export interface Clock {
  nowMs(): number;
  nowIso(): string;
  advance(seconds: number): void;
  set(iso: string): void;
}

export function simClock(db: Db, tz = DEFAULT_TZ): Clock {
  const read = () => {
    const v = kvGet(db, "clock.now");
    return v ? Date.parse(v) : Date.parse("2026-10-18T18:31:43-04:00");
  };
  return {
    nowMs: read,
    nowIso: () => toZonedIso(read(), tz),
    advance(seconds: number) {
      kvSet(db, "clock.now", toZonedIso(read() + seconds * 1000, tz));
    },
    set(iso: string) {
      if (Number.isNaN(Date.parse(iso))) throw new Error("invalid clock time");
      kvSet(db, "clock.now", toZonedIso(Date.parse(iso), tz));
    },
  };
}

/** Format epoch ms as ISO-8601 with the zone's numeric offset, e.g. 2026-10-18T18:31:43-04:00 */
export function toZonedIso(ms: number, tz = DEFAULT_TZ): string {
  const d = new Date(ms);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  const localAsUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second),
  );
  const offsetMin = Math.round((localAsUtc - Math.floor(ms / 1000) * 1000) / 60000);
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const off = `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${off}`;
}

export const ageSeconds = (nowMs: number, iso: string) => Math.round((nowMs - Date.parse(iso)) / 1000);
