/** Excel/CSV data studio: validate → preview → confirm → atomic commit → re-query → workflow uses it. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { boot, Booted } from "../helpers";
import { fixtures, SAMPLE_CAMPAIGNS_CSV } from "../../scripts/workbook-fixtures";

let t: Booted;
let fx: Awaited<ReturnType<typeof fixtures>>;
beforeAll(async () => { t = await boot(); fx = await fixtures(); });
afterAll(async () => { await t.close(); });
beforeEach(async () => { await t.api.load("A"); });

async function upload(buf: Buffer | string, filename: string, mode: string, entity?: string) {
  const s = await fetch(`${t.base}/api/session`);
  const cookie = (s.headers.get("set-cookie") ?? "").split(";")[0]!;
  const { csrfToken } = (await s.json()) as { csrfToken: string };
  const q = new URLSearchParams({ filename, mode, ...(entity ? { entity } : {}) });
  const res = await fetch(`${t.base}/api/data/import/preview?${q}`, {
    method: "POST",
    headers: { "content-type": "application/octet-stream", cookie, "x-csrf-token": csrfToken, "x-demo-user": "mgr-ana" },
    body: typeof buf === "string" ? buf : new Uint8Array(buf),
  });
  return { status: res.status, body: (await res.json()) as any };
}

describe("template and export", () => {
  it("downloads a template with README + every entity sheet", async () => {
    const res = await fetch(`${t.base}/api/data/template.xlsx`);
    expect(res.headers.get("content-type")).toContain("spreadsheetml");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await res.arrayBuffer());
    expect(wb.worksheets.map((w) => w.name)).toEqual(["README", "users", "user_stores", "stores", "store_mappings", "kitchen_snapshots", "cost_profiles", "ad_accounts", "ad_account_stores", "campaigns", "campaign_reports", "merchant_policies"]);
  });

  it("export neutralizes formula injection and round-trips through import", async () => {
    // A hostile campaign name arrives through a merge CSV…
    const csv = SAMPLE_CAMPAIGNS_CSV.replace("Downtown Sponsored Listing", '"=HYPERLINK(""http://evil.example"",""x"")"').replace(",READ,", ",READ;UPDATE,");
    const p = await upload(csv, "campaigns.csv", "merge", "campaigns");
    expect(p.body.ok, JSON.stringify(p.body.errors)).toBe(true);
    await t.api.post(`/api/data/import/${p.body.batchId}/commit`);
    const res = await fetch(`${t.base}/api/data/export.xlsx`);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await res.arrayBuffer());
    const ws = wb.getWorksheet("campaigns")!;
    let name: unknown = null;
    ws.eachRow((row) => { if (row.getCell(1).value === "cmp-syn-4081") name = row.getCell(3).value; });
    expect(String(name).startsWith("'=")).toBe(true);
    const csvOut = await (await fetch(`${t.base}/api/data/export/campaigns.csv`)).text();
    expect(csvOut).toContain("'=HYPERLINK");
    // re-import of the export is accepted and a no-op
    const again = await upload(Buffer.from(await (await fetch(`${t.base}/api/data/export.xlsx`)).arrayBuffer()), "snapshot.xlsx", "replace");
    expect(again.body.ok).toBe(true);
    expect(Object.values(again.body.summary).every((s: any) => s.added === 0 && s.updated === 0 && s.removed === 0)).toBe(true);
  });
});

describe("import pipeline", () => {
  it("re-importing the canonical sample is idempotent (all unchanged)", async () => {
    const p = await upload(fx["marginpulse-sample-workbook.xlsx"]!.buf, "sample.xlsx", "replace");
    expect(p.body.ok).toBe(true);
    expect(p.body.summary.campaigns).toEqual({ added: 0, updated: 0, unchanged: 3, removed: 0, rejected: 0 });
  });

  it("preview does not mutate; commit persists atomically; re-query confirms; workflow uses the new data", async () => {
    const p = await upload(fx["valid/merge-threshold-40.xlsx"]!.buf, "threshold-40.xlsx", "merge");
    expect(p.body.ok).toBe(true);
    expect(p.body.summary.merchant_policies.updated).toBe(1);
    expect((await t.api.get("/policies/SYN-STORE-104/rush-control")).body.p95_threshold_minutes).toBe(28); // unchanged until commit
    const c = await t.api.post(`/api/data/import/${p.body.batchId}/commit`);
    expect(c.status).toBe(200);
    expect((await t.api.get("/policies/SYN-STORE-104/rush-control")).body.p95_threshold_minutes).toBe(40);
    const { delivery } = await t.api.emit();
    const v = await t.api.view(delivery.body.investigationId);
    expect(v.decisionCode).toBe("NO_ACTION_BELOW_THRESHOLD");
    // committing the same batch twice is rejected
    expect((await t.api.post(`/api/data/import/${p.body.batchId}/commit`)).status).toBe(409);
    // restore brings the previous policy back
    expect((await t.api.post(`/api/data/import/${p.body.batchId}/restore`)).status).toBe(200);
    expect((await t.api.get("/policies/SYN-STORE-104/rush-control")).body.p95_threshold_minutes).toBe(28);
  });

  it("CSV merge for one entity changes simulator state the workflow then reads", async () => {
    const p = await upload(SAMPLE_CAMPAIGNS_CSV, "campaigns.csv", "merge", "campaigns");
    expect(p.body.ok).toBe(true);
    expect(p.body.changes[0]).toMatchObject({ sheet: "campaigns", key: "cmp-syn-4081", change: "updated", detail: "version 12 → 13" });
    await t.api.post(`/api/data/import/${p.body.batchId}/commit`);
    const camp = await t.api.campaign();
    expect(camp.permissions).toEqual(["READ"]);
    expect(camp.version).toBe(13);
    const { delivery } = await t.api.emit();
    expect((await t.api.view(delivery.body.investigationId)).decisionCode).toBe("BLOCKED_MISSING_PERMISSION");
  });

  it.each([
    ["invalid/missing-sheet.xlsx", "campaigns", "Required sheet is missing"],
    ["invalid/wrong-types.xlsx", "kitchen_snapshots", "not a non-negative whole number"],
    ["invalid/duplicate-ids.xlsx", "campaigns", "Duplicate key"],
    ["invalid/orphan-reference.xlsx", "campaign_reports", "Unknown campaign"],
    ["invalid/invalid-status.xlsx", "campaigns", "is not allowed"],
    ["invalid/formula-cell.xlsx", "campaigns", "formula cells are not accepted"],
    ["invalid/excel-date-cell.xlsx", "kitchen_snapshots", "Excel date cell"],
    ["invalid/stale-revision.xlsx", "campaigns", "Stale revision"],
  ])("%s is rejected with a row-level error and cannot be committed", async (name, sheet, msg) => {
    const p = await upload(fx[name]!.buf, name.split("/")[1]!, "replace");
    expect(p.status).toBe(200);
    expect(p.body.ok).toBe(false);
    const err = p.body.errors.find((e: any) => e.sheet === sheet && e.message.includes(msg));
    expect(err, JSON.stringify(p.body.errors.slice(0, 3))).toBeTruthy();
    const c = await t.api.post(`/api/data/import/${p.body.batchId}/commit`);
    expect(c.status).toBe(409);
    expect((await t.api.campaign()).version).toBe(12);
  });

  it("rejects oversized, non-spreadsheet and CSV-replace uploads", async () => {
    expect((await upload(Buffer.alloc(2 * 1024 * 1024 + 10, 1), "big.xlsx", "replace")).status).toBe(413);
    expect((await upload(Buffer.from("hello"), "notes.txt", "merge")).status).toBe(415);
    expect((await upload(Buffer.from("not a zip"), "fake.xlsx", "merge")).status).toBe(415);
    expect((await upload(SAMPLE_CAMPAIGNS_CSV, "campaigns.csv", "replace", "campaigns")).status).toBe(400);
  });

  it("rejects a commit when the world changed after preview (stale revision at commit time)", async () => {
    const p = await upload(SAMPLE_CAMPAIGNS_CSV, "campaigns.csv", "merge", "campaigns");
    expect(p.body.ok).toBe(true);
    await t.api.post("/mock-ads/simulate/external-edit", { campaign_id: "cmp-syn-4081" }); // v12 → v13
    const c = await t.api.post(`/api/data/import/${p.body.batchId}/commit`);
    expect(c.status).toBe(409);
    expect(c.body.message).toContain("changed since preview");
  });

  it("record browser shows state changed by a real workflow action", async () => {
    const { delivery } = await t.api.emit();
    await t.api.approveAndPause(delivery.body.investigationId);
    const r = await t.api.get("/api/data/records/campaigns?q=4081");
    expect(r.body.rows[0]).toMatchObject({ campaign_id: "cmp-syn-4081", configured_status: "CAMPAIGN_CONFIGURED_STATUS_PAUSED", version: 13 });
  });
});
