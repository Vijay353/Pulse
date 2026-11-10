# MarginPulse V3 change report

Spec: `docs/UNIVERSAL-V3-SPEC.md`, section 8. Branch `enhance/marginpulse-v3`. Baseline tag `v3-baseline` (commit `0829a07`). Report date 2026-11-09.

Summary in one paragraph: 15 of the 19 core changes were delivered and are green. Four (CH-3, CH-4, CH-5, CH-9) were deferred because the change needs something this product does not have (counters, multi-part writes, a second approving role, a queue of approvable items); the reasons are recorded and nothing was faked to make them pass. You asked for CH-1 to CH-19 to be PASSED before the report; that condition is not fully met for those four, and this report says so rather than relabeling them. The deployment wave is split honestly: the container file is CONFIGURED (not built here), the production start-up, gate and analytics loader are TESTED_LOCALLY, and nothing was deployed.

---

## 1. Baseline versus final

All numbers below were observed in this environment (Node 22.22.0, Chromium from Playwright 1.56.1). The baseline was re-measured on 2026-11-09 by checking out the `v3-baseline` tag in a separate worktree, not copied from older notes.

| Check | Baseline (`v3-baseline`, re-run) | Final (`f4ccfe5` + this report) |
|---|---|---|
| `npm run typecheck` | exit 0 | exit 0 |
| `npm run lint` | exit 0 | exit 0 |
| `npm test` (Vitest) | 5 files, **81 passed** | 28 files, **219 passed** (unit 13 files / 101 tests; integration 15 files / 118 tests) |
| `npm run test:e2e` (Playwright, Chromium) | 1 spec file, **6 passed** | 4 spec files, **22 passed** (on two servers: the normal one and a gated one) |
| `npm run scan:secrets` | not part of the baseline count | 126 source files and 3 client bundle files, no secrets found |
| `npm run build` | exit 0 | exit 0 |
| `npm run test:all` | not re-run at baseline | exit 0 |
| `npm audit` | 0 (historical, 2026-10-18 report) | 13 moderate, 4 of them in runtime dependencies (see section 6) |

The original 81 Vitest and 6 Playwright tests are all still in the suite and green. Two disclosed edits to original test files, neither changing an assertion:

- CH-7 added three assertions to the e2e success test (the new "If you approve" table).
- CH-15 added a `toBeEnabled()` wait to the e2e `loadScenario` helper. This fixed a race in the baseline: the heading appeared before the button re-enabled. The window got wider once CH-1 moved reads onto HTTP. After the fix the suite ran green 5 times in a row.

## 2. Change register

The full register, with the test evidence for each row, is in `docs/IMPLEMENTATION-STATUS.md` under "V3 change register". Rollback for every delivered change is `git revert <sha>`. Changes are independent commits in order, so reverting the newest first is always safe.

