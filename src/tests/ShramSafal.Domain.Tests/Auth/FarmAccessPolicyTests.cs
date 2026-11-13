// spec: plr-d7-m1-multiuser-2026-10-26 (step 2), lane 2b (MU farm-relationships design §2,
// §11.1, §11.2) — the ONE authority rule, enumerated over every authority, label, status, stored
// choice and end date without a database (FarmAuthorities + FarmAccessPolicy are pure).
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Farms;
using Xunit;

namespace ShramSafal.Domain.Tests.Auth;

public sealed class FarmAccessPolicyTests
{
    private static readonly DateTime Now = new(2026, 11, 2, 6, 0, 0, DateTimeKind.Utc);

    public static IEnumerable<object[]> EveryAuthority() =>
        FarmAuthorities.All.Select(a => new object[] { a });

    /// <summary>A seat that stores exactly <paramref name="authority"/> (and see money when it needs it), ending at <paramref name="end"/>.</summary>
    private static FarmAccess Holding(FarmAuthority authority, DateTime? end = null, AppRole? roleOrNull = null,
        MembershipStatus status = MembershipStatus.Active)
    {
        // lane CMP-D1: a Worker seat can never hold SeeCompare, so that one authority is theory-tested on a Mukadam seat; lane REM-1 (CTO ruling
        // on review m2): nor ManageReminders, which only a whole-farm seat holds.
        var role = roleOrNull ?? (authority is FarmAuthority.SeeCompare or FarmAuthority.ManageReminders ? AppRole.Mukadam : AppRole.Worker);
        var bits = FarmAuthorities.BitOf(authority);
        var expiries = new Dictionary<FarmPermission, DateTime>();
        if (FarmAuthorities.RequiredBy(authority) is { } needed)
        {
            bits |= FarmAuthorities.BitOf(needed);
        }

        if (end is { } instant && bits != FarmPermission.None && authority != FarmAuthority.TakeAttendance)
        {
            expiries[FarmAuthorities.BitOf(authority)] = instant;
        }

        var labour = authority == FarmAuthority.TakeAttendance;
        return new FarmAccess(
            role, status, IsRegistrant: false, bits,
            LabourGrant: labour,
            LabourGrantExpiresAtUtc: labour ? end : null,
            AuthorityExpiresAtJson: FarmAuthorities.SerializeExpiries(expiries));
    }

    // ── Per authority: allowed with it, refused without it, refused after its end ────────────

    [Theory]
    [MemberData(nameof(EveryAuthority))]
    public void Allowed_with_the_authority(FarmAuthority authority) =>
        Assert.True(FarmAccessPolicy.Holds(Holding(authority), authority, Now));

    [Theory]
    [MemberData(nameof(EveryAuthority))]
    public void Allowed_until_its_end_and_refused_from_its_end_on(FarmAuthority authority)
    {
        var access = Holding(authority, end: Now.AddHours(1));
        Assert.True(FarmAccessPolicy.Holds(access, authority, Now));
        Assert.False(FarmAccessPolicy.Holds(access, authority, Now.AddHours(1)), "strict: the end itself is past");
        Assert.False(FarmAccessPolicy.Holds(access, authority, Now.AddDays(1)));
    }

    [Theory]
    [MemberData(nameof(EveryAuthority))]
    public void Refused_without_it_whatever_the_label(FarmAuthority authority)
    {
        foreach (var role in Enum.GetValues<AppRole>().Where(r => r != AppRole.PrimaryOwner))
        {
            var bare = new FarmAccess(role, MembershipStatus.Active, IsRegistrant: false, StoredPermissions: null);
            Assert.False(FarmAccessPolicy.Holds(bare, authority, Now), $"{role} label alone must not hold {authority}");
        }
    }

    [Theory]
    [MemberData(nameof(EveryAuthority))]
    public void A_co_owner_label_with_no_authorities_holds_nothing(FarmAuthority authority)
    {
        var coOwner = new FarmAccess(AppRole.SecondaryOwner, MembershipStatus.Active, IsRegistrant: false, FarmPermission.None);
        Assert.False(FarmAccessPolicy.Holds(coOwner, authority, Now));
        Assert.False(FarmAccessPolicy.IsPrimaryAccountHolder(coOwner));
    }

