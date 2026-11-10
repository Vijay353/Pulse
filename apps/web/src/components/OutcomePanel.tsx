import type { InvestigationView } from "../api/client";
import { clock, statusWord } from "../state/format";
import { executionHistory } from "../state/history";

/** Shown once a write was attempted. Everything here is the recorded readback, not an expectation. */
export function OutcomePanel({ v }: { v: InvestigationView }) {
  const d = v.result.tool?.detail;
  if (!d && !v.result.extraReadbacks) return null;
  const readbacks = [...(d?.readbacks ?? []), ...(v.result.extraReadbacks ?? [])];
  const last = readbacks[readbacks.length - 1];
  const verified = v.status === "PAUSE_VERIFIED";
  const approval = v.approvals[v.approvals.length - 1];
  const history = executionHistory(v.audit);
  return (
    <section className={verified ? "outcome outcome-ok" : "outcome outcome-pending"} aria-labelledby="outcome-h">
      <h2 id="outcome-h">{verified ? "Campaign paused and verified" : d?.stillServing ? "Pause requested, still serving" : "Pause not confirmed"}</h2>
      {last ? (
        <dl className="outcome-grid">
          <div><dt>Campaign</dt><dd>{v.campaign?.campaignId}</dd></div>
          <div><dt>Configured</dt><dd>{statusWord(last.configuredStatus)}</dd></div>
          <div><dt>Effective</dt><dd>{statusWord(last.effectiveStatus)}</dd></div>
          <div><dt>Version</dt><dd>{last.version ?? "n/a"}</dd></div>
          <div><dt>Changed by</dt><dd>{approval ? `${approval.approvedBy} (approved ${clock(approval.createdAt)})` : "n/a"}</dd></div>
          <div><dt>PATCH requests</dt><dd>{v.mutations.filter((m) => m.requestId !== "not-sent").length} sent</dd></div>
          <div><dt>Other mutations</dt><dd>{v.result.otherMutations === "NONE" ? "None" : v.result.otherMutations === "DETECTED" ? "Detected, see technical evidence" : v.result.otherMutations ? "Not verifiable with this provider" : "n/a"}</dd></div>
          <div><dt>Checked</dt><dd>{readbacks.length} readback{readbacks.length === 1 ? "" : "s"}{v.result.verifiedAt ? `, verified ${clock(v.result.verifiedAt)}` : ""}</dd></div>
        </dl>
      ) : <p>No readback could be completed: {d?.preWrite.reason ?? v.result.lastError?.message}</p>}
      {verified && <p className="outcome-foot">One campaign changed. It remains paused until a separate resume action.</p>}
      {!verified && v.result.lastError && <p className="outcome-foot">{v.result.lastError.message}</p>}
      {history.length > 0 && (
        <details className="exec-history" open={!verified}>
          <summary>View history ({history.length})<span className="muted"> latest: {history[history.length - 1]!.title.toLowerCase()}</span></summary>
          <ol>{history.map((h) => <li key={h.seq}><span className="audit-t">{clock(h.at)}</span> <strong>{h.title}</strong>. {h.detail}</li>)}</ol>
        </details>
      )}
    </section>
  );
}
