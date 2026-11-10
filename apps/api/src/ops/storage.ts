/**
 * V3 CH-22: persistence operations for a single-instance deployment.
 * - assertWritableDataDir: fail closed with a clear message if the data directory cannot be written.
 * - bootstrap: explicit, idempotent first-install seed. Never resets an existing database.
 * - backupTo: SQLite-consistent copy (VACUUM INTO), then checks the copy on its own.
 */
import { accessSync, constants, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Db, get, kvGet } from "../db/db";
import type { Clock } from "../clock";
import { resetWorld } from "../orchestration/world";
import { verifyChain } from "../audit/audit";

export function assertWritableDataDir(dbPath: string): void {
  const dir = dirname(dbPath);
  try {
    mkdirSync(dir, { recursive: true });
    accessSync(dir, constants.W_OK);
    const probe = join(dir, `.mp-write-probe-${process.pid}`);
    writeFileSync(probe, "");
    rmSync(probe);
  } catch (e) {
    throw new Error(`Refusing to start: the data directory ${dir} is not writable (${(e as NodeJS.ErrnoException).code ?? "error"}). Mount a persistent volume there owned by the app user.`, { cause: e });
  }
}

export const isBootstrapped = (db: Db) => !!kvGet(db, "scenario");

/** Seeds scenario A only when the database has never been seeded. Safe to run again: it changes nothing. */
export function bootstrap(db: Db, clock: Clock, adsToken: string): { created: boolean; scenario: string } {
  if (isBootstrapped(db)) return { created: false, scenario: String(kvGet(db, "scenario")) };
  const s = resetWorld(db, clock, adsToken, "A");
  return { created: true, scenario: s.id };
}

const COUNTED = ["mp_audit", "mp_investigations", "mp_approvals", "mp_mutations", "ads_mutation_ledger", "ads_campaigns"] as const;
const counts = (db: DatabaseSync) => Object.fromEntries(COUNTED.map((t) => [t, Number(get(db, `SELECT COUNT(*) AS n FROM ${t}`)?.n ?? 0)]));

export interface BackupReport { path: string; integrity: string; chainOk: boolean; chainHead: string; counts: Record<string, number>; matchesSource: boolean }

/** Writes a consistent copy to `dest` (must not exist), then reopens the copy read-only and compares it with the source. */
export function backupTo(db: Db, dest: string): BackupReport {
  if (existsSync(dest)) throw new Error(`Backup target already exists: ${dest}`);
  mkdirSync(dirname(dest), { recursive: true });
  const before = counts(db);
  const headBefore = verifyChain(db).head;
  db.prepare("VACUUM INTO ?").run(dest);
  const copy = new DatabaseSync(dest, { readOnly: true });
  try {
    const integrity = String((copy.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check);
    const chain = verifyChain(copy);
    const c = counts(copy);
    return { path: dest, integrity, chainOk: chain.ok, chainHead: chain.head, counts: c, matchesSource: integrity === "ok" && chain.ok && chain.head === headBefore && JSON.stringify(c) === JSON.stringify(before) };
  } finally {
    copy.close();
  }
}
