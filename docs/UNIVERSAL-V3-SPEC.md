# UNIVERSAL V3: CONTROLLED ENHANCEMENT SPECIFICATION

Audience: a coding agent working inside one of the existing portfolio repositories (MatchPoint, Business Impact Gate, MarginPulse, EvidenceBridge, the refund assurance demo, or a future project with the same anatomy).

Purpose: improve an already working, evidence-driven decision prototype without rewriting it, weakening its controls, or destabilizing the seeded demo that the portfolio case studies describe.

Status: implementation instructions. Repository details and baseline claims must be verified before any modification.

Source hierarchy: existing functioning code and passing behavioral tests, then repository architecture and simulator contracts, then this specification. Any conflict that affects safety, accounting, state integrity, or existing behavior requires a documented stop-and-report, not a speculative change.

How to use this document: fill in the PROJECT PROFILE in section 0.3 first, from the actual repository, not from memory. Everything below the profile is generic and applies as written.

Language rules for all work under this spec (they apply to code comments, UI copy, docs, and reports):

- Simple English. A sentence that needs rereading should be rewritten.
- Technical words only when they are the exact name of something real (for example `expectedRevision`, idempotency key, optimistic concurrency). Do not use technical vocabulary to describe plain ideas.
- No em dashes in prose, UI copy, or docs. Use commas, colons, or periods.
- UI text is written for a first-time viewer, not for the engineer who built the feature. Internal codes and enum names are never the primary label.

---

## 0. MISSION AND WORKING AGREEMENT

You are acting as a principal full-stack engineer, a domain controls reviewer, and a product designer. The reported stack is TypeScript, Node (Express or Fastify), native `node:sqlite`, React with Vite, Vitest and Playwright. Confirm actual versions and scripts in `package.json` before relying on any of that.

Core product thesis, stated generically: the prototype turns one incoming event into one checked, explained, human-gated decision, performs at most one binding write through one controlled path, and proves the outcome by reading state back. The UI must show what happened, what is uncertain, the next permitted action, and who must act. Its explanations must truthfully reflect what the code actually checked and executed. Interpretation (rules or an optional model) is never the authority; deterministic policy and recorded evidence are.

This is an incremental hardening and product-clarity engagement, not a rewrite. Favor small, independently useful changes. Do not add infrastructure, vendor dependencies, a framework, or speculative enterprise features. Never represent simulated data or local security measures as production certifications.

### 0.1 Required initial inspection (read-only)

Before editing code, open and read the project's `README.md`, `docs/ARCHITECTURE.md`, `docs/IMPLEMENTATION-STATUS.md`, the simulator contracts, the integration adapters, the policy code, the approval and authority code, the single write path, migration and seed code, the existing fixture loaders, the UI, and the tests. Do not state that these were read unless you actually opened them.

1. Verify the current Git branch and whether the worktree is clean. Never discard or overwrite user modifications.
2. Record the actual baseline: typecheck, unit and integration tests, build, lint, and the existing browser test capability. Treat any historical test counts in docs (for example "100 tests, seeded scenario with five exceptions") as historical expectations, not proof of the present checkout.
3. Walk one existing successful lifecycle end to end, from trigger to final state, including the authority checks, evidence reads, the one write, the read-back, the audit trail, and the read APIs. Identify the actual data types, transaction boundaries, and source-of-truth tables.
4. If migrations are needed later, first take snapshots of the seeded demo database and of an upgraded historical fixture. Never mutate the user's only database copy to test a migration.
5. Produce a compact baseline and discrepancy report before implementation: verified facts, places where this spec differs from the repository, risky assumptions, and the exact first proposed batch.
6. Stop before implementation if baseline tests fail, core files cannot be inspected, the database cannot be backed up safely, or the authority checks cannot be verified. Report the blocker and a recommended repair. Do not rewrite tests to hide it.

Do not implement the whole backlog in one uninterrupted pass. Implement one change spec per batch, demonstrate verification, create a reversible checkpoint, and proceed only when the batch is green. If working interactively, stop after the agreed batch or wave when asked; otherwise follow the ordered backlog only while verification remains green.

### 0.2 Existing-project-only execution

This specification is a patch backlog for a current, successfully implemented repository, not a greenfield product brief. Assume the existing application, user journeys, seeded scenarios, UI, APIs, and tests are working until the mandatory read-only baseline check proves otherwise. Do not scaffold a new app, regenerate the repository, replace the working database, change package or framework choices, restructure directories, or copy a second implementation of existing features.

Use agile, additive delivery: inspect the actual implementation, select one approved change, make the smallest compatible diff, run targeted and full regression tests, do a demo smoke check, and make one reversible Git commit. Reuse the established components, styles, fixtures, ports, contracts, runtime, and scripts. Treat untouched features as frozen. If an enhancement requires disproportionate changes, classify it `DEFERRED` with the minimal alternative rather than rewriting. Do not publish, deploy, overwrite remote branches, or change hosting infrastructure without explicit user authorization; provide a deployment-ready configuration and clear manual steps instead.

### 0.3 PROJECT PROFILE (fetch these details from the previous task/chat)

| Field | Value (from actual code) |
|---|---|
| Project name | |
| One-sentence product story (what it decides and what it never touches) | |
| The single binding write (function, endpoint, target system) | |
| The approval or authority gateway that guards that write | |
| Policy engine (file, version id, fail-closed behavior) | |
| Simulators and their scopes (name, base URL or route, token scopes, which one owns which data) | |
| Seeded demo scenario (its IDs and verified outcomes) | |
| Demo personas and how identity works (demo header, never authentication) | |
| Clock model (fixed scenario time, injected clock, wall clock) | |
| Stack commands (`typecheck`, `test`, `build`, `lint`, browser tests) | |
| Existing UI landmarks (queue or list view, detail view, inspector drawer, data studio) | |
| Audit mechanism (append-only table, hash chain, verify route if present) | |

If any field cannot be filled from the repository, that is a baseline finding and goes into the discrepancy report.

---

## 1. ABSOLUTE INVARIANTS

These invariants hold for every project this spec is applied to. Translate them into the project's own vocabulary using the profile, but do not weaken them.

### 1.1 Authority and trust boundaries

