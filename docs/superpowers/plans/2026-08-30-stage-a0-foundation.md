# Stage A0 — Shared-Farm Foundation (Labour-V2-Independent) Implementation Plan

> **REVISION 3 — 2026-08-31.** Revision 1 was reviewed by a CTO agent, a cross-verifier and a test-infrastructure agent against `a7784b18` (verdict **BLOCK / GO-WITH-FIXES**, 6 findings, two of which would have shipped silent data corruption). Revision 2 fixed those; Revision 3 applies the founder's seven final hardening items. Every change is listed in §Revision History so nothing is silently altered. **Approved for execution.**

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Protect three farm-history facts that cannot be reconstructed later — that multiple people may legitimately work at once, that the audit ledger records the actor's role **on the farm they were acting on**, and that source evidence may be narrower in visibility than the facts derived from it — without touching one line of the unmerged Labour V2 branch.

**Architecture:** Three independent slices on one short-lived branch cut from the deployed production SHA. A4 is a schema-invariant test proving no unique index forbids concurrent multi-actor logs. A3 replaces a **globally-scoped** role with a **farm-scoped** one via the already-existing `IShramSafalRepository.GetUserRoleForFarmAsync`. A5 records an architectural constraint as a document. No migration, no new table, no farmer-facing surface, **no deploy of its own**.

**Tech Stack:** .NET 10.0, xUnit, FluentAssertions, Npgsql, PostgreSQL 16 (native, port 5433), EF Core.

**Spec:** `docs/superpowers/plans/2026-08-30-shared-farm-foundation-STAGE-A-PLAN.md` (approved design + founder rulings R1–R6). Idea capture: `_COFOUNDER/specs/_inbox/2026-08-30-farm-workspace-multi-actor-model-IDEALOG.md`.

---

## 🔴 Read this before Task 1 — the corrected A3 rationale

**Revision 1 said a client can tell the server what role it was acting in. That is FALSE.** `ActorRole` is derived server-side from the **signed JWT membership claim** (`ShramSafal.Api/Endpoints/EndpointActorContext.cs:26-43`). The sync allowlists reject an `actorRole` key outright (`PushSyncBatchHandler.cs:805`, `:1809`), and `src/clients/mobile-web/src/` contains **zero** occurrences of it. `PushSyncBatchHandler.cs:374` documents it: *"actorRole is server-derived — none is attacker[-controlled]."*

**The real defect, and the only one to cite in any commit message:**

> The JWT membership claim carries **one global role per account**, not a per-farm role. A user who is `PrimaryOwner` of their own farm and a `Worker` on a neighbour's farm has their action on the neighbour's farm recorded as `primaryowner`. `GetUserRoleForFarmAsync` resolves the role **on the farm actually being acted on**, which is what the audit ledger must state.

Writing "stop accepting the role from the client" into a commit would itself be the false-claim defect this work exists to remove.

### ⚠️ `"unknown"` is an ANOMALY, not a normal outcome

Every handler in this plan gates on farm membership or ownership **before** reaching the audit write. So a `null` from `GetUserRoleForFarmAsync` after access has already been established means something is wrong — a broken RLS/tenant context, a tenancy failure, or the authorization gate and the role resolver disagreeing. It is not an ordinary valid state.

Keep `?? "unknown"` as the defensive fallback: it prevents a crash and prevents a *fabricated* role. But:

> **`"unknown"` exists to prevent corruption. It must never be allowed to hide a broken authorization path.**

**Therefore: do NOT write tests that bless `null → "unknown"` as expected normal behaviour.** Every test in this plan asserts a *real* resolved role and asserts `AuditEventCount == 1` first, so a silent early return can never be mistaken for a correct one. Record the invariant for later hardening — *an authorized farm action should normally have a resolvable farm-specific role* — and surface any observed `"unknown"` in the completion report rather than normalising it.

---

## Global Constraints

- **Branch from `a7784b18`** — `origin/main`, and the exact SHA `api.shramsafal.in/version` reports. Never branch from `feat/labour-v2-r1` or from whatever is checked out. (The main worktree is on `chore/keystore-untrack-and-play-aab` @ `eac8da36` with untracked files — do not disturb it.)
- **🔴 LABOUR V2 ISOLATION.** Revision 1 froze a 17-file list covering only `src/apps/**`, and **the plan itself instructed editing a file on the omitted list**. The guard now **recomputes** the overlap live from the branch on every run, across the whole tree. **Do not write the file count into this plan, into the guard, or into any array** — the branch is local-only, lives in a temp worktree, and moved `0be41d1f` → `2cb19456` during planning alone. Any number recorded here is a snapshot that will quietly go stale and invite someone to hardcode it. Let the script compute it.

  ⚠️ **Known limit, and the reciprocal guarantee that bounds it.** The guard reads Labour V2's **committed** work (`git diff BASE...feat/labour-v2-r1`). Uncommitted changes in that branch's worktree are invisible from here, and cannot be read without reaching into another worktree.

  **That gap is bounded, not open.** Editing a file *already inside* the computed set cannot change the guard's answer — the set is a list of paths, and the path is already on it. **The only way an uncommitted change alters the answer is a NEW file path.** The Labour V2 agent has accordingly committed (2026-08-31) to declaring any new file path before introducing it, which converts an unobservable risk into a promise that can be held.

  Verified live: the branch moved `2cb19456` → `5eda51bb` mid-session; the guard recomputed unprompted and returned `Isolation OK` with the set size unchanged, because that commit touched files already inside it.

  Still: treat a clean guard as *"no committed overlap, plus a declared-intent promise"* — never as mechanical proof of no collision.
- **No new migration.** `AuditEvent.ActorRole` already exists (`ShramSafal.Domain/Audit/AuditEvent.cs:97`, column `actor_role`, `varchar(80)` — `AuditEventConfiguration.cs:41-44`).
- **Migration count is 101, not 100.** Verified: 101 migration classes at `a7784b18`, head `20260828061500_WidenCorrectionEventPromptVersion`. This stage must add zero.
- **Conventional Commits.** Never `--no-verify`. Never force-push. Pre-commit runs `dotnet format`.
- **🔴 Every commit touching `src/**` MUST carry a `spec:` line in the body**, or the `commit-msg` hook rejects it. Use `spec: 2026-08-30-shared-farm-foundation-stage-a0`. Found during execution — Task 1 escaped it by being `ops/`-only, so Task 2 hit it first. Every remaining task touches `src/**`.
- **Build note:** a dev API running from *another worktree* does **not** lock this one — worktrees have separate `bin/`/`obj/`. Verified: a full dependency build including `AgriSync.Bootstrapper` succeeded in 49s with the labourv2 API live on `:5048`. `--no-dependencies` is not needed here.
- **Layering:** changes live in Application + Api + tests. Domain untouched.
- **No deploy.** CTO ruling: this change does not earn its own deploy. It rides the next routine backend deploy as a passenger. No production wake, no `DEPLOYMENT_TRACKER.md` row.

---

## File Structure

**Created:**
- `ops/stage-a0/check-labour-v2-isolation.sh` — guard covering committed + staged + unstaged + untracked changes. **Not `scripts/`** — the repo root `/scripts/` is gitignored (`.gitignore:195`), so a guard placed there could never be committed. Found during execution.
- `src/tests/ShramSafal.Sync.IntegrationTests/Concurrency/MultiActorLogConcurrencyRealPostgresTests.cs` — A4 schema invariant.
- `src/tests/ShramSafal.Domain.Tests/Audit/RoleRecordingRepositoryStub.cs` — **NEW file.** Never edit `Work/Handlers/StubShramSafalRepository.cs`; Labour V2 appends 37 lines at its EOF.
- `src/tests/ShramSafal.Domain.Tests/Audit/ActorRoleIsFarmScopedTests.cs` — A3 tests.
- `docs/superpowers/specs/2026-08-30-evidence-vs-derived-truth-boundary.md` — A5 constraint.

**Modified — the complete surface, including every call site the removal forces:**
- `.../UseCases/Farms/UpdateFarmBoundary/UpdateFarmBoundaryHandler.cs` + `UpdateFarmBoundaryCommand.cs`
- `.../UseCases/CropCycles/CreateCropCycle/CreateCropCycleHandler.cs` + `CreateCropCycleCommand.cs`
- `.../UseCases/Attachments/CreateAttachment/CreateAttachmentHandler.cs` + `CreateAttachmentCommand.cs`
- `.../UseCases/Attachments/UploadAttachment/UploadAttachmentHandler.cs` + `UploadAttachmentCommand.cs`
- `.../UseCases/Memberships/IssueFarmInvite/IssueFarmInviteHandler.cs`
- **`ShramSafal.Api/Endpoints/FarmEndpoints.cs`** (:227, :296)
- **`ShramSafal.Api/Endpoints/AttachmentEndpoints.cs`** (:62, :145)
- **`.../UseCases/Sync/PushSyncBatch/PushSyncBatchHandler.cs`** (:826-836, :1844-1853) — **not** on the isolation list, editing is permitted
- **`src/tests/ShramSafal.Sync.IntegrationTests/Tenancy/FarmBoundaryRlsRealPostgresTests.cs`** (:625)
- **`src/tests/ShramSafal.Domain.Tests/Farms/FarmGeographyHandlerTests.cs`** (:98) — ⚠️ **missing from Revision 3**, found by the compiler during Task 4. Task 9 Step 7 gates on *"exactly the files in §File Structure"*, so the plan would have failed its own DoD. Founder-accepted as in-scope 2026-08-31; **not a licence to widen scope**.

