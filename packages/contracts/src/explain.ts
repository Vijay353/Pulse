/**
 * CH-8: "Why am I seeing this?" — plain-English explanations assembled ONLY
 * from checks the system actually executed and persisted (policy_checks_json,
 * execution checks, readbacks, the stored contribution and the dismiss reason).
 *
 * Rules this module keeps:
 * - It never invents a value. Every number it prints is copied from a stored
 *   check row or the stored contribution calculation.
 * - If the check it needs is absent, it does not guess. It returns the generic
 *   fallback ("Open the evidence checks below for details.") with source "generic".
 * - It is shared by the web UI and the server's notification adapter (CH-19),
 *   so a manager reads the same sentence in both places.
 */

type Readback = { configuredStatus?: string; effectiveStatus?: string; serving?: string; version?: number };
export interface ExplainCheck { id: string; label: string; outcome: "PASS" | "FAIL" | "SKIPPED"; observed?: string; required?: string; failureCode?: string }
export interface ExplainInput {
  status: string;
  decisionCode: string | null;
  policyChecks: ExplainCheck[];
  contribution?: null | { ok: true; perOrder: { contributionCents: number }; floorCentsPerOrder: number; rateBps: number; minRateBps: number } | { ok: false; missing: string[] };
  result?: {
    executionChecks?: { id: string; ok: boolean; detail: string }[];
    tool?: { detail?: { readbacks?: Readback[] } };
    extraReadbacks?: Readback[];
    lastError?: { code: string; message: string } | null;
  };
  evidenceMatrix?: { checks: { checkId: string; evidenceRefs: string[] }[] };
  dismissReason?: string | null;
}

export interface Explanation {
  /** One short sentence: what this means for the manager. */
  headline: string;
  /** One or two sentences with the observed vs. required values. null when nothing beyond the headline is known. */
  detail: string | null;
  /** Evidence records the sentence relies on (from the evidence matrix). */
  evidenceIds: string[];
  /** Ids of the executed checks the sentence was built from. Empty for the generic fallback. */
  checkIds: string[];
  /** "checks" when built from executed checks; "generic" when the needed check was absent. */
  source: "checks" | "generic";
}

const GENERIC_DETAIL = "Open the evidence checks below for details.";

const usd = (cents: number) => `${cents < 0 ? "−" : ""}$${(Math.abs(cents) / 100).toFixed(2)}`;

/** "≤ 120 s" → "2 min"; "≤ 15 min" → "15 min"; "6 min" stays. Only reformats units; never changes the value. */
function humanDuration(s: string | undefined): string | null {
  if (!s) return null;
  const m = /(\d+(?:\.\d+)?)\s*(s|sec|min)\b/.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  if (m[2] === "min") return `${n} min`;
  if (n >= 120 && n % 60 === 0) return `${n / 60} min`;
  return `${n} sec`;
}
const minutes = (s: string | undefined) => {
  const m = s ? /(\d+(?:\.\d+)?)\s*min/.exec(s) : null;
  return m ? m[1] : null;
};

const EXEC_LABEL: Record<string, string> = {
  approval_exists: "No approval was found",
  approval_investigation: "The approval belongs to a different alert",
  approval_store: "The approval is for a different store",
  approval_campaign: "The approval is for a different campaign",
  approval_action: "The approval covers a different action",
  approval_policy_version: "The approval was given under a different policy version",
  approval_user: "The approval was given by someone else",
  approval_not_expired: "The approval expired",
  approval_not_reused: "The approval was already used",
  warnings_acknowledged: "The repeat-alert warning was not acknowledged",
  policy_unchanged: "Your policy changed after the recommendation",
  recommendation_fresh: "The recommendation expired before the pause was sent",
  prewrite_reread: "A final re-read of the campaign did not match what you reviewed",
};