- Preserve the existing authority gateway that guards the single binding write. Inspect and honor the exact current call graph. Every newly introduced write path must reuse it. No bypass through an API, a bulk mode, an import, a simulator control, or a client-side state change.
- A binding write requires a still-valid automatic verdict permitted by current policy, or a genuine, applicable human approval record. Re-check eligibility, revision, role, approval record, policy version, evidence freshness, and action-specific requirements immediately before the write.
- A warning, a suspicious pattern, or a missing signal can never turn into an automatic binding action just because other checks passed. Explicit authorized human clearance and the normal safeguards remain necessary. Do not invent an override endpoint.
- An elevated demo user switch, a demo identity header, or a role dropdown is not real authentication. Keep it in simulated or demo mode and label it as such. Never imply it establishes cryptographic identity.
- Only structured, schema-validated messages or payloads cross system boundaries. A confirmation or acceptance must still reference the latest eligible counterpart with matching terms. Preserve fail-closed behavior for non-simulated modes and missing integrations.
- Any reversal or undo is human-scoped, permitted only inside the existing time window, implemented with compensating entries or an explicit state change, and never erases historical records.

### 1.2 Correctness and concurrency

- Money, where the domain has it, uses integer cents and integer basis points. No floating-point arithmetic on currency. Respect the actual rounding rules, including per-line versus aggregate reconciliation. Preserve any per-line ceilings and authorization ceilings that exist.
- Posting or write idempotency keys and replay semantics stay unchanged. Repeat requests return the original result with no duplicated record, audit entry, counter update, or side effect.
- Preserve revision checks (`expectedRevision` or equivalent), policy version checks, and import fingerprints on all relevant state changes. Database writes need explicit transaction design. Do not assume an async operation participates in a synchronous SQLite transaction; verify the actual connection and transaction sharing first.
- Preserve the seeded base scenario and its currently verified IDs and outcomes. Introduce new test scenarios as opt-in separate fixtures, unless an explicit, reviewed change to the base scenario is required.
- Protect against negative balances, double reversals, boundary errors at period or deadline edges, and concurrent request races. Document the process-level concurrency limits of the single-process SQLite demo honestly.

### 1.3 Technical limits and UX boundaries

- No new infrastructure: no external cache, message broker, ORM, new database, agent framework, CSS or component framework, or third-party model integration. No new runtime dependencies unless demonstrably indispensable and approved.
- Prefer existing strict TypeScript, shared schema-validated contracts, established components, formatting helpers, and CSS tokens. No wholesale navigation change; retain the established list or queue plus detail architecture and the collapsed technical inspector.
- An explanation must be tied to executed rules and evidence. Do not manufacture reasoning, estimates, histories, scores, signatures, or financial results that no code produced.
- Never update existing assertions solely to force tests green. Fixture-dependent expected counts may change only when a new fixture is intentionally selected and the change is justified in the same commit.

---

## 2. DEFINITION OF A SAFE BATCH

For each change (CH-N) perform this sequence, in order:

1. Inspect and scope. Identify the actual symbols, contracts, call sites, dependent tests, migration implications, and affected behavior. State the one change's acceptance criteria in 3 to 6 lines.
2. Checkpoint. Create a working branch (suggested `enhance/<project>-v3`) without destroying existing work. Record the current commit SHA and clean status. Create a tag or checkpoint commit when appropriate. Do not assume `git reset --hard` is safe.
3. Write or extend tests first when useful: success case, authorization or failure case, idempotency, and regression. A failure caused solely by an intentional new test is acceptable before implementation.
4. Smallest coherent patch. Modify only the files needed for this change, plus its tests and necessary documentation. Do not reformat unrelated modules.
5. Verify. Run the project's typecheck and full test command (from the profile), plus relevant lint, build, and browser test commands when the changed surface needs them. Test both the original fixtures and any optional scenario fixtures. Capture the command, exit code, and actual counts.
6. Diff review. Verify that no guard was removed, no bypass added, no demo outcome altered, no new implicit fallback introduced, no unexpected schema overwrite, and no unintentional copy or layout change slipped in. Confirm any new migration works on fresh and legacy databases.
7. Commit one change only if green, using `ch: CH-N: concise title`. Keep the code, tests, and directly impacted docs in that commit. Record the SHA as a rollback boundary.
8. Failure rule. If checks fail, diagnose and fix within the same change without changing unrelated behavior. If still failing or uncertain, leave the previous green checkpoint intact, stop, disclose the blocker, and present a safe revert path (`git revert <commit>` for committed changes; preserve user work). Never automatically revert unrelated commits or hide skipped tests.

Wave gates: advance only after the previous wave runs build, full tests, and an end-to-end smoke of the seeded demo. Browser end-to-end tests for binding-write or approval changes, and for export or access-gate changes, cannot be replaced by UI screenshots alone.

Change register: maintain a small table in `docs/IMPLEMENTATION-STATUS.md` with `ID | Status | Git SHA | Test evidence | Migration | Demo effect | Rollback note`. Allowed statuses: `NOT_STARTED`, `IN_PROGRESS`, `PASSED`, `BLOCKED`, `DEFERRED`. Do not present partially implemented features as shipped.

---

## 3. EXISTING CAPABILITIES: REUSE, DON'T REBUILD

Verify and preserve the mechanisms the project already reports. These are reported capabilities, not a request to reconstruct them:

- The fixed scenario clock and any injected clock, so results stay deterministic.
- The collapsed technical inspector that renders the real run or trace object, one click away from the main screen.
- The deterministic policy engine with ordered checks, where the first failure decides and the UI explains it in plain language.
- The bounded extractor (rules by default, optional model behind the same contract) that can explain but never decides, whose output is schema-validated and whose citations must match the source verbatim.
- The single write path with approval binding, a pre-write re-read, an idempotency reservation, one write call, and read-back based verification that distinguishes requested from confirmed state.
- Append-only, in-practice audit tables, with hash chaining if already present.
- The simulator topology: stateful simulators with their own data, scoped tokens, fault injection, and audit, reached over real HTTP so the code path matches a future real adapter.
- The Data Studio (spreadsheet import and export) with validated preview, explicit confirm, atomic commit, restore, and formula-safe export.
- The seeded demo scenario with its verified IDs and outcomes.
- The portfolio deployment pattern, if present: a lightweight access gate before the app, and analytics that load only after entry.

---

## 4. ORDERED CHANGE BACKLOG

Each change carries a tag: KEEP (applies as written), REFINE (applies with adjustments decided from repository evidence), or CONDITIONAL (implement only if the repository proves it safe; otherwise DEFERRED). Priorities: P1 highest, P3 lowest. Size: XS, S, M, L. The waves and IDs match the structure of the original MatchPoint V3 so prior review habits carry over.

### WAVE 1: PORT BOUNDARIES, CONTRACTS, CORRECTNESS

**CH-1: Domain reads go through the port, not around it [KEEP / REFINE; P2; S]**

Outcome: orchestration code and dashboard or list views do not directly query a simulator's internal tables. All reads flow through the typed port or adapter layer.

