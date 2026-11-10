/** Scenario reset: rebuild every table, seed through the import path, arm faults, set the clock. */
import { Db, kvSet, recreateSchema, run } from "../db/db";
import type { Clock } from "../clock";
import { applyDataset } from "../imports/importer";
import { seedAdsToken } from "../../../../packages/mock-uber-ads/src/plugin";
import { SCENARIOS, scenarioDataset } from "../../../../packages/fixtures/src/scenarios";
import { SCENARIO_CLOCK } from "../../../../packages/fixtures/src/seed";
import { appendAudit } from "../audit/audit";

export function resetWorld(db: Db, clock: Clock, adsToken: string, scenarioId = "A") {
  const s = SCENARIOS.find((x) => x.id === scenarioId);
  if (!s) throw new Error(`Unknown scenario ${scenarioId}`);
  recreateSchema(db);
  clock.set(SCENARIO_CLOCK);
  applyDataset(db, scenarioDataset(s), { mode: "replace", actor: "seed", nowIso: clock.nowIso(), source: "SEED" });
  seedAdsToken(db, adsToken);
  for (const f of s.faults ?? []) {
    if (f.system === "ads") run(db, "INSERT INTO ads_faults(op, mode, remaining, param) VALUES(?,?,?,?)", f.op ?? "ANY", f.mode, f.remaining ?? 1, f.param ?? null);
    else run(db, "INSERT INTO pos_faults(mode, remaining) VALUES(?,?)", f.mode, f.remaining ?? 1);
  }
  kvSet(db, "scenario", s.id);
  appendAudit(db, clock, { investigationId: null, type: "SCENARIO_LOADED", actor: "demo", payload: { scenario: s.id, title: s.title } });
  return s;
}
