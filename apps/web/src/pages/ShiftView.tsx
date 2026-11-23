import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, InvestigationView, ScenarioInfo } from "../api/client";
import { clock, copyFor, historyLine, shortClock } from "../state/format";
import { KitchenCard, CampaignCard, ActionCard } from "../components/DecisionCards";
import { OutcomePanel } from "../components/OutcomePanel";
import { Inspector } from "../components/Inspector";
import { SimulatorPanel, SimState } from "../components/SimulatorPanel";
import { ConfirmPauseDialog, DismissDialog } from "../components/Dialogs";
import { Stepper } from "../components/Stepper";
import { EvidenceChecks } from "../components/EvidenceChecks";
import { useAnalytics } from "../analytics/context";
import { VerdictExplainer } from "../components/VerdictExplainer";
import { Welcome } from "../components/Welcome";
import { ShiftDigest } from "../components/ShiftDigest";
import { FleetBar } from "../components/FleetBar";
import { PitchPanel } from "../components/PitchPanel";
import { readPref, writePref } from "../state/prefs";

interface Props { user: string; store?: string; myStores?: string[]; onChooseStore?: (store: string) => void; onScenarioLoaded?: () => void; pitch?: boolean; focusId?: string | null; onSwitchUser?: (userId: string, keepInvestigation: string | null) => void; adsProvider: string; investigator: string | null }

/** Demo default store. CH-18 lets `?store=` choose another; the server enforces store scope either way. */
export const DEFAULT_STORE = "SYN-STORE-104";

