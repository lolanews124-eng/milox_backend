# Bots module (activity engine)

Staff-only automated-account management under `/api/v1/admin/bots`.

## Safety defaults

- `BOTS_WORKER_ENABLED=false` — activity worker does not claim or execute jobs.
- `BOTS_TARGET_POLICY=disabled` — no automatic targeting (default).
- `test_fixtures_only` (local/test E2E) — planner **and** executor only use content
  marked with `[[MILLOX_BOTS_TEST_FIXTURE]]` (post body / user bio or displayName).
- `fresh_public` (local/test) — ranks recent eligible public posts (and active users
  for follows) by post time + author activity. No fixture markers required.
  Staging/production always resolve to `disabled` even if the env var is mis-set.
- `BotSettings.killSwitch` / `globalPause` default **true**.
- Views remain disabled (`viewsEnabled` forced false; view job types always skip).
- Live provisioning requires `dryRun=false`, `confirm=true`, and `confirmPhrase=PROVISION`.
- Production provisioning is hard-blocked; local/staging use env guards.
- Mutations outside `MILOX_ENV=local|test` require `BOTS_ALLOW_MUTATIONS=true`.
- Provisioned bots are **new** accounts (`isAutomatedAccount=true`); the human source is never converted.
- **Display name** is preserved exactly from the source profile (falls back to source username).
- **Username** starts from the source username with the smallest uniqueness mutation (digit increment, append, then `_n`); `bot_<hex>` only after bounded retries. No mandatory `_mx` suffix.
- **Bio** is preserved from the source when present (null/empty stays null).
- **Profile photo**: PUBLIC profile assets are cloned into a new bot-owned `MediaAsset` (source ownership unchanged). Private/inaccessible assets are skipped.
- New bots start **ACTIVE**. Activity still requires worker enabled + kill switch/global pause cleared. Existing paused bots are not auto-activated.
- Source human accounts are never converted, overwritten, or deleted.

## Ranking

`presence_v1`: `inactiveAt = lastSeenAt ?? createdAt` (estimate — `lastSeenAt` is chat presence only).

## Worker startup / shutdown

The API process starts `BotActivityWorker` only when `BOTS_WORKER_ENABLED=true`.

1. Keep kill switch / global pause **on** until you are ready.
2. Configure comment templates and activity toggles in Bots Manager → Activity settings.
3. Confirm which ACTIVE bots should run (pause any you want idle). New provisions start ACTIVE.
4. Set `BOTS_WORKER_ENABLED=true` in the **local** API `.env`, restart the API.
5. Clear global pause / kill switch only after reviewing the jobs preview.
6. SIGTERM/SIGINT stops the worker gracefully with other API workers.

Do **not** enable the worker against production without an explicit review.

### Planner shape (same tick)

Each `planTick` enqueues **at most one job per ACTIVE bot** (random among that bot’s
eligible action types). Scheduling like + comment + follow in one tick therefore
requires multiple ACTIVE bots with complementary permissions/budgets — not three
jobs for a single bot.

### Local rollback (do not apply in production without approval)

1. Set `BOTS_WORKER_ENABLED=false` and restart the API (stops planning/claiming).
2. Enable **kill switch** and **global pause** in Activity settings.
3. Pause or disable ACTIVE bots (pause cancels PENDING jobs).
4. Leave jobs history intact for audit; cancel stray PENDING if needed.
5. Do not delete domain likes/comments/follows unless a reviewed cleanup is approved.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `BOTS_WORKER_ENABLED` | `false` | Start planner + claim/execute loop |
| `BOTS_ALLOW_MUTATIONS` | `false` | Permit mutating bots APIs outside local/test |
| `BOTS_TARGET_POLICY` | `disabled` | `disabled` \| `test_fixtures_only` \| `fresh_public` (local/test only) |
| `MILOX_ENV` | — | `local` / `test` / `staging` / `production` |

### Safe local verification (E2E)

```powershell
$env:BOTS_E2E="1"
$env:BOTS_E2E_DATABASE_URL="postgresql://USER:PASS@127.0.0.1:5432/milox_bots_e2e?schema=public"
npm run test:bots-e2e -- --fileParallelism=false
# or focused:
npm run test:bots-e2e:auto-pipeline
npm run test:bots-e2e:mixed-tick
npx vitest run tests/bots-e2e/bots-target-guard.e2e.test.ts
npx vitest run tests/bots-target-policy.test.ts
npx vitest run tests/bots-fresh-discovery.test.ts
npx vitest run tests/bots-planner-targets.test.ts
```

Keep main `.env` at `BOTS_WORKER_ENABLED=false`. Use `test_fixtures_only` only against
`milox_bots_e2e`. Do **not** run automated engagement against ordinary users on
`milox_live_copy` (leave kill/pause on there; prefer `fresh_public` only when you
intentionally want local discovery on a dedicated or fixture-safe DB).

## Total vs organic engagement

| Surface | Semantics |
| --- | --- |
| `posts.likeCount` / `commentCount` (public API) | **Total** — human + automated. Domain services increment these when bots like/comment. |
| `users.followerCount` / `followingCount` | **Total** — human + automated followers/following. |
| Feed `trendingScore` | **Organic** — likes, comments, and follower boost use SQL that excludes `isAutomatedAccount`. Bots must not inflate popularity rankings. |
| Domain rows (`post_likes`, `comments`, `follows`) | Source of truth for both total and organic breakdowns. |
| `bot_activity_jobs` | **Operational** — automated activity job history. |

Organic counts for analytics: `COUNT(*)` from domain tables joined to `users` where `isAutomatedAccount = false`.

## Daily limits

