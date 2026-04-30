using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Work.GetWorkerProfile;
using Xunit;

namespace ShramSafal.Domain.Tests.Work.Handlers;

public sealed class GetWorkerProfileHandlerTests
{
    private static readonly DateTime Now = new(2026, 4, 21, 8, 0, 0, DateTimeKind.Utc);
    private static readonly Guid WorkerGuid = Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc");
    private static readonly UserId WorkerUserId = new(WorkerGuid);
    private static readonly Guid FarmGuid = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static readonly Guid OtherUserGuid = Guid.Parse("99999999-9999-9999-9999-999999999999");
    private static readonly UserId OtherUserId = new(OtherUserGuid);

    [Fact]
    public async Task GetWorkerProfile_AllVerifiedLogs_Produces100Overall()
    {
        var metrics = new WorkerMetricsDto(
            LogCount30d: 10, VerifiedCount30d: 10, DisputedCount30d: 0,
            OnTimeCount30d: 10, PlannedCount30d: 10,
            JobCardsLast30d: 5, JobCardsPaidOutLast30d: 4);

        var repo = new FakeProfileRepo(
            metrics, workerFarmIds: [FarmGuid], callerFarmIds: [FarmGuid]);
        var handler = new GetWorkerProfileHandler(repo, new FixedClock(Now), Microsoft.Extensions.Logging.Abstractions.NullLogger<GetWorkerProfileHandler>.Instance);

        var result = await handler.HandleAsync(new GetWorkerProfileQuery(WorkerUserId, WorkerUserId));

        result.IsSuccess.Should().BeTrue();
        result.Value!.ReliabilityOverall.Should().Be(100m);
        result.Value.LogCount30d.Should().Be(10);
        result.Value.JobCardsLast30d.Should().Be(5);
    }

    [Fact]
    public async Task GetWorkerProfile_ByUnrelatedUser_Returns_403()
    {
        var metrics = new WorkerMetricsDto(0, 0, 0, 0, 0, 0, 0);
        var repo = new FakeProfileRepo(
            metrics, workerFarmIds: [FarmGuid], callerFarmIds: []); // caller not on same farm

        var handler = new GetWorkerProfileHandler(repo, new FixedClock(Now), Microsoft.Extensions.Logging.Abstractions.NullLogger<GetWorkerProfileHandler>.Instance);

        var result = await handler.HandleAsync(new GetWorkerProfileQuery(WorkerUserId, OtherUserId));

        result.IsFailure.Should().BeTrue();
        result.Error.Code.Should().Contain("Forbidden");
    }

    [Fact]
    public async Task GetWorkerProfile_Worker_Self_Succeeds()
    {
        var metrics = new WorkerMetricsDto(5, 3, 1, 4, 5, 2, 1, 500m, "INR");
        var repo = new FakeProfileRepo(
            metrics, workerFarmIds: [FarmGuid], callerFarmIds: [FarmGuid]);
        var handler = new GetWorkerProfileHandler(repo, new FixedClock(Now), Microsoft.Extensions.Logging.Abstractions.NullLogger<GetWorkerProfileHandler>.Instance);

        // Worker queries their own profile — no farm cross-check needed.
        var result = await handler.HandleAsync(new GetWorkerProfileQuery(WorkerUserId, WorkerUserId));

        result.IsSuccess.Should().BeTrue();
        result.Value!.EarnedLast30d.Should().Be(500m);
        result.Value.EarnedCurrencyCode.Should().Be("INR");
    }

    // ─── Test doubles ────────────────────────────────────────────────────────

    private sealed class FixedClock(DateTime utcNow) : IClock
    {
        public DateTime UtcNow { get; } = utcNow;
    }

    private sealed class FakeProfileRepo(
        WorkerMetricsDto metrics,
        List<Guid> workerFarmIds,
        List<Guid> callerFarmIds) : StubShramSafalRepository
    {
        public override Task<List<Guid>> GetFarmIdsForUserAsync(Guid userId, CancellationToken ct = default)
        {
            if (userId == WorkerGuid)
                return Task.FromResult(workerFarmIds);
            return Task.FromResult(callerFarmIds);
        }

        public override Task<WorkerMetricsDto> GetWorkerMetricsAsync(
            UserId workerUserId, Guid? scopedFarmId, DateTime since30d, CancellationToken ct = default)
            => Task.FromResult(metrics);

        public override Task<IReadOnlyList<SyncOperatorDto>> GetOperatorsByIdsAsync(
            IEnumerable<Guid> userIds, CancellationToken ct = default)
            => Task.FromResult<IReadOnlyList<SyncOperatorDto>>([new SyncOperatorDto(WorkerGuid, "Test Worker", "Worker")]);
    }
}
