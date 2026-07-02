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
/// AI Intelligence Plan WP-2c (Task 4) — unit coverage of
/// <see cref="LedgerDerivationService"/>. The service parses an
/// <see cref="AiJob.NormalizedResultJson"/> blob into typed <c>ssf</c> ledger
/// rows and STAGES them on the repository (no SaveChanges — the handler owns
/// the commit). Only <c>inputs</c> gets a <see cref="FarmOperation"/> parent +
/// <see cref="ApplicationInputItem"/> children; the other five event kinds
/// (irrigation / labour / machinery / observation / disturbance) are
/// daily_logs-children written directly (D3). Every derived row carries a
/// parse-invariant <see cref="DerivedEventKey"/> (D2).
///
/// Tests derive only from the plan + Domain factory signatures — no implementor
/// diff seen.
/// </summary>
public sealed class LedgerDerivationServiceTests
{
    private static readonly Guid FarmGuid = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid PlotGuid = Guid.Parse("33333333-3333-3333-3333-333333333333");
    private static readonly Guid CropCycleGuid = Guid.Parse("44444444-4444-4444-4444-444444444444");
    private static readonly Guid LogGuid = Guid.Parse("55555555-5555-5555-5555-555555555555");
    private static readonly Guid AiJobGuid = Guid.Parse("66666666-6666-6666-6666-666666666666");
    private static readonly Guid OperatorUserId = Guid.Parse("11111111-1111-1111-1111-111111111111");

    private static readonly DateTime FixedNow = new(2026, 6, 20, 8, 30, 0, DateTimeKind.Utc);

    // One representative event of every kind. inputs[0] carries a 2-product mix
    // (dose + npkGrade); labour states a per-vine rate with NO explicit total;
    // machinery is a blower with 10 guns + fan OFF; disturbance is the single
    // top-level object (not an array).
    private const string SampleNormalizedJson = """
    {
      "summary": "s",
      "dayOutcome": "WORK_RECORDED",
      "cropActivities": [],
      "inputs": [
        {
          "id": "in-0",
          "sourceText": "0:52:34 आणि 13:0:45 fertigation",
          "method": "Drip",
          "type": "fertilizer",
          "mix": [
            { "id": "m0", "productName": "MKP", "npkGrade": "0:52:34", "dose": 4, "unit": "kg" },
            { "id": "m1", "productName": "Potassium Nitrate", "npkGrade": "13:0:45", "dose": 2, "unit": "kg", "basisQty": 1, "basisUnit": "L" }
          ]
        }
      ],
      "irrigation": [
        {
          "id": "ir-0",
          "sourceText": "4 तास पाणी दिलं",
          "role": "irrigation",
          "method": "drip",
          "source": "borewell",
          "durationHours": 4
        }
      ],
      "labour": [
        {
          "id": "lb-0",
          "sourceText": "12 मजूर, प्रति वेल दराने",
          "type": "CONTRACT",
          "count": 12,
          "rate": 5,
          "rateBasis": "per_vine",
          "contractUnit": "Tree"
        }
      ],
      "machinery": [
        {
          "id": "mc-0",
          "sourceText": "blower ने फवारणी, 10 gun, fan off",
          "type": "sprayer",
          "ownership": "owned",
          "implement": "blower",
          "nozzlesActive": 10,
          "fanState": "off",
          "operationPerformed": "फवारणी"
        }
      ],
      "observations": [
        {
          "id": "ob-0",
          "sourceText": "पानावर डाग दिसले",
          "textRaw": "पानावर डाग दिसले",
          "noteType": "issue",
          "severity": "important"
        }
      ],
      "disturbance": {
        "scope": "PARTIAL",
        "group": "g",
        "reason": "पाऊस आला, फवारणी थांबवली",
        "severity": "MEDIUM",
        "blockedSegments": ["input"],
        "cause": "WEATHER",
        "affectedScope": "bucket",
        "resolvedStatus": "resolved_same_day"
      },
      "machineryDummy": []
    }
    """;

