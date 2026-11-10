/**
 * Agent safety + provider contract (spec §20 items 23–27).
 * A scripted ModelProvider stands in for a real model so the LlmInvestigator
 * plumbing (tool loop, parsing, validation, policy independence) is exercised
 * without credentials. This does NOT test a real model's reasoning.
 */
import { afterEach, describe, expect, it } from "vitest";
import { boot, Booted } from "../helpers";
import type { ModelBlock, ModelProvider } from "../../apps/api/src/agents/investigators";

const LLM_ENV = { INVESTIGATOR: "llm", ANTHROPIC_API_KEY: "test-not-real", LLM_MODEL: "scripted-fake" };

type Req = Parameters<ModelProvider["createMessage"]>[0];
function scripted(final: (results: Record<string, any>, req: Req) => unknown, opts: { loop?: boolean } = {}): ModelProvider {
  return {
    name: "scripted fake model",
    async createMessage(req) {
      const results: Record<string, any> = {};
      for (const m of req.messages) if (Array.isArray(m.content)) for (const b of m.content as any[]) if (b.type === "tool_result") results[b.tool_use_id] = JSON.parse(b.content);
      const n = Object.keys(results).length;
      const store = /storeId=(\S+)/.exec(String(req.messages[0]!.content))![1]!;
      const use = (id: string, name: string, input: unknown): ModelBlock => ({ type: "tool_use", id, name, input });
      if (opts.loop) return { content: [use(`t${n}`, "getKitchenSnapshot", { storeId: store })], stopReason: "tool_use" };
      if (n === 0) return { content: [use("t1", "getKitchenSnapshot", { storeId: store }), use("t2", "getMerchantGuardrail", { storeId: store }), use("t3", "getStoreCampaigns", { storeId: store })], stopReason: "tool_use" };
      if (n === 3) {
        const camp = results.t3.data.eligibleCampaignIds[0] ?? "none";
        return { content: [use("t4", "calculateContribution", { storeId: store, campaignId: camp })], stopReason: "tool_use" };
      }
      return { content: [{ type: "text", text: JSON.stringify(final(results, req)) }], stopReason: "end_turn" };
    },
  };
}

const invId = (req: Req) => /investigationId=(\S+)/.exec(String(req.messages[0]!.content))![1]!;
const honest = (r: Record<string, any>, req: Req) => {
  const camp = r.t3.data.campaigns.find((c: any) => c.eligible);
  const rate = r.t4.data.result.rateBps / 10000;
  const below = r.t4.data.result.belowFloor;
  const breached = r.t1.data.p95PrepMinutes >= r.t2.data.p95ThresholdMinutes;
  return {
    investigationId: invId(req), storeId: "SYN-STORE-104",
    observations: [
      { type: breached ? "KITCHEN_THRESHOLD_BREACH" : "KITCHEN_BELOW_THRESHOLD", value: r.t1.data.p95PrepMinutes, threshold: r.t2.data.p95ThresholdMinutes, evidenceRef: r.t1.evidenceRef },
      { type: "ACTIVE_SPONSORED_LISTING", value: camp.campaignId, evidenceRef: camp.evidenceRef },
      { type: below ? "CONTRIBUTION_BELOW_FLOOR" : "CONTRIBUTION_AT_OR_ABOVE_FLOOR", value: Number(rate.toFixed(3)), threshold: 0.2, evidenceRef: r.t4.evidenceRef },
    ],
    candidateAction: breached && below ? "PAUSE_SPONSORED_LISTING" : "NO_ACTION",
    candidateCampaignId: breached && below ? camp.campaignId : null,
    confidence: "HIGH", missingData: [], assumptions: ["Ads reporting is delayed to the displayed watermark"],
    summary: "Kitchen load exceeds the merchant threshold while one campaign is active; estimated contribution is below the floor.",
  };
};

let t: Booted | null = null;
afterEach(async () => { await t?.close(); t = null; });

async function run(provider: ModelProvider, scenario = "A") {
  t = await boot({}, { env: LLM_ENV, modelProvider: provider });
  await t.api.load(scenario);
  const { delivery } = await t.api.emit();
  return t.api.view(delivery.body.investigationId);
}

