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
    /// <summary>The ONE role that carries the capability outright — the primary owner (lane 2b,
    /// founder D-22 / D-26: a सहमालक label no longer carries labour edits; the 2b migration stored the
    /// grant for every existing co-owner seat instead). Was owner-tier (D5, 2026-09-02).</summary>
    private static readonly AppRole[] CarriedByRole =
        [AppRole.PrimaryOwner];

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
    public void Role_alone_carries_the_capability_for_owner_tier_and_nobody_else(AppRole role)
    {
        LabourManagementPermission.IsCarriedByRole(role)
            .Should().Be(CarriedByRole.Contains(role),
                "D5 (2026-09-02): owner-tier always; everyone else — Mukadam included — only when "
                + "explicitly granted");
    }

    [Theory]
    [MemberData(nameof(AllRoles))]
    public void Without_a_grant_only_the_two_carrying_roles_are_allowed(AppRole role)
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
                "an explicit grant is what the owner uses to extend the capability to any member; "
                + "for the two carrying roles it is simply redundant, never contradictory");
    }

    /// <summary>
    /// THE 2026-09-02 inversion, and the only test stating the rule in prose.
    /// O-4 put the Mukadam in the carried set; the founder's master review (D5)
    /// takes him out: ONE switch, owner-controlled, and existing Mukadams start
    /// OFF. "The owner may keep him as mukadam with the authority OFF" — which
    /// the shipped code made impossible — is now the rule.
    /// </summary>
    [Fact]
    public void A_Mukadam_without_a_grant_is_denied_and_only_the_owners_switch_changes_that()
    {
        LabourManagementPermission.IsAllowed(AppRole.Mukadam, hasExplicitGrant: false)
            .Should().BeFalse(
                "D5: the owner decides once whether a person may manage labour on this farm — "
                + "the Mukadam ROLE no longer smuggles that authority in");

        LabourManagementPermission.IsAllowed(AppRole.Mukadam, hasExplicitGrant: true)
            .Should().BeTrue("the same one switch that admits any other member admits him");
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

    /// <summary>
    /// RE-PINNED 2026-10-30 (spec plr-d10 I27). Was owner-tier (a co-owner could grant). Founder
    /// D-44 §2, verbatim: "The primary owner may confirm personally or explicitly delegate this
    /// responsibility … Being appointed मुकादम or co-owner must not automatically grant this
    /// authority." The switch now also makes confirmers, so only the primary owner moves it.
    /// </summary>
    [Theory]
    [MemberData(nameof(AllRoles))]
    public void Only_the_primary_owner_may_grant_or_revoke(AppRole role)
    {
        LabourManagementPermission.CanGrantOrRevoke(role)
            .Should().Be(role is AppRole.PrimaryOwner,
                "D-44: the PRIMARY owner chooses who confirms; O-4: even a member the owner GRANTED "
                + "may not spread the capability, or the owner's decision stops being the owner's");
    }

    [Theory]
    [MemberData(nameof(AllRoles))]
    public void Only_the_primary_owner_reads_the_grant_roster(AppRole role)
    {
        LabourManagementPermission.CanViewGrants(role)
            .Should().Be(role is AppRole.PrimaryOwner,
                "lane 2b: the roster of who may do what is people and permissions — the primary account holder's alone (D-26)");
    }

    [Fact]
    public void Nobody_grants_or_revokes_without_a_membership()
    {
        LabourManagementPermission.CanGrantOrRevoke(null).Should().BeFalse();
    }

    /// <summary>
    /// RE-PINNED 2026-10-30 (spec plr-d10 I27). Was both owner-tier roles. A co-owner's labour
    /// edits still come with his role (<see cref="LabourManagementPermission.IsCarriedByRole"/>,
    /// pinned above, unchanged) but confirming does not (D-44 §2), so for him the stored flag is a
    /// real decision. Only the primary owner, who confirms by role, gains nothing from it.
    /// </summary>
    [Theory]
    [MemberData(nameof(AllRoles))]
    public void A_grant_is_redundant_only_for_the_primary_owner(AppRole role)
    {
        LabourManagementPermission.IsRedundantGrantTarget(role)
            .Should().Be(role is AppRole.PrimaryOwner,
                "this is the P5 guard: toggling the stored flag where it changes nothing would be a "
                + "switch that pretends; for a co-owner it now decides whether he confirms records");
    }
}