    [Theory]
    [MemberData(nameof(EveryAuthority))]
    public void Another_authority_never_brings_this_one_along(FarmAuthority authority)
    {
        foreach (var other in FarmAuthorities.All.Where(o => o != authority && FarmAuthorities.RequiredBy(o) != authority))
        {
            Assert.False(FarmAccessPolicy.Holds(Holding(other), authority, Now), $"{other} must not hold {authority}");
        }
    }

    // ── "Requires see money" (MU design §11.1) ───────────────────────────────────────────

    [Theory]
    [InlineData(FarmAuthority.SeeWages)]
    [InlineData(FarmAuthority.ReviewMoney)]
    public void Wages_and_reviewing_money_need_see_money_and_end_with_it(FarmAuthority authority)
    {
        var withoutMoney = new FarmAccess(AppRole.Worker, MembershipStatus.Active, IsRegistrant: false, FarmAuthorities.BitOf(authority));
        Assert.False(FarmAccessPolicy.Holds(withoutMoney, authority, Now));

        var moneyEndsFirst = new FarmAccess(
            AppRole.Worker, MembershipStatus.Active, IsRegistrant: false,
            FarmAuthorities.BitOf(authority) | FarmPermission.SeeMoney,
            AuthorityExpiresAtJson: FarmAuthorities.SerializeExpiries(
                new Dictionary<FarmPermission, DateTime> { [FarmPermission.SeeMoney] = Now.AddHours(1) }));
        Assert.True(FarmAccessPolicy.Holds(moneyEndsFirst, authority, Now));
        Assert.False(FarmAccessPolicy.Holds(moneyEndsFirst, authority, Now.AddHours(2)));
    }

    // ── Who holds everything, and who holds nothing ──────────────────────────────────────

    [Fact]
    public void No_standing_means_nothing()
    {
        Assert.All(FarmAuthorities.All, a => Assert.False(FarmAccessPolicy.Holds(null, a, Now)));
        Assert.False(FarmAccessPolicy.IsPrimaryAccountHolder(null));
    }

    [Theory]
    [InlineData(MembershipStatus.PendingApproval)]
    [InlineData(MembershipStatus.PendingOtpClaim)]
    [InlineData(MembershipStatus.Suspended)]
    public void A_seat_that_is_not_Active_holds_nothing_even_with_everything_stored(MembershipStatus status)
    {
        var access = new FarmAccess(AppRole.SecondaryOwner, status, IsRegistrant: false, FarmPermissionDefaults.All, LabourGrant: true);
        Assert.All(FarmAuthorities.All, a => Assert.False(FarmAccessPolicy.Holds(access, a, Now)));
    }

    [Fact]
    public void The_registrant_and_an_Active_primary_owner_hold_everything_and_are_the_account_holder()
    {
        var registrant = new FarmAccess(AppRole.Worker, MembershipStatus.Suspended, IsRegistrant: true, FarmPermission.None);
        var primarySeat = new FarmAccess(AppRole.PrimaryOwner, MembershipStatus.Active, IsRegistrant: false, FarmPermission.None);
        foreach (var authority in FarmAuthorities.All)
        {
            Assert.True(FarmAccessPolicy.Holds(registrant, authority, Now));
            Assert.True(FarmAccessPolicy.Holds(primarySeat, authority, Now));
        }

        Assert.True(FarmAccessPolicy.IsPrimaryAccountHolder(registrant));
        Assert.True(FarmAccessPolicy.IsPrimaryAccountHolder(primarySeat));
    }

