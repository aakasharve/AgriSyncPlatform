# Labour V2 — Supervised Session Runbook

**Status: NOT YET RUN. No production mutation has occurred.**
**Deploy target: `46898adf37240b63648233d60e9089cb7631bfa5`** (RC, PR #77) — NOT `7f5de637`.
Labour V2 base `7f5de637` is an ancestor; the RC additionally carries `--list-migrations`,
`--migrate-only` and the `MutationRejected` telemetry that steps 2, 7 and 11 below depend on.
**Step 2 cannot run on `7f5de637` at all** — the census flag does not exist there.
The RC adds **zero** migrations over the base, so the declared five are unchanged.
Founder rulings 2026-09-05. Spec `2026-09-04-independent-db-verification`.

Covers the two remaining deliverables — **exact rollback behaviour** and the **full dry-run
procedure** — plus the founder-gate evidence packet and the EF census lesson.

---

# Part 1 — Backward compatibility verdict

> **Can production safely run `7644ee62` against the database after all five Labour V2
> migrations have applied?**

## `OLD BINARY + NEW SCHEMA = SAFE`

Derived from the migration code, not from "they're additive". The founder's instruction not
to assume that was right: migration 5 contains the one construct that could have made this
UNSAFE, and it took a second check to clear it.

| # | Migration | What it does to EXISTING objects | Verdict |
|---|---|---|---|
| 1 | `GrantFieldOperatorWorkRowsToAppRole` | `GRANT` only in `Up()`; the `REVOKE` is in `Down()`. Privileges widen, never narrow. | Safe — old binary loses nothing |
| 2 | `AddAttendanceMarks` | Nothing. Creates `ssf.attendance_marks`; every statement targets that new table. | Safe — an unknown table is inert |
| 3 | `AddAttendanceMarkCorrections` | Nothing. Same shape, `ssf.attendance_mark_corrections` only. | Safe |
| 4 | `AddLabourGrantExpiry` | Adds a **nullable** column to `ssf.farm_memberships`. | Safe — old binary omits it, gets NULL |
| 5 | `AddEngagedThroughToLabourAssignments` | Adds a **nullable** column to `ssf.labour_assignments`, an index, **and an FK to `ssf.field_operators` with `onDelete: Restrict`**. | Safe — see below |

### Why migration 5 needed a second look

`ON DELETE RESTRICT` can make a previously-legal `DELETE` start failing. Two conditions must
both hold for that to hurt the old binary:

1. **Rows must reference a field operator.** The old binary never writes
   `engaged_through_field_operator_id`, so every row it creates leaves it NULL, and NULL
   always satisfies a foreign key. Only the *new* binary can create references.
2. **Something must delete a `field_operators` row.** At `7644ee62` there is **no delete
   path**. The Labour use-cases are `AttachFieldOperator`, `CreateFieldOperator`,
   `GetFieldOperators`, `RenameFieldOperator` — verified by search; no delete handler and no
   `FieldOperators.Remove` call exists.

So the constraint cannot fire under the old binary even after the new binary has created
referencing rows.

### EF startup on a "newer" database

`GetPendingMigrationsAsync` computes *assembly minus applied*. With the old binary on the
new schema, every migration the old assembly knows is already applied, so pending is empty
and boot proceeds normally with `ALLOW_PRODUCTION_STARTUP_MIGRATIONS=false`. Applied rows
the old assembly does not recognise are simply ignored — EF does not validate in that
direction.

### Consequence for rollback

**A failed binary cutover can be recovered by restoring the previous binary alone.** The
database does not need to move. This is what makes stages C, D and E below tractable.

⚠️ **This verdict is scoped to `7644ee62` and these five migrations.** It is not a general
licence. Any change to the declared set re-opens the question.

---

# Part 2 — Rollback behaviour, by failure stage

> **Database rollback and application rollback are not the same action.** Founder ruling
> 2026-09-05. Running EF `Down()` merely to return to the previous binary can be riskier
> than leaving a compatible schema in place. `Down()` is never the reflex.

## Stage A — failure before production migration authority exists

*Snapshot fails · Step 0c mismatch · rehearsal fails · rehearsal verification fails ·
founder gate not approved.*

**Action: `STOP`. Production untouched. No rollback required — there is nothing to roll
back.** Release the claim, record the stage on the chart, close as blocked.

## Stage B — failure WHILE applying production migrations

The highest-risk state. **Do NOT blindly run `Down()`.**

**Measure first, and record before deciding:**

- which migration IDs committed (`MigrationApplied` per declared ID, via the verifier)
- which migration failed, and its error
- current `ssf.__ef_migrations` head
- database health — accepting connections, not in recovery
- **whether the application binary has changed yet** (at this stage it has not; the swap is
  step 9)

**Then choose, on measured state:**

| Situation | Action |
|---|---|
| 0 of 5 committed, clean failure | No schema change. Keep old binary. Investigate. No restore. |
| 1–4 committed, all additive-compatible, DB healthy | **Prefer: leave the partial schema, keep old binary.** Part 1 shows each migration is independently old-binary-safe, so a partial set is too. Fix forward in a later session. |
| Committed set includes something not additive | Not possible for these five — but if the declared set ever changes, this row becomes the restore path. |
| DB unhealthy, or state cannot be established | **Restore from snapshot** (Stage F). Inability to measure is itself a reason to restore. |

**`rollback-captain` chooses on evidence.** It must not assume "rollback" means "reverse
every migration".

## Stage C — all five applied, but independent DB verification FAILS

**Do not swap the binary.** Production now has the new schema and is still running
`7644ee62`.

Per Part 1 that combination is **SAFE**, so:

- **Keep the old binary live** while investigating the verification failure.
- Distinguish *"the schema is wrong"* from *"the verifier could not prove the schema"* —
  they need opposite responses. A verifier that cannot reach the database is
  `NO_DATA`, not a failed assertion, and must never be recorded as either PASS or FAIL.
- Only if the schema is genuinely wrong does the database recovery path apply.

This compatibility is established **here, before the session** — not improvised during an
incident. That is the whole point of Part 1.

## Stage D — database verified, BINARY SWAP fails

Database is at Labour V2 schema; the swap did not complete.

- **Restore the previous known-good binary.** Proven compatible with this schema (Part 1).
- **Do NOT restore the database** merely because a binary swap failed. The schema is
  correct and verified; reverting it would discard good work and add risk.
- `api-binary-swap.sh` keeps a backup directory (`/opt/agrisync/api-pre-<sha>-<ts>`) — that
  is the binary rollback artifact.

## Stage E — binary live, but smoke / G5 FAILS

**Separate application defect from database defect before acting.**

- Schema healthy + failure is application-only → **roll back the binary first.** Do not roll
  back successfully applied, verified migrations.
- Evidence points at the schema → invoke the database recovery path (Stage F).
- `smoke-auth-boundary` RED (unauthenticated `/sync/pull` returning 200) → **stop
  immediately**; that is farmer data exposure, not a flake.
- A green `/health` proves very little here. `/sync/push` answers 200 whether or not
  mutations were applied — which is exactly why `MutationRejected` exists.

## Stage F — snapshot restore (the recovery floor)

**This is not instantaneous rollback and must never be described as one.**

- **Snapshot identifier source:** `database-guardian`'s G2 evidence block on the chart,
  `snapshot_id`, format `shramsafal-prod-db-pre-<sha>-<UTC timestamp>`. Re-verified at every
  gate transition (R4).
- **Procedure:** `aws rds restore-db-instance-from-db-snapshot` to a **new instance**, then
  a deliberate endpoint cutover. RDS restore never overwrites the source in place.
- **Restoration time:** **not stated here.** We have never measured a restore of this
  database. Any number would be invention, and Part 1 exists precisely so this path is
  rarely needed. Measure it once, in a rehearsal, before relying on it under pressure.
- **Credentials / network:** master credentials from Secrets Manager; the restored instance
  must land in the same VPC and security group to be reachable at all.
- **Distinguishing restored from production:** the restored instance carries a **different
  identifier**. Production is `shramsafal-prod-db`; anything else is not production. The
  verifier's `dbHost` pattern makes the clone shape explicit, and the rehearsal secret is a
  different Secrets Manager id, so a rehearsal cannot silently resolve production.
- **Verification before declaring recovery successful:** re-run the assertion catalogue
  against the restored instance — migration head, the tables that should exist, RLS enabled
  **and forced**, exact policy sets, grants. A restored instance that has not been verified
  is a hope, not a recovery.

---

# Part 3 — Full dry-run procedure

Mirrors the production sequence. Every step names what would make it STOP.

| # | Step | Evidence produced | STOP if |
|---|---|---|---|
| 1 | **Identify the exact release artifact** — build `46898adf` in a clean checkout, never a local worktree | SHA, artifact sha256 | artifact does not build from the committed SHA |
| 2 | **Migration census** — `AgriSync.Bootstrapper --list-migrations` against production, read-only | fenced JSON, applied + pending IDs per context | census unreadable or fence unclosed |
| 3 | **Step 0c assertion** — `migration-census-check.py` vs `declared-migrations-7f5de637.json` | exact-match result | **any** difference, in any context |
| 4 | **Snapshot** the production primary | `snapshot_id`, `available` | snapshot not `available` |
| 5 | **Restore an isolated rehearsal DB** from that snapshot | rehearsal instance id | restore fails |
| 6 | **Prove rehearsal ≠ production** — different instance identifier, different Secrets Manager id, different endpoint | all three recorded | any one matches production |
| 7 | **Apply via the SAME published binary and the SAME targeted executor** intended for production | executor + target recorded | a different mechanism is used |
| 8 | **Apply through the exact final migration** (`20260902154713_AddEngagedThroughToLabourAssignments`) | post-apply head | head ≠ expected |
| 9 | **Independently verify the rehearsal DB** — five IDs, no undeclared context movement, both attendance tables, RLS enabled, RLS forced, exact policy sets, grants | verifier output | any assertion fails |
| 10 | **Negative verifier tests** — `INSERT` and `CREATE TABLE` raise `42501`; `SET ROLE` fails; `SELECT` on `ssf.daily_logs` raises `42501` **not** zero rows; `rolsuper`/`rolbypassrls` false | `verify-deploy-verifier-role.sql` output | any write succeeds, or a `0` is returned where `42501` is required |
| 11 | **Tear down the rehearsal instance** (`--skip-final-snapshot`), or mark it for controlled cleanup | teardown timestamp | orphan left running (cost + a stray copy of farmer data) |
| 12 | **Produce the founder-gate evidence packet** (Part 4) | the packet | any field is unknown |

**Step 10 runs with `default_transaction_read_only` deliberately switched OFF.** With it on,
a refused `INSERT` returns `25006` (read-only transaction) instead of `42501` — which would
prove only that a *setting* was on, and any session can switch a setting off. The suite
fails loudly if it sees `25006`.

---

# Part 4 — Founder-gate evidence packet

One page. Produced by the dry-run, reviewed before any production mutation.

```
TARGET SHA                    46898adf37240b63648233d60e9089cb7631bfa5   (RC)
LABOUR V2 BASE                7f5de637375a94ab16bba6b397ca38b83a345b66   (ancestor, proved)
ARTIFACT IDENTITY             sha256 <...>  (built from committed SHA, clean checkout)
SNAPSHOT ID                   shramsafal-prod-db-pre-46898adf-<ts>   status: available

STEP 0c — ACTUAL pending      ssf: [...]  user: [...]  accounts: [...]  analytics: [...]
STEP 0c — DECLARED pending    ssf: the five  ·  all others: NONE
STEP 0c — RESULT              PASS (exact set equality) | STOP (differences listed)

REHEARSAL DB IDENTIFIER       shramsafal-prod-db-clone-pre-<...>
REHEARSAL != PRODUCTION       instance id differs / secret id differs / endpoint differs
MIGRATION EXECUTOR            published binary, targeted migrator  (SAME as production)
REHEARSAL RESULT              5 applied, head = 20260902154713_AddEngagedThroughTo...
INDEPENDENT VERIFIER          migrations / tables / RLS enabled+forced / policy sets / grants
NEGATIVE CONTROLS             INSERT 42501 · CREATE 42501 · SET ROLE refused · daily_logs 42501

OLD BINARY + NEW SCHEMA       SAFE   (evidence: Part 1)
ROLLBACK BY STAGE             A stop · B measure-then-choose · C keep old binary
                              D binary only · E separate app/db · F snapshot floor
CLOUDWATCH IAM                PutMetricData scoped to ShramSafal/Api  — applied? Y/N
SMOKE CONTRACT                5 HTTP probes + 4 DB assertions, all resolving to real checks
GUARDIAN WARNINGS             <verbatim, or NONE>
```

**Only a clean packet authorises production mutation.** An unknown field is a STOP, not a
blank to fill in later.

---

# Part 5 — The EF census lesson (preserved)

> **Migration files on disk ≠ EF-discoverable migrations.**

EF enumerates only a migration class carrying the `[Migration]` attribute — in the main file
or a `.Designer.cs` sibling. A file without it is invisible to EF and will never be applied,
no matter how real it looks in the directory listing.

**The concrete case, kept as the fixture:**
`20260424124500_MakeGeminiPrimaryAiProviderConfig.cs` has no `[Migration]` attribute
anywhere. Therefore:

| | files | inert | EF-enumerable | applied in prod |
|---|---|---|---|---|
| `7f5de637` (Labour V2) | 107 | 1 | **106** | — |
| `7644ee62` (deployed) | 102 | 1 | **101** | **101** ✅ |

Verified end-to-end against the local dev database: 103 applied + 3 pending = 106.

**This single file produced the entire 101 / 102 / 107 confusion** this project carried for
weeks, and nearly caused a deploy to fail on an off-by-one count *after* production had
already changed.

**The rule:** the authoritative census uses EF-discoverable migration **IDs**
(`GetAppliedMigrationsAsync` / `GetPendingMigrationsAsync`). Never a filesystem count. Counts
may be printed for humans; only ID sets decide. Pinned by
`test_counts_are_informational_and_ids_decide` and
`test_the_ef_discoverability_lesson_is_preserved`.

---

## Still outstanding before the session

1. **`cloudwatch:PutMetricData`** applied to the EC2 instance role (narrow, namespace-scoped).
2. **The verifier role, SSM document and IAM policy** created — they must exist before the
   dry-run, or steps 9 and 10 have nothing to verify with.
3. ~~Branches merged~~ — **DONE 2026-09-05.** PR #77 squash-merged as `46898adf`. Required
   check `gate` passed along with backend, frontend, build-test, architecture tests, both
   CodeQL analyses, gitleaks and dependency review; no check failed.