    [Fact]
    public async Task derives_all_event_kinds_into_typed_rows_with_keys()
    {
        // Arrange
        var repo = new InMemoryShramSafalRepository();
        var job = MakeVoiceJob(SampleNormalizedJson);
        var log = MakeVoiceLog(job);
        var sut = new LedgerDerivationService(repo);

        // Act
        var outcome = await sut.DeriveAsync(
            log, job, new SequentialIdGenerator(), new FixedClock(FixedNow));

        // Assert — inputs: 1 FarmOperation(application) + 2 ApplicationInputItem
        repo.CapturedOperations.Should().HaveCount(1);
        var op = repo.CapturedOperations[0];
        op.OperationType.Should().Be("application");
        op.FarmId.Value.Should().Be(FarmGuid);
        op.PlotId.Should().Be(PlotGuid);
        op.SourceDailyLogId.Should().Be(LogGuid);
        op.OperationDate.Should().Be(log.LogDate);
        op.Provenance.Source.Should().Be(Source.Voice);

        repo.CapturedInputItems.Should().HaveCount(2);
        repo.CapturedInputItems.Select(i => i.Ordinal).Should().Equal(0, 1);
        repo.CapturedInputItems.Should().OnlyContain(i => i.OperationId == op.Id);
        repo.CapturedInputItems[0].ProductName.Should().Be("MKP");
        repo.CapturedInputItems[0].NpkGrade.Should().Be("0:52:34");
        repo.CapturedInputItems[1].NpkGrade.Should().Be("13:0:45");

        // irrigation
        repo.CapturedIrrigations.Should().HaveCount(1);
        repo.CapturedIrrigations[0].Role.Should().Be(IrrigationRole.Irrigation);
        repo.CapturedIrrigations[0].DurationHours.Should().Be(4);
        repo.CapturedIrrigations[0].DailyLogId.Should().Be(LogGuid);

        // labour — NO-MULTIPLY: no explicit total → TotalCost null
        repo.CapturedLabour.Should().HaveCount(1);
        repo.CapturedLabour[0].EngagementType.Should().Be(LabourEngagementType.Contract);
        repo.CapturedLabour[0].WorkerCount.Should().Be(12);
        repo.CapturedLabour[0].TotalCost.Should().BeNull();

        // machinery — blower, 10 nozzles, fan OFF
        repo.CapturedMachinery.Should().HaveCount(1);
        repo.CapturedMachinery[0].Implement.Should().Be("blower");
        repo.CapturedMachinery[0].NozzlesActive.Should().Be(10);
        repo.CapturedMachinery[0].FanState.Should().Be(FanState.Off);

        // observation — textRaw preserved verbatim
        repo.CapturedObservations.Should().HaveCount(1);
        repo.CapturedObservations[0].TextRaw.Should().Be("पानावर डाग दिसले");
        repo.CapturedObservations[0].NoteType.Should().Be(ObservationNoteType.Issue);

        // disturbance — the single object
        repo.CapturedDisturbances.Should().HaveCount(1);
        repo.CapturedDisturbances[0].Scope.Should().Be(DisturbanceScope.Partial);
        repo.CapturedDisturbances[0].Reason.Should().Be("पाऊस आला, फवारणी थांबवली");
        repo.CapturedDisturbances[0].Cause.Should().Be(DisturbanceCause.Weather);

        // The FarmOperation carries a non-blank DerivedEventKey, and the input's
        // key == Compute(job.Id, sourceText, "input").
        op.DerivedEventKey.Value.Should().NotBeNullOrWhiteSpace();
        var expectedInputKey = DerivedEventKey.Compute(
            job.Id, "0:52:34 आणि 13:0:45 fertigation", "input");
        op.DerivedEventKey.Should().Be(expectedInputKey);

        // Outcome tally: 1 operation, and the child rows staged.
        outcome.OperationsWritten.Should().Be(1);
        outcome.ChildrenWritten.Should().BeGreaterThan(0);
    }

    [Fact]
    public async Task supersedes_existing_operation_on_re_derivation_never_duplicates()
    {
        // Arrange — first derivation. ONE id generator across both derivations
        // so re-derivation mints a DISTINCT operation id (mirrors production
        // IIdGenerator, which never repeats a GUID).
        var repo = new InMemoryShramSafalRepository();
        var ids = new SequentialIdGenerator();
        var job = MakeVoiceJob(SampleNormalizedJson);
        var log = MakeVoiceLog(job);
        var sut = new LedgerDerivationService(repo);
        await sut.DeriveAsync(log, job, ids, new FixedClock(FixedNow));

        var firstOp = repo.CapturedOperations.Single();

        // Act — re-derive the SAME job (idempotent supersede).
        await sut.DeriveAsync(log, job, ids, new FixedClock(FixedNow.AddMinutes(1)));

        // Assert — the OLD op is marked superseded, a NEW op with the SAME key
        // is staged. No duplicate current row.
        firstOp.IsCurrentVersion.Should().BeFalse();
        repo.CapturedOperations.Should().HaveCount(2);
        var secondOp = repo.CapturedOperations[1];
        secondOp.Id.Should().NotBe(firstOp.Id);
        secondOp.DerivedEventKey.Should().Be(firstOp.DerivedEventKey);
        secondOp.IsCurrentVersion.Should().BeTrue();
        firstOp.SupersededByOperationId.Should().Be(secondOp.Id);
    }

