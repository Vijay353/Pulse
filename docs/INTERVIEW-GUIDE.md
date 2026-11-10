# Interview guide

## 60-second pitch

"MarginPulse is a narrow control loop: when a restaurant's kitchen passes the limit the manager set, and a Sponsored Listings campaign is still buying demand, it gathers the evidence, computes an estimated contribution in code, and offers one action — pause that campaign. Nothing changes until a manager approves. Then it sends exactly one PATCH to a stateful Uber Ads simulator and only calls it done when a readback shows both configured and effective status paused. Everything is synthetic and local, and every boundary to a real vendor is a port that fails closed."

## Likely questions

**Why an agent at all?** It isn't needed for arithmetic or permissions. It's justified for joining differently shaped evidence and explaining it — and it's constrained: read-only tools, cited evidence that must match stored values, a closed action catalog, a step budget. The default is a deterministic investigator so the system works without a model. Policy never reads the agent's prose.

**What if the model hallucinates?** Fabricated evidence ids, cited values that don't match the evidence, off-catalog actions and savings claims are all rejected (tests in `agent-safety.test.ts`). A rejected report blocks; it can never cause a pause.

**How do you avoid double-pausing on webhook retries?** Event id insert is synchronous and unique; duplicates return the prior investigation. The write has its own idempotency key reserved before the call; a succeeded or unresolved attempt blocks further writes.

**What happens if the PATCH times out?** It's ambiguous, so we don't retry. We read the campaign: PAUSED with a newer version means it applied; ACTIVE with the reviewed version means it didn't, and the manager can retry with the same approval. If the readback also fails, retries stay blocked until a later check resolves it.

**What's the concurrency story?** Pre-write re-read compares version, status, store scope and permission. Uber's documented PATCH has no version precondition, so a small race remains; I flagged it rather than pretend otherwise.

**Why is contribution not profit?** The inputs are subtotal, an estimated fee, merchant-supplied food and packaging, and allocated ad spend. Labor, rent, taxes, refunds and incrementality are excluded, and the UI says that next to the number.

**How would this go to production?** Real auth, Uber approval and OAuth lifecycle, the async reporting API, real store scoping, a POS partner feed for kitchen load, a managed database, observability, and user research before any value claim. See IMPLEMENTATION-STATUS.

**What would you build next?** A separately authorized resume flow with a reminder, and multi-campaign selection with an explicit rule — both only after discovery shows managers want them.

## Code tour (5 minutes)

1. `packages/mock-pos/src/plugin.ts` — signed event emission.
2. `apps/api/src/orchestration/orchestrator.ts` — `receiveEvent`, `assess`, `approve`, `pause`, `verify`.
3. `apps/api/src/policy/policyEngine.ts` — ordered checks; `contribution.ts` — integer cents.
4. `apps/api/src/agents/validateReport.ts` — citation and value checks.
5. `apps/api/src/tools/pauseCampaign.ts` — the single write and readback classification.
6. `packages/mock-uber-ads/src/plugin.ts` — documented shapes, faults, ledger.
7. `tests/integration/scenarios.test.ts` — failure modes.
