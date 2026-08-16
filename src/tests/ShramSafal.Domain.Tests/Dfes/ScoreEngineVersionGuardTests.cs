// spec: dfes-companion-2026-07-11 (wave-3.5)
using System.Text.Json;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using ShramSafal.Application.Ports.External;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Domain.AI;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Dfes;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Tests.Common;
using Xunit;

namespace ShramSafal.Domain.Tests.Dfes;

/// <summary>
/// SPEC RULING 3 (2026-08-15) — <b>do not silently change historical numbers.</b>
///
/// <para><b>Why a guard is needed at all.</b> <c>RecomputeAsync</c> genuinely reaches old
/// days: a late-synced log recomputes ITS date (<c>CreateDailyLogHandler</c>) and answering
/// a question recomputes that day (<c>RecordQuestionEventHandler</c>). Without a guard, a
/// farmer's June number could move because we deployed in August — for reasons that have
/// nothing to do with anything he did.</para>
///
/// <para><b>The mechanism.</b> The <c>score_engine_version</c> already stamped on the day's
/// aggregate is read BEFORE scoring, ridden into <c>DfesLensExtractor.DayData</c>, and
/// turned into one boolean, <c>appliesNewRules</c>. Every Wave-3 scoring change reads that
/// boolean: 3.5's weather rule (here), 3.4's product-based water rule, 3.11's observation
/// anchoring. A frozen day is then re-stamped with its ORIGINAL version, never
/// <c>dfes-4</c> — otherwise the freeze would leak away one recompute at a time.</para>
///
/// <para><b>The tests are paired on purpose.</b> "The number did not move" is trivially
/// satisfiable by an engine that changed nothing at all, so every freeze proof below is
/// accompanied by a proof that the new engine really does produce a different number for
/// the same day. Without that pairing this whole file would be vacuous.</para>
///
/// <para><b>The wave-2.2 window, measured rather than assumed.</b> Commits
/// <c>355192b3</c> / <c>c2a11e1b</c> landed before this guard existed and their own commit
/// bodies warn that "days recomputed between now and then will score on the new rule with
/// no version stamp distinguishing them — 3.5 must account for the gap". Reading the
/// diffs: both changed the PARSE/WRITE path (<c>AiResponseNormalizer</c>,
/// <c>GeminiParsingService</c>) from <c>EnsureString(root, "summary", "Log processed.")</c>
/// to <c>string.Empty</c>. Neither touched <c>DfesLensExtractor.CoverWhat</c>. So 2.2
/// changed what is WRITTEN into a new AI job, not how a STORED day is scored — a day
/// parsed before 2.2 still carries the sentence in its persisted
/// <c>NormalizedResultJson</c> and still scores WHAT at 0.5 on a recompute today. Nothing
/// drifts, so there is nothing for the guard to freeze and the missing stamp costs
/// nothing. Pinned by
/// <see cref="The_wave_22_window_needs_no_guard_because_22_never_rescored_anything"/>.</para>
/// </summary>
public sealed class ScoreEngineVersionGuardTests
{
    private static readonly Guid Farm = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid Plot = Guid.Parse("33333333-3333-3333-3333-333333333333");
    private static readonly Guid Cycle = Guid.Parse("44444444-4444-4444-4444-444444444444");
    private static readonly Guid Op = Guid.Parse("11111111-1111-1111-1111-111111111111");

    private static readonly DateOnly Day = new(2026, 7, 12);

    /// <summary>06:00 UTC = 11:30 IST — inside 2026-07-12 local.</summary>
    private static readonly DateTime Now = new(2026, 7, 12, 6, 0, 0, DateTimeKind.Utc);

    /// <summary>
    /// A spraying day the farmer said nothing about the weather on, and for which the app
    /// DID capture a real provider reading. Under dfes-3 WEATHER is owed at coverage 0 and
    /// drags the number down; under dfes-4 it leaves the denominator.
    /// </summary>
    private const string SprayDay = """
    { "summary": "favarni keli", "dayOutcome": "WORK_RECORDED",
      "cropActivities": [ { "title": "spray" } ],
      "inputs": [], "irrigation": [], "labour": [], "machinery": [], "activityExpenses": [] }
    """;

    // ── 1. the freeze, and the proof it is freezing something real ───────────