⚠️ **Execution lesson — call-site discovery takes repeated build cycles, not one.** A failing solution build stops before later projects compile, so it under-reports. Task 4 surfaced its three sites in three rounds: `FarmEndpoints.cs:227` + `FarmGeographyHandlerTests.cs:98`, then `FarmBoundaryRlsRealPostgresTests.cs:625` only once the Api project compiled. **Rebuild until the whole solution exits 0** — one build is not an enumeration.

---

## Task 1: Branch setup and the isolation guard

**Files:** Create `ops/stage-a0/check-labour-v2-isolation.sh`

**Interfaces:**
- Consumes: nothing.
- Produces: the guard. Exit 0 = clean, exit 1 = violation, exit 2 = cannot determine (fail closed).

- [ ] **Step 1: Create an isolated worktree from the production SHA**

```bash
cd "e:/APPS/Running App Versions/AgriSyncPlatform"
git fetch origin
git worktree add ../agrisync-a0 -b task/farm-foundation-a0 a7784b18
cd ../agrisync-a0
git rev-parse HEAD
git rev-parse --abbrev-ref HEAD
```

Expected: `a7784b18c171f8e6fdff6f1f6e30c2b4a25ab499` and `task/farm-foundation-a0`. **If the branch name is anything else, STOP** — every destructive command below asserts on it.

- [ ] **Step 2: Write the guard**

Create `ops/stage-a0/check-labour-v2-isolation.sh`:

```bash
#!/usr/bin/env bash
# Stage A0 guard: this branch must touch NO file that feat/labour-v2-r1 modifies.
# Rationale: docs/superpowers/plans/2026-08-30-shared-farm-foundation-STAGE-A-PLAN.md §2
#
# REVISION 2 fixes two holes found in review:
#   (1) it read committed history only, so every pre-commit invocation passed vacuously;
#   (2) it covered src/apps/** only, while feat/labour-v2-r1 also edits 18 test files -
#       including the one the plan used to tell implementers to extend.
# It now unions committed + staged + unstaged + untracked, and RECOMPUTES the Labour V2
# file set from the branch itself instead of trusting a frozen array.
set -euo pipefail

BASE="${1:-a7784b18}"
LABOUR_REF="${2:-feat/labour-v2-r1}"

if ! git rev-parse --verify --quiet "${LABOUR_REF}^{commit}" >/dev/null; then
  echo "CANNOT VERIFY ISOLATION: ref '${LABOUR_REF}' is not present in this worktree."
  echo "Failing closed. Fetch or add the ref, or pass it explicitly as argument 2."
  exit 2
fi

# Everything Labour V2 touches, recomputed live. No path filter - test files count.
LABOUR_FILES="$(git diff --name-only "${BASE}...${LABOUR_REF}" | sort -u)"

# Everything THIS branch touches, from all four sources.
OURS="$( { git diff --name-only "${BASE}...HEAD"
           git diff --name-only "${BASE}"
           git diff --name-only --cached
           git ls-files --others --exclude-standard
         } | sort -u )"

OVERLAP="$(comm -12 <(echo "${LABOUR_FILES}") <(echo "${OURS}"))"

if [ -n "${OVERLAP}" ]; then
  echo "LABOUR V2 ISOLATION VIOLATION - these files are also modified by ${LABOUR_REF}:"
  echo "${OVERLAP}"
  exit 1
fi

echo "Isolation OK: 0 of $(echo "${LABOUR_FILES}" | wc -l | tr -d ' ') Labour V2 files touched."
exit 0
```

- [ ] **Step 3: Run it — expect a clean pass**

```bash
chmod +x ops/stage-a0/check-labour-v2-isolation.sh
bash ops/stage-a0/check-labour-v2-isolation.sh
```

Expected: `Isolation OK: 0 of 123 Labour V2 files touched.` If it prints `CANNOT VERIFY ISOLATION`, the labour ref is missing from this worktree — resolve that before continuing; do not proceed on an unverified guard.

- [ ] **Step 4: Prove the guard fires — working tree only, NO commit**

Revision 1 used a throwaway commit plus `git reset --hard`, which would have swept the uncommitted guard script into the commit and then deleted it. This version never commits and never resets.

```bash
echo "// temp" >> src/tests/ShramSafal.Domain.Tests/Work/Handlers/StubShramSafalRepository.cs
bash ops/stage-a0/check-labour-v2-isolation.sh; echo "exit=$?"
```

Expected: `LABOUR V2 ISOLATION VIOLATION`, listing `StubShramSafalRepository.cs`, `exit=1`.

This file is chosen deliberately: it is the exact file Revision 1 told implementers to extend, and it proves the guard now sees both **test files** and **uncommitted work**.

- [ ] **Step 5: Restore that one file and re-run**

```bash
git checkout -- src/tests/ShramSafal.Domain.Tests/Work/Handlers/StubShramSafalRepository.cs
bash ops/stage-a0/check-labour-v2-isolation.sh
```

Expected: back to `Isolation OK`.

- [ ] **Step 6: Commit**

```bash
git add ops/stage-a0/check-labour-v2-isolation.sh
git commit -m "chore(a0): guard that Stage A0 touches no Labour V2 file"
```

---

## Task 2: A4 — Multi-actor concurrency invariant

**Files:** Create `src/tests/ShramSafal.Sync.IntegrationTests/Concurrency/MultiActorLogConcurrencyRealPostgresTests.cs`

**Interfaces:**
- Consumes: `RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync()` (`RequiresPostgresConnection.cs:73`, no parameters) and `IntegrationMigrationChain.ApplyAsync(string conn)` (`IntegrationMigrationChain.cs:33`). Both are assembly-internal in namespace `ShramSafal.Sync.IntegrationTests`; the child namespace resolves them with **no `using`**.
- Produces: nothing consumed later.

**Two corrections from review.** (a) `ApplyAsync` applies **all four schemas and the full ~101-migration chain including matviews** — Revision 1's "runs in a second" was wrong. Use `IClassFixture` so the database is built **once**, not per `[Fact]`. (b) Revision 1 parsed `indexdef` text, which false-positives on a *partial* unique index whose `WHERE` clause happens to mention the columns. Use the catalog.

- [ ] **Step 1: Write the fixture and tests**

