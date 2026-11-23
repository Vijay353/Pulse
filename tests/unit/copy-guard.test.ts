/**
 * CH-6: language guard for shipped copy. Every UI source file, plus the
 * server modules that produce user-facing text, is scanned against the
 * canonical BANNED_CLAIM_PATTERNS from packages/contracts. New copy that
 * claims savings, lift or guarantees fails here before it can ship.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { findBannedClaim } from "../../packages/contracts/src/index";

const ROOTS = ["apps/web/src", "apps/web/index.html", "apps/api/src/security/gatePage.ts", "apps/api/src/notify", "apps/api/src/routes"];

function files(p: string): string[] {
  let st;
  try { st = statSync(p); } catch { return []; }
  if (st.isFile()) return [p];
  return readdirSync(p).flatMap((f) => files(join(p, f)));
}

/** Drop comments so engineering notes about what we never claim don't trip the guard. */
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1").replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "");

describe("copy guard", () => {
  const all = ROOTS.flatMap(files).filter((f) => /\.(tsx?|html)$/.test(f));

  it("scans a meaningful number of files", () => {
    expect(all.length).toBeGreaterThan(30);
  });

  it.each(all)("%s contains no banned claim", (f) => {
    const lines = stripComments(readFileSync(f, "utf8")).split("\n");
    const hits = lines.map((l, i) => ({ l: i + 1, m: findBannedClaim(l), text: l.trim() })).filter((h) => h.m);
    expect(hits).toEqual([]);
  });
});
