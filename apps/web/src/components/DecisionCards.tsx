import type { InvestigationView } from "../api/client";
import { CompareBar } from "./CompareBar";
import { SourceBadge } from "./SourceBadge";
import { adsBadge, isSimulatedProvider, posBadge } from "../state/badges";
import { age, clock, pct, provenanceLine, shortClock, statusWord, usd } from "../state/format";

/** The memorable element: a ticket-time rail showing P95 against the merchant's limit. */
function Rail({ p95, limit, alertLine }: { p95: number; limit: number; alertLine: number | null }) {
  const max = Math.max(45, Math.ceil((Math.max(p95, limit) + 6) / 5) * 5);
  const at = (m: number) => `${(Math.min(m, max) / max) * 100}%`;
  const over = p95 >= limit;
  return (
    <div className="rail" role="img" aria-label={`P95 preparation time ${p95} minutes; merchant limit ${limit} minutes${over ? "; over the limit" : "; under the limit"}`}>
      <div className="rail-track">
        <div className="rail-fill" style={{ width: at(Math.min(p95, limit)) }} />
        {over && <div className="rail-over" style={{ left: at(limit), width: `calc(${at(p95)} - ${at(limit)})` }} />}
        <div className="rail-limit" style={{ left: at(limit) }}><span>limit {limit}</span></div>
        {alertLine !== null && alertLine !== limit && <div className="rail-alert" style={{ left: at(alertLine) }} title={`POS alert line ${alertLine} min`} />}
        <div className={over ? "rail-now over" : "rail-now"} style={{ left: at(p95) }} />
      </div>
      <div className="rail-scale" aria-hidden="true"><span>0</span><span>{max} min</span></div>
    </div>
  );
}

export function KitchenCard({ v }: { v: InvestigationView }) {
  const k = v.kitchen;
  return (
    <section className="card" aria-labelledby="c1">
      <h2 id="c1" className="card-q">What changed</h2>
      {!k ? <p className="muted">The kitchen snapshot couldn’t be read from the POS.</p> : (
        <>
          <p className="card-source">Mock POS / KDS, snapshot {k.snapshotId}, data age {age(v.kitchenAgeAtDecision ?? k.ageSeconds)} at decision</p>
          <p className="kds-number">
            <span className={k.thresholdMinutes !== null && k.p95PrepMinutes >= k.thresholdMinutes ? "big over" : "big"}>{k.p95PrepMinutes}</span>
            <span className="unit">min P95 prep time</span>
          </p>
          {k.thresholdMinutes !== null && <Rail p95={k.p95PrepMinutes} limit={k.thresholdMinutes} alertLine={k.posAlertThresholdMinutes} />}
          <dl className="facts">
            <div><dt>Your limit</dt><dd>{k.thresholdMinutes === null ? "n/a" : `${k.thresholdMinutes} min`}</dd></div>
            <div><dt>Active tickets</dt><dd>{k.activeTickets}</dd></div>
            <div><dt>Connector</dt><dd><SourceBadge badge={posBadge(k.connectorHealth, isSimulatedProvider(v.posProvider))} /></dd></div>
            <div><dt>Captured</dt><dd>{clock(k.capturedAt)}</dd></div>
          </dl>
        </>
      )}
    </section>
  );
}

export function CampaignCard({ v }: { v: InvestigationView }) {
  const c = v.campaign;
  const live = v.liveCampaign;
  const ctr = v.contribution;
  return (
    <section className="card" aria-labelledby="c2">
      <h2 id="c2" className="card-q">What the campaign costs</h2>
      {!c ? (
        <>
          <p className="muted">{v.campaignsSeen.filter((x) => x.eligible).length > 1 ? "More than one active Sponsored Listings campaign targets this store:" : "No single eligible campaign was found."}</p>
          {v.campaignsSeen.length > 0 && <ul className="plain">{v.campaignsSeen.map((x) => <li key={x.campaignId}><bdi>{x.name}</bdi> ({x.campaignId}, {statusWord(x.configuredStatus).toLowerCase()})</li>)}</ul>}
        </>
      ) : (
        <>
          <p className="card-source">{isSimulatedProvider(v.adsProvider) ? "Mock Uber Ads Sponsored Listing" : "Sponsored Listing"}, report through {v.report ? shortClock(v.report.watermark) : "n/a (no report)"}{v.report?.ageSecondsAtDecision != null ? ` (${age(v.report.ageSecondsAtDecision)} old)` : ""}</p>
          <p className="camp-name"><bdi>{c.name}</bdi></p>
          <p className="camp-state">
            <SourceBadge badge={adsBadge(live, v.liveCampaignError, isSimulatedProvider(v.adsProvider))} />
            <span className="muted"> v{live?.version ?? c.version}</span>
          </p>
          {ctr && ctr.ok ? (
            <>
            <CompareBar value={ctr.perOrder.contributionCents} baseline={ctr.floorCentsPerOrder} valueLabel="Estimated per order" baselineLabel="Your floor" />
            <dl className="facts">
              <div><dt>Estimated contribution per attributed order</dt><dd className={ctr.belowFloor ? "bad" : "good"}>{usd(ctr.perOrder.contributionCents)} <span className="muted">({pct(ctr.rateBps)})</span></dd></div>
              <div><dt>Your floor</dt><dd>{usd(ctr.floorCentsPerOrder)} <span className="muted">({pct(ctr.minRateBps)})</span></dd></div>
              <div><dt>Daily budget</dt><dd>{usd(c.dailyBudgetCents)}</dd></div>
              <div><dt>Update permission</dt><dd className={c.permissions.includes("UPDATE") ? "good" : "bad"}>{c.permissions.includes("UPDATE") ? "allowed" : "read only"}</dd></div>
            </dl>
            </>
          ) : ctr && !ctr.ok ? (
            <p className="muted">Contribution not calculated. Missing: {ctr.missing.join(", ")}.</p>
          ) : <p className="muted">Contribution not calculated.</p>}
          <p className="note">{v.exclusionNote}</p>
        </>
      )}
    </section>
  );
}