    [Fact]
    public void A_dfes3_day_recomputed_after_this_plan_keeps_its_original_number()
    {
        var underDfes3 = Score(scoredUnder: "dfes-3");
        var fresh = Score(scoredUnder: null);

        underDfes3.Should().Be(Dfes3Baseline(),
            "a historical day must not drift when the engine changes — it must score EXACTLY what "
            + "an engine with no dfes-4 rules would give it");
        fresh.Should().NotBe(underDfes3,
            "and the new engine must actually be different on this day, or the freeze above proves nothing");
    }

    [Fact]
    public void A_dfes4_day_recomputed_stays_on_the_new_rules()
        => Score(scoredUnder: DfesTuning.ScoreEngineVersion)
            .Should().Be(Score(scoredUnder: null),
                "a day already on this engine is rescored by it — the guard freezes history, "
                + "it does not freeze the present");

    [Fact]
    public void Every_engine_older_than_the_current_one_is_frozen()
    {
        // Written as a loop over ALL prior versions rather than dfes-3 alone: the guard
        // compares against DfesTuning.ScoreEngineVersion, so the next bump must freeze
        // dfes-4 days automatically without anyone remembering to add a case here.
        foreach (var old in new[] { "dfes-1", "dfes-2", "dfes-3" })
        {
            Score(scoredUnder: old).Should().Be(Dfes3Baseline(),
                "a day stamped {0} predates the dfes-4 rules and must keep its own number", old);
        }
    }

    // ── 2. the stamp — a frozen day must not claim an engine it never ran ────

    [Fact]
    public async Task A_frozen_day_keeps_its_own_version_stamp()
    {
        var stamped = await StampWrittenForAsync(scoredUnder: "dfes-3");

        stamped.Should().Be("dfes-3",
            "re-stamping a frozen day dfes-4 would make the guard read 'dfes-4' on the NEXT "
            + "recompute and rescore it after all — the freeze would leak away one recompute at a time");
    }

    [Fact]
    public async Task A_day_this_engine_has_never_scored_is_stamped_with_the_current_engine()
    {
        var stamped = await StampWrittenForAsync(scoredUnder: null);

        stamped.Should().Be(DfesTuning.ScoreEngineVersion);
        stamped.Should().Be("dfes-4", "wave-3.5 bumps the engine exactly once, here");
    }

    [Fact]
    public async Task The_stamp_survives_repeated_recomputes_of_a_frozen_day()
    {
        // The failure this pins is a slow leak, not a single wrong write: if the freeze
        // held on run 1 but the stamp did not, run 2 would see "dfes-4" and rescore.
        var repo = await RecomputeAsync(scoredUnder: "dfes-3", runs: 3);

        repo.Aggregates.Should().HaveCount(1);
        repo.Aggregates.Single().ScoreEngineVersion.Should().Be("dfes-3");
    }

    // ── 3. the wave-2.2 window, stated explicitly rather than left implicit ──

    // A silent day as it was STORED before wave-2.2: the server's own sentence sitting in
    // the summary field of the AI job's NormalizedResultJson.
    private const string SilentDayStoredBefore22 = """
    { "summary": "Log processed.", "dayOutcome": "WORK_RECORDED",
      "cropActivities": [], "inputs": [], "irrigation": [], "labour": [],
      "machinery": [], "activityExpenses": [] }
    """;

    // The same silent day as it is STORED after wave-2.2 — EnsureString now writes
    // string.Empty, so there is no sentence to credit.
    private const string SilentDayStoredAfter22 = """
    { "summary": "", "dayOutcome": "WORK_RECORDED",
      "cropActivities": [], "inputs": [], "irrigation": [], "labour": [],
      "machinery": [], "activityExpenses": [] }
    """;

