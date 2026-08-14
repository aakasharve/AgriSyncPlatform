using System;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Abstractions;
using Microsoft.Extensions.Logging.Abstractions;
using ShramSafal.Application.UseCases.Dfes.RecordQuestionEvent;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Domain.Dfes;
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
    private sealed class CapturingRepo(bool memberOfFarm) : FakeShramSafalRepository
    {
        public QuestionEvent? Captured { get; private set; }
        public bool SavedChanges { get; private set; }
        public override Task<bool> IsUserMemberOfFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default)
            => Task.FromResult(memberOfFarm);
        public override Task AddQuestionEventAsync(QuestionEvent e, CancellationToken ct = default)
        { Captured = e; return Task.CompletedTask; }
        public override Task SaveChangesAsync(CancellationToken ct = default)
        { SavedChanges = true; return Task.CompletedTask; }
    }
}
