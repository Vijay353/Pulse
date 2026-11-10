# Demo script (≈3 minutes)

Start: `npm start`, open http://127.0.0.1:8787, identity *Ana Reyes (synthetic shift manager)*.

| Time | Do | Say |
|---|---|---|
| 0:00 | Scenario **A** → *Load scenario* | "Everything is synthetic and local. The clock is frozen at 6:31:43 PM so freshness is deterministic." |
| 0:15 | *Simulate kitchen alert* | "The mock POS just signed a webhook and posted it to MarginPulse over HTTP." |
| 0:30 | Point at the rail and the three cards | "P95 is 34 against the manager's own 28. One Sponsored Listing is active. Estimated contribution is $3.20 per attributed order against a $5.60 floor — an estimate, not profit. The report is 12 minutes old and shown as such." |
| 0:55 | Open *Simulator controls* | "This table is the ad simulator's live state: ACTIVE, version 12, zero PATCH requests." |
| 1:10 | *Pause campaign* → read dialog → confirm | "The approval is bound to this campaign, this store, this policy version and me, and expires in five minutes." |
| 1:25 | Result panel | "Configured PAUSED, effective PAUSED, version 13, one PATCH, other mutations none — every value comes from reading the campaign back, not from the button." |
| 1:45 | *Technical evidence* | "Evidence ids the investigator cited, the policy checks in order, the redacted PATCH, readbacks, and a hash-chained audit trail." |
| 2:05 | Scenario **G**, simulate, *Another manager edits the campaign*, Pause | "Someone changed it after I reviewed it. Blocked, zero PATCHes. Re-assess requires a new approval." |
| 2:30 | Scenario **J**, simulate, Pause | "Uber accepted the pause but it's still serving. We don't call that success." Wait ~6 s → *Check again* → verified. |
| 2:50 | Data studio → upload `valid/merge-threshold-40.xlsx` (merge) → commit → back → simulate | "The merchant raised their limit to 40 in a spreadsheet; the same rush is now No action." |
