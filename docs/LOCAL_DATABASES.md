# Local PostgreSQL databases (dev machine)

PostgreSQL 16, native, **port 5433**. Last reconciled 2026-08-08.

## The one you want

### `agrisync_dev_v2` — the only working development database

- 80 applied ShramSafal migrations, head `20260719074300_AddUserScopedJobCardComplianceTestReadPolicies`
- Schemas: `accounts`, `analytics`, `mis`, `public`, `ssf`
- Owned by `agrisync_app` (not `postgres`) — so local dev exercises row-level security the
  way production does, rather than bypassing it as a superuser
- Carries the labour columns (`shift`, `task`, `worker_names_json` on `ssf.labour_assignments`)
- ~135 `daily_logs` — a useful fingerprint: if a query returns 560 or 143 rows, you are
  talking to one of the archived databases below, not this one

**One migration is deliberately unapplied:** `20260424124500_MakeGeminiPrimaryAiProviderConfig`.
It is a data-only `UPDATE` that flips the AI provider to Gemini for existing rows — a
behaviour change, not schema drift. Held by founder decision 2026-08-08. This is why the
repo has 81 migration files and the database has 80 rows. That gap is intentional; do not
"fix" it without a decision.

## The archived ones — renamed, not deleted

Both were renamed to a `zz_` prefix so no tool picks them up by default, and so a stale
pointer fails loudly (`3D000 database does not exist`) instead of silently returning
wrong-but-plausible data. Both hold unique data that exists nowhere else. **Do not drop them.**

### `zz_stale_agrisync_dev` (was `agrisync_dev`)

- Was the de-facto default database — 8 of 9 checkouts pointed here before 2026-08-08
- **Broken migration history**: 3 recorded rows against 75+ actual tables. `ssf.outbox_messages`
  exists but its migration is unrecorded, so `dotnet ef database update` fails against it
- Unique data: **3,293 `analytics.events`** (`agrisync_dev_v2` has zero), 143 `daily_logs`,
  1,641 `audit_events`, plus `ssf.daily_richness_aggregates` and `ssf.question_events`
- Last written 2026-07-19

### `zz_stale_agrisync` (was `agrisync`) — *rename pending*

> Still named `agrisync` at time of writing: `ALTER DATABASE ... RENAME` is refused while
> sessions are attached, and five idle `mcp-postgres` connections from other Claude Code
> sessions hold it open. Rerun the rename once those sessions are closed.

- Frozen since **2026-03-08**. No `ssf.__ef_migrations` table at all — never migrated by EF
- Largest dataset of the three: **560 `daily_logs`**, 1,232 `log_tasks`, 13 plots, 2 farms, 7 users
- Historical Dec-2025 → Mar-2026 corpus, not reproducible from any seeder
- This is the database `.mcp.json` used to point at, which meant agents querying through the
  Postgres MCP tool were reading March data as if it were current

## Backups

`pg_dump -Fc` of all four databases (including the dropped `agrisync_phase2_gate`) taken
2026-08-08, each verified with `pg_restore -l`:
`G:\agrisync-backup-2026-08-08\db-dumps\`

## Credentials

Not in this repo. Local roles (`postgres`, `agrisync_app`, `agrisync_readonly`) are supplied by
`ConnectionStrings__*` environment variables, or `src/AgriSync.Bootstrapper/secrets/local/credentials.json`
(gitignored). Tracked `appsettings*.json` files carry placeholders only.

Two test-only overrides exist because those suites read config off disk rather than through
the ASP.NET configuration chain:

| Variable | Used by |
|---|---|
| `REQUIRES_POSTGRES_ROOT_CONN` | `RequiresPostgresConnection` — maintenance connection for creating per-test scratch databases |
| `AGRISYNC_TEST_APP_ROLE_PASSWORD` | `TestRoleCredentials` — the non-superuser role the RLS suites connect as |
