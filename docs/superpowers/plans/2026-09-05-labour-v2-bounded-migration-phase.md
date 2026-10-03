# Labour V2 — Bounded Migration Phase (proposal)

**Founder ruling 2026-09-05.** `ALLOW_PRODUCTION_STARTUP_MIGRATIONS` stays **false** as the
normal production state. "Deploy the API" must never implicitly mean "apply every pending
migration across every context."

**Status: PROPOSAL. No production mutation. Nothing here runs until approved.**

---

## The problem, in the tooling's own words

`ops/aws/agent-deploy-lane/api-binary-swap.sh:27` already says it:

> *Opening the gate to apply an `ssf` migration ALSO applies any pending User,
> Accounts and Analytics migrations.*

The gate is a single global switch governing **six apply phases across four contexts**
(`ssf`, `public`/User, `accounts`, `analytics`). Today the deploy opens it, boots the API,
lets everything pending apply, then closes it again.

## What already exists (verified, not assumed)

More is built than I expected. `api-binary-swap.sh` already has:

| Capability | Flag / step |
|---|---|
| Expected `ssf` migration count | `--migrations N` |
| Expected count per other context | `--expect-user` / `--expect-accounts` / `--expect-analytics` |
| Head-row before/after assertions | `--expect-before` / `--expect-after` (**both** required for a migration deploy, enforced at `:130`) |
| Snapshot floor check | step 0b |
| Post-apply set-diff across all four contexts | step 12, exits 29 on any undeclared movement |
| Gate re-closed, verified, fail-loud if it cannot | `:171-182` |

That is most of a bounded phase already. It is why the `7644ee62` deploy could prove
"nothing applied alongside ours".

## The two real gaps

**1. Every check is a COUNT or a HEAD ROW, and every check is POST-apply.**
Step 12 tells you what moved *after* the schema has already moved. There is no
pre-apply enumeration of what is pending. A previous deploy nearly failed on a count that
was off by one *after* production had changed — and this project currently holds three
mutually inconsistent migration numbers (107 files / 102 files / 101 applied rows).

**2. Nothing could independently verify the database.** That is what the new
`agrisync_deploy_verifier` role and `AgriSync-VerifySchema` document now fix.

## The smallest safe change

Add **one pre-apply step**, plus wire the new verifier into two points. No EF redesign, no
deployment-system rewrite.

### Step 0c — pre-apply pending-set assertion (new)

Before the gate is opened, enumerate what is pending in **all four contexts** and compare
against the declared list. Fail closed on any difference — including anything pending in a
context we did not expect to move at all.

Declared set for Labour V2 (`7f5de637`), all five in `ssf`:

```
20260831155124_GrantFieldOperatorWorkRowsToAppRole
20260831180408_AddAttendanceMarks
20260831185516_AddAttendanceMarkCorrections
20260902103708_AddLabourGrantExpiry
20260902154713_AddEngagedThroughToLabourAssignments
```

Expected pending in `public` / `accounts` / `analytics`: **none**.

If anything else is pending anywhere — **STOP**. Do not let it ride. That is the founder's
instruction and it is the entire point of the step.

> ✅ **RESOLVED 2026-09-05 by measurement, and it needed no production access.**
> EF only enumerates a migration class carrying the `[Migration]` attribute. At `7f5de637`
> there are **107 migration files but 106 EF-enumerable migrations**: exactly one file,
> `20260424124500_MakeGeminiPrimaryAiProviderConfig.cs`, carries no `[Migration]` attribute
> in either the main file or a Designer sibling, so EF cannot see it. Verified end-to-end
> against the local dev database — 103 applied + 3 pending = 106, matching the arithmetic.
> At the deployed SHA `7644ee62`: 102 files − 1 inert = **101 enumerable**, and production
> reports **101 applied**. The numbers always agreed; only the counting method differed.
> **There is no missing migration.** Step 0c still runs and still measures — a resolved
> question is not the same as an unmeasured one.

> 🛑 **NOTHING RIDES ALONG. FOUNDER RULING 2026-09-05.** The only approved pending set is
> the five declared IDs below. If Step 0c finds even one more, in any context, the deploy
> **STOPS**. Bring back its exact ID, its schema/context, what it changes, why it is
> pending, and whether Labour V2 actually depends on it — then it is a separate founder
> decision. Do not add it to the declared file to make the check pass.

### Assert IDs, never counts

`MigrationApplied("20260831180408_AddAttendanceMarks")` is immune to the off-by-one that
counts keep producing. The verifier's assertion catalogue is built this way already.

## Proposed sequence

