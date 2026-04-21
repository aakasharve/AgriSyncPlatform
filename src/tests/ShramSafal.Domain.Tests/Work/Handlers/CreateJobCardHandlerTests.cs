using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Money;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Work.CreateJobCard;
using ShramSafal.Domain.Attachments;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Crops;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.Schedules;
using ShramSafal.Domain.Work;
using Xunit;

namespace ShramSafal.Domain.Tests.Work.Handlers;

public sealed class CreateJobCardHandlerTests
{
    private static readonly DateTime Now = new(2026, 4, 21, 8, 0, 0, DateTimeKind.Utc);
    private static readonly Guid FarmGuid = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static readonly FarmId FarmId = new(FarmGuid);
    private static readonly Guid PlotGuid = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    private static readonly Guid WorkerGuid = Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc");
    private static readonly UserId WorkerUserId = new(WorkerGuid);
    private static readonly Guid MukadamGuid = Guid.Parse("dddddddd-dddd-dddd-dddd-dddddddddddd");
    private static readonly UserId MukadamUserId = new(MukadamGuid);

    private static IReadOnlyList<JobCardLineItemDto> DefaultLineItems =>
        new[]
        {
            new JobCardLineItemDto("spray", 4m, 50m, "INR", null),
            new JobCardLineItemDto("pruning", 2m, 30m, "INR", null),
        };

    private static CreateJobCardHandler BuildHandler(
        Guid callerGuid,
        AppRole callerRole)
    {
        var repo = new FakeRepo(callerGuid, callerRole);
        return new CreateJobCardHandler(repo, new SequentialIdGenerator(), new FixedClock(Now));
    }

    [Fact]
    public async Task CreateJobCard_Worker_Returns_403()
    {
        var handler = BuildHandler(WorkerGuid, AppRole.Worker);

        var result = await handler.HandleAsync(new CreateJobCardCommand(
            FarmId: FarmId,
            PlotId: PlotGuid,
            CropCycleId: null,
            PlannedDate: new DateOnly(2026, 4, 21),
            LineItems: DefaultLineItems,
            CallerUserId: WorkerUserId,
            ClientCommandId: null));

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Contain("JobCardRoleNotAllowed");
    }

    [Fact]
    public async Task CreateJobCard_Mukadam_Succeeds_EmitsAudit()
    {
        var repo = new FakeRepo(MukadamGuid, AppRole.Mukadam);
        var handler = new CreateJobCardHandler(repo, new SequentialIdGenerator(), new FixedClock(Now));

        var result = await handler.HandleAsync(new CreateJobCardCommand(
            FarmId: FarmId,
            PlotId: PlotGuid,
            CropCycleId: null,
            PlannedDate: new DateOnly(2026, 4, 21),
            LineItems: DefaultLineItems,
            CallerUserId: MukadamUserId,
            ClientCommandId: "cmd-001"));

        result.IsSuccess.Should().BeTrue();
        result.Value!.JobCardId.Should().NotBeEmpty();
        repo.AuditEvents.Should().ContainSingle(a => a.Action == "jobcard.created");
        repo.SavedJobCards.Should().ContainSingle();
    }

    // ─── Test doubles ────────────────────────────────────────────────────────

    private sealed class SequentialIdGenerator : IIdGenerator
    {
        public Guid New() => Guid.NewGuid();
    }

    private sealed class FixedClock : IClock
    {
        public FixedClock(DateTime utcNow) { UtcNow = utcNow; }
        public DateTime UtcNow { get; }
    }

    private sealed class FakeRepo(Guid callerGuid, AppRole callerRole) : StubShramSafalRepository
    {
        public List<JobCard> SavedJobCards { get; } = [];
        public List<AuditEvent> AuditEvents { get; } = [];

        public override Task<AppRole?> GetUserRoleForFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default)
        {
            if (userId == callerGuid)
                return Task.FromResult<AppRole?>(callerRole);
            return Task.FromResult<AppRole?>(null);
        }

        public override Task AddJobCardAsync(JobCard jobCard, CancellationToken ct = default)
        {
            SavedJobCards.Add(jobCard);
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