| CH | Title | Status | Commit | Files changed (excluding the register) | Tests added |
|---|---|---|---|---|---|
| 1 | Domain reads through ports | PASSED | `0a13f91` | 13: adapters/ports.ts, adapters/http.ts, orchestrator, viewModel, routes/api, server, SimulatorPanel, both simulator plugins, ARCHITECTURE, SIMULATOR-CONTRACTS, spec copy | integration/ports (9, with an architecture guard) |
| 2 | Typed tool-result accessors | PASSED | `8013f8d` | 7: agents/toolResults.ts (new), adapters/http, orchestrator, policyEngine, security/signature | unit/tool-results (9), integration/malformed-pos (4) |
| 3 | Consistent summary counters | DEFERRED | `c49d521` | register only | none |
| 4 | Multi-part writes and exact undo | DEFERRED | `e1ee031` | register only | none |
| 5 | Approval SLA escalation | DEFERRED | `ee29f13` | register only | none |
| 6 | Possible repeat alert | PASSED | `7617113` | 14: policy/repeatAlert.ts (new), orchestrator, viewModel, routes, client, Dialogs, ShiftView, css, fixtures (scenario S), README, SIMULATOR-CONTRACTS | unit (7), integration (5), e2e (1) |
| 7 | Read-only impact projection | PASSED | `58bb0d3` | 5: state/projection.ts (new), Dialogs, css | unit (4) + 3 e2e assertions |
| 8 | Trailing store history | PASSED | `f863f01` | 8: orchestration/history.ts (new), viewModel, client, ShiftView, format, css | unit (5), integration (3) |
| 9 | Per-item bulk approvals | DEFERRED | `4312c58` | register only | none |
| 10 | Comparison bar | PASSED | `a01a8bf` | 7: state/compare.ts, CompareBar.tsx (new), DecisionCards, client, css | unit (5), e2e (1) |
| 11 | Collapsible execution history | PASSED | `b5c1689` | 5: state/history.ts (new), OutcomePanel, css | unit (3), e2e (1) |
| 12 | Source-labeled status badges | PASSED | `c06777c` | 6: state/badges.ts, SourceBadge.tsx (new), DecisionCards, css | unit (6), e2e (1) |
| 13 | Inline demo role switch | PASSED | `4fa9eff` | 9: viewModel, routes, App, client, DecisionCards, ShiftView, css | integration (2), e2e (2) |
| 14 | Lifecycle stepper | PASSED | `863fee4` | 6: state/lifecycle.ts, Stepper.tsx (new), ShiftView, css | unit (17), e2e (1) |
| 15 | Truthful empty states | PASSED | `c020eb7` | 13: state/empty.ts (new), App, DecisionCards, Inspector, OutcomePanel, SimulatorPanel, DataStudio, ShiftView, format, css, e2e helper wait | unit (4), e2e (1) |
| 16 | Policy provenance | PASSED | `a17d6af` | 6: viewModel, client, DecisionCards, format | integration (3), e2e (1) |
| 17 | Audit hash chain format 2 and verify control | PASSED | `28b1ade` | 7: audit/audit.ts, db/db.ts (migration), AuditVerify.tsx (new), Inspector, css | unit (8, including legacy migration), e2e (1) |
| 18 | Audit evidence package | PASSED | `e2ed7b3` | 9: audit/evidencePackage.ts (new), routes, client, EvidenceExport.tsx (new), Inspector, css, SIMULATOR-CONTRACTS | integration (6), e2e (1) |
| 19 | Evidence verification matrix | PASSED | `a6aedd1` | 12: policy/evidenceMatrix.ts (new), contracts, viewModel, evidencePackage, client, EvidenceChecks.tsx (new), ShiftView, css, SIMULATOR-CONTRACTS | unit (5), integration (8), e2e (1) |
| 22A | VPS packaging: container and persistence | CONFIGURED (image), TESTED_LOCALLY (process) | `1a28790` | 12: Dockerfile, .dockerignore, .env.example, config, ops/storage.ts (new), server, scripts/bootstrap.ts and backup.ts (new), package.json and lock (tsx moved to runtime deps), DEPLOYMENT.md (new) | integration/production-start (6) |
| 20 | Four-digit visitor access gate | PASSED locally and in a production-mode process; preview deploy NOT_RUN | `c2bda8a` | 20: security/accessGate.ts, gatePage.ts, internal.ts (new), config, server, adapters/http and mock-pos (internal fetch), routes (health flag), App, client, css, playwright config (second server), secret-scan, test helper, README, .env.example, DEPLOYMENT | integration/access-gate (11), e2e (3) |
| 21 | Analytics only after entry, with consent | CONFIGURED (no project ID given); loader TESTED_LOCALLY with a dummy ID | `f4ccfe5` | 16: analytics/clarity.ts, context.tsx, AnalyticsNotice.tsx (new), App, ShiftView, EvidenceExport, config, server (CSP), css, Dockerfile build arg, README, .env.example, DEPLOYMENT | unit (7), integration (2), e2e (1) |
| 22B | Production deploy, restart and backup on the VPS | NOT_RUN | none | none | needs your server, DNS, panel access and authorization |

Order note: the spec's safest order (CH-22A, then CH-20, then CH-21) was followed, which is why CH-22A's commit comes before CH-20.

