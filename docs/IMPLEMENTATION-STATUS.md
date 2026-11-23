# Implementation status and limitations

## Real vs simulated vs placeholder

| Component | Status | Notes |
|---|---|---|
| Orchestrator, state machine, policy engine, contribution calculator | **Real code**, executed and tested | Deterministic |
| Approval service, CSRF, role/store checks | **Real code** | Identity is a demo switcher, not authentication |
| Audit log | **Real code** | Append-only via SQLite triggers, hash-chained, verifiable |
| Excel/CSV import, preview, commit, restore, export | **Real code** | Configures simulators only |
| React UI | **Real code** | Reads all state from the server |
| Mock Uber Ads | **SIMULATED** (stateful) | Documented paths/shapes for campaigns; reports MOCK-ONLY |
| Mock POS/KDS | **SIMULATED** (stateful) | Kitchen-capacity feed is a mocked partner extension |
| FixtureInvestigator | **Deterministic local provider** | Rules, not natural-language reasoning |
| LlmInvestigator + AnthropicProvider | **Implemented, not run against a real model** | Plumbing tested with a scripted provider |
| Uber Ads SANDBOX/LIVE | **Adapter skeleton, fails closed** | Campaign calls would work against documented paths; reporting not implemented; store scoping simplified |
| Real POS adapter | **Not implemented** | Port defined |
| Penpot SVG design assets | **Not implemented** (optional) | Real-UI screenshots in `docs/screenshots/` |

## Top production gaps

1. **Authentication and authorization** — replace the demo identity header with real SSO/OAuth and map managers to stores from a directory.
2. **Uber Ads access** — approval from Uber, OAuth token lifecycle (refresh, revocation), asynchronous reporting, real store scoping from ad groups, confirmed effective-status values.
3. **POS data** — no universal kitchen-utilization API; needs a partner integration or middleware that computes P95 from ticket events, with measured latency.
4. **Concurrency** — PATCH has no version precondition (TO_VERIFY); SQLite and a single process; no distributed locking.
5. **Durability and ops** — no backups, migrations framework, metrics, alerting or retention policy for audit data; audit hash chain is tamper-evident only within the DB.
6. **Reset semantics** — demo reset drops all tables including the audit log; production must never offer this.
7. **Resume** — intentionally absent; production would need a separate, authorized resume workflow and reminders.
8. **Accessibility validation** — automated axe scans (WCAG 2.0/2.1/2.2 A+AA) and measured contrast pairs pass (see the pitch-ready register below); no manual screen-reader session with real assistive-technology users yet.
9. **Value claims** — no evidence of user value yet; discovery plan in the spec has not been run.
10. **XLSX parsing** — limits are applied after parsing; a hardened service would cap decompressed size first.

## Scope boundaries kept

No promotions, budgets, menu, store status, prep time, disputes, consumer/courier messaging, Mobility data, forecasting, incrementality, multi-store bulk actions, or automatic resume.

## V3 change register

Changes made under `docs/UNIVERSAL-V3-SPEC.md` (UNIVERSAL V3 controlled enhancement spec). Branch `enhance/marginpulse-v3`, baseline tag `v3-baseline` (commit `0829a07`). A commit cannot contain its own SHA, so each row's SHA is filled in by the next commit; `git log --oneline` is the source of truth.

Statuses: NOT_STARTED, IN_PROGRESS, PASSED, BLOCKED, DEFERRED.

