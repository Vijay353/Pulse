/** CH-22A: production start-up is fail-closed, never reseeds, persists across restarts, and backups restore. */
import { mkdtempSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { boot } from "../helpers";
import { buildApp } from "../../apps/api/src/server";
import { openDb } from "../../apps/api/src/db/db";
import { simClock } from "../../apps/api/src/clock";
import { backupTo, bootstrap } from "../../apps/api/src/ops/storage";
import { verifyChain } from "../../apps/api/src/audit/audit";

const dir = mkdtempSync(join(tmpdir(), "mp-prod-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const SECRET = "test-webhook-secret-0123456789abcdef";
const TOKEN = "test-ads-token-0123456789abcdefghij";
const GATE = { ACCESS_PIN: "7391", SESSION_SECRET: "test-session-secret-0123456789abcdefghij" }; // test-only values
const prodEnv = (dbPath: string): NodeJS.ProcessEnv => ({ NODE_ENV: "production", DATABASE_PATH: dbPath, POS_WEBHOOK_SECRET: SECRET, UBER_ADS_TOKEN: TOKEN, ...GATE });
const bootProd = (dbPath: string) => boot({ dbPath }, { env: prodEnv(dbPath) });

function countRows(path: string) {
  const db = openDb(path);
  const n = (t: string) => Number((db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n);
  const r = { audit: n("mp_audit"), investigations: n("mp_investigations"), ledger: n("ads_mutation_ledger"), mutations: n("mp_mutations"), chainOk: verifyChain(db).ok };
  db.close();
  return r;
}

describe("production start-up", () => {
  it("refuses development placeholder secrets and names only the variables", () => {
    const run = () => buildApp({ env: { NODE_ENV: "production", DATABASE_PATH: join(dir, "x.db"), POS_WEBHOOK_SECRET: "replace-with-long-random-secret", ...GATE }, config: { serveWeb: false } });
    expect(run).toThrow(/POS_WEBHOOK_SECRET must be set/);
    expect(run).toThrow(/UBER_ADS_TOKEN must be set/);
    expect(run).not.toThrow(/replace-with-long-random-secret/);
  });

  it("fails closed when the data directory cannot be written", () => {
    const file = join(dir, "not-a-dir");
    writeFileSync(file, "");
    const p = join(file, "sub", "mp.db");
    expect(() => buildApp({ env: prodEnv(p), config: { serveWeb: false } })).toThrow(/data directory .* is not writable/);
  });

  it("does not seed an empty database on start; bootstrap is explicit and idempotent", () => {
    const p = join(dir, "fresh.db");
    expect(() => buildApp({ env: prodEnv(p), config: { serveWeb: false } })).toThrow(/has not been bootstrapped/);
    const db = openDb(p);
    expect(bootstrap(db, simClock(db), TOKEN)).toEqual({ created: true, scenario: "A" });
    const before = Number((db.prepare("SELECT COUNT(*) AS n FROM mp_audit").get() as { n: number }).n);
    expect(bootstrap(db, simClock(db), TOKEN)).toEqual({ created: false, scenario: "A" });
    expect(Number((db.prepare("SELECT COUNT(*) AS n FROM mp_audit").get() as { n: number }).n)).toBe(before);
    db.close();
  });

  it("state survives a restart with no reseed and no duplicate writes; /healthz is read-only", async () => {
    const p = join(dir, "persist.db");
    const db = openDb(p); bootstrap(db, simClock(db), TOKEN); db.close();

    const t1 = await bootProd(p);
    expect(await (await fetch(`${t1.base}/healthz`)).json()).toEqual({ ok: true });
    const { delivery } = await t1.api.emit();
    const id = delivery.body.investigationId;
    await t1.api.approveAndPause(id);
    expect((await t1.api.view(id)).status).toBe("PAUSE_VERIFIED");
    await t1.close(); t1.db.close();
    const after1 = countRows(p);
    expect(after1).toMatchObject({ investigations: 1, ledger: 1, mutations: 1, chainOk: true });

    const t2 = await bootProd(p);
    const v = await t2.api.view(id);
    expect(v.status).toBe("PAUSE_VERIFIED");
    expect((await t2.api.campaign()).configured_status).toBe("CAMPAIGN_CONFIGURED_STATUS_PAUSED");
    await fetch(`${t2.base}/healthz`);
    await t2.close(); t2.db.close();
    expect(countRows(p)).toEqual(after1);
  });

  it("backup is consistent, refuses to overwrite, and a restored copy serves the same records", async () => {
    const p = join(dir, "persist.db");
    const db = openDb(p);
    const dest = join(dir, "backups", "b1.db");
    const r = backupTo(db, dest);
    expect(r).toMatchObject({ integrity: "ok", chainOk: true, matchesSource: true });
    expect(() => backupTo(db, dest)).toThrow(/already exists/);
    db.close();

    const restored = join(dir, "restored", "mp.db");
    rmSync(join(dir, "restored"), { recursive: true, force: true });
    openDb(restored).close();
    copyFileSync(dest, restored);
    expect(countRows(restored)).toEqual(countRows(p));
    const t = await bootProd(restored);
    const list = (await t.api.get("/api/investigations")).body;
    const first = (list.investigations ?? list)[0];
    expect((await t.api.view(first.id)).status).toBe("PAUSE_VERIFIED");
    await t.close(); t.db.close();
  });

  it("development behaviour is unchanged: an empty database is seeded automatically", async () => {
    const t = await boot({ dbPath: join(dir, "dev.db") });
    expect((await t.api.get("/api/health")).body.scenario).toBe("A");
    await t.close(); t.db.close();
  });
});