    [Fact]
    public void A_co_owner_holding_every_authority_is_still_not_the_primary_account_holder()
    {
        var everything = new FarmAccess(
            AppRole.SecondaryOwner, MembershipStatus.Active, IsRegistrant: false, FarmPermissionDefaults.All, LabourGrant: true);
        Assert.All(FarmAuthorities.All, a => Assert.True(FarmAccessPolicy.Holds(everything, a, Now)));
        Assert.False(FarmAccessPolicy.IsPrimaryAccountHolder(everything),
            "people and permissions, transfer and deletion are the primary account holder's alone (D-26)");
    }

    // ── Bits, names, the retired Invite bit ──────────────────────────────────────────────

    [Fact]
    public void Defaults_only_the_primary_owner_holds_anything_a_co_owner_label_included()
    {
        foreach (var role in Enum.GetValues<AppRole>())
        {
            Assert.Equal(role == AppRole.PrimaryOwner ? FarmPermissionDefaults.All : FarmPermission.None,
                FarmPermissionDefaults.For(role));
        }
    }

    [Fact]
    public void The_retired_Invite_bit_is_never_granted_never_named_and_never_parsed()
    {
        Assert.False(FarmPermissionDefaults.All.HasFlag(FarmPermission.Invite));
        Assert.Equal(FarmPermission.None, FarmPermissionDefaults.Effective(AppRole.Worker, FarmPermission.Invite));
        Assert.DoesNotContain("Invite", FarmPermissionDefaults.Names(FarmPermissionDefaults.Known));
        Assert.False(FarmPermissionDefaults.TryParse(new[] { "Invite" }, out _));
        Assert.True(FarmPermissionDefaults.IsKnown(FarmPermission.Invite), "a pre-2b row may still carry it; reading it is not an error");
    }

    /// <summary>
    /// lane 2b fix 1 (HIGH-1) — step 2's AddCost (4) meant LESS than review money, so it is retired the
    /// way Invite was: a stored 4 is never read as review money, never named, never parsed. Review
    /// money is its own bit.
    /// </summary>
    [Fact]
    public void The_retired_AddCost_bit_is_never_read_as_review_money()
    {
        Assert.False(FarmPermissionDefaults.All.HasFlag(FarmPermission.AddCost));
        Assert.Equal(FarmPermission.None, FarmPermissionDefaults.Effective(AppRole.SecondaryOwner, FarmPermission.AddCost));
        Assert.DoesNotContain("AddCost", FarmPermissionDefaults.Names(FarmPermissionDefaults.Known));
        Assert.False(FarmPermissionDefaults.TryParse(new[] { "AddCost" }, out _));
        Assert.True(FarmPermissionDefaults.IsKnown(FarmPermission.AddCost), "a pre-2b row may still carry it");
        Assert.Equal(FarmPermission.ReviewMoney, FarmAuthorities.BitOf(FarmAuthority.ReviewMoney));

        var oldStoredAddCost = new FarmAccess(AppRole.SecondaryOwner, MembershipStatus.Active, IsRegistrant: false,
            FarmPermission.SeeMoney | FarmPermission.AddCost);
        Assert.False(FarmAccessPolicy.Holds(oldStoredAddCost, FarmAuthority.ReviewMoney, Now));
    }

    [Fact]
    public void Bits_are_never_renumbered()
    {
        Assert.Equal(1, (int)FarmPermission.SeeMoney);
        Assert.Equal(2, (int)FarmPermission.SeeWages);
        Assert.Equal(4, (int)FarmPermission.AddCost);
        Assert.Equal(8, (int)FarmPermission.PlanWork);
        Assert.Equal(16, (int)FarmPermission.Invite);
        Assert.Equal(32, (int)FarmPermission.AddTestRecord);
        Assert.Equal(64, (int)FarmPermission.AssignWork);
        Assert.Equal(128, (int)FarmPermission.ConfirmRecords);
        Assert.Equal(256, (int)FarmPermission.EditFarmSetup);
        Assert.Equal(512, (int)FarmPermission.ManageScheduleTemplates);
        Assert.Equal(1024, (int)FarmPermission.ReviewMoney);
    }

