import { useEffect, useState } from "react";
import { api, ApiError, FleetStore } from "../api/client";
import { copyFor, shortClock, statusWord } from "../state/format";

/**
 * CH-18: shown only to identities assigned to more than one store. Store
 * switching works on every plan (it only changes which store you look at);
 * the fleet summary is a Group-plan surface and the server enforces that.
 * Read-only: every action still happens on one store's own page.
 */
export function FleetBar({ stores, current, onChoose }: { stores: string[]; current: string; onChoose: (store: string) => void }) {
  const [fleet, setFleet] = useState<FleetStore[] | null>(null);
  const [gate, setGate] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    api.get<{ stores: FleetStore[] }>("/api/fleet")
      .then((r) => { if (live) { setFleet(r.stores); setGate(null); } })
      .catch((e) => { if (live) { setFleet(null); setGate(e instanceof ApiError && e.code === "PLAN_REQUIRED" ? e.message : null); } });
    return () => { live = false; };
  }, [current]);

  return (
    <section className="fleet" aria-labelledby="fleet-h">
      <div className="fleet-head">
        <h2 id="fleet-h">Your stores</h2>
        {!fleet && (
          <label className="fleet-pick">
            <span>Store</span>
            <select value={current} onChange={(e) => onChoose(e.target.value)}>
              {stores.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        )}
      </div>
      {gate && <p className="muted">{gate}</p>}
      {fleet && (
        <ul className="fleet-list">
          {fleet.map((s) => (
            <li key={s.storeId} className={s.storeId === current ? "fleet-card on" : "fleet-card"}>
              <p className="fleet-name">{s.name ?? s.storeId}</p>
              <p>{s.lastInvestigation ? `Last alert ${shortClock(s.lastInvestigation.createdAt)}: ${copyFor(s.lastInvestigation.decisionCode).title}` : "No alerts yet"}</p>
              <p className={s.needsAttention ? "fleet-attn" : "muted"}>{s.needsAttention ? `${s.needsAttention} waiting for a manager` : "Nothing waiting"}</p>
              {s.campaign && <p className="muted">Campaign {s.campaign.campaignId}: {statusWord(s.campaign.configuredStatus).toLowerCase()}, {statusWord(s.campaign.serving).toLowerCase()}</p>}
              {s.storeId === current
                ? <p className="fleet-here">Showing this store</p>
                : <button type="button" className="btn quiet" onClick={() => onChoose(s.storeId)}>Open {s.name ?? s.storeId}</button>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
