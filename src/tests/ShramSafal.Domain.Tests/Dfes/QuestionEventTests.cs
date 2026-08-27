using ShramSafal.Domain.Dfes;
using Xunit;

namespace ShramSafal.Domain.Tests.Dfes;

public sealed class QuestionEventTests
{
    private static readonly Guid Farm = Guid.Parse("99999999-9999-9999-9999-999999999999");

    [Fact]
    public void Create_sets_bank_and_telemetry_fields()
    {
        var id = Guid.NewGuid();
        var e = QuestionEvent.Create(
            id: id, dailyLogId: null, farmId: Farm, plotId: null,
            questionKey: "grape.flowering.foliar_confirm.v1", crop: "grape",
            expectedStage: "flowering", actualStageApplicability: "on_stage",
            anchorDateType: "stage_window", triggerType: "stage_confirmation",
            questionType: "confirmation", lens: "insight", depthLevel: 2,
            priority: 3, cooldown: 14, answerModes: "voice,tap",
            safetyClass: "safe", agronomistApproved: true, marathiApproved: true,
            bankVersion: "bank-1", questionEngineVersion: "qe-1",
            answerObservationId: null, shownAtUtc: null, triggerReason: null,
            weatherContext: null, response: null, stageConfirmed: null,
            photoSubmitted: null, skipped: null,
            createdAtUtc: new DateTime(2026, 7, 12, 6, 0, 0, DateTimeKind.Utc));

        Assert.Equal(id, e.Id);
        Assert.Equal(Farm, e.FarmId);
        Assert.Equal("grape.flowering.foliar_confirm.v1", e.QuestionKey);
        Assert.True(e.AgronomistApproved);
        Assert.True(e.MarathiApproved);
        Assert.Equal("bank-1", e.BankVersion);
    }

    [Fact]
    public void Create_rejects_blank_questionKey() =>
        Assert.Throws<ArgumentException>(() => QuestionEvent.Create(
            Guid.NewGuid(), null, Farm, null, "  ", "grape", null, null,
            "stage_window", "stage_confirmation", "confirmation", "insight",
            2, 3, 14, "voice", "safe", true, true, "bank-1", "qe-1",
            null, null, null, null, null, null, null, null, DateTime.UtcNow));
}
