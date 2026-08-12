using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Domain.AI;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Logs;
using Xunit;

namespace ShramSafal.Domain.Tests.Logs;

/// <summary>
/// LABOUR_PHASE2 P2.3 (landmine L8) — what <see cref="LedgerDerivationService"/>
/// writes for a log that names no single plot.
///
/// <para><c>DailyLog.PlotId</c> is null for BOTH <c>MultiPlot</c> and
/// <c>Farm</c>, and the two sinks in this service read a null plot in OPPOSITE
/// ways: for <c>farm_operations</c> a null plot means "no single plot was
/// named", while for <c>routine_patterns</c> a null plot is a positive claim —
/// <c>RoutinePattern.cs:49</c> spells it "farm-wide pattern", and the partial
/// unique index <c>ux_routine_patterns_farm_op_no_plot</c> enforces it as one.
/// Letting a <c>MultiPlot</c> log fall through as null would silently upgrade
/// "these two plots" into "the whole farm".</para>
///
/// <para>These are the guards for that distinction. They are reachable only
/// once a client can create a plot-less log (Phase 2b) — the point of fixing it
/// now is that all three readers go live at the same instant.</para>
/// </summary>
public sealed class LedgerDerivationPlotScopeTests
{
    private static readonly Guid FarmGuid = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid PlotA = Guid.Parse("33333333-3333-3333-3333-333333333333");
    private static readonly Guid PlotB = Guid.Parse("34333333-3333-3333-3333-333333333333");
    private static readonly Guid CropCycleGuid = Guid.Parse("44444444-4444-4444-4444-444444444444");
    private static readonly Guid AiJobGuid = Guid.Parse("66666666-6666-6666-6666-666666666666");
    private static readonly Guid OperatorUserId = Guid.Parse("11111111-1111-1111-1111-111111111111");

    private static readonly DateTime FixedNow = new(2026, 6, 20, 8, 30, 0, DateTimeKind.Utc);

    // One input (so a FarmOperation is written) and one irrigation (so the
    // RoutineMemory upsert is reached). Nothing else is needed here.
    private const string NormalizedJson = """
    {
      "inputs": [
        { "id": "in-0", "sourceText": "0:52:34 fertigation", "type": "fertilizer",
          "mix": [ { "id": "m0", "productName": "MKP", "dose": 4, "unit": "kg" } ] }
      ],
      "irrigation": [
        { "id": "ir-0", "sourceText": "4 तास पाणी दिलं", "role": "irrigation",
          "method": "drip", "source": "borewell", "durationHours": 4 }
      ]
    }
    """;

    [Fact]
    public async Task plot_scoped_log_still_names_its_plot_on_the_derived_operation_and_routine()
    {
        var repo = new InMemoryShramSafalRepository();
        var job = MakeVoiceJob();
        var log = MakePlotLog(job);

        await new LedgerDerivationService(repo).DeriveAsync(
            log, job, new SequentialIdGenerator(), new FixedClock(FixedNow));

        repo.CapturedOperations.Should().ContainSingle();
        repo.CapturedOperations.Single().PlotId.Should().Be(PlotA);

        repo.CapturedRoutinePatterns.Should().ContainSingle(p => p.OperationType == "irrigation");
        repo.CapturedRoutinePatterns.Single().PlotId.Should().Be(PlotA);
    }

    [Fact]
    public async Task farm_scoped_log_writes_a_farm_wide_routine_pattern_with_a_null_plot()
    {
        var repo = new InMemoryShramSafalRepository();
        var job = MakeVoiceJob();
        var log = MakeFarmLog(job);

        await new LedgerDerivationService(repo).DeriveAsync(
            log, job, new SequentialIdGenerator(), new FixedClock(FixedNow));

        // संपूर्ण शेत: the farmer's assertion is farm-wide and the column's null
        // MEANS farm-wide, so the two agree. Nothing is dropped and nothing is
        // invented.
        repo.CapturedRoutinePatterns.Should().ContainSingle(p => p.OperationType == "irrigation");
        repo.CapturedRoutinePatterns.Single().PlotId.Should().BeNull();
        repo.CapturedRoutinePatterns.Single().FarmId.Should().Be(FarmGuid);

        // The derived operation is written too, with no plot named — the log is
        // NOT dropped from the ledger.
        repo.CapturedOperations.Should().ContainSingle();
        repo.CapturedOperations.Single().PlotId.Should().BeNull();
    }

