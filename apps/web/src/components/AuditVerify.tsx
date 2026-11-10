import { useState } from "react";
import { api, ApiError } from "../api/client";

export interface ChainReport {
  ok: boolean;
  length: number;
  brokenAt: number | null;
  problem: string | null;
  head: string;
  headSeq: number | null;
  firstSeq: number | null;
  coverage: { format1: number; format2: number };
  gaps: number[];
  limits: string;
}

/** Plain summary of a chain check (V3 CH-17). Never shows a bare green tick. */
export function chainSummary(r: ChainReport): string {
  if (r.length === 0) return "The audit log is empty, so there is nothing to verify.";
  const range = `entries ${r.firstSeq} to ${r.headSeq ?? r.firstSeq}`;
  const formats = `${r.coverage.format2} in hash format 2${r.coverage.format1 ? `, ${r.coverage.format1} in the older format 1` : ""}`;
  if (r.ok) return `No break found in ${r.length} entries (${range}; ${formats}).`;
  return `Break found at entry ${r.brokenAt}: ${r.problem}. Checked ${formats} before stopping.`;
}

/** Re-runs the server-side chain check on demand. Read-only. */
export function AuditVerify() {
  const [report, setReport] = useState<ChainReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true); setError(null);
    try { setReport(await api.get<ChainReport>("/api/audit/verify")); } catch (e) { setError(e instanceof ApiError ? e.message : (e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="audit-verify">
      <button className="btn quiet small" onClick={run} disabled={busy}>{busy ? "Checking…" : "Verify audit log"}</button>
      <div role="status" aria-live="polite">
        {report && (
          <>
            <p className={report.ok ? "good" : "bad"}>{chainSummary(report)}</p>
            <p className="muted small">Head <code className="hash">{report.head}</code>. {report.limits}</p>
          </>
        )}
        {error && <p className="bad">{error}</p>}
      </div>
    </div>
  );
}
