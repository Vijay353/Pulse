/**
 * Execution history for the outcome panel (V3 CH-11), derived from the real
 * audit trail in order. Nothing is reordered, dropped or rewritten; only the
 * write-related events are listed.
 */
import type { AuditEvent } from "../api/client";

export interface HistoryItem {
  seq: number;
  at: string;
  title: string;
  detail: string;
}

const statusWord = (s: unknown) => (typeof s === "string" ? s.replace(/^CAMPAIGN_(CONFIGURED|EFFECTIVE)_STATUS_/, "").toLowerCase() : "unknown");

export function executionHistory(audit: AuditEvent[]): HistoryItem[] {
  const out: HistoryItem[] = [];
  for (const e of audit) {
    const p = (e.payload ?? {}) as Record<string, unknown>;
    switch (e.type) {
      case "PATCH_SENT":
        out.push({ seq: e.seq, at: e.atSim, title: `Pause sent (attempt ${String(p.attempt ?? "?")})`, detail: `Request ${String(p.requestId ?? "?")}, outcome ${String(p.outcome ?? "unknown").toLowerCase()}` });
        break;
      case "PATCH_NOT_SENT":
        out.push({ seq: e.seq, at: e.atSim, title: "Pause not sent", detail: String(p.preWrite ?? "pre-write check stopped it") });
        break;
      case "READBACK":
        out.push({
          seq: e.seq, at: e.atSim, title: "Campaign read back",
          detail: p.ok === true ? `configured ${statusWord(p.configuredStatus)}, effective ${statusWord(p.effectiveStatus)}, version ${String(p.version ?? "?")}` : `read failed: ${String(p.error ?? "unknown error")}`,
        });
        break;
      case "AMBIGUOUS_WRITE_RESOLVED":
        out.push({ seq: e.seq, at: e.atSim, title: "Unclear result resolved", detail: `resolved as ${String(p.resolvedAs ?? "?").toLowerCase().replace(/_/g, " ")}` });
        break;
      case "PAUSE_VERIFIED":
        out.push({ seq: e.seq, at: e.atSim, title: "Pause verified", detail: "configured and effective status both paused" });
        break;
    }
  }
  return out;
}
