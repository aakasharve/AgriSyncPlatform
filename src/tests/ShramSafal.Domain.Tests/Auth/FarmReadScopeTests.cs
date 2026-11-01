// spec: plr-d7-m1-multiuser-2026-10-26 (step 4a), lane MU-3 (founder D-22 / D-26) — what one person may
// READ on one farm, enumerated without a database: FarmReadScope is FarmAccessPolicy's read consequence,
// the attachment rule follows the parent, and the pull window re-sends a farm whose reading widened.
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Services;
using ShramSafal.Application.UseCases.Sync.PullSyncChanges;
using ShramSafal.Domain.Attachments;
using ShramSafal.Domain.Farms;
using Xunit;

namespace ShramSafal.Domain.Tests.Auth;

public sealed class FarmReadScopeTests
{
    private static readonly DateTime Now = new(2026, 11, 2, 6, 0, 0, DateTimeKind.Utc);
    private static readonly Guid Farm = Guid.Parse("10000000-0000-0000-0000-000000000001");
    private static readonly Guid Reader = Guid.Parse("20000000-0000-0000-0000-000000000002");
    private static readonly Guid Someone = Guid.Parse("30000000-0000-0000-0000-000000000003");

    private static FarmAccess Seat(
        AppRole role,
        FarmPermission? bits = null,
        bool labour = false,
        MembershipStatus status = MembershipStatus.Active,
        string? expiries = null,
        DateTime? changed = null) =>
        new(role, status, IsRegistrant: false, bits, LabourGrant: labour, AuthorityExpiresAtJson: expiries,
            AccessChangedAtUtc: changed);

    [Fact]
    public void No_standing_or_a_seat_that_is_not_working_reads_nothing()
    {
        Assert.Null(FarmReadScope.Of(Farm, null, Now));
        foreach (var status in new[]
                 {
                     MembershipStatus.PendingOtpClaim, MembershipStatus.PendingApproval, MembershipStatus.Suspended,
                     MembershipStatus.Revoked, MembershipStatus.Exited,
                 })
        {
            // Even a seat that STORES every authority reads nothing while it is not Active.
            Assert.Null(FarmReadScope.Of(Farm, Seat(AppRole.SecondaryOwner, FarmPermissionDefaults.All, labour: true, status: status), Now));
        }
    }

    [Fact]
    public void The_registrant_and_the_primary_owner_read_everything()
    {
        var registrant = new FarmAccess(AppRole.PrimaryOwner, MembershipStatus.Active, IsRegistrant: true, null);
        foreach (var access in new[] { registrant, Seat(AppRole.PrimaryOwner) })
        {
            var scope = FarmReadScope.Of(Farm, access, Now)!;
            Assert.False(scope.OwnRecordsOnly);
            Assert.True(scope.SeeMoney);
            Assert.True(scope.SeeWages);
            Assert.True(scope.SeeAttendance);
            Assert.True(scope.SeeTests);
            Assert.True(scope.SeeCompliance);
            Assert.True(scope.SeeFarmOverview);
            Assert.True(scope.IsPrimaryAccountHolder);
        }

        Assert.Null(FarmReadScope.Of(Farm, registrant, Now)!.AccessChangedAtUtc);
    }

    [Fact]
    public void A_label_grants_no_money_a_coowner_with_money_off_reads_the_farm_without_it()
    {
        var scope = FarmReadScope.Of(Farm, Seat(AppRole.SecondaryOwner, FarmPermission.EditFarmSetup, labour: true), Now)!;
        Assert.False(scope.OwnRecordsOnly);
        Assert.False(scope.SeeMoney);
        Assert.False(scope.SeeWages);
        Assert.True(scope.SeeAttendance, "take हजेरी is stored");
        Assert.True(scope.SeeTests);
        Assert.True(scope.SeeCompliance);
        Assert.True(scope.SeeFarmOverview);
        Assert.False(scope.IsPrimaryAccountHolder);
    }