    [Fact]
    public void Unknown_bits_are_dropped_and_unknown_names_refuse_the_whole_request()
    {
        // lane REM-1: bit 13 (8192) is ManageReminders now; the first bit nobody has defined is bit 14 (16384).
        Assert.Equal(FarmPermission.ReviewMoney, FarmPermissionDefaults.Effective(AppRole.Worker, (FarmPermission)(1024 | 16384)));
        Assert.False(FarmPermissionDefaults.IsKnown((FarmPermission)16384));
        Assert.True(FarmPermissionDefaults.TryParse(new[] { "reviewmoney", " PlanWork " }, out var parsed));
        Assert.Equal(FarmPermission.ReviewMoney | FarmPermission.PlanWork, parsed);
        Assert.False(FarmPermissionDefaults.TryParse(new[] { "ReviewMoney", "Verify" }, out _));
        Assert.False(FarmAuthorities.TryParse("7", out _), "ordinals are never accepted");
        Assert.True(FarmAuthorities.TryParse(" confirmrecords ", out var confirm));
        Assert.Equal(FarmAuthority.ConfirmRecords, confirm);
    }

    [Fact]
    public void The_expiry_document_round_trips_and_a_corrupt_one_fails_closed()
    {
        var end = new DateTime(2026, 11, 4, 18, 30, 0, DateTimeKind.Utc);
        var json = FarmAuthorities.SerializeExpiries(new Dictionary<FarmPermission, DateTime> { [FarmPermission.ConfirmRecords] = end });
        Assert.Equal("{\"128\":\"2026-11-04T18:30:00.000000Z\"}", json);
        Assert.Equal(end, FarmAuthorities.ParseExpiries(json)[FarmPermission.ConfirmRecords]);

        // SQL writes the same shape (the 2b migration); an offset string is read as its instant.
        Assert.Equal(end, FarmAuthorities.ParseExpiries("{\"128\":\"2026-11-05T00:00:00+05:30\"}")[FarmPermission.ConfirmRecords]);

        var corrupt = new FarmAccess(AppRole.Worker, MembershipStatus.Active, IsRegistrant: false,
            FarmPermission.ConfirmRecords, AuthorityExpiresAtJson: "{not json");
        Assert.False(FarmAccessPolicy.Holds(corrupt, FarmAuthority.ConfirmRecords, Now),
            "an unreadable end must never become कायम");

        // fix 1 (LOW-3): a key that is not the bit value of a known authority makes the whole document
        // corrupt — it might have named any authority, so none of them is held.
        foreach (var unknownKey in new[] { "{\"4\":\"2099-01-01T00:00:00Z\"}", "{\"ConfirmRecords\":\"2099-01-01T00:00:00Z\"}", "{\"3\":\"2099-01-01T00:00:00Z\"}" })
        {
            var withUnknownKey = new FarmAccess(AppRole.Worker, MembershipStatus.Active, IsRegistrant: false,
                FarmPermission.ConfirmRecords | FarmPermission.EditFarmSetup, AuthorityExpiresAtJson: unknownKey);
            Assert.False(FarmAccessPolicy.Holds(withUnknownKey, FarmAuthority.ConfirmRecords, Now), unknownKey);
            Assert.False(FarmAccessPolicy.Holds(withUnknownKey, FarmAuthority.EditFarmSetup, Now), unknownKey);
        }
        Assert.Null(FarmAuthorities.SerializeExpiries(new Dictionary<FarmPermission, DateTime>()));
    }

    [Fact]
    public void Held_authorities_list_each_end_and_nothing_once_it_ends()
    {
        var access = Holding(FarmAuthority.ConfirmRecords, end: Now.AddDays(2));
        var held = FarmAccessPolicy.HeldAuthorities(access, Now);
        Assert.Equal(FarmAuthority.ConfirmRecords, Assert.Single(held).Key);
        Assert.Equal(Now.AddDays(2), held[0].Value);
        Assert.Empty(FarmAccessPolicy.HeldAuthorities(access, Now.AddDays(3)));
        Assert.Equal(FarmPermission.ConfirmRecords, FarmAccessPolicy.EffectiveBits(access, Now));
    }
}
