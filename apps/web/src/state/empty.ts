/**
 * Empty-state wording (V3 CH-15). Distinguishes "nothing here yet" from
 * "nothing matches your filter", from server-derived counts only.
 */
export type EmptyState =
  | { kind: "none-yet"; text: string }
  | { kind: "no-match"; text: string }
  | null;

export function recordsEmptyState(sheet: string, total: number, shown: number, query: string): EmptyState {
  if (shown > 0) return null;
  if (total === 0) return { kind: "none-yet", text: `There are no ${sheet} records yet. Import a workbook or load a scenario to add some.` };
  return { kind: "no-match", text: `None of the ${total} ${sheet} records match "${query.trim()}".` };
}

/** Value shown when a field has no data. Plain words, never a dash. */
export const NA = "n/a";
