import { useState } from "react";
import { onboardingDisabledByUrl, readPref, writePref } from "../state/prefs";

/**
 * CH-12: first-run explanation, shown inside the empty state (never a blocking
 * overlay). Dismissed once per browser; `?onboarding=0` hides it.
 */
export function Welcome() {
  const [hidden, setHidden] = useState(() => onboardingDisabledByUrl() || readPref("welcomeDismissed"));
  if (hidden) return null;
  const close = () => { writePref("welcomeDismissed", true); setHidden(true); };
  return (
    <section className="welcome" aria-labelledby="welcome-h">
      <h2 id="welcome-h">How MarginPulse works</h2>
      <ol className="welcome-steps">
        <li><strong>It watches your kitchen.</strong> When prep times pass your limit, your POS sends an alert.</li>
        <li><strong>It asks before acting.</strong> If a paid ad campaign is adding orders that earn too little, a manager decides whether to pause that one campaign.</li>
        <li><strong>It shows proof.</strong> After a pause, it reads the campaign back and keeps a tamper-evident record.</li>
      </ol>
      <button type="button" className="btn quiet" onClick={close}>Got it</button>
    </section>
  );
}