```csharp
// spec: docs/superpowers/plans/2026-08-30-shared-farm-foundation-STAGE-A-PLAN.md (A4)
using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using FluentAssertions;
using Npgsql;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Concurrency;

/// <summary>
/// Builds ONE scratch database with the full migration chain and shares it across
/// every fact in the class. ApplyAsync runs four DbContexts and ~101 migrations
/// including materialized views, so per-fact setup would cost minutes.
/// </summary>
public sealed class MigratedScratchDbFixture : IAsyncLifetime
{
    public string SuperuserConnectionString { get; private set; } = string.Empty;
    private string _adminConn = string.Empty;
    private string _scratchDbName = string.Empty;

    public async Task InitializeAsync()
    {
        _adminConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();
        _scratchDbName = $"ssf_concurrency_proof_{Guid.NewGuid():N}";

        await using (var admin = new NpgsqlConnection(_adminConn))
        {
            await admin.OpenAsync();
            await using var create = admin.CreateCommand();
            create.CommandText = $"CREATE DATABASE \"{_scratchDbName}\"";
            await create.ExecuteNonQueryAsync();
        }

        SuperuserConnectionString =
            new NpgsqlConnectionStringBuilder(_adminConn) { Database = _scratchDbName }.ConnectionString;
        await IntegrationMigrationChain.ApplyAsync(SuperuserConnectionString);
    }

    public async Task DisposeAsync()
    {
        if (string.IsNullOrEmpty(_scratchDbName) || string.IsNullOrEmpty(_adminConn))
        {
            return;
        }

        try
        {
            await using var admin = new NpgsqlConnection(_adminConn);
            await admin.OpenAsync();
            await using var terminate = admin.CreateCommand();
            terminate.CommandText =
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = @db AND pid <> pg_backend_pid()";
            terminate.Parameters.AddWithValue("db", _scratchDbName);
            await terminate.ExecuteNonQueryAsync();
            await using var drop = admin.CreateCommand();
            drop.CommandText = $"DROP DATABASE IF EXISTS \"{_scratchDbName}\"";
            await drop.ExecuteNonQueryAsync();
        }
        catch
        {
            // Best-effort teardown; a leaked scratch DB is harmless.
        }
    }
}

/// <summary>
/// Stage A0 / A4 — the multi-actor concurrency invariant, pinned at the schema.
///
/// <para>A real farm is concurrent. The father logs fertilizer on Plot A while the
/// son logs spraying on Plot B and the mukadam closes attendance. Two legitimate
/// humans on the same farm, same day, even the same plot, must produce TWO records.</para>
///
/// <para><b>What this defends against.</b> Not a race — a future migration. The
/// realistic way this invariant dies is someone "fixing duplicate logs" with a unique
/// constraint on (farm_id, log_date). Duplicate protection belongs to idempotency,
/// never to a uniqueness rule over farm-day business coordinates.</para>
///
/// <para><b>What it does NOT prove.</b> It does not prove the sync envelope maps
/// ClientRequestId onto IdempotencyKey — that path is exercised by
/// <c>SyncEndpointsTests.Push_WithDuplicateClientRequestId_PerDevice_IsIdempotent</c>
/// (for create_farm). This asserts only the schema-level guarantee.</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class MultiActorLogConcurrencyRealPostgresTests
    : IClassFixture<MigratedScratchDbFixture>
{
    private readonly MigratedScratchDbFixture _db;

    public MultiActorLogConcurrencyRealPostgresTests(MigratedScratchDbFixture db) => _db = db;

    /// <summary>
    /// The row-identity column of ssf.daily_logs. Confirmed against the live catalog in
    /// Step 2 before this assertion is trusted — the table is created by raw SQL with a
    /// quoted PascalCase "Id", unlike its snake_case business columns.
    /// </summary>
    private const string RowIdentityColumn = "Id";

    private sealed record UniqueIndex(string Name, bool IsPrimary, List<string> Columns);

    /// <summary>
    /// Reads ACTUAL key columns from the catalog rather than parsing indexdef text.
    /// A partial unique index whose WHERE clause mentions farm_id would fool a string match.
    /// </summary>
    private async Task<List<UniqueIndex>> ReadUniqueIndexesAsync()
    {
        var result = new List<UniqueIndex>();
        await using var conn = new NpgsqlConnection(_db.SuperuserConnectionString);
        await conn.OpenAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            SELECT i.relname                             AS index_name,
                   ix.indisprimary                       AS is_primary,
                   array_agg(a.attname ORDER BY k.ord)   AS key_columns
            FROM pg_class t
            JOIN pg_namespace n ON n.oid = t.relnamespace
            JOIN pg_index ix    ON ix.indrelid = t.oid
            JOIN pg_class i     ON i.oid = ix.indexrelid
            JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) ON TRUE
            JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
            WHERE n.nspname = 'ssf'
              AND t.relname = 'daily_logs'
              AND ix.indisunique
              AND k.attnum > 0
              AND k.ord <= ix.indnkeyatts   -- KEY columns only, never INCLUDE columns
            GROUP BY i.relname, ix.indisprimary
            """;
        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            result.Add(new UniqueIndex(
                reader.GetString(0),
                reader.GetBoolean(1),
                new List<string>((string[])reader.GetValue(2))));
        }
        return result;
    }

    [Fact]
    public async Task Every_unique_index_on_daily_logs_is_identity_or_idempotency_and_nothing_else()
    {
        var uniqueIndexes = await ReadUniqueIndexesAsync();

        uniqueIndexes.Should().NotBeEmpty(
            "the primary key alone yields a unique index; an empty result means the query is wrong, not that the invariant holds");

        foreach (var ix in uniqueIndexes)
        {
            // Pinned, not "any single-column PK" — the invariant is explicit on purpose.
            // RowIdentityColumn is confirmed against the live catalog in Step 2 before
            // this assertion is trusted.
            var isRowIdentity = ix.IsPrimary && ix.Columns.Count == 1
                                && ix.Columns[0] == RowIdentityColumn;
            var isIdempotency = ix.Columns.Count == 1 && ix.Columns[0] == "idempotency_key";

            (isRowIdentity || isIdempotency).Should().BeTrue(
                $"unique indexes on ssf.daily_logs may only enforce row identity or idempotency. "
                + $"Index '{ix.Name}' covers [{string.Join(", ", ix.Columns)}]. If this is a new "
                + $"business-coordinate uniqueness rule (farm/day/plot/actor), it converts a second "
                + $"person's real work into a constraint violation and must be reverted. Duplicate "
                + $"protection belongs to idempotency.");
        }
    }

    [Fact]
    public async Task Idempotency_key_uniqueness_still_exists()
    {
        var uniqueIndexes = await ReadUniqueIndexesAsync();

        uniqueIndexes.Should().Contain(
            ix => ix.Columns.Count == 1 && ix.Columns[0] == "idempotency_key",
            "if this unique index is dropped, a flaky rural connection starts creating duplicate "
            + "farm history - and the fix must never be a farm-day uniqueness rule instead.");
    }
}
```

- [ ] **Step 2: Run and confirm both pass on today's schema**

```bash
dotnet test src/tests/ShramSafal.Sync.IntegrationTests \
  --filter "FullyQualifiedName~MultiActorLogConcurrencyRealPostgresTests" -v minimal
```

Expected: **2 passed**. Allow minutes on first run — the fixture builds a full database. Verified precondition: `DailyLogConfiguration.cs:152-154` is unique on `IdempotencyKey` (partial, `WHERE idempotency_key IS NOT NULL`); `:156` `(FarmId, LogDate)` is **not** unique.

**If `Every_unique_index_…` fails on the `RowIdentityColumn` comparison**, the primary key column is not literally `"Id"`. Do not guess — print what the catalog actually holds and pin that:

```csharp
// Temporary diagnostic inside the test, removed before commit:
foreach (var ix in uniqueIndexes)
    Console.WriteLine($"{ix.Name} primary={ix.IsPrimary} cols=[{string.Join(",", ix.Columns)}]");
```

Run with `-v normal` to see it. `DailyLogConfiguration.cs:13` declares `HasKey(x => x.Id)` with **no** `HasColumnName`, unlike every business column on that table — so `"Id"` is the expectation, but the catalog is the authority. Update the constant to the observed value, then delete the diagnostic.

**If `Idempotency_key_uniqueness_still_exists` fails**, the invariant is already broken — stop and escalate rather than adjusting the test.

- [ ] **Step 3: Prove the assertion is not vacuous — without mutating the source**

Revision 1 asked the implementer to flip `.BeFalse()`→`.BeTrue()` and revert, which risks committing an inverted assertion. Instead add this pure unit test to the same file — no database, no source mutation:

```csharp
public sealed class UniqueIndexAllowListLogicTests
{
    private static bool IsPermitted(bool isPrimary, params string[] columns) =>
        (isPrimary && columns.Length == 1 && columns[0] == "Id")
        || (columns.Length == 1 && columns[0] == "idempotency_key");

    [Theory]
    [InlineData(true,  new[] { "Id" },                       true)]
    [InlineData(false, new[] { "idempotency_key" },          true)]
    [InlineData(false, new[] { "farm_id", "log_date" },      false)]
    [InlineData(false, new[] { "farm_id", "plot_id", "log_date" }, false)]
    [InlineData(false, new[] { "farm_id", "operator_user_id", "log_date" }, false)]
    // A composite PK over business coordinates is still forbidden, primary or not.
    [InlineData(true,  new[] { "farm_id", "log_date" },      false)]
    public void The_allow_list_admits_only_identity_and_idempotency(
        bool isPrimary, string[] columns, bool expected)
        => IsPermitted(isPrimary, columns).Should().Be(expected);
}
```

- [ ] **Step 4: Run everything in the file**

```bash
dotnet test src/tests/ShramSafal.Sync.IntegrationTests \
  --filter "FullyQualifiedName~Concurrency" -v minimal
```

Expected: **8 passed** (2 schema facts + 6 theory cases).

- [ ] **Step 5: Guard, then commit**

```bash
bash ops/stage-a0/check-labour-v2-isolation.sh
git add src/tests/ShramSafal.Sync.IntegrationTests/Concurrency/
git commit -m "test(a0): pin that two actors may log the same farm-day"
```

---

## Task 3: A3 — Make the two silent call sites explicit FIRST

**This task changes no behaviour. It exists solely so the next three tasks cannot corrupt data.**

**Files:** Modify `.../UseCases/Sync/PushSyncBatch/PushSyncBatchHandler.cs` (:826-836, :1844-1853)

**Interfaces:**
- Consumes: nothing.
- Produces: two call sites that will now fail to compile if a command parameter is removed.

**Why this is Task 3 and not a footnote.** `CreateCropCycleCommand` and `CreateAttachmentCommand` are constructed **fully positionally** in the offline sync path, with `ActorRole (string?)` sitting immediately before `ClientCommandId (string?)` and `ClientAppVersion (string)`. Deleting `ActorRole` shifts every later argument one slot left. Every binding is string→string. **It compiles clean and every test passes**, while the sync path silently writes the role into `client_command_id` and the request id into `app_version` — corrupted forensic provenance on the path farmers actually write through. The endpoint call sites are safe (they mix named arguments and raise CS1739/CS1744); only these two are silent.

- [ ] **Step 1: Record the current behaviour so the refactor is provably neutral**

```bash
sed -n '820,840p' src/apps/ShramSafal/ShramSafal.Application/UseCases/Sync/PushSyncBatch/PushSyncBatchHandler.cs
sed -n '1840,1856p' src/apps/ShramSafal/ShramSafal.Application/UseCases/Sync/PushSyncBatch/PushSyncBatchHandler.cs
```

Expected: two positional constructor calls ending `..., actorRole, clientRequestId)`.

- [ ] **Step 2: Convert both to fully named arguments**

At `:826-836`, rewrite the `new CreateCropCycleCommand(...)` call so **every** argument is named. The real parameter order (`CreateCropCycleCommand.cs:3-20`) is:

```
FarmId, PlotId, CropName, Stage, StartDate, EndDate, ActorUserId,
CropCycleId = null, ActorRole = null, ClientCommandId = null,
ClientAppVersion = "unknown", AuditDeviceId = "unknown", AuditIpHash = "sha256:unknown"
```

