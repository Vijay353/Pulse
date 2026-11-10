/**
 * Deterministic contribution estimate in integer cents. No floating-point
 * money, no LLM. This is an ESTIMATE from synthetic inputs, not accounting
 * profit: it excludes labor, rent, taxes, refunds and incrementality.
 *
 *   contribution = item subtotal − marketplace fee − food & packaging − ad cost
 * computed on window totals, then shown per attributed order.
 */
export interface ContributionInputs {
  attributedOrders: number | null;
  attributedSalesCents: number | null;
  spendCents: number | null;
  avgFoodPackagingCostCents: number | null;
  marketplaceFeeRateBps: number | null;
  minContributionRateBps: number;
}

export type ContributionResult =
  | {
      ok: true;
      orders: number;
      totals: { subtotalCents: number; feeCents: number; foodCents: number; adCents: number; contributionCents: number };
      perOrder: { subtotalCents: number; feeCents: number; foodCents: number; adCents: number; contributionCents: number };
      rateBps: number; // rounded for display only
      rateExact: string; // "3200/28000"
      floorCentsPerOrder: number;
      minRateBps: number;
      belowFloor: boolean;
      formula: string[];
      exclusions: string;
    }
  | { ok: false; missing: string[] };

export const EXCLUSION_NOTE =
  "Contribution estimate excludes labor, rent, taxes, refunds and incremental-lift analysis. It is not accounting profit.";

/** Round half away from zero for non-negative integers division. */
const div = (num: number, den: number) => Math.floor((num + Math.floor(den / 2)) / den);

export function calculateContribution(i: ContributionInputs): ContributionResult {
  const missing: string[] = [];
  const need = (name: string, v: number | null, positive = false) => {
    if (v === null || v === undefined || !Number.isInteger(v) || v < 0 || (positive && v === 0)) missing.push(name);
  };
  need("attributed orders", i.attributedOrders, true);
  need("attributed item subtotal", i.attributedSalesCents, true);
  need("ad spend", i.spendCents);
  need("food & packaging cost", i.avgFoodPackagingCostCents);
  need("marketplace fee rate", i.marketplaceFeeRateBps);
  if (missing.length) return { ok: false, missing };

  const orders = i.attributedOrders!;
  const subtotal = i.attributedSalesCents!;
  const fee = div(subtotal * i.marketplaceFeeRateBps!, 10000);
  const food = i.avgFoodPackagingCostCents! * orders;
  const ad = i.spendCents!;
  const contribution = subtotal - fee - food - ad;
  // Exact integer comparison: contribution/subtotal < minRate/10000
  const belowFloor = contribution * 10000 < i.minContributionRateBps * subtotal;
  const per = (x: number) => div(Math.abs(x), orders) * Math.sign(x || 1);
  const perOrder = { subtotalCents: per(subtotal), feeCents: per(fee), foodCents: per(food), adCents: per(ad), contributionCents: contribution >= 0 ? per(contribution) : -div(-contribution, orders) };
  const usd = (c: number) => `${c < 0 ? "−" : ""}$${(Math.abs(c) / 100).toFixed(2)}`;
  return {
    ok: true,
    orders,
    totals: { subtotalCents: subtotal, feeCents: fee, foodCents: food, adCents: ad, contributionCents: contribution },
    perOrder,
    rateBps: contribution >= 0 ? div(contribution * 10000, subtotal) : -div(-contribution * 10000, subtotal),
    rateExact: `${contribution}/${subtotal}`,
    floorCentsPerOrder: div(perOrder.subtotalCents * i.minContributionRateBps, 10000),
    minRateBps: i.minContributionRateBps,
    belowFloor,
    formula: [
      "estimated contribution per attributed order",
      "= item subtotal − marketplace fee − merchant food & packaging − allocated ad cost",
      `= ${usd(perOrder.subtotalCents)} − ${usd(perOrder.feeCents)} − ${usd(perOrder.foodCents)} − ${usd(perOrder.adCents)}`,
      `= ${usd(perOrder.contributionCents)}`,
      `window totals: ${usd(subtotal)} − ${usd(fee)} − ${usd(food)} − ${usd(ad)} = ${usd(contribution)} over ${orders} orders`,
    ],
    exclusions: EXCLUSION_NOTE,
  };
}
