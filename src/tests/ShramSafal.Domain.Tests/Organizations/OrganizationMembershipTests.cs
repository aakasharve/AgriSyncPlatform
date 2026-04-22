using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using ShramSafal.Domain.Organizations;
using Xunit;

namespace ShramSafal.Domain.Tests.Organizations;

public sealed class OrganizationMembershipTests
{
    [Fact]
    public void Create_Active_SetsFieldsAndRaisesEvent()
    {
        var orgId = Guid.NewGuid();
        var userId = new UserId(Guid.NewGuid());
        var addedBy = new UserId(Guid.NewGuid());
        var now = DateTime.UtcNow;

        var m = OrganizationMembership.Create(
            Guid.NewGuid(), orgId, userId, OrganizationRole.Owner, addedBy, now);

        m.OrganizationId.Should().Be(orgId);
        m.UserId.Should().Be(userId);
        m.Role.Should().Be(OrganizationRole.Owner);
        m.AddedByUserId.Should().Be(addedBy);
        m.JoinedAtUtc.Should().Be(now);
        m.IsActive.Should().BeTrue();
        m.DomainEvents.Should().ContainSingle(e => e is OrganizationMemberAddedEvent);
    }

    [Fact]
    public void Deactivate_SetsIsActiveFalse_AndRaisesEvent()
    {
        var m = OrganizationMembership.Create(
            Guid.NewGuid(), Guid.NewGuid(), new UserId(Guid.NewGuid()),
            OrganizationRole.Owner, new UserId(Guid.NewGuid()), DateTime.UtcNow);
        m.ClearDomainEvents();

        m.Deactivate(new UserId(Guid.NewGuid()), DateTime.UtcNow);

        m.IsActive.Should().BeFalse();
        m.DomainEvents.Should().ContainSingle(e => e is OrganizationMemberRemovedEvent);
    }

    [Fact]
    public void Deactivate_WhenAlreadyInactive_IsNoOp()
    {
        var m = OrganizationMembership.Create(
            Guid.NewGuid(), Guid.NewGuid(), new UserId(Guid.NewGuid()),
            OrganizationRole.Owner, new UserId(Guid.NewGuid()), DateTime.UtcNow);
        m.Deactivate(new UserId(Guid.NewGuid()), DateTime.UtcNow);
        m.ClearDomainEvents();

        m.Deactivate(new UserId(Guid.NewGuid()), DateTime.UtcNow);

        m.DomainEvents.Should().BeEmpty();
    }
}
