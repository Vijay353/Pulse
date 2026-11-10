# Deployment: one small VPS (V3 CH-22)

Status, stated plainly:

| Checkpoint | Status | Evidence |
|---|---|---|
| CH-22A container definition (`Dockerfile`, `.dockerignore`) | CONFIGURED | Written, not built. The authoring environment has no Docker daemon and its network blocks Docker Hub (HTTP 403). |
| CH-22A persistence and production start-up | TESTED_LOCALLY | `tests/integration/production-start.test.ts` (6 tests) and the process-level dry run below. |
| CH-22B production deploy, restart and backup on a VPS | NOT_RUN | Needs your server, DNS and panel access. Nothing was deployed, pushed or installed. |

This is a single-instance, stateful deployment: one container, one SQLite file on a mounted volume, no replicas. SQLite is kept on purpose; nothing in this demo needs more.

## What runs

- One Node 22 process serves the built React UI, the MarginPulse API and both simulators on one origin (`/`, `/api/*`, `/mock-pos/*`, `/v1/ads/*`, `/mock-ads/*`).
- MarginPulse calls the simulators over HTTP on the same process, as it does locally.
- `GET /healthz` is a read-only readiness check (`{"ok":true}`, or 503 if the database cannot be read). `GET /api/health` reports provider setup problems.

## Environment variables

