// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT3a fix pass 1, B003; founder D-46) — adding a task re-opens a
// confirmed record (or re-confirms the owner's own at the new version), so the record's WORK day is rebuilt inside the
// same unit of work as the task.
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Application.UseCases.Logs.AddLogTask;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Domain.AI;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Schedules;
using Xunit;

namespace ShramSafal.Domain.Tests.Logs;

public sealed class AddLogTaskRecomputeTests
{
    private static readonly Guid Farm = Guid.Parse("3a400000-0000-0000-0000-000000000001");
    private static readonly Guid Owner = Guid.Parse("3a400000-0000-0000-0000-000000000002");
    private static readonly Guid Mukadam = Guid.Parse("3a400000-0000-0000-0000-000000000003");
    private static readonly DateOnly WorkDay = new(2026, 11, 2);
    private static readonly DateTime Created = new(2026, 11, 2, 6, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime AddedAt = new(2026, 11, 5, 9, 0, 0, DateTimeKind.Utc); // D+3

    [Fact]
    public async Task AddLogTask_Reopen_RecomputesWorkDay()
    {
        // The मुकादम adds to his own record after the owner confirmed it: it re-opens (he may not re-confirm).
        var (log, repo) = Scenario(speaker: Mukadam, ownerConfirmed: true);
        var recorder = new RecordingRichness();

        var result = await Handler(repo, recorder).HandleAsync(AddTask(log.Id, Mukadam));

        Assert.True(result.IsSuccess);
        Assert.Equal(VerificationStatus.Draft, log.CurrentVerificationStatus);
        Assert.Equal([(Farm, WorkDay)], recorder.Calls);
    }

    [Fact]
    public async Task AddLogTask_Reopen_UnconfirmsTheWorkDay_ThroughTheRecompute()
    {
        var (log, repo) = Scenario(speaker: Mukadam, ownerConfirmed: true);
        var richness = RealRichness(repo);
        await richness.RecomputeAsync(Farm, WorkDay);
        Assert.True(repo.SeededRichnessAggregates.Single().AdvancesStreak);

        Assert.True((await Handler(repo, richness).HandleAsync(AddTask(log.Id, Mukadam))).IsSuccess);

        var day = repo.SeededRichnessAggregates.Single();
        Assert.Equal(WorkDay, day.LocalDate);
        Assert.False(day.AdvancesStreak);
    }

    [Fact]
    public async Task AddLogTask_CreatorReverify_RecomputesWorkDay_AndTheDayStillAdvances()
    {
        // The owner adds to his own confirmed day: re-opened and re-confirmed at the new version, so it still counts.
        var (log, repo) = Scenario(speaker: Owner, ownerConfirmed: false, ownerSelfAttested: true);
        var richness = RealRichness(repo);

        Assert.True((await Handler(repo, richness).HandleAsync(AddTask(log.Id, Owner))).IsSuccess);

        Assert.Equal(VerificationStatus.Verified, log.CurrentVerificationStatus);
        var day = repo.SeededRichnessAggregates.Single();
        Assert.Equal(WorkDay, day.LocalDate);
        Assert.True(day.AdvancesStreak);
    }

    [Fact]
    public async Task AddLogTask_RecomputeFails_TheTaskFailsWithIt()
    {
        var (log, repo) = Scenario(speaker: Mukadam, ownerConfirmed: true);

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => Handler(repo, new ThrowingRichness()).HandleAsync(AddTask(log.Id, Mukadam)));
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static (DailyLog Log, InMemoryShramSafalRepository Repo) Scenario(
        Guid speaker, bool ownerConfirmed, bool ownerSelfAttested = false)
    {
        var plotId = Guid.NewGuid();
        var cycleId = Guid.NewGuid();
        var log = DailyLog.Create(
            Guid.NewGuid(), new FarmId(Farm), plotId, cycleId, new UserId(speaker),
            WorkDay, idempotencyKey: null, location: null, createdAtUtc: Created);
        log.AddTask(Guid.NewGuid(), "spray", notes: null, occurredAtUtc: Created);
        if (ownerConfirmed)
        {
            log.VerifyReachingTarget(VerificationStatus.Verified, null, AppRole.PrimaryOwner, new UserId(Owner),
                Created.AddHours(1), targetEventId: Guid.NewGuid(), enRouteEventId: Guid.NewGuid());
        }

        if (ownerSelfAttested)
        {
            Assert.True(log.TrySelfVerifyAsCreator(Guid.NewGuid(), Guid.NewGuid(), AppRole.PrimaryOwner, Created.AddMinutes(1)));
        }

        var repo = new InMemoryShramSafalRepository();
        repo.AddLog(log);
        repo.AddCropCycle(Domain.Crops.CropCycle.Create(
            cycleId, new FarmId(Farm), plotId, "Grapes", "Vegetative", new DateOnly(2026, 1, 1), null, Created));
        repo.SetMembership(Farm, Owner, AppRole.PrimaryOwner);
        repo.SetMembership(Farm, Mukadam, AppRole.Mukadam);
        return (log, repo);
    }

    private static AddLogTaskCommand AddTask(Guid logId, Guid actor) => new(
        logId, "फवारणी", Notes: null, OccurredAtUtc: AddedAt, ActorUserId: actor);

    private static AddLogTaskHandler Handler(InMemoryShramSafalRepository repo, IDailyRichnessDerivationService richness) =>
        new(repo, new Ids(), new TickingClock(AddedAt), new AllowAll(), new Unscheduled(), richness);

    private static DailyRichnessDerivationService RealRichness(IShramSafalRepository repo) =>
        new(repo, new NoAiJobs(), new Ids(), new TickingClock(AddedAt));

    private sealed class RecordingRichness : IDailyRichnessDerivationService
    {
        public List<(Guid FarmId, DateOnly Day)> Calls { get; } = [];

        public Task RecomputeAsync(Guid farmId, DateOnly localDate, CancellationToken ct = default)
        {
            Calls.Add((farmId, localDate));
            return Task.CompletedTask;
        }
    }

    private sealed class ThrowingRichness : IDailyRichnessDerivationService
    {
        public Task RecomputeAsync(Guid farmId, DateOnly localDate, CancellationToken ct = default)
            => throw new InvalidOperationException("recompute failed");
    }

    private sealed class Unscheduled : IScheduleComplianceService
    {
        public Task<ComplianceResult> EvaluateAsync(ScheduleComplianceQuery query, CancellationToken ct = default)
            => Task.FromResult(ComplianceResult.Unscheduled());
    }

    private sealed class NoAiJobs : IAiJobRepository
    {
        public Task<AiJob?> GetByIdAsync(Guid jobId, CancellationToken ct = default) => Task.FromResult<AiJob?>(null);
        public Task<AiJob?> GetByIdempotencyKeyAsync(string idempotencyKey, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddAsync(AiJob job, CancellationToken ct = default) => throw new NotSupportedException();
        public Task UpdateAsync(AiJob job, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<AiProviderConfig> GetProviderConfigAsync(CancellationToken ct = default) => throw new NotSupportedException();
        public Task SaveProviderConfigAsync(AiProviderConfig config, CancellationToken ct = default) => throw new NotSupportedException();
        public Task SaveChangesAsync(CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<AiJob>> GetRecentJobsAsync(int limit, AiOperationType? operationType, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Dictionary<AiProviderType, int>> GetSuccessCountByProviderAsync(DateTime since, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Dictionary<AiProviderType, int>> GetFailureCountByProviderAsync(DateTime since, CancellationToken ct = default) => throw new NotSupportedException();
    }

    private sealed class TickingClock(DateTime start) : IClock
    {
        private DateTime _now = start;

        public DateTime UtcNow => _now = _now.AddSeconds(1);
    }

    private sealed class Ids : IIdGenerator
    {
        public Guid New() => Guid.NewGuid();
    }

    private sealed class AllowAll : IEntitlementPolicy
    {
        public Task<EntitlementDecision> EvaluateAsync(
            UserId userId, FarmId farmId, PaidFeature feature, CancellationToken ct = default)
            => Task.FromResult(new EntitlementDecision(true, EntitlementReason.Allowed, null));
    }
}
