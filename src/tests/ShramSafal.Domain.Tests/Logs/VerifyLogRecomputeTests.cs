// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT3a, item 7; founder D-46) — a change to a record's
// confirmation rebuilds the day score of the record's WORK DAY, inside the same unit of work as the decision.
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using Microsoft.Extensions.Logging.Abstractions;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Application.UseCases.Logs.VerifyLog;
using ShramSafal.Application.UseCases.Work.Handlers;
using ShramSafal.Domain.AI;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Logs;
using Xunit;

namespace ShramSafal.Domain.Tests.Logs;

public sealed class VerifyLogRecomputeTests
{
    private static readonly Guid Farm = Guid.Parse("3a000000-0000-0000-0000-000000000001");
    private static readonly Guid Owner = Guid.Parse("3a000000-0000-0000-0000-000000000002");
    private static readonly Guid Mukadam = Guid.Parse("3a000000-0000-0000-0000-000000000003");
    private static readonly Guid CoOwner = Guid.Parse("3a000000-0000-0000-0000-000000000004");
    private static readonly DateOnly WorkDay = new(2026, 11, 2);
    private static readonly DateTime Created = new(2026, 11, 2, 6, 0, 0, DateTimeKind.Utc);

    // Confirmed three days after the work: D+3.
    private static readonly DateTime ConfirmedAt = new(2026, 11, 5, 9, 0, 0, DateTimeKind.Utc);

    [Fact]
    public async Task Verify_TriggersRecompute()
    {
        var log = MukadamWorkLog();
        var recorder = new RecordingRichness();
        var (handler, _) = Build(log, recorder, ConfirmedAt);

        var result = await handler.HandleAsync(Decide(VerificationStatus.Verified));

        Assert.True(result.IsSuccess);
        Assert.Equal(VerificationStatus.Verified, log.CurrentVerificationStatus);
        Assert.Equal([(Farm, WorkDay)], recorder.Calls);
    }

    [Theory]
    [InlineData(VerificationStatus.Disputed)] // शंका; the v1 "rejected" alias maps here too
    [InlineData(VerificationStatus.CorrectionPending)]
    public async Task Verify_DisputeOrReject_TriggersRecompute_OfTheWorkDay(VerificationStatus target)
    {
        var log = MukadamWorkLog();
        var recorder = new RecordingRichness();
        var (handler, _) = Build(log, recorder, ConfirmedAt);

        Assert.True((await handler.HandleAsync(Decide(VerificationStatus.Verified))).IsSuccess);
        if (target == VerificationStatus.CorrectionPending)
        {
            Assert.True((await handler.HandleAsync(Decide(VerificationStatus.Disputed))).IsSuccess);
        }

        Assert.True((await handler.HandleAsync(Decide(target))).IsSuccess);

        Assert.Equal(target, log.CurrentVerificationStatus);
        Assert.All(recorder.Calls, c => Assert.Equal((Farm, WorkDay), c));
        Assert.Equal(target == VerificationStatus.CorrectionPending ? 3 : 2, recorder.Calls.Count);
    }

    [Fact]
    public async Task Streak_ConfirmOnLaterDay_AdvancesTheWorkDay()
    {
        var log = MukadamWorkLog();
        var repo = NewRepo(log);
        var richness = RealRichness(repo, ConfirmedAt);

        // The day as it stood when the मुकादम saved it: real work, nobody has confirmed it.
        await richness.RecomputeAsync(Farm, WorkDay);
        Assert.False(repo.SeededRichnessAggregates.Single(a => a.LocalDate == WorkDay).AdvancesStreak);

        var (handler, _) = Build(log, richness, ConfirmedAt, repo);
        var result = await handler.HandleAsync(Decide(VerificationStatus.Verified));

        Assert.True(result.IsSuccess);
        var workDay = repo.SeededRichnessAggregates.Single(a => a.LocalDate == WorkDay);
        Assert.True(workDay.AdvancesStreak);
        // The day the confirmation happened (D+3) is not touched: no row is written for it.
        Assert.DoesNotContain(repo.SeededRichnessAggregates, a => a.LocalDate == DateOnly.FromDateTime(ConfirmedAt));
        Assert.Single(repo.SeededRichnessAggregates);
    }

