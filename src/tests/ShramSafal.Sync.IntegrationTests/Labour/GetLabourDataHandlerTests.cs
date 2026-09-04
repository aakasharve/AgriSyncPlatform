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
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Labour.GetLabourData;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Work;
using ShramSafal.Infrastructure.Persistence;
using ShramSafal.Infrastructure.Persistence.Repositories;
using Testcontainers.PostgreSql;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Labour;

/// <summary>
/// Task 1.2 (spec: 2026-07-13-labour-attendance-approval-design) — proves the
/// Option-3 wage-book MONEY-CONSISTENCY INVARIANT against REAL Postgres:
/// <list type="bullet">
/// <item>(a) a worker with a <see cref="JobCardStatus.PaidOut"/> JobCard shows
/// <c>Paid</c> == the <c>labour_payout</c> CostEntry amount (the SAME rows
/// <c>GetFinanceSummaryHandler</c> sums).</item>
/// <item>(b) a worker with a Completed-but-unsettled JobCard shows
/// <c>RecordedWages</c> &gt; 0, <c>Paid</c> == 0, and
/// <c>Owed</c> (= RecordedWages − Paid − Advance) == RecordedWages.</item>
/// <item>(c) <c>People</c> ids are unique.</item>
/// <item>(d) a <see cref="VerificationStatus.Verified"/> log is NEVER in
/// <c>Review</c>.</item>
/// </list>
///
/// <para>
/// <b>Docker-gated.</b> <c>[Collection("RequiresDocker")]</c> +
/// <c>[Trait("Category","RequiresDocker")]</c> — the same convention as
/// <c>RowLevelSecurityTests</c> / <c>DwcScoreMatviewTests</c>. Local
/// Docker-less environments (project policy — see
/// <c>feedback_avoid_docker_local_dev</c>) skip this test entirely.
/// <b>No CI workflow runs it (2026-07-19 correction).</b> Every workflow
/// under <c>.github/workflows/</c> that runs the .NET suite explicitly
/// EXCLUDES <c>Category=RequiresDocker</c> (see <c>ci-gate.yml</c> /
/// <c>dotnet-ci.yml</c>'s test-filter step) — there is no "RequiresDocker
/// sweep" anywhere in this repo's CI, contrary to what an earlier version of
/// this comment claimed. Today this test runs ONLY on a machine with Docker
/// installed that explicitly opts in with
/// <c>dotnet test --filter Category=RequiresDocker</c>. The money-consistency
/// invariant below is duplicated as a runnable, always-executed proof in
/// <c>Labour/LabourMoneyInvariantsRealPostgresTests</c>
/// (<c>[Trait("Category","RequiresPostgres")]</c>).
/// </para>
///
/// <para>
/// <b>No TenantConnectionInterceptor.</b> This is a plain read-model proof,
/// not an RLS boundary test (that is <c>RowLevelSecurityTests</c>'s job).
/// The Testcontainers image's bootstrap user is a genuine Postgres
/// superuser, which per Postgres semantics ALWAYS bypasses row security
/// (regardless of <c>FORCE ROW LEVEL SECURITY</c>), so the DbContext here is
/// built without the interceptor and the handler is exercised directly
/// against the real <c>ShramSafalRepository</c>.
/// </para>
/// </summary>
[Collection("RequiresDocker")]
[Trait("Category", "RequiresDocker")]
public sealed class GetLabourDataHandlerTests : IAsyncLifetime
{
#pragma warning disable CS0618 // parameterless PostgreSqlBuilder ctor obsolete in Testcontainers 4.x
    private readonly PostgreSqlContainer _pg = new PostgreSqlBuilder()
        .WithImage("postgres:16-alpine")
        .WithDatabase("agrisync_test")
        .WithUsername("test")
        .WithPassword("test")
        .Build();
#pragma warning restore CS0618

    private ShramSafalDbContext _db = default!;
    private IShramSafalRepository _repository = default!;

    public async Task InitializeAsync()
    {
        await _pg.StartAsync();
        var conn = _pg.GetConnectionString();

        await IntegrationMigrationChain.ApplyAsync(conn);

        var options = new DbContextOptionsBuilder<ShramSafalDbContext>()
            .UseNpgsql(conn, npgsql => npgsql.MigrationsHistoryTable("__ef_migrations", "ssf"))
            .Options;
        _db = new ShramSafalDbContext(options);
        _repository = new ShramSafalRepository(_db);
    }

    public async Task DisposeAsync()
    {
        await _db.DisposeAsync();
        await _pg.DisposeAsync();
    }

