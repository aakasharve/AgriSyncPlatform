using FluentAssertions;
using ShramSafal.Domain.Dfes;
using Xunit;

namespace ShramSafal.Domain.Tests.Dfes;

public sealed class DayClassifierTests
{
    private static ClassifierSignals Base(
        bool plausible = true, bool hasWork = false, bool obs = false, bool learning = false,
        bool experiment = false, bool disturbance = false, bool declaredNoWork = false,
        string? noWorkCode = null, int? exec = null, int? insight = null, int? learn = null,
        bool structuredObs = false, bool followup = false)
        => new(plausible, hasWork, IsSilent: !hasWork && !obs && !learning && !disturbance,
               obs, learning, experiment, disturbance, declaredNoWork, noWorkCode,
               exec, insight, learn, structuredObs, followup);

    [Fact]
    public void ImplausibleDate_is_PendingReconciliation()
        => DayClassifier.Classify(Base(plausible: false, hasWork: true, exec: 90))
            .Should().Be(DayClassification.PendingReconciliation);

    [Fact]
    public void HighExecution_plus_observation_is_RichWorkDay()
        => DayClassifier.Classify(Base(hasWork: true, exec: 80, obs: true, structuredObs: true))
            .Should().Be(DayClassification.RichWorkDay);

    [Fact]
    public void Work_but_low_execution_is_BasicWorkDay()
        => DayClassifier.Classify(Base(hasWork: true, exec: 40))
            .Should().Be(DayClassification.BasicWorkDay);

    [Fact]
    public void NoWork_with_learning_is_LearningDay()
        => DayClassifier.Classify(Base(learning: true))
            .Should().Be(DayClassification.LearningDay);

    [Fact]
    public void NoWork_with_observation_only_is_ObservationDay()
        => DayClassifier.Classify(Base(obs: true, structuredObs: true))
            .Should().Be(DayClassification.ObservationDay);

    [Fact]
    public void DeclaredNoWork_with_no_noticing_is_DeclaredNoWorkDay()
        => DayClassifier.Classify(Base(declaredNoWork: true, disturbance: true, noWorkCode: "weather"))
            .Should().Be(DayClassification.DeclaredNoWorkDay);

    [Fact]
    public void Silent_day_is_UnaccountedDay()
        => DayClassifier.Classify(Base())
            .Should().Be(DayClassification.UnaccountedDay);
}
