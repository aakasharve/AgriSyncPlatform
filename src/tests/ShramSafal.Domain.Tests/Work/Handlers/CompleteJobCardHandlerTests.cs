using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Money;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Application.UseCases.Work.CompleteJobCard;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Work;
using Xunit;

namespace ShramSafal.Domain.Tests.Work.Handlers;

public sealed class CompleteJobCardHandlerTests
{
    private static readonly DateTime Now = new(2026, 4, 21, 8, 0, 0, DateTimeKind.Utc);
    private static readonly FarmId FarmId = new(Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"));
    private static readonly FarmId OtherFarmId = new(Guid.Parse("eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"));
    private static readonly Guid PlotGuid = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    private static readonly Guid OtherPlotGuid = Guid.Parse("ffffffff-ffff-ffff-ffff-ffffffffffff");
    private static readonly Guid WorkerGuid = Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc");
    private static readonly UserId WorkerUserId = new(WorkerGuid);
    private static readonly Guid MukadamGuid = Guid.Parse("dddddddd-dddd-dddd-dddd-dddddddddddd");
    private static readonly UserId MukadamUserId = new(MukadamGuid);

    private static JobCard BuildInProgressJobCard()
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
        return job;
    }

    private static DailyLog BuildDailyLog(FarmId farmId, Guid plotId, string activityType)
    {
        var log = DailyLog.Create(
            Guid.NewGuid(),
            farmId,
            plotId,
            Guid.NewGuid(), // cropCycleId
            WorkerUserId,
            new DateOnly(2026, 4, 21),
            null, null,
            Now);

        log.AddTask(Guid.NewGuid(), activityType, null, Now);
        return log;
    }

    [Fact]
    public async Task CompleteJobCard_WithMismatchingDailyLog_Returns_400()
    {
        var job = BuildInProgressJobCard();
        // Daily log belongs to a different farm
        var mismatchLog = BuildDailyLog(OtherFarmId, PlotGuid, "spray");
        var repo = new FakeRepo(job, mismatchLog);
        var handler = new CompleteJobCardHandler(repo, new FixedClock(Now.AddHours(4)));

        var result = await handler.HandleAsync(new CompleteJobCardCommand(
            JobCardId: job.Id,
            DailyLogId: mismatchLog.Id,
            CallerUserId: WorkerUserId,
            ClientCommandId: null));

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Contain("JobCardDailyLogMismatch");
    }

    [Fact]
    public async Task CompleteJobCard_ActivityTypeMismatch_Returns_400()
    {
        var job = BuildInProgressJobCard(); // job has "spray"
        var logWithDifferentActivity = BuildDailyLog(FarmId, PlotGuid, "harvesting"); // daily log has "harvesting"
        var repo = new FakeRepo(job, logWithDifferentActivity);
        var handler = new CompleteJobCardHandler(repo, new FixedClock(Now.AddHours(4)));

        var result = await handler.HandleAsync(new CompleteJobCardCommand(
            JobCardId: job.Id,
            DailyLogId: logWithDifferentActivity.Id,
            CallerUserId: WorkerUserId,
            ClientCommandId: null));

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Contain("JobCardActivityTypeMismatch");
    }

    [Fact]
    public async Task CompleteJobCard_HappyPath_LinksAndAudits()
    {
        var job = BuildInProgressJobCard(); // job has "spray"
        var validLog = BuildDailyLog(FarmId, PlotGuid, "spray"); // same activity
        var repo = new FakeRepo(job, validLog);
        var handler = new CompleteJobCardHandler(repo, new FixedClock(Now.AddHours(4)));

        var result = await handler.HandleAsync(new CompleteJobCardCommand(
            JobCardId: job.Id,
            DailyLogId: validLog.Id,
            CallerUserId: WorkerUserId,
            ClientCommandId: "complete-001"));

        result.IsSuccess.Should().BeTrue();
        result.Value!.LinkedDailyLogId.Should().Be(validLog.Id);
        job.Status.Should().Be(JobCardStatus.Completed);
        job.LinkedDailyLogId.Should().Be(validLog.Id);
        repo.AuditEvents.Should().ContainSingle(a => a.Action == "jobcard.completed");
    }

    // ─── Test doubles ────────────────────────────────────────────────────────

    private sealed class FixedClock(DateTime utcNow) : IClock
    {
        public DateTime UtcNow { get; } = utcNow;
    }

    private sealed class FakeRepo(JobCard jobCard, DailyLog dailyLog) : StubShramSafalRepository
    {
        public List<AuditEvent> AuditEvents { get; } = [];

        public override Task<JobCard?> GetJobCardByIdAsync(Guid jobCardId, CancellationToken ct = default)
            => Task.FromResult<JobCard?>(jobCard.Id == jobCardId ? jobCard : null);

        public override Task<DailyLog?> GetDailyLogByIdAsync(Guid dailyLogId, CancellationToken ct = default)
            => Task.FromResult<DailyLog?>(dailyLog.Id == dailyLogId ? dailyLog : null);

        public override Task AddAuditEventAsync(AuditEvent auditEvent, CancellationToken ct = default)
        {
            AuditEvents.Add(auditEvent);
            return Task.CompletedTask;
        }

        public override Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }
}
