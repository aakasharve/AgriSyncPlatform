using FluentAssertions;
using ShramSafal.Domain.Tests;
using Xunit;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// CEI Phase 2 §10.1 — invariants on the TestInstance / TestRecommendation
/// aggregates. These reflection-based tests guard the structural contract:
/// state transitions must go through aggregate methods (never a property
/// setter) and <see cref="TestRecommendation"/> is append-only (no mutation
/// after creation).
/// </summary>
public sealed class TestStackInvariantTests
{
    /// <summary>
    /// CEI-I5 / §10.1 — <see cref="TestInstance.Status"/> must have a private
    /// setter. A public setter would let a caller bypass
    /// <see cref="TestInstance.MarkCollected"/> / <see cref="TestInstance.RecordResult"/>
    /// / <see cref="TestInstance.MarkOverdue"/> / <see cref="TestInstance.Waive"/>
    /// and their role/attachment guards.
    /// </summary>
    [Fact]
    public void TestInstance_StatusSetter_IsPrivate()
    {
        var prop = typeof(TestInstance).GetProperty(nameof(TestInstance.Status));
        prop.Should().NotBeNull();
        prop!.SetMethod.Should().NotBeNull();
        prop.SetMethod!.IsPrivate.Should().BeTrue(
            "TestInstance.Status must be private-set to prevent direct state bypass (CEI-I5, CEI architecture §10.1)");
    }

    /// <summary>
    /// CEI-I5 — <see cref="TestInstance.RecordResult"/> must accept an
    /// <c>attachmentIds</c> parameter. This guards that the
    /// "reported tests carry ≥1 attachment" contract is wired through the
    /// method signature (the runtime guard is asserted separately in
    /// ShramSafal.Domain.Tests).
    /// </summary>
    [Fact]
    public void TestInstance_RecordResult_EnforcesI5_ViaSignature()
    {
        var method = typeof(TestInstance).GetMethod("RecordResult");
        method.Should().NotBeNull("RecordResult must exist on TestInstance");
        var attachmentParam = method!.GetParameters()
            .FirstOrDefault(p => p.Name == "attachmentIds");
        attachmentParam.Should().NotBeNull(
            "RecordResult must accept attachmentIds to enforce CEI-I5");
    }

    /// <summary>
    /// CEI §4.5 / §10.1 — <see cref="TestRecommendation"/> is append-only.
    /// Once raised by <c>TestRecommendationRuleBook.Evaluate</c> it is never
    /// mutated; superseding advice is emitted as a new recommendation row.
    /// Any public setter would break the audit/replay contract.
    /// </summary>
    [Fact]
    public void TestRecommendation_IsAppendOnly_NoPublicMutators()
    {
        var publicSetters = typeof(TestRecommendation)
            .GetProperties()
            .Where(p => p.SetMethod is { IsPublic: true })
            .ToList();

        publicSetters.Should().BeEmpty(
            "TestRecommendation is append-only — no property should have a public setter. " +
            "Found public setters on: {0}", string.Join(", ", publicSetters.Select(p => p.Name)));
    }
}
