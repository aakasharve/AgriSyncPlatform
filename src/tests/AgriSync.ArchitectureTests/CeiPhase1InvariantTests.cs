using FluentAssertions;
using ShramSafal.Application.UseCases.Planning.GetAttentionBoard;
using ShramSafal.Domain.Planning;
using Xunit;

namespace AgriSync.ArchitectureTests;

/// <summary>
/// Architecture tests for CEI Phase 1 invariants (CEI-I1 through CEI-I6).
/// These use reflection to enforce compile-time and structural constraints.
/// </summary>
public sealed class CeiPhase1InvariantTests
{
    // CEI-I1: ScheduleTemplate.Version has no public setter
    [Fact]
    public void ScheduleTemplate_Version_HasPrivateSetter()
    {
        var prop = typeof(ScheduleTemplate).GetProperty(nameof(ScheduleTemplate.Version))!;
        prop.SetMethod?.IsPublic.Should().BeFalse(
            "CEI-I1: Version must have private setter — prevents external mutation of version chain");
    }

    // CEI-I2: ScheduleTemplate.CreatedByUserId has no public setter
    [Fact]
    public void ScheduleTemplate_CreatedByUserId_HasPrivateSetter()
    {
        var prop = typeof(ScheduleTemplate).GetProperty(nameof(ScheduleTemplate.CreatedByUserId))!;
        prop.SetMethod?.IsPublic.Should().BeFalse(
            "CEI-I2: CreatedByUserId is append-only — a template may be renamed, never re-attributed");
    }

    // CEI-I3: PlannedActivity.SourceTemplateActivityId has no public setter
    [Fact]
    public void PlannedActivity_SourceTemplateActivityId_HasPrivateSetter()
    {
        var prop = typeof(PlannedActivity).GetProperty(nameof(PlannedActivity.SourceTemplateActivityId))!;
        prop.SetMethod?.IsPublic.Should().BeFalse(
            "CEI-I3: SourceTemplateActivityId is immutable once set");
    }

    // CEI-I6: AttentionCardDto.SuggestedAction is non-nullable (structural invariant)
    [Fact]
    public void AttentionCardDto_SuggestedAction_IsNonNullable()
    {
        var prop = typeof(AttentionCardDto).GetProperty(nameof(AttentionCardDto.SuggestedAction))!;
        var isNullable = Nullable.GetUnderlyingType(prop.PropertyType) is not null;
        isNullable.Should().BeFalse(
            "CEI-I6: Every AttentionCard must carry a non-null SuggestedAction — no passive insight");
    }
}
