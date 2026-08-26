using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using ShramSafal.Domain.Farms;
using Xunit;

namespace ShramSafal.Domain.Tests.Labour;

/// <summary>
/// LABOUR_PHASE2 Phase 5 — the pure rule, enumerated over EVERY role rather than
/// sampled.
///
/// <para><b>Why enumerate.</b> <see cref="AppRole"/> has nine members and five
/// of them (<c>Agronomist</c>, <c>Consultant</c>, <c>FpcTechnicalManager</c>,
/// <c>FieldScout</c>, <c>LabOperator</c>) were added by a later phase and are
/// easy to forget. A sampled test would have said "Worker is denied" and been
/// silent about a <c>FieldScout</c>. The enumeration also FAILS when a tenth
/// role lands, which is the moment somebody has to decide which side of this
/// rule it falls on — exactly the decision that should not be made by
/// accident.</para>
/// </summary>
public sealed class LabourManagementPermissionTests
{
    /// <summary>The three roles founder decision O-4 says carry the capability outright.</summary>
    private static readonly AppRole[] CarriedByRole =
        [AppRole.PrimaryOwner, AppRole.SecondaryOwner, AppRole.Mukadam];

    public static TheoryData<AppRole> AllRoles()
    {
        var data = new TheoryData<AppRole>();
        foreach (var role in Enum.GetValues<AppRole>())
        {
            data.Add(role);
        }

        return data;
    }

    [Fact]
    public void The_enumeration_this_suite_rests_on_covers_every_declared_role()
    {
        // If a tenth role is added, this fails FIRST and by name — before any
        // gate silently starts denying (or allowing) it.
        Enum.GetValues<AppRole>().Should().HaveCount(9,
            "every role must be consciously placed on one side of the labour rule; a new role that "
            + "nobody classified would default to 'needs an explicit grant', which may or may not be "
            + "what its author intended");
    }

    [Theory]
    [MemberData(nameof(AllRoles))]
    public void Role_alone_carries_the_capability_for_owner_tier_and_Mukadam_and_nobody_else(AppRole role)
    {
        LabourManagementPermission.IsCarriedByRole(role)
            .Should().Be(CarriedByRole.Contains(role),
                "O-4: owner always, Mukadam by default, everyone else only when explicitly granted");
    }

    [Theory]
    [MemberData(nameof(AllRoles))]
    public void Without_a_grant_only_the_three_carrying_roles_are_allowed(AppRole role)
    {
        LabourManagementPermission.IsAllowed(role, hasExplicitGrant: false)
            .Should().Be(CarriedByRole.Contains(role));
    }

    [Theory]
    [MemberData(nameof(AllRoles))]
    public void With_a_grant_every_role_is_allowed(AppRole role)
    {
        LabourManagementPermission.IsAllowed(role, hasExplicitGrant: true)
            .Should().BeTrue(
                "an explicit grant is what O-4 gives the owner to extend the capability to any member; "
                + "for the three carrying roles it is simply redundant, never contradictory");
    }

    /// <summary>
    /// THE regression this phase exists for. Before Phase 5,
    /// <c>ShramSafalAuthorizationEnforcer</c> approved/verified on
    /// <c>[PrimaryOwner, SecondaryOwner]</c> only — so the Mukadam could correct
    /// a headcount but could not verify the log carrying it.
    /// </summary>
    [Fact]
    public void A_Mukadam_is_allowed_with_no_grant_at_all()
    {
        LabourManagementPermission.IsAllowed(AppRole.Mukadam, hasExplicitGrant: false)
            .Should().BeTrue(
                "the Mukadam is exactly the person doing field verification; excluding them from "
                + "approve/verify while allowing them to correct labour was the contradiction O-4 closed");
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void A_non_member_is_denied_whatever_the_grant_flag_says(bool grant)
    {
        LabourManagementPermission.IsAllowed(null, grant)
            .Should().BeFalse(
                "a grant cannot outlive the membership that carries it — 'no non-terminal membership' "
                + "is denied before the flag is even consulted");
    }

    [Theory]
    [MemberData(nameof(AllRoles))]
    public void Only_owner_tier_may_grant_or_revoke(AppRole role)
    {
        LabourManagementPermission.CanGrantOrRevoke(role)
            .Should().Be(role is AppRole.PrimaryOwner or AppRole.SecondaryOwner,
                "O-4: 'the owner decides who is trusted'. A Mukadam HOLDS the capability but may not "
                + "spread it, or the owner's decision stops being the owner's");
    }

    [Fact]
    public void Nobody_grants_or_revokes_without_a_membership()
    {
        LabourManagementPermission.CanGrantOrRevoke(null).Should().BeFalse();
    }

    [Theory]
    [MemberData(nameof(AllRoles))]
    public void A_grant_is_redundant_exactly_where_the_role_already_carries_it(AppRole role)
    {
        LabourManagementPermission.IsRedundantGrantTarget(role)
            .Should().Be(CarriedByRole.Contains(role),
                "this is the P5 guard: toggling the stored flag for a role-carried capability would "
                + "change nothing, so the write path refuses instead of letting a switch pretend");
    }
}
