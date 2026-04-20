using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using ShramSafal.Domain.Planning;
using Xunit;

namespace ShramSafal.Domain.Tests.Planning;

public sealed class PlannedActivityTests
{
    [Fact]
    public void Override_SetsOverrideFields_AndRaisesEvent()
    {
        var activity = PlannedActivity.CreateFromTemplate(
            Guid.NewGuid(), Guid.NewGuid(), "Spray", "Flowering",
            DateOnly.FromDateTime(DateTime.Today), Guid.NewGuid(), DateTime.UtcNow);

        var user = UserId.New();
        var newDate = DateOnly.FromDateTime(DateTime.Today.AddDays(2));
        activity.Override(newDate, "Spray fungicide", null, user, "Tractor not available", DateTime.UtcNow);

        activity.PlannedDate.Should().Be(newDate);
        activity.ActivityName.Should().Be("Spray fungicide");
        activity.OverrideReason.Should().Be("Tractor not available");
        activity.OverriddenByUserId.Should().Be(user);
        activity.DomainEvents.OfType<PlanOverriddenEvent>().Should().HaveCount(1);
    }

    [Fact]
    public void SourceTemplateActivityId_HasNoPublicSetter()
    {
        var prop = typeof(PlannedActivity).GetProperty(nameof(PlannedActivity.SourceTemplateActivityId))!;
        prop.SetMethod?.IsPublic.Should().BeFalse();
    }

    [Fact]
    public void CreateLocallyAdded_HasNullSourceTemplateActivityId()
    {
        var activity = PlannedActivity.CreateLocallyAdded(
            Guid.NewGuid(), Guid.NewGuid(), "Spray", "Flowering",
            DateOnly.FromDateTime(DateTime.Today), UserId.New(), "Extra activity needed", DateTime.UtcNow);

        activity.SourceTemplateActivityId.Should().BeNull();
        activity.IsLocallyAdded.Should().BeTrue();
        activity.IsLocallyChanged.Should().BeTrue();
        activity.OverrideReason.Should().NotBeNullOrEmpty();
    }

    [Fact]
    public void SoftRemove_TemplateDerivedActivity_SetsRemovedAtUtc()
    {
        var activity = PlannedActivity.CreateFromTemplate(
            Guid.NewGuid(), Guid.NewGuid(), "Spray", "Flowering",
            DateOnly.FromDateTime(DateTime.Today), Guid.NewGuid(), DateTime.UtcNow);

        activity.SoftRemove(UserId.New(), "Not needed this cycle", DateTime.UtcNow);

        activity.IsRemoved.Should().BeTrue();
        activity.RemovedReason.Should().Be("Not needed this cycle");
    }

    [Fact]
    public void Override_WithEmptyReason_Throws()
    {
        var activity = PlannedActivity.CreateFromTemplate(
            Guid.NewGuid(), Guid.NewGuid(), "Spray", "Flowering",
            DateOnly.FromDateTime(DateTime.Today), Guid.NewGuid(), DateTime.UtcNow);

        var act = () => activity.Override(null, null, null, UserId.New(), "  ", DateTime.UtcNow);
        act.Should().Throw<ArgumentException>();
    }
}
