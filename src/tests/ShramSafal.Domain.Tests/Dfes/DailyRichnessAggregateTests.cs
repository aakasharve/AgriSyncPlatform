using ShramSafal.Domain.Dfes;
using Xunit;

namespace ShramSafal.Domain.Tests.Dfes;

public sealed class DailyRichnessAggregateTests
{
    private static readonly Guid Farm = Guid.Parse("99999999-9999-9999-9999-999999999999");
    private static readonly DateOnly Day = new(2026, 7, 12);
    private static readonly DateTimeOffset Now = new(2026, 7, 12, 6, 0, 0, TimeSpan.Zero);

    private static DailyRichnessAggregate Make()
    {
        var a = DailyRichnessAggregate.Create(
            id: Guid.NewGuid(), farmId: Farm, localDate: Day, timeZone: "Asia/Kolkata", nowUtc: Now);
        a.ApplyDerivation(
            execScore: 62, insightScore: 40, learningScore: 10,
            classification: DayClassification.RichWorkDay,
            flags: new ContributingFlags(
                HasWork: true, HasMeaningfulObservation: true, HasLearning: false,
                HasExperimentOutcome: false, HasDisturbance: false, HasDeclaredNoWorkReason: false),
            advancesStreak: true, advancesBar: true, shramPoints: 13,
            rewardReasonsJson: "[\"rich_work\",\"observation_bonus\"]",
            noWorkReasonCode: null,
            scoreEngineVersion: "dfes-test",
            componentsJson: "{\"WHAT\":10,\"DOSE\":8}");
        a.ConfirmStage(expectedStage: "flowering", actualStage: "flowering", varianceDays: 0);
        return a;
    }

    [Fact]
    public void Shell_create_then_apply_derivation_sets_identity_and_all_columns()
    {
        var a = Make();
        Assert.Equal(Farm, a.FarmId);
        Assert.Equal(Day, a.LocalDate);
        Assert.Equal("Asia/Kolkata", a.TimeZone);
        Assert.Equal(62, a.ExecutionScore);
        Assert.Equal(DayClassification.RichWorkDay, a.DayClassification);
        Assert.True(a.HasWork);
        Assert.True(a.HasMeaningfulObservation);
        Assert.True(a.AdvancesStreak);
        Assert.True(a.AdvancesBar);
        Assert.Equal(13, a.ShramPointsEarned);
        Assert.Equal("flowering", a.FarmerConfirmedActualStage);
        Assert.Equal(0, a.StageVarianceDays);
        Assert.Equal("dfes-test", a.ScoreEngineVersion);
    }

    [Fact]
    public void Shell_create_leaves_row_unstamped_until_apply_derivation()
    {
        var a = DailyRichnessAggregate.Create(Guid.NewGuid(), Farm, Day, "Asia/Kolkata", Now);
        Assert.Equal(DayClassification.PendingReconciliation, a.DayClassification);
        Assert.Null(a.ExecutionScore);
    }

    [Fact]
    public void Create_rejects_empty_farm() =>
        Assert.Throws<ArgumentException>(() =>
            DailyRichnessAggregate.Create(Guid.NewGuid(), Guid.Empty, Day, "Asia/Kolkata", Now));

    [Fact]
    public void Create_rejects_default_localDate() =>
        Assert.Throws<ArgumentException>(() =>
            DailyRichnessAggregate.Create(Guid.NewGuid(), Farm, default, "Asia/Kolkata", Now));

    [Fact]
    public void ApplyDerivation_rejects_blank_scoreEngineVersion()
    {
        var a = DailyRichnessAggregate.Create(Guid.NewGuid(), Farm, Day, "Asia/Kolkata", Now);
        Assert.Throws<ArgumentException>(() => a.ApplyDerivation(
            execScore: null, insightScore: null, learningScore: null,
            classification: DayClassification.UnaccountedDay,
            flags: default, advancesStreak: false, advancesBar: false, shramPoints: 0,
            rewardReasonsJson: "[]", noWorkReasonCode: null,
            scoreEngineVersion: "  ", componentsJson: "{}"));
    }
}
