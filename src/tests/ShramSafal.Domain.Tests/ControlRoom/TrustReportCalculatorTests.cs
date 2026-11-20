// spec: trusted-control-room-2026-11-20 (plan CR-3, Task A5)
using System.Text.Json;
using FluentAssertions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Admin.ControlRoomPeople;
using ShramSafal.Domain.ControlRoom;
using Xunit;

namespace ShramSafal.Domain.Tests.ControlRoom;

/// <summary>The weekly trust report's numbers, computed from History reads (one read per action, K15).</summary>
public sealed class TrustReportCalculatorTests
{
    private static readonly DateTime Now = new(2026, 11, 21, 6, 0, 0, DateTimeKind.Utc);
    private static readonly Guid Founder = Guid.Parse("00000000-0000-0000-0000-0000000000f1");

    private static Guid U(int n) => Guid.Parse($"00000000-0000-0000-0000-{n:D12}");

    private static ControlRoomHistoryLine Line(string action, Guid actor, Guid subject, DateTime at, object? payload = null) =>
        new(Guid.NewGuid(), at, action, actor, subject, JsonSerializer.Serialize(payload ?? new { }));

    private static HistoryRead Read(bool hit, params ControlRoomHistoryLine[] lines) => new(lines, hit);

    private static HistoryRead Empty => Read(false);

    private static ControlRoomPerson Person(int n, Guid? user, ControlRoomRole role = ControlRoomRole.Viewer)
    {
        var p = ControlRoomPerson.Add(
            U(n), $"+91900000{n:D4}", $"Example: Person {n}", role, [], Founder, Now.AddDays(-60));
        if (user is { } u) p.BindTo(u, U(n + 5000), Now.AddDays(-59));
        return p;
    }

    private static PersonDto Dto(ControlRoomPerson p) =>
        new(p.Id, false, p.DisplayName, p.PhoneE164[3..], ControlRoomRoles.Key(p.StartingRole), p.Ticks, null, null, p.KeptAtUtc);

    private static TrustReportInput Input(
        IReadOnlyList<ControlRoomPerson>? people = null,
        HistoryRead? phones = null, HistoryRead? door = null, HistoryRead? signedIn = null, HistoryRead? kept = null,
        int founders = 1, IReadOnlySet<Guid>? testAccounts = null, IReadOnlySet<Guid>? testFarms = null)
    {
        var list = people ?? [];
        return new TrustReportInput(
            Now, list.Select(p => new TrustReportPerson(p, Dto(p))).ToList(), founders,
            phones ?? Empty, door ?? Empty, signedIn ?? Empty, kept ?? Empty,
            testAccounts ?? new HashSet<Guid>(), testFarms ?? new HashSet<Guid>());
    }

    private static ControlRoomHistoryLine Look(Guid actor, int daysAgo, params Guid[] farms) =>
        Line(ControlRoomHistoryAction.PhonesShown, actor, actor, Now.AddDays(-daysAgo), new { page = "contacts", farmIds = farms, count = farms.Length });

    private static ControlRoomHistoryLine UsersLook(Guid actor, int daysAgo) =>
        Line(ControlRoomHistoryAction.PhonesShown, actor, actor, Now.AddDays(-daysAgo), new { page = "users", personCount = 25, count = 25 });

    // ── G1 fix round 1 (M9): test accounts and their farms stay out of every count ─────────────────────────

    [Fact]
    public void Looks_by_test_accounts_are_left_out()
    {
        var a = U(901); var b = U(902); var c = U(903);
        var phones = Read(false,
            Look(Founder, 1, a, b),        // the founder is a test account (D-147a)
            UsersLook(Founder, 1),         // a Users-page look by a test account
            Look(U(1), 2, c),
            UsersLook(U(1), 2));           // a Users-page look by a team member still counts

        var report = TrustReportCalculator.Calculate(Input(phones: phones, testAccounts: new HashSet<Guid> { Founder }));

        report.PhoneLooks.Should().Be(new MisValueDto(2, null), "only the team member's two looks");
        report.PhoneFarms.Should().Be(new MisValueDto(1, null), "farm c; a and b were looked at by a test account only");
        report.PhoneLookers.Should().Be(new MisValueDto(1, null), "the founder is not counted");

        // The control: with no test accounts the same rows count in full.
        var all = TrustReportCalculator.Calculate(Input(phones: phones));
        all.PhoneLooks.Value.Should().Be(4);
        all.PhoneFarms.Value.Should().Be(3);
        all.PhoneLookers.Value.Should().Be(2);
    }

