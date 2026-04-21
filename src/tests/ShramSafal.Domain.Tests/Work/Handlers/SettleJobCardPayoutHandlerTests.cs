using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Money;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Application.UseCases.Work.SettleJobCardPayout;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Work;
using Xunit;

namespace ShramSafal.Domain.Tests.Work.Handlers;

public sealed class SettleJobCardPayoutHandlerTests
{
    private static readonly DateTime Now = new(2026, 4, 21, 8, 0, 0, DateTimeKind.Utc);
    private static readonly FarmId FarmId = new(Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"));
    private static readonly Guid PlotGuid = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    private static readonly Guid WorkerGuid = Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc");
    private static readonly UserId WorkerUserId = new(WorkerGuid);
    private static readonly Guid MukadamGuid = Guid.Parse("dddddddd-dddd-dddd-dddd-dddddddddddd");
    private static readonly UserId MukadamUserId = new(MukadamGuid);
    private static readonly Guid OwnerGuid = Guid.Parse("ffffffff-ffff-ffff-ffff-ffffffffffff");
    private static readonly UserId OwnerUserId = new(OwnerGuid);
    private static readonly Guid AgronomistGuid = Guid.Parse("eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee");
    private static readonly UserId AgronomistUserId = new(AgronomistGuid);

    private static JobCard BuildVerifiedForPayoutJobCard()
    {
        var job = JobCard.CreateDraft(
            Guid.NewGuid(), FarmId, PlotGuid, null, MukadamUserId,
            new DateOnly(2026, 4, 21),
            new[] { new JobCardLineItem("spray", 4m, new Money(50m, Currency.Inr), null) },
            Now);
        job.Assign(WorkerUserId, MukadamUserId, AppRole.Mukadam, Now);
        job.Start(WorkerUserId, Now.AddMinutes(5));

        var log = DailyLog.Create(
            Guid.NewGuid(), FarmId, PlotGuid, Guid.NewGuid(),
            WorkerUserId, new DateOnly(2026, 4, 21), null, null, Now);
        log.AddTask(Guid.NewGuid(), "spray", null, Now);
        // Draft -> Confirmed -> Verified (two-step state machine)
        log.Verify(Guid.NewGuid(), VerificationStatus.Confirmed, null, AppRole.Agronomist, AgronomistUserId, Now.AddMinutes(30));
        log.Verify(Guid.NewGuid(), VerificationStatus.Verified, null, AppRole.Agronomist, AgronomistUserId, Now.AddHours(1));

        job.CompleteWithLog(log.Id, WorkerUserId, Now.AddHours(2));
        job.MarkVerifiedForPayout(VerificationStatus.Verified, AgronomistUserId, AppRole.Agronomist, Now.AddHours(3));
        return job;
    }

    [Fact]
    public async Task Settle_WhenJobCardNotVerifiedForPayout_Returns_400()
    {
        // Build a Completed (not VerifiedForPayout) job card.
        var job = JobCard.CreateDraft(
            Guid.NewGuid(), FarmId, PlotGuid, null, MukadamUserId,
            new DateOnly(2026, 4, 21),
            new[] { new JobCardLineItem("spray", 4m, new Money(50m, Currency.Inr), null) },
            Now);
        job.Assign(WorkerUserId, MukadamUserId, AppRole.Mukadam, Now);
        var log = DailyLog.Create(Guid.NewGuid(), FarmId, PlotGuid, Guid.NewGuid(), WorkerUserId, new DateOnly(2026, 4, 21), null, null, Now);
        log.AddTask(Guid.NewGuid(), "spray", null, Now);
        job.CompleteWithLog(log.Id, WorkerUserId, Now.AddHours(2));
        // Status is Completed, not VerifiedForPayout.

        var repo = new FakeRepo(job, OwnerGuid, AppRole.PrimaryOwner);
        var handler = new SettleJobCardPayoutHandler(repo, new SeqIdGen(), new FixedClock(Now.AddHours(4)));

        var result = await handler.HandleAsync(new SettleJobCardPayoutCommand(
            JobCardId: job.Id, ActualPayoutAmount: 200m, ActualPayoutCurrencyCode: "INR",
            SettlementNote: null, CallerUserId: OwnerUserId, ClientCommandId: null));

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Contain("JobCardInvalidState");
    }

    [Fact]
    public async Task Settle_ByMukadam_Returns_403()
    {
        var job = BuildVerifiedForPayoutJobCard();
        var repo = new FakeRepo(job, MukadamGuid, AppRole.Mukadam);
        var handler = new SettleJobCardPayoutHandler(repo, new SeqIdGen(), new FixedClock(Now.AddHours(4)));

        var result = await handler.HandleAsync(new SettleJobCardPayoutCommand(
            JobCardId: job.Id, ActualPayoutAmount: 200m, ActualPayoutCurrencyCode: "INR",
            SettlementNote: null, CallerUserId: MukadamUserId, ClientCommandId: null));

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Contain("JobCardRoleNotAllowed");
    }

    [Fact]
    public async Task Settle_HappyPath_CreatesCostEntry_AndTransitionsJobCard()
    {
        var job = BuildVerifiedForPayoutJobCard();
        var repo = new FakeRepo(job, OwnerGuid, AppRole.PrimaryOwner);
        var handler = new SettleJobCardPayoutHandler(repo, new SeqIdGen(), new FixedClock(Now.AddHours(4)));

        var result = await handler.HandleAsync(new SettleJobCardPayoutCommand(
            JobCardId: job.Id, ActualPayoutAmount: 250m, ActualPayoutCurrencyCode: "INR",
            SettlementNote: null, CallerUserId: OwnerUserId, ClientCommandId: "settle-001"));

        result.IsSuccess.Should().BeTrue();
        result.Value!.JobCardStatus.Should().Be(JobCardStatus.PaidOut);
        result.Value.CostEntryId.Should().NotBeEmpty();
        job.Status.Should().Be(JobCardStatus.PaidOut);
        job.PayoutCostEntryId.Should().Be(result.Value.CostEntryId);
        repo.AddedCostEntries.Should().ContainSingle(c => c.Category == "labour_payout" && c.Amount == 250m);
        repo.AuditEvents.Should().ContainSingle(a => a.Action == "jobcard.paid-out");
    }

    [Fact]
    public async Task Settle_Idempotent_ByClientCommandId()
    {
        // Two calls with same clientCommandId. Second call should fail (card already PaidOut).
        var job = BuildVerifiedForPayoutJobCard();
        var repo = new FakeRepo(job, OwnerGuid, AppRole.PrimaryOwner);
        var handler = new SettleJobCardPayoutHandler(repo, new SeqIdGen(), new FixedClock(Now.AddHours(4)));

        var first = await handler.HandleAsync(new SettleJobCardPayoutCommand(
            JobCardId: job.Id, ActualPayoutAmount: 250m, ActualPayoutCurrencyCode: "INR",
            SettlementNote: null, CallerUserId: OwnerUserId, ClientCommandId: "settle-001"));

        first.IsSuccess.Should().BeTrue();

        // Simulating a second attempt — job is already PaidOut.
        var second = await handler.HandleAsync(new SettleJobCardPayoutCommand(
            JobCardId: job.Id, ActualPayoutAmount: 250m, ActualPayoutCurrencyCode: "INR",
            SettlementNote: null, CallerUserId: OwnerUserId, ClientCommandId: "settle-001"));

        second.IsFailure.Should().BeTrue();
        second.Error.Code.Should().Contain("JobCardInvalidState");
    }

    // ─── Test doubles ────────────────────────────────────────────────────────

    private sealed class FixedClock(DateTime utcNow) : IClock
    {
        public DateTime UtcNow { get; } = utcNow;
    }

    private sealed class SeqIdGen : IIdGenerator
    {
        public Guid New() => Guid.NewGuid();
    }

    private sealed class FakeRepo(JobCard jobCard, Guid callerGuid, AppRole callerRole)
        : StubShramSafalRepository
    {
        public List<CostEntry> AddedCostEntries { get; } = [];
        public List<AuditEvent> AuditEvents { get; } = [];

        public override Task<JobCard?> GetJobCardByIdAsync(Guid jobCardId, CancellationToken ct = default)
            => Task.FromResult<JobCard?>(jobCard.Id == jobCardId ? jobCard : null);

        public override Task<AppRole?> GetUserRoleForFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default)
        {
            if (userId == callerGuid)
                return Task.FromResult<AppRole?>(callerRole);
            return Task.FromResult<AppRole?>(null);
        }

        public override Task AddCostEntryAsync(CostEntry costEntry, CancellationToken ct = default)
        {
            AddedCostEntries.Add(costEntry);
            return Task.CompletedTask;
        }

        public override Task AddAuditEventAsync(AuditEvent auditEvent, CancellationToken ct = default)
        {
            AuditEvents.Add(auditEvent);
            return Task.CompletedTask;
        }

        public override Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }
}