    [Fact]
    public void Money_and_wages_follow_the_stored_authorities_and_their_ends()
    {
        var money = FarmReadScope.Of(Farm, Seat(AppRole.SecondaryOwner, FarmPermission.SeeMoney), Now)!;
        Assert.True(money.SeeMoney);
        Assert.False(money.SeeWages, "wages are a separate authority");

        var both = FarmReadScope.Of(Farm, Seat(AppRole.Mukadam, FarmPermission.SeeMoney | FarmPermission.SeeWages), Now)!;
        Assert.True(both.SeeMoney);
        Assert.True(both.SeeWages);

        // Wages without money mean nothing (D-26 §11.1).
        var wagesOnly = FarmReadScope.Of(Farm, Seat(AppRole.Mukadam, FarmPermission.SeeWages), Now)!;
        Assert.False(wagesOnly.SeeWages);

        // Money that ended is not money.
        var ended = FarmAuthorities.SerializeExpiries(new Dictionary<FarmPermission, DateTime> { [FarmPermission.SeeMoney] = Now });
        Assert.False(FarmReadScope.Of(Farm, Seat(AppRole.SecondaryOwner, FarmPermission.SeeMoney, expiries: ended), Now)!.SeeMoney);
    }

    [Fact]
    public void A_mukadam_with_take_attendance_reads_the_farm_and_attendance_but_no_money()
    {
        var scope = FarmReadScope.Of(Farm, Seat(AppRole.Mukadam, labour: true), Now)!;
        Assert.False(scope.OwnRecordsOnly);
        Assert.False(scope.SeeMoney);
        Assert.False(scope.SeeWages);
        Assert.True(scope.SeeAttendance);
    }

    [Fact]
    public void A_worker_label_narrows_to_his_own_records_and_an_authority_widens_only_its_own_kind()
    {
        var worker = FarmReadScope.Of(Farm, Seat(AppRole.Worker), Now)!;
        Assert.True(worker.OwnRecordsOnly);
        Assert.False(worker.SeeMoney);
        Assert.False(worker.SeeAttendance);
        Assert.False(worker.SeeTests);
        Assert.False(worker.SeeCompliance);
        Assert.False(worker.SeeFarmOverview);
        Assert.True(worker.MayReadRecordOf(Reader, Reader));
        Assert.False(worker.MayReadRecordOf(Reader, Someone));
        Assert.False(worker.MayReadRecordOf(Guid.Empty, Guid.Empty), "fails closed on an empty id");

        var lab = FarmReadScope.Of(Farm, Seat(AppRole.Worker, FarmPermission.AddTestRecord), Now)!;
        Assert.True(lab.SeeTests);
        Assert.True(lab.OwnRecordsOnly, "an authority never widens which records he reads");

        var confirm = FarmReadScope.Of(Farm, Seat(AppRole.Worker, FarmPermission.ConfirmRecords), Now)!;
        Assert.True(confirm.SeeCompliance);
    }

    [Fact]
    public void The_seat_change_time_travels_for_the_cursor_reset()
    {
        var changed = Now.AddHours(-1);
        Assert.Equal(changed, FarmReadScope.Of(Farm, Seat(AppRole.Mukadam, changed: changed), Now)!.AccessChangedAtUtc);
    }

    // ── The attachment follows its parent ───────────────────────────────────────────────

    private static Attachment AttachmentOn(string type, Guid parent) =>
        Attachment.Create(
            Guid.NewGuid(), new FarmId(Farm), parent, type, "a.jpg", "image/jpeg", new UserId(Someone), Now);

