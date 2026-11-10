# Integrations

Every external dependency sits behind a port (`apps/api/src/adapters/ports.ts`). The default build uses local simulators. Nothing here has been tested against a real vendor; vendor-specific items marked **TO_VERIFY** must be confirmed with the vendor before use.

## 1. Uber Ads API

| Item | Detail |
|---|---|
| Purpose | Read Sponsored Listings campaigns and reports; set one campaign's `configured_status` to PAUSED |
| Official docs (checked 2026-10-18) | [Introduction](https://developer.uber.com/docs/ads/introduction) · [Quick start](https://developer.uber.com/docs/ads/get-started/quick-start) · [Campaign model](https://developer.uber.com/docs/ads/references/models/v1/campaign) · [OpenAPI](https://developer.uber.com/integration-resources/ads/openapi.json) · [FAQ](https://developer.uber.com/docs/ads/faq) |
| Port | `UberAdsPort`: `listCampaigns`, `getCampaign`, `getLatestReport`, `setConfiguredStatus`, `stateDigest` |
| Adapter | `HttpUberAdsAdapter` (same code for simulator and real endpoint); `UnconfiguredAdsAdapter` when setup is incomplete |
| Prerequisites | Uber Ads API access approved for your organization; the store linked to the ad account; an OAuth access token for a user with access to that account. Creating a developer account does not guarantee production access. |
| Scopes | `ads.campaigns.read`, `ads.campaigns.write` (VERIFIED names) |
| Env keys | `ADS_MODE=SANDBOX|LIVE`, `UBER_ADS_BASE_URL`, `UBER_ADS_TOKEN`, `ALLOW_LIVE_UBER_WRITES=true` (LIVE only), `ADS_TIMEOUT_MS` |
| Credential storage | Server-side env or a secret manager. Never in the browser, fixtures, workbooks or logs. Persisted requests store `Bearer [REDACTED]`. |

### Request/response mapping

| Domain | Uber field | Status |
|---|---|---|
| campaign id | `campaign_id` | VERIFIED |
| configured status | `configured_status` (ACTIVE/PAUSED on update) | VERIFIED |
| serving state | `effective_status` → SERVING/NOT_SERVING/UNKNOWN via `mapServing()` | **TO_VERIFY** values (docs inconsistent) |
| reasons | `effective_status_reasons[]` | VERIFIED field |
| permissions | `permissions[]` ∋ `UPDATE` | VERIFIED enum |
| revision | `version` | VERIFIED field |
| store scope | ad groups / targeting → `storeIds` | **TO_VERIFY**: the mock's `store_ids` is a simplification; a real adapter must derive store scope from ad groups or the store-linking API |
| product | Sponsored Listing vs other | **TO_VERIFY** |
| report | `POST /v1/ads/{account_id}/reporting/report` + `GET /reporting/{report_id}` | VERIFIED paths; field mapping **not implemented** |

### Steps to connect a sandbox

1. Obtain sandbox access and a test ad account from Uber (TO_VERIFY whether an Ads sandbox exists for your program).
2. Set `ADS_MODE=SANDBOX`, `UBER_ADS_BASE_URL`, `UBER_ADS_TOKEN`. Start the app; `GET /api/health` must show no `ads` problems except the reporting one.
3. Implement `getLatestReport` against the asynchronous reporting API (create report → poll → map to `CampaignReport` with an explicit watermark). Until then investigations stay **blocked**.
4. Replace `storeIds` derivation with real ad-group/store targeting.
5. Confirm effective-status values for a paused campaign and extend `SERVING_STATUSES` / `NOT_SERVING_STATUSES`.
6. Live smoke test (read-only first): `GET /v1/ads/{account}/campaigns?campaign_id=…` through the adapter; compare with the Uber UI.
7. Only then, a single supervised pause on a test campaign; verify readback; resume manually in Uber's UI.
8. For LIVE, add `ALLOW_LIVE_UBER_WRITES=true` — an explicit second switch.

**Health check:** `GET /api/health` (problems list). **Rate limits:** 429 documented without quotas; reads retry with jitter (max 3), the write never retries automatically. **Rollback:** set `ADS_MODE=SIMULATED`; resume any paused campaign in Uber's UI (MarginPulse has no resume).

## 2. POS / KDS

| Item | Detail |
|---|---|
| Purpose | Kitchen-load trigger + current snapshot + merchant cost profile |
| Port | `PosPort`: `getKitchenSnapshot`, `getCostProfile`, `stateDigest`; inbound webhook contract `KitchenLoadEvent` |
| Reality | No universal public KDS-capacity API is assumed. Toast documents [stock webhooks](https://doc.toasttab.com/doc/devguide/apiStockWebhook.html) and Square an [Inventory API](https://developer.squareup.com/docs/inventory-api/what-it-does); neither is a kitchen-utilization feed. A real integration needs a partner agreement or a middleware that computes P95 prep time from order/ticket events (**TO_VERIFY** per POS). |
| Env keys | `POS_BASE_URL`, `POS_WEBHOOK_SECRET`, `WEBHOOK_URL` |
| Webhook | `POST /api/events/kitchen-load`, HMAC-SHA256 hex over canonical JSON (keys sorted, `signature` excluded). The partner would need to adopt this or an adapter would translate their signature scheme. |
| Steps | Build a partner adapter implementing `PosPort` against the POS's API; map store ids in `store_mappings`; configure the shared secret; replay a recorded event; verify freshness handling with the partner's real latency. |

## 3. Model provider (optional investigator)

| Item | Detail |
|---|---|
| Purpose | Optional `LlmInvestigator` that drives the same read-only tools |
| Port | `ModelProvider.createMessage(system, messages, tools, maxTokens)` |
| Adapter | `AnthropicProvider` — Messages API over `fetch` (`POST {ANTHROPIC_BASE_URL}/v1/messages`, headers `x-api-key`, `anthropic-version: 2023-06-01`, tool-use blocks). Docs: https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools |
| Env keys | `INVESTIGATOR=llm`, `ANTHROPIC_API_KEY`, `LLM_MODEL` (no default is assumed) |
| Limits | 8 tool-loop steps, 1500 output tokens per call, 30 s timeout |
| Safety | Output must pass the same Zod schema, citation and value checks as the fixture investigator; policy never reads the prose; no write tools exist |
| Tested | Only with a scripted fake provider (`tests/integration/agent-safety.test.ts`). **Not tested against a real model.** |

## 4. Not integrated (by design)

Uber Eats Marketplace APIs (menus, store status, promotions, prep time), Mobility data, dispute APIs, messaging. See the non-goals in the spec and [DECISION-LOG.md](DECISION-LOG.md).
