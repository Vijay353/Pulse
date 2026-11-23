import type { EvidenceMatrix } from "../../../../packages/contracts/src/index";

/** Small request layer. Business state always comes from the server; nothing is cached as truth here. */
let csrf = "";
let user = "mgr-ana";

export const setCsrf = (t: string) => { csrf = t; };
export const setUser = (u: string) => { user = u; };
export const getUser = () => user;

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

async function call<T>(method: string, path: string, body?: unknown, raw?: { data: BodyInit; type: string }): Promise<T> {
  const headers: Record<string, string> = { "x-demo-user": user };
  if (method !== "GET") headers["x-csrf-token"] = csrf;
  if (body !== undefined) headers["content-type"] = "application/json";
  if (raw) headers["content-type"] = raw.type;
  const res = await fetch(path, { method, headers, credentials: "same-origin", body: raw ? raw.data : body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json: unknown;
  try { json = text ? JSON.parse(text) : null; } catch { json = { message: text }; }
  if (!res.ok) {
    const j = (json ?? {}) as { error?: string; message?: string };
    if (res.status === 401 && j.error === "ACCESS_REQUIRED") backToGate();
    throw new ApiError(res.status, j.error ?? String(res.status), j.message ?? j.error ?? `Request failed (${res.status})`);
  }
  return json as T;
}

/** V3 CH-20: the visitor session expired or was cleared; return to the server's access gate. */
function backToGate() {
  const here = window.location.pathname + window.location.search;
  window.location.assign(`/access?next=${encodeURIComponent(here)}`);
}

/** GET a file with the demo identity header; returns the body and response headers. */
async function download(path: string): Promise<{ blob: Blob; headers: Headers; filename: string }> {
  const res = await fetch(path, { headers: { "x-demo-user": user }, credentials: "same-origin" });
  if (!res.ok) {
    const j = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
    if (res.status === 401 && j.error === "ACCESS_REQUIRED") backToGate();
    throw new ApiError(res.status, j.error ?? String(res.status), j.message ?? `Request failed (${res.status})`);
  }
  const cd = res.headers.get("content-disposition") ?? "";
  const filename = /filename="([^"]+)"/.exec(cd)?.[1] ?? "download";
  return { blob: await res.blob(), headers: res.headers, filename };
}

export const api = {
  download,
  get: <T>(p: string) => call<T>("GET", p),
  post: <T>(p: string, b: unknown = {}) => call<T>("POST", p, b),
  del: <T>(p: string) => call<T>("DELETE", p),
  upload: <T>(p: string, file: File) => call<T>("POST", p, undefined, { data: file, type: "application/octet-stream" }),
};

/* ---- shapes used by the UI (subset of the server view model) ---- */
export interface Check { id: string; label: string; outcome: "PASS" | "FAIL" | "SKIPPED"; observed?: string; required?: string; failureCode?: string }
export interface Readback { attempt: number; at: string; ok: boolean; configuredStatus?: string; effectiveStatus?: string; serving?: string; version?: number; error?: string }
export interface AuditEvent { seq: number; type: string; atSim: string; atWall: string; actor: string; payload: unknown; hash: string }

export interface MoneyBreakdown { subtotalCents: number; feeCents: number; foodCents: number; adCents: number; contributionCents: number }

export interface StoreHistory {
  windowDays: number;
  excludesCurrentAlert: true;
  alerts: number;
  paused: number;
  keptActive: number;
  noAction: number;
  needsReview: number;
  blocked: number;
  open: number;
}

export interface RepeatWarning {
  code: "POSSIBLE_REPEAT_ALERT";
  evidenceRef: string;
  priorInvestigationId: string;
  priorEventId: string;
  snapshotId: string;
  p95: number;
  priorOccurredAt: string;
  secondsApart: number | null;
  matchedFields: string[];
}