    [Fact]
    public async Task blank_normalized_json_derives_nothing()
    {
        var repo = new InMemoryShramSafalRepository();
        var job = MakeVoiceJob(null);
        var log = MakeVoiceLog(job);
        var sut = new LedgerDerivationService(repo);

        var outcome = await sut.DeriveAsync(
            log, job, new SequentialIdGenerator(), new FixedClock(FixedNow));

        repo.CapturedOperations.Should().BeEmpty();
        repo.CapturedIrrigations.Should().BeEmpty();
        outcome.OperationsWritten.Should().Be(0);
        outcome.ChildrenWritten.Should().Be(0);
    }

    // ── WP-2d (D5) RoutineMemory upsert in the derivation ─────────────────────

    [Fact]
    public async Task derived_irrigation_upserts_routine_pattern_create_then_reinforce()
    {
        // Arrange — one repo across two confirms so the second upsert sees the
        // first's routine_patterns row (mirrors the shared DbSet on prod).
        var repo = new InMemoryShramSafalRepository();
        var sut = new LedgerDerivationService(repo);
        var job = MakeVoiceJob(SampleNormalizedJson);
        var log = MakeVoiceLog(job);

        // Act 1 — first confirm creates the pattern.
        await sut.DeriveAsync(log, job, new SequentialIdGenerator(), new FixedClock(FixedNow));

        // Assert — an "irrigation" routine_patterns row for (farm, plot) at SampleCount 1,
        // carrying the spoken method/source/duration.
        repo.CapturedRoutinePatterns.Should().ContainSingle(p => p.OperationType == "irrigation");
        var pattern = repo.CapturedRoutinePatterns.Single(p => p.OperationType == "irrigation");
        pattern.FarmId.Should().Be(FarmGuid);
        pattern.PlotId.Should().Be(PlotGuid);
        pattern.SampleCount.Should().Be(1);
        pattern.TypicalDurationHours.Should().Be(4);
        pattern.TypicalMethod.Should().Be("drip");
        pattern.TypicalSource.Should().Be("borewell");

        // Act 2 — a second confirm (fresh job/log, same farm+plot) reinforces.
        var job2 = MakeVoiceJob(SampleNormalizedJson);
        var log2 = MakeVoiceLog(job2);
        await sut.DeriveAsync(log2, job2, new SequentialIdGenerator(), new FixedClock(FixedNow.AddDays(1)));

        // Assert — still ONE irrigation pattern, now reinforced to SampleCount 2.
        repo.CapturedRoutinePatterns.Count(p => p.OperationType == "irrigation").Should().Be(1);
        pattern.SampleCount.Should().Be(2);
        pattern.UpdatedAtUtc.Should().Be(FixedNow.AddDays(1));
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static AiJob MakeVoiceJob(string? normalizedJson)
    {
        var job = AiJob.Create(
            id: AiJobGuid,
            idempotencyKey: "voice-key-1",
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

        if (!string.IsNullOrWhiteSpace(normalizedJson))
        {
            var attempt = job.AddAttempt(AiProviderType.Gemini);
            job.MarkSucceeded(normalizedJson, attempt);
        }

        return job;
    }

    private static DailyLog MakeVoiceLog(AiJob job)
        => DailyLog.Create(
            id: LogGuid,
            farmId: new FarmId(FarmGuid),
            plotId: PlotGuid,
            cropCycleId: CropCycleGuid,
            operatorUserId: new UserId(OperatorUserId),
            logDate: new DateOnly(2026, 6, 20),
            idempotencyKey: "log-key-1",
            location: null,
            createdAtUtc: FixedNow,
            provenance: new Provenance(
                Source.Voice, "gemini-2.5-flash", "v3.2.0", null, "1.0.0"),
            sourceAiJobId: job.Id);

    private sealed class FixedClock(DateTime utcNow) : IClock
    {
        public DateTime UtcNow { get; } = utcNow;
    }

    /// <summary>Monotonic non-empty GUIDs so distinct rows get distinct ids.</summary>
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