interface ActionProps {
  v: InvestigationView;
  busy: string | null;
  /** Viewer may approve here (CH-13). UI hint only; the server decides. */
  canApprove?: boolean;
  onPause: () => void;
  onKeep: () => void;
  onRetry: () => void;
  onCheck: () => void;
  onReassess: () => void;
  onOpenChild: (id: string) => void;
}

export function ActionCard({ v, busy, canApprove = true, onPause, onKeep, onRetry, onCheck, onReassess, onOpenChild }: ActionProps) {
  const a = v.actions;
  const c = v.campaign;
  return (
    <section className="card card-action" aria-labelledby="c3">
      <h2 id="c3" className="card-q">What you can do</h2>
      {a.canApprove || a.canPause ? (
        <div className="decide">
          <div className="decide-main">
            <p className="action-title">Pause one campaign</p>
            <p className="muted">{c?.name ? <bdi>{c.name}</bdi> : null} {c?.campaignId}</p>
            <div className="btn-row">
              <button className="btn primary big" onClick={onPause} disabled={!!busy || !canApprove}>Pause campaign</button>
              <button className="btn quiet big" onClick={onKeep} disabled={!!busy}>Keep active</button>
            </div>
            <p className="authority"><strong>Who decides:</strong> {v.eligibleApprovers.length ? v.eligibleApprovers.map((e) => e.displayName).join(", ") : "a manager assigned to this store"}. MarginPulse never pauses on its own.</p>
          </div>
          <div className="decide-scope">
            <p className="scope-h">What a pause does</p>
            <ul className="scope">
              <li>Stops this campaign from serving</li>
              <li>Does not change its budget</li>
              <li>No promotion, menu, store, order or prep-time change</li>
            </ul>
            <p className="persist">Stays paused until someone resumes it</p>
          </div>
        </div>
      ) : v.status === "PAUSE_VERIFIED" ? (
        <>
          <p className="action-title">Done</p>
          <p className="muted">The campaign stays paused until someone resumes it in Uber Ads. MarginPulse does not resume campaigns.</p>
        </>
      ) : a.canCheckAgain || a.canRetry ? (
        <>
          <p className="action-title">{a.canRetry ? "The pause did not go through" : "Waiting for Uber Ads to confirm"}</p>
          <p className="muted">{a.canRetry ? "A readback shows the campaign is still active and unchanged. You can send the pause again with the same approval." : "Check again to read the campaign’s status. MarginPulse never resends a change it can’t confirm."}</p>
          <div className="btn-row">
            {a.canRetry && <button className="btn primary" onClick={onRetry} disabled={!!busy || !canApprove}>{busy === "retry" ? "Retrying…" : "Retry pause"}</button>}
            {a.canCheckAgain && <button className="btn quiet" onClick={onCheck} disabled={!!busy}>{busy === "verify" ? "Checking…" : "Check again"}</button>}
          </div>
        </>
      ) : (
        <>
          <p className="action-title">{v.status === "DISMISSED" ? "Campaign kept active" : "Nothing to approve"}</p>
          <p className="muted">{v.status === "DISMISSED" ? "No change was sent." : "MarginPulse only offers a pause when every check passes."}</p>
          {a.canReassess && v.childIds.length === 0 && <div className="btn-row"><button className="btn quiet" onClick={onReassess} disabled={!!busy}>{busy === "reassess" ? "Re-assessing…" : "Re-assess with fresh data"}</button></div>}
          {v.childIds.map((id) => <p key={id}><button className="linkish" onClick={() => onOpenChild(id)}>Open re-assessment {id}</button></p>)}
        </>
      )}
      <p className="card-source policy-provenance">{provenanceLine(v.policyProvenance)}</p>
    </section>
  );
}
