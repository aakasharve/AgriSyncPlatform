// spec: trusted-control-room-2026-11-20 (plan CR-3, Task A3)
using FluentAssertions;
using ShramSafal.Application.Admin;
using ShramSafal.Domain.Organizations;
using Xunit;

namespace ShramSafal.Domain.Tests.ControlRoom;

public sealed class AdminScopeSeatTests
{
    [Fact]
    public void Only_a_platform_organisation_is_a_team_seat()
    {
        foreach (var type in Enum.GetValues<OrganizationType>())
        {
            var scope = new AdminScope(Guid.NewGuid(), type, OrganizationRole.Employee, [], false);
            scope.IsPlatformSeat.Should().Be(type == OrganizationType.Platform, "{0}", type);
        }
    }

    [Fact]
    public void A_scope_built_the_old_way_does_not_need_a_door_session()
    {
        new AdminScope(Guid.NewGuid(), OrganizationType.Platform, OrganizationRole.Owner, [], true)
            .DoorSessionRequired.Should().BeFalse();
    }
}
