/** First-install seed (V3 CH-22). Idempotent: an already bootstrapped database is left unchanged. Usage: npm run bootstrap */
import { loadConfig } from "../apps/api/src/config";
import { openDb } from "../apps/api/src/db/db";
import { simClock } from "../apps/api/src/clock";
import { assertWritableDataDir, bootstrap } from "../apps/api/src/ops/storage";

const cfg = loadConfig();
if (cfg.dbPath !== ":memory:") assertWritableDataDir(cfg.dbPath);
const db = openDb(cfg.dbPath);
const r = bootstrap(db, simClock(db), cfg.adsToken);
db.close();
console.log(r.created ? `Bootstrapped ${cfg.dbPath} with scenario ${r.scenario}.` : `${cfg.dbPath} is already bootstrapped (scenario ${r.scenario}). Nothing changed.`);
