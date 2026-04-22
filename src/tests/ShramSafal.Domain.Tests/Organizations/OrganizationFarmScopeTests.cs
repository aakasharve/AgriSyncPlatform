using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using ShramSafal.Domain.Organizations;
using Xunit;

namespace ShramSafal.Domain.Tests.Organizations;

public sealed class OrganizationFarmScopeTests
{
    [Fact]
    public void Grant_Explicit_SetsFieldsAndRaisesEvent()
    {
        var orgId = Guid.NewGuid();
        var farmId = new FarmId(Guid.NewGuid());
        var grantedBy = new UserId(Guid.NewGuid());
        var now = DateTime.UtcNow;

        var s = OrganizationFarmScope.Grant(
            Guid.NewGuid(), orgId, farmId, FarmScopeSource.Explicit, grantedBy, now);

        s.OrganizationId.Should().Be(orgId);
        s.FarmId.Should().Be(farmId);
        s.Source.Should().Be(FarmScopeSource.Explicit);
        s.IsActive.Should().BeTrue();
        s.DomainEvents.Should().ContainSingle(e => e is OrganizationFarmScopeGrantedEvent);
    }

    [Fact]
    public void Grant_WithPlatformWildcardSource_Throws()
    {
        var act = () => OrganizationFarmScope.Grant(
            Guid.NewGuid(), Guid.NewGuid(), new FarmId(Guid.NewGuid()),
            FarmScopeSource.PlatformWildcard, new UserId(Guid.NewGuid()), DateTime.UtcNow);

        act.Should().Throw<InvalidOperationException>();
    }

    [Fact]
    public void GrantPlatformWildcard_UsesEmptyFarmId_AndWildcardSource()
    {
        var s = OrganizationFarmScope.GrantPlatformWildcard(
            Guid.NewGuid(), Guid.NewGuid(), new UserId(Guid.NewGuid()), DateTime.UtcNow);

        s.FarmId.Value.Should().Be(Guid.Empty);
        s.Source.Should().Be(FarmScopeSource.PlatformWildcard);
        s.IsActive.Should().BeTrue();
        s.DomainEvents.Should().ContainSingle(e => e is OrganizationFarmScopeGrantedEvent);
    }

    [Fact]
    public void Revoke_IsIdempotent()
    {
        var s = OrganizationFarmScope.Grant(
            Guid.NewGuid(), Guid.NewGuid(), new FarmId(Guid.NewGuid()),
            FarmScopeSource.Explicit, new UserId(Guid.NewGuid()), DateTime.UtcNow);
        s.Revoke(new UserId(Guid.NewGuid()), DateTime.UtcNow);
        s.ClearDomainEvents();

        s.Revoke(new UserId(Guid.NewGuid()), DateTime.UtcNow);

        s.IsActive.Should().BeFalse();
        s.DomainEvents.Should().BeEmpty();
    }
}
