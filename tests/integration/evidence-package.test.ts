/** CH-18: audit evidence package. */
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { boot, Booted } from "../helpers";
import { canonicalJson } from "../../apps/api/src/audit/evidencePackage";

let t: Booted;
beforeAll(async () => { t = await boot(); });
afterAll(async () => { await t.close(); });

async function pkg(id: string, user = "mgr-ana") {
  const res = await fetch(`${t.base}/api/investigations/${id}/evidence-package`, { headers: { "x-demo-user": user } });
  const body = await res.text();
  return { status: res.status, body, json: res.ok ? JSON.parse(body) : null, sha: res.headers.get("x-evidence-sha256"), evStatus: res.headers.get("x-evidence-status"), cd: res.headers.get("content-disposition") };
}

describe("evidence package", () => {
  it("resolved pause: complete, consistent ids across approval, write and audit, policy snapshot from decision time", async () => {
    await t.api.load("A");
    const { delivery } = await t.api.emit();
    const id = delivery.body.investigationId;
    await t.api.approveAndPause(id);
    const p = await pkg(id);
    expect(p.status).toBe(200);
    expect(p.cd).toBe('attachment; filename="audit-evidence-inv-1042.json"');
    expect(p.evStatus).toBe("complete");
    const j = p.json;
    expect(j.schema).toBe("marginpulse-evidence-package/1");
    expect(j.evidenceStatus).toEqual({ status: "complete", reasons: [] });
    expect(j.investigation).toMatchObject({ id: "inv-1042", eventId: "evt-kds-1831-001", campaignId: "cmp-syn-4081", status: "PAUSE_VERIFIED", observedCampaignVersion: 12 });
    expect(j.policyAtDecision).toMatchObject({ available: true, evidenceRef: "policy-rush-control-v3", snapshot: { version: "v3", p95ThresholdMinutes: 28 } });
    const approvalId = j.approvals[0].approvalId;
    expect(approvalId).toBe("apr-501");
    expect(j.writes).toEqual([expect.objectContaining({ attempt: 1, requestId: "req-pause-4081-001", approvalId, status: "SUCCEEDED" })]);
    expect(j.audit.find((a: any) => a.type === "MANAGER_APPROVED").payload.approvalId).toBe(approvalId);
    expect(j.audit.find((a: any) => a.type === "PATCH_SENT").payload.requestId).toBe("req-pause-4081-001");
    expect(j.readbacks.at(-1)).toMatchObject({ configuredStatus: "CAMPAIGN_CONFIGURED_STATUS_PAUSED", effectiveStatus: "CAMPAIGN_EFFECTIVE_STATUS_PAUSED", version: 13 });
    expect(j.integrity.chain.ok).toBe(true);
    expect(j.integrity.thisInvestigation.entries).toBe(j.audit.length);
  });

  it("digest matches the exact bytes and serialization is stable", async () => {
    await t.api.load("A");
    const { delivery } = await t.api.emit();
    const p = await pkg(delivery.body.investigationId);
    expect(p.sha).toBe(createHash("sha256").update(p.body, "utf8").digest("hex"));
    expect(canonicalJson(JSON.parse(p.body))).toBe(p.body);
  });

  it("open, blocked and not-verified cases report honestly", async () => {
    await t.api.load("A");
    const open = await t.api.emit();
    const po = await pkg(open.delivery.body.investigationId);
    expect(po.json.evidenceStatus).toEqual({ status: "partial", reasons: ["the investigation is still open (AWAITING_APPROVAL)"] });

    await t.api.load("C");
    const blocked = await t.api.emit();
    const pb = await pkg(blocked.delivery.body.investigationId);
    expect(pb.json.evidenceStatus.status).toBe("complete");
    expect(pb.json.writes).toEqual([]);

    await t.api.load("J");
    const j = await t.api.emit();
    await t.api.approveAndPause(j.delivery.body.investigationId);
    const pj = await pkg(j.delivery.body.investigationId);
    expect(pj.json.investigation.status).toBe("PAUSE_REQUESTED_NOT_VERIFIED");
    expect(pj.json.evidenceStatus.status).toBe("partial");
  });

  it("read scope: store staff may export; other-store manager and unknown users may not", async () => {
    await t.api.load("A");
    const { delivery } = await t.api.emit();
    const id = delivery.body.investigationId;
    expect((await pkg(id, "staff-ben")).status).toBe(200);
    expect((await pkg(id, "mgr-cole")).status).toBe(403);
    expect((await pkg(id, "nobody")).status).toBe(401);
    expect((await pkg("inv-does-not-exist")).status).toBe(404);
  });

  it("contains no secrets", async () => {
    await t.api.load("A");
    const { delivery } = await t.api.emit();
    await t.api.approveAndPause(delivery.body.investigationId);
    const p = await pkg(delivery.body.investigationId);
    expect(p.body).not.toContain(t.config.adsToken);
    expect(p.body).not.toContain(t.config.posWebhookSecret);
    expect(p.body).toContain("Bearer [REDACTED]");
  });

  it("a broken audit chain makes the package unverifiable", async () => {
    await t.api.load("A");
    const { delivery } = await t.api.emit();
    t.db.exec("DROP TRIGGER mp_audit_no_update");
    t.db.exec("UPDATE mp_audit SET actor = 'someone-else' WHERE type = 'EVENT_RECEIVED'");
    const p = await pkg(delivery.body.investigationId);
    expect(p.evStatus).toBe("unverifiable");
    expect(p.json.evidenceStatus.reasons[0]).toMatch(/^the audit chain does not verify/);
    // scenario reload rebuilds the schema (and its triggers) for the next tests
    await t.api.load("A");
  });
});
