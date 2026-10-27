// spec: plr-d7-m1-multiuser-2026-10-26 (step 2, plan §2 #1) — the ONE permission rule, enumerated
// over every role, status and stored choice without a database (FarmPermissionDefaults +
// FarmAccessPolicy are pure).
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Farms;
using Xunit;

namespace ShramSafal.Domain.Tests.Auth;

public sealed class FarmAccessPolicyTests
{
    // ── Role defaults (founder D-22, answered 26 Oct 2026: a label grants nothing) ──

    [Theory]
    [InlineData(AppRole.PrimaryOwner, true)]
    [InlineData(AppRole.SecondaryOwner, false)]
    [InlineData(AppRole.Mukadam, false)]
    [InlineData(AppRole.Worker, false)]
    [InlineData(AppRole.Agronomist, false)]
    [InlineData(AppRole.Consultant, false)]
    [InlineData(AppRole.FpcTechnicalManager, false)]
    [InlineData(AppRole.FieldScout, false)]
    [InlineData(AppRole.LabOperator, false)]
    public void Defaults_only_the_primary_owner_holds_anything_a_co_owner_label_included(AppRole role, bool everything)
    {
        var defaults = FarmPermissionDefaults.For(role);
        Assert.Equal(everything ? FarmPermissionDefaults.All : FarmPermission.None, defaults);
        Assert.Equal(everything, defaults.HasFlag(FarmPermission.SeeMoney));
        Assert.Equal(everything, defaults.HasFlag(FarmPermission.AddCost));
    }

    [Fact]
    public void A_primary_owner_cannot_be_narrowed_by_any_stored_value()
    {
        Assert.Equal(FarmPermissionDefaults.All, FarmPermissionDefaults.Effective(AppRole.PrimaryOwner, FarmPermission.None));
    }

    [Fact]
    public void A_co_owner_or_mukadam_holds_exactly_what_the_primary_owner_stored_for_him()
    {
        Assert.Equal(FarmPermission.None, FarmPermissionDefaults.Effective(AppRole.SecondaryOwner, null));
        var coOwner = FarmPermissionDefaults.Effective(AppRole.SecondaryOwner, FarmPermission.AddCost);
        Assert.Equal(FarmPermission.AddCost, coOwner);
        Assert.False(coOwner.HasFlag(FarmPermission.SeeMoney), "a stored power never brings another one along");

        var trustedMukadam = FarmPermissionDefaults.Effective(AppRole.Mukadam, FarmPermission.AddCost | FarmPermission.PlanWork);
        Assert.True(trustedMukadam.HasFlag(FarmPermission.AddCost));
        Assert.False(trustedMukadam.HasFlag(FarmPermission.SeeMoney));
    }

    [Fact]
    public void Unknown_bits_are_dropped_and_unknown_names_refuse_the_whole_request()
    {
        Assert.Equal(FarmPermission.AddCost, FarmPermissionDefaults.Effective(AppRole.Worker, (FarmPermission)(4 | 1024)));
        Assert.False(FarmPermissionDefaults.IsKnown((FarmPermission)1024));

        Assert.True(FarmPermissionDefaults.TryParse(new[] { "addcost", " PlanWork " }, out var parsed));
        Assert.Equal(FarmPermission.AddCost | FarmPermission.PlanWork, parsed);
        Assert.False(FarmPermissionDefaults.TryParse(new[] { "AddCost", "Verify" }, out _),
            "a name this release does not know is refused, never half-stored");
        Assert.False(FarmPermissionDefaults.TryParse(new[] { "None" }, out _));
    }

    [Fact]
    public void Names_are_the_flag_names_in_a_stable_order()
    {
        Assert.Equal(
            new[] { "SeeMoney", "SeeWages", "AddCost", "PlanWork", "Invite", "AddTestRecord" },
            FarmPermissionDefaults.Names(FarmPermissionDefaults.All));
        Assert.Empty(FarmPermissionDefaults.Names(FarmPermission.None));
    }

    // ── The policy over a person's standing ───────────────────────────────────

    [Fact]
    public void No_standing_means_nothing()
    {
        Assert.Equal(FarmPermission.None, FarmAccessPolicy.Effective(null));
        Assert.False(FarmAccessPolicy.Has(null, FarmPermission.AddCost));
    }

    [Theory]
    [InlineData(MembershipStatus.PendingApproval)]
    [InlineData(MembershipStatus.PendingOtpClaim)]
    [InlineData(MembershipStatus.Suspended)]
    public void A_seat_that_is_not_Active_has_nothing_even_owner_tier_with_everything_stored(MembershipStatus status)
    {
        var access = new FarmAccess(AppRole.SecondaryOwner, status, IsRegistrant: false, FarmPermissionDefaults.All);
        Assert.Equal(FarmPermission.None, FarmAccessPolicy.Effective(access));
        Assert.False(FarmAccessPolicy.Has(access, FarmPermission.AddCost));
    }

    [Fact]
    public void The_registrant_holds_everything_whatever_a_row_says()
    {
        var access = new FarmAccess(AppRole.Worker, MembershipStatus.Suspended, IsRegistrant: true, FarmPermission.None);
        Assert.Equal(FarmPermissionDefaults.All, FarmAccessPolicy.Effective(access));
    }

    [Theory]
    [InlineData(AppRole.Worker, null, false)]
    [InlineData(AppRole.Worker, FarmPermission.AddCost, true)]
    [InlineData(AppRole.Mukadam, null, false)]
    [InlineData(AppRole.SecondaryOwner, null, false)]
    [InlineData(AppRole.SecondaryOwner, FarmPermission.AddCost, true)]
    [InlineData(AppRole.SecondaryOwner, FarmPermission.PlanWork, false)]
    [InlineData(AppRole.PrimaryOwner, FarmPermission.None, true)]
    public void Has_AddCost_follows_role_defaults_and_the_stored_choice(AppRole role, FarmPermission? stored, bool expected)
    {
        var access = new FarmAccess(role, MembershipStatus.Active, IsRegistrant: false, stored);
        Assert.Equal(expected, FarmAccessPolicy.Has(access, FarmPermission.AddCost));
    }

    [Fact]
    public void Asking_for_nothing_is_never_a_yes()
    {
        var owner = new FarmAccess(AppRole.PrimaryOwner, MembershipStatus.Active, IsRegistrant: true, null);
        Assert.False(FarmAccessPolicy.Has(owner, FarmPermission.None));
    }
}
