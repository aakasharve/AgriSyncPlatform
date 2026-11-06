// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT3a, item 7; founder D-46) — a correction that re-opens a
// confirmed record rebuilds the day score of the record's WORK day, inside the same unit of work as the correction.
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using Microsoft.Extensions.Logging.Abstractions;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Application.UseCases.Logs.Content;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Application.UseCases.Logs.ReviseLogContent;
using ShramSafal.Domain.AI;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Schedules;
using Xunit;

namespace ShramSafal.Domain.Tests.Logs;

public sealed class ReviseLogContentRecomputeTests
{
    private static readonly Guid Farm = Guid.Parse("3a200000-0000-0000-0000-000000000001");
    private static readonly Guid Owner = Guid.Parse("3a200000-0000-0000-0000-000000000002");
    private static readonly Guid Mukadam = Guid.Parse("3a200000-0000-0000-0000-000000000003");
    private static readonly Guid LogId = Guid.Parse("3a200000-0000-0000-0000-0000000000aa");
    private static readonly DateOnly WorkDay = new(2026, 11, 2);
    private static readonly DateTime Created = new(2026, 11, 2, 6, 0, 0, DateTimeKind.Utc);
    private static readonly DateTime CorrectedAt = new(2026, 11, 5, 9, 0, 0, DateTimeKind.Utc); // D+3

    [Fact]
    public async Task Revise_ReopeningCorrection_RecomputesTheWorkDay()
    {
        var (log, repo) = ConfirmedMukadamLog();
        var recorder = new RecordingRichness();

        var result = await Handler(repo, recorder).HandleAsync(Correction());

        Assert.True(result.IsSuccess);
        Assert.Equal(VerificationStatus.Draft, log.CurrentVerificationStatus);
        Assert.Equal([(Farm, WorkDay)], recorder.Calls);
    }

    [Fact]
    public async Task Streak_ReopeningCorrection_UnconfirmsTheWorkDay_ThroughTheHandler()
    {
        var (log, repo) = ConfirmedMukadamLog();
        var richness = new DailyRichnessDerivationService(repo, new NoAiJobs(), new Ids(), new TickingClock(CorrectedAt));
        await richness.RecomputeAsync(Farm, WorkDay);
        Assert.True(repo.SeededRichnessAggregates.Single().AdvancesStreak);

        var result = await Handler(repo, richness).HandleAsync(Correction());

        Assert.True(result.IsSuccess);
        Assert.Equal(VerificationStatus.Draft, log.CurrentVerificationStatus);
        var workDay = repo.SeededRichnessAggregates.Single();
        Assert.Equal(WorkDay, workDay.LocalDate);
        Assert.False(workDay.AdvancesStreak);
    }

    [Fact]
    public async Task Revise_RecomputeFails_TheCorrectionFailsWithIt()
    {
        var (_, repo) = ConfirmedMukadamLog();

        await Assert.ThrowsAsync<InvalidOperationException>(
            () => Handler(repo, new ThrowingRichness()).HandleAsync(Correction()));
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static (DailyLog Log, InMemoryShramSafalRepository Repo) ConfirmedMukadamLog()
    {
        var log = DailyLog.Create(
            LogId, new FarmId(Farm), Guid.NewGuid(), Guid.NewGuid(), new UserId(Mukadam),
            WorkDay, idempotencyKey: null, location: null, createdAtUtc: Created);
        log.AddTask(Guid.NewGuid(), "spray", notes: null, occurredAtUtc: Created);
        log.VerifyReachingTarget(VerificationStatus.Verified, null, AppRole.PrimaryOwner, Owner, Created.AddHours(1),
            targetEventId: Guid.NewGuid(), enRouteEventId: Guid.NewGuid());
        Assert.Equal(VerificationStatus.Verified, log.CurrentVerificationStatus);

        var repo = new InMemoryShramSafalRepository();
        repo.AddLog(log);
        repo.SetMembership(Farm, Owner, AppRole.PrimaryOwner);
        repo.SetMembership(Farm, Mukadam, AppRole.Mukadam);
        return (log, repo);
    }

    private static ReviseLogContentCommand Correction() => new(
        LogId, BaseVersion: 1,
        ContentJson: $$"""{"schema":{{LogContentDocument.SchemaVersion}},"cropActivities":[{"id":"a1","title":"फवारणी"}]}""",
        Reason: "दुरुस्ती", ActorUserId: Mukadam);

    private static ReviseLogContentHandler Handler(InMemoryShramSafalRepository repo, IDailyRichnessDerivationService richness) =>
        new(repo, new Ids(), new TickingClock(CorrectedAt), new AllowAll(), new Unscheduled(),
            NullLogger<ReviseLogContentHandler>.Instance, richness);

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
