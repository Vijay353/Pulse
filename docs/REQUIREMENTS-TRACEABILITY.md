# Requirements traceability

Evidence class: V = VERIFIED vendor fact, S = spec requirement, P = proposed design. Status uses the master-contract vocabulary.

| ID | Requirement | Source | Class | Implementation | Test | Status |
|---|---|---|---|---|---|---|
| R1 | One event `KitchenLoadThresholdBreached`, signed | spec §9, §19 | S | `packages/mock-pos/src/plugin.ts`, `security/signature.ts` | vertical-slice; scenarios N, tamper | EXECUTED_AND_VERIFIED |
| R2 | Dedupe by eventId, return prior result | §12, §18H | S | `orchestrator.receiveEvent` | scenarios H | EXECUTED_AND_VERIFIED |
| R3 | Event, snapshot, report freshness limits from policy | §12 | S | `policyEngine.STEPS` | scenarios C, D, stale event; unit boundaries | EXECUTED_AND_VERIFIED |
| R4 | Store maps to exactly one Uber store | §12 | S | `toolRegistry.campaigns`, policy | scenario O | EXECUTED_AND_VERIFIED |
| R5 | POS health required | §12 | S | policy `pos_health` | scenario R; unit | EXECUTED_AND_VERIFIED |
| R6 | Policy version unchanged (assessment and execution) | §12 | S | policy + `orchestrator.pause` | policy changed test; unit | EXECUTED_AND_VERIFIED |
| R7 | Threshold check (inclusive) | §12 | S | policy | B; unit | EXECUTED_AND_VERIFIED |
| R8 | Exactly one eligible campaign; no auto-pick | §12, §18E | S | `isEligible`, policy | E | EXECUTED_AND_VERIFIED |
| R9 | UPDATE permission required | §3.2 | V | policy + pre-write + mock PATCH | F, 401 | EXECUTED_AND_VERIFIED |
| R10 | Contribution in deterministic integer code; exact fixture | §10 | S | `policy/contribution.ts` | unit fixture + boundary | EXECUTED_AND_VERIFIED |
| R11 | Missing cost data → review | §12 | S | calculator abstains | Q; unit | EXECUTED_AND_VERIFIED |
| R12 | Agent read-only tools, schema-valid cited output, closed catalog | §11 | S | `agents/*` | agent-safety | EXECUTED_AND_VERIFIED |
| R13 | Agent cannot override policy | §11, §19 | S | policy reads evidence only | persuasive-wording test, P | EXECUTED_AND_VERIFIED |
| R14 | FixtureInvestigator default; LlmInvestigator optional, same contract | §11 | S | `investigators.ts` | agent-safety parity | EXECUTED_AND_VERIFIED (scripted provider) |
| R15 | Manager approval bound to investigation/store/campaign/action/policy/user/expiry | §15.4 | S | `orchestrator.approve/pause` | access tests, expiry, reuse | EXECUTED_AND_VERIFIED |
| R16 | No write before approval | §20.5 | S | state machine | vertical-slice | EXECUTED_AND_VERIFIED |
| R17 | Pre-write re-read: ACTIVE, version, store scope | §13 | S | `tools/pauseCampaign.ts` | G | EXECUTED_AND_VERIFIED |
| R18 | Exactly one PATCH; documented path/body | §13 | V | `HttpUberAdsAdapter.setConfiguredStatus` | vertical-slice, H | EXECUTED_AND_VERIFIED |
| R19 | Idempotency key stored before call; no blind retry after ambiguity | §13 | S | `mp_mutations` | I, I′, 500-after-apply | EXECUTED_AND_VERIFIED |
| R20 | Verified only when configured AND effective paused | §5.6, §20.21 | S/V | `isVerified`, `mapServing` | J | EXECUTED_AND_VERIFIED |
| R21 | Truthful recoverable 429 | §20.22 | S | not-applied path + retry | M | EXECUTED_AND_VERIFIED |
| R22 | Dismiss with reason, no mutation | §18K | S | `orchestrator.dismiss` | K; e2e keyboard | EXECUTED_AND_VERIFIED |
| R23 | No resume, no auto-resume | §3.3, §18L | S | absent by design | L | EXECUTED_AND_VERIFIED |
| R24 | Immutable audit linked to event and approval | §9, §19 | S | `audit/audit.ts` triggers + hash chain | vertical-slice, unit | EXECUTED_AND_VERIFIED |
| R25 | No other state changed | §9 | S | simulator digest probes | vertical-slice `otherMutations: NONE` | EXECUTED_AND_VERIFIED (simulator only) |
| R26 | UI: header, statement, three cards, confirm, result, collapsed inspector | §17 | S | `apps/web/src` | e2e success | EXECUTED_AND_VERIFIED |
| R27 | Language rules: no profit/savings/lift/fiduciary | §2, §17 | S | copy + `BANNED_CLAIM_PATTERNS` | agent-safety; e2e | EXECUTED_AND_VERIFIED |
| R28 | Accessibility: keyboard, focus, aria-live, reduced motion, no color-only status | §17 | S | CSS + semantics + native dialog | e2e keyboard | PARTIAL (contrast/zoom not measured) |
| R29 | Fixture import with row-level Zod-style validation | §15.5 | S | `imports/*` | data-import | EXECUTED_AND_VERIFIED |
| R30 | XLSX template, preview, atomic commit, export with formula safety, restore | master §5 | P | `imports/*`, Data studio | data-import; e2e | EXECUTED_AND_VERIFIED |
| R31 | Provider modes fail closed | master §6 | P | `config.ts`, `UnconfiguredAdsAdapter` | agent-safety (llm, sandbox) | EXECUTED_AND_VERIFIED |
| R32 | Secrets server-side only | §19 | S | config; redaction | secret scan | EXECUTED_AND_VERIFIED |
| R33 | CSRF on approval and mutation endpoints | §19 | S | `requireCsrf` | CSRF test | EXECUTED_AND_VERIFIED |
| R34 | Failure injection controls | §24 | S | mock faults + Simulator panel | I, J, M, R, 401 | EXECUTED_AND_VERIFIED |
| R35 | One-command start and test | §24 | S | `npm start`, `npm run test:all` | run in sandbox | EXECUTED_AND_VERIFIED |
| R36 | 30-second comprehension | §20.28 | S | layout/copy | — | NOT_VERIFIED |
| R37 | Penpot SVG assets | master §8 | P | — | — | NOT_IMPLEMENTED (optional) |
