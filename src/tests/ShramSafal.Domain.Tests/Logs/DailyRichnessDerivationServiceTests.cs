using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using ShramSafal.Application.Ports.External;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Domain.AI;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Crops;
using ShramSafal.Domain.Dfes;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Tests.Common;
using Xunit;

namespace ShramSafal.Domain.Tests.Logs;

public sealed class DailyRichnessDerivationServiceTests
{
    private static readonly Guid Farm = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid Plot = Guid.Parse("33333333-3333-3333-3333-333333333333");
    private static readonly Guid Cycle = Guid.Parse("44444444-4444-4444-4444-444444444444");
    private static readonly Guid Op = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid JobId = Guid.Parse("66666666-6666-6666-6666-666666666666");
    private static readonly DateOnly Day = new(2026, 7, 12);
    private static readonly DateTime Now = new(2026, 7, 12, 6, 0, 0, DateTimeKind.Utc);

    // A rich voice day: real work (inputs+dose+cost) + an Observation-type note.
    private const string RichJson = """
    {
      "summary": "sprayed and noticed leaf curl",
      "dayOutcome": "WORK_RECORDED",
      "cropActivities": [ { "title": "spray", "targetPlotName": "North" } ],
      "inputs": [ { "productName": "MKP", "targetPlotName": "North",
                    "mix": [ { "productName": "MKP", "dose": 4, "unit": "kg" } ] } ],
      "labour": [ { "wagePerPerson": 350, "totalCost": 700, "targetPlotName": "North" } ],
      "machinery": [], "irrigation": [], "observations": []
    }
    """;

    [Fact]
    public async Task RichDay_writes_RichWorkDay_aggregate_and_is_idempotent()
    {
        var job = MakeVoiceJob(RichJson);
        var log = DailyLog.Create(
            Guid.NewGuid(), new FarmId(Farm), Plot, Cycle, new UserId(Op), Day,
            idempotencyKey: null, location: null, createdAtUtc: Now,
            provenance: Provenance.Manual("test"), sourceAiJobId: JobId);
        var obs = ObservationEvent.Create(
            Guid.NewGuid(), log.Id, Plot,
            ObservationNoteType.Observation, ObservationSeverity.Normal, ObservationSource.Voice,
            textRaw: "leaf curl on north block", textCleaned: null, tagsJson: null,
            linkedActivityId: null, createdAtUtc: Now);

        var repo = new RichnessRepo(logs: [log], observations: [obs], plotCount: 2);
        var jobs = new SingleAiJob(job);
        var sut = new DailyRichnessDerivationService(repo, jobs, new SeqIds(), new FixedClock(Now));

        await sut.RecomputeAsync(Farm, Day);
        await sut.RecomputeAsync(Farm, Day); // second run must overwrite, not duplicate

        repo.Aggregates.Should().HaveCount(1);
        var agg = repo.Aggregates.Single();
        agg.DayClassification.Should().Be(DayClassification.RichWorkDay);
        agg.HasWork.Should().BeTrue();
        agg.AdvancesBar.Should().BeTrue();
        agg.ShramPointsEarned.Should().Be(
            System.Math.Min(DfesTuning.Points.Rich + DfesTuning.Points.ObservationBonus,
                            DfesTuning.DailyPointCap));
        agg.ScoreEngineVersion.Should().Be(DfesTuning.ScoreEngineVersion);
        agg.RewardReasonsJson.Should().NotBeNullOrWhiteSpace();
    }

    [Fact]
    public async Task SilentDay_writes_UnaccountedDay_neutral()
    {
        var log = DailyLog.Create(
            Guid.NewGuid(), new FarmId(Farm), Plot, Cycle, new UserId(Op), Day,
            idempotencyKey: null, location: null, createdAtUtc: Now,
            provenance: Provenance.Manual("test"), sourceAiJobId: null);
        var repo = new RichnessRepo(logs: [log], observations: [], plotCount: 1);
        var sut = new DailyRichnessDerivationService(repo, new SingleAiJob(null), new SeqIds(), new FixedClock(Now));

        await sut.RecomputeAsync(Farm, Day);

        var agg = repo.Aggregates.Single();
        agg.DayClassification.Should().Be(DayClassification.UnaccountedDay);
        agg.AdvancesStreak.Should().BeFalse();
        agg.ShramPointsEarned.Should().Be(0);
    }

