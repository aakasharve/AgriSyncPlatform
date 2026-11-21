// spec: trusted-control-room-2026-11-20 (G1 fix round 1, A3)
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using ShramSafal.Application.Admin;
using ShramSafal.Application.Admin.Ports;
using ShramSafal.Domain.Organizations;
using Xunit;

namespace ShramSafal.Domain.Tests.ControlRoom;

/// <summary>
/// The default members of <see cref="IEntitlementResolver"/> (what a test double that only answers
/// <see cref="IEntitlementResolver.ResolveAsync"/> gets) never grant a seat more than the real resolver would. The real
/// resolver gives a non-owner Platform seat only its person's ticks, and only from a door session; a double knows neither,
/// so the defaults fail closed for it. The Platform Owner keeps the matrix's answer.
/// </summary>
public sealed class EntitlementResolverDefaultsTests
{
    private static readonly UserId Caller = new(Guid.Parse("00000000-0000-0000-0000-0000000a3d01"));

    /// <summary>Answers only <see cref="IEntitlementResolver.ResolveAsync"/>, with one seat: every other member is the default.</summary>
    private sealed class OneSeat(OrganizationType type, OrganizationRole role) : IEntitlementResolver
    {
        public Task<ResolveResult> ResolveAsync(UserId userId, Guid? activeOrgId, CancellationToken ct)
        {
            var seat = new MembershipSummary(Guid.NewGuid(), $"Example {type}", type, role);
            var isOwner = type == OrganizationType.Platform && role == OrganizationRole.Owner;
            return Task.FromResult(ResolveResult.Resolved(
                new AdminScope(seat.OrganizationId, type, role, EntitlementMatrix.For(type, role), isOwner), [seat]));
        }
    }

    [Theory]
    [InlineData(OrganizationRole.Employee)]
    [InlineData(OrganizationRole.Analyst)]
    [InlineData(OrganizationRole.Auditor)]
    [InlineData(OrganizationRole.Viewer)]
    public async Task The_defaults_give_a_non_owner_platform_seat_no_schedule_right(OrganizationRole role)
    {
        IEntitlementResolver resolver = new OneSeat(OrganizationType.Platform, role);

        (await resolver.MayCheckSchedulesAsync(Caller, default)).Should().BeFalse(
            "a double cannot know the person's ticks or the door, so it grants nothing (fail closed)");
        (await resolver.MayReadScheduleChecksAsync(Caller, default)).Should().BeFalse();
        (await resolver.IsPlatformOwnerAsync(Caller, default)).Should().BeFalse();
        (await resolver.PlatformOwnersAmongAsync([Caller], default)).Should().BeEmpty();
    }

    [Fact]
    public async Task The_defaults_answer_the_platform_owner_by_the_matrix()
    {
        IEntitlementResolver resolver = new OneSeat(OrganizationType.Platform, OrganizationRole.Owner);

        (await resolver.MayCheckSchedulesAsync(Caller, default)).Should().BeTrue();
        (await resolver.MayReadScheduleChecksAsync(Caller, default)).Should().BeTrue();
        (await resolver.IsPlatformOwnerAsync(Caller, default)).Should().BeTrue();
        (await resolver.PlatformOwnersAmongAsync([Caller], default)).Should().Equal(Caller.Value);
    }

    [Fact]
    public async Task The_defaults_give_an_fpo_owner_no_schedule_right()
    {
        IEntitlementResolver resolver = new OneSeat(OrganizationType.FPO, OrganizationRole.Owner);

        (await resolver.MayCheckSchedulesAsync(Caller, default)).Should().BeFalse("a schedule check is a Platform act");
        (await resolver.MayReadScheduleChecksAsync(Caller, default)).Should().BeFalse();
        (await resolver.IsPlatformOwnerAsync(Caller, default)).Should().BeFalse();
    }
}
