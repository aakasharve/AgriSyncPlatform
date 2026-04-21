using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Money;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Application.UseCases.Work.VerifyJobCardForPayout;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Work;
using Xunit;

namespace ShramSafal.Domain.Tests.Work.Handlers;

public sealed class VerifyJobCardForPayoutHandlerTests
{
    private static readonly DateTime Now = new(2026, 4, 21, 8, 0, 0, DateTimeKind.Utc);
    private static readonly FarmId FarmId = new(Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"));
    private static readonly Guid PlotGuid = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    private static readonly Guid WorkerGuid = Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc");
    private static readonly UserId WorkerUserId = new(WorkerGuid);
    private static readonly Guid MukadamGuid = Guid.Parse("dddddddd-dddd-dddd-dddd-dddddddddddd");
    private static readonly UserId MukadamUserId = new(MukadamGuid);
    private static readonly Guid AgronomistGuid = Guid.Parse("eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee");
    private static readonly UserId AgronomistUserId = new(AgronomistGuid);

    private static (JobCard job, DailyLog log) BuildCompletedJobCardWithLog(bool logVerified)
    {
        var job = JobCard.CreateDraft(
            Guid.NewGuid(),
            FarmId,
            PlotGuid,
            cropCycleId: null,
            MukadamUserId,
            new DateOnly(2026, 4, 21),
            new[] { new JobCardLineItem("spray", 4m, new Money(50m, Currency.Inr), null) },
            Now);

        job.Assign(WorkerUserId, MukadamUserId, AppRole.Mukadam, Now);
        job.Start(WorkerUserId, Now.AddMinutes(5));

        var log = DailyLog.Create(
            Guid.NewGuid(),
            FarmId,
            PlotGuid,
            Guid.NewGuid(),
            WorkerUserId,
            new DateOnly(2026, 4, 21),
            null, null,
            Now);
        log.AddTask(Guid.NewGuid(), "spray", null, Now);

        job.CompleteWithLog(log.Id, WorkerUserId, Now.AddHours(2));

        if (logVerified)
        {
            // Draft -> Confirmed -> Verified (state machine requires two steps)
            log.Verify(Guid.NewGuid(), VerificationStatus.Confirmed, null, AppRole.Agronomist, AgronomistUserId, Now.AddHours(2));
            log.Verify(Guid.NewGuid(), VerificationStatus.Verified, null, AppRole.Agronomist, AgronomistUserId, Now.AddHours(3));
        }

        return (job, log);
    }

    [Fact]
    public async Task VerifyForPayout_LinkedLogNotVerified_Returns_400()
    {
        var (job, log) = BuildCompletedJobCardWithLog(logVerified: false);
        var repo = new FakeRepo(job, log, AgronomistGuid, AppRole.Agronomist);
        var handler = new VerifyJobCardForPayoutHandler(repo, new FixedClock(Now.AddHours(4)));

        var result = await handler.HandleAsync(new VerifyJobCardForPayoutCommand(
            JobCardId: job.Id,
            CallerUserId: AgronomistUserId,
            ClientCommandId: null));

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Contain("JobCardInvalidState");
    }

    [Fact]
    public async Task VerifyForPayout_LinkedLogVerified_Agronomist_Succeeds()
    {
        var (job, log) = BuildCompletedJobCardWithLog(logVerified: true);
        var repo = new FakeRepo(job, log, AgronomistGuid, AppRole.Agronomist);
        var handler = new VerifyJobCardForPayoutHandler(repo, new FixedClock(Now.AddHours(5)));

        var result = await handler.HandleAsync(new VerifyJobCardForPayoutCommand(
            JobCardId: job.Id,
            CallerUserId: AgronomistUserId,
            ClientCommandId: "verify-001"));

        result.IsSuccess.Should().BeTrue();
        result.Value!.JobCardId.Should().Be(job.Id);
        job.Status.Should().Be(JobCardStatus.VerifiedForPayout);
        repo.AuditEvents.Should().ContainSingle(a => a.Action == "jobcard.verified-for-payout");
    }

    [Fact]
    public async Task VerifyForPayout_Worker_Returns_403()
    {
        var (job, log) = BuildCompletedJobCardWithLog(logVerified: true);
        var repo = new FakeRepo(job, log, WorkerGuid, AppRole.Worker);
        var handler = new VerifyJobCardForPayoutHandler(repo, new FixedClock(Now.AddHours(5)));

        var result = await handler.HandleAsync(new VerifyJobCardForPayoutCommand(
            JobCardId: job.Id,
            CallerUserId: WorkerUserId,
            ClientCommandId: null));

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Contain("JobCardRoleNotAllowed");
    }

    // ─── Test doubles ────────────────────────────────────────────────────────

    private sealed class FixedClock(DateTime utcNow) : IClock
    {
        public DateTime UtcNow { get; } = utcNow;
    }

    private sealed class FakeRepo(JobCard jobCard, DailyLog dailyLog, Guid callerGuid, AppRole callerRole)
        : StubShramSafalRepository
    {
        public List<AuditEvent> AuditEvents { get; } = [];

        public override Task<JobCard?> GetJobCardByIdAsync(Guid jobCardId, CancellationToken ct = default)
            => Task.FromResult<JobCard?>(jobCard.Id == jobCardId ? jobCard : null);

        public override Task<DailyLog?> GetDailyLogByIdAsync(Guid dailyLogId, CancellationToken ct = default)
            => Task.FromResult<DailyLog?>(dailyLog.Id == dailyLogId ? dailyLog : null);

        public override Task<AppRole?> GetUserRoleForFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default)
        {
            if (userId == callerGuid)
                return Task.FromResult<AppRole?>(callerRole);
            return Task.FromResult<AppRole?>(null);
        }

        public override Task AddAuditEventAsync(AuditEvent auditEvent, CancellationToken ct = default)
        {
            AuditEvents.Add(auditEvent);
            return Task.CompletedTask;
        }

        public override Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }
}