Documentation changed along the way: README (scenario S, hosted settings, gate and analytics), ARCHITECTURE (ports), SIMULATOR-CONTRACTS (new routes and fields), IMPLEMENTATION-STATUS (register, decisions, deferrals), DEPLOYMENT (new), this report.

### Decisions recorded (approved by you on 2026-11-09)

1. The data studio importer and the scenario reset keep direct simulator-table access. They are the only allowed exceptions to the port rule, and the CH-1 architecture test enforces that list.
2. `patchCountForCampaign` keeps its name and now counts what it says. Before CH-1 it counted every PATCH the simulator received for any campaign; now it counts distinct applied requests for this campaign from the change log.

### Deferred, with reasons

- **CH-3:** there is no usage counter, cap or period total to summarize. No action is automatic, and every pause needs a manager.
- **CH-4:** the one binding write changes one field on one campaign, so there is nothing to allocate. Undo (resume) is out of scope in the original spec, and Uber's API offers no automatic resume.
- **CH-5:** there is one approving role (store manager), so nobody exists to escalate to. Approvals already expire after 5 minutes and recommendations after 10 on the scenario clock.
- **CH-9:** bulk actions are a non-goal in the original spec. Each alert produces at most one recommendation, so there is no queue to select from.

## 3. Invariant evidence

Each line names the test that proves it. All of these ran green in the final run.

| Invariant (spec wording) | How it holds in MarginPulse | Evidence |
|---|---|---|
| Authority gateway | Every pause goes through policy checks and then execution checks: approval matches the actor, store, campaign and version, policy unchanged, recommendation fresh, and a re-read just before the write. The matrix (CH-19) reads those stored checks and cannot release a write. | `scenarios.test.ts`: "an approval for one investigation/campaign cannot authorize another", "expired approval and stale recommendation are rejected", "policy changed after approval blocks execution"; `evidence-matrix.test.ts` |
| Forged-role rejection | Unknown demo identities and missing CSRF tokens are refused. Staff and other-store managers cannot approve. Evidence export needs store assignment. | "staff cannot approve; a manager of another store cannot approve or pause", "mutating routes require the CSRF token and a known demo identity", `viewer.test.ts`, `evidence-package.test.ts` (403) |
| Stale-revision rejection | The campaign version is re-read before the write; a change blocks it. | "G: version change after approval blocks the write; re-assess requires a new approval" |
| Idempotent replay | The same webhook three times gives one investigation and one PATCH. A repeated approval or pause does not apply twice. | "H: three deliveries of the same event → one investigation, one PATCH", "I: dropped connection after apply → no retry, readback verifies" |
| Per-part bounds | Not applicable: single-field write (see CH-4 deferral). | none |
| Message freshness | Old or replayed signed events are blocked as stale. Forged and tampered events are rejected. | "an old (replayed/backlogged) signed event is blocked as stale…", "N: forged webhook…", "tampered payload…" |
| Fail-closed non-simulated behavior | Unconfigured SANDBOX/LIVE and LLM modes block instead of simulating. Production start refuses placeholder secrets, an unwritable disk, an unbootstrapped database and a missing gate PIN. | `agent-safety.test.ts` (2 fail-closed tests), `production-start.test.ts`, `access-gate.test.ts` (configuration) |
| Compensating reversal | Not implemented by design: resume is out of scope, and the API exposes no resume path. | "L: there is no resume path anywhere in the API" |
| Original demo integrity | Scenario A gives the same decision, approval id `apr-501`, request id `req-pause-4081-001` and campaign version 12 to 13 as at baseline. Scenario S is opt-in, so base data is untouched. | `vertical-slice.test.ts`, `evidence-package.test.ts`, `repeat-alert.test.ts` ("base scenario A: one alert…") |

## 4. Migrations

