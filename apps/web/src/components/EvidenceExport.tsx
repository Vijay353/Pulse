import { useState } from "react";
import { api, ApiError } from "../api/client";
import { useAnalytics } from "../analytics/context";

const STATUS_TEXT: Record<string, string> = {
  complete: "Complete: every record this alert needs is present and the audit chain verifies.",
  partial: "Partial: some evidence is not available yet or was never recorded (reasons are listed in the file).",
  unverifiable: "Unverifiable: the audit chain does not verify, so the records cannot be trusted as a whole.",
};

/** Downloads the audit evidence package (V3 CH-18). Read-only; nothing is changed. */
export function EvidenceExport({ investigationId }: { investigationId: string }) {
  const [result, setResult] = useState<{ status: string; sha256: string; filename: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const analytics = useAnalytics();
  const run = async () => {
    setBusy(true); setError(null);
    analytics.track("audit_export_clicked");
    try {
      const { blob, headers, filename } = await api.download(`/api/investigations/${encodeURIComponent(investigationId)}/evidence-package`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setResult({ status: headers.get("x-evidence-status") ?? "unknown", sha256: headers.get("x-evidence-sha256") ?? "", filename });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="evidence-export">
      <button className="btn quiet small" onClick={run} disabled={busy}>{busy ? "Preparing…" : "Download audit evidence package"}</button>
      <div role="status" aria-live="polite">
        {result && (
          <>
            <p><strong>{result.filename}</strong>. {STATUS_TEXT[result.status] ?? `Status: ${result.status}`}</p>
            <p className="muted small">SHA-256 file checksum <code className="hash">{result.sha256}</code>. This is a checksum, not a signature.</p>
          </>
        )}
        {error && <p className="bad">{error}</p>}
      </div>
    </div>
  );
}
