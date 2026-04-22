using FluentAssertions;
using ShramSafal.Domain.Organizations;
using Xunit;

namespace ShramSafal.Domain.Tests.Organizations;

public sealed class OrganizationTests
{
    [Fact]
    public void Create_WithName_AndType_SetsFieldsAndRaisesEvent()
    {
        var id = Guid.NewGuid();
        var now = DateTime.UtcNow;

        var org = Organization.Create(id, "Anand Cooperative", OrganizationType.FPO, now);

        org.Id.Should().Be(id);
        org.Name.Should().Be("Anand Cooperative");
        org.Type.Should().Be(OrganizationType.FPO);
        org.CreatedAtUtc.Should().Be(now);
        org.IsActive.Should().BeTrue();
        org.DomainEvents.Should().ContainSingle(e => e is OrganizationCreatedEvent);
    }

    [Fact]
    public void Create_TrimsName()
    {
        var org = Organization.Create(Guid.NewGuid(), "  Trimmed  ", OrganizationType.FPC, DateTime.UtcNow);
        org.Name.Should().Be("Trimmed");
    }

    [Fact]
    public void Create_WithEmptyName_Throws()
    {
        var act = () => Organization.Create(Guid.NewGuid(), "", OrganizationType.FPO, DateTime.UtcNow);
        act.Should().Throw<ArgumentException>();
    }

    [Fact]
    public void Create_WithWhitespaceName_Throws()
    {
        var act = () => Organization.Create(Guid.NewGuid(), "   ", OrganizationType.FPO, DateTime.UtcNow);
        act.Should().Throw<ArgumentException>();
    }

    [Fact]
    public void Deactivate_SetsIsActiveFalse()
    {
        var org = Organization.Create(Guid.NewGuid(), "X", OrganizationType.FPO, DateTime.UtcNow);
        org.Deactivate(DateTime.UtcNow);
        org.IsActive.Should().BeFalse();
    }
}
