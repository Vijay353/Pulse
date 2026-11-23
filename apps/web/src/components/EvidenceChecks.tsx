import type { EvidenceCheck, EvidenceMatrix } from "../../../../packages/contracts/src/index";

const WORD: Record<EvidenceCheck["status"], string> = { PASS: "Passed", FAIL: "Blocked here", WARN: "Warning", NOT_EVALUATED: "Not evaluated" };

/** Summary line used in the disclosure label. Counts come from the server. */
export function checksSummary(m: EvidenceMatrix) {
  const s = m.summary;
  return `Evidence checks: ${s.passed} passed, ${s.warned} warned, ${s.failed} blocked, ${s.notEvaluated} not evaluated`;
}

/** Read-only matrix of checks that actually ran (V3 CH-19). It cannot release a write; the server decides. */
export function EvidenceChecks({ matrix, defaultOpen = false }: { matrix: EvidenceMatrix; defaultOpen?: boolean }) {
  return (
    <details className="evidence-checks" open={defaultOpen || undefined}>
      <summary>{checksSummary(matrix)}</summary>
      <p className="muted small">Each row is a rule the system ran, with the records it used. "Not evaluated" means the check has not run, not that it passed.</p>
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Table, scrolls sideways if needed">
        <table>
          <thead><tr><th scope="col">Check</th><th scope="col">Result</th><th scope="col">Evidence used</th><th scope="col">Detail</th></tr></thead>
          <tbody>
            {matrix.checks.map((c) => (
              <tr key={c.checkId} className={`ec-${c.status.toLowerCase()}`}>
                <th scope="row">{c.label}</th>
                <td><span className={`ec-word ec-word-${c.status.toLowerCase()}`}>{WORD[c.status]}</span></td>
                <td>{c.evidenceRefs.length ? c.evidenceRefs.map((r) => <code key={r} className="ec-ref">{r}</code>) : <span className="muted">none</span>}</td>
                <td>{c.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
