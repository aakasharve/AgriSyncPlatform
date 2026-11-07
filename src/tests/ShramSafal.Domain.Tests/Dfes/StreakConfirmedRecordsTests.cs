// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT3a, item 7; founder D-46) — a day advances the streak only
// when at least one of that day's records is CONFIRMED (मंजूर: the record's current status is Verified). Points, the bar
// and every other streak rule stay exactly as they were.
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Ports.External;
using ShramSafal.Application.UseCases.Logs;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Domain.AI;
using ShramSafal.Domain.Dfes;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Tests.Logs;
using Xunit;

namespace ShramSafal.Domain.Tests.Dfes;

public sealed class StreakConfirmedRecordsTests
{
    private static readonly Guid Farm = Guid.Parse("3a100000-0000-0000-0000-000000000001");
    private static readonly Guid Owner = Guid.Parse("3a100000-0000-0000-0000-000000000002");
    private static readonly Guid Mukadam = Guid.Parse("3a100000-0000-0000-0000-000000000003");
    private static readonly DateOnly Day1 = new(2026, 11, 1);
    private static readonly DateOnly Day2 = new(2026, 11, 2);
    private static readonly DateTime Now = new(2026, 11, 6, 9, 0, 0, DateTimeKind.Utc);

    // ── through the day recompute (DailyRichnessDerivationService) ───────────

    [Fact]
    public async Task Streak_UnconfirmedDay_DoesNotAdvance()
    {
        var ownerDay = OwnerSavedLog(Day1);
        var mukadamDay = WorkLog(Mukadam, Day2); // real work, nobody has confirmed it
        var repo = Repo(ownerDay, mukadamDay);

        await Recompute(repo, Day1);
        await Recompute(repo, Day2);

        var day2 = Row(repo, Day2);
        Assert.Equal(DayClassification.BasicWorkDay, day2.DayClassification); // still a day of work
        Assert.False(day2.AdvancesStreak);

        var projection = FarmerEngagementProjection.Fold(repo.SeededRichnessAggregates);
        Assert.Equal(1, projection.CurrentStreak);
        Assert.Equal(1, projection.LongestStreak);
    }

    [Fact]
    public async Task Streak_DisputedAfterConfirm_StopsAdvancing()
    {
        var log = WorkLog(Mukadam, Day1);
        OwnerConfirms(log, Now.AddHours(-2));
        var repo = Repo(log);

        await Recompute(repo, Day1);
        Assert.True(Row(repo, Day1).AdvancesStreak);

        log.Verify(Guid.NewGuid(), VerificationStatus.Disputed, "आकडा चुकीचा", AppRole.PrimaryOwner,
            new UserId(Owner), Now.AddHours(-1));
        await Recompute(repo, Day1);

        Assert.Equal(VerificationStatus.Disputed, log.CurrentVerificationStatus);
        Assert.False(Row(repo, Day1).AdvancesStreak);
    }

    [Fact]
    public async Task Streak_ReopeningCorrection_UnconfirmsTheDay()
    {
        var log = WorkLog(Mukadam, Day1);
        OwnerConfirms(log, Now.AddHours(-2));
        var repo = Repo(log);

        await Recompute(repo, Day1);
        Assert.True(Row(repo, Day1).AdvancesStreak);

        // The मुकादम corrects his own record: the version moves on and the confirmation no longer covers it
        // (the same re-open ReviseLogContentHandler and MoveDailyLogHandler apply).
        log.NoteContentChanged();
        var outcome = MaterialChangeReopen.Apply(log, Mukadam, AppRole.Mukadam, isCreator: true, Now.AddHours(-1), new Ids());
        await Recompute(repo, Day1);

        Assert.NotNull(outcome.ReOpen);
        Assert.False(outcome.ReAttested);
        Assert.Equal(VerificationStatus.Draft, log.CurrentVerificationStatus);
        Assert.False(Row(repo, Day1).AdvancesStreak);
    }

    [Fact]
    public async Task Streak_OwnerOwnRecord_AdvancesOnSave()
    {
        // D-44: the primary owner's own save IS his confirmation (the create path's self-attestation), so his days
        // work exactly as before. A co-owner's own save is not, and his day waits like anyone else's.
        var ownerLog = OwnerSavedLog(Day1);
        var coOwnerLog = WorkLog(Guid.Parse("3a100000-0000-0000-0000-000000000004"), Day2);
        Assert.False(coOwnerLog.TrySelfVerifyAsCreator(Guid.NewGuid(), Guid.NewGuid(), AppRole.SecondaryOwner, Now));
        var repo = Repo(ownerLog, coOwnerLog);

        await Recompute(repo, Day1);
        await Recompute(repo, Day2);

        Assert.Equal(VerificationStatus.Verified, ownerLog.CurrentVerificationStatus);
        Assert.True(Row(repo, Day1).AdvancesStreak);
        Assert.False(Row(repo, Day2).AdvancesStreak);
    }

