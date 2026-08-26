# Deploy handover — `feat/server-authoritative-architecture`

**Written:** 2026-08-17 · **Branch:** `feat/server-authoritative-architecture` · **243 commits ahead of `main`**
**For:** the separate deploy session · **Author:** the build session, which does **not** deploy and has
**not** merged.
**Companion:** `FINAL_SERVER_AUTHORITATIVE_EXECUTION_PLAN.md` (the plan) · §0 is authoritative for
measured status, §17 for deferrals.

---

## Read this first, in plain words

The **code** is built and reviewed. The **road it drives to production on has three gates across it**,
and none of them opens by itself.

None of the three is a bug in what we built. All three are in the machinery that carries code to
production, and **all three are older than this branch.** They are listed here so the deploy session
meets them on paper rather than at the console.

Two pieces of good news, and one caution.

**Good:** every gate fails *loudly and early*, before farmer data is touched. The system refuses to
start rather than guess.

**Good:** the tool for the biggest job already exists and is written properly — it is simply sitting on
a branch nobody merged.

**The caution:** the way this system applies database changes is **all-or-nothing across four
databases at once.** There is no "just this one migration" switch. Blocker 1 explains why that matters
more than anything else on this page.

---

## BLOCKER 1 — the tool that applies these 17 migrations is on a branch nobody has merged

This branch carries **17 database migrations that are not on `main`**: 16 for ShramSafal (the main
farm/labour database) and 1 for Analytics.

> ⚠️ **"17" is a branch-versus-`main` file diff, not a count of what is unapplied on production**, and
> the two are not the same number. Production may already carry some of these (D7 below records two of
> them as previously handled), and — because the gate applies **four contexts** — it may also have
> pending User, Accounts or Analytics migrations that no diff against `main` will show you.
> **`api-binary-swap.sh` fails the deploy when any context moves beyond its declared `--expect-*`
> count**, so sizing the snapshot, the maintenance window and the Step-12 expected set from "17" is how
> that check fires spuriously. Get the real number from the target database's history tables
> (`ssf.__ef_migrations`, `public.__ef_migrations`, `accounts.__accounts_migrations_history`,
> `analytics.__analytics_migrations_history`) before you declare anything.

**A purpose-built runbook for exactly this exists and is committed:**
`ops/aws/agent-deploy-lane/api-binary-swap.sh`, at `fe4e853a`, tip of branch
`chore/ssf-migration-runbook`. Verified: that commit is **on no other branch** — not `main`, not this
one. So it is real, reviewed, and **unreachable from the SHA you would deploy.**

> *A first draft of this handover said no ShramSafal path existed at all. That was wrong: it grepped
> the working tree, and the artifact lives on a different ref. The correction is recorded here rather
> than quietly overwritten, because the same mistake has now been made twice in this repo's history
> and the second time it told the founder that four weeks of work could not reach a farmer.*

**How the mechanism actually works** — and it is not what you would guess. There is no
`dotnet ef database update` for ShramSafal. Instead: stage `ALLOW_PRODUCTION_STARTUP_MIGRATIONS=true`
→ restart the API → `Program.cs` applies the pending migrations **during boot** → set the flag back to
`false`. **The restart *is* the apply.** This is proven, not theoretical: deploy `23222cdc`
(2026-07-04) applied 17 `ShramSafalDbContext` migrations this way, `ssf.__ef_migrations` 61→78, with
snapshot floor `shramsafal-prod-db-pre-23222cdc-20260704004123`.

Any plan that demands "migrations proven applied *before* the API restarts" is describing a mechanism
that has never existed here. Drop that requirement.

### 🔴 The single most missable fact: the gate is not a ShramSafal switch

`Program.cs:939-984` makes **six** `ApplyStartupMigrationsIfAllowedAsync` calls across **four**
contexts, all behind that one environment variable:

| Context | History table |
|---|---|
| `UserDbContext` | `public.__ef_migrations` |
| `AccountsDbContext` | `accounts.__accounts_migrations_history` |
| `ShramSafalDbContext` — Phase A, then Phase B | `ssf.__ef_migrations` |
| `AnalyticsDbContext` — Phase 1, then Phase 2 | `analytics.__analytics_migrations_history` |

