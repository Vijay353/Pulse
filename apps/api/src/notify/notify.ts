/**
 * CH-19: outbound notification when an investigation reaches a final state.
 *
 * What it is: one signed HTTP POST to a merchant-configured URL (a Slack or
 * email bridge), sent after the decision is already stored and audited.
 * What it is not: an action loop. It cannot approve, pause or resume anything,
 * it never changes an investigation, and a failure never blocks a decision.
 * Every attempt (sent or failed) is appended to the audit log.
 *
 * Off unless NOTIFY_WEBHOOK_URL and NOTIFY_WEBHOOK_SECRET are both set
 * (see optionalProblems in config.ts). When off it is a silent no-op so the
 * audit trail of every existing scenario is unchanged.
 */
import { createHmac } from "node:crypto";
import type { Db } from "../db/db";
import type { Clock } from "../clock";
import { appendAudit } from "../audit/audit";
import { explainVerdict } from "../../../../packages/contracts/src/explain";

export interface Notifier {
  /** Called after a final transition has been written. Never throws, never awaits in the caller. */
  onFinal(investigationId: string, status: string): void;
  /** Resolves when every notification started so far has finished (tests and shutdown). */
  drain(): Promise<void>;
}

export const NOOP_NOTIFIER: Notifier = { onFinal() {}, drain: async () => {} };

export const NOTIFY_SIGNATURE_HEADER = "x-marginpulse-signature";
export const signNotification = (body: string, secret: string) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

export function createNotifier(d: {
  db: Db;
  clock: Clock;
  url: string;
  secret: string;
  timeoutMs: number;
  publicBaseUrl: string | null;
  /** Reads the stored investigation view (read-only). */
  loadView: (id: string) => Promise<Record<string, unknown> | null>;
  fetchImpl?: typeof fetch;
}): Notifier {
  const pending = new Set<Promise<void>>();
  const host = (() => { try { return new URL(d.url).host; } catch { return "invalid-url"; } })();

  const send = async (id: string, status: string) => {
    let outcome: { ok: boolean; detail: Record<string, unknown> };
    try {
      const v = (await d.loadView(id)) as Parameters<typeof explainVerdict>[0] & { store?: { name?: string; posStoreId?: string } | null } | null;
      if (!v) throw new Error("investigation not found");
      const why = explainVerdict(v);
      const body = JSON.stringify({
        type: "marginpulse.investigation.final",
        investigationId: id,
        store: v.store ? { id: v.store.posStoreId ?? null, name: v.store.name ?? null } : null,
        status,
        decisionCode: v.decisionCode,
        headline: why.headline,
        detail: why.detail,
        evidencePackage: d.publicBaseUrl ? `${d.publicBaseUrl.replace(/\/$/, "")}/api/investigations/${encodeURIComponent(id)}/evidence-package` : `/api/investigations/${encodeURIComponent(id)}/evidence-package`,
        note: "Notification only. MarginPulse never pauses or resumes anything from a notification.",
        sentAt: d.clock.nowIso(),
      });
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), d.timeoutMs);
      try {
        const res = await (d.fetchImpl ?? fetch)(d.url, { method: "POST", headers: { "content-type": "application/json", [NOTIFY_SIGNATURE_HEADER]: signNotification(body, d.secret) }, body, signal: ctrl.signal, redirect: "manual" });
        outcome = res.ok ? { ok: true, detail: { host, status: res.status } } : { ok: false, detail: { host, status: res.status, reason: "non-2xx response" } };
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      const err = e as Error;
      outcome = { ok: false, detail: { host, reason: err.name === "AbortError" ? `timeout after ${d.timeoutMs} ms` : err.message.slice(0, 160) } };
    }
    try {
      appendAudit(d.db, d.clock, { investigationId: id, type: outcome.ok ? "NOTIFICATION_SENT" : "NOTIFICATION_FAILED", actor: "notifier", payload: { status, ...outcome.detail } });
    } catch { /* database closed during shutdown: nothing else to record */ }
  };

  return {
    onFinal(id, status) {
      // Run after the current synchronous work (and any transaction) has finished.
      const p = new Promise<void>((resolve) => setImmediate(() => { send(id, status).finally(resolve); }));
      pending.add(p);
      p.finally(() => pending.delete(p));
    },
    async drain() { while (pending.size) await Promise.all([...pending]); },
  };
}