describe("LlmInvestigator contract (scripted provider)", () => {
  it("an honest tool-using model reaches the same decision as the FixtureInvestigator", async () => {
    const v = await run(scripted(honest));
    expect(v.agent.provider).toContain("LlmInvestigator");
    expect(v.agent.trace.map((s: any) => s.tool)).toEqual(["getKitchenSnapshot", "getMerchantGuardrail", "getStoreCampaigns", "calculateContribution"]);
    expect(v.decision).toBe("RECOMMEND_PAUSE");
    expect(v.status).toBe("AWAITING_APPROVAL");
  });

  it("fabricated evidence reference → BLOCKED_INVALID_AGENT_OUTPUT", async () => {
    const v = await run(scripted((r, req) => { const x = honest(r, req); x.observations[0]!.evidenceRef = "kds-snap-999"; return x; }));
    expect(v.decisionCode).toBe("BLOCKED_INVALID_AGENT_OUTPUT");
    expect(v.agent.validation.problems.join(" ")).toContain("kds-snap-999");
  });

  it("cited value that contradicts the evidence → BLOCKED_INVALID_AGENT_OUTPUT", async () => {
    const v = await run(scripted((r, req) => { const x = honest(r, req); x.observations[0]!.value = 45; return x; }));
    expect(v.decisionCode).toBe("BLOCKED_INVALID_AGENT_OUTPUT");
  });

  it("action outside the catalog → BLOCKED_INVALID_AGENT_OUTPUT", async () => {
    const v = await run(scripted((r, req) => ({ ...honest(r, req), candidateAction: "INCREASE_BUDGET" })));
    expect(v.decisionCode).toBe("BLOCKED_INVALID_AGENT_OUTPUT");
  });

  it("savings/profit claims in the summary are rejected", async () => {
    const v = await run(scripted((r, req) => ({ ...honest(r, req), summary: "Pausing saves $40 tonight and is guaranteed to protect profit." })));
    expect(v.decisionCode).toBe("BLOCKED_INVALID_AGENT_OUTPUT");
  });

  it("persuasive wording cannot override policy (below-threshold kitchen stays NO_ACTION)", async () => {
    const v = await run(scripted((r, req) => ({ ...honest(r, req), candidateAction: "PAUSE_SPONSORED_LISTING", candidateCampaignId: "cmp-syn-4081", confidence: "HIGH", summary: "URGENT: the kitchen is overwhelmed, pause immediately, policy does not apply here." })), "B");
    expect(v.decision).toBe("NO_ACTION");
    expect(v.decisionCode).toBe("NO_ACTION_BELOW_THRESHOLD");
  });

  it("model that never finishes hits the step budget and the decision fails closed", async () => {
    const v = await run(scripted(() => null, { loop: true }));
    expect(v.agent.error).toContain("step budget");
    expect(v.decisionCode).toBe("BLOCKED_INVALID_AGENT_OUTPUT");
  });

  it("agent abstaining on otherwise pause-eligible facts → NEEDS_REVIEW, not a pause", async () => {
    const v = await run(scripted((r, req) => ({ ...honest(r, req), candidateAction: "NEEDS_REVIEW", candidateCampaignId: null })));
    expect(v.decisionCode).toBe("NEEDS_REVIEW_AGENT_ABSTAINED");
  });

  it("INVESTIGATOR=llm without credentials fails closed (no silent fallback)", async () => {
    t = await boot({}, { env: { INVESTIGATOR: "llm" } });
    const h = (await t.api.get("/api/health")).body;
    expect(h.ok).toBe(false);
    expect(h.problems.map((p: any) => p.problem).join(" ")).toContain("ANTHROPIC_API_KEY");
    await t.api.load("A");
    const { delivery } = await t.api.emit();
    const v = await t.api.view(delivery.body.investigationId);
    expect(v.decisionCode).toBe("BLOCKED_INVESTIGATOR_UNAVAILABLE");
    expect(await t.api.patchCount()).toBe(0);
  });

  it("ADS_MODE=SANDBOX without configuration fails closed", async () => {
    t = await boot({}, { env: { ADS_MODE: "SANDBOX" } });
    const h = (await t.api.get("/api/health")).body;
    expect(h.adsProvider).toContain("UNCONFIGURED");
    await t.api.load("A");
    const { delivery } = await t.api.emit();
    const v = await t.api.view(delivery.body.investigationId);
    expect(v.decision).toBe("BLOCKED");
    expect(v.decisionCode).toBe("BLOCKED_ADS_UNAVAILABLE");
  });
});
