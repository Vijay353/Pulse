/**
 * Mock POS / KDS — a stateful simulator of a restaurant POS partner extension.
 * The kitchen-capacity shape is a MOCKED partner extension; it is not Toast's,
 * Square's or any universal POS API (spec §3.5).
 *
 * Endpoints:
 *   POST /mock-pos/events                       emit KitchenLoadThresholdBreached from the latest snapshot, sign, deliver
 *   POST /mock-pos/events/:eventId/redeliver    webhook retry of the SAME event (duplicate-delivery test)
 *   POST /mock-pos/events/forged                deliver an event with an invalid signature (security test)
 *   GET  /mock-pos/stores/:storeId/kitchen-snapshot
 *   GET  /mock-pos/stores/:storeId/cost-profile
 *   POST/GET/DELETE /mock-pos/faults            POS_UNAVAILABLE (503)
 *   GET  /mock-pos/admin/digest                 simulator-only verification probe
 */
import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { z } from "zod";
import { all, Db, get, nextCounter, run } from "../../../apps/api/src/db/db";
import type { Clock } from "../../../apps/api/src/clock";
import { signEvent } from "../../../apps/api/src/security/signature";
import { internalFetch } from "../../../apps/api/src/security/internal";

export function registerMockPos(
  app: FastifyInstance,
  deps: { db: Db; clock: Clock; secret: string; webhookUrl: () => string },
) {
  const { db, clock, secret } = deps;

  const posDown = () => {
    const f = get(db, "SELECT * FROM pos_faults WHERE remaining > 0 AND mode = 'POS_UNAVAILABLE' ORDER BY id LIMIT 1");
    if (!f) return false;
    run(db, "UPDATE pos_faults SET remaining = remaining - 1 WHERE id = ?", f.id);
    return true;
  };

  const latestSnapshot = (storeId: string) =>
    get(db, "SELECT * FROM pos_kitchen_snapshots WHERE pos_store_id = ? ORDER BY captured_at DESC, snapshot_id DESC LIMIT 1", storeId);

  const deliver = async (eventId: string, payload: Record<string, unknown>) => {
    let status = 0;
    let body: unknown;
    try {
      const res = await internalFetch(deps.webhookUrl(), {
        method: "POST",
        headers: { "content-type": "application/json", "x-pos-delivery": eventId },
        body: JSON.stringify(payload),
      });
      status = res.status;
      body = await res.json().catch(() => null);
    } catch (e) {
      body = { error: (e as Error).message };
    }
    run(db, "UPDATE pos_outbox SET delivery_count = delivery_count + 1, last_status = ? WHERE event_id = ?", status, eventId);
    return { status, body };
  };

  app.post("/mock-pos/events", async (req, reply) => {
    const b = z.strictObject({ storeId: z.string().min(1).max(80) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "storeId required" });
    const store = get(db, "SELECT * FROM pos_stores WHERE pos_store_id = ?", b.data.storeId);
    if (!store) return reply.code(404).send({ error: "unknown POS store" });
    const snap = latestSnapshot(b.data.storeId);
    if (!snap) return reply.code(409).send({ error: "no kitchen snapshot for store" });
    // The event is emitted now; the snapshot it describes may be older (freshness is checked separately).
    const occurred = clock.nowIso();
    const hhmm = occurred.slice(11, 16).replace(":", "");
    const seq = nextCounter(db, `pos.eventSeq.${hhmm}`, 1);
    const event: Record<string, unknown> = {
      eventId: `evt-kds-${hhmm}-${String(seq).padStart(3, "0")}`,
      eventType: "KitchenLoadThresholdBreached",
      occurredAt: occurred,
      storeId: b.data.storeId,
      source: "mock-pos-kds",
      snapshotId: String(snap.snapshot_id),
      observedP95PrepMinutes: Number(snap.p95_prep_minutes),
      activeTickets: Number(snap.active_tickets),
      configuredThresholdMinutes: Number(store.alert_threshold_minutes),
    };
    event.signature = signEvent(event, secret);
    run(db, "INSERT INTO pos_outbox(event_id, pos_store_id, payload_json, created_at, delivery_count) VALUES(?,?,?,?,0)",
      event.eventId, b.data.storeId, JSON.stringify(event), clock.nowIso());
    const delivery = await deliver(String(event.eventId), event);
    return { event, delivery };
  });

  app.post<{ Params: { eventId: string } }>("/mock-pos/events/:eventId/redeliver", async (req, reply) => {
    const row = get(db, "SELECT * FROM pos_outbox WHERE event_id = ?", req.params.eventId);
    if (!row) return reply.code(404).send({ error: "unknown event" });
    const event = JSON.parse(String(row.payload_json));
    const delivery = await deliver(req.params.eventId, event);
    return { event, delivery, deliveryCount: Number(get(db, "SELECT delivery_count FROM pos_outbox WHERE event_id = ?", req.params.eventId)!.delivery_count) };
  });

  app.post("/mock-pos/events/forged", async (req, reply) => {
    const b = z.strictObject({ storeId: z.string() }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "storeId required" });
    const forged = {
      eventId: `evt-forged-${Date.now()}`,
      eventType: "KitchenLoadThresholdBreached",
      occurredAt: clock.nowIso(),
      storeId: b.data.storeId,
      source: "mock-pos-kds",
      snapshotId: "kds-snap-forged",
      observedP95PrepMinutes: 99,
      activeTickets: 99,
      configuredThresholdMinutes: 28,
      signature: "0".repeat(64),
    };
    let status = 0; let body: unknown;
    try {
      const res = await internalFetch(deps.webhookUrl(), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(forged) });
      status = res.status; body = await res.json().catch(() => null);
    } catch (e) { body = { error: (e as Error).message }; }
    return { event: forged, delivery: { status, body } };
  });

  /** Store master data. Not subject to POS_UNAVAILABLE faults, which target kitchen and cost reads only. */
  app.get<{ Params: { storeId: string } }>("/mock-pos/stores/:storeId", async (req, reply) => {
    const st = get(db, "SELECT pos_store_id, name, timezone FROM pos_stores WHERE pos_store_id = ?", req.params.storeId);
    if (!st) return reply.code(404).send({ error: "unknown POS store" });
    return { storeId: st.pos_store_id, name: st.name, timezone: st.timezone };
  });

  app.get<{ Params: { storeId: string } }>("/mock-pos/stores/:storeId/kitchen-snapshot", async (req, reply) => {
    if (posDown()) return reply.code(503).send({ error: "POS connector unavailable" });
    const snap = latestSnapshot(req.params.storeId);
    if (!snap) return reply.code(404).send({ error: "no snapshot" });
    return {
      snapshotId: snap.snapshot_id,
      storeId: snap.pos_store_id,
      capturedAt: snap.captured_at,
      p95PrepMinutes: snap.p95_prep_minutes,
      activeTickets: snap.active_tickets,
      connectorHealth: snap.connector_health,
    };
  });

  app.get<{ Params: { storeId: string } }>("/mock-pos/stores/:storeId/cost-profile", async (req, reply) => {
    if (posDown()) return reply.code(503).send({ error: "POS connector unavailable" });
    const c = get(db, "SELECT * FROM pos_cost_profiles WHERE pos_store_id = ?", req.params.storeId);
    if (!c) return reply.code(404).send({ error: "no cost profile" });
    return {
      storeId: c.pos_store_id,
      avgFoodPackagingCostCents: c.avg_food_packaging_cost_cents,
      marketplaceFeeRateBps: c.marketplace_fee_rate_bps,
      updatedAt: c.updated_at,
    };
  });

  app.post("/mock-pos/faults", async (req, reply) => {
    const b = z.strictObject({ mode: z.literal("POS_UNAVAILABLE"), remaining: z.number().int().min(1).max(100).default(1) }).safeParse(req.body);
    if (!b.success) return reply.code(400).send({ error: "mode must be POS_UNAVAILABLE" });
    run(db, "INSERT INTO pos_faults(mode, remaining) VALUES(?,?)", b.data.mode, b.data.remaining);
    return { armed: all(db, "SELECT * FROM pos_faults WHERE remaining > 0") };
  });
  app.get("/mock-pos/faults", async () => ({ armed: all(db, "SELECT * FROM pos_faults WHERE remaining > 0") }));
  app.delete("/mock-pos/faults", async () => { run(db, "DELETE FROM pos_faults"); return { armed: [] }; });
  app.get<{ Querystring: { order?: string; limit?: string } }>("/mock-pos/outbox", async (req) => {
    if (req.query.order === "desc") {
      const limit = Math.min(Math.max(Number(req.query.limit ?? 10) || 10, 1), 1000);
      return { outbox: all(db, "SELECT event_id, pos_store_id, created_at, delivery_count, last_status FROM pos_outbox ORDER BY rowid DESC LIMIT ?", limit) };
    }
    return { outbox: all(db, "SELECT event_id, pos_store_id, created_at, delivery_count, last_status FROM pos_outbox ORDER BY created_at, event_id") };
  });

  app.get("/mock-pos/admin/digest", async () => {
    const parts = [
      all(db, "SELECT * FROM pos_stores ORDER BY pos_store_id"),
      all(db, "SELECT * FROM pos_kitchen_snapshots ORDER BY snapshot_id"),
      all(db, "SELECT pos_store_id, avg_food_packaging_cost_cents, marketplace_fee_rate_bps FROM pos_cost_profiles ORDER BY pos_store_id"),
    ];
    return { digest: createHash("sha256").update(JSON.stringify(parts)).digest("hex") };
  });
}