    [Fact]
    public async Task Streak_OneOfTwoRecordsConfirmed_DayAdvances()
    {
        var repo = Repo(OwnerSavedLog(Day1), WorkLog(Mukadam, Day1));

        await Recompute(repo, Day1);

        Assert.True(Row(repo, Day1).AdvancesStreak);
    }

    [Fact]
    public async Task Points_Unchanged_ByConfirmation_ThroughTheRecompute()
    {
        var log = WorkLog(Mukadam, Day1);
        var repo = Repo(log);

        await Recompute(repo, Day1);
        var before = Snapshot(Row(repo, Day1));

        OwnerConfirms(log, Now.AddHours(-1));
        await Recompute(repo, Day1);
        var after = Snapshot(Row(repo, Day1));

        Assert.False(before.AdvancesStreak);
        Assert.True(after.AdvancesStreak);
        Assert.Equal(before with { AdvancesStreak = true }, after);
    }

    // ── the pure rule (RichnessStamper) ──────────────────────────────────────

    [Fact]
    public async Task Streak_DeclaredNoWork_CountsOnlyWhenConfirmed()
    {
        // Through the recompute (fix pass 1, B002): a STORED no-work record — a मुकादम's day stopped by rain, a full-day
        // blocker with no work — is a declared no-work day that advances, but only once it is confirmed.
        var log = NoWorkLog(Mukadam, Day1);
        var repo = Repo(log);
        repo.CapturedDisturbances.Add(DisturbanceEvent.Create(
            Guid.NewGuid(), log.Id, DisturbanceScope.FullDay, "पाऊस", severity: null, blockedSegmentsJson: null,
            weatherEventId: null, createdAtUtc: Day1.ToDateTime(new TimeOnly(7, 0), DateTimeKind.Utc),
            cause: DisturbanceCause.Weather));

        await Recompute(repo, Day1);
        var before = Row(repo, Day1);
        Assert.Equal(DayClassification.DeclaredNoWorkDay, before.DayClassification);
        Assert.Equal("weather", before.NoWorkReasonCode);
        Assert.False(before.AdvancesStreak);

        OwnerConfirms(log, Now.AddHours(-1));
        await Recompute(repo, Day1);
        var after = Row(repo, Day1);
        Assert.Equal(DayClassification.DeclaredNoWorkDay, after.DayClassification);
        Assert.True(after.AdvancesStreak);
        Assert.Equal(before.ShramPointsEarned, after.ShramPointsEarned);

        // And the pure rule the recompute applies. An external blocker (weather) is a declared no-work day: it
        // advances, but only as a confirmed record.
        var confirmed = RichnessStamper.Stamp(DayClassification.DeclaredNoWorkDay, Sig(noWorkCode: "weather"), dayHasConfirmedRecord: true);
        var unconfirmed = RichnessStamper.Stamp(DayClassification.DeclaredNoWorkDay, Sig(noWorkCode: "weather"), dayHasConfirmedRecord: false);

        Assert.Equal(DfesTuning.Streak.AdvanceOnDeclaredNoWork, confirmed.AdvancesStreak);
        Assert.True(confirmed.AdvancesStreak);
        Assert.False(unconfirmed.AdvancesStreak);
        Assert.Equal(confirmed.ShramPointsEarned, unconfirmed.ShramPointsEarned);
    }

    [Fact]
    public async Task Streak_RestDay_StillNeutral_ThroughTheRecompute()
    {
        // A stored rest day ("no work planned") stays neutral, confirmed or not.
        var log = NoWorkLog(Owner, Day1);
        log.SetDayOutcome("NO_WORK_PLANNED");
        Assert.True(log.TrySelfVerifyAsCreator(Guid.NewGuid(), Guid.NewGuid(), AppRole.PrimaryOwner,
            Day1.ToDateTime(new TimeOnly(6, 1), DateTimeKind.Utc)));
        var repo = Repo(log);

        await Recompute(repo, Day1);

        Assert.Equal(DayClassification.DeclaredNoWorkDay, Row(repo, Day1).DayClassification);
        Assert.Equal("rest", Row(repo, Day1).NoWorkReasonCode);
        Assert.False(Row(repo, Day1).AdvancesStreak);
    }

    [Fact]
    public void Streak_RestDay_StillNeutral()
    {
        foreach (var confirmed in new[] { true, false })
        {
            var rest = RichnessStamper.Stamp(DayClassification.DeclaredNoWorkDay, Sig(noWorkCode: "rest"), confirmed);
            Assert.False(rest.AdvancesStreak);
            Assert.Equal(DfesTuning.Points.NoWork, rest.ShramPointsEarned);
        }

        // Neutral in the fold too: a rest day between two confirmed days neither adds nor breaks.
        var days = new[]
        {
            Aggregate(Day1, DayClassification.BasicWorkDay, advancesStreak: true),
            Aggregate(Day2, DayClassification.DeclaredNoWorkDay, advancesStreak: false),
            Aggregate(Day2.AddDays(1), DayClassification.BasicWorkDay, advancesStreak: true),
        };
        Assert.Equal(2, FarmerEngagementProjection.Fold(days).CurrentStreak);
    }