export interface InvestigationView {
  id: string;
  status: string;
  decision: string | null;
  decisionCode: string | null;
  parentId: string | null;
  childIds: string[];
  createdAt: string;
  now: string;
  dismissReason: string | null;
  store: { posStoreId: string; name: string; timezone: string; uberStoreId: string | null; accountId: string | null } | null;
  event: Record<string, unknown> & { eventId: string; deliveryCount: number; configuredThresholdMinutes: number };
  kitchen: { snapshotId: string; p95PrepMinutes: number; activeTickets: number; connectorHealth: string; capturedAt: string; ageSeconds: number; thresholdMinutes: number | null; posAlertThresholdMinutes: number | null } | null;
  kitchenAgeAtDecision: number | null;
  policy: Record<string, unknown> | null;
  campaign: { campaignId: string; name: string; configuredStatus: string; effectiveStatusRaw: string; permissions: string[]; version: number; dailyBudgetCents: number | null } | null;
  campaignsSeen: { campaignId: string; name: string; configuredStatus: string; eligible: boolean }[];
  liveCampaign: { campaignId: string; name: string; configuredStatus: string; effectiveStatusRaw: string; serving: string; version: number; updatedBy: string | null } | null;
  liveCampaignError: string | null;
  report: { reportId: string; watermark: string; windowStart: string; windowEnd: string; attributedOrders: number | null; ageSecondsAtDecision: number | null } | null;
  contribution: null | { ok: true; orders: number; perOrder: MoneyBreakdown; totals: MoneyBreakdown; rateBps: number; floorCentsPerOrder: number; minRateBps: number; belowFloor: boolean; formula: string[]; exclusions: string } | { ok: false; missing: string[] };
  exclusionNote: string;
  policyChecks: Check[];
  agent: { provider?: string; raw?: Record<string, unknown> | null; trace?: { step: number; tool: string; args: unknown; evidenceRef: string; ok: boolean }[]; error?: string | null; validation?: { schemaValid: boolean; citationsResolve: boolean; problems: string[] } };
  evidence: { evidenceId: string; kind: string; tool: string; args: unknown; payload: unknown; readAt: string }[];
  approvals: { approvalId: string; approvedBy: string; campaignId: string; policyVersion: string; createdAt: string; expiresAt: string; consumedAt: string | null }[];
  mutations: { attempt: number; requestId: string; status: string; errorCode: string | null; request: unknown; response: unknown }[];
  result: {
    executionChecks?: { id: string; ok: boolean; detail: string }[];
    tool?: { output: Record<string, unknown>; detail: { readbacks: Readback[]; writeRequest: unknown; writeOutcome: unknown; mutationStatus: string | null; stillServing: boolean; verified: boolean; preWrite: { ok: boolean; reason: string | null } } };
    extraReadbacks?: Readback[];
    otherMutations?: string;
    verifiedAt?: string;
    patchCountForCampaign?: number;
    lastError?: { code: string; message: string } | null;
    digests?: Record<string, string | null>;
    targetLedger?: Record<string, unknown>[];
  };
  actions: { canApprove: boolean; canDismiss: boolean; canPause: boolean; canRetry: boolean; canCheckAgain: boolean; canReassess: boolean };
  warnings: RepeatWarning[];
  storeHistory: StoreHistory;
  eligibleApprovers: { userId: string; displayName: string }[];
  evidenceMatrix: EvidenceMatrix;
  policyProvenance: { policyId: string; version: string; effectiveFrom: string; checkCount: number; changedBy: string | null; changedAt: string | null; changeSource: "POLICY_PUBLISHED" | "IMPORT" | null } | null;
  viewer: { userId: string; displayName: string; role: string; canApproveHere: boolean } | null;
  adsProvider: string;
  posProvider?: string;
  audit: AuditEvent[];
}

export interface ScenarioInfo { id: string; code: string; title: string; summary: string; expected: string; steps: string[] }

/** CH-9 / CH-20: read-only aggregate (apps/api/src/orchestration/digest.ts). */
export interface Digest {
  scope: { storeIds: string[] | "ALL"; since: "SCENARIO_LOADED"; scenario: string | null };
  investigated: number; recommended: number; pausesVerified: number; pausesNotVerified: number;
  keptActive: number; noAction: number; needsReview: number; blocked: number; open: number;
  patchRequestsSent: number; verificationRateBps: number | null; nonActionRateBps: number | null;
  meanSecondsToDecision: number | null; decisionsTimed: number;
}
/** CH-18: fleet summary for the stores an identity is assigned to. */
export interface FleetStore {
  storeId: string; name: string | null;
  lastInvestigation: { id: string; status: string; decisionCode: string | null; createdAt: string } | null;
  needsAttention: number;
  campaign: { campaignId: string; configuredStatus: string; serving: string; version: number } | null;
  campaignReadError: string | null;
}