Per-bot caps (`maxLikesPerDay`, `maxCommentsPerDay`, `maxFollowsPerDay`) use **UTC**
day boundaries (`BOT_DAILY_LIMIT_TIMEZONE = "UTC"`). Successful actions are counted
from domain tables; PENDING/PROCESSING jobs reserve budget so concurrent workers
cannot exceed the cap. Limits are checked at plan time and again immediately before
execute (excluding the claimed job from in-flight).

**Missing permission keys use documented defaults** (`DEFAULT_BOT_PERMISSIONS`),
not unlimited. PATCH `/admin/bots/:botId` accepts `{ permissions: { maxLikesPerDay, … } }`.

## Historical denormalized counters

While public counters briefly stayed organic-only, bot domain rows could exist
without a matching denormalized increment. Going forward, totals include bots
again. We **do not** auto-backfill historical gaps: reconcile only with an
explicit reviewed script if product requires it. Trending remains organic via SQL.

## PostgreSQL claim integration tests

```powershell
$env:BOTS_PG_INTEGRATION="1"
npx vitest run tests/bots-pg-claim.integration.test.ts
```

Uses local `DATABASE_URL` (e.g. `milox_live_copy`). Creates isolated `itest_*`
users/bots/jobs and deletes only those rows. Does not truncate. Claim/recover
are scoped by `botAccountId` so other queue rows are untouched.

## Actual activity execution E2E (dedicated DB)

Uses **only** local database `milox_bots_e2e`. Refuses `milox_live_copy` and remote hosts.

```powershell
# One-time setup (creates DB + migrate deploy)
npm run test:bots-e2e:setup

# Full E2E folder: execution + worker lifecycle/races + HTTP API
$env:BOTS_E2E="1"
$env:BOTS_E2E_DATABASE_URL="postgresql://USER:PASS@127.0.0.1:5432/milox_bots_e2e?schema=public"
npm run test:bots-e2e
```

Keep `BOTS_WORKER_ENABLED=false` in the main `.env`. Suites enable the worker only
inside the test process (`pollMs` shortened; never writes main `.env`).

### Manual UI verification (milox_bots_manage)

No Playwright suite is checked into this repo. With worker still **false** in `.env`:

1. Point a **temporary** local API at `milox_bots_e2e` only if you accept swapping `DATABASE_URL` for that process (do not leave it pointed at live_copy by mistake). Prefer keeping the HTTP API E2E automated tests for API coverage.
2. Or run API on live_copy for UI smoke **without enabling the worker**, and use the automated HTTP E2E against `milox_bots_e2e` for mutations.
3. Open `http://localhost:3003`, sign in as ADMIN/SUPER_ADMIN.
4. Confirm Overview shows Worker **disabled**.
5. Open a bot → edit daily limits → Save → Refresh → values persist.
6. Jobs → filter / preview / cancel / retry; confirm errors surface on invalid input.
7. Settings → kill switch confirmation; worker flag remains env-only (not a UI toggle).

### Automatic planner → worker pipeline (isolated DB)

Uses `milox_bots_e2e` only — does **not** clear kill switch / pause on `milox_live_copy`.

```powershell
$env:BOTS_E2E="1"
$env:BOTS_E2E_DATABASE_URL="postgresql://USER:PASS@127.0.0.1:5432/milox_bots_e2e?schema=public"
npm run test:bots-e2e:auto-pipeline
```

Evidence: `tests/bots-e2e/last-auto-pipeline-evidence.json`. Main `:3003` dashboard will not show these jobs while the API remains on `milox_live_copy`.

### Practical UI→activity run (provision + like + comment)

```powershell
$env:BOTS_E2E="1"
$env:BOTS_E2E_KEEP_EVIDENCE="1"   # leave rows in milox_bots_e2e for /jobs inspection
$env:BOTS_E2E_DATABASE_URL="postgresql://USER:PASS@127.0.0.1:5432/milox_bots_e2e?schema=public"
npx vitest run tests/bots-e2e/bots-ui-activity.e2e.test.ts
```

Evidence file: `tests/bots-e2e/last-ui-activity-evidence.json`.

To view those jobs in the dashboard **without** changing the main `.env` file:

1. In a **new** PowerShell (do not edit `.env`):
   ```powershell
   cd milox_backend
   $env:DATABASE_URL="postgresql://USER:PASS@127.0.0.1:5432/milox_bots_e2e?schema=public"
   $env:BOTS_WORKER_ENABLED="false"
   $env:PORT="3011"
   npm run dev
   ```
2. In another shell for the manage UI:
   ```powershell
   cd milox_bots_manage
   $env:NEXT_PUBLIC_API_URL="http://localhost:3011/api/v1"
   npm run dev
   ```
3. Open `http://localhost:3003/jobs`, sign in as an ADMIN that exists **in milox_bots_e2e** (the verification test creates a throwaway admin; create one via the same DB or reuse a known local admin seeded there). Filter by bot username from the evidence file.
4. Stop the port-3011 process when done; leave main API on `milox_live_copy` untouched.

## Apply migrations (local only)

```bash
npm run prisma:generate
npm run prisma:migrate:deploy
```

Migrations:

- `20261016120000_bots_foundation`
- `20261016180000_bots_activity_engine` (SKIPPED status + job metadata)

Do not run against production without explicit approval.

## Key endpoints

- `GET /admin/bots/metrics`
- `GET|PATCH /admin/bots/settings`
- `GET /admin/bots/jobs` (filters: status, activityType, botAccountId, dates)
- `POST /admin/bots/jobs/preview`
- `POST /admin/bots/jobs/:jobId/cancel`
- `POST /admin/bots/jobs/:jobId/retry`
- Candidate preview / selection / provision routes (unchanged)
- Bot list / detail / status patch (pause cancels pending jobs)
