import type { FastifyInstance } from "fastify";
import { all, Db } from "../db/db";
import type { Clock } from "../clock";
import { ENTITY_NAMES, IMPORT_LIMITS, ImportMode, SHEETS, WORKBOOK_SCHEMA_VERSION } from "../imports/schema";
import { commitBatch, createPreviewBatch, datasetFromDb, RawWorkbook, restoreBatch, validateWorkbook } from "../imports/importer";
import { buildTemplate, buildWorkbook, parseCsv, parseXlsx, toCsv } from "../imports/xlsx";
import { enforceRateLimit, requireCsrf, resolveActor, sendError } from "./api";
import { createRateLimiter, RateLimiter } from "../security/rateLimit";
import { appendAudit } from "../audit/audit";
import { HttpError } from "../orchestration/orchestrator";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export function registerDataRoutes(app: FastifyInstance, d: { db: Db; clock: Clock; limiter?: RateLimiter }) {
  const { db, clock } = d;
  const limiter = d.limiter ?? createRateLimiter({ limit: 0 });

  app.addContentTypeParser(["application/octet-stream", XLSX_TYPE, "text/csv"], { parseAs: "buffer", bodyLimit: IMPORT_LIMITS.maxBytes }, (_req, body, done) => done(null, body));

  app.get("/api/data/schema", async () => ({ version: WORKBOOK_SCHEMA_VERSION, limits: IMPORT_LIMITS, sheets: SHEETS }));

  app.get("/api/data/template.xlsx", async (_req, reply) => {
    reply.header("content-disposition", 'attachment; filename="marginpulse-sample-workbook.xlsx"');
    return reply.type(XLSX_TYPE).send(await buildTemplate());
  });

  app.get("/api/data/export.xlsx", async (_req, reply) => {
    const buf = await buildWorkbook(datasetFromDb(db), { title: `MarginPulse simulator snapshot at ${clock.nowIso()}`, includeReadme: true });
    reply.header("content-disposition", 'attachment; filename="marginpulse-snapshot.xlsx"');
    return reply.type(XLSX_TYPE).send(buf);
  });

  app.get<{ Params: { entity: string } }>("/api/data/export/:entity.csv", async (req, reply) => {
    if (!(ENTITY_NAMES as readonly string[]).includes(req.params.entity)) return reply.code(404).send({ error: "UNKNOWN_ENTITY" });
    reply.header("content-disposition", `attachment; filename="${req.params.entity}.csv"`);
    return reply.type("text/csv; charset=utf-8").send(toCsv(datasetFromDb(db), req.params.entity));
  });

  app.get<{ Params: { entity: string }; Querystring: { q?: string } }>("/api/data/records/:entity", async (req, reply) => {
    if (!(ENTITY_NAMES as readonly string[]).includes(req.params.entity)) return reply.code(404).send({ error: "UNKNOWN_ENTITY" });
    const rows = (datasetFromDb(db) as unknown as Record<string, Record<string, unknown>[]>)[req.params.entity] ?? [];
    const q = (req.query.q ?? "").toLowerCase().slice(0, 80);
    const filtered = q ? rows.filter((r) => JSON.stringify(r).toLowerCase().includes(q)) : rows;
    return { entity: req.params.entity, total: rows.length, rows: filtered.slice(0, 200) };
  });

  app.get("/api/data/imports", async () => ({
    imports: all(db, "SELECT batch_id, filename, mode, status, actor, created_at, committed_at, summary_json FROM mp_import_batches ORDER BY rowid DESC LIMIT 20")
      .map((b) => ({ ...b, summary: JSON.parse(String(b.summary_json)), summary_json: undefined })),
  }));

  app.post<{ Querystring: { mode?: string; filename?: string; entity?: string } }>("/api/data/import/preview", async (req, reply) => {
    try {
      requireCsrf(req);
      const actor = resolveActor(db, req);
      enforceRateLimit(limiter, reply, `${actor.userId}|${req.ip}`);
      const body = req.body as Buffer;
      if (!Buffer.isBuffer(body) || body.length === 0) throw new HttpError(400, "EMPTY_FILE", "Upload an .xlsx or .csv file");
      if (body.length > IMPORT_LIMITS.maxBytes) throw new HttpError(413, "TOO_LARGE", "File exceeds the size limit");
      const filename = String(req.query.filename ?? "upload").slice(0, 120);
      const mode = ImportMode.safeParse(req.query.mode ?? "merge");
      if (!mode.success) throw new HttpError(400, "BAD_MODE", "mode must be replace or merge");
      let raw: RawWorkbook;
      if (/\.csv$/i.test(filename)) {
        const entity = String(req.query.entity ?? "");
        if (!(ENTITY_NAMES as readonly string[]).includes(entity)) throw new HttpError(400, "ENTITY_REQUIRED", "Choose which sheet this CSV contains");
        if (mode.data !== "merge") throw new HttpError(400, "CSV_MERGE_ONLY", "A CSV holds one sheet, so it can only be merged");
        raw = { [entity]: parseCsv(body.toString("utf8")) };
      } else if (/\.xlsx$/i.test(filename) && body.subarray(0, 2).toString("latin1") === "PK") {
        try { raw = await parseXlsx(body); } catch (e) { throw new HttpError(400, "UNREADABLE", `Could not read workbook: ${(e as Error).message}`); }
      } else throw new HttpError(415, "UNSUPPORTED_TYPE", "Only .xlsx and .csv files are accepted");
      const result = validateWorkbook(raw, mode.data, db);
      const batchId = createPreviewBatch(db, { filename, content: body, mode: mode.data, actor: actor.userId, result, clock });
      appendAudit(db, clock, { investigationId: null, type: "IMPORT_PREVIEWED", actor: actor.userId, payload: { batchId, filename, ok: result.ok, errors: result.errors.length } });
      return { batchId, mode: mode.data, ok: result.ok, errors: result.errors.slice(0, 200), errorCount: result.errors.length, warnings: result.warnings, summary: result.summary, changes: result.changes.slice(0, 200) };
    } catch (e) {
      return sendError(reply, e);
    }
  });

  app.post<{ Params: { batchId: string } }>("/api/data/import/:batchId/commit", async (req, reply) => {
    try {
      requireCsrf(req);
      const actor = resolveActor(db, req);
      enforceRateLimit(limiter, reply, `${actor.userId}|${req.ip}`);
      const r = commitBatch(db, req.params.batchId, actor.userId, clock);
      if (!r.ok) return reply.code(r.status).send({ error: "COMMIT_REJECTED", message: r.message, errors: "errors" in r ? r.errors : undefined });
      appendAudit(db, clock, { investigationId: null, type: "IMPORT_COMMITTED", actor: actor.userId, payload: { batchId: req.params.batchId, counts: r.counts } });
      return r;
    } catch (e) {
      return sendError(reply, e);
    }
  });

  app.post<{ Params: { batchId: string } }>("/api/data/import/:batchId/restore", async (req, reply) => {
    try {
      requireCsrf(req);
      const actor = resolveActor(db, req);
      enforceRateLimit(limiter, reply, `${actor.userId}|${req.ip}`);
      const r = restoreBatch(db, req.params.batchId, actor.userId, clock);
      if (!r.ok) return reply.code(r.status).send({ error: "RESTORE_REJECTED", message: r.message });
      appendAudit(db, clock, { investigationId: null, type: "IMPORT_RESTORED", actor: actor.userId, payload: { batchId: req.params.batchId } });
      return r;
    } catch (e) {
      return sendError(reply, e);
    }
  });
}