    [Theory]
    [InlineData("dfes-3")]
    [InlineData("dfes-4")]
    [InlineData(null)]
    public void The_wave_22_window_needs_no_guard_because_22_never_rescored_anything(string? scoredUnder)
    {
        // MEASURED, not assumed. The dispatch flagged that wave-2.2 (355192b3 / c2a11e1b)
        // changed CoverWhat scoring before this guard existed, leaving days recomputed in
        // that window with no distinguishing stamp. Reading the actual diffs: 2.2 changed
        // AiResponseNormalizer.cs:64 and GeminiParsingService.cs:138 — the PARSE/WRITE
        // path — from EnsureString(root, "summary", "Log processed.") to string.Empty.
        // It did NOT touch DfesLensExtractor.CoverWhat, which still credits
        // `hasSummary ? 0.5 : 0.0` exactly as it did.
        //
        // The consequence is the whole answer to that concern: 2.2 changed what gets
        // WRITTEN into a NEW AI job, not how a STORED day is scored. RecomputeAsync reads
        // the job's already-persisted NormalizedResultJson, so a day parsed before 2.2
        // still carries "Log processed." in storage and still scores WHAT at 0.5 on a
        // recompute today — the same number it always had. A day parsed after 2.2 never
        // had the sentence. Neither can drift, so there is nothing for the version guard
        // to freeze, and the missing stamp costs nothing.
        //
        // Asserted across ALL THREE version states so this stays true when the guard is
        // in play, not just when it happens to be off.
        Coverage(Build(SilentDayStoredBefore22, [], scoredUnder), "WHAT").Should().Be(0.5,
            "a day STORED before 2.2 keeps the sentence in its NormalizedResultJson, so its "
            + "number does not move on recompute — 2.2 was a write-path fix, not a rescore");

        Coverage(Build(SilentDayStoredAfter22, [], scoredUnder), "WHAT").Should().Be(0.0,
            "a day stored after 2.2 has no server sentence to credit (doctrine P4)");
    }

    private static double Coverage(LensInput input, string name)
        => input.Possible!.Single(d => d.Name == name).Coverage;

    // ── harness ──────────────────────────────────────────────────────────────

    /// <summary>The /10 for the spray day, with the app's own weather available.</summary>
    private static int? Score(string? scoredUnder)
        => DayUnderstandingScore.From(
            Build(SprayDay, [Stamp(WeatherProvider.TomorrowIo, Plot, Now)], scoredUnder));

    /// <summary>
    /// What the SAME day scores on an engine with no dfes-4 rules at all — modelled by
    /// giving it no system weather, which is the only input the dfes-4 weather rule reads.
    /// Derived rather than hard-coded so this stays honest if the roster's weights move,
    /// with the literal receipt asserted alongside it.
    /// </summary>
    private static int? Dfes3Baseline()
    {
        var baseline = DayUnderstandingScore.From(Build(SprayDay, [], scoredUnder: null));
        baseline.Should().Be(2, "receipt: a bare spray day with WEATHER owed and uncovered scores 2/10");
        return baseline;
    }

    private static LensInput Build(string json, IReadOnlyList<WeatherStamp> systemWeather, string? scoredUnder)
    {
        using var doc = JsonDocument.Parse(json);
        var probe = new DfesLensExtractor.LensScoresProbe();
        var (input, _) = DfesLensExtractor.Build(
            new DfesLensExtractor.DayData(
                [doc.RootElement], [], null, null, systemWeather, Plot, Day, scoredUnder),
            probe,
            clientDatePlausible: true);
        return input;
    }

    private static WeatherStamp Stamp(WeatherProvider provider, Guid? plot, DateTime observedUtc)
        => WeatherStamp.Create(
            Guid.NewGuid(), Guid.NewGuid(), plot,
            timestampLocal: observedUtc, timestampProvider: observedUtc, provider: provider,
            tempC: 29.5m, humidity: 62m, windKph: 7.4m, precipMm: 0m, cloudCoverPct: 20m,
            conditionText: "Clear", iconCode: "1000", rainProbNext6h: 5m,
            windGustKph: null, soilMoisture0To10: null, uvIndex: null, alertsJson: null,
            createdAtUtc: observedUtc);

    private static async Task<string?> StampWrittenForAsync(string? scoredUnder)
        => (await RecomputeAsync(scoredUnder, runs: 1)).Aggregates.Single().ScoreEngineVersion;

