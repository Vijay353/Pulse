import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "../api/client";
import { recordsEmptyState } from "../state/empty";

interface Issue { sheet: string; row: number | null; column: string | null; message: string }
interface Preview {
  batchId: string; mode: string; ok: boolean; errors: Issue[]; errorCount: number; warnings: Issue[];
  summary: Record<string, { added: number; updated: number; unchanged: number; removed: number; rejected: number }>;
  changes: { sheet: string; key: string; change: string; detail?: string }[];
}
interface Batch { batch_id: string; filename: string; mode: string; status: string; actor: string; created_at: string; committed_at: string | null }

const ENTITIES = ["users", "user_stores", "stores", "store_mappings", "kitchen_snapshots", "cost_profiles", "ad_accounts", "ad_account_stores", "campaigns", "campaign_reports", "merchant_policies"];

/** Secondary surface: load and inspect the data behind the simulators. Excel is interchange, not a system of record. */
export function DataStudio() {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [entity, setEntity] = useState("campaigns");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [history, setHistory] = useState<Batch[]>([]);
  const [msg, setMsg] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [browse, setBrowse] = useState("campaigns");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const isCsv = !!file && /\.csv$/i.test(file.name);

  const loadHistory = useCallback(async () => setHistory((await api.get<{ imports: Batch[] }>("/api/data/imports")).imports), []);
  const [total, setTotal] = useState(0);
  const loadRows = useCallback(async () => {
    const r = await api.get<{ rows: Record<string, unknown>[]; total: number }>(`/api/data/records/${browse}?q=${encodeURIComponent(q)}`);
    setRows(r.rows);
    setTotal(r.total);
  }, [browse, q]);
  useEffect(() => { loadHistory().catch(() => undefined); }, [loadHistory]);
  useEffect(() => { loadRows().catch(() => undefined); }, [loadRows]);

  const wrap = async (fn: () => Promise<void>) => {
    setBusy(true); setErr(null);
    try { await fn(); } catch (e) { setErr(e instanceof ApiError ? e.message : (e as Error).message); } finally { setBusy(false); }
  };

  const validate = () => wrap(async () => {
    if (!file) return;
    const qs = new URLSearchParams({ filename: file.name, mode: isCsv ? "merge" : mode, ...(isCsv ? { entity } : {}) });
    const p = await api.upload<Preview>(`/api/data/import/preview?${qs}`, file);
    setPreview(p);
    setMsg(p.ok ? "File is valid. Review the changes, then commit." : `${p.errorCount} problem${p.errorCount === 1 ? "" : "s"} found. Fix the file and validate again.`);
    await loadHistory();
  });

  const commit = () => wrap(async () => {
    if (!preview) return;
    await api.post(`/api/data/import/${preview.batchId}/commit`);
    setMsg("Committed. The simulators now hold this data; run a kitchen alert in Shift view to use it.");
    setPreview(null);
    await loadHistory(); await loadRows();
  });

  const restore = (id: string) => wrap(async () => {
    await api.post(`/api/data/import/${id}/restore`);
    setMsg(`Restored the data as it was before ${id}.`);
    await loadHistory(); await loadRows();
  });

  const cols = rows[0] ? Object.keys(rows[0]) : [];
  const empty = recordsEmptyState(browse, total, rows.length, q);

  return (
    <div className="studio">
      <section className="studio-intro">
        <h1>Data studio</h1>
        <p>Edit the synthetic records behind Mock POS and Mock Uber Ads in a spreadsheet, check them, and load them. A workbook sets up the simulators; it is not a live integration.</p>
        <div className="btn-row">
          <a className="btn quiet" href="/api/data/template.xlsx">Download sample workbook</a>
          <a className="btn quiet" href="/api/data/export.xlsx">Export current data</a>
        </div>
      </section>

      <section className="studio-block" aria-labelledby="imp-h">
        <h2 id="imp-h">Import</h2>
        <div className="import-form">
          <label className="file">
            <span>Workbook (.xlsx) or one sheet as .csv</span>
            <input type="file" accept=".xlsx,.csv" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); setMsg(""); }} />
          </label>
          {isCsv ? (
            <label><span>Sheet in this CSV</span>
              <select value={entity} onChange={(e) => setEntity(e.target.value)}>{ENTITIES.map((x) => <option key={x}>{x}</option>)}</select>
            </label>
          ) : (
            <fieldset className="modes">
              <legend>How to apply it</legend>
              <label><input type="radio" name="mode" checked={mode === "merge"} onChange={() => setMode("merge")} /> Merge: update only the rows in the file</label>
              <label><input type="radio" name="mode" checked={mode === "replace"} onChange={() => setMode("replace")} /> Replace: the file becomes all simulator data</label>
            </fieldset>
          )}
          <button className="btn strong" onClick={validate} disabled={!file || busy}>Check file</button>
        </div>
        <p className="status-line" role="status" aria-live="polite">{msg}</p>
        {err && <p className="error-line" role="alert">{err}</p>}

        {preview && (
          <div className="preview">
            <div className="table-wrap" tabIndex={0} role="region" aria-label="Table, scrolls sideways if needed">
              <table>
                <caption>What would change ({preview.mode})</caption>
                <thead><tr><th scope="col">Sheet</th><th scope="col">Added</th><th scope="col">Updated</th><th scope="col">Unchanged</th><th scope="col">Removed</th><th scope="col">Rejected</th></tr></thead>
                <tbody>{Object.entries(preview.summary).map(([s, n]) => <tr key={s}><td>{s}</td><td>{n.added}</td><td>{n.updated}</td><td>{n.unchanged}</td><td>{n.removed}</td><td className={n.rejected ? "bad" : ""}>{n.rejected}</td></tr>)}</tbody>
              </table>
            </div>
            {preview.changes.length > 0 && <details><summary>{preview.changes.length} record change{preview.changes.length === 1 ? "" : "s"}</summary><ul className="plain small">{preview.changes.map((c, i) => <li key={i}>{c.sheet} <code>{c.key}</code> {c.change}{c.detail ? ` (${c.detail})` : ""}</li>)}</ul></details>}
            {preview.errors.length > 0 && (
              <div className="table-wrap" tabIndex={0} role="region" aria-label="Table, scrolls sideways if needed">
                <table className="errors">
                  <caption>Problems to fix</caption>
                  <thead><tr><th scope="col">Sheet</th><th scope="col">Row</th><th scope="col">Column</th><th scope="col">Problem</th></tr></thead>
                  <tbody>{preview.errors.map((e, i) => <tr key={i}><td>{e.sheet}</td><td>{e.row ?? "n/a"}</td><td>{e.column ?? "n/a"}</td><td>{e.message}</td></tr>)}</tbody>
                </table>
              </div>
            )}
            {preview.warnings.length > 0 && <p className="muted">Notes: {preview.warnings.map((w) => `${w.sheet}: ${w.message}`).join("; ")}</p>}
            <div className="btn-row">
              <button className="btn primary" onClick={commit} disabled={!preview.ok || busy}>Commit {preview.mode}</button>
              <button className="btn quiet" onClick={() => setPreview(null)}>Discard</button>
            </div>
          </div>
        )}
      </section>

      <section className="studio-block" aria-labelledby="hist-h">
        <h2 id="hist-h">Import history</h2>
        {history.length === 0 ? <p className="muted">No imports yet. Download the sample workbook to start.</p> : (
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Table, scrolls sideways if needed">
            <table>
              <thead><tr><th scope="col">Batch</th><th scope="col">File</th><th scope="col">Mode</th><th scope="col">Status</th><th scope="col">By</th><th scope="col"><span className="sr-only">Actions</span></th></tr></thead>
              <tbody>{history.map((b) => <tr key={b.batch_id}><td><code>{b.batch_id}</code></td><td>{b.filename}</td><td>{b.mode}</td><td>{b.status.toLowerCase()}</td><td>{b.actor}</td><td>{b.status === "COMMITTED" && <button className="btn quiet small" onClick={() => restore(b.batch_id)} disabled={busy}>Restore previous data</button>}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </section>

      <section className="studio-block" aria-labelledby="rec-h">
        <h2 id="rec-h">Records</h2>
        <div className="browse-bar">
          <label><span>Sheet</span><select value={browse} onChange={(e) => setBrowse(e.target.value)}>{ENTITIES.map((x) => <option key={x}>{x}</option>)}</select></label>
          <label><span>Search</span><input className="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="id, name, status…" /></label>
          <a className="btn quiet small" href={`/api/data/export/${browse}.csv`}>Download as CSV</a>
        </div>
        {empty ? (
          <div className="empty-state" role="status">
            <p>{empty.text}</p>
            {empty.kind === "no-match" && <button className="btn quiet small" onClick={() => setQ("")}>Clear search</button>}
          </div>
        ) : (
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Table, scrolls sideways if needed">
            <table className="records">
              <caption className="sr-only">{rows.length} of {total} {browse} records</caption>
              <thead><tr>{cols.map((c) => <th scope="col" key={c}>{c}</th>)}</tr></thead>
              <tbody>{rows.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c}><bdi>{r[c] === null ? "n/a" : String(r[c])}</bdi></td>)}</tr>)}</tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