| ID | Status | Git SHA | Test evidence | Migration | Demo effect | Rollback note |
|---|---|---|---|---|---|---|
| CH-1 Domain reads through ports | PASSED | `0a13f91` | `tests/integration/ports.test.ts` (9 tests); baseline 81 + 6 unchanged and green | none | none; scenario A outputs identical | `git revert <CH-1 sha>` or check out `v3-baseline` |
| CH-2 Typed payload accessors | PASSED | `8013f8d` | `tests/unit/tool-results.test.ts` (9), `tests/integration/malformed-pos.test.ts` (4); 90 earlier tests unchanged | none | none | `git revert <CH-2 sha>` |
| CH-3 Consistent summary counters | DEFERRED | `c49d521` | n/a; inspection only | none | none | nothing to roll back |
| CH-4 Multi-part write and undo allocations | DEFERRED | `e1ee031` | n/a; inspection only | none | none | nothing to roll back |
| CH-5 Approval SLA escalation | DEFERRED | `ee29f13` | n/a; inspection only | none | none | nothing to roll back |
| CH-6 Possible repeat alert detection | PASSED | `7617113` | `tests/unit/repeat-alert.test.ts` (7), `tests/integration/repeat-alert.test.ts` (5), `tests/e2e/repeat-alert.spec.ts` (1) | none (stored as an evidence row, kind `REPEAT_CHECK`) | none for A–R; new opt-in scenario S | `git revert <CH-6 sha>` |
| CH-7 Read-only impact projection | PASSED | `58bb0d3` | `tests/unit/projection.test.ts` (4); 3 assertions added (none changed) to the e2e success test | none | confirm dialog shows an "If you approve" table | `git revert <CH-7 sha>` |
| CH-8 Trailing store history | PASSED | `f863f01` | `tests/unit/history.test.ts` (5), `tests/integration/store-history.test.ts` (3) | none | one history line under the investigation header ("No earlier alerts" in A) | `git revert <CH-8 sha>` |
| CH-9 Per-item bulk approvals | DEFERRED | `4312c58` | n/a; inspection only | none | none | nothing to roll back |
| CH-10 Comparison bar (contribution vs floor) | PASSED | `a01a8bf` | `tests/unit/compare.test.ts` (5), `tests/e2e/v3-ui.spec.ts` CH-10 test | none | card 2 shows a bar with printed values and the gap | `git revert <CH-10 sha>` |
| CH-11 Collapsible execution history | PASSED | `b5c1689` | `tests/unit/exec-history.test.ts` (3), `tests/e2e/v3-ui.spec.ts` CH-11 test | none | outcome panel gains "View history (N)" | `git revert <CH-11 sha>` |
| CH-12 Source-labeled status badges | PASSED | `c06777c` | `tests/unit/badges.test.ts` (6), `tests/e2e/v3-ui.spec.ts` CH-12 test | none | card badges read "Uber Ads, live read: Active, serving" and "POS connector, at decision: Healthy" | `git revert <CH-12 sha>` |
| CH-13 Inline demo role switch | PASSED | `4fa9eff` | `tests/integration/viewer.test.ts` (2), `tests/e2e/v3-ui.spec.ts` CH-13 tests (2) | none | staff or other-store viewers see who can approve and a "Demo: switch to" button | `git revert <CH-13 sha>` |
| CH-14 Lifecycle stepper | PASSED | `863fee4` | `tests/unit/lifecycle.test.ts` (17, exhaustive over the status enum), `tests/e2e/v3-ui.spec.ts` CH-14 test; existing 375 px no-scroll test still green | none | five-step stepper above the verdict, with honest endings | `git revert <CH-14 sha>` |
| CH-15 Truthful empty states | PASSED | `c020eb7` | `tests/unit/empty-state.test.ts` (4), `tests/e2e/v3-ui.spec.ts` CH-15 test; e2e suite run 5 times in a row, 14/14 each | none | data studio and simulator panel explain empty tables; "n/a" replaces dash placeholders; no em dashes in UI copy (seeded store name unchanged) | `git revert <CH-15 sha>` |
| CH-16 Policy provenance | PASSED | `a17d6af` | `tests/integration/policy-provenance.test.ts` (3), `tests/e2e/v3-ui.spec.ts` CH-16 test | none | card 3 source line shows version, effective date, check count, and "Provenance unavailable" for seeded data | `git revert <CH-16 sha>` |
| CH-17 Hash chain format 2 and verify control | PASSED | `28b1ade` | `tests/unit/audit-chain.test.ts` (8), `tests/e2e/v3-ui.spec.ts` CH-17 test; real pre-V3 database (made by `v3-baseline` code) migrated and verified, 14 format 1 rows + new format 2 rows, reopen OK | additive: `mp_audit.hash_version INTEGER` (NULL = format 1), applied by `migrate()` on open; fresh and pre-V3 databases tested | inspector gains "Verify audit log" | `git revert <CH-17 sha>`; the added column is harmless to older code, which ignores it, but rows written in format 2 would not verify under the old code |
| CH-18 Audit evidence package | PASSED | `e2ed7b3` | `tests/integration/evidence-package.test.ts` (6), `tests/e2e/v3-ui.spec.ts` CH-18 test | none | inspector gains "Download audit evidence package" | `git revert <CH-18 sha>` |
| CH-19 Evidence verification matrix | PASSED | `a6aedd1` | `tests/unit/evidence-matrix.test.ts` (5), `tests/integration/evidence-matrix.test.ts` (8: A open, A verified, C, E, S, J, policy changed, package equals view), `tests/e2e/v3-ui.spec.ts` CH-19 test | none (derived on read from stored checks) | "Evidence checks: N passed, N warned, N blocked, N not evaluated" disclosure under the verdict; package gains `evidenceMatrix` | `git revert <CH-19 sha>` |
| CH-22A VPS packaging: container and persistence | CONFIGURED (image) / TESTED_LOCALLY (process) | `1a28790` | `tests/integration/production-start.test.ts` (6); process-level dry run with `npm ci --omit=dev` in docs/DEPLOYMENT.md. Image not built: no Docker daemon, registry blocked | none (no schema change); `DATABASE_PATH` alias added | none in the app; new `/healthz`, `npm run bootstrap`, `npm run backup` | `git revert <CH-22A sha>` |
| CH-20 Four-digit visitor access gate | PASSED (local and production-mode process); preview deploy NOT_RUN | `c2bda8a` | `tests/integration/access-gate.test.ts` (11), `tests/e2e/access-gate.spec.ts` (3, separate gated server), gate login added to `tests/helpers.ts` for gated boots; production-mode HTTP check in docs/DEPLOYMENT.md | none | off locally and in tests by default; when on, every route except `/healthz` and `/access*` needs the session; "Lock demo" in the top bar | `git revert <CH-20 sha>` |
| CH-21 Analytics only after entry, with consent | CONFIGURED (no project ID provided); loader TESTED_LOCALLY with a dummy ID and intercepted network | `f4ccfe5` | `tests/unit/analytics.test.ts` (7), `tests/integration/analytics-csp.test.ts` (2), `tests/e2e/access-gate.spec.ts` CH-21 test; scripted configured-path check in docs/DEPLOYMENT.md | none | none unless `VITE_CLARITY_PROJECT_ID` is set; then a footer consent choice; `<main>` marked `data-clarity-mask` | `git revert <CH-21 sha>` |