**Opening the gate for one `ssf` migration also applies every pending User, Accounts and Analytics
migration in the same boot.** "We didn't touch the Analytics document" is not containment — see
Blocker 2, which this makes considerably more interesting.

And `ssf` applies in **two phases with Analytics interleaved between them**, so a boot that dies
mid-sequence leaves `ssf` **partially** migrated. **A count cannot detect that; a set difference can.**
The runbook's Step 12 is built for precisely this, which is the strongest argument for using it rather
than hand-rolling the flag flip.

### ⛔ The sequencing trap — the cautious-looking order is the one that breaks production

**Do not swap the binary first and decide about migrations afterwards.** That order looks careful and
it is the one that takes the API down.

`Program.cs:1163-1174` throws `Pending migrations detected for {contextName}. Apply them in a
deployment step before starting Production.` for **any** context with pending migrations while
`ALLOW_PRODUCTION_STARTUP_MIGRATIONS` is `"false"`. `Program.cs:1104` rethrows on init failure, so the
**process exits**. Not degraded — **dead**. Farmers get 5xx from the moment of restart, and every
subsequent boot fails identically until the gate is opened or the binary is rolled back.

There is no configuration in which this branch's binary boots against today's production database with
the gate shut. **The migration decision is not a follow-up step; it is a precondition of the restart.**

### What the deploy session must decide

1. **Merge or cherry-pick `fe4e853a`** so the runbook is reachable from the deployed SHA. This is the
   recommended path — the script already carries the pre-apply drift guard, an EXIT trap that closes
   the gate on **every** exit path, a live-DLL sha256 check, and per-context post-apply verification.
2. **Or flip the flag by hand** in a maintenance window. Faster, and it discards every protection in
   the previous sentence. **If you do this, take the RDS snapshot manually first** and diff the
   migration sets per context afterwards, not the counts.

⚠️ **`feat/dfes-companion` cherry-picked the FIRST draft (`5a374f5d`)** minutes after it landed. That
copy guards `ssf` **only** and therefore carries the multi-context defect described above. **If that
branch merges, re-pick `fe4e853a` over it.**

⚠️ **Unresolved and worth checking before you rely on the plugin for a rollback floor:** the
`agent-deployer` IAM role denies `rds:CreateDBSnapshot` and `rds:Restore*`, yet the July deploy took a
snapshot — so either founder credentials were used, or the role has since changed.

---

## BLOCKER 2 — the Analytics lane refuses to run at this SHA. **Executed, not read.**

**Read Blocker 1 first.** If the deploy opens the startup-migration gate, the Analytics migration
applies during boot and **never goes through the document below at all** — bypassing the very
allow/forbid screening this section is about. That is the containment hole, not a convenience.

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

## ~~BLOCKER 3~~ — **REFUTED 2026-08-20 by inserting, not by reading. Downgraded to a MINOR note.**

> **This section was wrong, and the way it was wrong is instructive enough to leave standing.**
> A verification lens built a production-shaped PostgreSQL 16 cluster, applied the chain, and then did
> the thing this document told you to skip: it **actually logged in as `agrisync_app` and ran INSERT,
> UPDATE and DELETE** on all three tables. **All three succeeded.**
>
> The tables *are* owned by `agrisync_app`, and an owner's privileges do not appear in `relacl`. So
> `relacl IS NULL` means *"no explicit grants"* — **not** *"nobody can write."* The verification query
> below is therefore misleading in both directions: it reports these three as broken when they are
> not, and it would **stay silent** about a genuinely unwritable table that happened to carry any
> unrelated explicit grant.
>
> **The real residue is small:** `agrisync_readonly` loses `SELECT` on the three tables. `grep` across
> `src/` finds no application code that connects as that role, so the loss is limited to ad-hoc
> reporting and DBA queries. Worth a follow-up migration; **not** worth a deploy gate.
>
> **Keep this in mind for the rest of the document:** every remaining permission claim here was
> reasoned from catalog inspection. This one was too, and executing it reversed the verdict.