| # | Step | Verified by |
|---|---|---|
| 1 | RDS snapshot (rollback floor) | `database-guardian`, step 0b re-checks at each gate |
| 2 | **Step 0c — pending-set assertion, all four contexts** | **new**; fail closed on any undeclared pending |
| 3 | Restore throwaway clone from the snapshot | `database-guardian` |
| 4 | Apply the exact five on the clone | **the application binary's own migrator** (see §Correction 2) — same executor as production |
| 5 | **Independently verify the clone** — migration IDs, `attendance_marks` + `attendance_mark_corrections` exist, RLS enabled *and* forced, exact policy sets, grants | **new** — `AgriSync-VerifySchema` against the **rehearsal** secret |
| 6 | 🛑 **Founder mutation gate** — snapshot id, clone result, the exact five, any guardian warnings, rollback readiness | founder |
| 7 | Apply the exact five in production | existing gate-open → boot → gate-close, with step 12 set-diff |
| 8 | **Independently verify production** | **new** — same assertions, **production** secret |
| 9 | Start/swap the API binary | existing |
| 10 | `/version`, `/health`, Labour V2 smoke set | `release-verifier` |
| 11 | G5 — including a real `MutationRejected` signal and a real smoke contract | `release-verifier` |
| 12 | Close | `deploy-coordinator` |

**The gate stays closed after.** Step 7 already re-closes it and fails loudly if it cannot.

**Environment separation is structural**, not a flag: steps 5 and 8 resolve *different
Secrets Manager ids*, so a rehearsal physically cannot point at production.

## Change Surface

**DB** — No schema change from this plan itself. It governs *how* Labour V2's five
migrations are applied. No new migration.

**Backend** — No Backend changes.

**Frontend** — No Frontend changes.

## Correction 2 — rehearsal and production use ONE mechanism

The first draft of this plan rehearsed with `dotnet ef database update` and executed
production through the startup-migration gate. Founder caught it: that rehearses one
mechanism and executes another, leaving exactly the gap the rehearsal exists to close.

**The primitive already exists, in the application.** `Program.cs`'s
`ApplyStartupMigrationsIfAllowedAsync` takes an optional `targetMigration` and applies only
up to and including it via `migrator.MigrateAsync(target)`. It is already in production use
— `ssfPhaseATarget` and `analyticsPhase1Target` are hardcoded phase targets today. So the
bounded executor was never missing; it was only reachable at boot.

**Chosen mechanism: the same published binary, against both databases.** `--list-migrations`
(landed) proves the set read-only. The apply step runs the identical binary and the
identical `ApplyStartupMigrationsIfAllowedAsync` code path against the clone first, then
against production. Same executor, same artifact, same code — only the connection string
differs.

Rejected: `dotnet ef` on production (needs the SDK and sources on the box — infeasible, and
a different code path anyway); booting the full API against the clone (background jobs,
alert dispatch and MIS refresh would all run against a throwaway database).

⚠️ **One property of EF that makes Step 0c non-optional:** `MigrateAsync(target)` applies
*everything ordered before the target*, not just the declared list. An undeclared migration
sorting earlier than our five would be applied silently. Step 0c is what makes that
impossible, because it stops before any authority is opened.

## Change Surface

**Cross-cutting** — One new pre-apply step in `api-binary-swap.sh` (or a sibling validator
invoked before it). Two new verifier invocations. `cloudwatch:PutMetricData` must be added
to the EC2 instance role for the `MutationRejected` signal to publish at all.

## What this deliberately does NOT do

Redesign EF · rewrite the deployment system · make the gate per-context (a larger change
than the release needs) · flip the gate globally · build an observability platform ·
resolve the 2026-08-31 `CommandsFailed=1` anomaly.

## Open items requiring the founder

1. **The 101-vs-102 gap.** Step 0c measures it. If a real migration is pending beyond the
   five, decide whether it rides or is excluded.
2. **`cloudwatch:PutMetricData` on the EC2 instance role — APPROVED NARROWLY 2026-09-05.**
   Scoped to the `ShramSafal/Api` namespace via a `cloudwatch:namespace` condition. **Not**
   `cloudwatch:*`. Without it the new signal never publishes — which reads honestly as
   `NO_DATA`, but the axis stays unusable.

   **Founder correction, and it is right:** the publisher-failure counter travels over the
   same CloudWatch channel as the signal it guards, so if IAM or the network breaks, both
   vanish together and it proves nothing about total publication failure. It is kept only as
   a partial-failure hint. **The one-minute zero heartbeat is the authoritative distinction**
   between an observed `0` and `NO_DATA`, and G5 must depend on the heartbeat alone.
3. **Order.** The verifier role must exist *before* this runs, or steps 5 and 8 have nothing
   to verify with.