- **Only schema change:** CH-17 adds a nullable `mp_audit.hash_version` column. `migrate()` runs on every open; it is additive and idempotent.
- **Fresh database:** created with the column; all rows use hash format 2.
- **Prior database:** verified two ways. (a) `audit-chain.test.ts` builds a pre-V3 table, migrates it and verifies a mixed chain. (b) A real database produced by `v3-baseline` code: 14 format-1 rows verified, format-2 rows appended, then reopened and verified again.
- **Legacy behavior:** format-1 rows are still checked with their original formula and are reported separately in coverage (`format1` and `format2` counts).
- **Backward limit:** pre-V3 code can open a V3 database, but its verifier does not know format 2 and will report the chain as broken at the first new row. To go back past V3, restore the backup taken before upgrading (DEPLOYMENT.md, Rollback). There is no automatic reverse migration.
- **Production data:** `npm run backup` (VACUUM INTO, then integrity, chain head and counts checked on the copy) is tested, including a restore that serves the same records.

## 5. Explicitly rejected

- New infrastructure: PostgreSQL, an ORM, queues, separate services, replicas, Kubernetes. One Node process and one SQLite file meet the need.
- A new model provider or any model in the decision path beyond what existed. The deterministic investigator stays the default.
- A UI overhaul or new design system. Every UI change reuses the existing tokens, and the gate page copies them.
- Unattended approval above any ceiling, and any automatic pause. Every write still needs a named manager.
- Identity or signature fiction:
  - The demo identity switcher stays labeled "not authentication".
  - The visitor gate is labeled a convenience gate.
  - The evidence digest is labeled a checksum, not a signature.
  - The hash chain is not anchored outside the database.
