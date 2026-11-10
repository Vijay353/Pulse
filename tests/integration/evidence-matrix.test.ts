/** CH-19: the evidence matrix is derived from the stored trace and never disagrees with it. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { boot, Booted } from "../helpers";

let t: Booted;
beforeAll(async () => { t = await boot(); });
afterAll(async () => { await t.close(); });

const MAP = { PASS: "PASS", FAIL: "FAIL", SKIPPED: "NOT_EVALUATED" } as const;
const row = (v: any, id: string) => v.evidenceMatrix.checks.find((c: any) => c.checkId === id);

/** Every matrix row must match the persisted policy and execution checks. */
function agreesWithTrace(v: any) {
  const m = v.evidenceMatrix;
  for (const c of v.policyChecks ?? []) {
    if (c.id === "human_approval" || c.id === "prewrite_reread") continue;
    expect(row(v, c.id)?.status, c.id).toBe(MAP[c.outcome as keyof typeof MAP]);
  }
  const ex: any[] = v.result?.executionChecks ?? [];
  for (const id of ["policy_unchanged", "recommendation_fresh", "prewrite_reread", "warnings_acknowledged"]) {
    const e = ex.find((c) => c.id === id);
    if (e) expect(row(v, id).status, id).toBe(e.ok ? "PASS" : "FAIL");
    else if (id !== "warnings_acknowledged") expect(row(v, id).status, id).toBe("NOT_EVALUATED");
  }
  const s = { passed: 0, warned: 0, failed: 0, notEvaluated: 0 };
  for (const c of m.checks) s[c.status === "PASS" ? "passed" : c.status === "WARN" ? "warned" : c.status === "FAIL" ? "failed" : "notEvaluated"]++;
  expect(m.summary).toEqual(s);
  for (const c of m.checks) {
    if (c.status === "NOT_EVALUATED") expect(c.detail.startsWith("Not evaluated"), c.checkId).toBe(true);
    expect(c.blocksAutoAction).toBe(true);
  }
}

describe("evidence matrix", () => {
  it("A before approval: decision checks pass, execution checks not evaluated; refs point at stored evidence", async () => {
    await t.api.load("A");
    const { delivery, event } = await t.api.emit();
    const v = await t.api.view(delivery.body.investigationId);
    agreesWithTrace(v);
    expect(row(v, "threshold").status).toBe("PASS");
    expect(row(v, "human_approval").status).toBe("NOT_EVALUATED");
    expect(row(v, "prewrite_reread").status).toBe("NOT_EVALUATED");
    expect(row(v, "repeat_alert").status).toBe("PASS");
    expect(v.evidenceMatrix.summary.failed).toBe(0);
    const ids = new Set(v.evidence.map((e: any) => e.evidenceId));
    for (const c of v.evidenceMatrix.checks) for (const r of c.evidenceRefs) if (!r.includes(":")) expect(ids.has(r), `${c.checkId} -> ${r}`).toBe(true);
    expect(row(v, "event_freshness").evidenceRefs).toContain(`event:${event.eventId}`);
  });

  it("A after verified pause: approval and pre-write re-read pass with approval and request refs", async () => {
    await t.api.load("A");
    const { delivery } = await t.api.emit();
    await t.api.approveAndPause(delivery.body.investigationId);
    const v = await t.api.view(delivery.body.investigationId);
    expect(v.status).toBe("PAUSE_VERIFIED");
    agreesWithTrace(v);
    expect(row(v, "human_approval")).toMatchObject({ status: "PASS", evidenceRefs: ["approval:apr-501"] });
    expect(row(v, "prewrite_reread")).toMatchObject({ status: "PASS", evidenceRefs: ["request:req-pause-4081-001"] });
    expect(v.evidenceMatrix.summary.notEvaluated).toBe(0);
  });

  it("C stale snapshot: the failing check is FAIL and later checks are not evaluated, never passed", async () => {
    await t.api.load("C");
    const { delivery } = await t.api.emit();
    const v = await t.api.view(delivery.body.investigationId);
    expect(v.status).toBe("BLOCKED");
    agreesWithTrace(v);
    expect(row(v, "snapshot_freshness").status).toBe("FAIL");
    expect(row(v, "contribution_floor").status).toBe("NOT_EVALUATED");
    expect(row(v, "contribution_floor").evidenceRefs).toEqual([]);
  });

  it("E two campaigns: review outcome is a FAIL on the campaign count row", async () => {
    await t.api.load("E");
    const { delivery } = await t.api.emit();
    const v = await t.api.view(delivery.body.investigationId);
    expect(v.status).toBe("NEEDS_REVIEW");
    agreesWithTrace(v);
    expect(row(v, "campaign_count").status).toBe("FAIL");
  });

  it("S second alert: repeat row is WARN; after acknowledged approval the acknowledgement row passes", async () => {
    await t.api.load("S");
    await t.api.emit();
    const { delivery } = await t.api.emit();
    const id = delivery.body.investigationId;
    let v = await t.api.view(id);
    agreesWithTrace(v);
    expect(row(v, "repeat_alert").status).toBe("WARN");
    expect(v.evidenceMatrix.summary.warned).toBe(1);
    expect(row(v, "warnings_acknowledged")).toBeUndefined();
    const ok = await t.api.post(`/api/investigations/${id}/approve`, { acknowledgeWarnings: ["POSSIBLE_REPEAT_ALERT"] });
    await t.api.post(`/api/investigations/${id}/pause-campaign`, { approvalId: ok.body.approvalId });
    v = await t.api.view(id);
    agreesWithTrace(v);
    expect(row(v, "warnings_acknowledged").status).toBe("PASS");
  });

  it("J not verified: execution checks passed; the matrix does not claim the outcome is verified", async () => {
    await t.api.load("J");
    const { delivery } = await t.api.emit();
    await t.api.approveAndPause(delivery.body.investigationId);
    const v = await t.api.view(delivery.body.investigationId);
    expect(v.status).toBe("PAUSE_REQUESTED_NOT_VERIFIED");
    agreesWithTrace(v);
    expect(row(v, "prewrite_reread").status).toBe("PASS");
    expect(v.evidenceMatrix.checks.some((c: any) => /verified/i.test(c.label))).toBe(false);
  });

  it("policy changed after approval: policy_unchanged FAIL, pre-write re-read not evaluated", async () => {
    await t.api.load("A");
    const { delivery } = await t.api.emit();
    const id = delivery.body.investigationId;
    const a = await t.api.post(`/api/investigations/${id}/approve`);
    await t.api.post("/api/sim/policy/bump", { storeId: "SYN-STORE-104" });
    await t.api.post(`/api/investigations/${id}/pause-campaign`, { approvalId: a.body.approvalId });
    const v = await t.api.view(id);
    expect(v.decisionCode).toBe("BLOCKED_POLICY_CHANGED");
    agreesWithTrace(v);
    expect(row(v, "policy_unchanged").status).toBe("FAIL");
    expect(row(v, "prewrite_reread").status).toBe("NOT_EVALUATED");
  });

  it("evidence package carries the same matrix as the view", async () => {
    await t.api.load("A");
    const { delivery } = await t.api.emit();
    const id = delivery.body.investigationId;
    const v = await t.api.view(id);
    const res = await fetch(`${t.base}/api/investigations/${id}/evidence-package`, { headers: { "x-demo-user": "mgr-ana" } });
    expect((await res.json()).evidenceMatrix).toEqual(JSON.parse(JSON.stringify(v.evidenceMatrix)));
  });
});
