import { useState } from "react";
import { api, ApiError } from "../api/client";
import { clock, statusWord } from "../state/format";

export interface SimState {
  clock: string;
  scenario: string;
  adsFaults: { op: string; mode: string; remaining: number; param: string | null }[];
  posFaults: { mode: string; remaining: number }[];
  campaigns: { campaignId: string; accountId: string; name: string; configuredStatus: string; effectiveStatusRaw: string; version: number; permissions: string[] }[];
  outbox: { event_id: string; delivery_count: number; last_status: number }[];
  ledger: Record<string, unknown>[];
  requests: { method: string; path: string; status: number | null; fault: string | null; at: string }[];
  patchCount: number | null;
  simulator?: "AVAILABLE" | "NOT_CONFIGURED";
  simulatorProblem?: string | null;
  rejectedEvents: { received_at: string; reason: string }[];
  latestInvestigation: string | null;
}

const FAULTS = [
  ["HTTP_429", "Next PATCH is rate-limited (429)"],
  ["DROP_AFTER_APPLY", "Next PATCH applies, then the connection drops"],
  ["DROP_BEFORE_APPLY", "Next PATCH drops before it is applied"],
  ["HTTP_500_AFTER_APPLY", "Next PATCH applies, then returns 500"],
  ["DELAYED_EFFECTIVE", "Effective status lags 6 s after the next PATCH"],
  ["HTTP_401", "Next PATCH is rejected (401)"],
] as const;

interface Props {
  sim: SimState | null;
  invId: string | null;
  eventId: string | null;
  storeId: string;
  onChanged: (message?: string) => Promise<SimState>;
  onOpenInvestigation: (id: string) => void;
}

/** Demo-only controls for the stateful simulators. Each button calls a real simulator endpoint. */
export function SimulatorPanel({ sim, eventId, storeId, onChanged, onOpenInvestigation }: Props) {
  const [fault, setFault] = useState<string>(FAULTS[0][0]);
  const [err, setErr] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setErr(null);
    try { await fn(); await onChanged(msg); } catch (e) { setErr(e instanceof ApiError ? e.message : (e as Error).message); }
  };
  return (
    <details className="simulator">
      <summary>Simulator controls <span className="muted">mock POS, mock Uber Ads, clock and faults</span></summary>
      <div className="sim-body">
        <div className="sim-group">
          <h3>World</h3>
          <p>Simulated time {clock(sim?.clock)}. It only moves when you advance it.</p>
          <div className="btn-row">
            <button className="btn quiet" onClick={() => run(() => api.post("/api/sim/clock/advance", { seconds: 60 }), "Clock advanced 1 minute")}>Advance 1 min</button>
            <button className="btn quiet" onClick={() => run(() => api.post("/api/sim/clock/advance", { seconds: 300 }), "Clock advanced 5 minutes")}>Advance 5 min</button>
            <button className="btn quiet" onClick={() => run(() => api.post("/api/sim/policy/bump", { storeId }), "Merchant policy republished")}>Merchant edits the policy</button>
          </div>
        </div>
        <div className="sim-group">
          <h3>Mock POS</h3>
          <div className="btn-row">
            <button className="btn quiet" disabled={!eventId} onClick={() => run(async () => {
              const r = await api.post<{ delivery: { body: { investigationId?: string } } }>(`/mock-pos/events/${eventId}/redeliver`);
              if (r.delivery.body?.investigationId) onOpenInvestigation(r.delivery.body.investigationId);
            }, "Same event redelivered")}>Redeliver same event</button>
            <button className="btn quiet" onClick={() => run(() => api.post("/mock-pos/events/forged", { storeId }), "Forged webhook sent")}>Send forged webhook</button>
            <button className="btn quiet" onClick={() => run(() => api.post("/mock-pos/faults", { mode: "POS_UNAVAILABLE", remaining: 5 }), "POS outage armed")}>Take POS offline (next 5 reads)</button>
          </div>
          {sim && sim.outbox.length > 0 && <p className="muted">Outbox: {sim.outbox.map((o) => `${o.event_id} ×${o.delivery_count} (HTTP ${o.last_status})`).join("; ")}</p>}
          {sim && sim.rejectedEvents.length > 0 && <p className="muted">Rejected: {sim.rejectedEvents.map((r) => r.reason).join("; ")}</p>}
        </div>
        <div className="sim-group">
          <h3>Mock Uber Ads</h3>
          <div className="btn-row">
            <button className="btn quiet" onClick={() => run(() => api.post("/mock-ads/simulate/external-edit", { campaign_id: "cmp-syn-4081" }), "Another manager edited the campaign")}>Another manager edits the campaign</button>
          </div>
          <div className="fault-row">
            <label htmlFor="fault">Arm a fault</label>
            <select id="fault" value={fault} onChange={(e) => setFault(e.target.value)}>
              {FAULTS.map(([m, l]) => <option key={m} value={m}>{l}</option>)}
            </select>
            <button className="btn quiet" onClick={() => run(() => api.post("/mock-ads/faults", { op: "PATCH_CAMPAIGNS", mode: fault, remaining: 1, param: fault === "DELAYED_EFFECTIVE" ? "6000" : undefined }), "Fault armed")}>Arm</button>
            <button className="btn quiet" onClick={() => run(() => Promise.all([api.del("/mock-ads/faults"), api.del("/mock-pos/faults")]), "Faults cleared")}>Clear faults</button>
          </div>
          {sim && (sim.adsFaults.length + sim.posFaults.length > 0) && <p className="muted">Armed: {[...sim.adsFaults.map((f) => `${f.mode} on ${f.op} ×${f.remaining}`), ...sim.posFaults.map((f) => `${f.mode} ×${f.remaining}`)].join("; ")}</p>}
          {sim?.simulator === "NOT_CONFIGURED" && <p className="empty-state" role="status">Simulator controls are not available here: {sim.simulatorProblem}</p>}
          {sim && sim.campaigns.length === 0 && sim.simulator !== "NOT_CONFIGURED" && <p className="empty-state" role="status">Mock Uber Ads has no campaigns. Load a scenario or import a workbook in the data studio.</p>}
          {sim && sim.campaigns.length > 0 && (
            <div className="table-wrap">
              <table>
                <caption>Campaigns as Mock Uber Ads reports them now ({sim.patchCount === null ? "PATCH count not available" : `${sim.patchCount} PATCH request${sim.patchCount === 1 ? "" : "s"} received`})</caption>
                <thead><tr><th scope="col">Campaign</th><th scope="col">Configured</th><th scope="col">Effective</th><th scope="col">Version</th><th scope="col">Permissions</th></tr></thead>
                <tbody>{sim.campaigns.map((c) => <tr key={c.campaignId}><td><bdi>{c.name}</bdi><br /><span className="muted">{c.campaignId}</span></td><td>{statusWord(c.configuredStatus)}</td><td>{statusWord(c.effectiveStatusRaw)}</td><td>{c.version}</td><td>{c.permissions.join(", ")}</td></tr>)}</tbody>
              </table>
            </div>
          )}
          {sim && sim.requests.length > 0 && (
            <details>
              <summary>Request log ({sim.requests.length} latest)</summary>
              <ol className="plain small">{sim.requests.map((r, i) => <li key={i}><code>{r.method} {r.path}</code> → {r.status ?? "no response"}{r.fault ? ` (fault ${r.fault})` : ""}</li>)}</ol>
            </details>
          )}
        </div>
        {err && <p className="error-line" role="alert">{err}</p>}
      </div>
    </details>
  );
}