    /// <summary>
    /// Drives the REAL <c>DailyRichnessDerivationService</c>, because the stamping decision
    /// lives there and not in the extractor. Seeds the day's aggregate with
    /// <paramref name="scoredUnder"/> when one is given, so the run is a genuine
    /// read-modify-write of an existing row rather than a create.
    /// </summary>
    private static async Task<RichnessRepo> RecomputeAsync(string? scoredUnder, int runs)
    {
        var log = DailyLog.Create(
            Guid.NewGuid(), new FarmId(Farm), Plot, Cycle, new UserId(Op), Day,
            idempotencyKey: null, location: null, createdAtUtc: Now,
            provenance: Provenance.Manual("test"), sourceAiJobId: null);
        log.AddTask(Guid.NewGuid(), "Spraying", notes: null, occurredAtUtc: Now,
            executionStatus: ExecutionStatus.Completed);

        var repo = new RichnessRepo(logs: [log], weather: [Stamp(WeatherProvider.TomorrowIo, Plot, Now)]);
        if (scoredUnder is not null)
        {
            repo.SeedExistingAggregate(Farm, Day, scoredUnder, Now);
        }

        var sut = new DailyRichnessDerivationService(repo, new NoAiJobs(), new SeqIds(), new FixedClock(Now));
        for (var i = 0; i < runs; i++)
        {
            await sut.RecomputeAsync(Farm, Day);
        }

        return repo;
    }

    // Extends the shared strict fake; overrides ONLY what RecomputeAsync touches.
    private sealed class RichnessRepo(IReadOnlyList<DailyLog> logs, IReadOnlyList<WeatherStamp> weather)
        : FakeShramSafalRepository
    {
        public List<DailyRichnessAggregate> Aggregates { get; } = [];

        /// <summary>
        /// A day this engine has ALREADY scored, stamped with <paramref name="version"/>.
        /// Built through the real <c>Create</c> + <c>ApplyDerivation</c> path so the row
        /// carries a version the same way a production row does.
        /// </summary>
        public void SeedExistingAggregate(Guid farmId, DateOnly localDate, string version, DateTime at)
        {
            var agg = DailyRichnessAggregate.Create(Guid.NewGuid(), farmId, localDate, "Asia/Kolkata", at);
            agg.ApplyDerivation(
                0, 0, 0, DayClassification.UnaccountedDay,
                new ContributingFlags(false, false, false, false, false, false),
                false, false, 0, "[]", null, version, "{}");
            Aggregates.Add(agg);
        }

        public override Task<IReadOnlyList<DailyLog>> GetDailyLogsForFarmDateAsync(Guid farmId, DateOnly localDate, CancellationToken ct = default)
            => Task.FromResult<IReadOnlyList<DailyLog>>(
                logs.Where(l => l.FarmId.Value == farmId && l.LogDate == localDate).ToList());

        public override Task<IReadOnlyList<ObservationEvent>> GetObservationEventsForDailyLogsAsync(IReadOnlyCollection<Guid> dailyLogIds, CancellationToken ct = default)
            => Task.FromResult<IReadOnlyList<ObservationEvent>>([]);

        // wave-3.5 — the app's own weather for the day. Without this override the
        // interface's default empty body would apply and the dfes-4 weather rule would
        // have no input at all, so every proof in this file would pass vacuously.
        public override Task<IReadOnlyList<WeatherStamp>> GetWeatherStampsForDailyLogsAsync(IReadOnlyCollection<Guid> dailyLogIds, CancellationToken ct = default)
            => Task.FromResult(weather);

        public override Task<DailyRichnessAggregate?> GetDailyRichnessAggregateAsync(Guid farmId, DateOnly localDate, CancellationToken ct = default)
            => Task.FromResult(Aggregates.FirstOrDefault(a => a.FarmId == farmId && a.LocalDate == localDate));

        public override Task<DailyRichnessAggregate?> GetDailyRichnessAggregateForUpdateAsync(Guid farmId, DateOnly localDate, CancellationToken ct = default)
            => GetDailyRichnessAggregateAsync(farmId, localDate, ct);

        public override Task AddDailyRichnessAggregateAsync(DailyRichnessAggregate aggregate, CancellationToken ct = default)
        {
            Aggregates.Add(aggregate);
            return Task.CompletedTask;
        }
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

    private sealed class SeqIds : IIdGenerator
    {
        private int _n;
        public Guid New()
        {
            _n++;
            var bytes = new byte[16];
            BitConverter.GetBytes(_n).CopyTo(bytes, 0);
            return new Guid(bytes);
        }
    }

    private sealed class FixedClock(DateTime utcNow) : IClock
    {
        public DateTime UtcNow { get; } = utcNow;
    }
}
