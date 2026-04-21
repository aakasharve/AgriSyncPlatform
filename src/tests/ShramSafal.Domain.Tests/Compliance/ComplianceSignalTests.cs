using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using ShramSafal.Domain.Compliance;
using Xunit;

namespace ShramSafal.Domain.Tests.Compliance;

public sealed class ComplianceSignalTests
{
    private static ComplianceSignal OpenSignal(
        ComplianceSeverity severity = ComplianceSeverity.NeedsAttention,
        ComplianceSuggestedAction action = ComplianceSuggestedAction.ScheduleMissingActivity)
    {
        return ComplianceSignal.Open(
            id: Guid.NewGuid(),
            farmId: FarmId.New(),
            plotId: Guid.NewGuid(),
            cropCycleId: null,
            ruleCode: ComplianceRuleCode.MissedTaskThresholdWeek,
            severity: severity,
            suggestedAction: action,
            titleEn: "Test signal",
            titleMr: "चाचणी संकेत",
            descriptionEn: "Description",
            descriptionMr: "वर्णन",
            payloadJson: "{}",
            firstSeenAtUtc: DateTime.UtcNow);
    }

    [Fact]
    public void ComplianceSignal_Open_RequiresSuggestedAction_ForNonInfoSeverity()
    {
        // CEI-I6: non-Info severity MUST have a non-AcknowledgeOnly action
        // The aggregate enforces this — no exception for valid combinations.
        var signal = OpenSignal(ComplianceSeverity.NeedsAttention, ComplianceSuggestedAction.ScheduleMissingActivity);

        signal.SuggestedAction.Should().Be(ComplianceSuggestedAction.ScheduleMissingActivity);
        signal.IsOpen.Should().BeTrue();
    }

    [Fact]
    public void ComplianceSignal_Open_Info_AllowsAcknowledgeOnly()
    {
        var signal = OpenSignal(ComplianceSeverity.Info, ComplianceSuggestedAction.AcknowledgeOnly);

        signal.Severity.Should().Be(ComplianceSeverity.Info);
        signal.SuggestedAction.Should().Be(ComplianceSuggestedAction.AcknowledgeOnly);
    }

    [Fact]
    public void ComplianceSignal_Refresh_BumpsLastSeen_ButNotFirstSeen()
    {
        var firstSeen = new DateTime(2026, 4, 1, 0, 0, 0, DateTimeKind.Utc);
        var signal = ComplianceSignal.Open(
            Guid.NewGuid(), FarmId.New(), Guid.NewGuid(), null,
            ComplianceRuleCode.MissedTaskThresholdWeek,
            ComplianceSeverity.NeedsAttention, ComplianceSuggestedAction.ScheduleMissingActivity,
            "T", "T", "D", "D", "{}", firstSeen);

        var refreshedAt = firstSeen.AddDays(2);
        signal.Refresh(refreshedAt);

        signal.FirstSeenAtUtc.Should().Be(firstSeen);
        signal.LastSeenAtUtc.Should().Be(refreshedAt);
    }

    [Fact]
    public void ComplianceSignal_Acknowledge_ClosesOpenState()
    {
        var signal = OpenSignal();
        signal.IsOpen.Should().BeTrue();

        signal.Acknowledge(UserId.New(), DateTime.UtcNow);

        signal.AcknowledgedAtUtc.Should().NotBeNull();
        signal.IsOpen.Should().BeFalse();
    }

    [Fact]
    public void ComplianceSignal_Resolve_CapturesNote()
    {
        var signal = OpenSignal();
        var userId = UserId.New();
        var note = "Scheduled the missed sprays for tomorrow.";

        signal.Resolve(userId, note, DateTime.UtcNow);

        signal.ResolvedAtUtc.Should().NotBeNull();
        signal.ResolvedByUserId.Should().Be(userId);
        signal.ResolutionNote.Should().Be(note);
        signal.IsOpen.Should().BeFalse();
    }

    [Fact]
    public void ComplianceSignal_Resolve_RequiresNote()
    {
        var signal = OpenSignal();

        FluentActions.Invoking(() => signal.Resolve(UserId.New(), "  ", DateTime.UtcNow))
            .Should().Throw<InvalidOperationException>()
            .WithMessage("*note*");
    }

    [Fact]
    public void ComplianceSignal_CannotResolveAlreadyResolved()
    {
        var signal = OpenSignal();
        signal.Resolve(UserId.New(), "First resolution.", DateTime.UtcNow);

        FluentActions.Invoking(() => signal.Resolve(UserId.New(), "Second resolution.", DateTime.UtcNow))
            .Should().Throw<InvalidOperationException>();
    }
}