Implementation: inspect the actual consumers first. Prefer the smallest sufficient, typed read capability using the repository's real domain types. If callers only need identifiers, offer a narrower query instead of a wide one; avoid maintaining two overlapping APIs. Delegate simulated reads to the existing simulator client. Keep non-simulated modes explicitly `NOT_CONFIGURED`, with no fallback to direct SQL and no pretend production data. Preserve response shape, ordering, filtering, trace, and current failure semantics.

Acceptance: no direct internal-table reads outside the owning module and its adapter, no widening to `string` or `any` where real enums exist, identical base scenario results, existing API and failure-mode tests green. Include adapter contract coverage.

Interview truth: data access sits behind an explicit replaceable port; a real vendor adapter is future work.

**CH-2: Typed payload accessors [KEEP; P2; XS]**

Outcome: remove unsafe casts from the decision and orchestration path.

Implementation: prefer discriminated schema-validated types or narrow typed helpers for each message kind. Validate message type, parsed body, and optional fields before reading values. Return a typed null or validation failure for mismatched bodies. Preserve existing error and message processing behavior. Do not turn malformed payloads into valid zeros, empty strings, or default acceptance.

Acceptance: no `as any` on cross-boundary bodies in the orchestrator, typecheck clean, same valid results and same failures for malformed or unexpected message types.

**CH-3: Consistent summary counters, only if provably atomic [REFINE / CONDITIONAL; P2; M]**

Outcome: reduce repetitive computed reads (for example a monthly auto-action cap or a usage counter) only if ledger or record consistency is provable. Correctness is higher priority than performance.

Key architecture trap: updating a summary row in a transaction after an awaited external write is not atomic with that write. Do not claim atomicity unless both writes truly share one database transaction and connection, with no async or network boundary splitting them. Inspect whether orchestration and the simulator already use a common synchronous SQLite connection. If not, defer the counter and retain the derived-from-records computation; report the reason. Do not introduce a shadow counter that can drift.

If safe: add a strongly constrained summary keyed by period using existing storage. Compute the period consistently with record timestamps, timezone, and existing business rules. Update the value inside the same transaction as the successful first-time write; adjust only the correct period on an authorized reversal; do not double-decrement or affect human-initiated records. Initialize migrated periods from an unambiguous derived sum, transactionally, without emitting fictitious user actions. If the existing settings table is reserved for versioned policy configuration, use a dedicated summary table in the existing database rather than overloading it. Document the choice.

Consistency tests: automatic action, manual action, identical idempotency replay, failed or rolled-back insert, reversal once, reversal twice, period boundary, warm database migration, summary versus record reconciliation. On mismatch, block cap-dependent automatic action or explicitly fail closed while reconciling. No silent undercount and no bypass.

Acceptance: either implemented with transaction proofs and matching record totals, or explicitly DEFERRED with old behavior preserved. Never optimize at the cost of a control.

**CH-4: Exact multi-part write and undo allocations [KEEP / REFINE; P1; M]**

Outcome: a reversal or undo restores precisely the quantities and amounts written by each source part.

Implementation: add an additive migration for a nullable allocations column (or a normalized mapping only if repository conventions demand it). Store schema-validated entries such as `{lineNo, quantity, amountCents}` or the domain equivalent during the same successful write transaction. Use stable identifiers if a position number is not unique enough. Allocate any remainder using existing rounding rules so the parts sum exactly to the posted total. Reversal consumes the original allocations, prevents duplicate reversal, restores exact per-part quantities, and writes a compensating record; it never deletes the original. Existing legacy rows with null allocations follow the prior documented approximation, clearly marked as legacy, without fabricating precision. Protect the migration against partial application.

Acceptance: two or more parts with unequal quantities and values, partial write, exact reversal, repeated reversal rejected, legacy compatibility, single-part case unchanged, human-only and time-window restrictions green.

Interview truth: traceable per-part allocations make undo exact for new records; legacy entries may need fallback logic.

### WAVE 2: APPROVAL CONTROLS AND RISK

**CH-5: Approval SLA escalation without authority regression [KEEP / REFINE; P1; M]**

Outcome: stale approval requests become visible and actionable by the higher authority without silently moving anything forward.

Design decision: treat escalation as routing metadata or an event on a still-actionable approval, unless the existing state machine already supports an escalated state as actionable. Do not add a terminal status that makes the pending request undecidable. Preferred model: the approval remains pending, with an escalation timestamp or level, or an append-only escalation event. If the actual schema forces a status change, update and test all decision, first-decision-wins, concurrency, and allowed-action checks so the escalated state is actionable. Never allow a second decision after an approval or rejection.

Implementation: a higher-authority-editable integer escalation window (hours, default 72), versioned alongside other policy settings. Use the injected clock or scenario clock, never wall-clock time or a background timer. Evaluate when the detail view loads and immediately before a decision. Avoid duplicate escalation events on repeated reads; if a read must stay read-only, derive the escalated flag on read and persist an idempotent event only through the next permitted mutation, or document the intentional read side effect and protect it transactionally. At the threshold, the higher role becomes eligible while the original approver keeps rights only where the existing amount and role ceilings allow. Recheck authority after concurrent decisions.

UI: `Escalated after 72h, decision enabled for <role>`, the actual elapsed time, the original approver, and the available roles. Do not say the higher role is required if the original approver can still act.

Acceptance: just below the threshold no escalation; exactly at the threshold; above the threshold the higher role is allowed; the original role still allowed under its ceiling; above-ceiling original role blocked; the first decision wins across simultaneous attempts; no repeated trace event; policy edits restricted to the right role; deterministic fixed clock, no timer leaks.

Interview truth: escalation widens authorized review. It never auto-authorizes the action.

**CH-6: Possible duplicate or suspicious resubmission detection [KEEP / REFINE; P1; M]**

Outcome: catch suspicious resubmissions with modified references, without claiming wrongdoing has been proven.

Detection: same party plus same parent record plus equal value plus nearby dates plus different normalized reference. Exclude self-matches, cancelled or invalid records as business rules require, and repeated comparisons. Require dates from validated source fields; do not substitute arrival timestamps without disclosure. Exact duplicates remain the target system's existing unique constraint. Protect against false positives from legitimate installments or split records: compare line structure or part identifiers where available, show the evidence and a warning, and route uncertain cases to explicit human review. Any possible-duplicate flag must prohibit unattended automatic action until a valid human disposition within the existing authority flow. Do not silently reject it at import, do not silently process it, and do not auto-release it based on a reliability score.

Scenario decision: do not change the default seeded fixture merely to make a demo example. Add an opt-in separate fixture containing the suspicious sibling and document its expected counts separately; never hardcode the new counts into base test assertions. If the fixture framework truly cannot run a separate scenario, record an explicit deliberate fixture-change proposal before modifying baseline counts, tests, and README together.

