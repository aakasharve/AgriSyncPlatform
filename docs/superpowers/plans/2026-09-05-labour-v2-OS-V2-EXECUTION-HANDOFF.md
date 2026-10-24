# Labour V2 — CO-FOUNDER OS v2 Execution Handoff

> **LABOUR V2 RELEASE: READY FOR CO-FOUNDER OS V2 EXECUTION**
>
> Code ready · CI ready · Runbook ready · Infrastructure changes prepared but unapplied ·
> **Production untouched** · Final RC SHA frozen

**Founder ruling 2026-09-05.** This session engineered and packaged the release. It stopped
before the first action requiring the governed production execution environment. OS v2 owns
execution.

---

## 1. Release identity

| | |
|---|---|
| **Labour V2 base** | `7f5de637375a94ab16bba6b397ca38b83a345b66` (PR #75) |
| **Production release candidate** | `46898adf37240b63648233d60e9089cb7631bfa5` — **this is the deploy target** |
| **Ancestry** | `7f5de637` is an ancestor of the RC — proved in §2 |
| **Currently in production** | `7644ee62`, deployed 2026-08-31T15:25:25Z |

**The final production target is NOT `7f5de637`.** It carries Labour V2 plus the deployment
safety work engineered here (telemetry, the migration census, the bounded executor). Saying
otherwise would misdescribe what gets deployed.

---

## 2. Ancestry proof

Measured, not asserted:

```
$ git merge-base --is-ancestor 7f5de637375a94ab16bba6b397ca38b83a345b66 46898adf37240b63648233d60e9089cb7631bfa5
  -> exit 0                                    ANCESTOR CONFIRMED

$ git rev-list --count 7f5de637375a94ab16bba6b397ca38b83a345b66..46898adf37240b63648233d60e9089cb7631bfa5
  -> 1

$ git log --oneline 7f5de637375a94ab16bba6b397ca38b83a345b66..46898adf37240b63648233d60e9089cb7631bfa5
  46898adf Deployment safety: real telemetry, bounded migration executor, Step 0c census (#77)
```

**The RC adds ZERO migrations over the Labour V2 base** — verified by
`git diff --name-only 7f5de637 46898adf -- "*Migrations*"` (excluding Designer/Snapshot),
which returns nothing. Migration files at the RC: **107**, of which **106 are
EF-discoverable** (see §9). So the declared five in §4 are unchanged and still exact.

**Merged via PR #77**, squash. Required check `gate` **pass**, plus `backend`, `frontend`,
`build-test`, `.NET Architecture Tests`, `CodeQL` (csharp + javascript-typescript),
`Secret Scan (gitleaks)`, `Dependency Review`, `scan`, `Spec ID + Agent Label Gate`.
`e2e` was still pending and is non-required — a known, long-standing red recorded in project
memory, unrelated to this change. **No check failed.**

---

## 3. What OS v2 must apply, in exact order

Every artifact below is **written, reviewed and unapplied**. Nothing here has touched AWS or
production.

| # | Action | Artifact | Notes |
|---|---|---|---|
| 1 | Create the verifier secret | Secrets Manager `agrisync/prod/deploy-verifier` | `{username: "agrisync_deploy_verifier", password: <generated>}`. Never a literal in any file. |
| 2 | Create the PG verifier role | `_COFOUNDER/scripts/db/create-deploy-verifier-role.sql` | Idempotent. Password via psql variable. **Rehearse on a clone first.** |
| 3 | Run the negative-control suite **as the role** | `_COFOUNDER/scripts/db/verify-deploy-verifier-role.sql` | Bootstrap self-attestation, **not** independent verification. Say so on the chart. |
| 4 | Register the SSM document | `templates/ssm-document-AgriSync-VerifySchema.json` | `aws ssm create-document`. Read-only by construction. |
| 5 | Attach the verifier IAM policy | `templates/iam-release-verifier-policy.json` | Replace `<ACCOUNT_ID>`. The explicit `Deny`/`NotResource` is load-bearing. |
| 6 | Attach the CloudWatch IAM diff to the **EC2 instance role** | `templates/iam-ec2-putmetricdata-diff.json` | `PutMetricData` scoped by `cloudwatch:namespace` condition. **Not** `cloudwatch:*`. |
| 7 | Run the supervised session | `2026-09-05-labour-v2-supervised-session-runbook.md` | Dry-run → founder gate → production |

**Order matters.** Steps 1–5 must complete before the dry-run, or its verification steps
have nothing to verify with. Step 6 must complete before G5, or the telemetry axis reads
`NO_DATA`.

---

## 4. The approved migration set

**Exactly five, all in `ssf`. Nothing else, in any context.**

```
20260831155124_GrantFieldOperatorWorkRowsToAppRole
20260831180408_AddAttendanceMarks
20260831185516_AddAttendanceMarkCorrections
20260902103708_AddLabourGrantExpiry
20260902154713_AddEngagedThroughToLabourAssignments
```

Expected pending in `UserDbContext` / `AccountsDbContext` / `AnalyticsDbContext`: **NONE**.

Declared file: `_COFOUNDER/plugins/agrisync-deploy/templates/declared-migrations-7f5de637.json`

> 🛑 **NOTHING RIDES ALONG.** If Step 0c finds even one more pending migration, in any
> context, **STOP**. Report its exact ID, schema/context, what it changes, why it is pending,
> and whether Labour V2 depends on it. Do **not** add it to the declared file to make the
> check pass.

---

## 5. Step 0c contract

**Census:** `AgriSync.Bootstrapper --list-migrations` — read-only, applies nothing, never
consults `ALLOW_PRODUCTION_STARTUP_MIGRATIONS`. Emits applied + pending IDs per context as
JSON between `---BEGIN-MIGRATION-CENSUS---` fences.

**Gate:** `_COFOUNDER/plugins/agrisync-deploy/scripts/validator/migration-census-check.py`

| Exit | Meaning |
|---|---|
| `0` | PASS — actual pending set **exactly equals** declared, in every context |
| `1` | STOP — set difference; unexpected and missing IDs listed |
| `2` | ERROR — malformed input. Treated as STOP, **never** as PASS |

A context omitted from the declared file must have **zero** pending — silence means nothing,
not "don't care". A context absent from the census is a STOP: it cannot be proven quiet, and
absence is not evidence.

**IDs decide. Counts are printed for humans only.** Migration files on disk are not the set
EF enumerates — see §9.

---

## 6. The verifier and its assertion catalogue

**Identity:** `agrisync_deploy_verifier` — `NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT
NOREPLICATION NOBYPASSRLS`, member of nothing.

**Grants, and nothing else ever:** `CONNECT` on the database · `USAGE` on `ssf` and `public`
· `SELECT` on exactly `ssf."__ef_migrations"` and `public."__ef_migrations"`.

Deliberately **not** granted: the `GRANT SELECT ON ALL TABLES IN SCHEMA ssf` that
`agrisync_readonly` carries, membership in any writer role, and `pg_read_all_data`. Everything
else the catalogue needs is answerable from `pg_catalog` / `information_schema`, which any
role reads without a grant. **Zero farmer rows, ever.**

**Catalogue** (`AgriSync-VerifySchema`, assertion enum — the caller supplies no SQL):
`RoleSelfAttest` · `MigrationApplied` · `MigrationHead` · `TableExists` · `RlsEnabled` ·
`RlsForced` · `PolicySet` · `GrantSet`

**Run `RoleSelfAttest` first.** If the role could bypass RLS or is superuser, every later
assertion is vacuous (doctrine `E3`).

**`PolicySet` compares the exact set, never membership.** `ssf.attendance_marks` carries
**two** policies — `p_tenant_attendance_marks` and the permissive
`p_user_select_attendance_marks`. Asserting one passes green while the OR-ed permissive policy
is missing, added or silently altered (doctrine `E4`).

**Negative controls** run with `default_transaction_read_only` deliberately **off**. With it
on, a refused `INSERT` returns `25006` (read-only transaction) rather than `42501` — proving
only that a *setting* was on, and any session can switch a setting off. The suite fails loudly
if it sees `25006`. A `SELECT` on `ssf.daily_logs` must raise `42501`; **zero rows is never
accepted as proof**, because under RLS an empty result is indistinguishable from no access.

---

## 7. Telemetry and smoke readiness

**`ShramSafal/Api` → `MutationRejected`.** Measures one thing: *ShramSafal tried to save a
farmer action and the system rejected it*. A write-path signal, not a general error metric —
authentication, reads, AI calls, page loads and background work can all break without touching
it.

The aggregate publishes **every minute including zero**. That heartbeat is the **sole
authority** distinguishing an observed `0` from `NO_DATA`. The `ObservabilityEmitFailed`
counter travels the same channel and therefore cannot prove CloudWatch is working — it is a
partial-failure hint only, and **G5 must not depend on it**.

Blocked on action 6 above. Without the IAM grant every publish fails and the axis reads
`NO_DATA` — honest, but unusable.

**Smoke contract** — five HTTP probes plus four Heavy DB assertions, every one resolving to a
real check. The previous "6.1–6.7" named seven test files that never existed anywhere in the
repo. `smoke-auth-boundary` (unauthenticated `/sync/pull` must return **401**) is a stop-the-
world check: a 200 there is farmer data exposure.

`cloudwatch-spike-check` now has a `NO_DATA` verdict. Zero datapoints must **never** score
GREEN.

---

## 8. Compatibility and rollback

**`OLD BINARY (7644ee62) + NEW SCHEMA = SAFE`** — derived from the migration code, not from
"they're additive". Migration 5 adds a foreign key with `ON DELETE RESTRICT`, which could have
made this UNSAFE; it clears because the old binary never writes the column (NULL always
satisfies an FK) and has **no delete path** for field operators at all.

**Consequence: a failed binary cutover is recoverable by restoring the binary alone.** The
database does not need to move.

⚠️ Scoped to `7644ee62` and these five migrations. Any change to the set re-opens it.

**Rollback matrix** — full detail in the runbook, Part 2. `Down()` is never the reflex.

| Stage | Action |
|---|---|
| A — before migration authority exists | STOP. Nothing to roll back. |
| B — mid-migration | Measure first. Default: leave the partial schema, keep the old binary. Restore when the DB is unhealthy **or state cannot be established**. |
| C — applied, verification fails | Do not swap the binary. Keep the old one live. Separate "schema is wrong" from "verifier could not prove it". |
| D — binary swap fails | Restore the binary only. Do not touch a verified database. |
| E — live, smoke fails | Separate application from database defect. Roll back the binary; leave good migrations. |
| F — snapshot restore | The recovery floor, not instant rollback. Restore time is **unmeasured** — do not quote one. |

---

## 9. The EF census lesson

> **Migration files on disk ≠ EF-discoverable migrations.**

EF enumerates only a class carrying the `[Migration]` attribute (main file or `.Designer.cs`).
`20260424124500_MakeGeminiPrimaryAiProviderConfig.cs` has none, so:

| | files | inert | EF-enumerable | applied in prod |
|---|---|---|---|---|
| `7f5de637` | 107 | 1 | **106** | — |
| `7644ee62` | 102 | 1 | **101** | **101** ✅ |

Verified end-to-end against a live database: 103 applied + 3 pending = 106. **The numbers
always agreed; only the counting method differed.** Pinned by
`test_the_ef_discoverability_lesson_is_preserved` and
`test_the_checker_never_reads_migration_files_from_disk`.

---

## 10. HARD STOP — what this session did NOT do

No production verifier DB role created · no IAM applied · no SSM document registered · no
production migration census · no RDS snapshot · no rehearsal clone · no negative tests against
production · no migration authority opened · no production migration · no API deploy or swap ·
no G5.

**Production remains on `7644ee62`, deployed 2026-08-31T15:25:25Z.**

---

## 11. Documents

| Purpose | Path |
|---|---|
| Spec | `_COFOUNDER/specs/_active/2026-09-04-independent-db-verification.md` |
| Verifier plan | `docs/superpowers/plans/2026-09-04-independent-db-verification.md` |
| Bounded migration design | `docs/superpowers/plans/2026-09-05-labour-v2-bounded-migration-phase.md` |
| **Supervised session runbook** | `docs/superpowers/plans/2026-09-05-labour-v2-supervised-session-runbook.md` |
| Founder-gate packet template | runbook Part 4 |
| Rollback matrix | runbook Part 2 |
