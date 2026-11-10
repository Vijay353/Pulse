/** CH-15: empty states distinguish "none yet" from "no match". */
import { describe, expect, it } from "vitest";
import { recordsEmptyState } from "../../apps/web/src/state/empty";
import { age, clock, statusWord, usd } from "../../apps/web/src/state/format";

describe("recordsEmptyState", () => {
  it("rows shown: no empty state", () => expect(recordsEmptyState("campaigns", 3, 1, "4081")).toBeNull());
  it("no records at all", () => expect(recordsEmptyState("campaigns", 0, 0, "")).toEqual({ kind: "none-yet", text: "There are no campaigns records yet. Import a workbook or load a scenario to add some." }));
  it("filter matches nothing", () => expect(recordsEmptyState("campaigns", 3, 0, " zzz ")).toEqual({ kind: "no-match", text: 'None of the 3 campaigns records match "zzz".' }));
});

describe("missing values use plain words", () => {
  it("formatters return n/a, never a dash", () => {
    expect([usd(null), clock(null), age(null), statusWord(null)]).toEqual(["n/a", "n/a", "n/a", "n/a"]);
  });
});