UI: show the potential original record, dates, amount, the matching fields, a plain caveat that a legitimate alternative may exist, and source links, with a visible human decision requirement. No accusatory wording.

Acceptance: suspicious pair flags; same amount with different parent or party is not flagged; a legitimate installments case is minimized or explained; the date boundary case; a reread or rerun yields one flag; a user without approval rights cannot bypass; automatic action is blocked pending explicit authorized disposition; the base fixture is unchanged.

Interview truth: risk-based screening helps reviewers spot possible resubmissions. It is not a fraud classifier.

### WAVE 3: DECISION CLARITY AND OPERATIONS

**CH-7: Read-only impact projection [KEEP / REFINE; P1; S]**

Outcome: a decision maker can see the projected effect before approving.

Financial semantics correction, where money exists: posting or pausing a record is not the same as cash moving. Unless the system actually executes settlement, avoid phrases like `cash released today` or `working capital released`. Prefer `Eligible to act on approval: $X`, `Remaining value pending receipt: $Y`, and `Unreceived units: N`, or the domain equivalent. If time-based forecasts truly exist, label projected effects separately with their assumptions. Explicitly label `Projection only. No records changed. Approval may allow the action, subject to final checks.`

Implementation: pure, deterministic, client-side calculation from the validated payload, the already-written lines or parts, and documented rounding. No new endpoint and no state-changing network call. Never invent an estimate (for example a shipment date) if the data does not contain one. Use exact seeded values only after verifying the actual fixture; treat historical numbers in docs as a test hypothesis, not assumed truth.

Acceptance: exact integer math, partial and multi-part cases, no placeholder masquerading as fact, zero mutation calls, no approval bypass, accessible summary.

**CH-8: Trailing history for the deciding party [KEEP; P1; S]**

Outcome: show this system's real operational outcomes for the party involved (supplier, device, store, patient group, case), clearly separated from any external master data.

Implementation: query real unique records for that party opened within a trailing window (90 days by default) using the injected or consistent clock. Define counting rules for reopened, blocked, escalated, auto-resolved, and unresolved states so totals reconcile without counting one record twice. Any percentage denominator must be stated and nonzero. Do not use a trend arrow unless comparing two real, comparable periods. Render one plain line, for example `History (last 90 days): X opened, Y auto-resolved, Z blocked`, and `No prior history` for genuinely empty periods. State explicitly if the current record is excluded from its own history.

Acceptance: seeded multi-outcome cases, exact date edges, zero data, reopened changes, no mutation of external master data, correct client API types.

**CH-9: Per-item bulk approvals [KEEP / REFINE; P1; M]**

Outcome: one user action can submit up to 20 distinct independent approvals, with itemized partial success.

Contract: one bulk endpoint taking `{items:[{id, expectedRevision}]}`, schema-validated with min 1, max 20, unique ids. Derive the current session principal server-side; never accept a client-supplied approver identity. Do not offer a generic bulk write bypass. For every item, reuse the existing single-item approval command with its authority guards, evidence freshness, optimistic revision, idempotency, and trace. Execute sequentially; each item is its own transaction and audit record. One error cannot authorize another item or undo earlier commits. Return stable per-item results and a summary that clearly indicates partial success.

UI: selection only for currently eligible rows; stale UI must never substitute for the server check; a confirmation dialog states the number and impact; statuses refresh after execution; failures are listed without concealing successes; duplicate clicks are handled safely.

Acceptance: two valid plus one stale plus one non-approvable yields two successes and two explicit failures; mixed role scopes behave; repeated submit is safe; the 20-item cap and duplicate ids are enforced; each item has its own trace and no shared authority; no accidental batch rollback.

Interview truth: bulk is a convenience layer over individually secured transactions, not one shared authorization.

### WAVE 4: UI POLISH WITH ZERO DOMAIN SEMANTICS CHANGES

**CH-10: Comparison bars for matched quantities [KEEP / REFINE; P2; S]**

Where the domain compares ordered, received, invoiced, promised, or configured versus effective values, render those values for each line or part with true proportional widths and printed counts. Use existing CSS only. Explicitly distinguish shortages from overages; if one value exceeds its baseline, do not clip it dishonestly at 100 percent without an overflow label. Preserve the accessible numeric table or provide equivalent text and ARIA labels. Test zero, single line, multi-line, large quantities, and the seeded shortage or mismatch illustration.

**CH-11: Collapsible negotiation or event history [KEEP / REFINE; P2; XS]**

Preserve all existing messages, events, and their actions. Show a concise most-recent status summary; offer `View history (N)` with a keyboard-operable disclosure. Default collapsed for long settled threads; expanded when an item needs immediate response or evidence context. No deletion, reordering, or redaction of source evidence. Test the latest-message case and the zero and one-message states.

**CH-12: External status or reliability badge [KEEP / REFINE; P2; XS]**

Show the existing external value (for example a reliability percentage or provider status) alongside the party's identity, using the established thresholds and colors. Distinguish `Unknown` from zero. Label the source clearly (for example `ERP reliability` versus `MatchPoint history`) and never merge two different sources into one badge. Preserve text accessibility; semantic wording in addition to color.

**CH-13: Inline demo role switch on a blocked-action banner [KEEP / REFINE; P2; XS]**

Reuse the existing session-change mechanism and demo accounts. Show `Demo: switch to <eligible role>` only in simulation mode and only if that role is actually eligible for the blocked action. Re-fetch allowed actions after the switch. Never put an administrative role switch into a production authentication path or imply identity assurance. Verify the flow from a lower role to the eligible role and the above-ceiling case without any state bypass.

**CH-14: Lifecycle stepper [KEEP / REFINE; P2; S]**

Map each actual status value to presentation labels in one place, referencing the real transition table. Real statuses may branch or skip steps; do not depict a linear path as guaranteed, and do not mislabel blocked, held, failed, or reversed states. Represent alternate terminal states honestly. No independent client-side state machine. Test exhaustively across the actual status enum and mobile and keyboard layouts.

**CH-15: Truthful empty states [KEEP / REFINE; P3; XS]**

Use informative empty states in every list, ledger, and data studio view, distinguishing `no results under current filters` from `no records yet` from `all active items resolved`. Display server-derived counts and amounts with correct labels, not unsupported claims. No invented productivity savings. Preserve layout stability and a clear recovery or clear-filter action.

**CH-16: Policy provenance [KEEP / CONDITIONAL; P3; XS]**

