# Portfolio case study — MarginPulse

*Concept prototype. Not an Uber product. No user research has been conducted yet; nothing below claims customer impact.*

## Problem

During a sudden rush, a restaurant's kitchen and its paid demand live in different systems. The KDS shows tickets backing up; Uber Ads keeps buying Sponsored Listings placements. The person who can pause the campaign is the person running the line. Pausing means noticing, switching systems, finding the right campaign for the right store, judging whether it's worth it, and later checking it actually stopped.

## What I narrowed

The starting concept bundled promotions, ad optimization, menu sync, kitchen/courier pacing and dispute filing, and assumed privileged telemetry. I cut it to the one action that is reversible, documented in a public API and provable end to end: **pause one Sponsored Listings campaign, with a manager's approval, and prove it happened.**

## What I built

- A local full-stack system: React UI, Node/Fastify API, SQLite, and two **stateful simulators** (POS/KDS and Uber Ads) that MarginPulse reaches over HTTP.
- A deterministic **policy engine** with 18 ordered checks; the first failure decides, and the UI explains it in plain language.
- An **investigator** that may only call read-only tools; its report must cite stored evidence whose values match, or it is discarded. A deterministic default runs without credentials; an optional model-backed one uses the same tools and contract.
- A **single write path** with approval binding, a pre-write re-read, an idempotency reservation, one PATCH, and readback-based verification that distinguishes configured from effective status.
- A **data studio** that loads simulator data from Excel with row-level validation, preview, atomic commit, restore and formula-safe export.
- 81 Vitest and 6 Playwright tests run green in the build environment (see TEST-REPORT).

## Decisions worth discussing

- **The agent explains; code decides.** Money, permissions, freshness and the write are deterministic. The model can only make the system *more* cautious.
- **HTTP 200 is not success.** The verdict is based on readback; ambiguous outcomes (dropped connection, 5xx) are resolved by reading state, never by resending.
- **Freshness is shown, not hidden.** The ads report is ~10 minutes behind by design; the UI shows the watermark and refuses contribution-based pauses on old reports.
- **Pause persists.** External auto-resume isn't offered, so the UI says so at the moment of decision.
- **Vendor uncertainty is surfaced.** Uber's docs disagree on effective-status values and the PATCH has no version precondition; both are flagged and handled conservatively.

## What it does not prove

User value, adoption, any revenue or cost effect, real Uber/POS behavior, or production security. Those require the discovery plan in the spec (rehearsed rush observations, threshold elicitation, comprehension tests) and partner access.

## How I would measure it

Time from kitchen exception to an informed decision; correct-campaign identification; percentage noticing "approval required" and "stays paused"; acceptance by scenario; false-intervention rate; stale-data block rate; readback verification success.
