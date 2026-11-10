import type { InvestigationStatus } from "../../../../packages/contracts/src/index";
import { lifecycle } from "../state/lifecycle";

const STATE_TEXT = { done: "done", current: "current step", upcoming: "not yet", "not-reached": "not reached" } as const;

export function Stepper({ status, hadApproval }: { status: string; hadApproval: boolean }) {
  const lc = lifecycle(status as InvestigationStatus, { hadApproval });
  return (
    <div className="stepper-wrap">
      <ol className="stepper" aria-label="Progress of this alert">
        {lc.steps.map((s) => (
          <li key={s.label} className={`step step-${s.state}`} aria-current={s.state === "current" ? "step" : undefined}>
            <span className="step-dot" aria-hidden="true" />
            <span className="step-label">{s.label}</span>
            <span className="sr-only"> ({STATE_TEXT[s.state]})</span>
          </li>
        ))}
      </ol>
      {lc.ending && <p className={`step-ending ending-${lc.ending.kind}`}>{lc.ending.text}</p>}
    </div>
  );
}
