using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Domain.Compliance;
using ShramSafal.Domain.Logs;
using Xunit;

namespace ShramSafal.Domain.Tests.Compliance;

/// <summary>
/// LABOUR_PHASE2 P2.3 — the one reader in this audit that genuinely CANNOT
/// represent a plot-less log, and the guard that keeps its limitation visible.
///
/// <para><c>ComplianceEvidence.PlotId</c> is a non-nullable <c>Guid</c> because
/// <c>ssf.compliance_signals.plot_id</c> is <c>NOT NULL</c> and part of the
/// open-signal unique index. A <c>MultiPlot</c> or <c>Farm</c> log has no plot;
/// inventing one, or fanning a single dispute across every plot so the farmer
/// is told he has N disputes when he has one, are both fabrications founder
/// decision O-1 closed. So the rule skips those logs — and
/// <see cref="ComplianceRuleBook.UnresolvedDisputesWithNoRepresentableSignal"/>
/// exists so the skip is a named, countable fact rather than an accidental
/// silence (<c>P5</c>).</para>
/// </summary>
public sealed class ComplianceRuleBookPlotlessDisputeTests
{
    private static readonly FarmId TestFarmId = new(Guid.Parse("22222222-2222-2222-2222-222222222222"));
    private static readonly DateTime AsOf = new(2026, 6, 20, 0, 0, 0, DateTimeKind.Utc);

    [Fact]
    public void a_stale_dispute_on_a_farm_scoped_log_is_reported_as_unrepresentable()
    {
        var farmLog = MakeStaleDispute(DailyLog.CreateForFarm(
            Guid.NewGuid(), TestFarmId, UserId.New(),
            DateOnly.FromDateTime(AsOf.AddDays(-5)), null, null, AsOf.AddDays(-5)));

        var input = new ComplianceEvaluationInput(TestFarmId, AsOf, [], [], [farmLog], [], []);

        ComplianceRuleBook.UnresolvedDisputesWithNoRepresentableSignal(input)
            .Should().ContainSingle().Which.Id.Should().Be(farmLog.Id);
    }

    [Fact]
    public void a_stale_dispute_on_a_multi_plot_log_is_reported_as_unrepresentable()
    {
        var multiLog = MakeStaleDispute(DailyLog.CreateForMultiPlot(
            Guid.NewGuid(), TestFarmId, [Guid.NewGuid(), Guid.NewGuid()], UserId.New(),
            DateOnly.FromDateTime(AsOf.AddDays(-5)), null, null, AsOf.AddDays(-5)));

        var input = new ComplianceEvaluationInput(TestFarmId, AsOf, [], [], [multiLog], [], []);

        ComplianceRuleBook.UnresolvedDisputesWithNoRepresentableSignal(input)
            .Should().ContainSingle().Which.Id.Should().Be(multiLog.Id);
    }

    [Fact]
    public void a_plot_scoped_dispute_is_NOT_reported_as_unrepresentable()
    {
        var plotLog = MakeStaleDispute(DailyLog.Create(
            Guid.NewGuid(), TestFarmId, Guid.NewGuid(), Guid.NewGuid(), UserId.New(),
            DateOnly.FromDateTime(AsOf.AddDays(-5)), null, null, AsOf.AddDays(-5)));

        var input = new ComplianceEvaluationInput(TestFarmId, AsOf, [], [], [plotLog], [], []);

        ComplianceRuleBook.UnresolvedDisputesWithNoRepresentableSignal(input).Should().BeEmpty();
    }

    [Fact]
    public void the_rule_still_raises_evidence_for_the_plot_scoped_dispute_only()
    {
        var plotLog = MakeStaleDispute(DailyLog.Create(
            Guid.NewGuid(), TestFarmId, Guid.NewGuid(), Guid.NewGuid(), UserId.New(),
            DateOnly.FromDateTime(AsOf.AddDays(-5)), null, null, AsOf.AddDays(-5)));
        var farmLog = MakeStaleDispute(DailyLog.CreateForFarm(
            Guid.NewGuid(), TestFarmId, UserId.New(),
            DateOnly.FromDateTime(AsOf.AddDays(-5)), null, null, AsOf.AddDays(-5)));

        var input = new ComplianceEvaluationInput(TestFarmId, AsOf, [], [], [plotLog, farmLog], [], []);
        var rule = ComplianceRuleBook.Rules.Single(
            r => r.RuleCode == ComplianceRuleCode.UnresolvedDisputeAgeHigh);

        var evidence = rule.Evaluate(input);

        // One signal, for the log that has a plot. No sentinel plot id anywhere.
        evidence.Should().ContainSingle();
        evidence.Single().PlotId.Should().Be(plotLog.PlotId!.Value);
        evidence.Should().NotContain(e => e.PlotId == Guid.Empty);

        // And the farm-scoped one is accounted for rather than lost.
        ComplianceRuleBook.UnresolvedDisputesWithNoRepresentableSignal(input)
            .Should().ContainSingle().Which.Id.Should().Be(farmLog.Id);
    }

    [Fact]
    public void a_dispute_that_is_still_inside_the_cutoff_is_not_reported()
    {
        var farmLog = DailyLog.CreateForFarm(
            Guid.NewGuid(), TestFarmId, UserId.New(),
            DateOnly.FromDateTime(AsOf.AddDays(-1)), null, null, AsOf.AddDays(-1));
        farmLog.Verify(Guid.NewGuid(), VerificationStatus.Confirmed, null, AppRole.Mukadam,
            UserId.New(), AsOf.AddDays(-1));
        farmLog.Verify(Guid.NewGuid(), VerificationStatus.Disputed, "wrong data", AppRole.PrimaryOwner,
            UserId.New(), AsOf.AddHours(-1));

        var input = new ComplianceEvaluationInput(TestFarmId, AsOf, [], [], [farmLog], [], []);

        // Same 3-day cutoff as the rule — the two share one definition on
        // purpose, so they cannot drift into disagreeing.
        ComplianceRuleBook.UnresolvedDisputesWithNoRepresentableSignal(input).Should().BeEmpty();
    }

    private static DailyLog MakeStaleDispute(DailyLog log)
    {
        log.Verify(Guid.NewGuid(), VerificationStatus.Confirmed, null, AppRole.Mukadam,
            UserId.New(), AsOf.AddDays(-5));
        log.Verify(Guid.NewGuid(), VerificationStatus.Disputed, "wrong data", AppRole.PrimaryOwner,
            UserId.New(), AsOf.AddDays(-4));
        return log;
    }
}