    // ── scorer bug repro (spec: dfes-companion-2026-07-11) ─────────────────────
    // A farmer logged a real day of work (spray + fertilizer + hired-worker
    // pruning) via LogTask rows (AddLogTaskHandler), but the log has NO
    // SourceAiJobId (manual entry / offline sync / a dropped voice provenance
    // link). Before the fix, DailyRichnessDerivationService only ever looked at
    // AI-job NormalizedResultJson, so this genuinely-recorded day scored
    // UnaccountedDay / HasWork=false — "nothing happened" for a farmer who
    // worked all day. The fix must fall back to the log's real persisted
    // LogTask rows so HasWork becomes true and the day is no longer
    // UnaccountedDay.
    [Fact]
    public async Task ManualLog_withRealPersistedTasks_butNoAiJobLink_isNeverUnaccountedDay()
    {
        var log = DailyLog.Create(
            Guid.NewGuid(), new FarmId(Farm), Plot, Cycle, new UserId(Op), Day,
            idempotencyKey: null, location: null, createdAtUtc: Now,
            provenance: Provenance.Manual("test"), sourceAiJobId: null); // no AI-job link
        log.AddTask(Guid.NewGuid(), "Ethrel spray", notes: "4ml", occurredAtUtc: Now);
        log.AddTask(Guid.NewGuid(), "0-52-34 fertilizer application", notes: "10g", occurredAtUtc: Now);
        log.AddTask(Guid.NewGuid(), "Pruning (4 hired workers)", notes: null, occurredAtUtc: Now);

        var repo = new RichnessRepo(logs: [log], observations: [], plotCount: 1);
        var sut = new DailyRichnessDerivationService(repo, new SingleAiJob(null), new SeqIds(), new FixedClock(Now));

        await sut.RecomputeAsync(Farm, Day);

        var agg = repo.Aggregates.Single();
        agg.HasWork.Should().BeTrue();
        agg.DayClassification.Should().NotBe(DayClassification.UnaccountedDay);
    }

    [Fact]
    public async Task ManualLog_withOnlySkippedTasks_staysUnaccountedDay_noFabrication()
    {
        // Skipped/Delayed tasks explicitly mean the work did NOT happen — the
        // fallback must NOT fabricate a "work happened" signal from them.
        var log = DailyLog.Create(
            Guid.NewGuid(), new FarmId(Farm), Plot, Cycle, new UserId(Op), Day,
            idempotencyKey: null, location: null, createdAtUtc: Now,
            provenance: Provenance.Manual("test"), sourceAiJobId: null);
        log.AddTask(Guid.NewGuid(), "spray", notes: null, occurredAtUtc: Now,
            executionStatus: ExecutionStatus.Skipped, deviationReasonCode: "rain");

        var repo = new RichnessRepo(logs: [log], observations: [], plotCount: 1);
        var sut = new DailyRichnessDerivationService(repo, new SingleAiJob(null), new SeqIds(), new FixedClock(Now));

        await sut.RecomputeAsync(Farm, Day);

        var agg = repo.Aggregates.Single();
        agg.HasWork.Should().BeFalse();
        agg.DayClassification.Should().Be(DayClassification.UnaccountedDay);
    }

