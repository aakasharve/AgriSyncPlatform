// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (pilot lane PERM, contract S1.1; founder 27 Nov: "kinds of work he may record", CTO ruling Q2) - the
// kinds an owner may limit a person to recording are the record's own bucket names, ONE vocabulary with the record (sync-contract/schemas/work-kinds.json,
// pinned below); NULL stores "every kind" (every seat today, P9 / P11); all six ticked stores NULL, so a kind added later is never silently closed;
// an empty set is refused (stopping someone is "काम थांबवा"); the primary owner's seat is never limited; a change does not move what he may READ.
using System.Text.Json;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Domain.Farms;
using Xunit;

namespace ShramSafal.Domain.Tests.Farms;

public sealed class WorkKindsTests
{
    private static readonly FarmId Farm = new(Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"));
    private static readonly UserId Person = new(Guid.Parse("22222222-2222-2222-2222-222222222222"));
    private static readonly UserId Owner = new(Guid.Parse("11111111-1111-1111-1111-111111111111"));
    private static readonly DateTime Now = new(2026, 11, 27, 9, 0, 0, DateTimeKind.Utc);

    private static FarmMembership ActiveSeat(AppRole role = AppRole.Worker)
    {
        var m = FarmMembership.CreateJoinRequest(Guid.NewGuid(), Farm, Person, Now.AddDays(-1));
        m.Approve(Owner, role, permissions: null, Now.AddHours(-2));
        return m;
    }

    [Fact]
    public void The_six_limitable_kinds_and_the_two_always_open_are_exactly_the_contract_file()
    {
        using var file = JsonDocument.Parse(File.ReadAllText(Path.Combine(RepoRoot(), "sync-contract", "schemas", "work-kinds.json")));
        var limitable = file.RootElement.GetProperty("limitable").EnumerateArray().Select(e => e.GetString()!).ToList();
        var open = file.RootElement.GetProperty("alwaysOpen").EnumerateArray().Select(e => e.GetString()!).ToList();

        Assert.Equal(limitable, WorkKinds.All);
        Assert.Equal(open, WorkKinds.AlwaysOpen);
        Assert.Equal(new[] { "cropActivities", "irrigation", "inputs", "labour", "machinery", "activityExpenses" }, WorkKinds.All);
    }

    [Fact]
    public void Every_seat_reads_no_limit_until_the_owner_sets_one()
    {
        var seat = ActiveSeat();
        Assert.Null(seat.AllowedWorkKinds);
        Assert.Null(seat.WorkKindsChangedAtUtc);
        Assert.True(WorkKinds.Allows(seat.AllowedWorkKinds, WorkKinds.CropActivities));
    }

    [Fact]
    public void Setting_all_six_kinds_stores_no_limit()
    {
        var seat = ActiveSeat();
        Assert.True(seat.SetWorkKinds([WorkKinds.Irrigation], Now));
        var accessStampBefore = seat.AccessChangedAtUtc;

        Assert.True(seat.SetWorkKinds(WorkKinds.All.Reverse().ToList(), Now.AddMinutes(1)));

        Assert.Null(seat.AllowedWorkKinds);
        Assert.Equal(Now.AddMinutes(1), seat.WorkKindsChangedAtUtc);
        Assert.Equal(accessStampBefore, seat.AccessChangedAtUtc);
    }

    [Fact]
    public void A_limit_is_stored_in_the_vocabulary_order_and_a_resend_changes_nothing()
    {
        var seat = ActiveSeat();
        Assert.True(seat.SetWorkKinds([WorkKinds.Inputs, WorkKinds.Irrigation], Now));
        Assert.Equal(new[] { WorkKinds.Irrigation, WorkKinds.Inputs }, seat.AllowedWorkKinds!);

        Assert.False(seat.SetWorkKinds([WorkKinds.Irrigation, WorkKinds.Inputs], Now.AddHours(1)));
        Assert.Equal(Now, seat.WorkKindsChangedAtUtc);
        Assert.True(WorkKinds.Allows(seat.AllowedWorkKinds, WorkKinds.Inputs));
        Assert.False(WorkKinds.Allows(seat.AllowedWorkKinds, WorkKinds.CropActivities));
    }

    [Fact]
    public void A_change_of_kinds_never_moves_what_he_may_read()
    {
        var seat = ActiveSeat();
        var stamp = seat.AccessChangedAtUtc;
        seat.SetWorkKinds([WorkKinds.Irrigation], Now.AddDays(1));
        Assert.Equal(stamp, seat.AccessChangedAtUtc);
    }

    [Fact]
    public void An_empty_kind_list_is_refused()
    {
        var seat = ActiveSeat();
        var refused = Assert.Throws<ArgumentException>(() => seat.SetWorkKinds([], Now));
        Assert.Contains("at least one kind", refused.Message, StringComparison.Ordinal);
        Assert.Null(seat.AllowedWorkKinds);
    }

    [Theory]
    [InlineData("observations")]
    [InlineData("plannedTasks")]
    [InlineData("spray")]
    [InlineData("Irrigation")]
    [InlineData("")]
    public void An_unknown_or_always_open_name_is_refused_never_trimmed(string name)
    {
        var seat = ActiveSeat();
        Assert.Throws<ArgumentException>(() => seat.SetWorkKinds([WorkKinds.Irrigation, name], Now));
        Assert.Null(seat.AllowedWorkKinds);
    }

    [Fact]
    public void A_name_twice_is_refused()
    {
        var seat = ActiveSeat();
        Assert.Throws<ArgumentException>(() => seat.SetWorkKinds([WorkKinds.Irrigation, WorkKinds.Irrigation], Now));
    }

    [Fact]
    public void The_primary_owner_seat_cannot_be_limited()
    {
        var seat = FarmMembership.Create(Guid.NewGuid(), Farm, Owner, AppRole.PrimaryOwner, Now.AddDays(-3));
        var refused = Assert.Throws<InvalidOperationException>(() => seat.SetWorkKinds([WorkKinds.Irrigation], Now));
        Assert.Contains("primary owner", refused.Message, StringComparison.Ordinal);
        Assert.Null(seat.AllowedWorkKinds);
    }

    [Fact]
    public void An_ended_seat_cannot_be_limited()
    {
        var seat = ActiveSeat();
        seat.Remove(Owner, reason: null, Now, isLastActivePrimaryOwner: false);
        Assert.Throws<InvalidOperationException>(() => seat.SetWorkKinds([WorkKinds.Irrigation], Now.AddMinutes(1)));
    }

    [Fact]
    public void Observations_and_reminders_are_always_open_whatever_the_limit()
    {
        IReadOnlyCollection<string> waterOnly = [WorkKinds.Irrigation];
        foreach (var open in WorkKinds.AlwaysOpen)
        {
            Assert.True(WorkKinds.Allows(waterOnly, open), open);
        }
    }

    [Fact]
    public void The_closed_kinds_of_a_record_are_the_ones_outside_his_set_in_vocabulary_order()
    {
        IReadOnlyCollection<string> allowed = [WorkKinds.Irrigation, WorkKinds.Inputs];
        Assert.Equal(
            new[] { WorkKinds.CropActivities, WorkKinds.Labour },
            WorkKinds.Closed(allowed, [WorkKinds.Labour, WorkKinds.Irrigation, "observations", WorkKinds.CropActivities]));
        Assert.Empty(WorkKinds.Closed(null, WorkKinds.All));
    }

    private static string RepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "sync-contract", "schemas", "work-kinds.json")))
        {
            dir = dir.Parent;
        }

        return dir?.FullName ?? throw new DirectoryNotFoundException("sync-contract/schemas/work-kinds.json was not found above the test binaries.");
    }
}
