/**
 * Shared contracts for MarginPulse. Every boundary (webhook, agent output,
 * tool IO, mock vendor payloads, view model) is validated with these schemas.
 *
 * Evidence labels used in comments:
 *  VERIFIED  – matches Uber Ads public OpenAPI (checked 2026-10-18)
 *  TO_VERIFY – assumption about vendor behavior not confirmed in public docs
 *  PROPOSED  – MarginPulse's own design
 */
import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Primitive helpers                                                   */
/* ------------------------------------------------------------------ */

/** ISO-8601 timestamp WITH explicit offset or Z. Naive timestamps are rejected. */
export const IsoInstant = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/,
    "must be ISO-8601 with an explicit timezone offset (e.g. 2026-10-18T18:31:20-04:00)",
  )
  .refine((s) => !Number.isNaN(Date.parse(s)), "not a real date/time");

export const Id = z.string().min(1).max(80).regex(/^[A-Za-z0-9._:-]+$/, "invalid id characters");

/* ------------------------------------------------------------------ */
/* Webhook event (POS -> MarginPulse)  PROPOSED                         */
/* ------------------------------------------------------------------ */

export const KitchenLoadEvent = z.strictObject({
  eventId: Id,
  eventType: z.literal("KitchenLoadThresholdBreached"),
  occurredAt: IsoInstant,
  storeId: Id,
  source: z.literal("mock-pos-kds"),
  snapshotId: Id,
  observedP95PrepMinutes: z.number().nonnegative().max(600),
  activeTickets: z.number().int().nonnegative().max(10000),
  configuredThresholdMinutes: z.number().nonnegative().max(600),
  /** HMAC-SHA256 hex over the canonical payload (all fields except signature). */
  signature: z.string().min(1).max(128),
});
export type KitchenLoadEvent = z.infer<typeof KitchenLoadEvent>;

/* ------------------------------------------------------------------ */
/* Uber Ads campaign shapes                                            */
/* ------------------------------------------------------------------ */

/** VERIFIED: configured status values accepted by create/update inputs. DRAFT appears on the model page. */
export const ConfiguredStatus = z.enum([
  "CAMPAIGN_CONFIGURED_STATUS_ACTIVE",
  "CAMPAIGN_CONFIGURED_STATUS_PAUSED",
  "CAMPAIGN_CONFIGURED_STATUS_DRAFT",
]);
export type ConfiguredStatus = z.infer<typeof ConfiguredStatus>;

/** VERIFIED: permissions enum on Campaign. */
export const CampaignPermission = z.enum(["READ", "UPDATE", "DELETE"]);
export type CampaignPermission = z.infer<typeof CampaignPermission>;

/**
 * Raw campaign as returned by GET /v1/ads/{account_id}/campaigns.
 * effective_status is a free string on purpose: Uber's public docs list
 * different values on different pages (TO_VERIFY), so the adapter maps it.
 * `store_ids` and `product` are MOCK-ONLY simplifications of ad_groups targeting.
 */
export const AdsCampaignWire = z.object({
  campaign_id: z.string(),
  name: z.string(),
  configured_status: z.string(),
  effective_status: z.string(),
  effective_status_reasons: z.array(z.string()),
  permissions: z.array(z.string()),
  version: z.number().int(),
  created_at: z.string(),
  updated_at: z.string(),
  updated_by_email: z.string().optional(),
  budget: z
    .object({
      unit: z.string(),
      total: z.object({ amount_e5: z.number().int(), currency_code: z.string() }),
    })
    .optional(),
  product: z.string().optional(),
  store_ids: z.array(z.string()).optional(),
});
export type AdsCampaignWire = z.infer<typeof AdsCampaignWire>;

/** VERIFIED: PATCH response is results[] of success{id} | failure{error_code,error_message}. */
export const AdsPatchResponse = z.object({
  results: z.array(
    z.union([
      z.object({ success: z.object({ id: z.string() }) }),
      z.object({ failure: z.object({ error_code: z.string(), error_message: z.string() }) }),
    ]),
  ),
});
export type AdsPatchResponse = z.infer<typeof AdsPatchResponse>;

/** Domain view of "is this campaign still buying demand?" */
export const ServingState = z.enum(["SERVING", "NOT_SERVING", "UNKNOWN"]);
export type ServingState = z.infer<typeof ServingState>;

/* ------------------------------------------------------------------ */
/* Investigation state machine  PROPOSED (spec §14)                    */
/* ------------------------------------------------------------------ */

export const InvestigationStatus = z.enum([
  "RECEIVED",
  "ASSESSING",
  "NO_ACTION",
  "NEEDS_REVIEW",
  "BLOCKED",
  "RECOMMENDATION_READY",
  "AWAITING_APPROVAL",
  "APPROVED",
  "PAUSE_REQUESTED",
  "PAUSE_VERIFIED",
  "PAUSE_REQUESTED_NOT_VERIFIED",
  "DISMISSED",
]);
export type InvestigationStatus = z.infer<typeof InvestigationStatus>;

export const Decision = z.enum([
  "RECOMMEND_PAUSE",
  "AWAITING_APPROVAL",
  "PAUSE_VERIFIED",
  "NO_ACTION",
  "NEEDS_REVIEW",
  "BLOCKED",
  "PAUSE_REQUESTED_NOT_VERIFIED",
  "DISMISSED",
]);
export type Decision = z.infer<typeof Decision>;