<details>
<summary>Original Blocker 3 text, kept for the record</summary>

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

</details>

**Corrected query, if you want the check anyway.** `relacl IS NULL` is the wrong predicate — it misses
owner privileges entirely. Ask the actual question instead:

```sql
SELECT c.relname,
       has_table_privilege('agrisync_app', c.oid, 'INSERT') AS app_can_insert
FROM pg_class c
WHERE c.relnamespace = 'ssf'::regnamespace AND c.relkind = 'r'
ORDER BY app_can_insert, c.relname;
```

Any row with `app_can_insert = false` is a real problem. `has_table_privilege` accounts for ownership,
explicit grants and role inheritance together, which is why it answers the question the earlier query
only appeared to.

---

## 2026-08-23 — the blockers were resolved against founder principles, not picks

The founder replaced the earlier yes/no questions with **decision principles**, and each item below was
resolved by inspecting the repo rather than by choosing an option. **Nothing here has been deployed.**

| Principle | What the repo actually said | What was built |
|---|---|---|
| No manual production migration | The runbook existed at `fe4e853a`, **unmerged**, and depended on an RDS snapshot **it never checked for** | Cherry-picked onto this branch + new **step 0b** that proves the rollback floor, exit **30** if absent — `639da4ab` |
| Recoverability is mandatory | `agent-deployer` is **explicitly denied** `rds:CreateDBSnapshot` *and* `rds:RestoreDB*`; Deny beats Allow, and `iam:*` is denied too | `verify-rollback-floor.sh` — **verifies, never creates**; 18/18 tests — `d91f1cf5` |
| Dashboard may ride only if dormant | Admin-only consumer chain, unpopulated until refresh, already zero on prod, reversible | Removed from the forbid default **with the reason recorded** — guard now states real intent, not overridden at runtime — `bc99d4b6` |
| No decorative safety controls | The allow-list was **assigned, echoed, and read by nothing** | Deleted. Replaced with a preflight that prints **the exact migrations at this SHA** — `bc99d4b6` |
| Fix reachable vulnerabilities | SSH.NET + SQLitePCLRaw are **test-only**; XML crypto **ships** | Bumped shipped one 10.0.6 → 10.0.11; documented the other two — `a591dba0` |
| RLS suite must gate merge | Both workflows filtered `Category!=RequiresDocker`; isolation ran **nowhere** | Added as a **blocking** CI step — `08542c9d` |
| Farmer time in natural language | — | `formatFarmerTime` built + tested; **not wired to screens** (see below) — `d34a3a38` |

### The migration identities, enumerated — because a count is not proof

Parsing `Up()` and `Down()` separately (a whole-file grep wrongly flags ten, because it counts
`Down()` reversals): **16 of 17 are additive in `Up()`, and every one has a real `Down()`.** Two are not
plain additions:

- `RevokeTruncateOnAuditEvents` — a privilege **REVOKE**. Touches no data; tightens security.
- **`StripTranscriptFromCorrectionEvents` (§P0.4) — the one that irreversibly destroys farmer data**,
  deliberately. Its own `Down()`: *"The transcripts are gone and stay gone — there is no copy to
  restore them from, which is the property §P0.4 buys."* Already-ruled, **and the single reason the
  pre-deploy snapshot is not optional.**

### Marathi time is built but deliberately not switched on

Wiring only the plain-time formatter would leave a farmer reading `सकाळी 9:15` on one screen and
`12 Aug, 9:15 AM` on the next, since date-time, timestamp and `HH:mm` each have their own formatter.
Converting all six across ~17 components is a sweeping visual change, and this release is about
correctness and recoverability. **The capability is ready and tested; enabling it is a mechanical swap
on one word from the founder.**

---

## The final verification, and the three things it broke open

Five independent verification lenses ran over the whole branch on 2026-08-20 — backend build/test,
frontend build/test, migration chain, regression hunt, and an adversarial audit of *this document*.
**All five completed**; three built their own throwaway PostgreSQL 16 clusters rather than skip a
database check. `postgresql-x64-16` was never touched and AWS was never contacted.

