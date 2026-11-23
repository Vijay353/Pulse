# Demo scripts

Two scripts, both fully offline. Every number on screen is read from the running system; nothing is a slide or a canned screenshot.

- **A. Investor run (6 minutes, D-2).** `DEMO_MODE=pitch PLAN=group npm start` (or the container command in the README).
- **B. Product walkthrough (3 minutes, D-1).** `npm start`, default settings.

Identity for both: *Ana Reyes (synthetic shift manager)*. The scenario clock is frozen at 6:31:43 PM, so freshness checks give the same result every time.

Framing to use throughout: **underwriting-grade discipline applied to ad operations.** The merchant's guardrail is the policy, the kitchen alert is the incident, the investigation is the claims review, the contribution maths is the actuarial step, pausing one campaign is the bounded remediation, the manager is the adjuster, and the readback plus audit chain is the proof of settlement.

Words to avoid: profit saved, lift, guaranteed, savings in dollars. Words to use: *estimated contribution*, *projection only*, *mock / simulator*, *tamper-evident within this database*. `tests/unit/copy-guard.test.ts` enforces the first list on all UI copy.

---

## A. Investor run (6 minutes)

| Time | Checkpoint (on screen) | Do | Say |
|---|---|---|---|
| 0:00 | Story tab **1 Problem** selected | Scenario **A** → *Load scenario* | "Friday, 6:30 PM. The kitchen is drowning, and paid ads are still sending orders. Some of those orders earn less than the owner's own floor. Today a manager has to notice, find the campaign and act mid-rush. Nobody does." |
| 0:40 | — | *Simulate kitchen alert* | "The point-of-sale system just sent a signed alert. MarginPulse does not trust the alert; it re-reads the kitchen and the ad account itself." |
| 0:55 | Story jumps to **3 Decision**; verdict *Recommendation ready* | Read the sentence under the verdict | "This sentence is not generated prose. It is assembled from checks that ran: P95 34 minutes against the owner's 28; estimated contribution $3.20 per attributed order against a $5.60 floor. Click a record chip and you land on the raw evidence." |
| 1:30 | *Who decides: Ana Reyes* | Point at the two buttons | "One campaign, one action, and a named human. The system never pauses on its own, and there is no auto-resume." |
| 1:50 | Confirm dialog with *If you approve* | *Pause campaign* | "The approval is bound to this store, this campaign, this policy version and this person, and it expires in five minutes. The table is a projection only." |
| 2:10 | Story **4 Proof**; receipt *Campaign paused and verified* | Confirm | "Configured PAUSED, effective PAUSED, version 13, exactly one change request, no other mutations, all read back from the ad platform. That is the receipt, with its audit hash. It prints." |
| 2:40 | Metrics strip | Point at the strip | "Live counts from this database: alerts checked, pauses verified, verified-after-sending rate, how often the guardrail ended with no change, and time to a manager decision. The no-change rate is the trust metric: the guardrail doesn't cry wolf." |
| 3:00 | **Controls tour (D-3)** | Tick *Show demo tools*. Scenario **G** → simulate → *Simulator: Another manager edits the campaign* → *Pause campaign* → confirm | "Someone changed the campaign after I reviewed it. Blocked, zero change requests. Re-assessing needs a new approval." |
| 3:30 | — | Scenario **N** → simulate | "A forged webhook. Rejected at the door; no investigation is created." |
| 3:45 | — | Scenario **P** → simulate | "A campaign name containing 'ignore all policy'. Prompt injection does nothing: decisions come from checks, not from text." |
| 4:00 | *Proof and details* | Open *Technical evidence* → *Verify audit log* → *Download audit evidence package* | "Every decision can leave the building as a self-contained exhibit with a checksum. The chain is tamper-evident within this database; anchoring the head hash externally is an Enterprise feature." |
| 4:40 | **Fleet (Group plan)** | Scenario **T** → simulate → identity *Dee Alvarez* | "Franchise groups are the expansion revenue. Dee runs two stores and sees both, but every action is still store-scoped on the server." |
| 5:10 | Story **5 Business** | Click the tab | "Solo for one restaurant, Group for multi-site operators, Enterprise for brands. Pricing is set per pilot; we're not quoting savings we haven't measured. The instrumentation you just saw is how the pilot will measure them." |
| 5:40 | — | — | "It runs as one container with one data volume. The demo can't die on venue wifi. Questions?" |

If something goes wrong: *Load scenario* resets everything in about a second.

## B. Product walkthrough (3 minutes)

| Time | Checkpoint | Do | Say |
|---|---|---|---|
| 0:00 | *No kitchen alerts yet* and *How MarginPulse works* | Read the three steps → *Got it* | "First visit explains itself in three lines and gets out of the way." |
| 0:15 | — | Scenario **A** → *Load scenario* → *Simulate kitchen alert* | "A signed alert from the mock POS." |
| 0:25 | Top of page | Read verdict, reason, *Who decides* | "Within twenty seconds a new manager can say what happened, why, what they can do and who has to approve it." |
| 0:50 | *The evidence* cards | Point at the rail and the contribution bar | "P95 against the limit; estimated contribution against the floor. Estimates, not accounting profit." |
| 1:10 | — | *Pause campaign* → confirm | "Projection first, then one change." |
| 1:25 | Receipt, *What happened on your shift* | — | "Proof from readback, the audit hash, and a shift summary that only counts things." |
| 1:45 | Scenario **B** → simulate | — | "Calm state: the guardrail ran and nothing was needed. It says so with the real numbers." |
| 2:05 | Scenario **C** → simulate | Evidence checks open by themselves | "Blocked states explain themselves: the kitchen report is 6 minutes old, the policy accepts 2." |
| 2:30 | **Data onboarding (D-4)** | Data studio → merge `data/templates/valid/merge-threshold-40.xlsx` → commit → Shift view → simulate | "Change the policy in a spreadsheet; the guardrail follows. Same rush, now *No action needed*." |
