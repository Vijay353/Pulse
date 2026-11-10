# Decision log

## Implementation decision record

| Item | Decision |
|---|---|
| Product thesis | A busy manager should be able to stop buying extra demand when the kitchen passes *their own* limit — with evidence, one click and proof the change happened. |
| Primary persona | Independent restaurant owner or shift manager, mid-rush, on a tablet or laptop. |
| Primary workflow | Kitchen threshold event → bounded investigation → deterministic policy → manager approval → one campaign pause → readback → verified result. |
| Minimum success metric | One approved PATCH, readback configured+effective PAUSED, audit entry, no unrelated state change (all asserted in tests). |
| Integration boundaries | Uber Ads campaigns/reports (port), POS kitchen snapshot + cost profile + webhook (port), optional model provider (port). |
| Deployment | Local single process, SQLite, simulators in-process but reached over HTTP. |
| Architecture | Rules engine + deterministic calculator + bounded read-only investigator + orchestrator state machine. No RAG, no multi-agent framework, no queue. |
| Critical risks | False pause (trust), stale or mixed-freshness data, wrong campaign/store, ambiguous write outcomes, prompt injection via vendor text, over-claiming value. |
| Simulated | Uber Ads, POS/KDS, model provider (optional, scripted in tests), identity (demo switcher), clock. |

## Concept corrections (ORIGINAL → CHANGE → REASON → CONSEQUENCE)

| # | Original | Change | Reason | Consequence |
|---|---|---|---|---|
| 1 | Omnibus MarginPulse (promos, menu, pacing, disputes, ads) | One reversible action: pause one Sponsored Listings campaign | Spec §1; only this can be proven end-to-end with documented APIs | Narrow but complete and testable |
| 2 | Event `signature: "fixture-valid"` | Real HMAC-SHA256 over a canonical payload | A literal string authenticates nothing; spec §19 requires signed webhooks | Forged/tampered events are rejected (tests N, tamper) |
| 3 | Event `occurredAt` = snapshot time | Event time = POS emission time; snapshot age checked separately | Otherwise a stale snapshot would always fail as a stale *event* first, hiding the real reason | Scenario C correctly reports BLOCKED_STALE_KITCHEN_DATA |
| 4 | Effective status ACTIVE/PAUSED as fact | Map raw strings to SERVING / NOT_SERVING / UNKNOWN; unknown fails closed | Uber's docs list different effective-status values on different pages | Verification won't pass on an unexpected value |
| 5 | "Use the version in a stale-read guard" | Internal pre-write re-read only; race documented | Uber's PATCH body has no version/If-Match field | Small window remains; flagged TO_VERIFY |
| 6 | Mock reports at `/mock-ads/:accountId/reports` | Kept, explicitly MOCK-ONLY; real adapter fails closed on reports | Real reporting is asynchronous | SANDBOX/LIVE investigations are blocked until implemented |
| 7 | Fixture import includes approvals and webhook events | Excluded | Spreadsheet-supplied approvals would bypass authorization; events must arrive signed | Safer import surface |
| 8 | Contribution floor "$5.60 or 20%" | Compare exactly on window totals in integer cents; $5.60 is the per-order display of 20% | Avoid float rounding at the boundary | Exactly 20% is not below the floor (unit test) |
| 9 | Real-time clock | Frozen simulated clock advanced on demand | Deterministic freshness; staleness can be demonstrated on purpose | Approval TTL and staleness are testable |
| 10 | Spec state list | Added transitions NOT_VERIFIED → PAUSE_REQUESTED (retry) and → PAUSE_VERIFIED (later check); BLOCKED for execution failures | Needed for truthful recovery after 429 / dropped connections / lag | Retry only after readback proves non-application |
| 11 | Recommendation valid indefinitely | Recommendation TTL (600 s) and approval TTL (300 s) from the policy | A pause approved on old evidence is unsafe | BLOCKED_RECOMMENDATION_EXPIRED / approval_not_expired checks |

## Conflicts resolved

| Conflict | Resolution |
|---|---|
| Spec §11 lists the agent check after the contribution floor; agent runs first in §8 | Agent investigates first; its *output* is evaluated after fact checks. Facts alone can stop the flow; the agent can only stop it further (abstain/invalid), never start it. |
| Master contract asks for Penpot SVG assets "if in scope" | Not produced; the user supplied a wireframe and the runnable UI was prioritized. Screenshots of the real UI are in `docs/screenshots/`. |
| Master contract file names vs spec §22 docs names | Master names used; README maps spec names (decision-record → this file, api-boundaries → SIMULATOR-CONTRACTS/INTEGRATIONS, limitations → IMPLEMENTATION-STATUS, demo-script → DEMO-SCRIPT). |
| Spec says React "TanStack Query or equivalent" | Small fetch layer; every action re-reads server state. |
| Spec project layout `apps/ packages/` with separate packages | Kept the directory layout; one `package.json` (no workspaces) to keep install and scripts simple. |
| Wireframe uses all-caps labels and a green brand square | Kept layout and copy; used sentence case and a neutral identity to avoid imitating Uber branding. |