    [Fact]
    public void Test_farms_are_left_out_of_look_counts()
    {
        var a = U(901); var b = U(902); var test = U(990);
        var phones = Read(false,
            Look(U(1), 1, a, test),
            Look(U(2), 2, b, test));

        var report = TrustReportCalculator.Calculate(Input(phones: phones, testFarms: new HashSet<Guid> { test }));

        report.PhoneLooks.Should().Be(new MisValueDto(2, null), "each look also named a real farm");
        report.PhoneFarms.Should().Be(new MisValueDto(2, null), "a and b; the test farm is not a farm looked at");
        report.PhoneLookers.Should().Be(new MisValueDto(2, null));
    }

    [Fact]
    public void A_look_at_only_test_farms_is_not_counted()
    {
        var a = U(901); var test1 = U(990); var test2 = U(991);
        var phones = Read(false,
            Look(U(1), 1, test1, test2),
            Look(U(2), 2, a));

        var report = TrustReportCalculator.Calculate(Input(phones: phones, testFarms: new HashSet<Guid> { test1, test2 }));

        report.PhoneLooks.Should().Be(new MisValueDto(1, null), "a look at test farms only is not a look");
        report.PhoneFarms.Should().Be(new MisValueDto(1, null));
        report.PhoneLookers.Should().Be(new MisValueDto(1, null), "U(1) only looked at test farms, so is not counted as a looker");
    }

    [Fact]
    public void Phone_looks_count_distinct_farms_and_people()
    {
        var a = U(901); var b = U(902); var c = U(903);
        var phones = Read(false,
            Line(ControlRoomHistoryAction.PhonesShown, U(1), U(1), Now.AddDays(-1), new { page = "farms", farmIds = new[] { a, b }, count = 2 }),
            Line(ControlRoomHistoryAction.PhonesShown, U(1), U(1), Now.AddDays(-2), new { page = "contacts", farmIds = new[] { b, c }, count = 2 }),
            Line(ControlRoomHistoryAction.PhonesShown, U(2), U(2), Now.AddDays(-3), new { page = "farm_page", farmIds = new[] { a }, count = 1 }));

        var report = TrustReportCalculator.Calculate(Input(phones: phones));

        report.PhoneLooks.Should().Be(new MisValueDto(3, null));
        report.PhoneFarms.Should().Be(new MisValueDto(3, null));
        report.PhoneLookers.Should().Be(new MisValueDto(2, null));
    }

    [Fact]
    public void Refused_tries_count_only_door_refused()
    {
        var door = Read(false,
            Line(ControlRoomHistoryAction.DoorRefused, U(7), U(7), Now.AddDays(-1), new { step = "send", phoneTail = "0001", reason = "not_approved" }),
            Line(ControlRoomHistoryAction.DoorRefused, U(7), U(7), Now.AddDays(-2), new { step = "check", phoneTail = "0001", reason = "not_approved" }),
            Line(ControlRoomHistoryAction.CodeNotSent, U(7), U(7), Now.AddDays(-2), new { phoneTail = "0001", reason = "queue_full" }),
            Line(ControlRoomHistoryAction.SignedIn, U(8), U(8), Now.AddDays(-2)));

        var report = TrustReportCalculator.Calculate(Input(door: door));

        report.RefusedAtDoor.Should().Be(new MisValueDto(2, null));
    }

    [Fact]
    public void A_person_kept_in_the_last_30_days_is_not_listed_as_unused()
    {
        var kept = Person(1, U(101));
        var unused = Person(2, U(102));
        var signed = Person(3, U(103));
        var neverBound = Person(4, null);

        var signedIn = Read(false, Line(ControlRoomHistoryAction.SignedIn, U(103), U(103), Now.AddDays(-5)));
        var keptRows = Read(false, Line(ControlRoomHistoryAction.PersonKept, Founder, kept.Id, Now.AddDays(-10)));

        var report = TrustReportCalculator.Calculate(Input([kept, unused, signed, neverBound], signedIn: signedIn, kept: keptRows));

        report.NotSignedInNotMeasuredReason.Should().BeNull();
        report.NotSignedIn30Days.Select(p => p.PersonId).Should().BeEquivalentTo(new Guid?[] { unused.Id, neverBound.Id });
    }