Show provenance only if it is actually persisted: policy version, updated-at time, and a verified updated-by principal or role. Do not hardcode a name from an illustrative example. If legacy policies lack metadata, display `Provenance unavailable` rather than inventing an author or date. Use a focusable, accessible tooltip or inline details. Validate the exact number of checks against the actual policy schema, not an assumed count from an earlier version.

### WAVE 5: EXPLAINABILITY AND AUDITOR PERSONA

**CH-17: Tamper-evident hash chain for the audit log [KEEP / REFINE; P2; M]**

Outcome: verification detects modifications to audited rows in the local database, with explicit limitations.

Implementation: add nullable `prev_hash`, `entry_hash`, and a stable monotonic sequence if absent, via additive migration. Use native `node:crypto` SHA-256 with unambiguous canonical serialization (explicit field order, encoding, and length framing) of the real immutable data fields plus the chain predecessor; include a schema or algorithm version where useful. Insert the audit row and its hash in one database transaction; do not rely on timestamps alone for ordering. Verify every hashed row in sequence, predecessor continuity, canonical payload, and the first offending sequence. The genesis constant must be explicit. Legacy unhashed rows are unverifiable; mark them neither valid nor tampered. Do not silently start a new trusted chain over mutable legacy entries without disclosing the boundary. Add a verify route in the existing simulated environment and a safe UI control showing the verified range, legacy exclusions, and results.

Threat-model honesty: a local hash chain is tamper-evident against unsophisticated edits. An attacker with full database write access can recompute the chain. It is not immutable, externally anchored, signed by a trusted authority, or equivalent to a certification. Do not describe it as regulator-approved proof.

Acceptance: append verifies OK; a mid-chain update fails; deletion and a sequence gap are detected where a completeness anchor exists; mixed legacy and hashed rows report partial coverage; canonical bytes are deterministic; replay creates no duplicate; migration and post-restart verification pass.

**CH-18: Exportable audit evidence package [KEEP / REFINE; P2; M]**

Outcome: a reviewer can inspect one record's evidence, decisions, and outcome without reconstructing the workflow by hand.

API: one export route per record, restricted to the existing appropriate audit or read scope, with confirmed behavior for non-simulated modes. Include a schema version, export timestamp, the record's ID, revision, and status, source references (only details already accessible under permissions), the executed decision results, the applicable policy snapshot or version at decision time if persisted, the acting principal as recorded with timestamp, external evidence references, the run and trace in order, the written or reversed record links, verification status, and relevant hashes with chain scope. Do not reconstruct historical policy from today's settings if no snapshot was persisted; disclose unavailable evidence, and add a capture mechanism only as a distinct documented change.

Formats: JSON is mandatory. CSV is optional and must be clearly labeled a flat summary, because a multi-entity evidence graph cannot be faithfully expressed in one CSV without linked files. Avoid claiming cryptographic signature: a SHA-256 file checksum is not a digital signature. Sign only if a trustworthy key, verification process, and scope are actually implemented and approved; otherwise export canonical JSON plus digest and verification instructions. Avoid leaking secrets or personal data; sanitize filenames and formula-injection risks if CSV is added. Name the artifact honestly, for example `Audit evidence package`, not a compliance certification.

UI: a single export action on the detail view; show `complete`, `partial`, or `unverifiable` evidence status instead of a deceptive green badge. No mutation.

Acceptance: a normal resolved run and a partial or reversed run; exact immutable historical policy or a clear missing flag; authorized versus unauthorized export; valid schema; chain integrity metadata; no secrets; stable JSON serialization; consistent IDs across run, approval, and write.

**CH-19: Evidence Verification Matrix: actual checks, not fabricated reasoning [KEEP / STRENGTHEN; P2; M]**

Outcome: reviewers see which deterministic business checks actually ran, their evidence, and whether each one affects authority.

Contract: define a shared structured type, for example `{checkId, label, status: 'PASS'|'FAIL'|'WARN'|'NOT_EVALUATED', evidenceRefs: string[], detail, evaluatedAt?, ruleVersion?, blocksAutoAction: boolean}`. Derive check statuses from the existing executed matching, policy, and evidence engine. Never duplicate the calculations in the client and never hardcode green ticks. `NOT_EVALUATED` means no reliable data or execution; it implies neither failure nor success. Evaluate, at minimum, the checks that actually exist in the engine: record found, bounds and ceilings, external evidence freshness, policy authority, and the duplicate risk check if CH-6 is enabled. Do not claim a check that no code performs (for example a physical dock confirmation or an external attestation) unless it was in fact independently executed.

UI: place a compact `Evidence checks` summary near the decision point, with `N passed, N warned, N blocked, N not evaluated`; expand for input references and a plain-language rationale. Distinguish business rule explanation from any private model reasoning; never display fabricated reasoning. The matrix is read-only and cannot itself release a binding write. The server remains authoritative.

Acceptance: the matrix agrees with the actual trace and result for the standard pass, partial, failed-evidence, counter-offer, duplicate-warning, and pending-check cases; unexecuted checks are not green; `blocksAutoAction` agrees with policy; deterministic tests plus accessible UI. If the architecture lacks stored check outcomes, derive them from authoritative decision records or emit trace at the actual execution sites with tests, never in a separate client-only emulator.

Interview truth: decisions are explainable through explicit evidence and rule outcomes. This is deterministic traceability, not a claim to expose a model's private reasoning.

### WAVE 6: PORTFOLIO DEPLOYMENT ACCESS AND POST-ENTRY ANALYTICS

Placement and priority: these are deliberately CH-20 to CH-22, not changes to the CH-1 to CH-19 logic. Implement only after the baseline and the relevant existing batches are green; deliver them as separate independent commits. They must not affect the decision workflow, in-app navigation, seeded scenario, or local demo access. The default hosting target is one small VPS (for example Hetzner CX-class, Ubuntu 24.04) managed by a self-hosted deployment panel (for example Coolify); adjust to the account's actual provider and verify current sizing, pricing, and region availability at provision time.

**CH-20: Minimal four-digit portfolio access gate [NEW; P2; S-M]**

Goal: a visitor opening the public portfolio deployment sees a restrained, premium-looking four-digit passcode entry before the actual project UI. Match the project's existing typography, spacing, colors, tokens, background, focus states, and responsive layout. The page should look native to the portfolio, not like an admin login or a new design system. Use a four-cell numeric input with accessible single-input semantics if practical, masked digits, paste support, Enter to submit, keyboard navigation, a helpful error state, a loading state, a mobile-friendly layout, and a subtle `Enter <project>` action. Avoid unnecessary animations and branding changes.

Required architecture and risk controls:

