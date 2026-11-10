# Simulator contracts

Both simulators are **interoperable behavioral simulators** of the narrow capabilities this workflow uses. They are not clones and not vendor-certified. Evidence labels: **VERIFIED** (matches the public Uber Ads OpenAPI / model page, checked 2026-10-18), **TO_VERIFY** (assumption), **MOCK-ONLY** (exists only here).

## Mock Uber Ads (`packages/mock-uber-ads`)

### Entities

| Entity | Key fields | Notes |
|---|---|---|
| Ad account | `account_id`, `name`, `currency` | |
| Account store | `account_id`, `uber_store_id` | |
| Token | `sha256(token)`, `scopes`, `account_ids` | Only the hash is stored. Scopes `ads.campaigns.read`, `ads.campaigns.write` (VERIFIED names). |
| Campaign | `campaign_id`, `configured_status`, `permissions`, `version`, `budget`, `updated_at`, `updated_by` | `product` and `store_ids` are MOCK-ONLY simplifications of ad-group targeting. |
| Report | `report_id`, window, `watermark`, attributed orders, sales, spend | MOCK-ONLY shape. |
| Mutation ledger | before/after per field, versions, request id, source | Observability (`API`, `IMPORT`, `RESTORE`, `EXTERNAL_SIM`). |

### Endpoints

| Method & path | Status | Behavior |
|---|---|---|
| `GET /v1/ads/ad-accounts` | VERIFIED path | Bearer auth, read scope |
| `GET /v1/ads/{ad_account_id}/stores` | VERIFIED path | |
| `GET /v1/ads/{account_id}/campaigns?campaign_id=&page_limit=` | VERIFIED path and filter | Single-campaign readback uses the list filter, as documented. Returns `configured_status`, `effective_status`, `effective_status_reasons`, `permissions`, `version`. |
| `PATCH /v1/ads/{account_id}/campaigns` | VERIFIED path, body and `results[]` response | Body `{campaigns:[{campaign_id, configured_status}]}`. Requires write scope (403) and per-campaign `UPDATE` (item `failure` `PERMISSION_DENIED`). Only ACTIVE/PAUSED accepted (VERIFIED input enum). Changing status increments `version`, sets `updated_at/by`, writes the ledger. No-op updates return success without a version bump. Budget updates are rejected as `UNSUPPORTED_IN_MOCK`. |
| `GET /mock-ads/{account_id}/reports?campaign_id=` | MOCK-ONLY | Real reporting is asynchronous (`POST /v1/ads/{account_id}/reporting/report`, VERIFIED path). |
| `POST/GET/DELETE /mock-ads/faults` | MOCK-ONLY | `{op: PATCH_CAMPAIGNS|GET_CAMPAIGNS|GET_REPORTS|ANY, mode, remaining, param}` |
| `POST /mock-ads/simulate/external-edit` | MOCK-ONLY | Renames the campaign and bumps its version (another manager). |
| `GET /mock-ads/ledger?campaign_id=&order=desc&limit=`, `GET /mock-ads/requests` | MOCK-ONLY | Change log and request log. Filters added in V3 CH-1 (all optional, default unchanged). |
| `GET /mock-ads/admin/digest?exclude_campaign=` | MOCK-ONLY probe | SHA-256 of all ads business state except one campaign. |

### Fault modes

`HTTP_401`, `HTTP_403`, `HTTP_404`, `HTTP_429` (body `{code:"RateLimitExceeded"}` — VERIFIED example), `HTTP_500` (not applied), `HTTP_500_AFTER_APPLY` (applied, then 500), `DROP_BEFORE_APPLY`, `DROP_AFTER_APPLY` (socket destroyed, no response), `LATENCY` (param ms), `DELAYED_EFFECTIVE` (param ms: effective stays ACTIVE after a pause).

### Known differences from Uber (TO_VERIFY)

