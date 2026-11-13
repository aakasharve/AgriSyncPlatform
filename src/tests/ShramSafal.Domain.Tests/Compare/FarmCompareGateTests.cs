// spec: plr-d10-redesign-real-integration-2026-10-25 - lane CMP-D2 fix round 1 (P005): the compare gate, rule by rule, without a database.
// The route refuses a paused / waiting seat BEFORE the gate (no read scope), so these facts are the only place Gate's own handling of a standing
// that is not Active is exercised.
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Farms;
using Xunit;

namespace ShramSafal.Domain.Tests.Compare;

public sealed class FarmCompareGateTests
{
    private static readonly DateTime Now = new(2026, 11, 12, 6, 0, 0, DateTimeKind.Utc);

    private static FarmAccess Seat(AppRole role, MembershipStatus status, FarmPermission bits, bool registrant = false) =>
        new(role, status, registrant, bits);

    [Fact]
    public void No_standing_is_refused() => Assert.False(FarmCompareService.Gate(null, Now));

    [Fact]
    public void The_registrant_and_the_primary_owner_pass_without_the_bit()
    {
        Assert.True(FarmCompareService.Gate(Seat(AppRole.PrimaryOwner, MembershipStatus.Active, FarmPermission.None, registrant: true), Now));
        Assert.True(FarmCompareService.Gate(Seat(AppRole.PrimaryOwner, MembershipStatus.Active, FarmPermission.None), Now));
    }

    [Fact]
    public void A_seat_passes_only_with_the_stored_bit()
    {
        Assert.False(FarmCompareService.Gate(Seat(AppRole.Mukadam, MembershipStatus.Active, FarmPermission.None), Now));
        Assert.False(FarmCompareService.Gate(Seat(AppRole.SecondaryOwner, MembershipStatus.Active, FarmPermission.SeeMoney | FarmPermission.SeeWages), Now));
        Assert.True(FarmCompareService.Gate(Seat(AppRole.Mukadam, MembershipStatus.Active, FarmPermission.SeeCompare), Now));
        Assert.True(FarmCompareService.Gate(Seat(AppRole.SecondaryOwner, MembershipStatus.Active, FarmPermission.SeeCompare), Now));
    }

    [Fact]
    public void A_paused_or_waiting_seat_holding_the_bit_is_refused_by_the_gate_itself()
    {
        Assert.False(FarmCompareService.Gate(Seat(AppRole.SecondaryOwner, MembershipStatus.Suspended, FarmPermission.SeeCompare), Now));
        Assert.False(FarmCompareService.Gate(Seat(AppRole.Mukadam, MembershipStatus.PendingApproval, FarmPermission.SeeCompare), Now));
    }

    [Fact]
    public void A_worker_can_never_hold_it_even_with_the_bit_stored()
    {
        Assert.False(FarmCompareService.Gate(Seat(AppRole.Worker, MembershipStatus.Active, FarmPermission.SeeCompare), Now));
    }

    [Fact]
    public void The_bit_that_has_ended_is_refused()
    {
        var access = new FarmAccess(
            AppRole.Mukadam, MembershipStatus.Active, false, FarmPermission.SeeCompare,
            AuthorityExpiresAtJson: "{\"SeeCompare\":\"2026-11-01T00:00:00Z\"}");
        Assert.False(FarmCompareService.Gate(access, Now));
    }
}
