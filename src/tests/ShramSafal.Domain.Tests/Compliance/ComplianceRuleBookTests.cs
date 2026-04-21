using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Domain.Compliance;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.Tests;
using Xunit;

namespace ShramSafal.Domain.Tests.Compliance;

public sealed class ComplianceRuleBookTests
{
    private static readonly FarmId TestFarmId = new(Guid.NewGuid());

    private static ComplianceEvaluationInput EmptyInput(DateTime? asOf = null) =>
        new(TestFarmId, asOf ?? DateTime.UtcNow, [], [], [], [], []);

    [Fact]
    public void ComplianceRuleBook_Exposes6Rules_EachWithStableRuleCode()
    {
        ComplianceRuleBook.Rules.Should().HaveCount(6);

        var codes = ComplianceRuleBook.Rules.Select(r => r.RuleCode).ToList();
        codes.Should().Contain(ComplianceRuleCode.MissedTaskThresholdWeek);
        codes.Should().Contain(ComplianceRuleCode.RepeatedSkipsPerActivity);
        codes.Should().Contain(ComplianceRuleCode.SkippedTestOverdue);
        codes.Should().Contain(ComplianceRuleCode.ResidueRiskReported);
        codes.Should().Contain(ComplianceRuleCode.UnresolvedDisputeAgeHigh);
        codes.Should().Contain(ComplianceRuleCode.ProtocolBreakInStage);
    }

    [Fact]
    public void MissedTaskThresholdRule_WithFourUnmatchedPlanned_FiresOnce()
    {
        var cropCycleId = Guid.NewGuid();
        var plotId = Guid.NewGuid();
        var asOf = DateTime.UtcNow;
        var userId = UserId.New();

        // 4 planned activities, 0 completed log tasks → missed = 4 >= 3 → fires
        var planned = Enumerable.Range(0, 4)
            .Select(_ => PlannedActivity.CreateLocallyAdded(
                Guid.NewGuid(), cropCycleId, "Spraying", "Flowering",
                DateOnly.FromDateTime(asOf.AddDays(-1)), userId, "manually added", asOf))
            .ToList();

        var logs = new List<DailyLog>
        {
            DailyLog.Create(Guid.NewGuid(), TestFarmId, plotId, cropCycleId,
                userId, DateOnly.FromDateTime(asOf.AddDays(-1)), null, null, asOf)
        };

        var plot = Plot.Create(plotId, TestFarmId, "Plot 1", 1.0m, asOf);
        var input = new ComplianceEvaluationInput(
            TestFarmId, asOf, planned, [], logs, [], [plot]);

        var rule = ComplianceRuleBook.Rules.Single(r => r.RuleCode == ComplianceRuleCode.MissedTaskThresholdWeek);
        var evidence = rule.Evaluate(input);

        evidence.Should().HaveCount(1);
    }

    [Fact]
    public void RepeatedSkipsRule_ThreeSkipsSameActivity_Fires()
    {
        var dailyLogId = Guid.NewGuid();
        var log = DailyLog.Create(Guid.NewGuid(), TestFarmId, Guid.NewGuid(), Guid.NewGuid(),
            UserId.New(), DateOnly.FromDateTime(DateTime.UtcNow), null, null, DateTime.UtcNow);

        var tasks = Enumerable.Range(0, 3)
            .Select(_ => log.AddTask(Guid.NewGuid(), "Irrigation", null, DateTime.UtcNow,
                ExecutionStatus.Skipped, "weather", null))
            .ToList();

        var allTasks = tasks.ToList();
        var input = EmptyInput() with { LogTasksLastWeek = allTasks };

        var rule = ComplianceRuleBook.Rules.Single(r => r.RuleCode == ComplianceRuleCode.RepeatedSkipsPerActivity);
        var evidence = rule.Evaluate(input);

        evidence.Should().HaveCount(1);
        evidence[0].PayloadJson.Should().Contain("Irrigation");
    }

    [Fact]
    public void SkippedTestOverdueRule_WithSevenDayOverdueTest_Fires()
    {
        var asOf = new DateTime(2026, 5, 1, 0, 0, 0, DateTimeKind.Utc);
        var overdueDate = new DateOnly(2026, 4, 20); // 11 days before asOf

        var instance = TestInstance.Schedule(
            Guid.NewGuid(), Guid.NewGuid(), TestProtocolKind.Soil,
            Guid.NewGuid(), TestFarmId, Guid.NewGuid(), "Flowering", overdueDate, asOf.AddDays(-15));
        instance.MarkOverdue(asOf.AddDays(-10));

        var input = new ComplianceEvaluationInput(
            TestFarmId, asOf, [], [], [], [instance], []);

        var rule = ComplianceRuleBook.Rules.Single(r => r.RuleCode == ComplianceRuleCode.SkippedTestOverdue);
        var evidence = rule.Evaluate(input);

        evidence.Should().HaveCount(1);
    }

    [Fact]
    public void ResidueHighRule_Fires_OnHighResidueReport()
    {
        var asOf = DateTime.UtcNow;
        var instance = TestInstance.Schedule(
            Guid.NewGuid(), Guid.NewGuid(), TestProtocolKind.Soil,
            Guid.NewGuid(), TestFarmId, Guid.NewGuid(), "Flowering",
            DateOnly.FromDateTime(asOf.AddDays(-10)), asOf.AddDays(-12));

        instance.MarkCollected(UserId.New(), AppRole.LabOperator, asOf.AddDays(-5));
        var results = new List<TestResult> { TestResult.Create("residue.level", "high", "ppm", null, 0.5m) };
        var attachIds = new List<Guid> { Guid.NewGuid() };
        instance.RecordResult(UserId.New(), AppRole.LabOperator, results, attachIds, asOf.AddDays(-3));

        var input = new ComplianceEvaluationInput(
            TestFarmId, asOf, [], [], [], [instance], []);

        var rule = ComplianceRuleBook.Rules.Single(r => r.RuleCode == ComplianceRuleCode.ResidueRiskReported);
        var evidence = rule.Evaluate(input);

        evidence.Should().HaveCount(1);
    }

    [Fact]
    public void UnresolvedDisputeRule_ThreeDayOldDispute_Fires()
    {
        var asOf = new DateTime(2026, 5, 10, 0, 0, 0, DateTimeKind.Utc);
        var plotId = Guid.NewGuid();
        var cycleId = Guid.NewGuid();

        var log = DailyLog.Create(
            Guid.NewGuid(), TestFarmId, plotId, cycleId,
            UserId.New(), DateOnly.FromDateTime(asOf.AddDays(-5)), null, null, asOf.AddDays(-5));

        // Dispute it 4 days ago (> 3-day cutoff)
        log.Verify(Guid.NewGuid(), VerificationStatus.Confirmed, null, AppRole.Mukadam,
            UserId.New(), asOf.AddDays(-5));
        log.Verify(Guid.NewGuid(), VerificationStatus.Disputed, "wrong data", AppRole.PrimaryOwner,
            UserId.New(), asOf.AddDays(-4));

        var input = new ComplianceEvaluationInput(
            TestFarmId, asOf, [], [], [log], [], []);

        var rule = ComplianceRuleBook.Rules.Single(r => r.RuleCode == ComplianceRuleCode.UnresolvedDisputeAgeHigh);
        var evidence = rule.Evaluate(input);

        evidence.Should().HaveCount(1);
    }
}
