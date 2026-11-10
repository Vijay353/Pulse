/**
 * Consistent SQLite backup (V3 CH-22) using VACUUM INTO, then a check of the copy.
 * Usage: npm run backup -- [target-file]   (default: <data dir>/backups/marginpulse-<UTC time>.db)
 * Exits 1 if the copy does not verify. Copy the result off the host; a mount is not a backup.
 */
import { dirname, join } from "node:path";
import { loadConfig } from "../apps/api/src/config";
import { openDb } from "../apps/api/src/db/db";
import { backupTo } from "../apps/api/src/ops/storage";

const cfg = loadConfig();
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const dest = process.argv[2] ?? join(dirname(cfg.dbPath), "backups", `marginpulse-${stamp}.db`);
const db = openDb(cfg.dbPath);
const r = backupTo(db, dest);
db.close();
console.log(JSON.stringify(r, null, 2));
if (!r.matchesSource) { console.error("Backup did not verify against the source."); process.exit(1); }