    public static IEnumerable<object[]> EveryClassification() =>
        Enum.GetValues<DayClassification>().Select(c => new object[] { c });

    [Theory]
    [MemberData(nameof(EveryClassification))]
    public void Points_Unchanged_ByConfirmation(DayClassification classification)
    {
        foreach (var signals in new[] { Sig(), Sig(obs: true, learning: true, followup: true), Sig(noWorkCode: "weather"), Sig(noWorkCode: "rest") })
        {
            var confirmed = RichnessStamper.Stamp(classification, signals, dayHasConfirmedRecord: true);
            var unconfirmed = RichnessStamper.Stamp(classification, signals, dayHasConfirmedRecord: false);

            Assert.Equal(confirmed.ShramPointsEarned, unconfirmed.ShramPointsEarned);
            Assert.Equal(confirmed.AdvancesBar, unconfirmed.AdvancesBar);
            Assert.Equal(confirmed.RewardReasonsJson, unconfirmed.RewardReasonsJson);
            Assert.False(unconfirmed.AdvancesStreak);
        }
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private readonly record struct RowSnapshot(
        DayClassification Classification, int Points, bool AdvancesBar, bool AdvancesStreak, string? Reasons);

    private static RowSnapshot Snapshot(DailyRichnessAggregate a) =>
        new(a.DayClassification, a.ShramPointsEarned, a.AdvancesBar, a.AdvancesStreak, a.RewardReasonsJson);

    private static ClassifierSignals Sig(bool obs = false, bool learning = false, bool followup = false, string? noWorkCode = null)
        => new(true, false, false, obs, learning, false, false, false, noWorkCode, null, null, null, obs, followup);

    private static DailyRichnessAggregate Aggregate(DateOnly day, DayClassification classification, bool advancesStreak)
    {
        var a = DailyRichnessAggregate.Create(Guid.NewGuid(), Farm, day, "Asia/Kolkata", DateTimeOffset.UtcNow);
        a.ApplyDerivation(null, null, null, classification, default, advancesStreak, false, 0, "{}", null,
            DfesTuning.ScoreEngineVersion, "{}");
        return a;
    }

    private static DailyLog WorkLog(Guid speaker, DateOnly day)
    {
        var created = day.ToDateTime(new TimeOnly(6, 0), DateTimeKind.Utc);
        var log = DailyLog.Create(
            Guid.NewGuid(), new FarmId(Farm), Guid.NewGuid(), Guid.NewGuid(), new UserId(speaker),
            day, idempotencyKey: null, location: null, createdAtUtc: created);
        log.AddTask(Guid.NewGuid(), "spray", notes: null, occurredAtUtc: created);
        return log;
    }

    private static DailyLog NoWorkLog(Guid speaker, DateOnly day) => DailyLog.Create(
        Guid.NewGuid(), new FarmId(Farm), Guid.NewGuid(), Guid.NewGuid(), new UserId(speaker),
        day, idempotencyKey: null, location: null, createdAtUtc: day.ToDateTime(new TimeOnly(6, 0), DateTimeKind.Utc));

    private static DailyLog OwnerSavedLog(DateOnly day)
    {
        var log = WorkLog(Owner, day);
        Assert.True(log.TrySelfVerifyAsCreator(Guid.NewGuid(), Guid.NewGuid(), AppRole.PrimaryOwner,
            day.ToDateTime(new TimeOnly(6, 1), DateTimeKind.Utc)));
        return log;
    }

    private static void OwnerConfirms(DailyLog log, DateTime at)
    {
        log.VerifyReachingTarget(VerificationStatus.Verified, null, AppRole.PrimaryOwner, Owner, at,
            targetEventId: Guid.NewGuid(), enRouteEventId: Guid.NewGuid());
        Assert.Equal(VerificationStatus.Verified, log.CurrentVerificationStatus);
    }

    private static InMemoryShramSafalRepository Repo(params DailyLog[] logs)
    {
        var repo = new InMemoryShramSafalRepository();
        foreach (var log in logs)
        {
            repo.AddLog(log);
        }

        return repo;
    }

    private static Task Recompute(InMemoryShramSafalRepository repo, DateOnly day) =>
        new DailyRichnessDerivationService(repo, new NoAiJobs(), new Ids(), new FixedClock(Now)).RecomputeAsync(Farm, day);

    private static DailyRichnessAggregate Row(InMemoryShramSafalRepository repo, DateOnly day) =>
        repo.SeededRichnessAggregates.Single(a => a.LocalDate == day);

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

    private sealed class Ids : IIdGenerator
    {
        public Guid New() => Guid.NewGuid();
    }
}
