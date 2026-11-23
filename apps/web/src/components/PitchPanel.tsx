import { useEffect, useState } from "react";
import { api, Digest, InvestigationView } from "../api/client";
import { explainVerdict } from "../../../../packages/contracts/src/explain";
import { PLAN_TABLE } from "../../../../packages/contracts/src/plans";
import { duration, rate } from "../state/format";

const STEPS = ["Problem", "Detection", "Decision", "Proof", "Business"] as const;
type Step = (typeof STEPS)[number];

/** Which chapter the live investigation is in. The presenter can always pick another. */
function liveStep(v: InvestigationView | null): Step {
  if (!v) return "Problem";
  if (["PAUSE_VERIFIED", "DISMISSED", "PAUSE_REQUESTED_NOT_VERIFIED"].includes(v.status)) return "Proof";
  if (["AWAITING_APPROVAL", "APPROVED"].includes(v.status)) return "Decision";
  return "Detection";
}

/**
 * CH-20: pitch mode (DEMO_MODE=pitch). Narrates the investigation the
 * presenter is driving live; nothing here is a canned screenshot. Every
 * number in the metrics strip comes from /api/metrics (persisted rows).
 */
export function PitchPanel({ v }: { v: InvestigationView | null }) {
  const auto = liveStep(v);
  const [picked, setPicked] = useState<Step | null>(null);
  const [m, setM] = useState<Digest | null>(null);
  useEffect(() => { setPicked(null); }, [auto]);
  useEffect(() => { api.get<Digest>("/api/metrics").then(setM).catch(() => setM(null)); }, [v?.id, v?.status]);
  const step = picked ?? auto;
  const why = v ? explainVerdict(v) : null;

  return (
    <section className="pitch" aria-labelledby="pitch-h">
      <h2 id="pitch-h" className="sr-only">Pitch story</h2>
      <div className="pitch-tabs" role="tablist" aria-label="Story">
        {STEPS.map((s, i) => (
          <button key={s} role="tab" type="button" aria-selected={s === step} className={s === step ? "pitch-tab on" : "pitch-tab"} onClick={() => setPicked(s)}>
            <span aria-hidden="true">{i + 1}</span> {s}{s === auto && <span className="sr-only"> (live)</span>}
          </button>
        ))}
      </div>
      <div className="pitch-body" role="tabpanel" aria-label={step}>
        {step === "Problem" && <p>During a kitchen rush, paid ads can keep sending orders the kitchen can't make on time, and some of those orders earn less than the restaurant's own floor. Today a manager has to notice that, find the campaign and act, mid-rush. {v ? "" : "Press Simulate kitchen alert to start."}</p>}
        {step === "Detection" && <p>{v?.kitchen ? `The POS reported a kitchen alert. MarginPulse re-read the kitchen itself: P95 prep time ${v.kitchen.p95PrepMinutes} min against a ${v.kitchen.thresholdMinutes ?? "n/a"} min limit, and ran ${v.policyChecks.length} ordered policy checks on signed, fresh data.` : "A signed kitchen alert arrives from the POS. MarginPulse re-reads the kitchen and the ad campaign itself instead of trusting the alert."}</p>}
        {step === "Decision" && <p>{why ? `${why.headline} ${why.detail ?? ""}` : "No decision yet."} One campaign, one action, and only with a named manager's approval.</p>}
        {step === "Proof" && <p>{v && why ? `${why.headline} ${why.detail ?? ""} Every step is in a hash-chained audit log and can be exported as an evidence package.` : "After a decision, MarginPulse reads the campaign back and keeps a tamper-evident record."}</p>}
        {step === "Business" && (
          <div className="pitch-plans">
            {PLAN_TABLE.map((p) => (
              <div key={p.plan} className="pitch-plan">
                <p className="pitch-plan-name">{p.name}</p>
                <p className="muted">{p.who} · {p.stores}</p>
                <ul>{p.includes.map((x) => <li key={x}>{x}</li>)}</ul>
              </div>
            ))}
            <p className="muted small pitch-foot">Pricing is set per pilot. Runs as one container with one data volume; see Deployment in the README.</p>
          </div>
        )}
      </div>
      {m && (
        <dl className="pitch-metrics" aria-label="Live counts from this demo database">
          <div><dt>Alerts checked</dt><dd>{m.investigated}</dd></div>
          <div><dt>Pauses verified</dt><dd>{m.pausesVerified}</dd></div>
          <div><dt>Verified after sending</dt><dd>{rate(m.verificationRateBps)}</dd></div>
          <div><dt>Ended with no change</dt><dd>{rate(m.nonActionRateBps)}</dd></div>
          <div><dt>Time to manager decision</dt><dd>{duration(m.meanSecondsToDecision)}</dd></div>
        </dl>
      )}
      <p className="muted small">Live counts from this demo database since the scenario was loaded. Not a forecast.</p>
    </section>
  );
}
