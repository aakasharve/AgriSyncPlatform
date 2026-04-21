using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Domain.Compliance;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Tests;
using Xunit;

namespace ShramSafal.Domain.Tests.Compliance;

public sealed class ComplianceEvaluatorTests
{
    private static readonly FarmId FarmId = new(Guid.NewGuid());

    [Fact]
    public void Evaluate_ReturnsEmpty_OnHealthyFarm()
    {
        var input = new ComplianceEvaluationInput(
            FarmId, DateTime.UtcNow, [], [], [], [], []);

        var results = ComplianceEvaluator.Evaluate(input);

        results.Should().BeEmpty();
    }

    [Fact]
    public void Evaluate_ReturnsMultipleRuleHits_WhenSeveralConditionsHold()
    {
        var asOf = new DateTime(2026, 5, 10, 0, 0, 0, DateTimeKind.Utc);

        // Condition 1: overdue test (SkippedTestOverdue rule)
        var instance = TestInstance.Schedule(
            Guid.NewGuid(), Guid.NewGuid(), TestProtocolKind.Soil,
            Guid.NewGuid(), FarmId, Guid.NewGuid(), "Flowering",
            new DateOnly(2026, 4, 28), asOf.AddDays(-15));
        instance.MarkOverdue(asOf.AddDays(-12)); // PlannedDueDate <= cutoff (asOf - 7 days = May 3)
        // Actually May 10 - 7 = May 3. PlannedDueDate = April 28 <= May 3. ✓

        // Condition 2: high residue test (ResidueRiskReported rule)
        var instance2 = TestInstance.Schedule(
            Guid.NewGuid(), Guid.NewGuid(), TestProtocolKind.Soil,
            Guid.NewGuid(), FarmId, Guid.NewGuid(), "Fruiting",
            new DateOnly(2026, 4, 25), asOf.AddDays(-20));
        instance2.MarkCollected(UserId.New(), AppRole.LabOperator, asOf.AddDays(-5));
        instance2.RecordResult(UserId.New(), AppRole.LabOperator,
            new List<ShramSafal.Domain.Tests.TestResult>
            {
                ShramSafal.Domain.Tests.TestResult.Create("residue.level", "high", "ppm", null, 0.5m)
            },
            [Guid.NewGuid()], asOf.AddDays(-3));

        var input = new ComplianceEvaluationInput(
            FarmId, asOf, [], [], [], [instance, instance2], []);

        var results = ComplianceEvaluator.Evaluate(input);

        results.Should().HaveCount(2);
        results.Select(r => r.Rule.RuleCode).Should().Contain(ComplianceRuleCode.SkippedTestOverdue);
        results.Select(r => r.Rule.RuleCode).Should().Contain(ComplianceRuleCode.ResidueRiskReported);
    }
}
