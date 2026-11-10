/** CH-6: possible repeat alerts need explicit, authorized human confirmation; the base scenario is unchanged. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { boot, Booted } from "../helpers";

let t: Booted;
beforeAll(async () => { t = await boot(); });
afterAll(async () => { await t.close(); });

describe("possible repeat alert", () => {
  it("base scenario A: one alert, check runs, no warning", async () => {
    await t.api.load("A");
    const { delivery } = await t.api.emit();
    const v = await t.api.view(delivery.body.investigationId);
    expect(v.warnings).toEqual([]);
    expect(v.evidence.find((e: any) => e.kind === "REPEAT_CHECK").payload).toMatchObject({ flagged: false, compared: 0 });
    expect(v.decisionCode).toBe("RECOMMEND_PAUSE");
  });

  it("scenario S: the second alert is flagged, the first is not, and the decision itself is unchanged", async () => {
    await t.api.load("S");
    const first = await t.api.emit();
    const second = await t.api.emit();
    expect(second.event.eventId).not.toBe(first.event.eventId);
    const v1 = await t.api.view(first.delivery.body.investigationId);
    const v2 = await t.api.view(second.delivery.body.investigationId);
    expect(v1.warnings).toEqual([]);
    expect(v2.decisionCode).toBe("RECOMMEND_PAUSE");
    expect(v2.warnings).toHaveLength(1);
    expect(v2.warnings[0]).toMatchObject({ code: "POSSIBLE_REPEAT_ALERT", priorInvestigationId: v1.id, snapshotId: "kds-snap-812", p95: 34, secondsApart: 0 });
  });

  it("approval without acknowledgement is refused; staff cannot bypass; manager with acknowledgement proceeds", async () => {
    await t.api.load("S");
    await t.api.emit();
    const { delivery } = await t.api.emit();
    const id = delivery.body.investigationId;
    const noAck = await t.api.post(`/api/investigations/${id}/approve`, {});
    expect(noAck.status).toBe(409);
    expect(noAck.body.error).toBe("WARNING_NOT_ACKNOWLEDGED");
    expect((await t.api.view(id)).approvals).toHaveLength(0);
    const staff = await t.api.post(`/api/investigations/${id}/approve`, { acknowledgeWarnings: ["POSSIBLE_REPEAT_ALERT"] }, "staff-ben");
    expect(staff.status).toBe(403);
    const ok = await t.api.post(`/api/investigations/${id}/approve`, { acknowledgeWarnings: ["POSSIBLE_REPEAT_ALERT"] });
    expect(ok.status).toBe(200);
    const p = await t.api.post(`/api/investigations/${id}/pause-campaign`, { approvalId: ok.body.approvalId });
    expect(p.body.output.ok).toBe(true);
    const v = await t.api.view(id);
    expect(v.status).toBe("PAUSE_VERIFIED");
    expect(v.result.executionChecks.find((c: any) => c.id === "warnings_acknowledged")).toMatchObject({ ok: true });
    expect(v.audit.find((e: any) => e.type === "MANAGER_APPROVED").payload.acknowledgedWarnings).toEqual(["POSSIBLE_REPEAT_ALERT"]);
  });

  it("re-reading and re-assessing never create a second flag for the same investigation", async () => {
    await t.api.load("S");
    await t.api.emit();
    const { delivery } = await t.api.emit();
    const id = delivery.body.investigationId;
    await t.api.view(id);
    await t.api.view(id);
    const flags = (await t.api.view(id)).audit.filter((e: any) => e.type === "POSSIBLE_REPEAT_FLAGGED");
    expect(flags).toHaveLength(1);
    await t.api.post(`/api/investigations/${id}/dismiss`, { reason: "Checked: this was a duplicate" });
    expect(await t.api.patchCount()).toBe(0);
  });

  it("a new kitchen snapshot is not flagged as a repeat", async () => {
    await t.api.load("A");
    await t.api.emit();
    // The POS records a fresh snapshot (via merge import of one row), then alerts again.
    const csv = "snapshot_id,pos_store_id,captured_at,p95_prep_minutes,active_tickets,connector_health\r\nkds-snap-813,SYN-STORE-104,2026-10-18T18:31:40-04:00,35,19,HEALTHY\r\n";
    const s = await fetch(`${t.base}/api/session`);
    const cookie = (s.headers.get("set-cookie") ?? "").split(";")[0]!;
    const { csrfToken } = (await s.json()) as { csrfToken: string };
    const pv = await (await fetch(`${t.base}/api/data/import/preview?filename=s.csv&mode=merge&entity=kitchen_snapshots`, { method: "POST", headers: { "content-type": "application/octet-stream", cookie, "x-csrf-token": csrfToken, "x-demo-user": "mgr-ana" }, body: csv })).json();
    await t.api.post(`/api/data/import/${(pv as any).batchId}/commit`);
    const second = await t.api.emit();
    expect(second.event.snapshotId).toBe("kds-snap-813");
    expect((await t.api.view(second.delivery.body.investigationId)).warnings).toEqual([]);
  });
});