/* ------------------------------------------------------------------ */
/* Agent output contract (spec §11)                                    */
/* ------------------------------------------------------------------ */

export const AgentAction = z.enum(["PAUSE_SPONSORED_LISTING", "NO_ACTION", "NEEDS_REVIEW"]);
export type AgentAction = z.infer<typeof AgentAction>;

export const ObservationType = z.enum([
  "KITCHEN_THRESHOLD_BREACH",
  "KITCHEN_BELOW_THRESHOLD",
  "ACTIVE_SPONSORED_LISTING",
  "MULTIPLE_ACTIVE_CAMPAIGNS",
  "NO_ACTIVE_CAMPAIGN",
  "CONTRIBUTION_BELOW_FLOOR",
  "CONTRIBUTION_AT_OR_ABOVE_FLOOR",
  "STALE_DATA",
  "MISSING_DATA",
]);

export const AgentReport = z.strictObject({
  investigationId: z.string(),
  storeId: z.string(),
  observations: z
    .array(
      z.strictObject({
        type: ObservationType,
        value: z.union([z.number(), z.string()]),
        threshold: z.number().optional(),
        evidenceRef: z.string().min(1),
      }),
    )
    .max(20),
  candidateAction: AgentAction,
  candidateCampaignId: z.string().nullable(),
  confidence: z.enum(["HIGH", "MEDIUM", "LOW"]),
  missingData: z.array(z.string()).max(20),
  assumptions: z.array(z.string().max(300)).max(10),
  summary: z.string().min(1).max(600),
});
export type AgentReport = z.infer<typeof AgentReport>;

/* ------------------------------------------------------------------ */
/* Mutating tool contract (spec §13)                                   */
/* ------------------------------------------------------------------ */

export const PauseInput = z.strictObject({
  investigationId: z.string(),
  eventId: z.string(),
  approvalId: z.string(),
  approvedBy: z.string(),
  accountId: z.string(),
  storeId: z.string(),
  campaignId: z.string(),
  observedCampaignVersion: z.number().int(),
  policyVersion: z.string(),
  idempotencyKey: z.string(),
});
export type PauseSponsoredListingCampaignInput = z.infer<typeof PauseInput>;

export type PauseSponsoredListingCampaignOutput =
  | {
      ok: true;
      requestId: string;
      campaignId: string;
      configuredStatus: "CAMPAIGN_CONFIGURED_STATUS_PAUSED";
      effectiveStatus: "CAMPAIGN_EFFECTIVE_STATUS_PAUSED" | "CAMPAIGN_EFFECTIVE_STATUS_ACTIVE" | string;
      version: number;
      verified: boolean;
    }
  | {
      ok: false;
      code:
        | "NOT_AUTHORIZED"
        | "STALE_CAMPAIGN"
        | "WRONG_STORE"
        | "ALREADY_PAUSED"
        | "RATE_LIMITED"
        | "UPSTREAM_ERROR"
        | "READBACK_TIMEOUT";
      message: string;
    };

/* ------------------------------------------------------------------ */
/* Policy checks                                                       */
/* ------------------------------------------------------------------ */

export type CheckOutcome = "PASS" | "FAIL" | "SKIPPED";
export interface PolicyCheck {
  id: string;
  label: string;
  outcome: CheckOutcome;
  observed?: string;
  required?: string;
  failureCode?: string;
}

/** Banned claims: UI and agent output must never make these. */
export const BANNED_CLAIM_PATTERNS: RegExp[] = [
  /\bprofit (saved|increase|guarante)/i,
  /\bguarantee(d)?\b/i,
  /\b(incremental )?lift\b/i,
  /\bsav(e|es|ed|ings)\b.*\$/i,
  /\bfiduciary\b/i,
  /\bzero cancellations\b/i,
];

export function findBannedClaim(text: string): string | null {
  for (const re of BANNED_CLAIM_PATTERNS) if (re.test(text)) return re.source;
  return null;
}

/* ------------------------------------------------------------------ */
/* Evidence verification matrix (V3 CH-19)                             */
/* ------------------------------------------------------------------ */

/**
 * One row per check that the system defines. Statuses come only from checks
 * that actually ran: NOT_EVALUATED means the check has not run (or had no
 * data), and implies neither pass nor fail.
 * blocksAutoAction: MarginPulse has no automatic action. true means a FAIL or
 * WARN on this row prevents the pause until the condition clears or an
 * authorized person acts on it.
 */
export const EvidenceCheckStatus = z.enum(["PASS", "FAIL", "WARN", "NOT_EVALUATED"]);
export type EvidenceCheckStatus = z.infer<typeof EvidenceCheckStatus>;
export interface EvidenceCheck {
  checkId: string;
  label: string;
  status: EvidenceCheckStatus;
  evidenceRefs: string[];
  detail: string;
  evaluatedAt?: string;
  ruleVersion?: string;
  blocksAutoAction: boolean;
}
export interface EvidenceMatrix {
  summary: { passed: number; warned: number; failed: number; notEvaluated: number };
  checks: EvidenceCheck[];
}
