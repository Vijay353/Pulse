import { useEffect, useState } from "react";
import { api, Digest, InvestigationView } from "../api/client";
import { clock, copyFor, count, duration } from "../state/format";

/**
 * CH-9: "What happened on your shift". Shown once an alert is settled
 * (paused and verified, or kept active). Every figure is read from persisted
 * rows; there are no money-saved, orders-rescued or return figures, because
 * MarginPulse has no evidence for them.
 */
export function ShiftDigest({ v, store }: { v: InvestigationView; store: string }) {
  const [d, setD] = useState<Digest | null>(null);
  useEffect(() => {
    let live = true;
    api.get<Digest>(`/api/digest?store=${encodeURIComponent(store)}`).then((x) => { if (live) setD(x); }).catch(() => { if (live) setD(null); });
    return () => { live = false; };
  }, [store, v.id, v.status]);

  const action = v.status === "PAUSE_VERIFIED"
    ? `Paused ${v.campaign?.name ?? "one campaign"} with ${v.approvals[v.approvals.length - 1]?.approvedBy ?? "a manager"}'s approval`
    : "Kept the campaign active; nothing was changed";
  return (
    <section className="digest" aria-labelledby="digest-h">
      <h2 id="digest-h">What happened on your shift</h2>
      <dl className="digest-grid">
        <div><dt>Alert</dt><dd>{clock(v.createdAt)} ET, {v.store?.name ?? "this store"}</dd></div>
        <div><dt>Decision</dt><dd>{copyFor(v.decisionCode).title}</dd></div>
        <div><dt>Action taken</dt><dd>{action}</dd></div>
        <div><dt>Final state</dt><dd>{v.status === "PAUSE_VERIFIED" ? `Checked by readback${v.result.verifiedAt ? ` at ${clock(v.result.verifiedAt)}` : ""}` : "No change sent"}</dd></div>
      </dl>
      {d && (
        <p className="digest-totals">
          <strong>This store, since the demo scenario was loaded:</strong>{" "}
          {count(d.investigated, "alert")} checked, {count(d.pausesVerified, "pause")} verified, {d.keptActive} kept active,{" "}
          {d.noAction} needed no action, {d.needsReview + d.blocked} stopped for review or by a check.{" "}
          {count(d.patchRequestsSent, "change request")} sent to the ad platform.
          {d.meanSecondsToDecision !== null && <> Average time to a manager decision: {duration(d.meanSecondsToDecision)} (simulated clock).</>}
        </p>
      )}
      <p className="muted small">Counts only. MarginPulse does not estimate money saved or orders gained.</p>
    </section>
  );
}