    [Fact]
    public async Task Paid_is_finance_consistent_and_distinct_from_recorded_wages()
    {
        var farmId = new FarmId(Guid.NewGuid());
        var ownerUserId = new UserId(Guid.NewGuid());
        var paidWorkerId = new UserId(Guid.NewGuid());
        var unsettledWorkerId = new UserId(Guid.NewGuid());
        var now = DateTime.UtcNow;
        var today = DateOnly.FromDateTime(now);

        var farm = Farm.Create(farmId, "Task 1.2 Proof Farm", ownerUserId, now);
        farm.AttachToOwnerAccount(new OwnerAccountId(Guid.NewGuid()), now);
        await _repository.AddFarmAsync(farm);

        await _repository.AddFarmMembershipAsync(
            FarmMembership.Create(Guid.NewGuid(), farmId, paidWorkerId, AppRole.Worker, now));
        await _repository.AddFarmMembershipAsync(
            FarmMembership.Create(Guid.NewGuid(), farmId, unsettledWorkerId, AppRole.Worker, now));
        await _repository.SaveChangesAsync();

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
        await _repository.AddJobCardAsync(jobCardA);

        var costEntry = CostEntry.CreateLabourPayout(
            costEntryId, jobCardA.Id, farmId, plotId: null, cropCycleId: null,
            amount: 300m, currencyCode: "INR", entryDate: today,
            createdByUserId: ownerUserId, createdAtUtc: now);
        await _repository.AddCostEntryAsync(costEntry);

        // ── Worker B: Completed but NOT yet settled → RecordedWages > 0, Paid == 0. ──
        var jobCardB = JobCard.CreateDraft(
            Guid.NewGuid(), farmId, Guid.NewGuid(), null, ownerUserId, today,
            [new JobCardLineItem("weeding", 4m, new Money(100m, Currency.Inr), null)],
            now);
        jobCardB.Assign(unsettledWorkerId, ownerUserId, AppRole.PrimaryOwner, now);
        jobCardB.Start(unsettledWorkerId, now);
        jobCardB.CompleteWithLog(Guid.NewGuid(), unsettledWorkerId, now);
        await _repository.AddJobCardAsync(jobCardB);

        await _repository.SaveChangesAsync();

        var handler = new GetLabourDataHandler(_repository, new FixedClock(now));
        var result = await handler.HandleAsync(new GetLabourDataQuery(farmId, ownerUserId));

        result.IsSuccess.Should().BeTrue();
        var data = result.Value!;

        data.People.Should().Contain(p => p.Role == "worker");
        data.Dashboard.Should().NotBeNull();

        // (c) People ids are unique — the wire contract is a list; a dup id
        // would collide when the client rebuilds its dict.
        data.People.Select(p => p.Id).Should().OnlyHaveUniqueItems();

        var personA = data.People.Single(p => p.Id == paidWorkerId.Value.ToString());
        var personB = data.People.Single(p => p.Id == unsettledWorkerId.Value.ToString());

        // (a) Paid for the PaidOut worker equals the labour_payout CostEntry amount —
        // the exact same row/method GetFinanceSummaryHandler sums.
        personA.Paid.Should().Be(300m,
            "Paid must be the exact labour_payout CostEntry slice — the same rows the finance page reads");
        personA.RecordedWages.Should().Be(300m,
            "RecordedWages is JobCard.EstimatedTotal for Completed/VerifiedForPayout/PaidOut cards");

        // (b) Completed-but-unsettled worker: RecordedWages > 0, Paid == 0, Owed == RecordedWages.
        personB.RecordedWages.Should().Be(400m);
        personB.Paid.Should().Be(0m);
        (personB.RecordedWages - personB.Paid - personB.Advance).Should().Be(personB.RecordedWages,
            "Owed = RecordedWages - Paid - Advance (derived, never stored); for an unsettled worker Owed == RecordedWages");

        // Dashboard rollups mirror the per-person sums (never re-derived).
        data.Dashboard.Money!.Paid.Should().Be(300m);
        data.Dashboard.Money.Recorded.Should().Be(700m);
        data.Dashboard.Money.Owed.Should().Be(400m);
    }

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
        var farmId = new FarmId(Guid.NewGuid());
        var ownerUserId = new UserId(Guid.NewGuid());
        var workerId = new UserId(Guid.NewGuid());
        var now = DateTime.UtcNow;
        var today = DateOnly.FromDateTime(now);

