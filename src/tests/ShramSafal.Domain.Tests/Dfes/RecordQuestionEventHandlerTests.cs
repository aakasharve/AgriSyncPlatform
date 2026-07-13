using System;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Abstractions;
using Microsoft.Extensions.Logging.Abstractions;
using ShramSafal.Application.UseCases.Dfes.RecordQuestionEvent;
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
        var handler = new RecordQuestionEventHandler(repo, new FixedClock(FixedNow), NullLogger<RecordQuestionEventHandler>.Instance);
        var cmd = ValidCommand(farmId, userId) with { AgronomistApproved = false };

        var result = await handler.HandleAsync(cmd, CancellationToken.None);

        Assert.True(result.IsFailure);
        Assert.Null(repo.Captured); // never staged
    }

    [Fact]
    public async Task Forbids_non_member()
    {
        var repo = new CapturingRepo(memberOfFarm: false);
        var handler = new RecordQuestionEventHandler(repo, new FixedClock(FixedNow), NullLogger<RecordQuestionEventHandler>.Instance);
        var result = await handler.HandleAsync(ValidCommand(Guid.NewGuid(), Guid.NewGuid()), CancellationToken.None);
        Assert.True(result.IsFailure);
        Assert.Contains("Forbidden", result.Error.Code);
    }

    [Fact]
    public async Task Stages_an_append_only_row_with_versions_stamped()
    {
        var repo = new CapturingRepo(memberOfFarm: true);
        var handler = new RecordQuestionEventHandler(repo, new FixedClock(FixedNow), NullLogger<RecordQuestionEventHandler>.Instance);
        var farmId = Guid.NewGuid();

        var result = await handler.HandleAsync(ValidCommand(farmId, Guid.NewGuid()), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.NotNull(repo.Captured);
        Assert.Equal("gap.dose", repo.Captured!.QuestionKey);
        Assert.Equal("dfes-bank-1", repo.Captured.BankVersion);
        Assert.Equal("dfes-qengine-1", repo.Captured.QuestionEngineVersion);
        Assert.True(repo.SavedChanges);
    }

    private sealed class FixedClock(DateTime utcNow) : IClock { public DateTime UtcNow => utcNow; }

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