- Also declined for this project:
  - bulk actions (CH-9)
  - resume or undo (CH-4)
  - SLA escalation (CH-5)
  - a summary-counter table (CH-3)
  - a webhook exemption in the gate (simulated mode doesn't need it, and the spec allows only health and login/logout)
  - analytics tags, identify calls or pageview events beyond Clarity's own

## 6. Known limitations

- **Simulated systems:**
  - Mock POS and Mock Uber Ads are local simulators.
  - Real Uber Ads reporting is async and not implemented, so SANDBOX/LIVE investigations block.
- **Simulated identity:** demo roles come from a header. The visitor gate is a shared four-digit code (10,000 combinations), slowed down but not prevented by the rate limit.
- **Audit chain:**
  - It is tamper-evident only against edits that don't recompute it.
  - Anyone with write access to the database file can rewrite it.
  - Removing the newest rows is detectable only if the head was recorded elsewhere.
  - Format-1 rows use the weaker original encoding.
- **Hosted resets:** "Load scenario" drops every table, including the audit log, so treat a hosted instance as a throwaway demo database.
- **Gate state is in memory:** the rate limiter and the logout revocation list live in memory, so they reset on restart. That is fine for one instance; it would not work for several.
- **Container not built:** the Dockerfile has not been built here (no Docker daemon, registry blocked). The base image tag is TO_VERIFY and should be pinned by digest.
- **Analytics not live:** analytics has not been tested against a real Clarity project. Consent enforcement for EEA, UK and Swiss visitors also depends on your Clarity project settings.
- **No claims made:** no revenue, savings, lift, detection-precision or compliance claims. The UI and agent output are checked against a banned-claims list.
- **Deferred:** CH-3, CH-4, CH-5 and CH-9; reasons are in section 2.
- **Dependency advisories (found at the final check, not fixed):** `npm audit` reports 13 moderate advisories. The baseline report recorded 0, and the lockfile has not changed apart from moving `tsx`, so these are newly published advisories against the same versions.
  - 4 are in runtime dependencies (`npm audit --omit=dev`): `fast-uri` (URI scheme spoofing, via Fastify) and `glob`/`minimatch` (via `@fastify/static`).
  - The other 9 are lint tooling only.
  - Dependency upgrades were not in the V3 backlog, so nothing was changed. Before any public deploy, run `npm audit fix` (non-breaking), then `npm run test:all`, as its own commit.

## 7. Demo walkthrough

Start locally with `npm start`, then open the printed URL. Everything is synthetic; times are on the frozen scenario clock (2026-10-18 18:31 ET).

1. **Kitchen rush, pause with approval (scenario A).**
   - Press "Simulate kitchen alert".
   - The stepper shows Alert received, Checked and Waiting for approval.
   - The contribution bar (card 2) shows $3.20 against a $5.60 floor.
   - The badges name their sources ("Uber Ads, live read").
   - Expand "Evidence checks": 19 passed, 0 warned, 0 blocked, 4 not evaluated (23 rows). The 4 are the approval-time checks, which have not run yet, and the page says so instead of showing them as passed.
   - Press "Pause campaign". The dialog shows the read-only projection. Confirm.
   - Checkpoint: the outcome is "Campaign paused and verified", with campaign version 12 to 13, request `req-pause-4081-001` and approval `apr-501`. The inspector trace shows PATCH_SENT, then the readback, then PAUSE_VERIFIED.
2. **Stale data is blocked (scenario C).**
   - Simulate the alert. The verdict is blocked, with no approve button.
   - Evidence checks: 8 passed, 0 warned, 1 blocked, 14 not evaluated. The snapshot-freshness row is "Blocked here", and later rows are "Not evaluated", never "Passed".
3. **Same alert sent twice (scenario S).**
   - The second alert carries a warning naming the first investigation.
   - Approval needs the extra checkbox. Without it the server answers 409.
   - The matrix shows one "Warning".
4. **Audit review.**
   - In the inspector, "Verify audit log" reports the chain length, the head hash, and how many rows use each hash format.
   - "Download audit evidence package" saves `audit-evidence-inv-1042.json`. The SHA-256 is shown so you can compare it with `sha256sum`.
   - The package includes the same evidence matrix as the screen.
5. **Role boundaries.** Switch the identity to staff. The page names who can approve and offers "Demo: switch to <manager>"; the approve buttons are disabled for staff.
6. **Hosted entry (needs `ACCESS_GATE=on`).**
   - Open a deep link such as `/data`. The gate appears.
   - A wrong code gets a generic message. The right code lands on `/data`.
   - "Lock demo" returns to the gate.
   - With a Clarity ID configured, nothing is sent until the visitor chooses Allow in the footer.

Simulated in every step: the POS, the Uber Ads API, the clock and the identities.

## 8. Interview architecture explanation

1. **Event.** The mock POS signs a `KitchenLoadThresholdBreached` event with HMAC and delivers it as a webhook. MarginPulse checks the signature, the freshness and duplicates (event id) before storing it.
2. **Extraction.** The orchestrator reads the kitchen snapshot, cost profile, campaigns and report through typed ports (CH-1). Each tool result is validated with Zod before use (CH-2), so a malformed payload becomes a recorded read problem, not a crash or a guess.
3. **Policy decision.** 18 ordered checks run against the store's policy snapshot. The first failure decides the outcome; later checks are recorded as skipped. The investigator (deterministic by default) may only cite stored evidence, and its output is validated against it.
4. **Authority.** A recommendation is not permission. A store manager approves a specific campaign, version and policy version; the approval expires. At execution, separate checks confirm it all again and re-read the campaign just before the write.
5. **Port call.** One PATCH to the Ads port, with an idempotency key and request id.
6. **State mutation.** The simulator applies it and writes its own change log (ledger).
7. **Read-after-write.** MarginPulse reads the campaign back until configured and effective status agree. "Paused but still serving" stays unverified.
8. **Trace.** Every step appends to a hash-chained audit log. The evidence matrix and the evidence package are built from those stored records only.
9. **Failure paths:**
   - 429 and 401 are reported truthfully.
   - A dropped connection is resolved by readback, never by a blind retry.
   - A version change blocks the write. So does a policy change.
   - Unconfigured real providers fail closed.
10. **Why per-record authority survives bulk operations:** there are none, on purpose (CH-9 deferred). If they were added, each item would still carry its own approval, version and execution checks. A batch would only be a loop over the same gateway, with partial success reported per item.

## 9. Product validation

- **Targets (spec 6.3):**
  - the 30-second rule
  - the one-sentence rule
  - plain words first
  - progressive disclosure
  - honest states
- **Automated evidence:** the browser tests check that these elements are present and work, on desktop and at 360 to 375 px:
  - the stepper
  - the plain-word statuses
  - the collapsed inspector
  - keyboard focus
  - no horizontal scroll on phones
  - the empty states
- **Observed metrics:** none. No usability session with real users was run, so no claim is made that the 30-second rule is met. The next step is a small observed exercise (5 people, 4 questions, timed).

## 10. Deployment and analytics evidence

- **Stack feasibility:** one Node 22 process serves the UI, the API and the simulators on one origin. `node:sqlite` is built into Node 22, so there are no native add-ons to compile. The runtime-only install (`npm ci --omit=dev`) was tested and works.
- **Image:** CONFIGURED, not built. Docker CLI is present but there is no daemon, and Docker Hub returns HTTP 403 through the network allowlist.
- **Production process dry run (TESTED_LOCALLY):**
  - It refuses to start before bootstrap.
  - Bootstrap is idempotent.
  - UI, deep link and API are served, and scenario A verifies.
  - After a restart the same state is present (13 audit entries, no reseed) and the chain still verifies.
  - Backup verified against the source. Details are in `docs/DEPLOYMENT.md`.
- **Passcode verified on the server:** in production mode over HTTP:
  - `/healthz` returns 200.
  - A deep link redirects to `/access`.
  - The API and the JS bundle return 401 without a session.
  - A wrong code returns 401. The right code returns 303 with an `HttpOnly; SameSite=Lax; Secure` cookie.
  - With the session, the API and the app return 200.
  - A missing PIN or secret stops start-up.
- **Zero pre-entry analytics:** observed in the browser.
  - With no ID built in: no third-party requests at all (e2e test).
  - With a dummy ID and intercepted network: 0 Clarity requests on the gate, after a wrong code, and before consent. Exactly one tag request after Allow, and `consent(false)` on Turn off.
  - The gate page CSP never lists Clarity.
- **Masking and consent:**
  - `<main>` carries `data-clarity-mask="true"`, and Clarity masks inputs by default.
  - Consent mode v2 is set to `analytics_Storage: granted`, `ad_Storage: denied`.
  - Set Clarity's masking to strict and turn on its consent requirement in your dashboard.
- **Deployed URL:** none. Nothing was deployed. CH-22B is pending your server, domain, panel access and explicit authorization.

## 11. Verbatim command evidence

Final run, 2026-11-09, from the repository root. Lines are copied from the captured output; long per-test listings are trimmed and marked.

```text
$ git branch --show-current
enhance/marginpulse-v3
[exit 0]

$ git status --short
[exit 0]

$ npm run typecheck
> marginpulse@0.1.0 typecheck
> tsc -p tsconfig.json
[exit 0]

$ npm run lint
> marginpulse@0.1.0 lint
> eslint .
[exit 0]

$ npm test
 Test Files  28 passed (28)
      Tests  219 passed (219)
[exit 0]

$ npm run test:e2e
vite v8.3.4 building client environment for production...
✓ built in 226ms
  ... 22 test lines trimmed; projects: chromium (18), gate (4) ...
  22 passed (28.0s)
[exit 0]

$ npm run scan:secrets
checked 3 client bundle files
scanned 126 source files: no secrets found
[exit 0]

$ npm run build
vite v8.3.4 building client environment for production...
✓ built in 258ms
[exit 0]

$ npm run test:all
 Test Files  28 passed (28)
      Tests  219 passed (219)
  22 passed (25.8s)
checked 3 client bundle files
scanned 126 source files: no secrets found
[exit 0]
```

Baseline re-run at `v3-baseline` (separate worktree, same machine):

```text
typecheck exit=0
lint exit=0
 Test Files  5 passed (5)
      Tests  81 passed (81)
  6 passed (9.3s)
```

Skipped, with reasons:

| Command or step | Reason |
|---|---|
| `docker build .` and any container run | No Docker daemon in this environment; registry blocked (HTTP 403). |
| Preview or production deploy, DNS, TLS, firewall, panel install | Needs your server and authorization; the spec forbids running these unasked. |
| `git push` | Not authorized. The history is delivered as a git bundle instead. |
| Clarity against a real project | No project ID provided; checked with a dummy ID and intercepted network only. |
| Observed usability session | Needs people; not run, and not claimed. |
