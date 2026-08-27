using System;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.Extensions.Logging.Abstractions;
using ShramSafal.Application.UseCases.Dfes.RecordQuestionEvent;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Domain.Dfes;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Tests.Common;
using Xunit;

namespace ShramSafal.Domain.Tests.Dfes;

public sealed class RecordQuestionEventHandlerTests
{
    private static readonly DateTime FixedNow = new(2026, 7, 12, 6, 0, 0, DateTimeKind.Utc);

    private static RecordQuestionEventCommand ValidCommand(Guid farmId, Guid userId) => new(
        CallerUserId: userId, FarmId: farmId, PlotId: null, DailyLogId: null,
        QuestionKey: "gap.dose", Crop: "grapes", ExpectedStage: "flowering",
        ActualStageApplicability: null, AnchorDateType: "log_date", TriggerType: "Gap",
        QuestionType: "gap_fill", Lens: "Execution", DepthLevel: 1, Priority: 4, Cooldown: 3,
        AnswerModes: "voice", SafetyClass: "informational",
        AgronomistApproved: true, MarathiApproved: true,
        BankVersion: "dfes-bank-1", QuestionEngineVersion: "dfes-qengine-1",
        AnswerObservationId: null, ShownAtUtc: FixedNow, TriggerReason: "gap DOSE",
        WeatherContext: null, Response: "10 ml", StageConfirmed: null, PhotoSubmitted: false, Skipped: false);

