/**
 * Builds the sample workbook and the valid/invalid import fixtures.
 * Used by `npm run template` (writes files) and by the import tests (in memory).
 */
import ExcelJS from "exceljs";
import { seedDataset, Dataset } from "../packages/fixtures/src/seed";
import { buildWorkbook } from "../apps/api/src/imports/xlsx";

type Mutator = (wb: ExcelJS.Workbook) => void;

async function variant(ds: Dataset, mutate?: Mutator, readme = true): Promise<Buffer> {
  const base = await buildWorkbook(ds, { title: "MarginPulse simulator workbook (sample)", includeReadme: readme });
  if (!mutate) return base;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(base as unknown as ArrayBuffer);
  mutate(wb);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const cellOf = (wb: ExcelJS.Workbook, sheet: string, column: string, row: number) => {
  const ws = wb.getWorksheet(sheet)!;
  const header = ws.getRow(1).values as unknown[];
  const col = header.indexOf(column);
  if (col < 1) throw new Error(`no column ${column}`);
  return ws.getRow(row).getCell(col);
};

export async function fixtures(): Promise<Record<string, { buf: Buffer; description: string; valid: boolean; mode: "replace" | "merge" }>> {
  const tighter = seedDataset();
  tighter.merchant_policies[0]!.p95_threshold_minutes = 40;
  const mergeOnlyPolicies = { ...seedDataset() };
  return {
    "marginpulse-sample-workbook.xlsx": { buf: await variant(seedDataset()), description: "Canonical sample: every sheet, scenario A data. Re-importing it unchanged is a no-op.", valid: true, mode: "replace" },
    "valid/merge-threshold-40.xlsx": {
      buf: await variant(tighter, (wb) => { for (const n of wb.worksheets.map((w) => w.name)) if (n !== "merchant_policies") wb.removeWorksheet(wb.getWorksheet(n)!.id); }, false),
      description: "Merge mode: only merchant_policies, with the Downtown limit raised to 40 min. After commit, the scenario-A rush becomes NO_ACTION.", valid: true, mode: "merge",
    },
    "invalid/missing-sheet.xlsx": { buf: await variant(mergeOnlyPolicies, (wb) => wb.removeWorksheet(wb.getWorksheet("campaigns")!.id)), description: "Replace mode without the campaigns sheet.", valid: false, mode: "replace" },
    "invalid/wrong-types.xlsx": { buf: await variant(seedDataset(), (wb) => { cellOf(wb, "kitchen_snapshots", "active_tickets", 2).value = "lots"; cellOf(wb, "cost_profiles", "avg_food_packaging_cost_usd", 2).value = 11.405; }), description: "Text in an integer column and a 3-decimal dollar amount.", valid: false, mode: "replace" },
    "invalid/duplicate-ids.xlsx": { buf: await variant(seedDataset(), (wb) => { cellOf(wb, "campaigns", "campaign_id", 3).value = "cmp-syn-4081"; }), description: "Two rows with campaign_id cmp-syn-4081.", valid: false, mode: "replace" },
    "invalid/orphan-reference.xlsx": { buf: await variant(seedDataset(), (wb) => { cellOf(wb, "campaign_reports", "campaign_id", 2).value = "cmp-does-not-exist"; }), description: "A report pointing at an unknown campaign.", valid: false, mode: "replace" },
    "invalid/invalid-status.xlsx": { buf: await variant(seedDataset(), (wb) => { cellOf(wb, "campaigns", "configured_status", 2).value = "RUNNING"; }), description: "A configured_status that is not in the allowed list.", valid: false, mode: "replace" },
    "invalid/formula-cell.xlsx": { buf: await variant(seedDataset(), (wb) => { cellOf(wb, "campaigns", "daily_budget_usd", 2).value = { formula: "20*2", result: 40 } as ExcelJS.CellFormulaValue; }), description: "A formula in daily_budget_usd (formulas are never evaluated).", valid: false, mode: "replace" },
    "invalid/excel-date-cell.xlsx": { buf: await variant(seedDataset(), (wb) => { cellOf(wb, "kitchen_snapshots", "captured_at", 2).value = new Date("2026-10-18T22:26:20Z"); }), description: "An Excel date cell instead of ISO-8601 text (timezone would be ambiguous).", valid: false, mode: "replace" },
    "invalid/stale-revision.xlsx": { buf: await variant(seedDataset(), (wb) => { cellOf(wb, "campaigns", "version", 2).value = 11; }), description: "Campaign cmp-syn-4081 at version 11 while the simulator holds 12.", valid: false, mode: "replace" },
  };
}

export const SAMPLE_CAMPAIGNS_CSV =
  "campaign_id,account_id,name,product,configured_status,store_ids,permissions,budget_unit,daily_budget_usd,version\r\n" +
  "cmp-syn-4081,SYN-AD-221,Downtown Sponsored Listing,SPONSORED_LISTING,CAMPAIGN_CONFIGURED_STATUS_ACTIVE,UE-SYN-104,READ,BUDGET_UNIT_DAILY,40,12\r\n";