    [Fact]
    public void An_attachment_is_read_where_its_parent_is_read()
    {
        var coOwner = FarmReadScope.Of(Farm, Seat(AppRole.SecondaryOwner), Now)!;
        var owner = FarmReadScope.Of(Farm, Seat(AppRole.PrimaryOwner), Now)!;
        var worker = FarmReadScope.Of(Farm, Seat(AppRole.Worker), Now)!;

        Assert.True(AttachmentParentRule.MayRead(coOwner, Reader, AttachmentOn("Farm", Farm), null));
        Assert.True(AttachmentParentRule.MayRead(coOwner, Reader, AttachmentOn("DailyLog", Guid.NewGuid()), null));
        Assert.False(AttachmentParentRule.MayRead(coOwner, Reader, AttachmentOn("CostEntry", Guid.NewGuid()), null), "a receipt is money");
        Assert.True(AttachmentParentRule.MayRead(owner, Reader, AttachmentOn("CostEntry", Guid.NewGuid()), null));
        Assert.False(AttachmentParentRule.MayRead(coOwner, Reader, AttachmentOn("Mystery", Guid.NewGuid()), null), "unknown parent fails closed");
        Assert.True(AttachmentParentRule.MayRead(owner, Reader, AttachmentOn("Mystery", Guid.NewGuid()), null));

        // A worker's record photo only when the record is his, and the parent must be known.
        Assert.False(AttachmentParentRule.MayRead(worker, Reader, AttachmentOn("DailyLog", Guid.NewGuid()), null));
        Assert.False(AttachmentParentRule.MayRead(null, Reader, AttachmentOn("Farm", Farm), null));
    }

    // ── The per-farm cursor reset ───────────────────────────────────────────────────────

    [Fact]
    public void A_farm_whose_reading_widened_after_the_cursor_is_read_from_the_beginning_once()
    {
        var cursor = Now.AddDays(-1);
        var widened = Now.AddHours(-2);
        var farmA = Guid.Parse("a0000000-0000-0000-0000-00000000000a");
        var farmB = Guid.Parse("b0000000-0000-0000-0000-00000000000b");
        var scopes = new Dictionary<Guid, FarmReadScope>
        {
            [farmA] = FarmReadScope.Of(farmA, Seat(AppRole.Mukadam, FarmPermission.SeeMoney, changed: widened), Now)!,
            [farmB] = FarmReadScope.Of(farmB, Seat(AppRole.Mukadam, FarmPermission.SeeMoney, changed: cursor.AddDays(-3)), Now)!,
        };

        var window = new PullReadWindow(scopes, cursor, Now);
        Assert.Equal(DateTime.UnixEpoch, window.SinceFor(farmA));
        Assert.Equal(cursor, window.SinceFor(farmB));
        Assert.Equal(widened, window.ResetThroughUtc);
        var groups = window.Groups(s => s.SeeMoney).ToList();
        Assert.Equal(2, groups.Count);
        Assert.Contains(groups, g => g.SinceUtc == cursor && g.Farms.SequenceEqual([farmB]));
        Assert.Contains(groups, g => g.SinceUtc == DateTime.UnixEpoch && g.Farms.SequenceEqual([farmA]));

        // The next pull's cursor is past the change: nothing is re-sent again.
        var next = new PullReadWindow(scopes, widened, Now);
        Assert.Null(next.ResetThroughUtc);
        Assert.Equal(widened, next.SinceFor(farmA));
    }

    [Fact]
    public async Task A_row_is_kept_only_for_the_group_it_was_read_for()
    {
        var farmA = Guid.Parse("a0000000-0000-0000-0000-00000000000a");
        var farmB = Guid.Parse("b0000000-0000-0000-0000-00000000000b");
        var other = Guid.Parse("c0000000-0000-0000-0000-00000000000c");
        var scopes = new Dictionary<Guid, FarmReadScope>
        {
            [farmA] = FarmReadScope.Of(farmA, Seat(AppRole.Mukadam, changed: Now), Now)!,
            [farmB] = FarmReadScope.Of(farmB, Seat(AppRole.Mukadam, changed: Now.AddDays(-9)), Now)!,
        };
        var window = new PullReadWindow(scopes, Now.AddDays(-1), Now);

        // A repository that ignores the farm list (a double's default body) answers every farm each time.
        var rows = await window.ReadAsync(
            _ => true,
            (_, _) => Task.FromResult(new List<Guid> { farmA, farmB, other }),
            id => id);

        Assert.Equal(2, rows.Count);
        Assert.Contains(farmA, rows);
        Assert.Contains(farmB, rows);
        Assert.DoesNotContain(other, rows);
    }
}