1. Inspect the actual production entrypoints and how one Dockerized Node process will serve the built frontend and the existing API at the same origin. Keep the native SQLite store and existing schema unless repository evidence requires a surgical change. Configure a persistent, writable database path (for example `DATABASE_PATH=/data/<project>.db`) mounted to a dedicated host directory. This is a stateful single-instance deployment: one writer container, no ephemeral container-only database, no load-balanced replicas sharing SQLite. Do not migrate to PostgreSQL or an ORM on speculative scaling grounds. Verify native Node and SQLite support and the runtime image architecture before adopting a Dockerfile.
2. Validate the PIN in the existing backend, not a serverless function. Set the exact four-digit access PIN as a runtime secret in the deployment panel; never use a `VITE_` variable for the PIN. Reject missing or invalid production secrets at startup. Keep API session and UI at the same origin. Use trusted-proxy settings only for the verified single reverse proxy, never trust arbitrary forwarded headers.
3. Use a short-lived, signed, `HttpOnly`, `Secure`, `SameSite=Lax` session cookie or an equivalent server-verified token. Verify the session on protected page, data, and API routes rather than just hiding React components. Prevent unauthenticated fetches of project data; clearly document any public static bundle visibility that this configuration cannot block. Avoid putting sensitive data in static HTML or JS. Keep secrets out of logs and source control.
4. Enforce basic rate limiting with progressive backoff and generic errors that do not reveal whether the PIN is close. Note that four digits have only 10,000 combinations; this is a convenience gate for a demo, not strong authentication. Do not expose real customer data and do not claim enterprise access control. Session reset or logout returns the visitor to the gate.
5. Preserve the existing local development path (gate bypassed or off by default for localhost and automated tests only, via an explicit nonproduction configuration, never a generic production fallback). Do not entangle the demo persona switcher (CH-13) with visitor access authentication; they are separate boundaries. Guard preview and production routes consistently and document deep-link handling.

Acceptance: an unauthenticated visitor gets the gate; the correct PIN yields a verified session and app entry; an incorrect PIN or brute force cannot bypass; a direct protected API URL without a session is rejected; refresh and valid deep links remain accessible; an expired session returns to the gate; logout clears the session; no PIN present in the built JS; the app's original local browser tests and seeded scenario unchanged; layout accessible on mobile and desktop. Verify on a preview deployment before any public production switch, if deployment is authorized.

Demo narrative: `The portfolio demo has a lightweight, branded access gate. It is deliberately separated from the project's business authorization model.`

**CH-21: Analytics only after project entry [NEW; P2; S]**

Goal: connect the hosted experience to the user's existing analytics project (default: Microsoft Clarity) to observe aggregate visits, session replays where permitted, and navigation and interaction patterns inside the app, not the passcode screen. Analytics shows anonymous or pseudonymous usage patterns; it does not identify a visitor by name. Do not implement fingerprinting or covert identity collection.

Implementation:

1. Add a single, optional analytics loader mounted only after verified access (CH-20) and, where required, after appropriate consent. No analytics script, initialization, recording, page view, custom event, or network request may occur on the passcode screen. Put the loader in the post-authenticated application shell, not in global `index.html`, shared root initialization, or the gate component.
2. Use the analytics project ID from the user's existing dashboard, configured as a public client-side identifier (for example `VITE_CLARITY_PROJECT_ID`). It is an identifier, not a secret. Do not invent an ID, assume access to the user's analytics account, create a replacement project, or request account passwords. If absent, the app remains fully operational with tracking disabled and a documented setup step.
3. Load the official snippet only once per granted session; instrument single-page navigation so meaningful route views can be distinguished if the navigation mechanism needs it. Use a small, stable event taxonomy (for example `project_entered`, `record_opened`, `scenario_started`, `scenario_completed`, `audit_export_clicked`) only for actions actually observed, and avoid duplicating automatic page views. Never send record IDs, party names, monetary values, role names tied to persons, free text, passcodes, raw errors, session tokens, or other sensitive data in event names, tags, URLs, or metadata. Configure masking appropriately, especially around financial or clinical data and simulated approval information.
4. Display an unobtrusive privacy and analytics notice and implement consent handling consistent with applicable visitor jurisdictions and the provider's consent mode. Honor required consent signals; do not set nonessential cookies before appropriate consent. Withdrawal disables subsequent tracking as supported and avoids replaying the passcode page.
5. Disable analytics by default in localhost, test runs, and automated demos unless explicitly enabled. Do not add analytics SDKs or a new analytics dashboard inside the app. Analytics is inspected in the user's existing dashboard.

Acceptance: an invalid PIN never loads analytics; a gate screenshot or network capture shows zero analytics requests; successful access plus valid consent loads it once; interactions report only approved event names; reload and route changes do not double-install; an absent project ID is a silent no-op; masking is verified with a test fixture; the original test suite, agent behavior, and API contracts remain unchanged.

Demo narrative: `Analytics begins only when someone actually enters and engages with the demo. Aggregate visitor behavior helps prioritize UX improvements while keeping sensitive and access information out of recordings.`

**CH-22: Single-VPS production deployment [NEW; P1; M]**

Purpose: package the existing working project for one small VPS with a self-hosted deployment panel, replacing any earlier serverless hosting assumption entirely. This is a deployment adapter for the existing project, not a new product.

Task 1, repo and runtime audit (read-only): verify the workspace layout, Node engine version and native SQLite support, production scripts, static serving and single-page-app fallback, health route, server binding address, database creation and migrations, fixture auto-seeding, asset paths, permissions, binary dependencies, and the existing original demo tests. Document gaps. Keep the same route paths and contracts. Produce a Dockerfile and `.dockerignore` only if the repository lacks a correct deployment artifact. Prefer a minimal multi-stage build with a pinned Node LTS base image, `npm ci` against committed lockfiles, builds driven by the actual repo scripts, only required production dependencies in the final image, and the same server listening on `0.0.0.0:${PORT}`. Do not invent build scripts, output paths, or filenames. The built UI and the API must share one HTTPS origin. Never embed secrets or database files in the image or build context.

Task 2, persistence without domain rewrite: make the database path configurable (for example `DATABASE_PATH`); default development behavior remains unchanged. In production, require a persistent mounted directory; ensure correct ownership on the host, a non-root container if compatible, startup fail-closed with a clear error if the data directory is unwritable, and SQLite WAL sidecar files staying in the same mount. Do not seed or reset an existing production database on restart or deploy. Seed only through an explicit, documented, idempotent bootstrap action on first installation; make seeding safe to rerun without overwriting audit or ledger state. Any schema migration required by CH-1 to CH-19 must be compatible with historical database copies and tested on fresh and existing databases, with a consistent backup before migration. Keep integer money, basis points, transactions, idempotency, per-part reversal, approval authority, and trace behavior intact. Do not migrate to PostgreSQL by default; propose a separate optional migration only if inspection proves SQLite cannot meet actual requirements, and never implement it without separate approval and reconciliation tests.

