/**
 * Spreadsheet IO. Values only: formulas, hyperlinks, rich objects and Excel
 * date cells are rejected cell-by-cell; macros/embedded content are never
 * executed (ExcelJS only reads cell XML). Exports neutralize formula injection.
 */
import ExcelJS from "exceljs";
import type { Dataset } from "../../../../packages/fixtures/src/seed";
import { seedDataset } from "../../../../packages/fixtures/src/seed";
import { SHEETS, WORKBOOK_SCHEMA_VERSION, IMPORT_LIMITS } from "./schema";
import type { RawSheet, RawWorkbook } from "./importer";

type Cell = string | number | boolean | null | { unsupported: string };

function cellValue(v: ExcelJS.CellValue): Cell {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (v instanceof Date) return { unsupported: "Excel date cell: enter timestamps as TEXT in ISO-8601 with offset" };
  if (typeof v === "object") {
    if ("formula" in v || "sharedFormula" in v) return { unsupported: "formula cells are not accepted; paste values only" };
    if ("hyperlink" in v) return { unsupported: "hyperlinks are not accepted" };
    if ("richText" in v) return (v.richText as { text: string }[]).map((t) => t.text).join("");
    if ("error" in v) return { unsupported: `cell error ${String((v as { error: unknown }).error)}` };
  }
  return { unsupported: "unsupported cell content" };
}

export async function parseXlsx(buf: Buffer): Promise<RawWorkbook> {
  if (buf.length > IMPORT_LIMITS.maxBytes) throw new Error(`File is larger than ${IMPORT_LIMITS.maxBytes / 1024 / 1024} MB`);
  const wb = new ExcelJS.Workbook();
  // ExcelJS types predate Node's generic Buffer; the runtime accepts it.
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const out: RawWorkbook = {};
  wb.eachSheet((ws) => {
    if (ws.rowCount > IMPORT_LIMITS.maxRowsPerSheet + 1) {
      out[ws.name] = { headers: [], rows: new Array(ws.rowCount) };
      return;
    }
    const width = Math.min(ws.columnCount, IMPORT_LIMITS.maxColumns + 1);
    const read = (rowNo: number) => {
      const row = ws.getRow(rowNo);
      const cells: Cell[] = [];
      for (let c = 1; c <= width; c++) cells.push(cellValue(row.getCell(c).value));
      return cells;
    };
    const headers = read(1).map((h) => (h === null || typeof h === "object" ? "" : String(h)));
    while (headers.length && headers[headers.length - 1] === "") headers.pop();
    const rows: unknown[][] = [];
    for (let r = 2; r <= ws.rowCount; r++) rows.push(read(r).slice(0, Math.max(headers.length, 1)));
    while (rows.length && rows[rows.length - 1]!.every((c) => c === null || c === "")) rows.pop();
    out[ws.name] = { headers: ws.columnCount > IMPORT_LIMITS.maxColumns ? new Array(ws.columnCount).fill("x") : headers, rows };
  });
  return out;
}

/** RFC-4180-ish CSV parser (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text: string): RawSheet {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') q = false;
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const [headers = [], ...body] = rows.filter((r) => !(r.length === 1 && r[0] === ""));
  return { headers: headers.map((h) => h.replace(/^\uFEFF/, "")), rows: body.map((r) => r.map((c) => (c === "" ? null : c))) };
}

/* ---------------- export ---------------- */

/** Neutralize spreadsheet formula injection: prefix risky leading characters with an apostrophe. */
export function safeCell(v: unknown): string | number | boolean | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "number" || typeof v === "boolean") return v;
  const s = String(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

export async function buildWorkbook(ds: Dataset, opts: { title: string; includeReadme: boolean }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "MarginPulse (synthetic demo)";
  if (opts.includeReadme) {
    const rd = wb.addWorksheet("README");
    rd.columns = [{ width: 22 }, { width: 28 }, { width: 12 }, { width: 10 }, { width: 14 }, { width: 70 }];
    rd.addRow([opts.title]).font = { bold: true, size: 14 };
    rd.addRow([`Schema: ${WORKBOOK_SCHEMA_VERSION}. All records are SYNTHETIC.`]);
    rd.addRow(["Rules: timestamps are TEXT in ISO-8601 with an explicit offset; money in dollars (≤ 2 decimals); lists are semicolon-separated; formulas, hyperlinks and Excel date cells are rejected."]);
    rd.addRow(["Modes: replace = workbook becomes the whole simulator dataset (every sheet required); merge = rows are upserted by key. Approvals, events, tokens and audit are system-managed and never imported."]);
    rd.addRow([`Limits: ${IMPORT_LIMITS.maxBytes / 1024 / 1024} MB, ${IMPORT_LIMITS.maxRowsPerSheet} rows per sheet, ${IMPORT_LIMITS.maxColumns} columns.`]);
    rd.addRow([]);
    rd.addRow(["sheet", "column", "type", "required", "editable", "description"]).font = { bold: true };
    for (const s of SHEETS) {
      rd.addRow([s.sheet, `(key: ${s.key.join(" + ")})`, "", "", s.owner, s.description]).font = { italic: true };
      for (const c of s.columns)
        rd.addRow([s.sheet, c.name, c.type, c.required ? (c.nullable ? "column; blank allowed" : "yes") : "no", c.systemManaged ? "system" : "yes", c.description + (c.allowed ? ` Allowed: ${c.allowed.join(", ")}` : "")]);
    }
  }
  for (const s of SHEETS) {
    const ws = wb.addWorksheet(s.sheet);
    ws.columns = s.columns.map((c) => ({ header: c.name, key: c.name, width: Math.max(14, c.name.length + 4), style: c.type === "instant" || c.type === "id" || c.type === "list" ? { numFmt: "@" } : {} }));
    ws.getRow(1).font = { bold: true };
    for (const r of (ds as unknown as Record<string, Record<string, unknown>[]>)[s.sheet] ?? []) {
      ws.addRow(s.columns.map((c) => {
        const v = r[c.name];
        if (c.type === "bool") return v === null || v === undefined ? null : v ? "TRUE" : "FALSE";
        return safeCell(v);
      }));
    }
    ws.views = [{ state: "frozen", ySplit: 1 }];
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export const buildTemplate = () => buildWorkbook(seedDataset(), { title: "MarginPulse simulator workbook (sample)", includeReadme: true });

export function toCsv(ds: Dataset, entity: string): string {
  const s = SHEETS.find((x) => x.sheet === entity);
  if (!s) throw new Error("unknown entity");
  const esc = (v: unknown) => {
    const c = safeCell(typeof v === "boolean" ? (v ? "TRUE" : "FALSE") : v);
    if (c === null) return "";
    const t = String(c);
    return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const rows = (ds as unknown as Record<string, Record<string, unknown>[]>)[entity] ?? [];
  return [s.columns.map((c) => c.name).join(","), ...rows.map((r) => s.columns.map((c) => esc(r[c.name])).join(","))].join("\r\n") + "\r\n";
}
