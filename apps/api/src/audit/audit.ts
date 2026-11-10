/**
 * Append-only, hash-chained audit log.
 *
 * - UPDATE and DELETE on mp_audit are rejected by SQLite triggers.
 * - Each row stores the previous row's hash, so verifyChain() can recompute
 *   the whole chain in sequence order.
 * - Hash format 2 (V3 CH-17), used for every new row: SHA-256 over a
 *   version-tagged, length-framed encoding of seq, investigation id (null
 *   kept distinct from empty), type, scenario time, wall time, actor,
 *   payload and the previous hash. Format 1 rows (written before V3, where
 *   hash_version is NULL) are still verified with the original format.
 *
 * Limits, stated plainly: this is tamper-evident against edits made without
 * recomputing the chain. Anyone with write access to the database file can
 * recompute every hash. It is not signed, not anchored outside this
 * database, and cannot show that the newest rows were not removed unless the
 * reported head is recorded somewhere else.
 */
import { createHash } from "node:crypto";
import { all, Db, get, run } from "../db/db";
import type { Clock } from "../clock";

export const GENESIS = "0".repeat(64);
export const HASH_VERSION = 2;
const sha = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");

export interface AuditFields {
  seq: number;
  investigationId: string | null;
  type: string;
  atSim: string;
  atWall: string;
  actor: string;
  payloadJson: string;
  prevHash: string;
}

/** Format 2 canonical bytes: "mp-audit/2\n" then each field as <byte length>:<value>\n; null is "-1:". */
export function canonicalV2(f: AuditFields): Buffer {
  const field = (v: string | null) => (v === null ? "-1:\n" : `${Buffer.byteLength(v, "utf8")}:${v}\n`);
  return Buffer.from(
    "mp-audit/2\n" + [String(f.seq), f.investigationId, f.type, f.atSim, f.atWall, f.actor, f.payloadJson, f.prevHash].map(field).join(""),
    "utf8",
  );
}
export const hashV2 = (f: AuditFields) => sha(canonicalV2(f));
/** Format 1 (pre-V3), kept only to verify older rows. */
export const hashV1 = (f: Omit<AuditFields, "seq" | "atWall">) =>
  sha([f.prevHash, f.investigationId ?? "", f.type, f.atSim, f.actor, f.payloadJson].join("|"));

export function appendAudit(db: Db, clock: Clock, e: { investigationId: string | null; type: string; actor: string; payload: unknown }) {
  // SAVEPOINT nests safely inside or outside an open transaction.
  db.exec("SAVEPOINT mp_audit_append");
  try {
    const last = get(db, "SELECT seq, hash FROM mp_audit ORDER BY seq DESC LIMIT 1");
    const f: AuditFields = {
      seq: last ? Number(last.seq) + 1 : 1,
      investigationId: e.investigationId,
      type: e.type,
      atSim: clock.nowIso(),
      atWall: new Date().toISOString(),
      actor: e.actor,
      payloadJson: JSON.stringify(e.payload ?? {}),
      prevHash: last ? String(last.hash) : GENESIS,
    };
    const hash = hashV2(f);
    run(db, "INSERT INTO mp_audit(seq, investigation_id, type, at_sim, at_wall, actor, payload_json, prev_hash, hash, hash_version) VALUES(?,?,?,?,?,?,?,?,?,?)",
      f.seq, f.investigationId, f.type, f.atSim, f.atWall, f.actor, f.payloadJson, f.prevHash, hash, HASH_VERSION);
    db.exec("RELEASE mp_audit_append");
    return hash;
  } catch (err) {
    db.exec("ROLLBACK TO mp_audit_append");
    db.exec("RELEASE mp_audit_append");
    throw err;
  }
}

export function auditFor(db: Db, investigationId: string) {
  return all(db, "SELECT seq, type, at_sim, at_wall, actor, payload_json, hash FROM mp_audit WHERE investigation_id = ? ORDER BY seq", investigationId).map((r) => ({
    seq: Number(r.seq), type: String(r.type), atSim: String(r.at_sim), atWall: String(r.at_wall), actor: String(r.actor),
    payload: JSON.parse(String(r.payload_json)), hash: String(r.hash),
  }));
}

export interface ChainReport {
  ok: boolean;
  length: number;
  brokenAt: number | null;
  problem: string | null;
  head: string;
  headSeq: number | null;
  firstSeq: number | null;
  coverage: { format1: number; format2: number };
  gaps: number[];
  limits: string;
}

export const CHAIN_LIMITS =
  "Tamper-evident only against edits made without recomputing the chain. Anyone with write access to the database can recompute it. Not signed and not anchored outside this database; removal of the newest rows is detectable only if the head was recorded elsewhere.";

export function verifyChain(db: Db): ChainReport {
  const rows = all(db, "SELECT * FROM mp_audit ORDER BY seq");
  let prev = GENESIS;
  let expectedSeq: number | null = null;
  const coverage = { format1: 0, format2: 0 };
  const gaps: number[] = [];
  const base = { length: rows.length, firstSeq: rows.length ? Number(rows[0]!.seq) : null, limits: CHAIN_LIMITS };
  for (const r of rows) {
    const seq = Number(r.seq);
    if (expectedSeq !== null && seq !== expectedSeq) for (let s = expectedSeq; s < seq; s++) gaps.push(s);
    expectedSeq = seq + 1;
    const version = r.hash_version === null || r.hash_version === undefined ? 1 : Number(r.hash_version);
    const f = {
      seq, investigationId: (r.investigation_id as string | null) ?? null, type: String(r.type), atSim: String(r.at_sim),
      atWall: String(r.at_wall), actor: String(r.actor), payloadJson: String(r.payload_json), prevHash: String(r.prev_hash),
    };
    const expected = version === 2 ? hashV2(f) : version === 1 ? hashV1(f) : null;
    if (version === 2) coverage.format2++; else coverage.format1++;
    const problem =
      expected === null ? `unknown hash format ${version}`
        : r.prev_hash !== prev ? "link to the previous entry does not match (an entry was changed, removed or inserted before this one)"
          : r.hash !== expected ? "entry content does not match its hash (the entry was changed)"
            : null;
    if (problem) return { ok: false, brokenAt: seq, problem, head: prev, headSeq: seq - 1, coverage, gaps, ...base };
    prev = String(r.hash);
  }
  if (gaps.length) return { ok: false, brokenAt: gaps[0]!, problem: "sequence numbers are missing", head: prev, headSeq: expectedSeq === null ? null : expectedSeq - 1, coverage, gaps, ...base };
  return { ok: true, brokenAt: null, problem: null, head: prev, headSeq: expectedSeq === null ? null : expectedSeq - 1, coverage, gaps, ...base };
}
