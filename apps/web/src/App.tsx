import { useEffect, useState } from "react";
import { api, setCsrf, setUser } from "./api/client";
import { ShiftView } from "./pages/ShiftView";
import { DataStudio } from "./pages/DataStudio";
import { createAnalytics } from "./analytics/clarity";
import { AnalyticsContext } from "./analytics/context";
import { AnalyticsNotice } from "./components/AnalyticsNotice";

const viteEnv = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

interface SessionUser { user_id: string; display_name: string; role: string; stores: string | null }
interface Health { ok: boolean; adsProvider: string; investigator: string | null; problems: { component: string; problem: string }[]; accessGate?: boolean }

export function App() {
  const [ready, setReady] = useState(false);
  const [users, setUsers] = useState<SessionUser[]>([]);
  const [user, setUserState] = useState("mgr-ana");
  const [tab, setTab] = useState<"shift" | "data">(() => (location.hash === "#data" ? "data" : "shift"));
  const [health, setHealth] = useState<Health | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);
  // V3 CH-21: created once per page load; installs nothing without the visitor's consent.
  const [analytics] = useState(() => createAnalytics({ projectId: viteEnv.VITE_CLARITY_PROJECT_ID, allowLocal: viteEnv.VITE_CLARITY_ALLOW_LOCAL === "true", win: window as never, doc: document }));
  useEffect(() => { if (ready) analytics.start(); }, [ready, analytics]);

  useEffect(() => {
    Promise.all([api.get<{ csrfToken: string; users: SessionUser[] }>("/api/session"), api.get<Health>("/api/health")])
      .then(([s, h]) => { setCsrf(s.csrfToken); setUsers(s.users); setHealth(h); setReady(true); })
      .catch((e: Error) => setBootError(e.message));
  }, []);

  useEffect(() => { location.hash = tab === "data" ? "data" : ""; }, [tab]);

  const [focusId, setFocusId] = useState<string | null>(null);
  const chooseUser = (u: string, keepInvestigation: string | null = null) => { setFocusId(keepInvestigation); setUser(u); setUserState(u); };

  return (
    <AnalyticsContext.Provider value={analytics}>
      <a className="skip" href="#main">Skip to content</a>
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <div>
            <span className="brand-name">MarginPulse</span>
            <span className="brand-sub">Rush-aware Sponsored Listings control</span>
          </div>
        </div>
        <nav className="tabs" aria-label="Sections">
          <button className={tab === "shift" ? "tab on" : "tab"} aria-current={tab === "shift" ? "page" : undefined} onClick={() => setTab("shift")}>Shift view</button>
          <button className={tab === "data" ? "tab on" : "tab"} aria-current={tab === "data" ? "page" : undefined} onClick={() => setTab("data")}>Data studio</button>
        </nav>
        <div className="topbar-right">
          <span className="demo-badge" title="All records are synthetic. Mock POS and Mock Uber Ads run locally.">Synthetic demo</span>
          {health?.accessGate && (
            <form method="post" action="/access/logout" className="lock-form">
              <button type="submit" className="tab">Lock demo</button>
            </form>
          )}
          <label className="who">
            <span className="sr-only">Demo identity (not authentication)</span>
            <select value={user} onChange={(e) => chooseUser(e.target.value)} aria-label="Demo identity (not authentication)">
              {users.map((u) => <option key={u.user_id} value={u.user_id}>{u.display_name}</option>)}
            </select>
          </label>
        </div>
      </header>
      {health && !health.ok && (
        <div className="setup-banner" role="alert">
          <strong>Setup problem: investigations will be blocked, never simulated.</strong>
          <ul>{health.problems.map((p, i) => <li key={i}>{p.component}: {p.problem}</li>)}</ul>
          <p>To return to the runnable default, start with <code>ADS_MODE=SIMULATED INVESTIGATOR=fixture</code>.</p>
        </div>
      )}
      <main id="main" data-clarity-mask="true">
        {bootError && <p className="error-line" role="alert">Couldn’t reach the MarginPulse server: {bootError}. Start it with <code>npm start</code>.</p>}
        {ready && (tab === "shift" ? <ShiftView key={user} user={user} focusId={focusId} onSwitchUser={chooseUser} adsProvider={health?.adsProvider ?? ""} investigator={health?.investigator ?? null} /> : <DataStudio key={user} />)}
      </main>
      <footer className="foot">
        Portfolio concept, not an Uber product. Synthetic records only. Demo identity switcher is not authentication.
        {ready && <AnalyticsNotice analytics={analytics} />}
      </footer>
    </AnalyticsContext.Provider>
  );
}