/** Turn one failed (or decisive) policy check into a sentence. Returns null when the row lacks the values needed. */
function sentenceFor(c: ExplainCheck, input: ExplainInput): string | null {
  const obs = c.observed;
  const req = c.required;
  switch (c.id) {
    case "threshold": {
      const o = minutes(obs), r = minutes(req);
      if (!o || !r) return null;
      return c.outcome === "PASS"
        ? `Kitchen prep time (P95) is ${o} min, over your ${r} min limit.`
        : `Kitchen prep time (P95) is ${o} min, under your ${r} min limit.`;
    }
    case "contribution_floor": {
      if (!obs || !req) return null;
      const floor = req.replace(/^[<≤]\s*/, "");
      const ctr = input.contribution && input.contribution.ok ? input.contribution : null;
      const money = ctr ? ` (${usd(ctr.perOrder.contributionCents)} against a ${usd(ctr.floorCentsPerOrder)} floor)` : "";
      return c.outcome === "PASS"
        ? `This campaign's estimated contribution is ${obs} per attributed order${money}, below your ${floor} floor.`
        : `This campaign's estimated contribution is ${obs} per attributed order${money}, which clears your ${floor} floor.`;
    }
    case "snapshot_freshness": {
      const o = humanDuration(obs), r = humanDuration(req);
      return o && r ? `The kitchen report is ${o} old; your policy accepts at most ${r}.` : null;
    }
    case "event_freshness": {
      const o = humanDuration(obs), r = humanDuration(req);
      return o && r ? `The kitchen alert arrived ${o} after it was raised; your policy accepts at most ${r}.` : null;
    }
    case "report_freshness": {
      const o = humanDuration(obs), r = humanDuration(req);
      return o && r ? `The latest ad report is ${o} old; your policy accepts at most ${r}.` : null;
    }
    case "campaign_count": {
      if (!obs) return null;
      const n = /^(\d+)/.exec(obs)?.[1];
      if (n === undefined) return null;
      return n === "0"
        ? "No active Sponsored Listings campaign targets this store, so there is nothing to pause."
        : `${n} active Sponsored Listings campaigns target this store; MarginPulse acts only when there is exactly 1.`;
    }
    case "campaign_permission":
      return obs ? `The ad connection has ${obs} access to this campaign; pausing needs UPDATE.` : null;
    case "store_mapping": {
      const n = obs ? /^(\d+)/.exec(obs)?.[1] : undefined;
      return n !== undefined ? `This POS store maps to ${n} Uber stores; it must map to exactly 1.` : null;
    }
    case "pos_health":
      return obs ? `The POS connector reported "${obs}", so the kitchen could not be re-read.` : null;
    case "contribution_inputs":
      return obs ? `Cost data is incomplete (${obs}), so contribution was not estimated.` : null;
    case "policy_present":
      return "No current merchant policy was found for this store.";
    default:
      return obs && req ? `${c.label}: observed ${obs}; required ${req}.` : null;
  }
}

function refsFor(input: ExplainInput, ids: string[]) {
  const out = new Set<string>();
  for (const id of ids) for (const r of input.evidenceMatrix?.checks.find((c) => c.checkId === id)?.evidenceRefs ?? []) out.add(r);
  return [...out];
}

function fromChecks(headline: string, input: ExplainInput, rows: ExplainCheck[]): Explanation {
  const parts: string[] = [];
  const used: string[] = [];
  for (const r of rows) {
    const s = sentenceFor(r, input);
    if (!s) return generic(headline);
    parts.push(s);
    used.push(r.id);
  }
  if (!parts.length) return generic(headline);
  return { headline, detail: parts.join(" "), evidenceIds: refsFor(input, used), checkIds: used, source: "checks" };
}

function generic(headline: string): Explanation {
  return { headline, detail: GENERIC_DETAIL, evidenceIds: [], checkIds: [], source: "generic" };
}

