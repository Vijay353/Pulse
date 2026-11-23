import { explainVerdict } from "../../../../packages/contracts/src/explain";
import type { InvestigationView } from "../api/client";

/**
 * CH-8: "Why am I seeing this?" Every sentence comes from checks the system
 * executed (see packages/contracts/src/explain.ts). When the needed check is
 * missing the component says so and points to the details instead of guessing.
 */
export function VerdictExplainer({ v, onShowEvidence }: { v: InvestigationView; onShowEvidence?: (evidenceId: string) => void }) {
  const e = explainVerdict(v);
  return (
    <div className="why" data-source={e.source}>
      <p className="why-headline">{e.headline}</p>
      {e.detail && <p className="why-detail">{e.detail}</p>}
      {e.evidenceIds.length > 0 && (
        <p className="why-refs">
          <span className="muted">Based on records </span>
          {e.evidenceIds.map((id) => (
            onShowEvidence
              ? <button key={id} type="button" className="ref-chip" onClick={() => onShowEvidence(id)} aria-label={`Show evidence record ${id}`}><code>{id}</code></button>
              : <code key={id} className="ref-chip">{id}</code>
          ))}
        </p>
      )}
    </div>
  );
}
