# Deploy handover — `feat/server-authoritative-architecture`

**Written:** 2026-08-17 · **Branch:** `feat/server-authoritative-architecture` · **243 commits ahead of `main`**
**For:** the separate deploy session · **Author:** the build session, which does **not** deploy and has
**not** merged.
**Companion:** `FINAL_SERVER_AUTHORITATIVE_EXECUTION_PLAN.md` (the plan) · §0 is authoritative for
measured status, §17 for deferrals.

---

## Read this first, in plain words

The **code** is built and reviewed. The **road it drives to production on is not finished.**

Three things will stop a deploy of this branch. None of them is a bug in what we built — all three are
gaps in the machinery that carries code to production, and **two of them existed before this branch.**
They are listed here because the deploy session must not discover them at the console.

The good news: **every one fails loudly and early, before touching farmer data.** Nothing here can
half-apply and leave the database in a strange state. The system refuses to start rather than guess.

---

## BLOCKER 1 — 16 database changes have no way to reach production

**This is the big one, and it is the oldest.**

This branch carries **17 pending database migrations**: 16 for ShramSafal (the main farm/labour
database) and 1 for Analytics.

There is exactly one automated migration lane in this repo:
`ops/aws/agent-deploy-lane/agrisync-analytics-migration-deploy.ssm-document.json`. It runs
`dotnet ef database update --context AnalyticsDbContext`. **Analytics only.**

Searched across `ops/`, `aws/` and `.github/` for any deploy artifact naming `ShramSafalDbContext`:
**zero matches.** There is no lane, no script, no workflow that applies ShramSafal migrations to
production.

The application cannot apply them itself either. `Program.cs:1163-1174`
(`ApplyStartupMigrationsIfAllowedAsync`) throws for **any** context with pending migrations when
running in Production unless `ALLOW_PRODUCTION_STARTUP_MIGRATIONS=true`.
`PRODUCTION_ENVIRONMENT_VARIABLES.md:51` sets it to `"false"`.

> **Consequence:** deploy this branch to production as-is and the API **will not boot.** It throws
> `Pending migrations detected for <context>. Apply them in a deployment step before starting Production.`

**This fails closed, which is correct** — it is the behaviour that prevents a half-migrated database.
But it means someone must **build a ShramSafal migration lane** before this branch can ship. That is
authoring work, not a deploy-time decision.

**Options for the deploy session, in the order a careful team would consider them:**
1. **Author a ShramSafal SSM document** modelled on the Analytics one (same phases, `--context
   ShramSafalDbContext`, its own secret key). Most work, most reusable, correct.
2. **A one-time controlled maintenance window** with `ALLOW_PRODUCTION_STARTUP_MIGRATIONS=true`, then
   set it back to `false`. Fastest. Weakest — it applies 16 migrations on startup with no
   pre-state capture, no allow-list, and no snapshot gate, which is precisely what the flag exists to
   prevent. **If you take this route, take the RDS snapshot manually first.**
3. **Split the release** — ship the code that needs no migration now, and hold the rest. Requires
   knowing which features that leaves half-wired; the plan's §0 is where to work that out.

---

## BLOCKER 2 — the Analytics lane refuses to run at this SHA. **Executed, not read.**

`ForbiddenMigrationFiles` defaults to
`20260504000000_WtlV0Entities.cs 20260505000000_DwcV2Matviews.cs`.
`20260505000000_DwcV2Matviews.cs` **is in the tree at this SHA.**

PHASE 4's loop, run verbatim against this working tree:

```
::error::Forbidden migration file 20260505000000_DwcV2Matviews.cs present in checked-out SHA. Aborting.
EXIT=1
```

It aborts **before** Secrets Manager, before the pre-state capture, before `dotnet ef database update`.
The database is never touched. Again: fails closed, correctly — but it fails.

Someone must consciously either **override `ForbiddenMigrationFiles`** for this run (affirming that
shipping `DwcV2Matviews` alongside the WVFD fix is intended) or **amend the default** if the entry is
stale. Note the WVFD migration's own finding: **the dwc repair is a no-op until D3 runs.** Not a rubber
stamp.

### And the allow-list beside it enforces nothing

`grep -c ALLOWED` on the document body = **2**: one assignment, one `echo`. No loop, no comparison, no
exit. The phase is titled *"allowlist + forbidlist migration audit"* and only the forbid half exists —
while the run log prints `allowed: …`, so it reads to the operator as though it were enforced.

**Do not "fix" this by adding the new migration's filename to the list.** That would put a name in a
list nothing reads — the exact defect this programme spent its length removing. Either implement the
allow-list or delete the parameter and rename the phase.

---

## BLOCKER 3 — three Labour tables may land unwritable. **One query settles it.**

`20260811082301_AddFieldOperators`, `20260811090237_AddFieldOperatorWorkRows` and
`20260811112633_AddLabourCorrections` contain **zero `GRANT` statements** (verified by count). They
rely on the default privileges set in `20260515090000_BootstrapDbRoles.cs:70-78`, which are declared
`ALTER DEFAULT PRIVILEGES FOR ROLE <v_runner>` where `v_runner := current_user` **at the moment
BootstrapDbRoles ran**.

**Default privileges only apply to objects created by the role they were declared for.** So the outcome
is decided by one fact:

> Does the role that will run the Labour migrations equal the role that ran `BootstrapDbRoles`?

- **Same role** → tables inherit the grant → fine.
- **Different role** → tables land with `relacl = (none)` → `agrisync_app` **cannot INSERT** → every
  write to Labour fails `42501`.