- **Effective status values.** Uber's model page lists `CAMPAIGN_EFFECTIVE_STATUS_ELIGIBLE / NOT_ELIGIBLE`; the OpenAPI example shows `CAMPAIGN_EFFECTIVE_STATUS_ACTIVE`. The spec's `CAMPAIGN_EFFECTIVE_STATUS_PAUSED` is unconfirmed. The mock emits ACTIVE/PAUSED/NOT_ELIGIBLE; the adapter maps strings to `SERVING / NOT_SERVING / UNKNOWN` and **unknown values fail verification**.
- **Item vs HTTP errors.** Which failures are HTTP errors vs `results[].failure` items is assumed.
- **No optimistic concurrency on PATCH.** The documented body has no version field.
- **Rate limits.** 429 is documented; quotas and `Retry-After` are not.
- **Auto-resume.** The spec cites Uber's FAQ saying external auto-resume is not planned; the FAQ page as rendered on 2026-10-18 did not show that line. The design does not depend on it: pauses persist until resumed.

## Mock POS/KDS (`packages/mock-pos`)

The kitchen-capacity shape is a **mocked partner extension**, not Toast's or Square's API.

| Method & path | Behavior |
|---|---|
| `POST /mock-pos/events {storeId}` | Builds `KitchenLoadThresholdBreached` from the latest snapshot (event time = now; snapshot may be older), signs with HMAC-SHA256, stores it in the outbox and delivers it to `/api/events/kitchen-load`. |
| `POST /mock-pos/events/{eventId}/redeliver` | Webhook retry of the same payload. |
| `POST /mock-pos/events/forged {storeId}` | Delivers an event with an invalid signature. |
| `GET /mock-pos/stores/{id}` | Store master data `{storeId, name, timezone}` (V3 CH-1). Not subject to `POS_UNAVAILABLE`, which targets kitchen and cost reads. |
| `GET /mock-pos/stores/{id}/kitchen-snapshot` | Latest snapshot: P95, active tickets, connector health, captured time. 503 under `POS_UNAVAILABLE`. |
| `GET /mock-pos/stores/{id}/cost-profile` | Merchant-supplied food & packaging cost (cents) and fee rate (bps); nulls allowed. |
| `POST/GET/DELETE /mock-pos/faults` | `POS_UNAVAILABLE` for N reads. |
| `GET /mock-pos/outbox[?order=desc&limit=]`, `GET /mock-pos/admin/digest` | Observability / probe. |

## MarginPulse services

| Method & path | Notes |
|---|---|
| `POST /api/events/kitchen-load` | Webhook (HMAC, not CSRF). 202 new, 200 duplicate, 401 bad signature, 400 schema. |
| `GET /api/investigations[/:id]`, `GET /api/investigations/:id/audit` | Read model and audit (with chain verification). |
| `POST /api/investigations/:id/approve {acknowledgeWarnings?}` · `/dismiss {reason}` · `/pause-campaign {approvalId}` · `/verify` · `/reassess` | CSRF + demo identity. When the investigation has a possible repeat alert (V3 CH-6), approve requires `acknowledgeWarnings: ["POSSIBLE_REPEAT_ALERT"]` or returns 409 `WARNING_NOT_ACKNOWLEDGED`. |
| `GET /policies/:storeId/rush-control` · `POST /approvals` · `GET /approvals/:id` | Spec §15.3–15.4. |
| `GET /api/investigations/:id` field `evidenceMatrix` | V3 CH-19. One row per check: `PASS`, `FAIL`, `WARN` or `NOT_EVALUATED`, with evidence ids, detail, time and rule version. Built from stored policy and execution checks only. `NOT_EVALUATED` means the check has not run. Read-only: it cannot release a write. |
| `GET /api/investigations/:id/evidence-package` | V3 CH-18. Canonical JSON audit evidence package. Requires a demo identity assigned to the store (403 otherwise). Headers `X-Evidence-SHA256` (file checksum, not a signature) and `X-Evidence-Status` (`complete`, `partial`, `unverifiable`). Includes `evidenceMatrix` (CH-19), the same object the investigation view returns. |
| `GET /api/audit/verify` | V3 CH-17. Chain report: `ok`, `brokenAt`, `problem`, `coverage` per hash format, `gaps`, `head`, `headSeq`, `limits`. |
| `/api/scenarios`, `/api/sim/*`, `/api/data/*` | Demo controls and data studio. |