**Honest limit:** 5 of 8 refutation agents died on an account rate limit, so the migration-chain,
frontend, regression and handover-audit findings are lens-reported but **not independently refuted.**
The one refuter that survived returned `refuted=False` on the provenance regression — the only finding
in this programme to survive adversarial challenge.

It found three defects that made "deploy ready" untrue. **All three are now fixed and verified.**

| | What was wrong | Fix |
|---|---|---|
| **The deploy-stopper** | `20260815052139_RevokeTruncateOnAuditEvents` revoked TRUNCATE from `agrisync_app`, then demanded `current_user` be a superuser **or still hold TRUNCATE**. On the production path `current_user` **is** `agrisync_app` — the role just stripped. Both limbs false by construction: **the deploy halts at 11 of 16 and the API exits.** | `1f3362dc` |
| **Backend gate red** | A successful S3 PUT was discarded because the *bookkeeping write after it* failed — they shared one `try`. Turned a green provenance test red. | `73f9a193` |
| **Frontend gate red** | The new time-guard suite rebuilt the TypeScript lib parse on every assertion, leaving no margin against vitest's 5s cap on a loaded runner. | `d2130199` |

Each was reproduced before being fixed and re-verified after:

- **The TRUNCATE guard**, on a production-shaped cluster (`agrisync_app` owns `ssf.audit_events`,
  `rolsuper=f`): old guard → `ERROR`, exit 3. New guard → `WARNING` naming the surviving path,
  `COMMIT`, exit 0. As `postgres` → `NOTICE`, exit 0. **The security property was re-proven, not
  assumed:** `TRUNCATE` as `agrisync_app` → `permission denied for table`, and guard 1 still aborts
  when the revoke is sabotaged.
- **The provenance test**: `Failed: 1, Passed: 0` → `Failed: 0, Passed: 1`. Whole `AiEndpointsTests`
  class 20 passed / 2 failed, both remaining failures being the ReceiptExtract pair **that also fails
  on `main`**.
- **The time sweep**: test time 13.45s → 2.86s, same 35 passing. Full blocking gate **174 files, 1781
  tests, all passed, exit 0** — the complete denominator, so nothing was silently skipped.

**One thing the deploy session must still weigh:** 55 Sync integration tests need Docker and did not run
on this host — including **9 `Tenancy.RowLevelSecurityTests`, 3 `UserDbRowLevelSecurityTests` and 3
`CallerFarmTenantScopeTests`.** Cross-farm isolation is therefore **unproven locally**; only CI with
Docker can assert it. Four NuGet packages also carry known **HIGH**-severity advisories (NU1903).

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

### `DEPLOYMENT_TRACKER.md` — **read row D7 before you author anything**

> **Corrected 2026-08-20.** An earlier version of this document said *"No `DEPLOYMENT_TRACKER.md` rows
> exist for any of this yet"* and told you to author them. **That was false and it was the more
> dangerous of the two errors in this file.**

**Row D7 already exists, at `DEPLOYMENT_TRACKER.md:94`.** It covers two of the sixteen ShramSafal
migrations this branch carries — `20260718132540_AddLabourAssignmentShiftTaskNames` and
`20260719074300_AddUserScopedJobCardComplianceTestReadPolicies` — and it already classifies that work
as **destructive**, with `rehearsal_method: clone`.

That classification is a **recorded verdict, not an opinion to re-form.** Per ADR 0024 a tier decision
is *consumed, not re-argued*. A deploy session told "no rows exist, author them" would open a fresh row,
pick its own tier, and silently discard a destructive/Heavy-tier finding — losing the clone-rehearsal
requirement that D7 already imposes.

**So: extend D7's coverage to the remaining fourteen, do not replace it.** The other migrations still
need rows; the Analytics migration's row must carry the ordering instruction that currently lives only
in a C# comment — **run D3, then this**. But start by reading what is already recorded.

Per this project's Definition of Done the work remains code-complete and **not done** until those rows
exist with prod evidence.