const lastReadback = (input: ExplainInput) => {
  const all = [...(input.result?.tool?.detail?.readbacks ?? []), ...(input.result?.extraReadbacks ?? [])];
  return all[all.length - 1] ?? null;
};
const word = (s: string | undefined) => (s ?? "").replace(/^CAMPAIGN_(CONFIGURED|EFFECTIVE)_STATUS_/, "").replace(/_/g, " ").toLowerCase();
/** Serving state from the readback; "status unknown" when the provider did not say. */
const serving = (rb: Readback) => (rb.serving && rb.serving !== "UNKNOWN" ? word(rb.serving) : "serving status unknown");

export function explainVerdict(input: ExplainInput): Explanation {
  const checks = input.policyChecks ?? [];
  const byId = (id: string) => checks.find((c) => c.id === id);
  const code = input.decisionCode ?? "";

  // Execution-time outcomes come first: they are later facts than the policy checks.
  if (input.status === "PAUSE_VERIFIED") {
    const rb = lastReadback(input);
    if (!rb?.configuredStatus) return generic("The pause went through and was checked.");
    return {
      headline: "The pause went through and was checked.",
      detail: `A readback shows the campaign ${word(rb.configuredStatus)} and ${serving(rb)}${rb.version !== undefined ? `, version ${rb.version}` : ""}. It stays paused until someone resumes it.`,
      evidenceIds: [], checkIds: ["readback"], source: "checks",
    };
  }
  if (input.status === "PAUSE_REQUESTED_NOT_VERIFIED") {
    const rb = lastReadback(input);
    if (!rb?.configuredStatus) return generic("The pause was sent, but the result is not confirmed yet.");
    return {
      headline: "The pause was sent, but the result is not confirmed yet.",
      detail: `The last readback shows the campaign ${word(rb.configuredStatus)} and ${serving(rb)}. MarginPulse will not send it again until a check shows what happened.`,
      evidenceIds: [], checkIds: ["readback"], source: "checks",
    };
  }
  if (input.status === "DISMISSED") {
    return input.dismissReason
      ? { headline: "A manager chose to keep the campaign running.", detail: `Reason given: "${input.dismissReason}". Nothing was changed.`, evidenceIds: [], checkIds: ["dismiss_reason"], source: "checks" }
      : generic("A manager chose to keep the campaign running.");
  }
  const failedExec = input.result?.executionChecks?.find((c) => !c.ok);
  if (input.status === "BLOCKED" && failedExec) {
    return {
      headline: "The pause was stopped before anything was sent.",
      detail: `${EXEC_LABEL[failedExec.id] ?? failedExec.id} (${failedExec.detail}). Re-assess with fresh data and approve again if it still applies.`,
      evidenceIds: [], checkIds: [failedExec.id], source: "checks",
    };
  }

  if (code === "RECOMMEND_PAUSE") {
    const t = byId("threshold"), f = byId("contribution_floor");
    if (!t || !f || t.outcome !== "PASS" || f.outcome !== "PASS") return generic("Pausing this one campaign is recommended.");
    return fromChecks("Pausing this one campaign is recommended. Nothing changes until a manager approves.", input, [t, f]);
  }

  const failed = checks.find((c) => c.outcome === "FAIL");
  if (!failed) return generic(code.startsWith("NO_ACTION") ? "No action is needed." : "This alert needs a person to look at it.");

  const headline = code.startsWith("NO_ACTION")
    ? "No action is needed. The guardrail ran and the campaign stays as it is."
    : code.startsWith("NEEDS_REVIEW")
      ? "A person needs to look at this. MarginPulse will not pick for you."
      : "MarginPulse stopped here and offers no pause.";

  // NO_ACTION_CONTRIBUTION_OK reads better with the kitchen fact first.
  const rows = code === "NO_ACTION_CONTRIBUTION_OK" && byId("threshold")?.outcome === "PASS" ? [byId("threshold")!, failed] : [failed];
  return fromChecks(headline, input, rows);
}
