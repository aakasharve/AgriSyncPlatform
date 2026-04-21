using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Money;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Application.UseCases.Work.StartJobCard;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Work;
using Xunit;

namespace ShramSafal.Domain.Tests.Work.Handlers;

public sealed class StartJobCardHandlerTests
{
    private static readonly DateTime Now = new(2026, 4, 21, 8, 0, 0, DateTimeKind.Utc);
    private static readonly FarmId FarmId = new(Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"));
    private static readonly Guid PlotGuid = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    private static readonly Guid WorkerGuid = Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc");
    private static readonly UserId WorkerUserId = new(WorkerGuid);
    private static readonly Guid MukadamGuid = Guid.Parse("dddddddd-dddd-dddd-dddd-dddddddddddd");
    private static readonly UserId MukadamUserId = new(MukadamGuid);

    private static JobCard BuildAssignedJobCard()
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
        return job;
    }

    [Fact]
    public async Task StartJobCard_ByNonAssignedWorker_Returns_Error()
    {
        var job = BuildAssignedJobCard();
        var nonAssignedWorker = UserId.New();
        var repo = new FakeRepo(job);
        var handler = new StartJobCardHandler(repo, new FixedClock(Now));

        var result = await handler.HandleAsync(new StartJobCardCommand(
            JobCardId: job.Id,
            CallerUserId: nonAssignedWorker,
            ClientCommandId: null));

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Contain("JobCardRoleNotAllowed");
    }

    [Fact]
    public async Task StartJobCard_TwiceSameWorker_IsIdempotent_SameStartTimestamp()
    {
        var job = BuildAssignedJobCard();
        var repo = new FakeRepo(job);
        var handler = new StartJobCardHandler(repo, new FixedClock(Now));

        var firstResult = await handler.HandleAsync(new StartJobCardCommand(
            JobCardId: job.Id,
            CallerUserId: WorkerUserId,
            ClientCommandId: "start-001"));

        // Second call — same ClientCommandId, handler should return same timestamp.
        var secondResult = await handler.HandleAsync(new StartJobCardCommand(
            JobCardId: job.Id,
            CallerUserId: WorkerUserId,
            ClientCommandId: "start-001"));

        firstResult.IsSuccess.Should().BeTrue();
        secondResult.IsSuccess.Should().BeTrue();
        secondResult.Value!.StartedAtUtc.Should().Be(firstResult.Value!.StartedAtUtc);
    }

    // ─── Test doubles ────────────────────────────────────────────────────────

    private sealed class FixedClock(DateTime utcNow) : IClock
    {
        public DateTime UtcNow { get; } = utcNow;
    }

    private sealed class FakeRepo(JobCard jobCard) : StubShramSafalRepository
    {
        public List<AuditEvent> AuditEvents { get; } = [];

        public override Task<JobCard?> GetJobCardByIdAsync(Guid jobCardId, CancellationToken ct = default)
            => Task.FromResult<JobCard?>(jobCard.Id == jobCardId ? jobCard : null);

        public override Task AddAuditEventAsync(AuditEvent auditEvent, CancellationToken ct = default)
        {
            AuditEvents.Add(auditEvent);
            return Task.CompletedTask;
        }

        public override Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }
}
