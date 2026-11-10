# Test report

## V3 update (2026-11-09)

Final counts after the V3 changes, from an actual run on the same sandbox (Node 22.22.0, Playwright 1.56.1 Chromium):

| Command | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run lint` | exit 0 |
| `npm test` (Vitest) | **219 passed / 0 failed** in 28 files (unit 101, integration 118). The original 81 are included and unchanged. |
| `npm run test:e2e` (Playwright) | **22 passed / 0 failed**: 18 on the normal server (the original 6 included) and 4 on a second server with the visitor gate on |
| `npm run scan:secrets` | 126 source files + 3 client bundle files, no findings (now also checks for committed access PINs and `ACCESS_PIN`/`SESSION_SECRET` in the bundle) |
| `npm run build`, `npm run test:all` | exit 0 |
| `npm audit` | 13 moderate advisories (4 in runtime dependencies), newly published since the run below; not fixed, see `V3-CHANGE-REPORT.md` section 6 |

Details per change, the baseline re-run and verbatim output: [V3-CHANGE-REPORT.md](V3-CHANGE-REPORT.md). The rest of this file is the original 2026-10-18 report, kept as historical record.

Run on 2026-10-18 in the build sandbox (Linux, Node 22.22.0, Chromium 141 via Playwright 1.56.1). Counts below are from the actual run; nothing is extrapolated.

## Commands and results

| Command | Result |
|---|---|
| `npm run typecheck` (tsc strict, `noUncheckedIndexedAccess`) | pass, 0 errors |
| `npm run lint` (ESLint + typescript-eslint + react-hooks) | pass, 0 problems |
| `npm test` (Vitest) | **81 passed / 0 failed** in 5 files |
| `npm run test:e2e` (Playwright, Chromium) | **6 passed / 0 failed**; run 3× consecutively without flakes after fixing a UI race (see below) |
| `npm run scan:secrets` | pass: 72 source/doc files + 3 client bundle files, no secrets or server-only config names |
| `npm audit` | 0 vulnerabilities (after overriding `uuid` ≥ 11.1.1 pulled in by ExcelJS) |
| `npm run test:all` | exit 0 (typecheck, lint, Vitest, Playwright, secret scan) |

Integration tests start the real server on an ephemeral port with an in-memory database and exercise it over HTTP: the mock POS really delivers signed webhooks, and MarginPulse really calls the Uber Ads simulator through the HTTP adapter.

## Acceptance matrix (master contract §11 and spec §20)

| Requirement | Evidence | Status |
|---|---|---|
| App starts, core page renders | e2e all; `GET /api/health` | EXECUTED_AND_VERIFIED |
| Valid input/import reaches persisted state | data-import: commit + re-query, workflow uses imported data | EXECUTED_AND_VERIFIED |
| Real trigger → correct decision | vertical-slice A; scenarios B–R | EXECUTED_AND_VERIFIED |
| Simulator endpoint actually invoked | PATCH count via request log; ledger row with request id | EXECUTED_AND_VERIFIED |
| State change + independent readback | test reads campaign directly from `/v1/ads/...` after the flow | EXECUTED_AND_VERIFIED |
| Wrong permission / invalid transition / missing approval rejected | F, 401, staff/other-store, `APPROVAL_REQUIRED`, `INVALID_TRANSITION` | EXECUTED_AND_VERIFIED |
| Duplicate command does not double-apply | H (3 deliveries, repeat pause) | EXECUTED_AND_VERIFIED |
| Stale revision / concurrent update rejected | G; import stale revision (preview and commit-time) | EXECUTED_AND_VERIFIED |
| Timeout, 429, 5xx handled | I, I′, 500-after-apply, M | EXECUTED_AND_VERIFIED |
| Partial failure + retry without contradictions | I′ (2 attempts, 1 applied), M | EXECUTED_AND_VERIFIED |
| Ambiguous cases explainable | J (still serving), PAUSE_OUTCOME_UNCONFIRMED path | EXECUTED_AND_VERIFIED (J); unconfirmed-readback path IMPLEMENTED, not separately tested |
| Reset/replay; logs from execution | every test reloads a scenario; audit chain verified | EXECUTED_AND_VERIFIED |
| Excel schema, data quality, formula safety | 8 invalid fixtures, export escaping, round-trip | EXECUTED_AND_VERIFIED |
| UI controls invoke real handlers | e2e success, G, keyboard, data studio | EXECUTED_AND_VERIFIED |
| Responsive + keyboard | e2e 375 px no horizontal scroll; keyboard-only dismiss + inspector | EXECUTED_AND_VERIFIED |
| Secrets not in client build / source | secret scan | EXECUTED_AND_VERIFIED |
| Agent safety (fabricated refs, off-catalog action, persuasion, budget) | agent-safety (scripted provider) | EXECUTED_AND_VERIFIED (plumbing only; no real model) |
| Contribution never labeled profit; watermark shown; "stays paused" shown | e2e success assertions | EXECUTED_AND_VERIFIED |
| First-time user understands in 30 s (spec #28) | — | NOT_VERIFIED (needs user testing) |
| WCAG AA contrast, 200 % zoom | palette chosen for AA; not measured with a tool | NOT_VERIFIED |

## Defects found and fixed during the build

1. **UI showed the parent investigation after re-assess** — the post-action refresh used a stale closure id. Fixed with a ref; caught by the e2e G test.
2. **Initial-load race** — the startup fetch could overwrite a scenario the user had just loaded. Controls are now disabled until initialization finishes.
3. **Static assets 404 after rebuild** — `@fastify/static` with `wildcard:false` cached the file list at startup. Switched to wildcard serving.
4. **Phone-width overflow** — scenario select forced 412 px; fixed and now asserted in e2e.
5. Copy on the verified screen implied a kitchen outcome ("gets room to catch up"); replaced with a factual statement.

## Known omissions

- No test against real Uber Ads, a real POS or a real model.
- No load/concurrency test beyond the synchronous idempotent insert.
- No automated contrast/axe audit; no screen-reader run.
- Zip-bomb style XLSX (small compressed, huge expanded) is bounded only by row/column limits after parsing.

## Vitest cases (81)

- integration/scenarios.test.ts › decision outcomes › scenario B → NO_ACTION (NO_ACTION_BELOW_THRESHOLD), no approval, no write
- integration/scenarios.test.ts › decision outcomes › scenario C → BLOCKED (BLOCKED_STALE_KITCHEN_DATA), no approval, no write
- integration/scenarios.test.ts › decision outcomes › scenario D → NEEDS_REVIEW (NEEDS_REVIEW_STALE_ADS_DATA), no approval, no write
- integration/scenarios.test.ts › decision outcomes › scenario E → NEEDS_REVIEW (NEEDS_REVIEW_CAMPAIGN_SELECTION), no approval, no write
- integration/scenarios.test.ts › decision outcomes › scenario F → BLOCKED (BLOCKED_MISSING_PERMISSION), no approval, no write
- integration/scenarios.test.ts › decision outcomes › scenario O → NEEDS_REVIEW (NEEDS_REVIEW_STORE_MAPPING), no approval, no write
- integration/scenarios.test.ts › decision outcomes › scenario P → NO_ACTION (NO_ACTION_CONTRIBUTION_OK), no approval, no write
- integration/scenarios.test.ts › decision outcomes › scenario Q → NEEDS_REVIEW (NEEDS_REVIEW_COST_DATA), no approval, no write
- integration/scenarios.test.ts › decision outcomes › scenario R → BLOCKED (BLOCKED_POS_UNAVAILABLE), no approval, no write
- integration/scenarios.test.ts › decision outcomes › B: event arrives (POS alert at 22) but MarginPulse re-checks the merchant limit (28)
- integration/scenarios.test.ts › decision outcomes › D: active campaign is still shown with the report watermark
- integration/scenarios.test.ts › decision outcomes › E: agent abstains instead of picking the higher-budget campaign
- integration/scenarios.test.ts › decision outcomes › P: injected campaign-name text does not change the decision
- integration/scenarios.test.ts › execution reliability › G: version change after approval blocks the write; re-assess requires a new approval
- integration/scenarios.test.ts › execution reliability › H: three deliveries of the same event → one investigation, one PATCH
- integration/scenarios.test.ts › execution reliability › I: dropped connection after apply → no retry, readback verifies
- integration/scenarios.test.ts › execution reliability › I': dropped connection BEFORE apply → readback proves not applied → explicit retry allowed
- integration/scenarios.test.ts › execution reliability › 5xx after apply is ambiguous and resolved by readback (no blind retry)
- integration/scenarios.test.ts › execution reliability › J: configured PAUSED but effective ACTIVE is not success until a later check
- integration/scenarios.test.ts › execution reliability › K: dismiss stores the reason and never mutates
- integration/scenarios.test.ts › execution reliability › L: there is no resume path anywhere in the API
- integration/scenarios.test.ts › execution reliability › M: 429 on PATCH gives a truthful not-applied status and a manual retry succeeds
- integration/scenarios.test.ts › execution reliability › 401 from Uber Ads on the write blocks truthfully
- integration/scenarios.test.ts › execution reliability › policy changed after approval blocks execution
- integration/scenarios.test.ts › execution reliability › expired approval and stale recommendation are rejected
- integration/scenarios.test.ts › access and isolation › staff cannot approve; a manager of another store cannot approve or pause
- integration/scenarios.test.ts › access and isolation › an approval for one investigation/campaign cannot authorize another
- integration/scenarios.test.ts › access and isolation › mutating routes require the CSRF token and a known demo identity
- integration/scenarios.test.ts › access and isolation › N: forged webhook is rejected and creates no investigation
- integration/scenarios.test.ts › access and isolation › tampered payload with a once-valid signature is rejected
- integration/scenarios.test.ts › access and isolation › an old (replayed/backlogged) signed event is blocked as stale; staleness via clock is also caught
- integration/data-import.test.ts › template and export › downloads a template with README + every entity sheet
- integration/data-import.test.ts › template and export › export neutralizes formula injection and round-trips through import
- integration/data-import.test.ts › import pipeline › re-importing the canonical sample is idempotent (all unchanged)
- integration/data-import.test.ts › import pipeline › preview does not mutate; commit persists atomically; re-query confirms; workflow uses the new data
- integration/data-import.test.ts › import pipeline › CSV merge for one entity changes simulator state the workflow then reads
- integration/data-import.test.ts › import pipeline › invalid/missing-sheet.xlsx is rejected with a row-level error and cannot be committed
- integration/data-import.test.ts › import pipeline › invalid/wrong-types.xlsx is rejected with a row-level error and cannot be committed
- integration/data-import.test.ts › import pipeline › invalid/duplicate-ids.xlsx is rejected with a row-level error and cannot be committed
- integration/data-import.test.ts › import pipeline › invalid/orphan-reference.xlsx is rejected with a row-level error and cannot be committed
- integration/data-import.test.ts › import pipeline › invalid/invalid-status.xlsx is rejected with a row-level error and cannot be committed
- integration/data-import.test.ts › import pipeline › invalid/formula-cell.xlsx is rejected with a row-level error and cannot be committed
- integration/data-import.test.ts › import pipeline › invalid/excel-date-cell.xlsx is rejected with a row-level error and cannot be committed
- integration/data-import.test.ts › import pipeline › invalid/stale-revision.xlsx is rejected with a row-level error and cannot be committed
- integration/data-import.test.ts › import pipeline › rejects oversized, non-spreadsheet and CSV-replace uploads
- integration/data-import.test.ts › import pipeline › rejects a commit when the world changed after preview (stale revision at commit time)
- integration/data-import.test.ts › import pipeline › record browser shows state changed by a real workflow action
- integration/agent-safety.test.ts › LlmInvestigator contract (scripted provider) › an honest tool-using model reaches the same decision as the FixtureInvestigator
- integration/agent-safety.test.ts › LlmInvestigator contract (scripted provider) › fabricated evidence reference → BLOCKED_INVALID_AGENT_OUTPUT
- integration/agent-safety.test.ts › LlmInvestigator contract (scripted provider) › cited value that contradicts the evidence → BLOCKED_INVALID_AGENT_OUTPUT
- integration/agent-safety.test.ts › LlmInvestigator contract (scripted provider) › action outside the catalog → BLOCKED_INVALID_AGENT_OUTPUT
- integration/agent-safety.test.ts › LlmInvestigator contract (scripted provider) › savings/profit claims in the summary are rejected
- integration/agent-safety.test.ts › LlmInvestigator contract (scripted provider) › persuasive wording cannot override policy (below-threshold kitchen stays NO_ACTION)
- integration/agent-safety.test.ts › LlmInvestigator contract (scripted provider) › model that never finishes hits the step budget and the decision fails closed
- integration/agent-safety.test.ts › LlmInvestigator contract (scripted provider) › agent abstaining on otherwise pause-eligible facts → NEEDS_REVIEW, not a pause
- integration/agent-safety.test.ts › LlmInvestigator contract (scripted provider) › INVESTIGATOR=llm without credentials fails closed (no silent fallback)
- integration/agent-safety.test.ts › LlmInvestigator contract (scripted provider) › ADS_MODE=SANDBOX without configuration fails closed
- integration/vertical-slice.test.ts › vertical slice — Example A (success) › recommends, waits for approval, pauses exactly once and verifies by readback
- integration/vertical-slice.test.ts › vertical slice — Example C (negative) › blocks on a stale kitchen snapshot and never offers approval
- unit/domain.test.ts › contribution calculator (integer cents) › reproduces the spec fixture exactly: 28.00 − 5.60 − 11.40 − 7.80 = 3.20 (11.4%)
- unit/domain.test.ts › contribution calculator (integer cents) › uses exact comparison at the boundary (exactly 20% is NOT below the floor)
- unit/domain.test.ts › contribution calculator (integer cents) › abstains on missing or invalid inputs instead of guessing
- unit/domain.test.ts › contribution calculator (integer cents) › handles negative contribution
- unit/domain.test.ts › policy engine ordering › all checks pass → RECOMMEND_PAUSE with approval and re-read pending
- unit/domain.test.ts › policy engine ordering › stale event → { eventAgeS: 121 }
- unit/domain.test.ts › policy engine ordering › mapping → { mappingCount: 2 }
- unit/domain.test.ts › policy engine ordering › pos degraded → { connectorHealth: 'DEGRADED' }
- unit/domain.test.ts › policy engine ordering › snapshot boundary → { snapshotAgeS: 121 }
- unit/domain.test.ts › policy engine ordering › policy changed → { policyVersionNow: 'p-v4' }
- unit/domain.test.ts › policy engine ordering › below threshold → { p95: 27.9 }
- unit/domain.test.ts › policy engine ordering › two campaigns → { eligibleCampaignIds: [ 'c1', 'c2' ] }
- unit/domain.test.ts › policy engine ordering › read only → { campaignPermissions: [ 'READ' ] }
- unit/domain.test.ts › policy engine ordering › ads stale → { reportAgeS: 901 }
- unit/domain.test.ts › policy engine ordering › agent fabricated → { agent: [Object] }
- unit/domain.test.ts › policy engine ordering › agent picks other campaign → { agent: [Object] }
- unit/domain.test.ts › policy engine ordering › threshold is inclusive (p95 == limit breaches)
- unit/domain.test.ts › security and mapping helpers › HMAC signature verifies and detects tampering
- unit/domain.test.ts › security and mapping helpers › effective status mapping fails closed on unknown values
- unit/domain.test.ts › security and mapping helpers › banned claims are detected; neutral language passes
- unit/domain.test.ts › security and mapping helpers › time-zone aware ISO formatting
- unit/domain.test.ts › audit log › is hash-chained and append-only at the database level

## Playwright cases (6)

- success: alert → recommendation → confirm → verified by readback
- negative: stale kitchen data blocks and offers no pause
- negative: campaign changed after review blocks without a PATCH
- keyboard: review, dismiss with a reason, and inspect without a mouse
- responsive: no horizontal scroll at phone width
- data studio: invalid workbook is rejected; valid merge commits and changes the next decision