So:

```csharp
new CreateCropCycleCommand(
    FarmId: request.FarmId,
    PlotId: request.PlotId,
    CropName: request.CropName,
    Stage: request.Stage,
    StartDate: request.StartDate,
    EndDate: request.EndDate,
    ActorUserId: actorUserId,
    CropCycleId: request.CropCycleId,
    ActorRole: actorRole,
    ClientCommandId: clientRequestId)
```

At `:1844-1853`, do the same for `CreateAttachmentCommand`. Its real order (`CreateAttachmentCommand.cs:3-18`) is:

```
FarmId, LinkedEntityId, LinkedEntityType, FileName, MimeType, CreatedByUserId,
AttachmentId = null, ActorRole = null, ClientCommandId = null, ...
```

- [ ] **Step 3: Verify the refactor changed nothing**

```bash
git diff --stat
dotnet build src/AgriSync.sln 2>&1 | grep -E "error CS" || echo "Build clean."
```

Expected: only `PushSyncBatchHandler.cs` changed, argument *names* added and nothing reordered or removed. `Build clean.`

- [ ] **Step 4: Guard, then commit separately**

A standalone commit means the safety refactor is reviewable on its own and survives even if a later task is reverted.

```bash
bash ops/stage-a0/check-labour-v2-isolation.sh
git add src/apps/ShramSafal/ShramSafal.Application/UseCases/Sync/PushSyncBatch/PushSyncBatchHandler.cs
git commit -m "refactor(sync): name every argument at the two command call sites"
```

---

## Task 4: A3 — The shared test double, then UpdateFarmBoundary

**Files:**
- Create: `src/tests/ShramSafal.Domain.Tests/Audit/RoleRecordingRepositoryStub.cs`
- Create: `src/tests/ShramSafal.Domain.Tests/Audit/ActorRoleIsFarmScopedTests.cs`
- Modify: `.../UseCases/Farms/UpdateFarmBoundary/UpdateFarmBoundaryHandler.cs:102` + `UpdateFarmBoundaryCommand.cs`
- Modify: `ShramSafal.Api/Endpoints/FarmEndpoints.cs:227,296`
- Modify: `src/tests/ShramSafal.Sync.IntegrationTests/Tenancy/FarmBoundaryRlsRealPostgresTests.cs:625`

**Interfaces:**
- Consumes: `IShramSafalRepository.GetUserRoleForFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default)` → `Task<AppRole?>` (`IShramSafalRepository.cs:49`, **untouched by Labour V2**). `UpdateFarmBoundaryHandler.cs:32` injects it as `repository`, alongside `IIdGenerator` and `IClock`.
- Produces: `RoleRecordingRepositoryStub(AppRole? roleToReturn)` with `string? LastAuditActorRole`, subclassing `StubShramSafalRepository`; and the **canonical A3 pattern**:
  ```csharp
  var resolvedActorRole = await repository.GetUserRoleForFarmAsync(<farmId>, <actorUserId>, ct);
  // ...
  actorRole: resolvedActorRole?.ToString().ToLowerInvariant() ?? "unknown",
  ```

**🔴 Create a NEW file. Never edit `Work/Handlers/StubShramSafalRepository.cs`** — Labour V2 appends 37 lines at its EOF, so both branches editing it produces the exact conflict this stage exists to prevent. Subclass it instead; it is `internal abstract`.

- [ ] **Step 1: Confirm casing has no case-sensitive reader**

```bash
grep -rn "ActorRole" --include="*.cs" src/apps/ src/AgriSync.Bootstrapper/ \
  | grep -v "actorRole:" | grep -v "ActorRole:" | grep -v "/Migrations/" | head -20
```

Expected: no equality comparison against a role literal. **If one exists, STOP and escalate.**

Decision: **lowercase invariant**, matching the majority. Verified there is no canonical helper to reuse — `SharedKernel/CommonPolicies/RoleNames.cs` looks like one but three of its four constants are not `AppRole` members and nothing references it. Do not use it; do not build a new abstraction.

- [ ] **Step 2: Write the stub**

`StubShramSafalRepository` defaults `IsUserOwnerOfFarmAsync`/`IsUserMemberOfFarmAsync` to **false** and throws `NotSupportedException` from `GetFarmByIdAsync`. Every handler therefore short-circuits before the audit write unless these are overridden — which is why Revision 1's predicted failure messages were wrong.

```csharp
// spec: docs/superpowers/plans/2026-08-30-shared-farm-foundation-STAGE-A-PLAN.md (A3)
using System;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Tests.Work.Handlers;

namespace ShramSafal.Domain.Tests.Audit;

/// <summary>
/// Captures the ActorRole an Application handler writes to the audit ledger, and
/// answers the membership/ownership reads that would otherwise short-circuit the
/// handler before it ever reaches that write.
///
/// <para><b>A new file, deliberately.</b> feat/labour-v2-r1 appends to
/// <c>Work/Handlers/StubShramSafalRepository.cs</c> at EOF. Subclassing keeps Stage A0
/// out of that file entirely.</para>
/// </summary>
internal sealed class RoleRecordingRepositoryStub : StubShramSafalRepository
{
    private readonly AppRole? _role;
    private readonly Farm? _farm;

    public RoleRecordingRepositoryStub(AppRole? role, Farm? farm = null)
    {
        _role = role;
        _farm = farm;
    }

    public string? LastAuditActorRole { get; private set; }
    public int AuditEventCount { get; private set; }

    public override Task<AppRole?> GetUserRoleForFarmAsync(
        Guid farmId, Guid userId, CancellationToken ct = default)
        => Task.FromResult(_role);

    public override Task<bool> IsUserOwnerOfFarmAsync(
        Guid farmId, Guid userId, CancellationToken ct = default)
        => Task.FromResult(_role is AppRole.PrimaryOwner or AppRole.SecondaryOwner);

    public override Task<bool> IsUserMemberOfFarmAsync(
        Guid farmId, Guid userId, CancellationToken ct = default)
        => Task.FromResult(_role is not null);

    public override Task<Farm?> GetFarmByIdAsync(Guid farmId, CancellationToken ct = default)
        => Task.FromResult(_farm);

    public override Task AddAuditEventAsync(AuditEvent auditEvent, CancellationToken ct = default)
    {
        LastAuditActorRole = auditEvent.ActorRole;
        AuditEventCount++;
        return Task.CompletedTask;
    }
}
```

**Implementer note — pre-verified 2026-08-31, no action needed.** Every member of `StubShramSafalRepository` is `public virtual` (checked at `a7784b18`, lines 25-53+), so this subclass compiles without touching the base file at all. **If you nonetheless find a member you need that is not `virtual`: STOP.** Do not make it virtual — that file is Labour V2's, and editing it is the collision this stage exists to prevent. Report it and propose an isolated alternative instead.

- [ ] **Step 3: Write the failing test**

```csharp
// spec: docs/superpowers/plans/2026-08-30-shared-farm-foundation-STAGE-A-PLAN.md (A3)
using System;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Application.UseCases.Farms.UpdateFarmBoundary;
using ShramSafal.Domain.Tests.Analytics;
using Xunit;

namespace ShramSafal.Domain.Tests.Audit;

/// <summary>
/// Stage A0 / A3 — the audit ledger records the actor's role ON THE FARM BEING
/// ACTED ON, not the single global role their login token happens to carry.
///
/// <para>The JWT membership claim is one role per account. Someone who owns their
/// own farm and merely works on a neighbour's is recorded as an owner on the
/// neighbour's farm. That is the defect. The role was never client-spoofable —
/// it is server-derived from a signed claim — it was simply the wrong farm's role.</para>
/// </summary>
public sealed class ActorRoleIsFarmScopedTests
{
    [Fact]
    public async Task Boundary_update_records_the_role_on_this_farm()
    {
        var farmId = Guid.NewGuid();
        var actorUserId = Guid.NewGuid();
        var farm = Farm.Create(new FarmId(farmId), "Test Farm", new UserId(actorUserId), DateTime.UtcNow);
        farm.AttachToOwnerAccount(OwnerAccountId.New(), DateTime.UtcNow);

        var repository = new RoleRecordingRepositoryStub(AppRole.SecondaryOwner, farm);
        var handler = new UpdateFarmBoundaryHandler(
            repository, new SequentialIdGenerator(), new FixedClock(DateTime.UtcNow));

        await handler.HandleAsync(
            new UpdateFarmBoundaryCommand(
                FarmId: farmId,
                ActorUserId: actorUserId,
                PolygonGeoJson: SquarePolygonGeoJson,
                CentreLat: 17.6,
                CentreLng: 75.3,
                CalculatedAreaAcres: 1.0m),
            CancellationToken.None);

        repository.AuditEventCount.Should().Be(1, "the handler must reach the audit write");
        repository.LastAuditActorRole.Should().Be("secondaryowner");
    }

    private const string SquarePolygonGeoJson =
        """{"type":"Polygon","coordinates":[[[75.3,17.6],[75.31,17.6],[75.31,17.61],[75.3,17.61],[75.3,17.6]]]}""";
}
```

**Implementer note:** `FixedClock` (`Analytics/TestDoubles.cs:9`) and `SequentialIdGenerator` (`:15`) already exist — reuse, do not rewrite. `UpdateFarmBoundaryHandler` may reject the polygon or require additional repository reads; if `AuditEventCount` is 0, read the handler's early-return path and satisfy it in the stub rather than weakening the assertion.