    [Fact]
    public void Rows_older_than_seven_days_are_not_counted()
    {
        var a = U(901);
        var phones = Read(false,
            Line(ControlRoomHistoryAction.PhonesShown, U(1), U(1), Now.AddDays(-6), new { page = "farms", farmIds = new[] { a }, count = 1 }),
            Line(ControlRoomHistoryAction.PhonesShown, U(2), U(2), Now.AddDays(-8), new { page = "farms", farmIds = new[] { U(902) }, count = 1 }));
        var door = Read(false,
            Line(ControlRoomHistoryAction.DoorRefused, U(7), U(7), Now.AddDays(-8)));

        var report = TrustReportCalculator.Calculate(Input(phones: phones, door: door));

        report.PhoneLooks.Value.Should().Be(1);
        report.PhoneFarms.Value.Should().Be(1);
        report.PhoneLookers.Value.Should().Be(1);
        report.RefusedAtDoor.Value.Should().Be(0, "it was measured, and nothing was refused in the last 7 days");

        // A sign-in 31 days ago does not count for the 30-day list.
        var person = Person(1, U(101));
        var old = Read(false, Line(ControlRoomHistoryAction.SignedIn, U(101), U(101), Now.AddDays(-31)));
        TrustReportCalculator.Calculate(Input([person], signedIn: old)).NotSignedIn30Days.Should().ContainSingle();
    }

    [Fact]
    public void A_read_at_its_limit_is_not_measured_never_a_cut_number()
    {
        var capped = Read(true,
            Line(ControlRoomHistoryAction.PhonesShown, U(1), U(1), Now.AddDays(-1), new { page = "farms", farmIds = new[] { U(901) }, count = 1 }));
        var cappedDoor = Read(true, Line(ControlRoomHistoryAction.DoorRefused, U(7), U(7), Now.AddDays(-1)));
        var cappedSignedIn = Read(true, Line(ControlRoomHistoryAction.SignedIn, U(101), U(101), Now.AddDays(-1)));

        var report = TrustReportCalculator.Calculate(Input([Person(1, U(101))], phones: capped, door: cappedDoor, signedIn: cappedSignedIn));

        var reason = TrustReportCalculator.HistoryReadLimitReason;
        reason.Should().Be("history_read_limit");
        report.PhoneLooks.Should().Be(new MisValueDto(null, reason));
        report.PhoneFarms.Should().Be(new MisValueDto(null, reason));
        report.PhoneLookers.Should().Be(new MisValueDto(null, reason));
        report.RefusedAtDoor.Should().Be(new MisValueDto(null, reason));
        report.NotSignedInNotMeasuredReason.Should().Be(reason);
        report.NotSignedIn30Days.Should().BeEmpty("a cut list would name the wrong people");

        // The kept read at its limit does the same.
        var keptCapped = TrustReportCalculator.Calculate(Input([Person(1, U(101))], kept: Read(true)));
        keptCapped.NotSignedInNotMeasuredReason.Should().Be(reason);
    }

    [Fact]
    public void Downloads_say_they_start_with_field_visits()
    {
        var report = TrustReportCalculator.Calculate(Input());

        TrustReportCalculator.DownloadsReason.Should().Be("downloads_start_with_field_visits");
        foreach (var v in new[] { report.Downloads, report.DownloadFarmRows, report.Downloaders })
        {
            v.Value.Should().BeNull("a count never taken is not 0");
            v.NotMeasuredReason.Should().Be("downloads_start_with_field_visits");
        }
    }

    [Fact]
    public void People_with_access_count_the_founder_and_each_role()
    {
        var report = TrustReportCalculator.Calculate(Input(
            [Person(1, null, ControlRoomRole.Admin), Person(2, null, ControlRoomRole.Viewer), Person(3, null, ControlRoomRole.Viewer)]));

        report.PeopleWithAccess.Should().Be(4);
        report.PeopleByRole.Should().BeEquivalentTo(new Dictionary<string, int> { ["founder"] = 1, ["admin"] = 1, ["viewer"] = 2 });
        report.CountedAtUtc.Should().Be(Now);
    }
}
