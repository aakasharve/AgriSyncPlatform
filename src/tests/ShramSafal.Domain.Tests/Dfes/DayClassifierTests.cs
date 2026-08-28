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

    // task-0b (spec 2026-08-28-labour-v2-release-1) — the farmer's own
    // NO_WORK_PLANNED declaration must outrank a derived HasWork=true, so a
    // stray bucket (e.g. leftover/AI-derived data) cannot silently overrule
    // his own statement into RichWorkDay/BasicWorkDay.
    [Fact]
    public void DeclaredNoWork_outranks_derived_HasWork_and_stays_DeclaredNoWorkDay()
        => DayClassifier.Classify(Base(hasWork: true, exec: 90, declaredNoWork: true, noWorkCode: "rest"))
            .Should().Be(DayClassification.DeclaredNoWorkDay);

    // The counterweight to the case above: noticing still outranks a BARE
    // no-work declaration when there is genuinely no derived work — the
    // pre-existing priority order (documented on the "No work" branch) is
    // untouched by moving the HasWork short-circuit.
    [Fact]
    public void DeclaredNoWork_with_learning_and_no_derived_work_is_still_LearningDay()
        => DayClassifier.Classify(Base(learning: true, declaredNoWork: true, noWorkCode: "rest"))
            .Should().Be(DayClassification.LearningDay);

    [Fact]
    public void Silent_day_is_UnaccountedDay()
        => DayClassifier.Classify(Base())
            .Should().Be(DayClassification.UnaccountedDay);
}
