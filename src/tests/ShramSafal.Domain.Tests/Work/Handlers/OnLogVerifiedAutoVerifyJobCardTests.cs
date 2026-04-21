using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Money;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Work.Handlers;
using ShramSafal.Application.UseCases.Work.VerifyJobCardForPayout;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Work;
using Xunit;

namespace ShramSafal.Domain.Tests.Work.Handlers;

public sealed class OnLogVerifiedAutoVerifyJobCardTests
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

    private static (JobCard job, DailyLog log) BuildCompletedJobCardAndVerifiedLog()
    {
        var log = DailyLog.Create(Guid.NewGuid(), FarmId, PlotGuid, Guid.NewGuid(), WorkerUserId, new DateOnly(2026, 4, 21), null, null, Now);
        log.AddTask(Guid.NewGuid(), "spray", null, Now);
        // Draft -> Confirmed -> Verified
        log.Verify(Guid.NewGuid(), VerificationStatus.Confirmed, null, AppRole.Agronomist, AgronomistUserId, Now.AddMinutes(30));
        log.Verify(Guid.NewGuid(), VerificationStatus.Verified, null, AppRole.Agronomist, AgronomistUserId, Now.AddHours(1));

        var job = JobCard.CreateDraft(
            Guid.NewGuid(), FarmId, PlotGuid, null, MukadamUserId,
            new DateOnly(2026, 4, 21),
            new[] { new JobCardLineItem("spray", 4m, new Money(50m, Currency.Inr), null) },
            Now);
        job.Assign(WorkerUserId, MukadamUserId, AppRole.Mukadam, Now);
        job.Start(WorkerUserId, Now.AddMinutes(5));
        job.CompleteWithLog(log.Id, WorkerUserId, Now.AddHours(2));

        return (job, log);
    }

    [Fact]
    public async Task OnLogVerified_WithLinkedJobCard_AutoTransitionsToVerifiedForPayout()
    {
        var (job, log) = BuildCompletedJobCardAndVerifiedLog();
        var repo = new FakeAutoVerifyRepo(job, log, AgronomistGuid, AppRole.Agronomist);
        var verifyHandler = new VerifyJobCardForPayoutHandler(repo, new FixedClock(Now.AddHours(3)));
        var handler = new OnLogVerifiedAutoVerifyJobCard(
            repo, verifyHandler, new FixedClock(Now.AddHours(3)),
            NullLogger<OnLogVerifiedAutoVerifyJobCard>.Instance);

        await handler.HandleAsync(log.Id, VerificationStatus.Verified, AgronomistUserId);

        job.Status.Should().Be(JobCardStatus.VerifiedForPayout);
    }

    [Fact]
    public async Task OnLogVerified_WithoutLinkedJobCard_IsNoOp()
    {
        var repo = new FakeAutoVerifyRepo(null, null, AgronomistGuid, AppRole.Agronomist);
        var verifyHandler = new VerifyJobCardForPayoutHandler(repo, new FixedClock(Now.AddHours(3)));
        var handler = new OnLogVerifiedAutoVerifyJobCard(
            repo, verifyHandler, new FixedClock(Now.AddHours(3)),
            NullLogger<OnLogVerifiedAutoVerifyJobCard>.Instance);

        // Should not throw; returns without error.
        var act = () => handler.HandleAsync(Guid.NewGuid(), VerificationStatus.Verified, AgronomistUserId);
        await act.Should().NotThrowAsync();
    }

    [Fact]
    public async Task OnLogEdit_FromVerified_DeauthorizesJobCardPayout()
    {
        var (job, log) = BuildCompletedJobCardAndVerifiedLog();
        // First, put job card in VerifiedForPayout
        job.MarkVerifiedForPayout(VerificationStatus.Verified, AgronomistUserId, AppRole.Agronomist, Now.AddHours(3));
        job.Status.Should().Be(JobCardStatus.VerifiedForPayout);

        var repo = new FakeAutoVerifyRepo(job, log, AgronomistGuid, AppRole.Agronomist);
        var verifyHandler = new VerifyJobCardForPayoutHandler(repo, new FixedClock(Now.AddHours(4)));
        var handler = new OnLogVerifiedAutoVerifyJobCard(
            repo, verifyHandler, new FixedClock(Now.AddHours(4)),
            NullLogger<OnLogVerifiedAutoVerifyJobCard>.Instance);

        // Log transitioned from Verified to Disputed (de-verify)
        await handler.HandleAsync(log.Id, VerificationStatus.Disputed, AgronomistUserId);

        job.Status.Should().Be(JobCardStatus.Completed);
    }

    [Fact]
    public async Task OnLogEdit_JobCardAlreadyPaidOut_DoesNotThrow_LogsWarning()
    {
        var (job, log) = BuildCompletedJobCardAndVerifiedLog();
        // Put job card all the way to PaidOut
        job.MarkVerifiedForPayout(VerificationStatus.Verified, AgronomistUserId, AppRole.Agronomist, Now.AddHours(3));
        job.MarkPaidOut(Guid.NewGuid(), new Money(200m, Currency.Inr), Now.AddHours(4));
        job.Status.Should().Be(JobCardStatus.PaidOut);

        var repo = new FakeAutoVerifyRepo(job, log, AgronomistGuid, AppRole.Agronomist);
        var verifyHandler = new VerifyJobCardForPayoutHandler(repo, new FixedClock(Now.AddHours(5)));
        var handler = new OnLogVerifiedAutoVerifyJobCard(
            repo, verifyHandler, new FixedClock(Now.AddHours(5)),
            NullLogger<OnLogVerifiedAutoVerifyJobCard>.Instance);

        // Should not throw — logs warning only, does not reverse PaidOut.
        var act = () => handler.HandleAsync(log.Id, VerificationStatus.Disputed, AgronomistUserId);
        await act.Should().NotThrowAsync();

        // PaidOut status is preserved (we don't auto-reverse money).
        job.Status.Should().Be(JobCardStatus.PaidOut);
    }

    // ─── Test doubles ────────────────────────────────────────────────────────

    private sealed class FixedClock(DateTime utcNow) : IClock
    {
        public DateTime UtcNow { get; } = utcNow;
    }

    private sealed class FakeAutoVerifyRepo(
        JobCard? jobCard,
        DailyLog? dailyLog,
        Guid callerGuid,
        AppRole callerRole) : StubShramSafalRepository
    {
        public List<AuditEvent> AuditEvents { get; } = [];

        public override Task<JobCard?> GetJobCardByIdAsync(Guid jobCardId, CancellationToken ct = default)
            => Task.FromResult(jobCard?.Id == jobCardId ? jobCard : null);

        public override Task<JobCard?> GetJobCardByLinkedDailyLogIdAsync(Guid dailyLogId, CancellationToken ct = default)
        {
            if (jobCard is not null && jobCard.LinkedDailyLogId == dailyLogId)
                return Task.FromResult<JobCard?>(jobCard);
            return Task.FromResult<JobCard?>(null);
        }

        public override Task<DailyLog?> GetDailyLogByIdAsync(Guid dailyLogId, CancellationToken ct = default)
            => Task.FromResult(dailyLog?.Id == dailyLogId ? dailyLog : null);

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
