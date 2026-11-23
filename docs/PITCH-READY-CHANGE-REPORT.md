# MarginPulse pitch-ready change report

Specs: "MarginPulse — Product Clarity, SaaS Readiness & Investor-Grade Demo" (CH-1 to CH-20) and the senior-usability brief (first-time user aged 65+, primary task understood in 15 to 20 seconds). Branch `improve/pitch-ready-ux`, baseline tag `pitch-baseline` (`067a907`), report date 2026-11-22.

In short: all 20 spec items are delivered or were already in place, with two marked CONFIGURED because they can only run outside this sandbox (CI on GitHub, the container image on a Docker host). The manager's screen now leads with what happened, why (in plain English, built only from checks that ran), and the one thing they can do. The primary action is on screen without scrolling at 1280×800 and 375×812. Nothing in the decision path changed: the policy engine, the pause tool, signature checks, the audit log, the database schema, the seed data and both simulators have zero diff.

## 1. Baseline versus final

| Check | Baseline (re-run) | Final |
|---|---|---|
| Node | 22.23.5 | 22.23.5 |
| `npm run typecheck` / `lint` / `build` | exit 0 | exit 0 |
| `npm test` | 219 passed, 28 files | 306 passed, 35 files |
| `npm run test:e2e` | 22 passed | 39 passed, 3 consecutive runs |
| `npm run scan:secrets` | no findings | no findings |
| `npm audit --omit=dev` | not run | 0 vulnerabilities |

The spec's own baseline (81 tests, several items still open) was out of date. A previous round ("V3") had already delivered CH-2, CH-4, CH-14 (JSON), CH-15 and CH-16 (Dockerfile). Those are verified here, not rebuilt.

## 2. Change register

Full table with SHAs, test evidence and rollback notes: [IMPLEMENTATION-STATUS.md](IMPLEMENTATION-STATUS.md), section "Pitch-ready change register". Commits, oldest first:

| SHA | What |
|---|---|
| `793a774` | CH-1 scenario O: forced approval refused |
| `f4a1496` | CH-5 rate limit on mutating routes |
| `ede3984` | CH-6 Mock labels and copy guard |
| `2fd6aa8` | CH-8 explainer (shared module) |
| `2ea98d7` | CH-7, CH-10, CH-11, CH-12 tiered view, quiet states, refresh, welcome |
| `1fcdb46` | CH-13 axe-clean, focusable regions, stepper contrast |
| `cdd6520` | CH-9, CH-17, CH-18, CH-19, CH-20 server: digest, metrics, fleet, plans, notifications |
| `e95b5b4` | CH-9, CH-18, CH-20 UI: digest card, store switcher and fleet, pitch panel |
| `55d1a0f` | CH-3 CI workflow |
| `960fe4a` | CH-16, CH-17, CH-20 docs: container command, settings, scripts, pricing |
| `7ff0580` | Toggle order; screenshots regenerated |

Atomicity note: the UI restructure (CH-7, CH-10, CH-11, CH-12) is one commit because the same files carry all four, and the plan/digest/fleet/notify/pitch server work is one commit for the same reason. Each commit is green on its own.

## 3. Invariant evidence

| Invariant | Evidence |
|---|---|
| Orchestrator is the only path to a campaign write | `git diff pitch-baseline` on `orchestrator.ts` adds only an optional read-only `onFinal` observer after the audit write. `tools/`, `policy/`, `agents/` unchanged. |
| Nine execution checks, policy-unchanged, recommendation-fresh | Unchanged code; all existing `scenarios.test.ts` cases green. |
| HMAC webhook | `security/signature.ts` unchanged. Live: a real signed event with its id altered → 401 `BLOCKED_INVALID_EVENT`. |
| Idempotency keys | Unchanged; H and I scenario tests green. |
| Fail-closed configuration | Unchanged; new optional settings (plan, notify) report problems and turn only themselves off. |
| Integer-cents maths | `contribution.ts` unchanged; the explainer only copies stored values. |
| Scenario A outcome | Live over HTTP: `inv-1042`, approval `apr-501`, request `req-pause-4081-001`, readback PAUSED/PAUSED v13, `otherMutations: NONE`, simulator patchCount 1, audit chain ok. Identical to baseline. |
| Audit chain | `audit/` unchanged; chain verified in the notify tests, which append new entry types. |
| No new write paths | New routes `/api/digest`, `/api/metrics`, `/api/fleet` are GET-only. The notifier sends outbound only and writes nothing but its own audit entry. |

## 4. Schema and data