    [Fact]
    public async Task Verify_DisputeAfterConfirm_StopsTheWorkDayAdvancing()
    {
        var log = MukadamWorkLog();
        var repo = NewRepo(log);
        var richness = RealRichness(repo, ConfirmedAt);
        var (handler, _) = Build(log, richness, ConfirmedAt, repo);

        Assert.True((await handler.HandleAsync(Decide(VerificationStatus.Verified))).IsSuccess);
        Assert.True(repo.SeededRichnessAggregates.Single().AdvancesStreak);

        Assert.True((await handler.HandleAsync(Decide(VerificationStatus.Disputed))).IsSuccess);
        Assert.False(repo.SeededRichnessAggregates.Single().AdvancesStreak);
    }

    [Fact]
    public async Task Verify_RecomputeFails_TheDecisionFailsWithIt()
    {
        // "The recompute and the confirmation commit together, or neither does": the failure is not
        // swallowed, so the request's transaction rolls the confirmation back with it.
        var log = MukadamWorkLog();
        var (handler, _) = Build(log, new ThrowingRichness(), ConfirmedAt);

        await Assert.ThrowsAsync<InvalidOperationException>(() => handler.HandleAsync(Decide(VerificationStatus.Verified)));
    }

    [Fact]
    public async Task Verify_MarkThatMovesNoStatus_DoesNotRecompute()
    {
        // A co-owner without the confirm grant: his tap is kept as a mark, the status does not move,
        // so there is nothing to rebuild.
        var log = MukadamWorkLog();
        var recorder = new RecordingRichness();
        var (handler, _) = Build(log, recorder, ConfirmedAt);

        var result = await handler.HandleAsync(Decide(VerificationStatus.Verified, CoOwner));

        Assert.True(result.IsSuccess);
        Assert.Equal(VerificationStatus.Draft, log.CurrentVerificationStatus);
        Assert.Empty(recorder.Calls);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static readonly Guid LogId = Guid.Parse("3a000000-0000-0000-0000-0000000000aa");

    private static DailyLog MukadamWorkLog()
    {
        var log = DailyLog.Create(
            LogId, new FarmId(Farm), Guid.NewGuid(), Guid.NewGuid(), new UserId(Mukadam),
            WorkDay, idempotencyKey: null, location: null, createdAtUtc: Created);
        log.AddTask(Guid.NewGuid(), "spray", notes: null, occurredAtUtc: Created);
        return log;
    }

    private static VerifyLogCommand Decide(VerificationStatus target, Guid? caller = null) => new(
        LogId, target,
        Reason: target is VerificationStatus.Disputed ? "रोजंदारीचा आकडा चुकीचा" : null,
        VerifiedByUserId: caller ?? Owner,
        ReviewBasis: target == VerificationStatus.Verified ? ReviewBasis.Read : null);

    private static InMemoryShramSafalRepository NewRepo(DailyLog log)
    {
        var repo = new InMemoryShramSafalRepository();
        repo.AddLog(log);
        repo.SetMembership(Farm, Owner, AppRole.PrimaryOwner);
        repo.SetMembership(Farm, Mukadam, AppRole.Mukadam);
        repo.SetMembership(Farm, CoOwner, AppRole.SecondaryOwner);
        return repo;
    }

    private static DailyRichnessDerivationService RealRichness(IShramSafalRepository repo, DateTime now) =>
        new(repo, new NoAiJobs(), new Ids(), new FixedClock(now));

    private static (VerifyLogHandler Handler, InMemoryShramSafalRepository Repo) Build(
        DailyLog log, IDailyRichnessDerivationService richness, DateTime now, InMemoryShramSafalRepository? repo = null)
    {
        repo ??= NewRepo(log);
        // Each decision is later than the one before it (the status is the latest event), as on a real phone.
        var clock = new TickingClock(now);
        var autoVerify = new OnLogVerifiedAutoVerifyJobCard(repo, clock, NullLogger<OnLogVerifiedAutoVerifyJobCard>.Instance);
        var handler = new VerifyLogHandler(repo, new Ids(), clock, new AllowAll(), new NoAnalytics(), autoVerify, richness);
        return (handler, repo);
    }

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

    private sealed class FixedClock(DateTime now) : IClock
    {
        public DateTime UtcNow { get; } = now;
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

    private sealed class NoAnalytics : IAnalyticsWriter
    {
        public Task EmitAsync(AnalyticsEvent e, CancellationToken ct = default) => Task.CompletedTask;
        public Task EmitManyAsync(IEnumerable<AnalyticsEvent> events, CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class AllowAll : IEntitlementPolicy
    {
        public Task<EntitlementDecision> EvaluateAsync(
            UserId userId, FarmId farmId, PaidFeature feature, CancellationToken ct = default)
            => Task.FromResult(new EntitlementDecision(true, EntitlementReason.Allowed, null));
    }
}
