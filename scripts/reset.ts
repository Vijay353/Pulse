/** Reset the local database to a scenario (default A). Usage: npm run reset -- [scenarioId] */
import { loadConfig } from "../apps/api/src/config";
import { openDb } from "../apps/api/src/db/db";
import { simClock } from "../apps/api/src/clock";
import { resetWorld } from "../apps/api/src/orchestration/world";

const cfg = loadConfig();
const db = openDb(cfg.dbPath);
const s = resetWorld(db, simClock(db), cfg.adsToken, process.argv[2] ?? "A");
console.log(`Reset ${cfg.dbPath} to scenario ${s.id}: ${s.title}`);