    [Fact]
    public async Task Rejects_row_that_is_not_both_approved()
    {
        var farmId = Guid.NewGuid(); var userId = Guid.NewGuid();
        var repo = new CapturingRepo(memberOfFarm: true);
        var handler = new RecordQuestionEventHandler(repo, new NullDailyRichnessDerivationService(), new FixedClock(FixedNow), NullLogger<RecordQuestionEventHandler>.Instance);
        var cmd = ValidCommand(farmId, userId) with { AgronomistApproved = false };

        var result = await handler.HandleAsync(cmd, CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Null(repo.Captured); // never staged
    }

    [Fact]
    public async Task Forbids_non_member()
    {
        var repo = new CapturingRepo(memberOfFarm: false);
        var handler = new RecordQuestionEventHandler(repo, new NullDailyRichnessDerivationService(), new FixedClock(FixedNow), NullLogger<RecordQuestionEventHandler>.Instance);
        var result = await handler.HandleAsync(ValidCommand(Guid.NewGuid(), Guid.NewGuid()), CancellationToken.None);
        Assert.True(result.IsFailure);
        Assert.Contains("Forbidden", result.Error.Code);
    }

    [Fact]
    public async Task Stages_an_append_only_row_with_versions_stamped()
    {
        var repo = new CapturingRepo(memberOfFarm: true);
        var handler = new RecordQuestionEventHandler(repo, new NullDailyRichnessDerivationService(), new FixedClock(FixedNow), NullLogger<RecordQuestionEventHandler>.Instance);
        var farmId = Guid.NewGuid();

        var result = await handler.HandleAsync(ValidCommand(farmId, Guid.NewGuid()), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.NotNull(repo.Captured);
        Assert.Equal("gap.dose", repo.Captured!.QuestionKey);
        Assert.Equal("dfes-bank-1", repo.Captured.BankVersion);
        Assert.Equal("dfes-qengine-1", repo.Captured.QuestionEngineVersion);
        Assert.True(repo.SavedChanges);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // The recompute guard (task-3, review fix round 1 / finding 2).
    //
    // The client fires recordOutcome on ALL THREE outcomes — a real answer, a bare
    // acknowledgement and a dismissal (MeterQuestionHost.tsx) — but only an answer can
    // move the score. Rebuilding the day for the other two would turn one INSERT into a
    // full re-derivation plus an unconditional UPDATE on the aggregate, on every card
    // interaction. The event itself is still recorded in every case: the telemetry is the
    // point of the endpoint, the recompute is not.
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_real_answer_rebuilds_the_day_for_the_date_the_question_was_shown()
    {
        var repo = new CapturingRepo(memberOfFarm: true);
        var derivation = new RecordingDerivation();
        var handler = new RecordQuestionEventHandler(repo, derivation, new FixedClock(FixedNow), NullLogger<RecordQuestionEventHandler>.Instance);
        var farmId = Guid.NewGuid();

        var result = await handler.HandleAsync(ValidCommand(farmId, Guid.NewGuid()), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(1, derivation.Calls);
        Assert.Equal(farmId, derivation.LastFarmId);
        // FixedNow is 2026-07-12 06:00 UTC = 11:30 IST — the same local day.
        Assert.Equal(new DateOnly(2026, 7, 12), derivation.LastLocalDate);
    }

    [Fact]
    public async Task A_dismissal_is_still_recorded_but_never_rebuilds_the_day()
    {
        var repo = new CapturingRepo(memberOfFarm: true);
        var derivation = new RecordingDerivation();
        var handler = new RecordQuestionEventHandler(repo, derivation, new FixedClock(FixedNow), NullLogger<RecordQuestionEventHandler>.Instance);
        // Exactly what MeterQuestionHost's onDismiss sends: skipped, no response.
        var cmd = ValidCommand(Guid.NewGuid(), Guid.NewGuid()) with { Response = null, Skipped = true };

        var result = await handler.HandleAsync(cmd, CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.NotNull(repo.Captured); // telemetry still written
        Assert.Equal(0, derivation.Calls);
    }

    [Fact]
    public async Task A_bare_acknowledgement_with_no_response_never_rebuilds_the_day()
    {
        var repo = new CapturingRepo(memberOfFarm: true);
        var derivation = new RecordingDerivation();
        var handler = new RecordQuestionEventHandler(repo, derivation, new FixedClock(FixedNow), NullLogger<RecordQuestionEventHandler>.Instance);
        // MeterQuestionHost's onQuestionInteract: { skipped: false }, no response.
        var cmd = ValidCommand(Guid.NewGuid(), Guid.NewGuid()) with { Response = "   ", Skipped = false };

        var result = await handler.HandleAsync(cmd, CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.NotNull(repo.Captured);
        Assert.Equal(0, derivation.Calls);
    }

    [Fact]
    public async Task An_answered_non_gap_question_never_rebuilds_the_day()
    {
        var repo = new CapturingRepo(memberOfFarm: true);
        var derivation = new RecordingDerivation();
        var handler = new RecordQuestionEventHandler(repo, derivation, new FixedClock(FixedNow), NullLogger<RecordQuestionEventHandler>.Instance);
        // A real, useful answer — but safety.* names no scored dimension, so it can
        // credit nothing and the day does not need rebuilding.
        var cmd = ValidCommand(Guid.NewGuid(), Guid.NewGuid()) with { QuestionKey = "safety.mask", Response = "होय" };

        var result = await handler.HandleAsync(cmd, CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.NotNull(repo.Captured);
        Assert.Equal(0, derivation.Calls);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // wave-3.11 WIRING (2026-08-16) — the answer route.
    //
    // Before this, nothing anywhere wrote ObservationEvent.SourceQuestionId, so
    // ObservationAnchor was dead code: every observation the extractor saw took the
    // `SourceQuestionId is null` branch and the anchoring rule governed nothing. The
    // tests below prove the route exists AND that the gate genuinely evaluates what it
    // produces — see Sathis_gate_actually_evaluates_the_observation_this_handler_wrote,
    // which feeds the handler's OWN output into DfesLensExtractor rather than a
    // hand-stamped fixture.
    // ─────────────────────────────────────────────────────────────────────────

    private static readonly Guid AnsweredLogId = Guid.Parse("77777777-7777-7777-7777-777777777777");
    private static readonly Guid AnsweredPlotId = Guid.Parse("33333333-3333-3333-3333-333333333333");
    private static readonly DateOnly LogDay = new(2026, 7, 12);

    /// <summary>A real noticing, spoken as the answer to Sathi's question.</summary>
    private const string AnchoredAnswer = "पानांवरचे डाग वाढले.";

    [Fact]
    public async Task An_answer_about_a_named_log_becomes_an_observation_anchored_to_the_question()
    {
        var farmId = Guid.NewGuid();
        var repo = new CapturingRepo(memberOfFarm: true, log: LogFor(farmId));
        var handler = new RecordQuestionEventHandler(repo, new RecordingDerivation(), new FixedClock(FixedNow), NullLogger<RecordQuestionEventHandler>.Instance);
        var cmd = ValidCommand(farmId, Guid.NewGuid()) with { DailyLogId = AnsweredLogId, Response = AnchoredAnswer };

        var result = await handler.HandleAsync(cmd, CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.NotNull(repo.CapturedObservation);
        // The farmer's own words, verbatim — never a summary (doctrine P4).
        Assert.Equal(AnchoredAnswer, repo.CapturedObservation!.TextRaw);
        // Attached to the log the question was ABOUT, not to whatever he spoke today.
        Assert.Equal(AnsweredLogId, repo.CapturedObservation.DailyLogId);
        // THE LINK — this is the field that was never written before.
        Assert.Equal(repo.Captured!.Id, repo.CapturedObservation.SourceQuestionId);
        // …and closed the other way, in the same insert, because ssf.question_events is
        // append-only by privilege and can never be updated to point back afterwards.
        Assert.Equal(repo.CapturedObservation.Id, repo.Captured.AnswerObservationId);
    }

    [Fact]
    public async Task A_skip_or_a_bare_acknowledgement_never_becomes_an_observation()
    {
        var farmId = Guid.NewGuid();
        foreach (var cmd in new[]
        {
            ValidCommand(farmId, Guid.NewGuid()) with { DailyLogId = AnsweredLogId, Response = null, Skipped = true },
            ValidCommand(farmId, Guid.NewGuid()) with { DailyLogId = AnsweredLogId, Response = "   ", Skipped = false },
            // A dismissal that somehow carried text is still a dismissal. Silence, and
            // contradiction, never score (doctrine P4).
            ValidCommand(farmId, Guid.NewGuid()) with { DailyLogId = AnsweredLogId, Response = AnchoredAnswer, Skipped = true },
        })
        {
            var repo = new CapturingRepo(memberOfFarm: true, log: LogFor(farmId));
            var handler = new RecordQuestionEventHandler(repo, new RecordingDerivation(), new FixedClock(FixedNow), NullLogger<RecordQuestionEventHandler>.Instance);

            var result = await handler.HandleAsync(cmd, CancellationToken.None);

            Assert.True(result.IsSuccess);
            Assert.NotNull(repo.Captured);          // telemetry still written
            Assert.Null(repo.CapturedObservation);  // nothing invented
        }
    }

    [Fact]
    public async Task An_answer_naming_another_farms_log_writes_no_observation()
    {
        var repo = new CapturingRepo(memberOfFarm: true, log: LogFor(Guid.NewGuid())); // log belongs elsewhere
        var handler = new RecordQuestionEventHandler(repo, new RecordingDerivation(), new FixedClock(FixedNow), NullLogger<RecordQuestionEventHandler>.Instance);
        var cmd = ValidCommand(Guid.NewGuid(), Guid.NewGuid()) with { DailyLogId = AnsweredLogId, Response = AnchoredAnswer };

        var result = await handler.HandleAsync(cmd, CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.NotNull(repo.Captured);
        Assert.Null(repo.CapturedObservation);
    }

    [Fact]
    public async Task The_day_of_the_log_the_question_was_about_is_the_day_rebuilt()
    {
        // wave-3.7: Monday's gap, answered on Tuesday. The gap credit is keyed on the day
        // the question was SHOWN; the observation is keyed on the LOG's day. Rebuilding
        // only the shown day would leave Monday's number sitting still after he answered.
        var farmId = Guid.NewGuid();
        var mondaysLog = DailyLog.Create(
            AnsweredLogId, new FarmId(farmId), AnsweredPlotId, Guid.NewGuid(), new UserId(Guid.NewGuid()),
            new DateOnly(2026, 7, 11), null, null, FixedNow);
        var repo = new CapturingRepo(memberOfFarm: true, log: mondaysLog);
        var derivation = new RecordingDerivation();
        var handler = new RecordQuestionEventHandler(repo, derivation, new FixedClock(FixedNow), NullLogger<RecordQuestionEventHandler>.Instance);
        // A non-gap key, so the ONLY reason anything recomputes is the observation.
        var cmd = ValidCommand(farmId, Guid.NewGuid()) with
        {
            DailyLogId = AnsweredLogId,
            QuestionKey = "followup.spots",
            Response = AnchoredAnswer,
        };

        var result = await handler.HandleAsync(cmd, CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(1, derivation.Calls);
        Assert.Equal(new DateOnly(2026, 7, 11), derivation.LastLocalDate);
    }

    [Fact]
    public async Task One_day_answered_the_same_day_is_rebuilt_once_not_twice()
    {
        var farmId = Guid.NewGuid();
        var repo = new CapturingRepo(memberOfFarm: true, log: LogFor(farmId)); // LogDay == the shown day
        var derivation = new RecordingDerivation();
        var handler = new RecordQuestionEventHandler(repo, derivation, new FixedClock(FixedNow), NullLogger<RecordQuestionEventHandler>.Instance);
        var cmd = ValidCommand(farmId, Guid.NewGuid()) with { DailyLogId = AnsweredLogId, Response = AnchoredAnswer };

        await handler.HandleAsync(cmd, CancellationToken.None);

        Assert.Equal(1, derivation.Calls);
        Assert.Equal(LogDay, derivation.LastLocalDate);
    }

    // ── the gate can SEE it ──────────────────────────────────────────────────

    /// <summary>
    /// The point of the whole task. <c>ObservationAnchorTests</c> proves the RULE with a
    /// hand-stamped fixture; that would keep passing even if no production path ever set
    /// <c>SourceQuestionId</c> — which is exactly the state wave-3.11 shipped in.
    ///
    /// <para>This test takes the observation the HANDLER built, hands it to the real
    /// <see cref="DfesLensExtractor"/>, and asserts the anchoring branch was the one taken:
    /// filler fills no observation bucket, a real noticing does. If the wiring regressed to
    /// leaving <c>SourceQuestionId</c> null, the filler case would take the 8-character
    /// floor instead — <c>"सगळं बरोबर"</c> is 10 characters, so it would PASS the floor,
    /// fill the bucket, and this test would fail. The gate is genuinely evaluated, not
    /// skipped.</para>
    /// </summary>
    [Theory]
    [InlineData("सगळं बरोबर", false)]          // founder's filler — 10 chars, clears the OLD floor
    [InlineData(AnchoredAnswer, true)]         // a real noticing
    public async Task Sathis_gate_actually_evaluates_the_observation_this_handler_wrote(
        string answer, bool expectObservationCredit)
    {
        var farmId = Guid.NewGuid();
        var repo = new CapturingRepo(memberOfFarm: true, log: LogFor(farmId));
        var handler = new RecordQuestionEventHandler(repo, new RecordingDerivation(), new FixedClock(FixedNow), NullLogger<RecordQuestionEventHandler>.Instance);
        var cmd = ValidCommand(farmId, Guid.NewGuid()) with { DailyLogId = AnsweredLogId, Response = answer };

        await handler.HandleAsync(cmd, CancellationToken.None);

        var written = repo.CapturedObservation;
        Assert.NotNull(written);
        // Guard the guard: if this ever goes null the assertions below become vacuous,
        // because the extractor would fall back to the volunteered 8-character floor.
        Assert.NotNull(written!.SourceQuestionId);

        using var doc = JsonDocument.Parse(SprayDay);
        var probe = new DfesLensExtractor.LensScoresProbe();
        var (_, signals) = DfesLensExtractor.Build(
            new DfesLensExtractor.DayData([doc.RootElement], [written], ScoredUnderVersion: null),
            probe,
            clientDatePlausible: true);

        Assert.Equal(expectObservationCredit, signals.HasStructuredObservation);
        Assert.Equal(expectObservationCredit, signals.HasMeaningfulObservation);
        // Either way the link itself is recorded — an unanchored answer is still an answer.
        Assert.True(signals.HasFollowup);
    }

    private const string SprayDay = """
    { "summary": "favarni keli", "dayOutcome": "WORK_RECORDED",
      "cropActivities": [ { "title": "spray" } ],
      "inputs": [], "irrigation": [], "labour": [], "machinery": [], "activityExpenses": [] }
    """;

    private static DailyLog LogFor(Guid farmId) => DailyLog.Create(
        AnsweredLogId, new FarmId(farmId), AnsweredPlotId, Guid.NewGuid(), new UserId(Guid.NewGuid()),
        LogDay, null, null, FixedNow);

    private sealed class FixedClock(DateTime utcNow) : IClock { public DateTime UtcNow => utcNow; }

    private sealed class RecordingDerivation : IDailyRichnessDerivationService
    {
        public int Calls { get; private set; }
        public Guid LastFarmId { get; private set; }
        public DateOnly LastLocalDate { get; private set; }

        public Task RecomputeAsync(Guid farmId, DateOnly localDate, CancellationToken ct = default)
        {
            Calls++;
            LastFarmId = farmId;
            LastLocalDate = localDate;
            return Task.CompletedTask;
        }
    }

    // Extends the shared FakeShramSafalRepository (all members throw); override only
    // the three the handler touches.
    private sealed class CapturingRepo(bool memberOfFarm, DailyLog? log = null) : FakeShramSafalRepository
    {
        public QuestionEvent? Captured { get; private set; }
        public ObservationEvent? CapturedObservation { get; private set; }
        public bool SavedChanges { get; private set; }
        public override Task<bool> IsUserMemberOfFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default)
            => Task.FromResult(memberOfFarm);
        public override Task AddQuestionEventAsync(QuestionEvent e, CancellationToken ct = default)
        { Captured = e; return Task.CompletedTask; }
        public override Task AddObservationEventAsync(ObservationEvent o, CancellationToken ct = default)
        { CapturedObservation = o; return Task.CompletedTask; }
        public override Task<DailyLog?> GetDailyLogByIdAsync(Guid dailyLogId, CancellationToken ct = default)
            => Task.FromResult(log is not null && log.Id == dailyLogId ? log : null);
        public override Task SaveChangesAsync(CancellationToken ct = default)
        { SavedChanges = true; return Task.CompletedTask; }
    }
}
