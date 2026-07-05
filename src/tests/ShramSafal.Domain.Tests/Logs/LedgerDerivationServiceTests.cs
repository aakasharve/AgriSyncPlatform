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
        // The key now folds in the plot scope (multi-plot collision fix), so the
        // expected key is Compute(job.Id, log.PlotId, span, "input").
        var expectedInputKey = DerivedEventKey.Compute(
            job.Id, PlotGuid, "0:52:34 आणि 13:0:45 fertigation", "input");
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

    // ── FIX A (multi-plot DerivedEventKey collision) ──────────────────────────

    [Fact]
    public async Task two_plots_sharing_one_source_job_keep_their_own_current_operation()
    {
        // The mobile flow creates one DailyLog PER selected plot while reusing the
        // SAME SourceAiJobId. Both derivations recompute from the same span text +
        // source job, so before FIX A the 2nd plot's key collided with the 1st on
        // (farm_id, derived_event_key) and superseded it — only the last plot kept
        // a current operation (silent data loss). Folding the plot scope into the
        // key makes the two plots' operations distinct: BOTH stay current.
        var repo = new InMemoryShramSafalRepository();
        var ids = new SequentialIdGenerator();
        var job = MakeVoiceJob(SampleNormalizedJson);

        var plotA = Guid.Parse("aaaaaaaa-1111-1111-1111-111111111111");
        var plotB = Guid.Parse("bbbbbbbb-2222-2222-2222-222222222222");
        var logA = MakeVoiceLog(job, LogGuid, plotA);
        var logB = MakeVoiceLog(job, Guid.Parse("77777777-7777-7777-7777-777777777777"), plotB);

        // Act — derive both plots from the ONE shared source job.
        await sut(repo).DeriveAsync(logA, job, ids, new FixedClock(FixedNow));
        await sut(repo).DeriveAsync(logB, job, ids, new FixedClock(FixedNow.AddMinutes(1)));

        // Assert — TWO current FarmOperations (one per plot), neither superseded.
        repo.CapturedOperations.Should().HaveCount(2);
        repo.CapturedOperations.Should().OnlyContain(o => o.IsCurrentVersion,
            "two DIFFERENT plots sharing one source job must NOT supersede each other");
        repo.CapturedOperations.Select(o => o.PlotId).Should().BeEquivalentTo([plotA, plotB]);
        repo.CapturedOperations[0].DerivedEventKey.Should().NotBe(
            repo.CapturedOperations[1].DerivedEventKey,
            "each plot's operation carries a DISTINCT plot-scoped DerivedEventKey");
    }

    [Fact]
    public async Task same_plot_reconfirm_still_supersedes_with_plot_scoped_key()
    {
        // The SAME plot re-confirmed offline (a DISTINCT DailyLog id but the same
        // plot + source job + span) must still recompute the SAME key and supersede
        // — FIX A must not regress the intended within-plot supersession.
        var repo = new InMemoryShramSafalRepository();
        var ids = new SequentialIdGenerator();
        var job = MakeVoiceJob(SampleNormalizedJson);

        var log1 = MakeVoiceLog(job, LogGuid, PlotGuid);
        var log2 = MakeVoiceLog(job, Guid.Parse("77777777-7777-7777-7777-777777777777"), PlotGuid);

        await sut(repo).DeriveAsync(log1, job, ids, new FixedClock(FixedNow));
        var firstOp = repo.CapturedOperations.Single();

        await sut(repo).DeriveAsync(log2, job, ids, new FixedClock(FixedNow.AddMinutes(1)));

        // Assert — same plot ⇒ same key ⇒ supersession, exactly one current row.
        firstOp.IsCurrentVersion.Should().BeFalse();
        repo.CapturedOperations.Should().HaveCount(2);
        var secondOp = repo.CapturedOperations[1];
        secondOp.IsCurrentVersion.Should().BeTrue();
        secondOp.DerivedEventKey.Should().Be(firstOp.DerivedEventKey);
        firstOp.SupersededByOperationId.Should().Be(secondOp.Id);
    }

    // ── FIX C (legacy top-level input shape) ───────────────────────────────────

    [Fact]
    public async Task legacy_top_level_input_shape_yields_one_application_input_item()
    {
        // The still-supported LEGACY shape states productName/quantity/unit on the
        // input itself with NO `mix` array. Before FIX C the parent FarmOperation
        // was created but the child (product/dose) was dropped. Now one
        // ApplicationInputItem is created from the legacy top-level fields.
        var repo = new InMemoryShramSafalRepository();
        var job = MakeVoiceJob(LegacyTopLevelInputJson);
        var log = MakeVoiceLog(job);

        await sut(repo).DeriveAsync(log, job, new SequentialIdGenerator(), new FixedClock(FixedNow));

        repo.CapturedOperations.Should().ContainSingle();
        repo.CapturedInputItems.Should().ContainSingle("the legacy top-level product/dose must not be dropped");
        var child = repo.CapturedInputItems[0];
        child.ProductName.Should().Be("19-19-19");
        child.DoseAmount.Should().Be(25);
        child.DoseUnit.Should().Be("kg");
        child.ProductType.Should().Be("fertilizer");
        child.OperationId.Should().Be(repo.CapturedOperations[0].Id);
    }

    [Fact]
    public async Task input_with_mix_does_not_also_create_a_legacy_child()
    {
        // When a `mix` IS present the legacy branch must NOT fire — no double-create.
        var repo = new InMemoryShramSafalRepository();
        var job = MakeVoiceJob(MixPlusStrayTopLevelInputJson);
        var log = MakeVoiceLog(job);

        await sut(repo).DeriveAsync(log, job, new SequentialIdGenerator(), new FixedClock(FixedNow));

        // Exactly the two mix items — the stray top-level productName is ignored.
        repo.CapturedInputItems.Should().HaveCount(2);
        repo.CapturedInputItems.Select(i => i.ProductName).Should().BeEquivalentTo(["MKP", "Potassium Nitrate"]);
    }

    // A single input carrying ONLY legacy top-level product fields (no mix array).
    private const string LegacyTopLevelInputJson = """
    {
      "inputs": [
        {
          "id": "in-0",
          "sourceText": "19-19-19 पंचवीस किलो",
          "type": "fertilizer",
          "productName": "19-19-19",
          "quantity": 25,
          "unit": "kg"
        }
      ]
    }
    """;

    // An input with a real 2-item mix PLUS a stray top-level productName that must
    // be ignored (no double-create).
    private const string MixPlusStrayTopLevelInputJson = """
    {
      "inputs": [
        {
          "id": "in-0",
          "sourceText": "0:52:34 आणि 13:0:45",
          "type": "fertilizer",
          "productName": "STRAY-SHOULD-BE-IGNORED",
          "quantity": 99,
          "unit": "kg",
          "mix": [
            { "id": "m0", "productName": "MKP", "npkGrade": "0:52:34", "dose": 4, "unit": "kg" },
            { "id": "m1", "productName": "Potassium Nitrate", "npkGrade": "13:0:45", "dose": 2, "unit": "kg" }
          ]
        }
      ]
    }
    """;

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

    // Fresh service over a given repo (keeps each Derive call reading the same
    // captured state the handler would see on prod's shared DbSet).
    private static LedgerDerivationService sut(InMemoryShramSafalRepository repo)
        => new(repo);

    private static DailyLog MakeVoiceLog(AiJob job)
        => MakeVoiceLog(job, LogGuid, PlotGuid);

    private static DailyLog MakeVoiceLog(AiJob job, Guid logId, Guid plotId)
        => DailyLog.Create(
            id: logId,
            farmId: new FarmId(FarmGuid),
            plotId: plotId,
            cropCycleId: CropCycleGuid,
            operatorUserId: new UserId(OperatorUserId),
            logDate: new DateOnly(2026, 6, 20),
            idempotencyKey: $"log-key-{logId:N}",
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