    [Fact]
    public async Task multi_plot_log_writes_no_routine_pattern_at_all()
    {
        var repo = new InMemoryShramSafalRepository();
        var job = MakeVoiceJob();
        var log = MakeMultiPlotLog(job);

        await new LedgerDerivationService(repo).DeriveAsync(
            log, job, new SequentialIdGenerator(), new FixedClock(FixedNow));

        // A null plot here would claim a routine for every plot on the farm,
        // including ones the farmer never named. One row per named plot would
        // assert a single stated duration of each plot individually and count
        // one log as N samples. Neither is allowed, and routine_patterns cannot
        // hold a plot SET, so nothing is written.
        repo.CapturedRoutinePatterns.Should().BeEmpty();
    }

    [Fact]
    public async Task multi_plot_log_still_records_the_work_itself()
    {
        var repo = new InMemoryShramSafalRepository();
        var job = MakeVoiceJob();
        var log = MakeMultiPlotLog(job);

        await new LedgerDerivationService(repo).DeriveAsync(
            log, job, new SequentialIdGenerator(), new FixedClock(FixedNow));

        // Withholding the DERIVED pattern must not withhold the work. The
        // irrigation entry and the farm operation are both still staged.
        repo.CapturedIrrigations.Should().ContainSingle();
        repo.CapturedOperations.Should().ContainSingle();
        repo.CapturedOperations.Single().PlotId.Should().BeNull();
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static AiJob MakeVoiceJob()
    {
        var job = AiJob.Create(
            id: AiJobGuid,
            idempotencyKey: "voice-key-p23",
            operationType: AiOperationType.VoiceToStructuredLog,
            userId: OperatorUserId,
            farmId: FarmGuid,
            inputContentHash: null,
            rawInputRef: null,
            inputSessionMetadataJson: null,
            provenance: new Provenance(
                source: Source.Voice,
                modelVersion: "gemini-2.5-flash",
                promptVersion: "v3.2.0",
                promptContentHash: null,
                appVersion: "1.0.0"));

        var attempt = job.AddAttempt(AiProviderType.Gemini);
        job.MarkSucceeded(NormalizedJson, attempt);
        return job;
    }

    private static Provenance VoiceProvenance()
        => new(Source.Voice, "gemini-2.5-flash", "v3.2.0", null, "1.0.0");

    private static DailyLog MakePlotLog(AiJob job)
        => DailyLog.Create(
            id: Guid.NewGuid(),
            farmId: new FarmId(FarmGuid),
            plotId: PlotA,
            cropCycleId: CropCycleGuid,
            operatorUserId: new UserId(OperatorUserId),
            logDate: new DateOnly(2026, 6, 20),
            idempotencyKey: null,
            location: null,
            createdAtUtc: FixedNow,
            provenance: VoiceProvenance(),
            sourceAiJobId: job.Id);

    private static DailyLog MakeMultiPlotLog(AiJob job)
        => DailyLog.CreateForMultiPlot(
            id: Guid.NewGuid(),
            farmId: new FarmId(FarmGuid),
            plotIds: [PlotA, PlotB],
            operatorUserId: new UserId(OperatorUserId),
            logDate: new DateOnly(2026, 6, 20),
            idempotencyKey: null,
            location: null,
            createdAtUtc: FixedNow,
            provenance: VoiceProvenance(),
            sourceAiJobId: job.Id);

    private static DailyLog MakeFarmLog(AiJob job)
        => DailyLog.CreateForFarm(
            id: Guid.NewGuid(),
            farmId: new FarmId(FarmGuid),
            operatorUserId: new UserId(OperatorUserId),
            logDate: new DateOnly(2026, 6, 20),
            idempotencyKey: null,
            location: null,
            createdAtUtc: FixedNow,
            provenance: VoiceProvenance(),
            sourceAiJobId: job.Id);

    private sealed class FixedClock(DateTime utcNow) : IClock
    {
        public DateTime UtcNow { get; } = utcNow;
    }

    private sealed class SequentialIdGenerator : IIdGenerator
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
}
