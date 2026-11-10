import { useEffect, useRef, useState } from "react";
import type { InvestigationView } from "../api/client";
import { projectPause } from "../state/projection";

/** Native <dialog>: focus is trapped, Escape cancels, focus returns to the opener. */
function useDialog(open: boolean) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return ref;
}

export function ConfirmPauseDialog({ open, v, busy, onConfirm, onCancel }: { open: boolean; v: InvestigationView; busy: boolean; onConfirm: (acknowledged: string[]) => void; onCancel: () => void }) {
  const ref = useDialog(open);
  const warning = v.warnings[0];
  const [checked, setChecked] = useState(false);
  useEffect(() => { if (!open) setChecked(false); }, [open]);
  const blocked = !!warning && !checked;
  const projection = projectPause(v);
  return (
    <dialog ref={ref} className="dialog" aria-labelledby="confirm-h" aria-describedby="confirm-d" onCancel={(e) => { e.preventDefault(); onCancel(); }}>
      <h2 id="confirm-h">Pause {v.campaign?.name ? <bdi>{v.campaign.name}</bdi> : "this campaign"}?</h2>
      <p id="confirm-d">Ads stop serving after Uber applies the status. The campaign will remain paused until someone resumes it.</p>
      <p className="muted">Campaign {v.campaign?.campaignId}, version {v.campaign?.version}. Your approval covers only this campaign, this store and policy {String(v.policy?.version ?? "")}.</p>
      {projection.available && (
        <div className="projection">
          <table>
            <caption>If you approve</caption>
            <thead><tr><th scope="col">What</th><th scope="col">Now</th><th scope="col">After approval</th></tr></thead>
            <tbody>{projection.rows.map((r) => <tr key={r.label}><th scope="row">{r.label}</th><td>{r.now || "n/a"}</td><td>{r.ifApproved}</td></tr>)}</tbody>
          </table>
          <p className="muted small">{projection.note}</p>
        </div>
      )}
      {warning && (
        <label className="ack">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          <span>I checked investigation {warning.priorInvestigationId}. This alert is not just a repeat of it.</span>
        </label>
      )}
      <div className="btn-row">
        <button className="btn primary" onClick={() => onConfirm(warning ? [warning.code] : [])} disabled={busy || blocked} autoFocus={!warning}>{busy ? "Pausing…" : "Pause campaign"}</button>
        <button className="btn quiet" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </dialog>
  );
}

const REASONS = ["Rush is clearing", "We want the extra orders tonight", "Campaign is managed elsewhere", "Data looks wrong"];

export function DismissDialog({ open, busy, onConfirm, onCancel }: { open: boolean; busy: boolean; onConfirm: (reason: string) => void; onCancel: () => void }) {
  const ref = useDialog(open);
  const [reason, setReason] = useState(REASONS[0]!);
  const [other, setOther] = useState("");
  const final = reason === "Other" ? other.trim() : reason;
  return (
    <dialog ref={ref} className="dialog" aria-labelledby="dismiss-h" onCancel={(e) => { e.preventDefault(); onCancel(); }}>
      <h2 id="dismiss-h">Keep the campaign active?</h2>
      <p>Nothing will change in Uber Ads. Pick a reason for the record.</p>
      <fieldset className="reasons">
        <legend className="sr-only">Reason</legend>
        {[...REASONS, "Other"].map((r) => (
          <label key={r}><input type="radio" name="reason" value={r} checked={reason === r} onChange={() => setReason(r)} /> {r}</label>
        ))}
        {reason === "Other" && <input className="text" aria-label="Other reason" maxLength={200} value={other} onChange={(e) => setOther(e.target.value)} />}
      </fieldset>
      <div className="btn-row">
        <button className="btn primary" onClick={() => onConfirm(final)} disabled={busy || !final}>Keep active</button>
        <button className="btn quiet" onClick={onCancel} disabled={busy}>Back</button>
      </div>
    </dialog>
  );
}
