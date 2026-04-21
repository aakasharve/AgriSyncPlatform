using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Domain.Tests;
using Xunit;

namespace ShramSafal.Domain.Tests.Tests;

public sealed class TestRecommendationRuleBookTests
{
    private static TestInstance SchedAndReport(
        TestProtocolKind kind,
        TestResult[] results)
    {
        var inst = TestInstance.Schedule(
            id: Guid.NewGuid(),
            testProtocolId: Guid.NewGuid(),
            protocolKind: kind,
            cropCycleId: Guid.NewGuid(),
            farmId: new FarmId(Guid.NewGuid()),
            plotId: Guid.NewGuid(),
            stageName: "Flowering",
            plannedDueDate: new DateOnly(2026, 5, 1),
            createdAtUtc: DateTime.UtcNow);

        inst.MarkCollected(UserId.New(), AppRole.LabOperator, DateTime.UtcNow);
        inst.RecordResult(
            UserId.New(),
            AppRole.LabOperator,
            results,
            new[] { Guid.NewGuid() },
            DateTime.UtcNow);

        return inst;
    }

    [Fact]
    public void TestRecommendationRuleBook_PhLowAt5p5_Matches_AppliesLime()
    {
        var inst = SchedAndReport(
            TestProtocolKind.Soil,
            new[]
            {
                new TestResult("pH", "5.5", "pH", 6.0m, 7.5m)
            });

        var recs = TestRecommendationRuleBook.Evaluate(inst, DateTime.UtcNow);

        recs.Should().HaveCount(1);
        var rec = recs[0];
        rec.RuleCode.Should().Be("soil.ph.low.apply-lime");
        rec.SuggestedActivityName.Should().Be("Lime application");
        rec.SuggestedOffsetDays.Should().Be(0);
        rec.TitleEn.Should().Contain("pH low");
        rec.TitleMr.Should().Contain("पीएच");
        rec.TestInstanceId.Should().Be(inst.Id);
        rec.DomainEvents.OfType<TestRecommendationRaisedEvent>().Should().HaveCount(1);
    }

    [Fact]
    public void TestRecommendationRuleBook_UnmatchingResult_ReturnsNoRule()
    {
        // pH exactly at threshold (6.0) — NOT < 6.0 per rule, so no match
        var inst = SchedAndReport(
            TestProtocolKind.Soil,
            new[]
            {
                new TestResult("pH", "6.0", "pH", 6.0m, 7.5m),
                new TestResult("N", "300", "ppm", 250m, null)   // above 250 threshold
            });

        var recs = TestRecommendationRuleBook.Evaluate(inst, DateTime.UtcNow);

        recs.Should().BeEmpty();
    }

    [Fact]
    public void TestRecommendationRuleBook_MismatchedKind_DoesNotFire()
    {
        // Petiole-kind instance; soil rule shouldn't fire even though pH is low
        var inst = SchedAndReport(
            TestProtocolKind.Petiole,
            new[]
            {
                new TestResult("pH", "5.5", "pH", null, null)
            });

        var recs = TestRecommendationRuleBook.Evaluate(inst, DateTime.UtcNow);

        recs.Should().BeEmpty();
    }

    [Fact]
    public void TestRecommendationRuleBook_PetioleKLow_AppliesMop()
    {
        var inst = SchedAndReport(
            TestProtocolKind.Petiole,
            new[]
            {
                new TestResult("K", "0.9", "%", 1.2m, null)
            });

        var recs = TestRecommendationRuleBook.Evaluate(inst, DateTime.UtcNow);

        recs.Should().HaveCount(1);
        recs[0].RuleCode.Should().Be("petiole.k.low.apply-mop");
        recs[0].SuggestedOffsetDays.Should().Be(2);
    }

    [Fact]
    public void TestRecommendationRuleBook_ResidueHighCategorical_FiresDelayHarvest()
    {
        var inst = SchedAndReport(
            TestProtocolKind.Residue,
            new[]
            {
                new TestResult("residue.level", "high", "category", null, null)
            });

        var recs = TestRecommendationRuleBook.Evaluate(inst, DateTime.UtcNow);

        recs.Should().HaveCount(1);
        recs[0].RuleCode.Should().Be("residue.high.delay-harvest");
        recs[0].SuggestedOffsetDays.Should().Be(7);
    }

    [Fact]
    public void TestRecommendationRuleBook_NitrogenExactlyAt250_DoesNotFire()
    {
        // N = 250 is exactly at the threshold; rule fires only when N < 250
        var inst = SchedAndReport(
            TestProtocolKind.Soil,
            new[]
            {
                new TestResult("N", "250", "ppm", 250m, null)
            });

        var recs = TestRecommendationRuleBook.Evaluate(inst, DateTime.UtcNow);

        recs.Should().BeEmpty();
    }

    [Fact]
    public void TestRecommendationRuleBook_RuleCountIs4()
    {
        TestRecommendationRuleBook.Rules.Should().HaveCount(4);
    }
}
