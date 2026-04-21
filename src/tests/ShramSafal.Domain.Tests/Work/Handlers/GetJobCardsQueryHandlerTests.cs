using AgriSync.BuildingBlocks.Money;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Work.GetJobCardsForFarm;
using ShramSafal.Application.UseCases.Work.GetJobCardsForWorker;
using ShramSafal.Domain.Work;
using Xunit;

namespace ShramSafal.Domain.Tests.Work.Handlers;

public sealed class GetJobCardsQueryHandlerTests
{
    private static readonly DateTime Now = new(2026, 4, 21, 8, 0, 0, DateTimeKind.Utc);
    private static readonly FarmId FarmId = new(Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"));
    private static readonly Guid PlotGuid = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    private static readonly Guid WorkerGuid = Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc");
    private static readonly UserId WorkerUserId = new(WorkerGuid);
    private static readonly Guid MukadamGuid = Guid.Parse("dddddddd-dddd-dddd-dddd-dddddddddddd");
    private static readonly UserId MukadamUserId = new(MukadamGuid);
    private static readonly Guid OtherUserGuid = Guid.Parse("99999999-9999-9999-9999-999999999999");
    private static readonly UserId OtherUserId = new(OtherUserGuid);

    private static JobCard BuildJobCard(JobCardStatus status = JobCardStatus.Draft)
    {
        var job = JobCard.CreateDraft(
            Guid.NewGuid(), FarmId, PlotGuid, null, MukadamUserId,
            new DateOnly(2026, 4, 21),
            new[] { new JobCardLineItem("spray", 4m, new Money(50m, Currency.Inr), null) },
            Now);

        if (status >= JobCardStatus.Assigned)
            job.Assign(WorkerUserId, MukadamUserId, AppRole.Mukadam, Now);

        return job;
    }

    [Fact]
    public async Task GetForFarm_FiltersByStatus()
    {
        var draftJob = BuildJobCard(JobCardStatus.Draft);
        var assignedJob = BuildJobCard(JobCardStatus.Assigned);
        var repo = new FakeRepo(
            farmJobCards: [draftJob, assignedJob],
            memberFarmIds: [FarmId.Value]);

        var handler = new GetJobCardsForFarmHandler(repo);
        var result = await handler.HandleAsync(new GetJobCardsForFarmQuery(
            FarmId, MukadamUserId, StatusFilter: JobCardStatus.Assigned));

        result.IsSuccess.Should().BeTrue();
        result.Value!.Should().ContainSingle(j => j.Status == "Assigned");
    }

    [Fact]
    public async Task GetForFarm_NoFilter_ReturnsAll()
    {
        var jobs = new[] { BuildJobCard(), BuildJobCard() };
        var repo = new FakeRepo(farmJobCards: jobs.ToList(), memberFarmIds: [FarmId.Value]);
        var handler = new GetJobCardsForFarmHandler(repo);
        var result = await handler.HandleAsync(new GetJobCardsForFarmQuery(FarmId, MukadamUserId, null));

        result.IsSuccess.Should().BeTrue();
        result.Value!.Should().HaveCount(2);
    }

    [Fact]
    public async Task GetForWorker_ReturnsOnlyWorkersOwnCards()
    {
        var workerJob = BuildJobCard(JobCardStatus.Assigned); // assigned to WorkerUserId
        var anotherJob = BuildJobCard(JobCardStatus.Draft);   // not assigned to WorkerUserId yet

        // Worker's job cards (only first job has Worker assigned)
        var repo = new FakeWorkerRepo(
            workerJobCards: [workerJob],
            workerFarmIds: [FarmId.Value],
            callerFarmIds: [FarmId.Value]);

        var handler = new GetJobCardsForWorkerHandler(repo);
        var result = await handler.HandleAsync(new GetJobCardsForWorkerQuery(WorkerUserId, WorkerUserId));

        result.IsSuccess.Should().BeTrue();
        result.Value!.Should().ContainSingle();
    }

    [Fact]
    public async Task GetForWorker_CallerNotOnSameFarm_Returns_403()
    {
        var repo = new FakeWorkerRepo(
            workerJobCards: [],
            workerFarmIds: [FarmId.Value],
            callerFarmIds: []); // caller has no farms in common with worker

        var handler = new GetJobCardsForWorkerHandler(repo);
        var result = await handler.HandleAsync(new GetJobCardsForWorkerQuery(WorkerUserId, OtherUserId));

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Contain("Forbidden");
    }

    // ─── Test doubles ────────────────────────────────────────────────────────

    private sealed class FakeRepo(
        List<JobCard> farmJobCards,
        List<Guid> memberFarmIds) : StubShramSafalRepository
    {
        public override Task<bool> IsUserMemberOfFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default)
            => Task.FromResult(memberFarmIds.Contains(farmId));

        public override Task<List<JobCard>> GetJobCardsForFarmAsync(FarmId farmId, JobCardStatus? statusFilter, CancellationToken ct = default)
        {
            var cards = farmJobCards
                .Where(j => j.FarmId == farmId)
                .Where(j => statusFilter is null || j.Status == statusFilter)
                .ToList();
            return Task.FromResult(cards);
        }
    }

    private sealed class FakeWorkerRepo(
        List<JobCard> workerJobCards,
        List<Guid> workerFarmIds,
        List<Guid> callerFarmIds) : StubShramSafalRepository
    {
        public override Task<List<Guid>> GetFarmIdsForUserAsync(Guid userId, CancellationToken ct = default)
        {
            if (userId == WorkerGuid)
                return Task.FromResult(workerFarmIds);
            return Task.FromResult(callerFarmIds);
        }

        public override Task<List<JobCard>> GetJobCardsForWorkerAsync(UserId workerUserId, CancellationToken ct = default)
            => Task.FromResult(workerJobCards);
    }
}