### Decisions recorded

- **2026-11-09, approved by the project owner:** keep two exceptions to "no direct simulator table access outside the owning module": the data studio importer (`apps/api/src/imports/importer.ts`, which seeds simulators inside one SQLite transaction so preview and commit stay atomic) and scenario reset (`apps/api/src/orchestration/world.ts`, which arms simulator faults). The architecture test in `tests/integration/ports.test.ts` allows exactly these files plus the schema owner `db/db.ts`.
- **2026-11-09, approved by the project owner:** keep the field name `patchCountForCampaign` and fix its value. Before CH-1 it counted every PATCH the simulator had received, for any campaign. It now counts applied API changes to this campaign (distinct request ids in the provider's change log), and is `null` when the provider cannot tell.

### Deferred changes

- **CH-3 (summary counters), DEFERRED.** MarginPulse has no usage counter, cap or period total to summarize: no automatic actions exist, and every pause needs a manager approval. The only stored counters are the per-investigation readback limit (`extra_checks`, max 5) and id sequences, which are read directly and need no summary. Adding a summary table would create a shadow counter with nothing to reconcile against. Minimal alternative: none needed; revisit only if an auto-action cap is ever introduced.
- **CH-4 (multi-part allocations and exact undo), DEFERRED.** The single binding write changes one field (`configured_status`) on one campaign; there are no lines, quantities or amounts to allocate. Undo (resume) is out of scope by the original spec (section 3.3 and Example L), and Uber's external API offers no automatic resume. Minimal alternative already in place: the simulator change log records before and after values and versions for every applied change, so a future, separately authorized resume could compensate from it.
- **CH-5 (approval SLA escalation), DEFERRED.** Escalation needs a higher authority to route to; MarginPulse has one approving role (`MANAGER`, scoped per store, enforced by a CHECK constraint on `mp_users.role`). Approvals expire after `approval_ttl_s` (300 s) and recommendations after `recommendation_ttl_s` (600 s), measured on the scenario clock; a 72-hour SLA has no meaning during a kitchen rush. Minimal alternative already in place: a stale recommendation is blocked (`BLOCKED_RECOMMENDATION_EXPIRED`) and must be re-assessed, and nothing ever auto-approves.
- **CH-9 (bulk approvals), DEFERRED.** The original MarginPulse spec (section 21, non-goals) excludes multi-store bulk actions, and the workflow produces at most one pause recommendation per kitchen alert, reviewed in a single-investigation view. There is no queue of approvable items to select from. Minimal alternative: none needed; each approval stays an individual, store-scoped action.

## Pitch-ready change register

Changes made under the "MarginPulse — Product Clarity, SaaS Readiness & Investor-Grade Demo" specification plus the senior-usability brief. Branch `improve/pitch-ready-ux`, baseline tag `pitch-baseline` (`067a907`). Spec CH numbers are that document's numbers, not the V3 ones above. Rollback for any row is `git revert <sha>`; reverting newest first is always safe.

| ID | Status | Git SHA | Test evidence | Migration | Demo effect | Rollback note |
|---|---|---|---|---|---|---|
| CH-1 Scenario O coverage | PASSED | `793a774` | `integration/scenarios` (+1: forced approval refused, 0 PATCH) | none | none | revert |
| CH-2 Per-campaign PATCH count | PASSED (already done in V3 CH-1) | n/a | existing `ports` and `vertical-slice` tests | none | none | n/a |
| CH-3 e2e in CI | CONFIGURED | `55d1a0f` | workflow written; not run (no GitHub Actions here) | none | none | delete the workflow |
| CH-4 Demo access gate | PASSED (already done in V3 CH-20) | n/a | existing `access-gate` tests | none | none | n/a |
| CH-5 Mutation rate limit | PASSED | `f4a1496` | `unit/rate-limit` (3), `integration/rate-limit` (40-request burst) | none | none at normal pace; 429 after 60/min | revert, or `MUTATION_RATE_LIMIT_PER_MIN=0` |
| CH-6 Honest labeling | PASSED | `ede3984` | `unit/copy-guard` (every web file + server copy), `unit/badges` (+1) | none (view gains `posProvider`) | badges say "Mock Uber Ads", "Mock POS" | revert |
| CH-7 Progressive disclosure | PASSED | `2ea98d7` | `e2e/pitch-ux` (above-the-fold at 1280×800 and 375×812, tiers, toggle) | none | decision block under the verdict; simulator behind *Show demo tools* | revert |
| CH-8 Why explanations | PASSED | `2fd6aa8`, `2ea98d7` | `unit/explain` (6), `integration/explain` (A–T + verified + G) | none | reason sentence and record chips in the verdict | revert both |
| CH-9 Shift digest | PASSED | `cdd6520`, `e95b5b4` | `integration/insights`, `e2e/pitch-ux` | none | *What happened on your shift* after a settled alert | revert both |
| CH-10 Quiet states | PASSED | `2ea98d7` | `e2e/pitch-ux` (calm B, receipt) | none | calmer empty state; receipt first with audit hash | revert |
| CH-11 Visual refresh | PASSED | `2ea98d7` | all e2e; contrast table below | none | 17px body, ≥14px text, ≥44px targets, 2 elevations | revert |
| CH-12 First run | PASSED | `2ea98d7` | `e2e/pitch-ux` (once, one click, `?onboarding=0`) | none | three-step welcome in the empty state | revert |
| CH-13 Accessibility | PASSED | `1fcdb46` | `e2e/a11y` (axe at 1280 and 375 px, blocked, calm, simulator, data studio, dialog focus) | none | focusable scroll regions; stepper contrast | revert |
| CH-14 Evidence package | PASSED (JSON already done in V3 CH-18); printable receipt added | `2ea98d7` | `e2e/pitch-ux` (Print receipt) | none | print stylesheet + button | revert |
| CH-15 Audit verify control | PASSED (already done in V3 CH-17) | n/a | existing tests | none | none | n/a |
| CH-16 Deployment packaging | CONFIGURED (image), TESTED_LOCALLY (process) | `960fe4a` | production start with the README settings run as a process | none | README container command | revert |
| CH-17 Plan tiers | PASSED | `cdd6520`, `960fe4a` | `integration/insights` (solo 403, group 200, health) | none | `PLAN` in health; fleet gated | revert |
| CH-18 Fleet view, `?store=` | PASSED | `cdd6520`, `e95b5b4` | `integration/insights` (scope, 403 cross-store), `e2e/pitch-ux`, `e2e/pitch-mode` | none (opt-in scenario T) | store switcher for multi-store identities | revert both |
| CH-19 Notifications | PASSED | `cdd6520` | `integration/notify` (one signed POST, NO_ACTION, failure audited, no-op when off, unsigned refused) | none | none unless configured | revert, or unset `NOTIFY_*` |
| CH-20 Pitch mode | PASSED | `cdd6520`, `e95b5b4`, `960fe4a` | `e2e/pitch-mode` (story follows live state, metrics match `/api/metrics`, axe) | none | `DEMO_MODE=pitch` story panel | revert |

### Copy review checklist (CH-6)

- [x] Every web source file and server copy module passes `BANNED_CLAIM_PATTERNS` (`tests/unit/copy-guard.test.ts`, runs in `npm test`).
- [x] Generated sentences (explainer, digest JSON) are scanned in their own tests.
- [x] Simulator-fed badges and the campaign source line say "Mock" when the provider label is the local simulator.
- [x] Contribution figures keep the existing exclusion note ("not accounting profit").
- [x] The confirm-dialog projection keeps "Projection only. No records changed."
- [x] The digest and metrics strip show counts only and say so; no money, orders or return figures.
- [x] The audit hash is described as "tamper-evident within this database"; the evidence checksum as "a checksum, not a signature".

### Contrast (CH-11, measured with the WCAG 2.x relative-luminance formula)

| Pair | Colors | Ratio | Level |
|---|---|---|---|
| Body text on page | `#1b2024` on `#e4e9ea` | 13.4:1 | AAA |
| Body text on card | `#1b2024` on `#ffffff` | 16.4:1 | AAA |
| Secondary text on page | `#434c53` on `#e4e9ea` | 7.2:1 | AAA |
| Secondary text on card | `#434c53` on `#ffffff` | 8.8:1 | AAA |
| Secondary text on demo strip | `#434c53` on `#d3dadc` | 6.2:1 | AA |
| Recommendation banner | `#07462b` on `#e2f3e9` | 9.5:1 | AAA |
| Warning text | `#4d2e00` on `#fff2d6` | 11.1:1 | AAA |
| "Stays paused" note | `#8a5100` on `#fff2d6` | 5.8:1 | AA |
| Blocked banner | `#6f150e` on `#fdecea` | 10.3:1 | AAA |
| Over-limit number | `#b42318` on `#ffffff` | 6.6:1 | AA |
| Primary button | `#ffffff` on `#000000` | 21.0:1 | AAA |
| Inactive tab | `#dfe4e6` on `#000000` | 16.4:1 | AAA |
| Good value | `#0c7347` on `#ffffff` | 5.9:1 | AA |

Zoom: the 375 px phone layout is the same CSS width as a 1280 px window at about 340 % zoom. It has no horizontal scroll (existing responsive e2e test) and keeps the primary action on screen (new e2e test). A manual browser-zoom pass and a screen-reader session with real users are still to do.
