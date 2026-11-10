# Data import guide

The **Data studio** tab (or `/api/data/*`) lets you edit the synthetic records behind the simulators in Excel. A workbook **configures simulators**; it is not a live integration and not a system of record.

Schema id: `marginpulse-workbook/1`. Source of truth: `apps/api/src/imports/schema.ts`. The downloadable workbook's **README** sheet lists every column with type, required/optional, editable/system-managed and allowed values; `GET /api/data/schema` returns the same as JSON.

## Files

| File | Use |
|---|---|
| `data/templates/marginpulse-sample-workbook.xlsx` | Canonical sample (scenario A). Re-importing it unchanged is a no-op. |
| `data/templates/valid/merge-threshold-40.xlsx` | Merge: raises the Downtown limit to 40 min → next rush is NO_ACTION. |
| `data/templates/valid/campaigns-read-only.csv` | CSV merge (entity `campaigns`): permissions READ → next rush is BLOCKED_MISSING_PERMISSION. |
| `data/templates/invalid/*.xlsx` | One defect each: missing sheet, wrong types, duplicate ids, orphan reference, invalid status, formula cell, Excel date cell, stale revision. |

Regenerate with `npm run template`.

## Sheets

| Sheet | Key | Owner | Notes |
|---|---|---|---|
| users | user_id | MarginPulse | Demo identities only |
| user_stores | user_id + pos_store_id | MarginPulse | |
| stores | pos_store_id | Mock POS | `alert_threshold_minutes` is the POS's own alert line |
| store_mappings | mapping_id | MarginPulse | Exactly one per POS store or the decision goes to review |
| kitchen_snapshots | snapshot_id | Mock POS | `captured_at` ISO-8601 with offset, as text |
| cost_profiles | pos_store_id | Mock POS | Blank values allowed → NEEDS_REVIEW_COST_DATA |
| ad_accounts | account_id | Mock Uber Ads | USD only |
| ad_account_stores | account_id + uber_store_id | Mock Uber Ads | |
| campaigns | campaign_id | Mock Uber Ads | `store_ids`, `permissions` are `;` lists; `version` is system-managed |
| campaign_reports | report_id | Mock Uber Ads | `watermark ≥ window_end > window_start` |
| merchant_policies | policy_id + version | MarginPulse | One current per store; approval cannot be disabled |

## Rules

- **Timestamps:** text, ISO-8601 with an explicit offset (`2026-10-18T18:31:20-04:00`). Excel date cells are rejected because they carry no time zone.
- **Money:** dollars with at most 2 decimals; stored as integer cents. **Rates:** percent 0–100; stored as basis points.
- **Values only:** formula cells, hyperlinks and error cells are rejected cell by cell. Macros and embedded objects are never executed (ExcelJS reads cell XML only).
- **Limits:** 2 MB, 2,000 rows per sheet, 30 columns. Unknown columns are errors; unknown sheets are ignored with a note.
- **Never importable:** approvals, events, tokens, investigations, audit. Those are system-managed.

## Modes

- **replace** — the workbook becomes the whole simulator dataset. Every sheet is required. Rows missing from the file are reported as *removed*.
- **merge** — rows are upserted by key; sheets are optional. References are checked against the merged result. CSV files are merge-only (one entity per file).

## Validation → preview → commit

1. Structure: required sheets/columns, no unknown columns, limits.
2. Cells: type, enum, decimals, timestamp format, list syntax.
3. Keys: duplicates within a sheet.
4. References and invariants on the merged world: users/stores/accounts exist, campaign stores belong to the account, report campaign/account match, window ordering, one current policy per store, approval required.
5. **Stale revision:** an existing campaign's `version` must equal the simulator's current version.
6. Preview shows added / updated / unchanged / removed / rejected per sheet, record-level changes and row-level errors. Nothing is written.
7. **Commit** (only for an error-free preview) re-validates against current state (rejected if the world changed), snapshots the current data, applies everything in one SQLite transaction, then re-queries counts. Changed campaigns get `version + 1` and a ledger entry.
8. **Restore** re-applies the snapshot taken before a committed batch (versions still move forward).

## Export

`/api/data/export.xlsx` (all sheets + README) and `/api/data/export/{entity}.csv`. Strings beginning with `= + - @` tab or CR are prefixed with `'` to prevent formula injection; the importer strips that prefix on the way back, so exports round-trip.