| Variable | Production value | Notes |
|---|---|---|
| `NODE_ENV` | `production` | Turns on fail-closed start-up checks and turns off automatic seeding. Set in the image. |
| `HOST`, `PORT` | `0.0.0.0`, `8787` | Set in the image. Expose the port only to the panel's reverse proxy; no host port is needed. |
| `DATABASE_PATH` | `/data/marginpulse.db` | Alias of `DB_PATH`. Must be on a persistent mount. SQLite sidecar files stay in the same folder. |
| `POS_WEBHOOK_SECRET` | random, 24+ characters | Start-up refuses placeholders and short values. Only the variable name is ever printed. |
| `UBER_ADS_TOKEN` | random, 24+ characters | In SIMULATED mode it is only checked by the local mock. Same start-up rule. |
| `ACCESS_GATE`, `ACCESS_PIN`, `SESSION_SECRET`, `TRUST_PROXY` | see CH-20 in `README.md` | Visitor access gate. |
| `VITE_CLARITY_PROJECT_ID` | optional | CH-21. A public identifier, not a secret. Pass it as a build argument (`--build-arg VITE_CLARITY_PROJECT_ID=...`, or the panel's build variable) and also as a runtime variable so the server allows Clarity's domains in the CSP. In the Clarity dashboard, keep masking on its strict setting and turn on the cookie-consent requirement if you expect EEA, UK or Swiss visitors. |

Generate secrets with `openssl rand -hex 24`. Keep them in the panel's environment settings, never in the repository or the image.

## Start-up rules (production)

1. Missing or placeholder secrets: the process exits with a list of the variables to fix.
2. Data directory not writable: the process exits with `Refusing to start: the data directory ... is not writable`.
3. Database never bootstrapped: the process exits and asks you to run `npm run bootstrap` once. It never seeds or resets on start, restart or redeploy.

## First installation (CH-22B, needs your authorization and access)

1. Provision the VPS and install the panel with the panel's current official instructions. Check current sizing, price and region at that time.
2. Firewall, confirmed with you before it is applied: SSH limited to your IP where practical; 80 and 443 public; the panel port limited or protected during setup. Container ports published with `-p` can bypass host firewalls such as UFW, so let the panel's proxy reach the container on its internal network instead of publishing a host port.
3. Create the application from this repository's `Dockerfile`. Before the first build, check that the `NODE_IMAGE` tag exists for the server's CPU architecture and pin it by digest.
4. Add one persistent volume mounted at `/data`, owned by uid 1000 (the image's `node` user). One instance only; never share this mount between containers.
5. Set the environment variables above. Point DNS at the server, let the panel issue TLS and turn on the HTTP to HTTPS redirect.
6. Run the bootstrap once as a one-off command in the container: `npm run bootstrap`. Running it again changes nothing.
7. Deploy. Check `https://<host>/healthz`, the gate, a protected API URL without a session (expect 401), the app, a deep link such as `/data`, and scenario A from alert to verified pause.
8. Restart the container and redeploy the same image with the same mount. Check that the same investigation, audit entries and campaign state are still there and that the audit log verifies.

## Backups and restore

A mounted volume is not a backup.

- `npm run backup -- /data/backups/marginpulse-<time>.db` writes a consistent copy with SQLite `VACUUM INTO` (safe while the app runs), then reopens the copy read-only and checks `integrity_check`, the audit hash chain and its head, and row counts against the source. It exits 1 if anything differs.
- Schedule it from the panel or host cron, copy the files off the host, and keep a few local copies with permissions limited to the app user.
- Restore test: stop the app, copy a backup to a new, empty volume path, start a throwaway instance on it, and compare investigations, audit verification and the campaign change log. `tests/integration/production-start.test.ts` does this on every test run.
- Keep panel configuration backups separate from database backups.

## Rollback

- Redeploy the previous image with the same `/data` mount. The database is not touched.
- Schema changes in V3 are additive (CH-17 adds one nullable column). Older code can still read the file, but rows written in hash format 2 will not verify under pre-V3 code. If you must go back past V3, restore the backup taken before the upgrade instead of reversing the migration.
- Clean up images only with the panel's own setting, or with a dry run first. Never prune volumes, and keep the image you might roll back to.

## Demo resets on a hosted instance

"Load scenario" in the app drops and recreates every table, including the audit log. That is the demo's purpose, and it happens only when a visitor presses the button, never on start-up. Treat the hosted database as a throwaway demo database. To reset by hand: `npm run reset -- A` inside the container.

## Process-level dry run (TESTED_LOCALLY, 2026-11-09)

Run on a clean copy of the repository with runtime dependencies only (`npm ci --omit=dev`; no Vite or test tools present), the built UI, `NODE_ENV=production`, `HOST=0.0.0.0`, a fresh data directory and random secrets. This mirrors the image's runtime stage but is not the image.

```
1. start before bootstrap  -> Refusing to start in production: ... has not been bootstrapped.
2. bootstrap twice         -> Bootstrapped ... with scenario A. / ... already bootstrapped (scenario A). Nothing changed.
3. start                   -> healthz {"ok":true}; GET / 200 text/html; GET /data (deep link) 200
   scenario A              -> inv-1042 PAUSE_VERIFIED, 13 audit entries
4. restart                 -> inv-1042 PAUSE_VERIFIED, 13 audit entries; audit chain ok
5. backup                  -> integrity ok, chain ok, same head, counts equal (mp_audit 14,
                              investigations 1, approvals 1, mutations 1, ledger 1), matchesSource true
```

## Visitor gate in production mode (CH-20, TESTED_LOCALLY, 2026-11-09)

Same machine, `NODE_ENV=production`, `HOST=0.0.0.0`, random secrets, bootstrapped database, plain HTTP on localhost (so the `Secure` cookie is set but TLS is not exercised):

```
GET  /healthz                         200
GET  /data (Accept: text/html)        302 -> /access?next=%2Fdata
GET  /api/investigations, no session  401
GET  /assets/<bundle>.js, no session  401
POST /access/login wrong code         401
POST /access/login right code         303, set-cookie: mp_access=<redacted>; Path=/; HttpOnly; SameSite=Lax; Max-Age=7200; Secure
GET  /api/investigations, session     200
GET  /data, session                   200
start without ACCESS_PIN/SESSION_SECRET -> Refusing to start: ACCESS_PIN must be exactly four digits; SESSION_SECRET must be ...
```

Behind the panel's proxy, set `TRUST_PROXY=1` so the rate limit sees the visitor's address instead of the proxy's. Do not set it when the app is reachable without that proxy.

## Analytics with a project ID set (CH-21, TESTED_LOCALLY with a dummy ID, 2026-11-09)

Scripted Chromium run against a build with `VITE_CLARITY_PROJECT_ID=abc123xyz9` and `VITE_CLARITY_ALLOW_LOCAL=true`. Requests to `clarity.ms` and `c.bing.com` were intercepted and answered locally, so no real data left the machine; the automation flag was masked so the loader would run. Not verified against a real Clarity project.

```
gate page: clarity requests            0
after wrong code: clarity requests     0
app before consent: clarity requests   0
after Allow                            1 request: https://www.clarity.ms/tag/abc123xyz9
queued calls                           consentv2 {ad_Storage: denied, analytics_Storage: granted}, event project_entered, event scenario_started
after reload                           1 more tag request (one per page load); project_entered not sent again
after Turn off                         consent false
gate CSP without a session             default-src 'self' ... connect-src 'self' (no Clarity domains)
```

Sources: Microsoft Learn, Clarity client API, consent API v2 and CSP pages (checked 2026-11-09).