Task 3, application access and telemetry: the CH-20 server-verified PIN must cover the application document, sensitive static resources as relevant, the API, and direct deep links, not merely hide the client shell. Exempt only narrowly defined health and login or logout endpoints. Configure secure, `HttpOnly`, `SameSite` session cookies over HTTPS with secrets held in the panel's environment variables. Do not conflate visitor PIN authentication with internal demo persona switching. CH-21 analytics loads only after access and consent where required. Default to no analytics on the gate, no PIN logging, no sensitive values in recordings, and privacy-safe masked UI.

Task 4, panel configuration and ops: use the current official installer and docs; do not auto-run installers, firewall changes, Git pushes, or production deployments without authorization. Document firewall rules (SSH restricted to the administrator where practicable, HTTP and HTTPS public, panel port restricted or protected during setup), and confirm before enforcing them because container-published ports need special handling. Configure DNS, TLS via the panel's proxy, and automatic HTTP to HTTPS redirects after DNS resolves. Expose the container internally on the configured port without needing a host port. Set `NODE_ENV=production`, the port, database path, PIN and session secrets, and the optional analytics project ID. Restrict deployment to one instance; no shared writable SQLite mount across containers. Provide a lightweight read-only readiness check and test cold start, redeploy, and restart. Set resource limits from observed usage, not guessing. A host swapfile is an optional, verified operation, not a substitute for sufficient RAM; check memory first to prevent duplicate entries.

Task 5, backup, restore, retention, safe cleanup: persistent mounts are not backups. Design scheduled SQLite-consistent backups (the SQLite backup API or an equivalent verified route); do not copy just the live database file while WAL writes occur. Store backups off-host and keep retained local copies with secure permissions. Test a restore into an isolated throwaway database and compare audit and ledger state. Keep panel configuration backups separate from application database backups. Use the panel's verified cleanup setting when available; otherwise use a documented, dry-run-first image and cache prune schedule. Never prune volumes blindly and never delete images currently needed for rollback.

Task 6, deployment acceptance and rollback: test the locally built image first with a temporary writable volume and a copied fixture. Verify the health route, PIN gate, protected API behavior, app assets and deep links, the original seeded scenario, and the CH-1 to CH-21 tests. On an authorized live deployment, record the Git SHA and image reference, run the seeded scenario resolution if safe on a dedicated demo database, capture the resulting record, trace, and audit verification; restart the container and confirm the same state persists with no duplicate writes and no automatic reseed. Redeploy the same image with the same mount and recheck. If a deploy fails, restore the previous image without overwriting the database; a schema downgrade may require a reviewed restore from backup, not an automatic reverse migration. Add explicit database reset instructions only for throwaway demo instances, never as normal startup behavior.

Acceptance: green baseline and change suites; the image builds; the container serves both UI and API; production secrets absent from repo and bundle; restart and redeploy persist database and audit; unauthorized access rejected at the server; backups verified via restore; staging and rollback path documented; live checks marked passed only when actually run. Preserve the original demo outcomes.

Git boundary: a separate reversible commit `ch: CH-22: vps production packaging`, followed by a deployment operations report once an authorized deploy actually occurs. Avoid editing domain business code unless a traced reproducible bug demands it.

Hosting supersession and sequencing: this section supersedes any earlier serverless hosting assumptions. The safest order is CH-22A container and persistence dry run, then CH-20 access gate, then CH-21 analytics, then CH-22B authorized production deploy and restart and backup checks. CH-22A and CH-22B are separate checkpoints within CH-22 and must be reported independently. Core CH-1 to CH-19 should remain complete and green before any public release. Mark deployment `CONFIGURED`, `TESTED_LOCALLY`, or `LIVE_VERIFIED` based on actual evidence; never label it deployed based on prepared instructions alone.

---

## 5. DEPENDENCIES, INTEGRATION ORDER, CONFLICT RESOLUTIONS

| Dependency / risk | Chosen resolution |
|---|---|
| CH-3 counter versus the record insert | Implement only with a proven shared database transaction; otherwise defer the optimization. |
| CH-4 allocations versus CH-3 counter on reversal | Test reversal amount and original period together; never decrement a counter based on an unverified reversal. |
| CH-5 escalation versus the approval state machine | Keep the approval actionable after escalation; preserve first-decision-wins. |
| CH-6 new demo scenario versus base seeded counts | Separate opt-in scenario, preserve the default; update expectations only for that scenario. |
| CH-6 possible duplicate versus CH-9 bulk | Duplicate warnings require individual authorized clearance; bulk cannot silently bypass. |
| CH-7 projected effect versus real movement | Use projected and pending terminology, not actual settlement claims. |
| CH-8 history versus CH-12 external badge | Two distinct, labeled sources; no derived score overwrites external master data. |
| CH-13 role switch versus real authorization | Simulation-only persona switching; server checks remain authoritative. |
| CH-17 hash chain versus CH-18 export | Export the disclosed chain segment and verification coverage; no unsupported signature claim. |
| CH-19 matrix versus the rule engine | Reuse recorded executed checks; never create a parallel client-side policy evaluator. |

Feature ordering: CH-1 through CH-19 by ID for clean review, with CH-17, CH-18, CH-19 deliberately ordered last among the application changes so audit packages can reference hash verification. If a repository dependency makes a different order safer, present the minimal adjustment and rationale before deviating.

---

## 6. DEMO SCENARIOS AND PRODUCT ACCEPTANCE

### 6.1 Untouched baseline journey

Use the actual verified seed from the profile. Keep every baseline authority, trace, idempotency, and reversal test. If the current repository differs from what the docs describe, use the observed outcomes and flag the discrepancy.

### 6.2 Opt-in edge-case suite

- Missing approver: clock before, at, and after the SLA; show higher-role routing and no auto-approval.
- Resent or suspicious record: modified reference in the same neighborhood; show a human warning while the base scenario stays untouched.
- Split or partial condition: comparison bars, verified evidence, conditional partial action, and held balance.
- Batch operations: eligible approval plus stale revision plus unauthorized plus already-resolved; show partial success and separate trace records.
- Reversal: multi-part exact allocations; legacy fallback; summary counter reconciled only if actually implemented.
- Audit review: verify the hash chain, export the evidence package, locate the actual approval and write, demonstrate an integrity warning on a disposable test database.
- Failure and empty states: missing data, missing estimate, unavailable provenance, inactive integrations, empty queue, and an unverifiable legacy audit range.

