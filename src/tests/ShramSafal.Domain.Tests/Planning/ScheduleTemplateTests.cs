using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using ShramSafal.Domain.Planning;
using Xunit;

namespace ShramSafal.Domain.Tests.Planning;

public sealed class ScheduleTemplateTests
{
    [Fact]
    public void EditCopyOnWrite_creates_new_row_with_incremented_version()
    {
        var author = UserId.New();
        var v1 = ScheduleTemplate.Create(Guid.NewGuid(), "Grape May", "Flowering",
            DateTime.UtcNow, createdByUserId: author, tenantScope: TenantScope.Private);
        var v2 = v1.EditCopyOnWrite(Guid.NewGuid(), "Grape May (rev)", null, author, DateTime.UtcNow);

        v2.Version.Should().Be(2);
        v2.PreviousVersionId.Should().Be(v1.Id);
        v2.CreatedByUserId.Should().Be(author);
        v2.DomainEvents.OfType<ScheduleTemplateEditedEvent>().Should().HaveCount(1);
    }

    [Fact]
    public void Clone_preserves_root_lineage()
    {
        var author = UserId.New();
        var root = ScheduleTemplate.Create(Guid.NewGuid(), "Root", "S1",
            DateTime.UtcNow, createdByUserId: author, tenantScope: TenantScope.Public);
        var derived1 = root.Clone(Guid.NewGuid(), UserId.New(), TenantScope.Private,
            "Adapted for Ramu", DateTime.UtcNow);
        var derived2 = derived1.Clone(Guid.NewGuid(), UserId.New(), TenantScope.Private,
            "Further adapted", DateTime.UtcNow);

        derived1.DerivedFromTemplateId.Should().Be(root.Id);
        derived2.DerivedFromTemplateId.Should().Be(root.Id);  // points to ROOT, not intermediate
        derived1.Version.Should().Be(1);
        derived2.DomainEvents.OfType<ScheduleTemplateClonedEvent>().Should().HaveCount(1);
    }

    [Fact]
    public void Publish_sets_PublishedAtUtc_and_raises_event()
    {
        var author = UserId.New();
        var template = ScheduleTemplate.Create(Guid.NewGuid(), "Test", "S1",
            DateTime.UtcNow, createdByUserId: author);
        var publishedAt = DateTime.UtcNow;

        template.Publish(author, publishedAt);

        template.PublishedAtUtc.Should().Be(publishedAt);
        template.DomainEvents.OfType<ScheduleTemplatePublishedEvent>().Should().HaveCount(1);
    }

    [Fact]
    public void CreatedByUserId_has_no_public_setter()
    {
        var prop = typeof(ScheduleTemplate).GetProperty(nameof(ScheduleTemplate.CreatedByUserId))!;
        prop.SetMethod?.IsPublic.Should().BeFalse();
    }

    [Fact]
    public void EditCopyOnWrite_original_is_not_mutated()
    {
        var author = UserId.New();
        var v1 = ScheduleTemplate.Create(Guid.NewGuid(), "Original", "S1",
            DateTime.UtcNow, createdByUserId: author);
        var originalVersion = v1.Version;
        var originalName = v1.Name;

        var v2 = v1.EditCopyOnWrite(Guid.NewGuid(), "Modified", null, author, DateTime.UtcNow);

        v1.Version.Should().Be(originalVersion);  // original unchanged
        v1.Name.Should().Be(originalName);         // original name unchanged
    }
}