export function ShiftView({ adsProvider, investigator, focusId = null, onSwitchUser, store = DEFAULT_STORE, myStores = [], onChooseStore, onScenarioLoaded, pitch = false }: Props) {
  const [demoTools, setDemoTools] = useState(() => readPref("demoTools"));
  const [scenarios, setScenarios] = useState<ScenarioInfo[]>([]);
  const [scenarioId, setScenarioId] = useState("A");
  const [loadedScenario, setLoadedScenario] = useState<string | null>(null);
  const [view, setView] = useState<InvestigationView | null>(null);
  const [sim, setSim] = useState<SimState | null>(null);
  const [busy, setBusy] = useState<string | null>("init");
  const currentId = useRef<string | null>(null);
  const [announce, setAnnounce] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dismissOpen, setDismissOpen] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  /** Set when a new alert arrives; consumed after the heading has rendered. */
  const focusHeading = useRef(false);
  useEffect(() => {
    if (!view || !focusHeading.current || !headingRef.current) return;
    focusHeading.current = false;
    // CH-7: bring the new alert to the top so the decision and its one action are in view without scrolling.
    headingRef.current.focus({ preventScroll: true });
    headingRef.current.scrollIntoView({ block: "start" });
  }, [view]);

  const refreshSim = useCallback(async () => {
    const s = await api.get<SimState>("/api/sim/state");
    setSim(s);
    return s;
  }, []);

  const loadView = useCallback(async (id: string) => {
    const v = await api.get<InvestigationView>(`/api/investigations/${id}`);
    setView(v);
    currentId.current = id;
    return v;
  }, []);

  useEffect(() => {
    (async () => {
      const sc = await api.get<{ scenarios: ScenarioInfo[]; current: string }>("/api/scenarios");
      setScenarios(sc.scenarios);
      setScenarioId(sc.current ?? "A");
      setLoadedScenario(sc.current ?? "A");
      await refreshSim();
      // CH-18: open this store's latest alert (the simulator's "latest" is global across stores).
      const list = await api.get<{ investigations: { id: string; pos_store_id: string }[] }>("/api/investigations");
      const target = focusId ?? list.investigations.find((i) => i.pos_store_id === store)?.id ?? null;
      if (target) await loadView(target);
    })().catch((e: Error) => setError(e.message)).finally(() => setBusy(null));
  }, [refreshSim, loadView, focusId, store]);

  /** Run an action, then re-read everything from the server. */
  const act = async (label: string, fn: () => Promise<void>, done?: (v: InvestigationView | null) => string) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
      const v = currentId.current ? await loadView(currentId.current) : null;
      await refreshSim();
      if (done) setAnnounce(done(v));
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : (e as Error).message;
      setError(msg);
      setAnnounce(msg);
      if (currentId.current) await loadView(currentId.current).catch(() => undefined);
      await refreshSim().catch(() => undefined);
    } finally {
      setBusy(null);
    }
  };

  const loadScenario = () => act("load", async () => {
    await api.post(`/api/scenarios/${scenarioId}/load`);
    currentId.current = null;
    setView(null);
    setLoadedScenario(scenarioId);
    onScenarioLoaded?.();
  }, () => `Scenario ${scenarioId} loaded. Simulated clock reset.`);

  // V3 CH-21: event names only, no ids or values.
  const analytics = useAnalytics();
  const completed = useRef(new Set<string>());
  useEffect(() => {
    if (view && ["PAUSE_VERIFIED", "DISMISSED", "NO_ACTION", "NEEDS_REVIEW", "BLOCKED"].includes(view.status) && !completed.current.has(view.id)) {
      completed.current.add(view.id);
      analytics.track("scenario_completed");
    }
  }, [view, analytics]);

  const simulateAlert = () => act("emit", async () => {
    const r = await api.post<{ event: { eventId: string }; delivery: { status: number; body: { investigationId?: string; message?: string } } }>("/mock-pos/events", { storeId: store });
    if (r.delivery.body?.investigationId) {
      const v = await loadView(r.delivery.body.investigationId);
      analytics.track("scenario_started");
      setAnnounce(`Kitchen alert received. ${copyFor(v.decisionCode).title}.`);
      focusHeading.current = true;
    } else throw new Error(`Webhook was not accepted (${r.delivery.status}): ${r.delivery.body?.message ?? "no detail"}`);
  });

  const approveAndPause = (acknowledged: string[]) => act("pause", async () => {
    if (!view) return;
    const a = await api.post<{ approvalId: string }>(`/api/investigations/${view.id}/approve`, acknowledged.length ? { acknowledgeWarnings: acknowledged } : {});
    await api.post(`/api/investigations/${view.id}/pause-campaign`, { approvalId: a.approvalId });
    setConfirmOpen(false);
  }, (v) => copyFor(v?.decisionCode ?? null).title);

  const retry = () => act("retry", async () => {
    if (!view) return;
    const ap = view.approvals[view.approvals.length - 1];
    if (!ap) throw new Error("No approval on record");
    await api.post(`/api/investigations/${view.id}/pause-campaign`, { approvalId: ap.approvalId });
  }, (v) => copyFor(v?.decisionCode ?? null).title);

  const checkAgain = () => act("verify", async () => { if (view) await api.post(`/api/investigations/${view.id}/verify`); }, (v) => copyFor(v?.decisionCode ?? null).title);

  const dismiss = (reason: string) => act("dismiss", async () => {
    if (!view) return;
    await api.post(`/api/investigations/${view.id}/dismiss`, { reason });
    setDismissOpen(false);
  }, () => "Kept active. Nothing was changed.");

  const reassess = () => act("reassess", async () => {
    if (!view) return;
    const r = await api.post<{ investigationId: string }>(`/api/investigations/${view.id}/reassess`);
    await loadView(r.investigationId);
  });

  const scenario = scenarios.find((s) => s.id === (loadedScenario ?? scenarioId));
  const selected = scenarios.find((s) => s.id === scenarioId);
  const copy = copyFor(view?.decisionCode ?? null);
  const tone = !view ? "idle" : view.status === "PAUSE_VERIFIED" ? "ok" : view.status === "AWAITING_APPROVAL" || view.status === "APPROVED" ? "ready" : view.status === "NO_ACTION" || view.status === "DISMISSED" ? "calm" : view.status === "BLOCKED" ? "stop" : "warn";

  /** CH-8: an evidence chip opens the technical evidence and jumps to that record. */
  const inspectorRef = useRef<HTMLDetailsElement>(null);
  const showEvidence = (evidenceId: string) => {
    const insp = inspectorRef.current;
    if (insp) insp.open = true;
    requestAnimationFrame(() => {
      const row = document.getElementById(`ev-${evidenceId}`) as HTMLDetailsElement | null;
      if (!row) return;
      row.open = true;
      row.scrollIntoView({ block: "center" });
      row.querySelector("summary")?.focus();
    });
  };

  const toggleDemoTools = () => { const next = !demoTools; setDemoTools(next); writePref("demoTools", next); };
  // CH-7: a blocked or unconfirmed outcome needs its explanation, so the proof opens by itself.
  const needsExplaining = !!view && (view.status === "BLOCKED" || view.status === "PAUSE_REQUESTED_NOT_VERIFIED");

  return (
    <div className="shift">
      {pitch && <PitchPanel v={view} />}
      {myStores.length > 1 && onChooseStore && <FleetBar stores={myStores} current={store} onChoose={onChooseStore} />}
      <section className="control-strip" aria-label="Demo controls">
        <div className="strip-row">
          <p className="strip-label">Demo<span className="sr-only"> controls, for trying the product with synthetic data</span></p>
          <div className="scenario-pick">
            <label htmlFor="scenario">Scenario</label>
            <select id="scenario" value={scenarioId} onChange={(e) => setScenarioId(e.target.value)}>
              {scenarios.map((s) => <option key={s.id} value={s.id}>{s.id}: {s.title}</option>)}
            </select>
            <button className="btn quiet" onClick={loadScenario} disabled={!!busy}>{busy === "load" ? "Loading…" : "Load scenario"}</button>
          </div>
          <button className="btn strong" onClick={simulateAlert} disabled={!!busy}>{busy === "emit" ? "Sending alert…" : "Simulate kitchen alert"}</button>
          <p className="sim-clock">Simulated time <strong>{clock(sim?.clock)}</strong></p>
          <label className="toggle">
            <input type="checkbox" checked={demoTools} onChange={toggleDemoTools} />
            <span>Show demo tools</span>
          </label>
        </div>
      </section>
      {selected && selected.id !== loadedScenario && <p className="hint">Press <em>Load scenario</em> to reset the simulators to “{selected.title}”.</p>}
      {scenario && demoTools && (
        <details className="scenario-note">
          <summary>About scenario {scenario.id}: {scenario.title}</summary>
          <p>{scenario.summary}</p>
          <p><strong>Try:</strong> {scenario.steps.join(", then ")}. <strong>Expected:</strong> {scenario.expected}</p>
        </details>
      )}

      <div className="sr-only" aria-live="polite" role="status">{announce}</div>
      {error && <p className="error-line" role="alert">{error}</p>}

      {!view && (
        <section className="empty">
          <h1>No kitchen alerts yet</h1>
          <p className="empty-lede">Nothing needs your attention. MarginPulse checks every new kitchen alert against your policy and only asks you when a decision is needed.</p>
          <p className="muted">To try it, press <strong>Simulate kitchen alert</strong> above. The mock POS sends a signed alert, just as a real one would.</p>
          <Welcome />
        </section>
      )}

      {view && (
        <article className="investigation" aria-labelledby="inv-title">
          <div className="inv-head">
            <div>
              <h1 id="inv-title" ref={headingRef} tabIndex={-1}>
                {view.status === "PAUSE_VERIFIED" ? "One Sponsored Listings campaign paused with your approval."
                  : view.decision === "RECOMMEND_PAUSE" ? "Kitchen rush detected. One active Sponsored Listings campaign may be adding paid demand."
                    : view.kitchen && view.kitchen.thresholdMinutes !== null && view.kitchen.p95PrepMinutes >= view.kitchen.thresholdMinutes ? "Kitchen rush detected." : "Kitchen alert checked."}
              </h1>
              <p className="inv-meta">
                {view.store?.name ?? String(view.event.storeId)} <span aria-hidden="true">/</span> {shortClock(view.createdAt)} ET <span aria-hidden="true">/</span> Investigation {view.id}
                {view.parentId && <> <span aria-hidden="true">/</span> re-assessment of <button className="linkish" onClick={() => loadView(view.parentId!)}>{view.parentId}</button></>}
              </p>
            </div>
            <p className="boundary">One campaign only · Manager approval required</p>
          </div>

          <Stepper status={view.status} hadApproval={view.approvals.length > 0} />

          <div className={`verdict tone-${tone}`} role="status">
            <div className="verdict-main">
              <h2>{copy.title}</h2>
              <VerdictExplainer v={view} onShowEvidence={showEvidence} />
            </div>
            <p className="verdict-code"><span className="sr-only">Decision code </span>{view.decisionCode ?? view.status}</p>
          </div>

          {view.viewer && !view.viewer.canApproveHere && (view.actions.canApprove || view.actions.canPause || view.actions.canRetry) && (
            <div className="role-banner" role="note">
              <p>
                <strong>Only a manager for {view.store?.name ?? "this store"} can approve this pause.</strong> You are viewing as {view.viewer.displayName}.
              </p>
              {view.eligibleApprovers.length > 0 && onSwitchUser ? (
                <div className="btn-row">
                  {view.eligibleApprovers.map((e) => (
                    <button key={e.userId} className="btn quiet small" onClick={() => onSwitchUser(e.userId, view.id)}>Demo: switch to {e.displayName}</button>
                  ))}
                </div>
              ) : <p className="muted">No demo manager is assigned to this store.</p>}
              <p className="muted small">The identity switcher is a demo convenience, not sign-in. The server checks every approval.</p>
            </div>
          )}

          {view.warnings.map((w) => (
            <div key={w.code} className="repeat-warning" role="note" aria-labelledby={`warn-${w.code}`}>
              <h2 id={`warn-${w.code}`}>Possible repeat alert</h2>
              <p>
                Investigation <button className="linkish" onClick={() => loadView(w.priorInvestigationId)}>{w.priorInvestigationId}</button> was opened{" "}
                {w.secondsApart !== null && w.secondsApart < 60 ? "moments" : `${Math.round((w.secondsApart ?? 0) / 60)} min`} earlier for the same kitchen snapshot ({w.snapshotId}, P95 {w.p95} min).
              </p>
              <p className="muted">This may be the POS resending one alert under a new id, or a real second alert. Either can happen; nothing has been decided. A manager must confirm before approving.</p>
            </div>
          ))}

          {view.kitchen || view.campaign ? (
            <>
              {/* CH-10: once verified, the receipt is the answer, so it comes before the (now finished) action block. */}
              {view.status === "PAUSE_VERIFIED" && <OutcomePanel v={view} />}
              <ActionCard v={view} busy={busy} canApprove={!view.viewer || view.viewer.canApproveHere} onPause={() => setConfirmOpen(true)} onKeep={() => setDismissOpen(true)} onRetry={retry} onCheck={checkAgain} onReassess={reassess} onOpenChild={(id) => loadView(id)} />
              {view.status !== "PAUSE_VERIFIED" && <OutcomePanel v={view} />}
              {(view.status === "PAUSE_VERIFIED" || view.status === "DISMISSED") && <ShiftDigest v={view} store={view.store?.posStoreId ?? store} />}
              <h2 className="section-label">The evidence</h2>
              <div className="cards">
                <KitchenCard v={view} />
                <CampaignCard v={view} />
              </div>
            </>
          ) : (
            <>
              <div className="cards-missing">
                <p>No kitchen or campaign evidence could be read for this alert.</p>
                {view.actions.canReassess && <button className="btn quiet" onClick={reassess}>Re-assess with fresh data</button>}
              </div>
              <OutcomePanel v={view} />
            </>
          )}

          <section className="proof" aria-labelledby="proof-h">
            <h2 id="proof-h" className="section-label">Proof and details</h2>
            <p className="inv-history">{historyLine(view.storeHistory)}</p>
            <EvidenceChecks matrix={view.evidenceMatrix} defaultOpen={needsExplaining} />
            <Inspector ref={inspectorRef} v={view} adsProvider={adsProvider} investigator={investigator} />
          </section>
        </article>
      )}

      {demoTools && (
        <SimulatorPanel sim={sim} invId={view?.id ?? null} eventId={view?.event.eventId ?? null} storeId={store}
          onChanged={async (msg) => { if (currentId.current) await loadView(currentId.current); const s = await refreshSim(); if (msg) setAnnounce(msg); return s; }}
          onOpenInvestigation={(id) => loadView(id)} />
      )}

      {view && <ConfirmPauseDialog open={confirmOpen} v={view} busy={busy === "pause"} onConfirm={approveAndPause} onCancel={() => setConfirmOpen(false)} />}
      {view && <DismissDialog open={dismissOpen} busy={busy === "dismiss"} onConfirm={dismiss} onCancel={() => setDismissOpen(false)} />}
    </div>
  );
}