- [ ] **Step 4: Run to verify it fails**

```bash
dotnet test src/tests/ShramSafal.Domain.Tests \
  --filter "FullyQualifiedName~ActorRoleIsFarmScopedTests" -v minimal
```

Expected: FAIL — `Expected "secondaryowner" but found "unknown"` (the command's `ActorRole` defaults to null). If it fails with `AuditEventCount` 0, the handler short-circuited: fix the stub, not the test.

- [ ] **Step 5: Resolve the role in the handler**

In `UpdateFarmBoundaryHandler.cs`, before `AddAuditEventAsync`:

```csharp
        // Stage A0 / A3 — the role recorded must be the actor's role ON THIS FARM.
        // The JWT membership claim carries ONE role per account, so an owner of another
        // farm acting here was previously recorded as an owner here.
        // GetUserRoleForFarmAsync is the same resolver the authorization gate uses, so
        // the audit trail and the access decision cannot disagree.
        var resolvedActorRole = await repository.GetUserRoleForFarmAsync(
            command.FarmId, command.ActorUserId, ct);
```

Change `:102` to:

```csharp
                actorRole: resolvedActorRole?.ToString().ToLowerInvariant() ?? "unknown",
```

- [ ] **Step 6: Remove `ActorRole` from the command and fix all call sites**

Delete `string? ActorRole = null,` from `UpdateFarmBoundaryCommand.cs`. There is **no sync mutation** for `update_farm_boundary`, so no positional hazard here.

```bash
dotnet build src/AgriSync.sln 2>&1 | grep -E "error CS" | head -20
```

Expected: CS1739 at `FarmEndpoints.cs:227` and `:296`, and at `FarmBoundaryRlsRealPostgresTests.cs:625` — all named arguments. Remove the `ActorRole:` argument at each. Add no replacement.

- [ ] **Step 7: Run, guard, commit**

```bash
dotnet test src/tests/ShramSafal.Domain.Tests --filter "FullyQualifiedName~ActorRoleIsFarmScopedTests" -v minimal
bash ops/stage-a0/check-labour-v2-isolation.sh
git add src/apps/ShramSafal/ShramSafal.Application/UseCases/Farms/UpdateFarmBoundary/ \
        src/apps/ShramSafal/ShramSafal.Api/Endpoints/FarmEndpoints.cs \
        src/tests/ShramSafal.Domain.Tests/Audit/ \
        src/tests/ShramSafal.Sync.IntegrationTests/Tenancy/FarmBoundaryRlsRealPostgresTests.cs
git commit -m "fix(audit): boundary updates record the actor's role on that farm"
```

---

## Task 5: A3 — CreateCropCycle

**Files:** `CreateCropCycleHandler.cs:113` + `CreateCropCycleCommand.cs`; test file from Task 4.

**Interfaces:** Consumes the canonical pattern. `CreateCropCycleHandler.cs:28` injects `IShramSafalRepository repository, IIdGenerator, IClock, IEntitlementPolicy`. Reuse `AllowEntitlementPolicy` (`Analytics/TestDoubles.cs:90`).

**Prerequisite:** Task 3 must be committed. Without it, Step 3 silently mis-binds.

- [ ] **Step 1: Add the failing test**

```csharp
    [Fact]
    public async Task Crop_cycle_creation_records_the_role_on_this_farm()
    {
        var farmId = Guid.NewGuid();
        var actorUserId = Guid.NewGuid();
        var farm = Farm.Create(new FarmId(farmId), "Test Farm", new UserId(actorUserId), DateTime.UtcNow);
        farm.AttachToOwnerAccount(OwnerAccountId.New(), DateTime.UtcNow);

        var repository = new RoleRecordingRepositoryStub(AppRole.Mukadam, farm);
        var handler = new CreateCropCycleHandler(
            repository, new SequentialIdGenerator(), new FixedClock(DateTime.UtcNow),
            new AllowEntitlementPolicy());

        await handler.HandleAsync(
            new CreateCropCycleCommand(
                FarmId: farmId,
                PlotId: Guid.NewGuid(),
                CropName: "Pomegranate",
                Stage: "Vegetative",
                StartDate: new DateOnly(2026, 8, 30),
                EndDate: null,
                ActorUserId: actorUserId),
            CancellationToken.None);

        repository.AuditEventCount.Should().Be(1);
        repository.LastAuditActorRole.Should().Be("mukadam");
    }
```

**Note the real parameter order** (`CreateCropCycleCommand.cs:3-20`): `FarmId, PlotId, CropName, Stage, StartDate, EndDate, ActorUserId, …`. Revision 1 had `ActorUserId` third; named arguments hid the error.

The handler also needs a `Plot` whose `FarmId` matches, a membership check, the entitlement gate, and a cycle-overlap read via `GetCropCyclesByPlotIdAsync` (which throws in the base stub). Override each in `RoleRecordingRepositoryStub` as the failures reveal them.

- [ ] **Step 2: Run to verify it fails**

```bash
dotnet test src/tests/ShramSafal.Domain.Tests --filter "FullyQualifiedName~Crop_cycle_creation_records" -v minimal
```

Expected: FAIL — `Expected "mukadam" but found "unknown"`, or `AuditEventCount` 0 if a gate still blocks.

- [ ] **Step 3: Apply the canonical pattern**

```csharp
        // Stage A0 / A3 — farm-scoped role; see UpdateFarmBoundaryHandler.
        var resolvedActorRole = await repository.GetUserRoleForFarmAsync(
            command.FarmId, command.ActorUserId, ct);
```

`:113` becomes:

```csharp
                actorRole: resolvedActorRole?.ToString().ToLowerInvariant() ?? "unknown",
```

- [ ] **Step 4: Remove `ActorRole` from the command**

```bash
dotnet build src/AgriSync.sln 2>&1 | grep -E "error CS" | head -20
```

Expected: an error at `PushSyncBatchHandler.cs:826` — **because Task 3 made it named.** If the build is clean, Task 3 was skipped: **STOP and do it first.** Remove the now-invalid `ActorRole:` argument there and at any endpoint site.

- [ ] **Step 5: Run, guard, commit**

```bash
dotnet test src/tests/ShramSafal.Domain.Tests --filter "FullyQualifiedName~ActorRoleIsFarmScopedTests" -v minimal
bash ops/stage-a0/check-labour-v2-isolation.sh
git add src/apps/ShramSafal/ShramSafal.Application/UseCases/CropCycles/ \
        src/apps/ShramSafal/ShramSafal.Application/UseCases/Sync/PushSyncBatch/PushSyncBatchHandler.cs \
        src/tests/ShramSafal.Domain.Tests/Audit/
git commit -m "fix(audit): crop-cycle creation records the role on that farm"
```

---

## Task 6: A3 — Both attachment handlers

**Files:** `CreateAttachmentHandler.cs:65` + `CreateAttachmentCommand.cs`; `UploadAttachmentHandler.cs:69` + `UploadAttachmentCommand.cs`; `AttachmentEndpoints.cs:62,145`; test file.

**Interfaces:** `CreateAttachmentHandler.cs:13` takes `IShramSafalRepository repository, IIdGenerator, IClock`. `UploadAttachmentHandler.cs:15` takes `IShramSafalRepository repository, IAttachmentStorageService, IClock` — **`IAttachmentStorageService` has no existing fake anywhere**; write a minimal one (2 methods: `SaveAsync`, `OpenReadAsync`).

**🔴 Harden these two call sites while you are in them (founder ruling 2026-08-31).** `AttachmentEndpoints.cs:62` and `:145` pass `ActorRole` **positionally**, and survive removal only because `ClientCommandId: null` follows on the next line and raises CS1744. That is an accident, not a design guarantee — the same silent-rebind class Task 3 exists to kill, saved by luck. **Convert both constructor calls to fully named arguments FIRST, then remove `ActorRole`.** Only these two; do not start a repository-wide positional cleanup. The rule: *where A0 already has to touch a command call site whose adjacent parameters share compatible types, leave it safer than we found it.*

**Farm id source differs — do not copy blindly.** `CreateAttachmentCommand` has a `FarmId`; `UploadAttachmentCommand` **does not** (verified: `AttachmentId, FileStream, UploadedByUserId, UploadedMimeType, ClientFileName, ActorRole, …`). Upload must source it from `attachment.FarmId`, retrieved via `GetAttachmentByIdAsync` (throws in the base stub — override it).

- [ ] **Step 1: Write both failing tests, plus the storage fake**

Follow Task 4's shape. Roles: `AppRole.Worker` for create, `AppRole.PrimaryOwner` for upload. Assert `AuditEventCount == 1` before asserting the role, so a silent early return is never mistaken for a wrong role.

- [ ] **Step 2: Run to verify both fail**

```bash
dotnet test src/tests/ShramSafal.Domain.Tests --filter "FullyQualifiedName~Attachment" -v minimal
```

- [ ] **Step 3: Fix `CreateAttachmentHandler`**

```csharp
        // Stage A0 / A3 — farm-scoped role; see UpdateFarmBoundaryHandler.
        var resolvedActorRole = await repository.GetUserRoleForFarmAsync(
            command.FarmId, command.CreatedByUserId, ct);
```

`:65` becomes `actorRole: resolvedActorRole?.ToString().ToLowerInvariant() ?? "unknown",`

- [ ] **Step 4: Fix `UploadAttachmentHandler`**

```csharp
        // Stage A0 / A3 — farm-scoped role. The farm comes from the stored attachment,
        // never the command: the uploader must not name a farm they are not acting on.
        var resolvedActorRole = await repository.GetUserRoleForFarmAsync(
            attachment.FarmId, command.UploadedByUserId, ct);
```

`FarmId` declares `implicit operator Guid` (`SharedKernel/Contracts/Ids/FarmId.cs:26`), so no cast is needed — `:33` already passes it uncast. `:69` becomes the same one-liner.

- [ ] **Step 5: Remove `ActorRole` from both commands**

```bash
dotnet build src/AgriSync.sln 2>&1 | grep -E "error CS" | head -20
```

Expected: CS1744 at `AttachmentEndpoints.cs:62` and `:145`, plus an error at `PushSyncBatchHandler.cs:1844` **because Task 3 made it named**. If `PushSyncBatchHandler` does not error, **STOP** — Task 3 was skipped and this removal is silently corrupting the sync path.

- [ ] **Step 6: Run, guard, commit**

```bash
dotnet test src/tests/ShramSafal.Domain.Tests --filter "FullyQualifiedName~ActorRoleIsFarmScopedTests" -v minimal
bash ops/stage-a0/check-labour-v2-isolation.sh
git add src/apps/ShramSafal/ShramSafal.Application/UseCases/Attachments/ \
        src/apps/ShramSafal/ShramSafal.Api/Endpoints/AttachmentEndpoints.cs \
        src/apps/ShramSafal/ShramSafal.Application/UseCases/Sync/PushSyncBatch/PushSyncBatchHandler.cs \
        src/tests/ShramSafal.Domain.Tests/Audit/
git commit -m "fix(audit): attachment writes record the role on that farm"
```

---

## Task 7: A3 — The hardcoded `primaryowner` in IssueFarmInvite

**Files:** `IssueFarmInviteHandler.cs:115` (audit, raw role) and `:136` (analytics, **bounded mapping** — see the constraint below; never a raw role)

**Interfaces:** `IssueFarmInviteHandler.cs:39` injects `IFarmInvitationRepository, IShramSafalRepository farmRepository, IClock, IAnalyticsWriter` — note the parameter name is `farmRepository`. `Analytics/IssueFarmInviteHandlerAnalyticsTests.cs:32` already constructs it; use that as the template. `StubFarmInvitationRepository` (`TestDoubles.cs:37`) and `CapturingAnalyticsWriter` already exist.

**Why this matters most.** Authorization for this handler runs **outside** it (`IssueFarmInviteAuthorizer.cs:27` → `EnsureIsOwner` → `IsUserOwnerOfFarmAsync`, which admits `PrimaryOwner` **or** `SecondaryOwner`). The moment a SecondaryOwner shares the farm QR, `:115` records a role that person does not hold.

**🔴 CONSTRAINT — the analytics column is narrow, so `:136` gets a BOUNDED mapping, never a raw role.** Two different columns are in play and Revision 1 treated them as one:

| Sink | Column | Width | Source |
|---|---|---|---|
| Audit | `ssf.audit_events.actor_role` | `varchar(80)` | `AuditEventConfiguration.cs:41-44` |
| Analytics | `actor_role` | **`varchar(16)`** | `AnalyticsEventConfiguration.cs:53-56` |

`AppRole.FpcTechnicalManager.ToString().ToLowerInvariant()` is `"fpctechnicalmanager"` — **19 characters**. Writing a raw role there reintroduces the `varchar(20)` correction-ledger failure class (the 22001 that took a production ledger down on 2026-08-26). Widening is a **migration**, which Stage A0 forbids.

**But leaving it hardcoded is also wrong** — it would knowingly record every SecondaryOwner invite as `primaryowner`. There is a third option, and the repo supports it.

**Verified invariant:** issuing an invite is an owner action. `IssueFarmInviteAuthorizer.cs:27` → `IAuthorizationEnforcer.EnsureIsOwner` → `ShramSafalAuthorizationEnforcer.cs:113` → `IsUserOwnerOfFarmAsync` → `ShramSafalRepository.cs:94`: `return role is AppRole.PrimaryOwner or AppRole.SecondaryOwner;`. Only two roles can reach this handler through the pipeline.

```
primaryowner    = 12 chars   ✅ fits varchar(16)
secondaryowner  = 14 chars   ✅ fits varchar(16)
unknown         =  7 chars   ✅ fits varchar(16)
```

So an **explicit bounded mapping** keeps analytics truthful *and* cannot overflow — including if the handler is ever invoked outside the pipeline, because anything unexpected falls to `"unknown"` rather than to a long role string. The width remains a separate founder finding because other writers (`CreatePlotHandler:115`) can receive longer roles today.

- [ ] **Step 1: Write the failing test**

```csharp
    [Fact]
    public async Task Invite_issued_by_a_secondary_owner_is_not_audited_as_primaryowner()
    {
        var farmId = Guid.NewGuid();
        var callerUserId = Guid.NewGuid();
        var repository = new RoleRecordingRepositoryStub(AppRole.SecondaryOwner);
        // Construct exactly as Analytics/IssueFarmInviteHandlerAnalyticsTests.cs:32 does.
        var handler = new IssueFarmInviteHandler(
            new StubFarmInvitationRepository(), repository,
            new FixedClock(DateTime.UtcNow), new CapturingAnalyticsWriter());

        await handler.HandleAsync(
            new IssueFarmInviteCommand(new FarmId(farmId), new UserId(callerUserId)),
            CancellationToken.None);

        repository.AuditEventCount.Should().Be(1);
        repository.LastAuditActorRole.Should().Be(
            "secondaryowner",
            "EnsureIsOwner admits SecondaryOwner, so hardcoding primaryowner writes a false record");
    }
```

- [ ] **Step 2: Run to verify it fails**

```bash
dotnet test src/tests/ShramSafal.Domain.Tests --filter "FullyQualifiedName~Invite_issued_by_a_secondary_owner" -v minimal
```

Expected: FAIL — `Expected "secondaryowner" but found "primaryowner"`.

- [ ] **Step 3: Fix the audit line only**

Before the `if (existing is null)` block:

```csharp
        // Stage A0 / A3 — this was hardcoded to PrimaryOwner. Authorization runs in
        // IssueFarmInviteAuthorizer -> EnsureIsOwner, which admits SecondaryOwner too,
        // so a co-owner sharing the QR was recorded as the primary owner.
        var resolvedActorRole = await farmRepository.GetUserRoleForFarmAsync(
            command.FarmId.Value, command.CallerUserId.Value, ct);
        var auditActorRole = resolvedActorRole?.ToString().ToLowerInvariant() ?? "unknown";
```

`:115` becomes:

```csharp
                    actorRole: auditActorRole,
```

For `:136`, add the bounded mapping beside the audit resolution:

```csharp
        // The analytics actor_role column is varchar(16)
        // (AnalyticsEventConfiguration.cs:53-56) and "fpctechnicalmanager" is 19 chars, so
        // a RAW role here can raise 22001 — the same failure class as the varchar(20)
        // correction ledger. Widening is a migration, excluded from Stage A0.
        //
        // Issuing an invite is an owner action: IssueFarmInviteAuthorizer -> EnsureIsOwner
        // -> IsUserOwnerOfFarmAsync admits ONLY PrimaryOwner or SecondaryOwner
        // (ShramSafalRepository.cs:94). This mapping is therefore total for every role that
        // can legitimately reach here, stays truthful for a SecondaryOwner, and cannot
        // overflow even if the handler is invoked outside the pipeline.
        var analyticsActorRole = resolvedActorRole switch
        {
            AppRole.PrimaryOwner => "primaryowner",
            AppRole.SecondaryOwner => "secondaryowner",
            _ => "unknown",
        };
```

`:136` becomes:

```csharp
            ActorRole: analyticsActorRole,
```

- [ ] **Step 4: Confirm `inviteeRole` at `:144` is correct and must not change**

```bash
sed -n '140,150p' src/apps/ShramSafal/ShramSafal.Application/UseCases/Memberships/IssueFarmInvite/IssueFarmInviteHandler.cs
```

`inviteeRole = AppRole.Worker` is **true today** — `ClaimJoinHandler.cs:123` really does mint `Worker`. It describes the invitee, not the actor. Leave it, and record in the Task 9 report that it becomes false the day invitations carry a role (Stage B).

- [ ] **Step 5: Run, guard, commit**

```bash
dotnet test src/tests/ShramSafal.Domain.Tests --filter "FullyQualifiedName~ActorRoleIsFarmScopedTests" -v minimal
bash ops/stage-a0/check-labour-v2-isolation.sh
git add src/apps/ShramSafal/ShramSafal.Application/UseCases/Memberships/IssueFarmInvite/ src/tests/ShramSafal.Domain.Tests/Audit/
git commit -m "fix(audit): stop recording every invite as issued by a primary owner"
```

---

## Task 8: A5 — Record the evidence-vs-derived-truth boundary

**Files:** Create `docs/superpowers/specs/2026-08-30-evidence-vs-derived-truth-boundary.md`

**Interfaces:** Produces a constraint binding on Stage A1 and Stage B.

- [ ] **Step 1: Verify the property name BEFORE writing the document**

Revision 1's document asserted `DailyLog.EvidenceRefs`. **That identifier does not exist** — `git grep EvidenceRefs` returns zero hits.

```bash
grep -n "EvidenceSourcesJson\|evidence_sources" \
  src/apps/ShramSafal/ShramSafal.Domain/Logs/DailyLog.cs \
  src/apps/ShramSafal/ShramSafal.Infrastructure/Persistence/Configurations/DailyLogConfiguration.cs
```

Expected: `DailyLog.cs:101` `EvidenceSourcesJson`; `DailyLogConfiguration.cs:138-142` maps it to `evidence_sources`, jsonb, default `'[]'::jsonb`, required.

- [ ] **Step 2: Write the document**

```markdown
# Architectural Constraint — Source Evidence vs Derived Truth

**Status:** BINDING on Stage A1 and Stage B. Recorded 2026-08-30, Stage A0.
**Origin:** Founder rulings R2 / R6 + IDEA 4 §4.6.

## The rule

> **Derived structured facts may be shared at a narrower scope than the source
> evidence that produced them.**

## Why it exists

A farmer says once:

> "Plot A la XYZ 5 litre takla ani Plot B la 8 litre takla. Plot A madhe disease jasta aahe."

An agronomist scoped to Plot B may safely receive `Plot B / XYZ / 8 litres / sprayed today`.
He must not automatically receive the recording, which also describes Plot A.

The same applies to worker confirmation: Ramesh confirming his Plot A work must not see
Santosh's wage, Plot B, or unrelated workers.

## What this forbids

- Attaching source evidence only to a record whose scope is wider than the evidence's safe audience.
- Any design where showing a plot-scoped fact requires showing the capture it came from.
- Collapsing "who may see the fact" and "who may see the evidence" into one permission.

## What it does not require

No policy engine, no redaction pipeline, no evidence-visibility UI. Stage A0 builds none of
that. This exists so Stage A1 does not make it impossible.

## How to satisfy it

Structured facts must be addressable and readable without dereferencing the source capture.
The capture stays linked for provenance; that link must be traversable by permission, not by
construction.

## Current state (verified 2026-08-31 @ a7784b18)

`DailyLog.EvidenceSourcesJson` (`ShramSafal.Domain/Logs/DailyLog.cs:101`) maps to the jsonb
column `evidence_sources` (`DailyLogConfiguration.cs:138-142`), shaped
`[{type:'voice', voice_capture_id: …}]` (`DailyLog.cs:96`). It hangs off the DailyLog row.

For a `MultiPlot` log — one row carrying `plot_ids >= 2` (`DailyLog.cs:284`) — there is today
no way to expose one plot's fact without exposing the row the evidence is attached to.
**This constraint is therefore currently unsatisfiable for multi-plot logs, and Stage A1 is
what makes it satisfiable.**
```

- [ ] **Step 3: Guard, then commit**

```bash
bash ops/stage-a0/check-labour-v2-isolation.sh
git add docs/superpowers/specs/2026-08-30-evidence-vs-derived-truth-boundary.md
git commit -m "docs(arch): record the evidence-vs-derived-truth boundary"
```

---

## Task 9: Drift gate, verification, handoff report

- [ ] **Step 1: Trunk-drift gate FIRST — it decides every base used below**

```bash
git fetch origin
echo "origin/main NOW:      $(git rev-parse origin/main)"
echo "A0 branch point was:  a7784b18"
echo "labour-v2-r1 tip NOW: $(git rev-parse feat/labour-v2-r1 2>/dev/null || echo 'REF ABSENT')"
```

If `origin/main` has advanced beyond `a7784b18`: **rebase A0 onto the new trunk before doing anything else in this task**, then run every remaining step against the new trunk.

If the labour ref is absent, the isolation gate cannot be computed — **fail closed** and say so. Never report `Isolation OK` from a missing ref.

The final report must state one of these verbatim:
- `Trunk unchanged since Stage A0 branch point.`
- `Trunk advanced to <sha>; A0 was re-baselined and all gates were rerun against the new trunk.`

- [ ] **Step 2: Compute the comparison bases DYNAMICALLY — never reuse `a7784b18` after a rebase**

⚠️ **This is the subtlest correctness issue in the whole plan.** After a rebase, `a7784b18...HEAD` contains A0's work **plus every unrelated commit that entered `main` since 2026-08-28`. The isolation gate would then answer *"did anything merged into main since 30 Aug overlap Labour V2?"* — not *"does A0's own patch overlap Labour V2?"* — and could report a collision A0 never created.

Derive both bases from merge-bases, not from a literal SHA:

```bash
TRUNK="$(git rev-parse origin/main)"
A0_BASE="$(git merge-base "${TRUNK}" HEAD)"
LABOUR_BASE="$(git merge-base "${TRUNK}" feat/labour-v2-r1)"

echo "A0 base:      ${A0_BASE}"
echo "Labour base:  ${LABOUR_BASE}"
```

Record both in the final report. Everything below uses these, never `a7784b18`.

- [ ] **Step 3: Final isolation gate — recomputed against the dynamic bases**

```bash
bash ops/stage-a0/check-labour-v2-isolation.sh "${A0_BASE}"

comm -12 <(git diff --name-only "${A0_BASE}...HEAD" | sort -u) \
         <(git diff --name-only "${LABOUR_BASE}...feat/labour-v2-r1" | sort -u)
```

Expected: `Isolation OK`, and the `comm` output **empty**. The question being answered is exactly *"do files changed by A0 overlap files changed by Labour V2?"*

- [ ] **Step 4: Capture a test baseline — by test NAME, not count**

`RequiresPostgres` suites deliberately **throw and report FAILED** when Postgres is unreachable (`RequiresPostgresConnection.cs:74-80` — by design, the 2026-07-19 CI-truthfulness contract), and the solution has a known non-zero failing baseline. So compare, don't demand zero.

⚠️ **Counts are not sufficient.** `baseline 7 failed / final 7 failed` passes while an old failure was fixed and a new regression took its place. Compare **identities**.

```bash
git worktree add ../agrisync-baseline "${A0_BASE}"
cd ../agrisync-baseline
dotnet test src/AgriSync.sln --logger "trx;LogFileName=baseline.trx" -v minimal || true
cd ../agrisync-a0

# Extract failing test names from the baseline TRX
grep -o 'testName="[^"]*"[^>]*outcome="Failed"' \
  ../agrisync-baseline/**/TestResults/baseline.trx 2>/dev/null \
  | sed 's/.*testName="\([^"]*\)".*/\1/' | sort -u > /tmp/a0-baseline-failures.txt
wc -l < /tmp/a0-baseline-failures.txt
```

If the `grep`/`sed` extraction returns nothing, open the TRX and adapt the attribute order — do **not** proceed with an empty baseline set, because an empty baseline makes every later failure look pre-existing.

- [ ] **Step 5: Run the suites and compare failing identities**

```bash
dotnet test src/AgriSync.sln --logger "trx;LogFileName=final.trx" -v minimal || true
grep -o 'testName="[^"]*"[^>]*outcome="Failed"' **/TestResults/final.trx 2>/dev/null \
  | sed 's/.*testName="\([^"]*\)".*/\1/' | sort -u > /tmp/a0-final-failures.txt

echo "=== NEW failures (must be empty) ==="
comm -13 /tmp/a0-baseline-failures.txt /tmp/a0-final-failures.txt

echo "=== Failures FIXED (informational) ==="
comm -23 /tmp/a0-baseline-failures.txt /tmp/a0-final-failures.txt

dotnet test src/tests/AgriSync.ArchitectureTests -v minimal
```

**Gate: the NEW-failures list must be empty.** Record baseline failing names, final failing names, and `new failures = 0` in the report. Counts may be reported alongside, but names are the gate. Architecture tests must be green — A3 touched Application and Api only.

- [ ] **Step 6: Confirm no migration was added**

```bash
git diff --name-only "${A0_BASE}...HEAD" | grep -i "Migrations/" || echo "No migration files touched - correct."
ls src/apps/ShramSafal/ShramSafal.Infrastructure/Persistence/Migrations/*.cs \
  | grep -v Designer | grep -v ModelSnapshot | wc -l
```

Expected: `No migration files touched - correct.` and **101** (unchanged).

- [ ] **Step 7: Confirm the declared file surface matches reality**

```bash
git diff --name-only "${A0_BASE}...HEAD"
```

Expected: exactly the files in §File Structure — including `PushSyncBatchHandler.cs`, `FarmEndpoints.cs`, `AttachmentEndpoints.cs` and `FarmBoundaryRlsRealPostgresTests.cs`, which Revision 1 omitted.

- [ ] **Step 8: Write the three-bucket report**

Append to the design doc under `## Stage A0 Completion Report`:

**Auto-verified** — actual command output: baseline vs final test counts, isolation result and the file count it compared against, migration count, trunk-drift statement.

**Needs founder eyes:**
1. **🔴 LIVE LATENT DEFECT, not introduced here — analytics `actor_role` is `varchar(16)` and `"fpctechnicalmanager"` is 19 chars.** `CreatePlotHandler:115` **already** writes a dynamic lowercase role into that column in production today, so a `FpcTechnicalManager` creating a plot would raise 22001 — the same failure class as the varchar(20) correction ledger. Stage A0 sidesteps it in `IssueFarmInvite` with a bounded 3-way mapping, but does **not** fix the column. Widening needs a migration and a founder decision.
2. **`AcknowledgeSignalHandler:65` and `ResolveSignalHandler:66` are KNOWN REMAINING INSTANCES of the same globally-scoped-role defect** — not merely "out of scope". They write `command.CallerRole`, which carries the same one-role-per-token problem A3 fixes elsewhere. **Stage A0 does NOT globally solve actor-role provenance**, and no report or commit may imply that it does.
3. **Casing is inconsistent and stays that way.** `CreatePlotHandler` writes PascalCase to audit (`:91`) and lowercase to analytics (`:115`) *in the same method*; `CorrectCostEntryHandler:86` is also PascalCase. Not changed — scope creep.
4. **`inviteeRole = Worker`** (`IssueFarmInviteHandler:144`) is true today and becomes false the day invitations carry a role (Stage B).
5. **Any occurrence of `"unknown"` observed in a new audit row.** See the invariant below — it is an anomaly signal, never a normal outcome.
6. Anything the Task 4 Step 1 casing grep surfaced.
7. **A3 diverges from the `CreatePlotHandler` precedent, deliberately and by founder ruling (2026-08-31).** `CreatePlotHandler.cs:59-64` solves the same problem with ONE resolve (its gate *is* the resolve), no `"unknown"` reachable, and PascalCase to audit. A3 uses two resolves, keeps the fallback, and writes lowercase.

   | | `CreatePlotHandler` (in prod) | A3 |
   |---|---|---|
   | Resolver calls | one — gate *is* resolve | two — gate resolves, then A3 resolves again |
   | `"unknown"` | unreachable; null ⇒ `Forbidden` | retained as defensive fallback |
   | Audit casing | PascalCase | lowercase |
   | Command `ActorRole` | left in place, ignored | removed |

   **Founder ruling:** keep A3's shape. Adopting the precedent would mean changing the authorization gates, and *"Stage A0 may improve what history records without changing who is authorised to perform the action."* Consolidation is a future cleanup, not an A0 task. `CorrectCostEntryHandler.cs:52` shares the precedent's shape.
8. **The partial unique index on `farm_memberships` is now LOAD-BEARING for role-provenance determinism.** `GetUserRoleForFarmAsync` (`ShramSafalRepository.cs:69-90`) uses `FirstOrDefaultAsync` with **no `ORDER BY`**. It is deterministic only because `FarmMembershipConfiguration.cs:121-124` guarantees at most one row per `(FarmId, UserId) WHERE status NOT IN (5,6)`. **A future membership migration must not weaken or drop that uniqueness without deliberately revisiting actor-role resolution.** Deliberately NOT pinned by a test in A0 — there is no existing schema-invariant test whose subject is `farm_memberships`, and creating one would be the separate schema workstream the founder excluded.

**Failed / not done** — anything red, with actual error text. If nothing failed, say so explicitly.

- [ ] **Step 9: Commit and STOP**

```bash
git add docs/superpowers/plans/2026-08-30-shared-farm-foundation-STAGE-A-PLAN.md
git commit -m "docs(a0): record Stage A0 completion report"
```

**Do not merge. Do not deploy.** Merge requires founder approval of the needs-founder-eyes bucket.

---

## Definition of Done

- [ ] All 9 tasks complete, committed separately
- [ ] Trunk-drift statement recorded verbatim, and **`A0_BASE` / `LABOUR_BASE` recorded as computed merge-bases** — never a literal `a7784b18` after a rebase
- [ ] `check-labour-v2-isolation.sh` exits 0 against `A0_BASE`, and the recomputed `comm` intersection is empty
- [ ] Zero migration files touched; ssf migration count still **101**
- [ ] **NEW-failing-test-name set is EMPTY** versus the baseline TRX (counts alone are not the gate; absolute green is not achievable)
- [ ] Architecture tests green
- [ ] Changed-file list matches §File Structure exactly
- [ ] Three-bucket report written
- [ ] **Founder Acceptance Gate** — founder has reviewed the needs-founder-eyes bucket
- [ ] **No deploy.** Rides the next routine backend deploy as a passenger.

## Explicitly out of scope

Multi-plot separation (Stage A1) · capture correlation id (Stage A1) · durable worker identity and D15 fields (Stage B) · worker-to-work attribution / Layer C (Stage B) · worker-side confirmation (Stage B extension) · plot-scoped authorization enforcement · widening the analytics `actor_role` column · any change to `feat/labour-v2-r1`.

---

## Revision History

**Revision 3 (2026-08-31)** — founder final hardening, all seven applied:

| # | Hardening | Fix |
|---|---|---|
| 1 | After a rebase, `a7784b18...HEAD` includes unrelated `main` commits, so the isolation gate could report a collision A0 never created | Task 9 Steps 1-3: trunk-drift gate runs **first**; `A0_BASE` and `LABOUR_BASE` are computed with `git merge-base` and used everywhere thereafter |
| 2 | "Same failure count" passes while an old failure is fixed and a new regression replaces it | TRX logger on both runs; gate is the **empty NEW-failing-name set**, counts are informational |
| 3 | `pg_index.indkey` includes `INCLUDE` columns, so `UNIQUE(idempotency_key) INCLUDE(farm_id)` would false-positive | `AND k.ord <= ix.indnkeyatts`; row identity pinned to the actual PK column with a catalog-confirmation step; a 6th theory case forbids a composite business-coordinate PK |
| 4 | Tests could have taught the system that `null → "unknown"` is normal | New "`unknown` is an ANOMALY" section; no test blesses it; every test asserts `AuditEventCount == 1` first; observed `"unknown"` goes in the report |
| 5 | Leaving `IssueFarmInvite` analytics hardcoded knowingly records SecondaryOwner invites as `primaryowner` | **Verified** the authorizer admits only owner-tier (`ShramSafalRepository.cs:94`), so a bounded 3-way mapping (12/14/7 chars) is truthful *and* cannot overflow `varchar(16)` |
| 6 | Discovering mid-Task-4 that a base stub member is not `virtual` would force editing a Labour V2 file | **Pre-verified**: every member is `public virtual` at `a7784b18`. Instruction changed from "make it virtual" to **STOP and report** |
| 7 | `AcknowledgeSignalHandler` / `ResolveSignalHandler` read as merely deferred | Relabelled **known remaining instances of the same defect**, with an explicit "A0 does not globally solve actor-role provenance" clause |

**Revision 2 (2026-08-31)** — after CTO + cross-verifier + test-infrastructure review:

| # | Finding | Fix |
|---|---|---|
| CRITICAL | Removing `ActorRole` silently rebinds positional args at `PushSyncBatchHandler.cs:826` and `:1844`; compiles clean, corrupts the audit ledger on the offline sync path | New **Task 3** converts both to named arguments first, as its own commit. Tasks 5 and 6 now *require* a compiler error there and STOP if absent |
| CRITICAL | The guard read committed history only; every per-task invocation ran pre-commit and passed vacuously | Guard unions committed + staged + unstaged + untracked |
| CRITICAL | The guard covered 17 of 123 Labour V2 files, and the plan told implementers to edit `StubShramSafalRepository.cs`, which Labour V2 also edits | Guard recomputes the file set live from the branch; new `RoleRecordingRepositoryStub.cs` subclasses instead of editing |
| CRITICAL | A3's stated rationale ("a client can tell the server its role") is **false** — the role is server-derived from a signed JWT claim | Rationale corrected to the real defect: the claim is **globally scoped, not farm-scoped** |
| MAJOR | Analytics `actor_role` is `varchar(16)`; `"fpctechnicalmanager"` is 19 chars | `IssueFarmInviteHandler:136` left hardcoded; raised as a founder finding |
| MAJOR | Migration count stated as 100; repo has **101** | Corrected throughout |
| MAJOR | A5 document asserted `DailyLog.EvidenceRefs`, which does not exist | Corrected to `EvidenceSourcesJson` → `evidence_sources`, with a pre-write verification step |
| MAJOR | Declared file surface omitted every forced call site, so the Task 8 check would fail as written | All four added to §File Structure |
| MINOR | `git add -A` + `git reset --hard` would have deleted the guard script it was testing | Working-tree proof, no commit, no reset |
| MINOR | "Runs in a second" — `ApplyAsync` builds four schemas and ~101 migrations, per `[Fact]` | `IClassFixture`, built once |
| MINOR | Predicted failure messages assumed handlers reach the audit write; stub defaults short-circuit them | Stub overrides membership/ownership; tests assert `AuditEventCount == 1` first |
| MINOR | Test factories were one-arg; handlers need 3–4 dependencies | Real constructors documented; existing doubles reused |
| MINOR | `CreateCropCycleCommand` parameter order was wrong in the test | Corrected to the verbatim record order |
| MINOR | Index detection parsed `indexdef` text; a partial index's `WHERE` clause could false-positive | `pg_index`/`pg_attribute` catalog query returning real key columns |
| MINOR | "Flip the assertion and revert" risked shipping an inverted test | `[Theory]` over synthetic column sets |
| MINOR | Absolute suite-green is unachievable | Baseline comparison |
| MINOR | Design doc said "schedule a deploy window" | No deploy; rides the next backend deploy |
| — | Alleged `LabourTimeWindow\.cs` typo | **Verified absent** (`od -c`). No change |
