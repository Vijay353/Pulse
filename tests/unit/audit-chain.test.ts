/** CH-17: hash format 2, legacy format 1 rows, tamper and gap detection, migration. */
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDb } from "../../apps/api/src/db/db";
import { simClock } from "../../apps/api/src/clock";
import { appendAudit, canonicalV2, GENESIS, hashV1, verifyChain } from "../../apps/api/src/audit/audit";
import { chainSummary } from "../../apps/web/src/components/AuditVerify";

const fields = { seq: 1, investigationId: "inv-1", type: "T", atSim: "2026-10-18T18:31:43-04:00", atWall: "2026-10-18T22:31:43.000Z", actor: "a", payloadJson: "{}", prevHash: GENESIS };

function fresh() {
  const db = openDb(":memory:");
  const clock = simClock(db);
  for (let i = 0; i < 5; i++) appendAudit(db, clock, { investigationId: "inv-1", type: `E${i}`, actor: "x", payload: { i } });
  return db;
}

describe("canonical format 2", () => {
  it("is deterministic and length-framed", () => {
    expect(canonicalV2(fields).equals(canonicalV2({ ...fields }))).toBe(true);
    expect(canonicalV2(fields).toString("utf8")).toBe(`mp-audit/2\n1:1\n5:inv-1\n1:T\n25:2026-10-18T18:31:43-04:00\n24:2026-10-18T22:31:43.000Z\n1:a\n2:{}\n64:${GENESIS}\n`);
  });
  it("field boundaries cannot be shifted, and null differs from empty", () => {
    const a = canonicalV2({ ...fields, type: "A|B", actor: "C" });
    const b = canonicalV2({ ...fields, type: "A", actor: "B|C" });
    expect(a.equals(b)).toBe(false);
    expect(canonicalV2({ ...fields, investigationId: null }).equals(canonicalV2({ ...fields, investigationId: "" }))).toBe(false);
  });
});

describe("verifyChain", () => {
  it("a clean chain verifies, and verifying twice adds nothing", () => {
    const db = fresh();
    const r1 = verifyChain(db);
    expect(r1).toMatchObject({ ok: true, length: 5, firstSeq: 1, headSeq: 5, coverage: { format1: 0, format2: 5 }, gaps: [] });
    expect(verifyChain(db).length).toBe(5);
    expect(chainSummary(r1)).toBe("No break found in 5 entries (entries 1 to 5; 5 in hash format 2).");
  });

  it("a mid-chain edit is caught at the edited entry", () => {
    const db = fresh();
    db.exec("DROP TRIGGER mp_audit_no_update");
    db.exec("UPDATE mp_audit SET payload_json = '{\"i\":99}' WHERE seq = 3");
    expect(verifyChain(db)).toMatchObject({ ok: false, brokenAt: 3, problem: expect.stringContaining("does not match its hash") });
  });

  it("a deleted middle entry is caught", () => {
    const db = fresh();
    db.exec("DROP TRIGGER mp_audit_no_delete");
    db.exec("DELETE FROM mp_audit WHERE seq = 3");
    const r = verifyChain(db);
    expect(r.ok).toBe(false);
    expect(r.brokenAt).toBe(4);
    expect(r.gaps).toEqual([3]);
  });

  it("removal of the newest entries is not detectable without an outside record of the head (stated limit)", () => {
    const db = fresh();
    const head = verifyChain(db).head;
    db.exec("DROP TRIGGER mp_audit_no_delete");
    db.exec("DELETE FROM mp_audit WHERE seq = 5");
    const r = verifyChain(db);
    expect(r.ok).toBe(true);
    expect(r.head).not.toBe(head); // only a recorded head reveals it
    expect(r.limits).toContain("only if the head was recorded elsewhere");
  });
});

describe("migration from a pre-V3 database", () => {
  it("adds hash_version, verifies old format 1 rows, continues with format 2, and survives reopen", () => {
    const dir = mkdtempSync(join(tmpdir(), "mp-audit-"));
    const path = join(dir, "legacy.db");
    // Build the pre-V3 table exactly as it was, with two format 1 rows.
    const legacy = new DatabaseSync(path);
    legacy.exec(`CREATE TABLE mp_audit (seq INTEGER PRIMARY KEY AUTOINCREMENT, investigation_id TEXT, type TEXT NOT NULL, at_sim TEXT NOT NULL, at_wall TEXT NOT NULL, actor TEXT NOT NULL, payload_json TEXT NOT NULL, prev_hash TEXT NOT NULL, hash TEXT NOT NULL);
      CREATE TRIGGER mp_audit_no_update BEFORE UPDATE ON mp_audit BEGIN SELECT RAISE(ABORT, 'mp_audit is append-only'); END;
      CREATE TRIGGER mp_audit_no_delete BEFORE DELETE ON mp_audit BEGIN SELECT RAISE(ABORT, 'mp_audit is append-only'); END;`);
    let prev = GENESIS;
    for (let i = 0; i < 2; i++) {
      const f = { investigationId: null, type: `OLD${i}`, atSim: "2026-10-18T18:31:43-04:00", actor: "seed", payloadJson: "{}", prevHash: prev };
      const h = hashV1(f);
      legacy.prepare("INSERT INTO mp_audit(investigation_id, type, at_sim, at_wall, actor, payload_json, prev_hash, hash) VALUES(?,?,?,?,?,?,?,?)").run(null, f.type, f.atSim, "2026-10-18T22:31:43.000Z", f.actor, f.payloadJson, prev, h);
      prev = h;
    }
    legacy.close();

    const db = openDb(path);
    expect(verifyChain(db)).toMatchObject({ ok: true, length: 2, coverage: { format1: 2, format2: 0 } });
    appendAudit(db, simClock(db), { investigationId: "inv-9", type: "NEW", actor: "x", payload: {} });
    expect(verifyChain(db)).toMatchObject({ ok: true, length: 3, coverage: { format1: 2, format2: 1 }, headSeq: 3 });
    db.close();

    const reopened = openDb(path);
    const r = verifyChain(reopened);
    expect(r).toMatchObject({ ok: true, length: 3, coverage: { format1: 2, format2: 1 } });
    expect(chainSummary(r)).toBe("No break found in 3 entries (entries 1 to 3; 1 in hash format 2, 2 in the older format 1).");
  });
});
