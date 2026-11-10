/**
 * Typed readers for read-only tool results (V3 CH-2).
 * Tool results carry `data: unknown`. The orchestrator reads them only through
 * these schemas. A result that claims success but does not match its schema is
 * treated as missing, never as zeros or defaults, so the policy fails closed.
 */
import { z } from "zod";
import type { ToolResult } from "./toolRegistry";

const n = z.number().finite();
const intN = z.number().int();

export const KitchenSnapshotData = z.object({
  snapshotId: z.string().min(1),
  storeId: z.string().min(1),
  capturedAt: z.string().min(1),
  p95PrepMinutes: n.nonnegative(),
  activeTickets: intN.nonnegative(),
  connectorHealth: z.enum(["HEALTHY", "DEGRADED", "DOWN"]),
});

export const GuardrailData = z.object({
  policyId: z.string(),
  version: z.string(),
  p95ThresholdMinutes: n.nonnegative(),
  minContributionRateBps: intN.nonnegative(),
  maxPosSnapshotAgeS: intN.nonnegative(),
  maxAdsReportAgeS: intN.nonnegative(),
  maxEventAgeS: intN.nonnegative(),
});

export const CampaignListData = z.object({
  mapping: z.object({ uberStoreId: z.string(), accountId: z.string() }),
  eligibleCampaignIds: z.array(z.string()),
  campaigns: z.array(z.object({ campaignId: z.string(), permissions: z.array(z.string()), version: intN, evidenceRef: z.string() })),
});

export const CampaignReportData = z.object({ watermark: z.string().min(1) });

const Money = z.object({ subtotalCents: intN, feeCents: intN, foodCents: intN, adCents: intN, contributionCents: intN });
export const ContributionResultSchema = z.union([
  z.object({
    ok: z.literal(true),
    orders: intN.positive(),
    totals: Money,
    perOrder: Money,
    rateBps: intN,
    rateExact: z.string(),
    floorCentsPerOrder: intN,
    minRateBps: intN,
    belowFloor: z.boolean(),
    formula: z.array(z.string()),
    exclusions: z.string(),
  }),
  z.object({ ok: z.literal(false), missing: z.array(z.string()) }),
]);
export const CalculationData = z.object({ result: ContributionResultSchema });

export const ToolErrorData = z.object({ error: z.unknown() });

export type Read<T> = { ok: true; value: T } | { ok: false; problem: string };

/** Read a successful tool result through its schema. Failed or malformed results are never values. */
export function readTool<S extends z.ZodType>(schema: S, r: ToolResult): Read<z.infer<S>> {
  if (!r.ok) return { ok: false, problem: `${r.evidenceRef}: tool reported an error` };
  const p = schema.safeParse(r.data);
  if (!p.success) return { ok: false, problem: `${r.evidenceRef}: result did not match its schema (${p.error.issues[0]?.path.join(".")} ${p.error.issues[0]?.message})` };
  return { ok: true, value: p.data };
}

/** The error payload of a failed tool call, or null. */
export function toolError(r: ToolResult): unknown {
  if (r.ok) return null;
  const p = ToolErrorData.safeParse(r.data);
  return p.success ? p.data.error : "unreadable tool error";
}