### 6.3 UX bar (testable, not a marketing slogan)

- The 30-second rule. A user unfamiliar with the project should be able to answer four questions within 30 seconds of opening any main screen: what happened, what is wrong or uncertain, the next permitted action, and who must act. Every primary screen must answer these four without scrolling, clicking, or reading technical text. Validate with at least a small observed usability exercise before claiming success.
- The one-sentence rule. For each main screen, a first-time viewer should be able to restate the workflow in one plain sentence, for example `A suspicious invoice arrives, the system checks it against orders and receipts, a human approves, and only then does it post.` If the screen cannot support that sentence, the screen is not finished.
- Plain words first. Labels answer the four questions in everyday language. Internal codes, enum names, and policy IDs appear as secondary detail, never as the primary label. Numbers use the project's existing tabular figures and correct units. Colors never carry meaning alone; every colored status has text.
- Progressive disclosure. Primary action, the core mismatch or cost, and evidence status are visible immediately; history and the deep audit trail are one click away. The technical inspector stays collapsed by default.
- Honest states. Keyboard, focus, readable contrast, zero, error, and loading states, and mobile overflow remain functional. Existing browser-test selectors and responsive layouts must not regress.
- No invented gravity. Do not imply production deployment, regulatory certification, real vendor connectivity, verified cost savings, or detection precision unless supported by evidence.

---

## 7. EXECUTION COMMANDS AND CHECKPOINTS

Check the available npm scripts first; use the profile's recorded commands. Expected workflow where present:

```bash
git status --short
git branch --show-current
npm run typecheck
npm test
# Per change: targeted tests plus the commands above
# Per wave and final, if available:
npm run test:all
```

If the full suite invokes a browser that cannot be installed in the environment, report the limitation and the exact skipped command. Do not call an unrun browser suite passing. Do not introduce networked installs unnecessarily. After any migration, smoke-test both a fresh database and a copied historical database. Back up the demo database before destructive reset scripts.

At the end of each change, report:

```text
CH-N: <title>
Status: PASSED | BLOCKED | DEFERRED
Commit: <SHA or uncommitted>
Files changed: <paths>
Tests added/updated: <test names and reason>
Verification: <commands, counts, pass or fail>
Behavior preserved: <key old path>
Schema or data effect: <none or migration>
Demo effect: <none or optional fixture>
Rollback: <safe exact checkpoint or revert guidance>
Next CH: <ID only if safe>
```

Stop immediately on unknown authority behavior, surprising state, irreproducible tests, an unsafe migration, or new network side effects. Do not continue into the next spec and create stacked failures.

---

## 8. FINAL REPORT AND INTERVIEW HANDOFF

Produce `docs/V3-CHANGE-REPORT.md` with:

1. Baseline versus final: actually executed commands, test file and test counts, browser, build, and lint outcomes. Distinguish historical numbers from observed numbers.
2. The change register for every CH, including the optional deployment wave: delivered, deferred, or blocked, with commit SHAs, files, tests, documentation changes, and rollback checkpoints.
3. Invariant evidence: the authority gateway, forged-role rejection, stale-revision rejection, idempotent replay, per-part bounds, message freshness, fail-closed non-simulated behavior, compensating reversal, and original demo integrity.
4. Migrations: fresh and prior-database verification, legacy behaviors, and forward and backward compatibility limits.
5. Explicitly rejected: new infrastructure, new model provider, UI overhaul, unattended approval over a ceiling, external identity or signature fiction. List what was considered and declined for this project.
6. Known limitations: simulated systems and role identity, local-only hash-chain limits, unverifiable legacy rows, deliberately missing integration, revenue, or compliance claims, and any deferred change with its reason.
7. Demo walkthrough: a short narration for each demonstrated workflow with exact trace and evidence checkpoints and what is simulated.
8. Interview architecture explanation: event, extraction, policy decision, authority, port or tool call, state mutation, read-after-write and trace, including failure paths and why per-record authority survives bulk operations.
9. Product validation: clearly separate usability targets from observed metrics. Do not invent evidence of superiority.
10. Deployment and analytics evidence: VPS and container feasibility for the actual stack, passcode server verification and route protection, observed zero pre-entry analytics calls, masking and consent setup, the actual deployed URL only if verified, and whether configuration or deployment remains pending.
11. Verbatim command evidence: show actual final terminal output and skipped commands with reasons. Never fabricate tests or an execution environment.

---

## 9. REJECTED / OUT OF SCOPE

- External caches, message brokers, or new databases for the single-process demo.
- Multi-currency, tax jurisdiction modeling, or settlement processing unless the domain already has them.
- A new model provider, an autonomous unguarded agent, direct vendor credentials, or real vendor connectivity.
- A new CSS or component framework, replacing the established navigation, or a generic data platform rebuild.
- Automatic approval because an approver is late, a party appears reliable, or a record looks similar to another.
- Claims of cryptographic human identity from demo sessions, immutable local logs, regulatory certification, legal compliance, or quantified loss avoidance without external evidence.
- Replacing established working tests or the original seeded demo merely to make new features fit.

---

## 10. FIRST RESPONSE REQUIRED FROM THE AGENT

Before applying CH-1, respond with only the verified baseline assessment and a proposed CH-1 diff plan, and acknowledge that this is an existing working application and that CH-20 to CH-22 are isolated deployment additions:

1. Current branch and worktree safety, architecture summary in the project's own vocabulary, and the exact commands available.
2. Baseline test, build, and typecheck outcome and the verified seeded scenario outputs.
3. Conflicts between this spec and the repository code, with proposed safe interpretations.
4. CH-1 touched files, targeted tests, expected zero demo changes, and the rollback checkpoint.
5. Whether the project can safely proceed. Do not mark any change completed and do not claim file edits before they occur.

After that, implement the smallest next batch following section 2, verify it, and report evidence. Protect the project's existing working core above all feature ambitions.

---

## APPENDIX A: ADAPTING THIS SPEC TO A NEW PROJECT

1. Copy this file into the new repository as `docs/UNIVERSAL-V3-SPEC.md`.
2. Fill in the PROJECT PROFILE (section 0.3) from actual code. Every fill-in failure is a baseline finding.
3. Adjust only three things if the domain demands it: the comparison values in CH-10, the party in CH-8, and the summary terminology in CH-7. Everything else applies unchanged.
4. If the project lacks a piece of the shared anatomy (no approval step, no audit table, no inspector), do not build it as part of this spec. Mark the dependent changes DEFERRED with the minimal alternative.
5. Keep the language rules in force for every commit: simple English, no em dashes, technical words only when they name something real, UI copy a first-time viewer can read in 30 seconds.

End of specification.
