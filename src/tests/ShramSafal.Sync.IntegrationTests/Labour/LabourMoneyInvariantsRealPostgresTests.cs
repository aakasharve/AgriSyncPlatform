// spec: 2026-07-13-labour-attendance-approval-design
using System;
using System.Linq;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Money;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using ShramSafal.Application.UseCases.Labour.GetLabourData;
using ShramSafal.Domain.AI;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Work;
using ShramSafal.Infrastructure.Persistence;
using ShramSafal.Infrastructure.Persistence.Repositories;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Labour;

/// <summary>
/// 2026-07-19 CI-truthfulness fix (Phase 2, spec:
/// 2026-07-13-labour-attendance-approval-design) — a runnable home for the
/// four money assertions that previously lived ONLY inside
/// <c>[Trait("Category","RequiresDocker")]</c> files
/// (<c>GetLabourDataHandlerTests</c>, <c>LedgerDerivationLabourTests</c>).
/// No CI workflow in this repo ever runs <c>Category=RequiresDocker</c> (both
/// <c>ci-gate.yml</c> and <c>dotnet-ci.yml</c> explicitly exclude it), so
/// those four assertions were asserted, never proved, on every CI run. This
/// suite ports them byte-for-byte (same expected values, same reasons, no
/// assertion weakened) into the <c>RequiresPostgres</c> category, which DOES
/// run in CI (see <see cref="RequiresPostgresConnection"/>) and now FAILS —
/// never silently passes — if it cannot reach Postgres.
///
/// <para>
/// The four assertions, and which original [Fact] each is lifted from:
/// <list type="number">
/// <item><b>Paid == the exact <c>labour_payout</c> CostEntry amount</b> — the
/// same rows <c>GetFinanceSummaryHandler</c> sums — from
/// <c>GetLabourDataHandlerTests.Paid_is_finance_consistent_and_distinct_from_recorded_wages</c>.</item>
/// <item><b>Owed = RecordedWages − Paid − Advance</b> for a Completed-but-
/// unsettled worker — same origin fact.</item>
/// <item><b>Dashboard.Money.Owed never goes negative</b> when a paid worker
/// later departs the farm — from
/// <c>GetLabourDataHandlerTests.Dashboard_owed_never_goes_negative_when_a_paid_worker_departs</c>
/// (the money regression the code review caught: totalRecorded summed over
/// the Active roster while totalPaid summed over ALL paid workers).</item>
/// <item><b>NO-MULTIPLY — TotalCost stays NULL</b> when only <c>rate</c> is
/// spoken (never a fabricated <c>rate × count</c>) — from
/// <c>LedgerDerivationLabourTests.No_multiply_total_cost_stays_null_when_only_rate_is_stated</c>.</item>
/// </list>
/// </para>
///
/// <para>
/// <b>Plain read-model proof, not an RLS boundary test</b> (that is
/// <c>Security/RowLevelSecurityTests</c>'s job) — mirrors the original
/// Docker-gated files' own framing: the scratch DB is reached as the
/// migration superuser, so <c>GetLabourDataHandler</c> /
/// <c>LedgerDerivationService</c> are exercised directly against the real
/// <c>ShramSafalRepository</c> without a tenant-scope interceptor in the way.
/// </para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class LabourMoneyInvariantsRealPostgresTests : IAsyncLifetime
{
    private string _superuserConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private string _adminConn = string.Empty;

    public async Task InitializeAsync()
    {
        // Throws (does not skip) if Postgres is unconfigured/unreachable — see
        // RequiresPostgresConnection's doc comment for the 2026-07-19
        // CI-truthfulness fix this enforces.
        var baseConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();
        _adminConn = baseConn;

        _scratchDbName = $"ssf_labourmoney_proof_{Guid.NewGuid():N}";
        await using (var admin = new NpgsqlConnection(baseConn))
        {
            await admin.OpenAsync();
            await using var create = admin.CreateCommand();
            create.CommandText = $"CREATE DATABASE \"{_scratchDbName}\"";
            await create.ExecuteNonQueryAsync();
        }

        _superuserConn = new NpgsqlConnectionStringBuilder(baseConn) { Database = _scratchDbName }.ConnectionString;

        await IntegrationMigrationChain.ApplyAsync(_superuserConn);
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

    private ShramSafalDbContext NewDbContext()
    {
        var options = new DbContextOptionsBuilder<ShramSafalDbContext>()
            .UseNpgsql(_superuserConn, npgsql => npgsql.MigrationsHistoryTable("__ef_migrations", "ssf"))
            .Options;
        return new ShramSafalDbContext(options);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MONEY ASSERTIONS 1 + 2 — ported from
    // GetLabourDataHandlerTests.Paid_is_finance_consistent_and_distinct_from_recorded_wages.
    // ─────────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task Paid_is_finance_consistent_and_distinct_from_recorded_wages()
    {
        await using var db = NewDbContext();
        var repository = new ShramSafalRepository(db);

        var farmId = new FarmId(Guid.NewGuid());
        var ownerUserId = new UserId(Guid.NewGuid());
        var paidWorkerId = new UserId(Guid.NewGuid());
        var unsettledWorkerId = new UserId(Guid.NewGuid());
        var now = DateTime.UtcNow;
        var today = DateOnly.FromDateTime(now);

        var farm = Farm.Create(farmId, "Money-Invariant Proof Farm", ownerUserId, now);
        farm.AttachToOwnerAccount(new OwnerAccountId(Guid.NewGuid()), now);
        await repository.AddFarmAsync(farm);

        await repository.AddFarmMembershipAsync(
            FarmMembership.Create(Guid.NewGuid(), farmId, paidWorkerId, AppRole.Worker, now));
        await repository.AddFarmMembershipAsync(
            FarmMembership.Create(Guid.NewGuid(), farmId, unsettledWorkerId, AppRole.Worker, now));
        await repository.SaveChangesAsync();

        // ── Worker A: PaidOut JobCard → Paid must equal the CostEntry amount. ──
        var jobCardA = JobCard.CreateDraft(
            Guid.NewGuid(), farmId, Guid.NewGuid(), null, ownerUserId, today,
            [new JobCardLineItem("spray", 2m, new Money(150m, Currency.Inr), null)],
            now);
        jobCardA.Assign(paidWorkerId, ownerUserId, AppRole.PrimaryOwner, now);
        jobCardA.Start(paidWorkerId, now);
        jobCardA.CompleteWithLog(Guid.NewGuid(), paidWorkerId, now);
        jobCardA.MarkVerifiedForPayout(VerificationStatus.Verified, ownerUserId, AppRole.PrimaryOwner, now);
        var costEntryId = Guid.NewGuid();
        jobCardA.MarkPaidOut(costEntryId, new Money(300m, Currency.Inr), now);
        await repository.AddJobCardAsync(jobCardA);

        var costEntry = CostEntry.CreateLabourPayout(
            costEntryId, jobCardA.Id, farmId, plotId: null, cropCycleId: null,
            amount: 300m, currencyCode: "INR", entryDate: today,
            createdByUserId: ownerUserId, createdAtUtc: now);
        await repository.AddCostEntryAsync(costEntry);

        // ── Worker B: Completed but NOT yet settled → RecordedWages > 0, Paid == 0. ──
        var jobCardB = JobCard.CreateDraft(
            Guid.NewGuid(), farmId, Guid.NewGuid(), null, ownerUserId, today,
            [new JobCardLineItem("weeding", 4m, new Money(100m, Currency.Inr), null)],
            now);
        jobCardB.Assign(unsettledWorkerId, ownerUserId, AppRole.PrimaryOwner, now);
        jobCardB.Start(unsettledWorkerId, now);
        jobCardB.CompleteWithLog(Guid.NewGuid(), unsettledWorkerId, now);
        await repository.AddJobCardAsync(jobCardB);

        await repository.SaveChangesAsync();

        var handler = new GetLabourDataHandler(repository, new FixedClock(now));
        var result = await handler.HandleAsync(new GetLabourDataQuery(farmId, ownerUserId));

        result.IsSuccess.Should().BeTrue();
        var data = result.Value!;

        data.People.Should().Contain(p => p.Role == "worker");
        data.Dashboard.Should().NotBeNull();
        data.People.Select(p => p.Id).Should().OnlyHaveUniqueItems();

        var personA = data.People.Single(p => p.Id == paidWorkerId.Value.ToString());
        var personB = data.People.Single(p => p.Id == unsettledWorkerId.Value.ToString());

        // MONEY ASSERTION 1 — Paid for the PaidOut worker equals the exact
        // labour_payout CostEntry amount — the same row/method
        // GetFinanceSummaryHandler sums.
        personA.Paid.Should().Be(300m,
            "Paid must be the exact labour_payout CostEntry slice — the same rows the finance page reads");
        personA.RecordedWages.Should().Be(300m,
            "RecordedWages is JobCard.EstimatedTotal for Completed/VerifiedForPayout/PaidOut cards");

        // MONEY ASSERTION 2 — Owed = RecordedWages - Paid - Advance for an
        // unsettled worker; Owed must equal RecordedWages when Paid/Advance
        // are both zero.
        personB.RecordedWages.Should().Be(400m);
        personB.Paid.Should().Be(0m);
        (personB.RecordedWages - personB.Paid - personB.Advance).Should().Be(personB.RecordedWages,
            "Owed = RecordedWages - Paid - Advance (derived, never stored); for an unsettled worker Owed == RecordedWages");

        // Dashboard rollups mirror the per-person sums (never re-derived).
        data.Dashboard.Money.Paid.Should().Be(300m);
        data.Dashboard.Money.Recorded.Should().Be(700m);
        data.Dashboard.Money.Owed.Should().Be(400m);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MONEY ASSERTION 3 — ported from
    // GetLabourDataHandlerTests.Dashboard_owed_never_goes_negative_when_a_paid_worker_departs.
    // ─────────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task Dashboard_owed_never_goes_negative_when_a_paid_worker_departs()
    {
        // Regression for the money bug found in code review: totalRecorded was
        // summed over `people` (Active-roster only) while totalPaid was summed
        // over the raw paidByWorker dictionary (ALL workers with payouts, no
        // membership filter). A worker who is paid, then exits/suspends, used
        // to drop out of Recorded but stay in Paid — driving
        // Dashboard.Money.Owed negative even though every row shown on screen
        // still reconciled. Both totals must now come from the SAME `people`
        // population.
        await using var db = NewDbContext();
        var repository = new ShramSafalRepository(db);

        var farmId = new FarmId(Guid.NewGuid());
        var ownerUserId = new UserId(Guid.NewGuid());
        var workerId = new UserId(Guid.NewGuid());
        var now = DateTime.UtcNow;
        var today = DateOnly.FromDateTime(now);

        var farm = Farm.Create(farmId, "Money-Invariant Departed-Worker Regression Farm", ownerUserId, now);
        farm.AttachToOwnerAccount(new OwnerAccountId(Guid.NewGuid()), now);
        await repository.AddFarmAsync(farm);

        var membership = FarmMembership.Create(Guid.NewGuid(), farmId, workerId, AppRole.Worker, now);
        await repository.AddFarmMembershipAsync(membership);
        await repository.SaveChangesAsync();

        // Worker is paid out while still Active: PaidOut JobCard (EstimatedTotal
        // 300) + matching labour_payout CostEntry (300).
        var jobCard = JobCard.CreateDraft(
            Guid.NewGuid(), farmId, Guid.NewGuid(), null, ownerUserId, today,
            [new JobCardLineItem("spray", 2m, new Money(150m, Currency.Inr), null)],
            now);
        jobCard.Assign(workerId, ownerUserId, AppRole.PrimaryOwner, now);
        jobCard.Start(workerId, now);
        jobCard.CompleteWithLog(Guid.NewGuid(), workerId, now);
        jobCard.MarkVerifiedForPayout(VerificationStatus.Verified, ownerUserId, AppRole.PrimaryOwner, now);
        var costEntryId = Guid.NewGuid();
        jobCard.MarkPaidOut(costEntryId, new Money(300m, Currency.Inr), now);
        await repository.AddJobCardAsync(jobCard);

        var costEntry = CostEntry.CreateLabourPayout(
            costEntryId, jobCard.Id, farmId, plotId: null, cropCycleId: null,
            amount: 300m, currencyCode: "INR", entryDate: today,
            createdByUserId: ownerUserId, createdAtUtc: now);
        await repository.AddCostEntryAsync(costEntry);
        await repository.SaveChangesAsync();

        // Worker then leaves the farm (real domain transition, not a raw
        // status flip) — a paid-then-departed worker is out of Stage-1 scope
        // but must not corrupt the dashboard aggregate.
        membership.Exit(now, isLastActivePrimaryOwner: false);
        await repository.SaveChangesAsync();

        var handler = new GetLabourDataHandler(repository, new FixedClock(now));
        var result = await handler.HandleAsync(new GetLabourDataQuery(farmId, ownerUserId));

        result.IsSuccess.Should().BeTrue();
        var data = result.Value!;

        // MONEY ASSERTION 3 — Owed must never go negative, and Paid must
        // reconcile with the SAME population as the People rows displayed.
        data.Dashboard.Money.Owed.Should().BeGreaterThanOrEqualTo(0m,
            "a paid-then-departed worker must never drive the dashboard Owed negative");
        data.Dashboard.Money.Paid.Should().Be(data.People.Sum(p => p.Paid),
            "Dashboard.Money.Paid must reconcile with the SAME population as the People rows displayed beneath it");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // MONEY ASSERTION 4 (NO-MULTIPLY) — ported from
    // LedgerDerivationLabourTests.No_multiply_total_cost_stays_null_when_only_rate_is_stated.
    // ─────────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task No_multiply_total_cost_stays_null_when_only_rate_is_stated()
    {
        // Money guard: rate=50, count=4 — 4*50=200 must NEVER appear as TotalCost.
        // No totalCost key at all in the JSON.
        const string normalizedJson = """
        {
          "labour": [
            { "count": 4, "rate": 50 }
          ]
        }
        """;

        var logId = await DeriveSingleLabourAssignmentAsync(normalizedJson);

        await using var readDb = NewDbContext();
        var assignment = await readDb.LabourAssignments.SingleAsync(a => a.DailyLogId == logId);

        assignment.WorkerCount.Should().Be(4);
        assignment.WagePerPerson.Should().Be(50m);
        assignment.TotalCost.Should().BeNull(
            "NO-MULTIPLY (D3): totalCost was never stated, so it must stay NULL — never a fabricated rate*count");
    }

    // Runs the REAL LedgerDerivationService against a voice AiJob carrying the
    // given labour[] JSON, persists the derived LabourAssignment to real
    // Postgres, and returns the parent DailyLog id so the caller can re-read
    // via a FRESH DbContext (proves an actual database round-trip, not EF's
    // first-level identity map).
    private async Task<Guid> DeriveSingleLabourAssignmentAsync(string normalizedResultJson)
    {
        var farmGuid = Guid.NewGuid();
        var ownerGuid = Guid.NewGuid();
        var farmId = new FarmId(farmGuid);
        var ownerUserId = new UserId(ownerGuid);
        var now = DateTime.UtcNow;
        var logId = Guid.NewGuid();

        await using var writeDb = NewDbContext();
        var writeRepo = new ShramSafalRepository(writeDb);

        var farm = Farm.Create(farmId, "Money-Invariant Derivation Proof Farm", ownerUserId, now);
        farm.AttachToOwnerAccount(new OwnerAccountId(Guid.NewGuid()), now);
        await writeRepo.AddFarmAsync(farm);

        var log = DailyLog.Create(
            logId, farmId, Guid.NewGuid(), Guid.NewGuid(), ownerUserId,
            DateOnly.FromDateTime(now), idempotencyKey: null, location: null, createdAtUtc: now);
        await writeRepo.AddDailyLogAsync(log);

        var job = AiJob.Create(
            id: Guid.NewGuid(),
            idempotencyKey: $"voice-key-{Guid.NewGuid():N}",
            operationType: AiOperationType.VoiceToStructuredLog,
            userId: ownerGuid,
            farmId: farmGuid,
            inputContentHash: null,
            rawInputRef: null,
            inputSessionMetadataJson: null,
            provenance: new Provenance(
                source: Source.Voice,
                modelVersion: "gemini-2.5-flash",
                promptVersion: "v3.2.0",
                promptContentHash: null,
                appVersion: "1.0.0"));
        var attempt = job.AddAttempt(AiProviderType.Gemini);
        job.MarkSucceeded(normalizedResultJson, attempt);

        var sut = new ShramSafal.Application.UseCases.Logs.CreateDailyLog.LedgerDerivationService(writeRepo);
        await sut.DeriveAsync(log, job, new GuidIdGenerator(), new SystemClock());

        await writeRepo.SaveChangesAsync();

        return logId;
    }

    private sealed class FixedClock(DateTime utcNow) : IClock
    {
        public DateTime UtcNow => utcNow;
    }
}