On the local development database they differ, and **those three tables are broken there today** —
found by enumerating every relation in `ssf`, not by sampling. **On production this is unestablished,
and this session did not establish it, because production is deliberately hibernated and waking it is
the founder's call.**

**The pre-flight check is one query on production:**

```sql
SELECT defaclrole::regrole AS grants_declared_for_role,
       defaclnamespace::regnamespace AS schema
FROM pg_default_acl;
```

Compare `grants_declared_for_role` against the role your migration runner connects as. If they differ,
add explicit `GRANT`s to those three migrations **before** deploying — do not deploy and check after.

**And verify after applying, either way:**

```sql
SELECT relname FROM pg_class
WHERE relnamespace = 'ssf'::regnamespace AND relkind = 'r' AND relacl IS NULL;
```

Anything returned is a table the application cannot write to. Expect zero rows.

Full analysis: `_COFOUNDER/specs/_inbox/migration-runner-ownership-drift-2026-08-17.md`.

---

## What is genuinely ready

**48 commits this session**, each implemented, reviewed by an independent reviewer, and taken through
a fix loop until the reviewer approved. Highlights, in the founder's terms:

| Area | What changed | State |
|---|---|---|
| **Time display** | Every user-facing time is now 12-hour IST with AM/PM, from one formatter, with a structural guard that fails the build if a new clock bypasses it | Approved; guard's own harness in round 4 (test-only) |
| **Week boundary** | The WVFD week now breaks at India midnight, not UTC — a 5am log no longer lands in the previous day | Approved; **needs Blocker 2 resolved** |
| **Voice archive** | A consenting farmer's clip can no longer vanish from Voice Diary with no trace | Approved |
| **Erasure (DPDP)** | Stops reporting a purge that did not happen; new `CompletedWithResidue` state; audit tail survives cancellation | Approved |
| **Sync recovery** | Records that reached no sync queue at all are now found and re-enqueued, once — not once per app launch | Approved |
| **Privacy** | Correction events no longer carry the farmer's words; raw voice blobs now have a subject they belong to | Approved |
| **CI honesty** | Version gate and cross-branch check now fail when they compared nothing, instead of passing quietly | Approved |
| **Backup design** | Backup + recovery design for the raw evidence bucket, authored | **Design only — not built** |

**Offline storage:** Dexie `DATABASE_VERSION = 24`. **v23 is reserved for `feat/dfes-companion`** — this
was a real collision that would have silently skipped the transcript-privacy upgrade on every DFES
handset, and there is now a CI guard against it recurring.

---

## Facts the deploy session will need

**Deploy-before-merge works, as the founder asked.** `ops/aws/agent-deploy-lane/agent-cutover.sh:21`
takes `DEPLOY_SHA` as 7–40 hex characters and **"Refuses HEAD or branch names."** You can pin this
branch's SHA without merging to `main` first. It also requires CI green and a runbook grep-checked to
contain the SHA, and it **"Does NOT roll back."**

**Production is hibernated by design** — that is a cost saver, not an outage. `bash aws/hibernate/wake.sh`.

**The APK does not follow a web deploy.** Assets are bundled into the APK at build time, so a web
release never reaches existing app users. Deploy order is **API → web → APK**, and the APK needs its own
build.

**Every migration file at this SHA is unsigned locally.** `git log --format=%G?` returns `N` in this
environment; GitHub signs the squash-merge into `main`. Do not claim otherwise.

---

## Still owed by the founder

1. **`Start-Service postgresql-x64-16` from an elevated shell.** The service is Stopped and
   `Start-Service` fails without elevation. Two review agents routed around it by building throwaway
   PostgreSQL clusters rather than guessing — which worked, but the database-backed half of the final
   whole-branch verification has not run against the real local database.
2. **Marathi day-periods.** `9:15 AM` everywhere, or `सकाळी 9:15` on farmer screens with AM/PM kept on
   admin? The recommendation is the second: `AM/PM` is not a Marathi convention, and farmer screens are
   where the trust is built. Currently everything is `AM/PM`.
3. **Backup go-ahead.** The design is authored, nothing is built. Confirm before it is built.
4. **The consent gate copy** at `docs/superpowers/specs/2026-08-16-consent-gate-founder-copy.md` is
   founder-authored but **not counsel-reviewed**, and six disclosures render as visible placeholders.
   **Do not claim DPDP compliance until they land.**

---

## Open tickets that belong to the deploy window

All in `_COFOUNDER/specs/_inbox/`:

- `analytics-migration-lane-blocked-at-this-sha-2026-08-17.md` — Blocker 2, with the executed evidence
- `migration-runner-ownership-drift-2026-08-17.md` — Blocker 3, three instances, one root cause
- `erasure-cancellation-midscrub-2026-08-16.md`
- `retention-sweep-affirms-undone-s3-deletes-2026-08-16.md`
- `erasure-test-fixture-simpler-than-reality-2026-08-16.md`
- `voice-archive-telemetry-goes-live-with-sealing-2026-08-16.md` — three items that all go live the day
  clip sealing is wired; attach it to that task

**No `DEPLOYMENT_TRACKER.md` rows exist for any of this yet.** Per this project's own Definition of
Done, that makes the work code-complete and **not done**. Authoring those rows is the deploy session's
first act, not its last — and for the Analytics migration the row must carry the ordering instruction
that currently lives only in a C# comment: **run D3, then this.**