No schema change and no migration. Base seed untouched. One opt-in scenario added (T: a synthetic area manager assigned to both stores). The view model gains one additive field (`posProvider`).

## 5. Rejected or changed from the spec, and why

- **Onboarding as an overlay (CH-12).** Built as an inline panel in the empty state instead. An overlay blocks the page for first-time and older users, and the brief asks for no hidden or blocking UI.
- **"Audit note" when notifications are unconfigured (CH-19).** Not done: it would add an entry to every investigation and change scenario A's frozen audit trail. Unconfigured is a silent no-op, and `/api/health` reports `notifications.enabled`.
- **Prices (CH-17).** No prices are invented. The plan table states what each tier includes and that pricing is set per pilot.
- **Notifications plan.** CH-17 lists webhook alerts in Solo; Appendix C lists them in Group. Solo was chosen, so the retention feature is in the wedge plan.
- **Duplicate primary buttons.** A sticky mobile action bar would duplicate "Pause campaign". The single action block was moved directly under the verdict instead, and a new alert now scrolls its heading to the top.

## 6. Known limitations

- Simulation boundaries are unchanged: Mock Uber Ads and Mock POS, deterministic investigator.
- Rate limits and gate counters are in memory, in one process.
- The PIN gate and the identity switcher are not authentication.
- Tamper-evidence is local to the database.
- Estimated contribution is not accounting profit.
- Digest and metrics cover "since the scenario was loaded", because loading a scenario rebuilds the database.
- The CI workflow and the container image have not run here.
- Axe and contrast checks are automated. A manual screen-reader session and testing with real 65+ users have not been done; the 20-second target is a design requirement, backed by the above-the-fold tests, not a measured study.
- e2e ran against system Google Chrome rather than Playwright's bundled Chromium.

## 7. Demo walkthroughs

[DEMO-SCRIPT.md](DEMO-SCRIPT.md): D-2 investor run (6 minutes, with the D-3 controls tour), D-1 product walkthrough and D-4 data onboarding (3 minutes).

## 8. Architecture: decision → authority → mutation → trace

Unchanged: signed alert → orchestrator → read-only tools (evidence ids) → 18 ordered policy checks → recommendation → manager approval bound to store, campaign, policy version, user and TTL → execution checks → one PATCH → readback → digests → hash-chained audit.

Additive, all read-only:
- The explainer reads stored checks.
- Digest, metrics and fleet routes read stored rows and live campaign reads through the existing ports.
- The notifier observes final states after they are written.

## 9. Product validation

Targets (design requirements): a new user can name the problem, the evidence mismatch, the next action and who must approve it, without scrolling, within 20 seconds.

Observed in tests: on scenario A, the verdict, the reason sentence with both observed values, and the primary action are all in the viewport at 1280×800 and 375×812. "Who decides" names the manager.

No user study was run, so no comprehension time is claimed.

## 10. Deployment evidence

Only this was run: a production-mode process start (`NODE_ENV=production`, gate on, `PLAN=group`, `DEMO_MODE=pitch`) with the README settings. Results: bootstrap succeeded, `/healthz` returned ok, `/api/health` returned 401 without a session and the expected plan and mode with one. Nothing was deployed or pushed.

## 11. Command evidence

```
$ node --version                v22.23.5
$ npm run typecheck             exit 0
$ npm run lint                  exit 0
$ npx vitest run                Test Files 35 passed (35) · Tests 306 passed (306)
$ npm run build                 exit 0
$ npm run scan:secrets          scanned 150 source files: no secrets found
$ npx playwright test (×3)      39 passed · 39 passed · 39 passed
$ npm audit --omit=dev          found 0 vulnerabilities
```

## Brief checklist (Sections A–D of the draft plan)

- **A. Spec items:** CH-1 to CH-20 as above.
- **B. Additions:**
  - 17 px body text, nothing under 14 px, every control at least 44 px.
  - Measured contrast.
  - "Who decides" in the decision block.
  - Primary action above the fold on desktop and phone.
  - Heading focus fixed: it used to run before the heading existed.
  - Portable screenshot script.
- **C. Removed or simplified:** nothing deleted. The simulator panel and scenario notes are hidden behind *Show demo tools*. The evidence checks moved under "Proof and details". On phones, the boundary pill, decision code, scenario note and record chips are hidden; the same information is still in the decision block and details.
- **D. Open items:**
  - Push access to GitHub. The work is local on the branch.
  - A first CI run on GitHub.
  - Building the image on a Docker host.
  - A real usability session with older managers.
