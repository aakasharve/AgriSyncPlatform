using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Money;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Application.UseCases.Work.AssignJobCard;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Work;
using Xunit;

namespace ShramSafal.Domain.Tests.Work.Handlers;

public sealed class AssignJobCardHandlerTests
{
    private static readonly DateTime Now = new(2026, 4, 21, 8, 0, 0, DateTimeKind.Utc);
    private static readonly Guid FarmGuid = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static readonly FarmId FarmId = new(FarmGuid);
    private static readonly Guid PlotGuid = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    private static readonly Guid WorkerGuid = Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc");
    private static readonly UserId WorkerUserId = new(WorkerGuid);
    private static readonly Guid MukadamGuid = Guid.Parse("dddddddd-dddd-dddd-dddd-dddddddddddd");
    private static readonly UserId MukadamUserId = new(MukadamGuid);

    private static JobCard BuildDraftJobCard()
    {
        return JobCard.CreateDraft(
            Guid.NewGuid(),
            FarmId,
            PlotGuid,
            cropCycleId: null,
            MukadamUserId,
            new DateOnly(2026, 4, 21),
            new[] { new JobCardLineItem("spray", 4m, new Money(50m, Currency.Inr), null) },
            Now);
    }

    [Fact]
    public async Task AssignJobCard_ToNonMember_Returns_400()
    {
        var jobCard = BuildDraftJobCard();
        var repo = new FakeRepo(jobCard, mukadamRole: AppRole.Mukadam, workerIsMember: false);
        var handler = new AssignJobCardHandler(repo, new FixedClock(Now));

        var result = await handler.HandleAsync(new AssignJobCardCommand(
            JobCardId: jobCard.Id,
            WorkerUserId: WorkerUserId,
            CallerUserId: MukadamUserId,
            ClientCommandId: null));

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Contain("JobCardWorkerNotMember");
    }

    [Fact]
    public async Task AssignJobCard_ByMukadam_Succeeds()
    {
        var jobCard = BuildDraftJobCard();
        var repo = new FakeRepo(jobCard, mukadamRole: AppRole.Mukadam, workerIsMember: true);
        var handler = new AssignJobCardHandler(repo, new FixedClock(Now));

        var result = await handler.HandleAsync(new AssignJobCardCommand(
            JobCardId: jobCard.Id,
            WorkerUserId: WorkerUserId,
            CallerUserId: MukadamUserId,
            ClientCommandId: "assign-001"));

        result.IsSuccess.Should().BeTrue();
        jobCard.Status.Should().Be(JobCardStatus.Assigned);
        jobCard.AssignedWorkerUserId.Should().Be(WorkerUserId);
        repo.AuditEvents.Should().ContainSingle(a => a.Action == "jobcard.assigned");
    }

    // ─── Test doubles ────────────────────────────────────────────────────────

    private sealed class FixedClock(DateTime utcNow) : IClock
    {
        public DateTime UtcNow { get; } = utcNow;
    }

    private sealed class FakeRepo(JobCard jobCard, AppRole mukadamRole, bool workerIsMember)
        : StubShramSafalRepository
    {
        public List<AuditEvent> AuditEvents { get; } = [];

        public override Task<JobCard?> GetJobCardByIdAsync(Guid jobCardId, CancellationToken ct = default)
            => Task.FromResult<JobCard?>(jobCard.Id == jobCardId ? jobCard : null);

        public override Task<AppRole?> GetUserRoleForFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default)
        {
            if (userId == MukadamGuid)
                return Task.FromResult<AppRole?>(mukadamRole);
            return Task.FromResult<AppRole?>(null);
        }

        public override Task<ShramSafal.Domain.Farms.FarmMembership?> GetFarmMembershipAsync(
            Guid farmId, Guid userId, CancellationToken ct = default)
        {
            if (!workerIsMember || userId != WorkerGuid)
                return Task.FromResult<ShramSafal.Domain.Farms.FarmMembership?>(null);

            // Return a non-null stub membership (FarmMembership has a private ctor, so we just return a new one via EF-style)
            return Task.FromResult<ShramSafal.Domain.Farms.FarmMembership?>(
                FarmMembership.Create(Guid.NewGuid(), FarmId, new UserId(WorkerGuid), AppRole.Worker, Now));
        }

        public override Task AddAuditEventAsync(AuditEvent auditEvent, CancellationToken ct = default)
        {
            AuditEvents.Add(auditEvent);
            return Task.CompletedTask;
        }

        public override Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }
}