    [Fact]
    public async Task RichDay_withAiJobLink_ignoresPersistedTasks_AiJsonPathUnchanged()
    {
        // The AI-JSON path must stay authoritative when present — the fallback
        // must never run (and never be needed) when a usable root was already
        // contributed from the AiJob's NormalizedResultJson.
        var job = MakeVoiceJob(RichJson);
        var log = DailyLog.Create(
            Guid.NewGuid(), new FarmId(Farm), Plot, Cycle, new UserId(Op), Day,
            idempotencyKey: null, location: null, createdAtUtc: Now,
            provenance: Provenance.Manual("test"), sourceAiJobId: JobId);
        // No LogTask rows at all — the AI JSON alone must still drive RichWorkDay.
        var obs = ObservationEvent.Create(
            Guid.NewGuid(), log.Id, Plot,
            ObservationNoteType.Observation, ObservationSeverity.Normal, ObservationSource.Voice,
            textRaw: "leaf curl on north block", textCleaned: null, tagsJson: null,
            linkedActivityId: null, createdAtUtc: Now);
        var repo = new RichnessRepo(logs: [log], observations: [obs], plotCount: 1);
        var sut = new DailyRichnessDerivationService(repo, new SingleAiJob(job), new SeqIds(), new FixedClock(Now));

        await sut.RecomputeAsync(Farm, Day);

        var agg = repo.Aggregates.Single();
        agg.HasWork.Should().BeTrue();
        agg.DayClassification.Should().Be(DayClassification.RichWorkDay);
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static AiJob MakeVoiceJob(string? normalizedJson)
    {
        var job = AiJob.Create(
            id: JobId, idempotencyKey: "voice-key-1",
            operationType: AiOperationType.VoiceToStructuredLog,
            userId: Op, farmId: Farm,
            inputContentHash: null, rawInputRef: null, inputSessionMetadataJson: null,
            provenance: new Provenance(Source.Voice, "gemini-2.5-flash", "v3.2.0", null, "1.0.0"));
        if (!string.IsNullOrWhiteSpace(normalizedJson))
        {
            var attempt = job.AddAttempt(AiProviderType.Gemini);
            job.MarkSucceeded(normalizedJson, attempt);
        }
        return job;
    }

    // Repo double extends the shared strict fake; overrides ONLY the 5 members
    // RecomputeAsync touches.
    private sealed class RichnessRepo(
        IReadOnlyList<DailyLog> logs, IReadOnlyList<ObservationEvent> observations, int plotCount)
        : FakeShramSafalRepository
    {
        public List<DailyRichnessAggregate> Aggregates { get; } = [];

        public override Task<IReadOnlyList<DailyLog>> GetDailyLogsForFarmDateAsync(Guid farmId, DateOnly localDate, CancellationToken ct = default)
            => Task.FromResult<IReadOnlyList<DailyLog>>(
                logs.Where(l => l.FarmId.Value == farmId && l.LogDate == localDate).ToList());

        public override Task<IReadOnlyList<ObservationEvent>> GetObservationEventsForDailyLogsAsync(IReadOnlyCollection<Guid> dailyLogIds, CancellationToken ct = default)
            => Task.FromResult<IReadOnlyList<ObservationEvent>>(
                observations.Where(o => dailyLogIds.Contains(o.DailyLogId)).ToList());

        public override Task<List<Plot>> GetPlotsByFarmIdAsync(Guid farmId, CancellationToken ct = default)
            => Task.FromResult(Enumerable.Range(0, plotCount)
                .Select(_ => ShramSafal.Domain.Farms.Plot.Create(Guid.NewGuid(), new FarmId(farmId), "P", 1m, DateTime.UtcNow)).ToList());

        public override Task<DailyRichnessAggregate?> GetDailyRichnessAggregateAsync(Guid farmId, DateOnly localDate, CancellationToken ct = default)
            => Task.FromResult(Aggregates.FirstOrDefault(a => a.FarmId == farmId && a.LocalDate == localDate));

        // FIX (dfes-companion-2026-07-11) — RecomputeAsync now uses the TRACKED accessor.
        // The in-memory list already returns the live mutable object, so this delegates to
        // the same store. NOTE: that equivalence means this double CANNOT detect the
        // detached-write bug; the real-EF proof lives in ShramSafal.Sync.IntegrationTests/Dfes.
        public override Task<DailyRichnessAggregate?> GetDailyRichnessAggregateForUpdateAsync(Guid farmId, DateOnly localDate, CancellationToken ct = default)
            => GetDailyRichnessAggregateAsync(farmId, localDate, ct);

        public override Task AddDailyRichnessAggregateAsync(DailyRichnessAggregate aggregate, CancellationToken ct = default)
        {
            Aggregates.Add(aggregate);
            return Task.CompletedTask;
        }
    }

    private sealed class SingleAiJob(AiJob? job) : IAiJobRepository
    {
        public Task<AiJob?> GetByIdAsync(Guid jobId, CancellationToken ct = default) => Task.FromResult(job);
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
