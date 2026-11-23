# Plans (CH-17)

MarginPulse is packaged as three plans. This is a pricing **structure**, not a price list: prices are set per pilot, and nothing here claims revenue, savings or lift. There is no billing integration; `PLAN` is a deployment setting.

| | Solo | Group | Enterprise |
|---|---|---|---|
| For | One restaurant | Franchise and multi-site operators | Large groups and brands |
| Stores | 1 | Up to 10 | Custom |
| Kitchen-alert guardrail, manager approval, verified pause | ✓ | ✓ | ✓ |
| Plain-English reason for every decision | ✓ | ✓ | ✓ |
| Receipt, audit evidence package, audit verify | ✓ | ✓ | ✓ |
| Signed webhook notifications | ✓ | ✓ | ✓ |
| Fleet view across stores | | ✓ | ✓ |
| Team identities per store, shift digests per store | | ✓ | ✓ |
| Single sign-on, custom policies and contribution models | | | ✓ |
| External anchoring of the audit head hash | | | ✓ |

Source of truth in code: `packages/contracts/src/plans.ts` (`PLAN_TABLE`, `planAllows`). The pitch panel's Business chapter renders the same table.

## What is enforced today

- The server enforces plans **only on surfaces added for packaging**. Today that is `GET /api/fleet` (Group and up), which returns `403 PLAN_REQUIRED` with a plain message on Solo. The UI shows that message without blocking anything else.
- Every control that existed before packaging (approval, pause, retry, check again, re-assess, evidence package, audit verify, data studio) works on every plan. That rule is deliberate: a commercial gate must never weaken or hide a safety control.
- "Team identities" and "SSO" are roadmap items. The demo identity switcher is not authentication on any plan.

## Who pays and why (pitch notes)

- **Buyer:** the operations lead of a multi-location group who owns both the kitchen service level and the ad budget.
- **Wedge:** Solo, one store, one guardrail.
- **Expansion:** stores per account (fleet view), retention through notifications, and compliance value through evidence packages and audit verification.
- **Not claimed:** revenue, savings or lift figures. A pilot would measure them with the counts already shown in the metrics strip.
