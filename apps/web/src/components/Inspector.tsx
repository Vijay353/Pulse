import { forwardRef } from "react";
import type { InvestigationView } from "../api/client";
import { clock } from "../state/format";
import { AuditVerify } from "./AuditVerify";
import { EvidenceExport } from "./EvidenceExport";

const Json = ({ value }: { value: unknown }) => <pre className="json" tabIndex={0}>{JSON.stringify(value, null, 2)}</pre>;

/** Technical evidence, collapsed by default. Every row here is read from persisted records. */
export const Inspector = forwardRef<HTMLDetailsElement, { v: InvestigationView; adsProvider: string; investigator: string | null }>(function Inspector({ v, adsProvider, investigator }, ref) {
  const d = v.result.tool?.detail;
  const lastAudit = v.audit[v.audit.length - 1];
  return (
    <details className="inspector" ref={ref}>
      <summary>Technical evidence <span className="muted">event, reads, agent output, formula, policy, approval, PATCH, readback, audit</span></summary>
      <div className="insp-body">
        <p className="muted">Providers: {adsProvider}; Mock POS/KDS (local simulator, mocked partner extension); investigator: {investigator ?? "unavailable"}.</p>

        <h3>Audit evidence package</h3>
        <EvidenceExport investigationId={v.id} />

        <h3>Event</h3>
        <p>Delivered {v.event.deliveryCount} time{v.event.deliveryCount === 1 ? "" : "s"}; duplicates return this investigation and never re-run it.</p>
        <Json value={v.event} />

        <h3>Policy checks</h3>
        <div className="table-wrap">
          <table>
            <thead><tr><th scope="col">Check</th><th scope="col">Result</th><th scope="col">Observed</th><th scope="col">Required</th></tr></thead>
            <tbody>
              {v.policyChecks.map((c) => (
                <tr key={c.id} className={`r-${c.outcome.toLowerCase()}`}>
                  <td>{c.label}</td>
                  <td><span className={`res res-${c.outcome.toLowerCase()}`}>{c.outcome === "PASS" ? "pass" : c.outcome === "FAIL" ? "fail" : "not run"}</span>{c.failureCode ? ` ${c.failureCode}` : ""}</td>
                  <td>{c.observed ?? ""}</td>
                  <td>{c.required ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {v.result.executionChecks && (
          <>
            <h3>Execution checks (at approval time)</h3>
            <ul className="plain">{v.result.executionChecks.map((c) => <li key={c.id}><span className={`res res-${c.ok ? "pass" : "fail"}`}>{c.ok ? "pass" : "fail"}</span> {c.id}: {c.detail}</li>)}</ul>
          </>
        )}

        <h3>Contribution formula</h3>
        {v.contribution && v.contribution.ok ? <pre className="json">{v.contribution.formula.join("\n")}{"\n\n"}{v.contribution.exclusions}</pre> : <p className="muted">Not calculated.</p>}

        <h3>Investigator output</h3>
        <p className="muted">{v.agent.provider ?? "none"}. Validation: schema {v.agent.validation?.schemaValid ? "valid" : "invalid"}, citations {v.agent.validation?.citationsResolve ? "resolve" : "do not resolve"}. {v.agent.validation?.problems.join("; ")}</p>
        {v.agent.trace && v.agent.trace.length > 0 && (
          <ol className="trace">{v.agent.trace.map((s) => <li key={s.step}><code>{s.tool}</code> → {s.ok ? "" : "error, "}evidence <code>{s.evidenceRef}</code></li>)}</ol>
        )}
        <Json value={v.agent.raw ?? v.agent.error} />

        <h3>Evidence reads ({v.evidence.length})</h3>
        {v.evidence.length === 0 && <p className="muted">No evidence was read for this alert.</p>}
        {v.evidence.map((e) => (
          <details key={e.evidenceId} id={`ev-${e.evidenceId}`} className="ev">
            <summary><code>{e.evidenceId}</code> {e.kind.toLowerCase().replace(/_/g, " ")} via {e.tool}</summary>
            <Json value={e.payload} />
          </details>
        ))}

        <h3>Approval</h3>
        {v.approvals.length ? <Json value={v.approvals} /> : <p className="muted">None. No change can be sent without one.</p>}

        <h3>Write request and response</h3>
        {d ? (
          <>
            <p>Pre-write re-read: {d.preWrite.ok ? "passed" : `stopped: ${d.preWrite.reason}`}. Attempt status: {d.mutationStatus ?? "not sent"}.</p>
            <Json value={{ request: d.writeRequest, outcome: d.writeOutcome, attempts: v.mutations.map((m) => ({ attempt: m.attempt, requestId: m.requestId, status: m.status, errorCode: m.errorCode })) }} />
            <h3>Readback</h3>
            <Json value={[...d.readbacks, ...(v.result.extraReadbacks ?? [])]} />
            {v.result.digests && <><h3>Unrelated-state check (simulator probe)</h3><Json value={{ otherMutations: v.result.otherMutations, digests: v.result.digests, targetLedger: v.result.targetLedger }} /></>}
          </>
        ) : <p className="muted">No write attempted.</p>}

        <h3>Audit timeline</h3>
        <ol className="audit">
          {v.audit.map((e) => (
            <li key={e.seq}>
              <span className="audit-t">{clock(e.atSim)}</span> <strong>{e.type.replace(/_/g, " ").toLowerCase()}</strong> by {e.actor}
              <details><summary>payload</summary><Json value={e.payload} /></details>
            </li>
          ))}
        </ol>
        {lastAudit && <p className="muted">Latest entry hash for this alert <code className="hash">{lastAudit.hash}</code>. The log is append-only and hash-chained.</p>}
        <AuditVerify />
      </div>
    </details>
  );
});