        var farm = Farm.Create(farmId, "Task 1.2 Departed-Worker Regression Farm", ownerUserId, now);
        farm.AttachToOwnerAccount(new OwnerAccountId(Guid.NewGuid()), now);
        await _repository.AddFarmAsync(farm);

        var membership = FarmMembership.Create(Guid.NewGuid(), farmId, workerId, AppRole.Worker, now);
        await _repository.AddFarmMembershipAsync(membership);
        await _repository.SaveChangesAsync();

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
        await _repository.AddJobCardAsync(jobCard);

        var costEntry = CostEntry.CreateLabourPayout(
            costEntryId, jobCard.Id, farmId, plotId: null, cropCycleId: null,
            amount: 300m, currencyCode: "INR", entryDate: today,
            createdByUserId: ownerUserId, createdAtUtc: now);
        await _repository.AddCostEntryAsync(costEntry);
        await _repository.SaveChangesAsync();

        // Worker then leaves the farm (real domain transition, not a raw
        // status flip) — a paid-then-departed worker is out of Stage-1 scope
        // but must not corrupt the dashboard aggregate.
        membership.Exit(now, isLastActivePrimaryOwner: false);
        await _repository.SaveChangesAsync();

        var handler = new GetLabourDataHandler(_repository, new FixedClock(now));
        var result = await handler.HandleAsync(new GetLabourDataQuery(farmId, ownerUserId));

        result.IsSuccess.Should().BeTrue();
        var data = result.Value!;

        data.Dashboard.Money!.Owed.Should().BeGreaterThanOrEqualTo(0m,
            "a paid-then-departed worker must never drive the dashboard Owed negative");
        data.Dashboard.Money.Paid.Should().Be(data.People.Sum(p => p.Paid),
            "Dashboard.Money.Paid must reconcile with the SAME population as the People rows displayed beneath it");
    }

    [Fact]
    public async Task Verified_log_never_appears_in_review()
    {
        var farmId = new FarmId(Guid.NewGuid());
        var ownerUserId = new UserId(Guid.NewGuid());
        var now = DateTime.UtcNow;

        var farm = Farm.Create(farmId, "Review Proof Farm", ownerUserId, now);
        farm.AttachToOwnerAccount(new OwnerAccountId(Guid.NewGuid()), now);
        await _repository.AddFarmAsync(farm);
        await _repository.SaveChangesAsync();

        // A Draft log — must appear in Review (awaiting the owner).
        var draftLog = DailyLog.Create(
            Guid.NewGuid(), farmId, Guid.NewGuid(), Guid.NewGuid(), ownerUserId,
            DateOnly.FromDateTime(now), idempotencyKey: null, location: null, createdAtUtc: now);
        await _repository.AddDailyLogAsync(draftLog);

        // A fully Verified log (Draft -> Confirmed -> Verified) — must NOT appear in Review.
        var verifiedLog = DailyLog.Create(
            Guid.NewGuid(), farmId, Guid.NewGuid(), Guid.NewGuid(), ownerUserId,
            DateOnly.FromDateTime(now), idempotencyKey: null, location: null, createdAtUtc: now);
        verifiedLog.Verify(Guid.NewGuid(), VerificationStatus.Confirmed, null, AppRole.PrimaryOwner, ownerUserId, now);
        verifiedLog.Verify(Guid.NewGuid(), VerificationStatus.Verified, null, AppRole.PrimaryOwner, ownerUserId, now);
        await _repository.AddDailyLogAsync(verifiedLog);

        await _repository.SaveChangesAsync();

        var handler = new GetLabourDataHandler(_repository, new FixedClock(now));
        var result = await handler.HandleAsync(new GetLabourDataQuery(farmId, ownerUserId));

        result.IsSuccess.Should().BeTrue();

        result.Value!.Review.Should().Contain(r => r.Id == draftLog.Id.ToString(),
            "a Draft log is still awaiting the owner and must surface in Review");
        result.Value!.Review.Should().NotContain(r => r.Id == verifiedLog.Id.ToString(),
            "a Verified log has already been actioned by the owner and must NEVER appear in Review");
        result.Value!.Review.Should().Contain(r => r.Id == draftLog.Id.ToString() && r.Status == "Draft",
            "Task 3.1 (Stage 3): the client needs the log's real status to know whether it must " +
            "send a Draft->Confirmed step before Confirmed->{Verified|Disputed}");
    }

    private sealed class FixedClock(DateTime utcNow) : IClock
    {
        public DateTime UtcNow => utcNow;
    }
}
