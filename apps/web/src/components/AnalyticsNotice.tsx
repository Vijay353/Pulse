import { useState } from "react";
import type { Analytics } from "../analytics/clarity";

/** V3 CH-21: consent notice and footer control. Renders nothing when analytics is not available. */
export function AnalyticsNotice({ analytics }: { analytics: Analytics }) {
  const [consent, setConsent] = useState(analytics.consent());
  if (!analytics.available) return null;
  const allow = () => { analytics.grant(); setConsent("granted"); };
  const decline = () => { analytics.deny(); setConsent("denied"); };
  if (consent === null) {
    return (
      <section className="analytics-notice" aria-label="Analytics choice">
        <p>
          May this demo record anonymous usage with Microsoft Clarity to improve the design? Everything inside the app is masked in
          recordings, and nothing is sent until you choose.
        </p>
        <div className="btn-row">
          <button className="btn quiet small" onClick={allow}>Allow</button>
          <button className="btn quiet small" onClick={decline}>No thanks</button>
        </div>
      </section>
    );
  }
  return (
    <p className="analytics-state">
      Usage analytics: {consent === "granted" ? "on" : "off"}.{" "}
      <button className="linkish" onClick={consent === "granted" ? decline : allow}>{consent === "granted" ? "Turn off" : "Turn on"}</button>
    </p>
  );
}
