/**
 * CH-17: plan tiers as data. Server-side gates apply ONLY to surfaces added in
 * this engagement; every control that existed before (approval, pause,
 * evidence package, audit verify, data studio) is available on every plan.
 * This is a gate and a pricing table, not billing: there is no checkout.
 * Prices are not stated: they are set per pilot.
 */
export type Plan = "solo" | "group" | "enterprise";
export const PLANS: Plan[] = ["solo", "group", "enterprise"];

/** New, gateable surfaces. */
export type Feature = "fleet_view";

export const PLAN_TABLE: { plan: Plan; name: string; who: string; stores: string; includes: string[] }[] = [
  { plan: "solo", name: "Solo", who: "One restaurant", stores: "1 store", includes: ["Kitchen-alert guardrail and manager approval", "Plain-English reasons for every decision", "Verified pause with receipt and audit evidence package", "Signed webhook notifications"] },
  { plan: "group", name: "Group", who: "Franchise and multi-site operators", stores: "Up to 10 stores", includes: ["Everything in Solo", "Fleet view across your stores", "Team identities per store", "Shift digests per store"] },
  { plan: "enterprise", name: "Enterprise", who: "Large groups and brands", stores: "Custom", includes: ["Everything in Group", "Single sign-on", "Custom policies and contribution models", "External anchoring of the audit head hash", "Dedicated support"] },
];

const REQUIRED: Record<Feature, Plan> = { fleet_view: "group" };

export function parsePlan(v: string | undefined | null): Plan | null {
  const p = (v ?? "solo").trim().toLowerCase();
  return (PLANS as string[]).includes(p) ? (p as Plan) : null;
}
export function planAllows(plan: Plan, feature: Feature): boolean {
  return PLANS.indexOf(plan) >= PLANS.indexOf(REQUIRED[feature]);
}
export const requiredPlan = (feature: Feature): Plan => REQUIRED[feature];
export const planName = (p: Plan) => PLAN_TABLE.find((x) => x.plan === p)!.name;
