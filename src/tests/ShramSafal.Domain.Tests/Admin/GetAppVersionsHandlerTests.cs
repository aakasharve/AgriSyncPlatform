// spec: control-room-app-versions-2026-11-12 (ADR 0028, plan CR-1c Task V2)
//
// Handler tests for GetAppVersionsHandler: who uses which app version. The
// counting rules live in the handler as pure code, so they are tested here
// with a hand-written IAdminOpsRepository and a fixed clock. No database.
//
// What is held:
//   - a person counts once, on the version of their MOST RECENT row
//   - versions are ordered by their numbers (1.0.9 is older than 1.0.18)
//   - "newest" is the highest version seen in use in the window
//   - people on a lower version are listed, most recently seen first, with
//     their names and farm names, and nothing that identifies a phone
//   - names and farm names are asked for only when somebody is behind, and
//     only about those people (opening the cross-farm reader writes an audit
//     row each time)
//   - nothing recorded yet is "not measured" (null), never a zero that looks
//     like a measurement
//   - device totals are passed through from the sign-in records
//   - the period is 7 or 30 days, anything else is 7, counted back from now
//   - a failing repository throws; it is never answered as an empty success
//
// Added in review round 2 (plan CR-1c Task V4):
//   - the answer always carries the number that every release up to 1.0.17
//     reports instead of its own ("0.9.0"), so the page can show those rows
//     as "1.0.17 or earlier" and never as a release called 0.9.0
//   - a phone reporting that number is counted like any other version: it
//     sorts below every real release and its person is listed as older
//   - the list of people on older versions stops at 200, most recent first;
//     the counts do not stop
//
// Not held here, stated plainly: the SQL behind the five repository methods.
// That needs a database and lives in
// ShramSafal.Admin.IntegrationTests/AdminOpsAppVersionsQueryTests.cs.

using FluentAssertions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Admin.GetAppVersions;
using Xunit;

namespace ShramSafal.Domain.Tests.Admin;

public sealed class GetAppVersionsHandlerTests
{
    /// <summary>10:00 UTC on 12 November 2026. Every time below is counted back from it.</summary>
    private static readonly DateTime Now = new(2026, 11, 12, 10, 0, 0, DateTimeKind.Utc);

    private static readonly Guid AdminUser = Guid.Parse("99999999-0000-0000-0000-000000000001");

    private static readonly Guid Sunita = Guid.Parse("aaaaaaaa-0000-0000-0000-000000000001");
    private static readonly Guid Ramesh = Guid.Parse("aaaaaaaa-0000-0000-0000-000000000002");
    private static readonly Guid Meena = Guid.Parse("aaaaaaaa-0000-0000-0000-000000000003");
    private static readonly Guid Asha = Guid.Parse("aaaaaaaa-0000-0000-0000-000000000004");
    private static readonly Guid Vijay = Guid.Parse("aaaaaaaa-0000-0000-0000-000000000005");
    private static readonly Guid Kiran = Guid.Parse("aaaaaaaa-0000-0000-0000-000000000006");

    // ------------------------------------------------------------------
    // Counting people by version
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_person_seen_on_two_versions_counts_once_on_the_latest()
    {
        var repo = new FakeOpsRepository { CountingBeganUtc = Now.AddDays(-6) };

        // Deliberately not in time order: the repository promises none.
        // Sunita updated the app in the middle of the week.
        repo.Rows.Add(Seen(Sunita, "1.0.18", Now.AddDays(-1)));
        repo.Rows.Add(Seen(Sunita, "1.0.17", Now.AddDays(-3)));

        // Meena's most recent use is on the OLDER app (a second phone, say).
        // "Latest" is the latest row, not the highest version she ever had.
        repo.Rows.Add(Seen(Meena, "1.0.18", Now.AddDays(-4)));
        repo.Rows.Add(Seen(Meena, "1.0.17", Now.AddHours(-2)));
        repo.Names[Meena] = "Meena Jadhav";

        var (data, _) = await Ask(repo, days: 7);

        data.People.Should().Be(2, "four rows, two people: nobody is counted twice");
        data.NewestVersion.Should().Be("1.0.18");
        data.Versions.Should().Equal(
            new AppVersionRowDto("1.0.18", 1, true),
            new AppVersionRowDto("1.0.17", 1, false));
        data.Versions.Sum(v => v.People).Should().Be(
            data.People, "each person is on exactly one version row");

        data.OnOlderVersions.Should().ContainSingle(
            "Sunita moved up to the newest version, so she is no longer behind; Meena's latest use was on 1.0.17");
        data.OnOlderVersions[0].Name.Should().Be("Meena Jadhav");
        data.OnOlderVersions[0].AppVersion.Should().Be("1.0.17");
        data.OnOlderVersions[0].LastSeenUtc.Should().Be(Now.AddHours(-2));
    }

    [Fact]
    public async Task Versions_compare_by_number_not_by_text()
    {
        var repo = new FakeOpsRepository { CountingBeganUtc = Now.AddDays(-6) };
        repo.Rows.Add(Seen(Sunita, "1.0.9", Now.AddHours(-1)));
        repo.Rows.Add(Seen(Ramesh, "1.0.18", Now.AddHours(-5)));
        repo.Rows.Add(Seen(Meena, "1.0.17", Now.AddHours(-3)));
        repo.Rows.Add(Seen(Asha, "1.0.9", Now.AddHours(-7)));

        var (data, _) = await Ask(repo);

        data.NewestVersion.Should().Be("1.0.18",
            "read as text, \"1.0.9\" sorts after \"1.0.18\"; read as numbers, 9 is less than 18");
        data.Versions.Should().Equal(
            new AppVersionRowDto("1.0.18", 1, true),
            new AppVersionRowDto("1.0.17", 1, false),
            new AppVersionRowDto("1.0.9", 2, false));

        // Most recently seen first: Sunita (1 hour ago), Meena (3), Asha (7).
        data.OnOlderVersions.Select(p => p.AppVersion).Should().Equal("1.0.9", "1.0.17", "1.0.9");
        data.OnOlderVersions.Select(p => p.LastSeenUtc).Should().Equal(
            Now.AddHours(-1), Now.AddHours(-3), Now.AddHours(-7));

        // A part that is not a number sorts lowest. "1.0.18-beta" starts with
        // a digit, so the recorder accepts it; the handler must order it, not
        // fall over it. Its third part is not a number, so it sorts below
        // every 1.0.<number>, 1.0.9 included.
        var odd = new FakeOpsRepository { CountingBeganUtc = Now.AddDays(-6) };
        odd.Rows.Add(Seen(Sunita, "1.0.18-beta", Now.AddHours(-1)));
        odd.Rows.Add(Seen(Ramesh, "1.0.18", Now.AddHours(-2)));
        odd.Rows.Add(Seen(Meena, "1.0.9", Now.AddHours(-3)));

        var (oddData, _) = await Ask(odd);

        oddData.NewestVersion.Should().Be("1.0.18");
        oddData.Versions.Should().Equal(
            new AppVersionRowDto("1.0.18", 1, true),
            new AppVersionRowDto("1.0.9", 1, false),
            new AppVersionRowDto("1.0.18-beta", 1, false));
    }

    [Fact]
    public async Task The_newest_version_is_the_highest_seen_in_the_window()
    {
        var repo = new FakeOpsRepository { CountingBeganUtc = Now.AddDays(-25) };

        // Kiran tried 1.0.19 three weeks ago and has not opened the app since.
        repo.Rows.Add(Seen(Kiran, "1.0.19", Now.AddDays(-20)));

        // This week: one person on 1.0.18, three on 1.0.17. So 1.0.17 is both
        // the most common version and the most recently used one.
        repo.Rows.Add(Seen(Sunita, "1.0.18", Now.AddDays(-5)));
        repo.Rows.Add(Seen(Ramesh, "1.0.17", Now.AddDays(-1)));
        repo.Rows.Add(Seen(Meena, "1.0.17", Now.AddHours(-1)));
        repo.Rows.Add(Seen(Asha, "1.0.17", Now.AddDays(-2)));

        repo.Names[Sunita] = "Sunita Pawar";
        repo.Names[Ramesh] = "Ramesh Patil";
        repo.Names[Meena] = "Meena Jadhav";
        repo.Names[Asha] = "Asha Shinde";

        var (week, _) = await Ask(repo, days: 7);

        week.NewestVersion.Should().Be("1.0.18",
            "newest is the HIGHEST version seen in use this week: not the most common, not the "
            + "most recently used, and not 1.0.19, which nobody used this week");
        week.People.Should().Be(4);
        week.Versions.Should().Equal(
            new AppVersionRowDto("1.0.18", 1, true),
            new AppVersionRowDto("1.0.17", 3, false));
        week.OnOlderVersions.Select(p => p.Name ?? "(no name)").Should().Equal(
            "Meena Jadhav", "Ramesh Patil", "Asha Shinde");

        // The same records over thirty days: 1.0.19 was seen in that window,
        // so it is the newest, and everybody else is behind it.
        var (month, _) = await Ask(repo, days: 30);

        month.NewestVersion.Should().Be("1.0.19");
        month.People.Should().Be(5);
        month.Versions.Should().Equal(
            new AppVersionRowDto("1.0.19", 1, true),
            new AppVersionRowDto("1.0.18", 1, false),
            new AppVersionRowDto("1.0.17", 3, false));
        month.OnOlderVersions.Select(p => p.Name ?? "(no name)").Should().Equal(
            "Meena Jadhav", "Ramesh Patil", "Asha Shinde", "Sunita Pawar");
        month.OnOlderVersions.Select(p => p.AppVersion).Should().Equal(
            "1.0.17", "1.0.17", "1.0.17", "1.0.18");
    }

    // ------------------------------------------------------------------
    // The people who are behind
    // ------------------------------------------------------------------

    [Fact]
    public async Task People_on_a_lower_version_are_listed_with_their_names_and_farms()
    {
        var repo = new FakeOpsRepository { CountingBeganUtc = Now.AddDays(-6) };

        repo.Rows.Add(Seen(Sunita, "1.0.18", Now.AddHours(-1)));
        repo.Rows.Add(Seen(Ramesh, "1.0.17", Now.AddDays(-6).AddHours(1)));
        repo.Rows.Add(Seen(Ramesh, "1.0.17", Now.AddDays(-2)));
        repo.Rows.Add(Seen(Meena, "1.0.9", Now.AddHours(-3)));
        repo.Rows.Add(Seen(Asha, "1.0.17", Now.AddDays(-5)));
        repo.Rows.Add(Seen(Vijay, "1.0.9", Now.AddDays(-4)));

        repo.Names[Sunita] = "Sunita Pawar";
        repo.Names[Ramesh] = "Ramesh Patil";
        repo.Names[Meena] = "Meena Jadhav";
        repo.Names[Asha] = null; // she has a user record, with no name on it
        // Vijay: no user record came back for him at all.

        repo.FarmNames[Sunita] = new[] { "Pawar Vasti" };
        repo.FarmNames[Ramesh] = new[] { "Patil Wadi" };
        repo.FarmNames[Meena] = new[] { "Jadhav Mala", "Nadikathcha Shet" };
        repo.FarmNames[Vijay] = new[] { "Vijay Baug" };
        // Asha: she is on no farm.

        var (data, _) = await Ask(repo);

        data.People.Should().Be(5);
        data.NewestVersion.Should().Be("1.0.18");
        data.Versions.Should().Equal(
            new AppVersionRowDto("1.0.18", 1, true),
            new AppVersionRowDto("1.0.17", 2, false),
            new AppVersionRowDto("1.0.9", 2, false));

        // Most recently seen first, whichever old version they are on:
        // Meena (3 hours ago), Ramesh (2 days), Vijay (4 days), Asha (5 days).
        data.OnOlderVersions.Should().HaveCount(4,
            "four of the five are behind; Sunita is on the newest version and is not listed");

        var meena = data.OnOlderVersions[0];
        meena.Name.Should().Be("Meena Jadhav");
        meena.FarmNames.Should().Equal("Jadhav Mala", "Nadikathcha Shet");
        meena.AppVersion.Should().Be("1.0.9");
        meena.LastSeenUtc.Should().Be(Now.AddHours(-3));

        var ramesh = data.OnOlderVersions[1];
        ramesh.Name.Should().Be("Ramesh Patil");
        ramesh.FarmNames.Should().Equal("Patil Wadi");
        ramesh.AppVersion.Should().Be("1.0.17");
        ramesh.LastSeenUtc.Should().Be(Now.AddDays(-2),
            "he was seen twice on the same version: he is listed once, at his latest use");

        var vijay = data.OnOlderVersions[2];
        vijay.Name.Should().BeNull(
            "no user record came back for him; the page says \"No name on record\", the handler invents nothing");
        vijay.FarmNames.Should().Equal("Vijay Baug");
        vijay.AppVersion.Should().Be("1.0.9");
        vijay.LastSeenUtc.Should().Be(Now.AddDays(-4));

        var asha = data.OnOlderVersions[3];
        asha.Name.Should().BeNull("her user record has no name on it");
        asha.FarmNames.Should().NotBeNull().And.BeEmpty(
            "a person on no farm has an empty list of farms; she is still listed");
        asha.AppVersion.Should().Be("1.0.17");
        asha.LastSeenUtc.Should().Be(Now.AddDays(-5));

        // Asked about those four, and not about Sunita.
        Guid[] behind = [Ramesh, Meena, Asha, Vijay];

        repo.NameCalls.Should().NotBeEmpty();
        repo.NameCalls.SelectMany(ids => ids).Distinct().Should().BeEquivalentTo(behind,
            "names are looked up only for the people who are behind");

        repo.FarmNameCalls.Should().ContainSingle(
            "every time the cross-farm reader is opened it writes one audit row, so it is opened once");
        repo.FarmNameCalls[0].AdminUserId.Should().Be(AdminUser,
            "that audit row has to name the admin who opened the page");
        repo.FarmNameCalls[0].PersonIds.Should().BeEquivalentTo(behind,
            "farm names are looked up only for the people who are behind");

        // The page never shows a phone number or a phone's identifier, and the
        // list carries no person id either. Held by the shape of the row.
        typeof(OlderVersionPersonDto).GetProperties().Select(p => p.Name).Should().BeEquivalentTo(
            new[] { "Name", "FarmNames", "AppVersion", "LastSeenUtc" },
            "a person behind is a name, their farms, a version and a time, and nothing else");
    }

    [Fact]
    public async Task Farm_names_are_asked_only_for_people_on_an_older_version()
    {
        // Everyone is on the newest version seen.
        var upToDate = new FakeOpsRepository { CountingBeganUtc = Now.AddDays(-6) };
        upToDate.Rows.Add(Seen(Sunita, "1.0.18", Now.AddHours(-1)));
        upToDate.Rows.Add(Seen(Ramesh, "1.0.18", Now.AddDays(-1)));
        upToDate.Rows.Add(Seen(Meena, "1.0.18", Now.AddDays(-3)));

        var (data, _) = await Ask(upToDate);

        data.People.Should().Be(3);
        data.Versions.Should().Equal(new AppVersionRowDto("1.0.18", 3, true));
        data.OnOlderVersions.Should().BeEmpty();
        upToDate.FarmNameCalls.Should().BeEmpty(
            "opening the cross-farm reader writes an audit row each time; with nobody behind "
            + "there is nothing to look up, so it is not opened at all");
        upToDate.NameCalls.Should().BeEmpty("nobody is behind, so there is nobody to name");

        // Asha falls behind. Now it is asked, once, about her alone.
        var oneBehind = new FakeOpsRepository { CountingBeganUtc = Now.AddDays(-6) };
        oneBehind.Rows.Add(Seen(Sunita, "1.0.18", Now.AddHours(-1)));
        oneBehind.Rows.Add(Seen(Ramesh, "1.0.18", Now.AddDays(-1)));
        oneBehind.Rows.Add(Seen(Meena, "1.0.18", Now.AddDays(-3)));
        oneBehind.Rows.Add(Seen(Asha, "1.0.17", Now.AddDays(-2)));
        oneBehind.Names[Asha] = "Asha Shinde";
        oneBehind.FarmNames[Asha] = new[] { "Shinde Mala" };

        var (behindData, _) = await Ask(oneBehind);

        behindData.OnOlderVersions.Should().ContainSingle();
        behindData.OnOlderVersions[0].Name.Should().Be("Asha Shinde");
        behindData.OnOlderVersions[0].FarmNames.Should().Equal("Shinde Mala");

        oneBehind.FarmNameCalls.Should().ContainSingle();
        oneBehind.FarmNameCalls[0].AdminUserId.Should().Be(AdminUser);
        oneBehind.FarmNameCalls[0].PersonIds.Should().BeEquivalentTo(new[] { Asha },
            "the three people on the newest version are not looked up");
        oneBehind.NameCalls.SelectMany(ids => ids).Distinct().Should().BeEquivalentTo(new[] { Asha });
    }

    [Fact]
    public async Task The_list_of_people_on_older_versions_stops_at_200()
    {
        // 205 people are behind. Person 1 used the app a minute ago, person
        // 205 two hundred and five minutes ago.
        var repo = OneUpToDateAnd(205);

        var (data, _) = await Ask(repo);

        data.OnOlderVersions.Should().HaveCount(200,
            "the list is for a person to read and act on; it stops at 200");
        data.OnOlderVersions.Select(p => p.Name ?? "(no name)").Should().Equal(
            Enumerable.Range(1, 200).Select(PersonName),
            "the 200 kept are the 200 most recently seen, most recent first; the five left off "
            + "are the five who used the app longest ago");
        data.OnOlderVersions[0].LastSeenUtc.Should().Be(Now.AddMinutes(-1));
        data.OnOlderVersions[199].LastSeenUtc.Should().Be(Now.AddMinutes(-200));
        data.OnOlderVersions.Should().OnlyContain(p => p.AppVersion == "1.0.17");

        // The limit is on the list only. The figures still count everybody,
        // or the page would say 200 people are behind when 205 are.
        data.People.Should().Be(206, "one person on the newest version and all 205 behind it");
        data.Versions.Should().Equal(
            new AppVersionRowDto("1.0.18", 1, true),
            new AppVersionRowDto("1.0.17", 205, false));

        repo.FarmNameCalls.Should().ContainSingle("the cross-farm reader is still opened once, not once per person");
        repo.FarmNameCalls[0].PersonIds.Should().NotContain(Sunita, "the person on the newest version is not looked up");

        // The control: exactly 200 behind is not over the limit. All 200 are
        // listed, so the test above is about the 201st person and beyond, not
        // about a list that is always cut short.
        var (atTheLimit, _) = await Ask(OneUpToDateAnd(200));

        atTheLimit.OnOlderVersions.Should().HaveCount(200);
        atTheLimit.OnOlderVersions.Select(p => p.Name ?? "(no name)").Should().Equal(
            Enumerable.Range(1, 200).Select(PersonName));
        atTheLimit.People.Should().Be(201);
    }

    // ------------------------------------------------------------------
    // Releases up to 1.0.17 all report "0.9.0" (review round 2)
    //
    // Until lane fix F69 the app sent package.json's version, "0.9.0", as
    // X-App-Version; from 1.0.18 it sends its real release. So every phone on
    // an old release is recorded as 0.9.0: a number that was never released,
    // and one that cannot tell 1.0.15, 1.0.16 and 1.0.17 apart. The handler
    // does not rewrite it (the rows keep what the phones really sent) and
    // does not count it differently. It names the number in every answer, and
    // the page shows "1.0.17 or earlier" wherever a version equals it.
    // ------------------------------------------------------------------

    [Fact]
    public async Task The_answer_names_the_number_old_releases_report()
    {
        GetAppVersionsHandler.LegacyVersionNumber.Should().Be("0.9.0",
            "that is the number every release up to 1.0.17 sends in place of its own");

        // Nothing recorded yet. The page still needs the number: it is a fact
        // about old releases, not something worked out from the rows.
        var (nothingYet, _) = await Ask(new FakeOpsRepository { CountingBeganUtc = null });

        nothingYet.MeasuredSinceUtc.Should().BeNull();
        nothingYet.LegacyVersionNumber.Should().Be("0.9.0");

        // Everybody is on a release that reports its real version.
        var upToDate = new FakeOpsRepository { CountingBeganUtc = Now.AddDays(-6) };
        upToDate.Rows.Add(Seen(Sunita, "1.0.18", Now.AddHours(-1)));
        upToDate.Rows.Add(Seen(Ramesh, "1.0.18", Now.AddDays(-2)));

        var (current, _) = await Ask(upToDate, days: 30);

        current.LegacyVersionNumber.Should().Be("0.9.0",
            "the number is in every answer, whether or not anybody reported it this period");

        // Somebody is on an old release.
        var mixed = new FakeOpsRepository { CountingBeganUtc = Now.AddDays(-6) };
        mixed.Rows.Add(Seen(Sunita, "1.0.18", Now.AddHours(-1)));
        mixed.Rows.Add(Seen(Ramesh, "0.9.0", Now.AddHours(-2)));

        var (withOld, _) = await Ask(mixed, days: 7);

        withOld.LegacyVersionNumber.Should().Be(GetAppVersionsHandler.LegacyVersionNumber,
            "the answer and the handler name one and the same number");
        withOld.LegacyVersionNumber.Should().Be("0.9.0");
    }

    [Fact]
    public async Task A_phone_on_an_old_release_reports_0_9_0_and_is_listed_as_older()
    {
        var repo = new FakeOpsRepository { CountingBeganUtc = Now.AddDays(-6) };

        // Sunita is on 1.0.18, which reports its real version.
        repo.Rows.Add(Seen(Sunita, "1.0.18", Now.AddDays(-2)));

        // Ramesh and Meena are on releases from before 1.0.18. Whichever one
        // it is, the phone says 0.9.0. Ramesh used the app an hour ago, more
        // recently than anybody on 1.0.18: being behind is about the version,
        // not about who was seen last.
        repo.Rows.Add(Seen(Ramesh, "0.9.0", Now.AddHours(-1)));
        repo.Rows.Add(Seen(Meena, "0.9.0", Now.AddDays(-3)));

        // Asha updated from an old release to 1.0.18 during the week. She
        // counts once, on the version of her latest use.
        repo.Rows.Add(Seen(Asha, "0.9.0", Now.AddDays(-5)));
        repo.Rows.Add(Seen(Asha, "1.0.18", Now.AddDays(-1)));

        repo.Names[Ramesh] = "Ramesh Patil";
        repo.Names[Meena] = "Meena Jadhav";
        repo.FarmNames[Ramesh] = new[] { "Patil Wadi" };
        repo.FarmNames[Meena] = new[] { "Jadhav Mala" };

        var (data, _) = await Ask(repo);

        data.People.Should().Be(4);
        data.NewestVersion.Should().Be("1.0.18",
            "0.9.0 sorts below every real release, so an old phone can never look like the newest");
        data.Versions.Should().Equal(
            new AppVersionRowDto("1.0.18", 2, true),
            new AppVersionRowDto("0.9.0", 2, false));

        data.OnOlderVersions.Select(p => p.Name ?? "(no name)").Should().Equal(
            new[] { "Ramesh Patil", "Meena Jadhav" },
            "the two people whose phones report 0.9.0 are the ones behind, most recently seen first; "
            + "Asha has moved on to 1.0.18");
        data.OnOlderVersions[0].FarmNames.Should().Equal("Patil Wadi");
        data.OnOlderVersions[1].FarmNames.Should().Equal("Jadhav Mala");

        // The rows keep the number the phones really sent. It is the page
        // that words it, by comparing with LegacyVersionNumber; a handler
        // that wrote "1.0.17 or earlier" (or "1.0.17") here would be stating
        // something no phone reported.
        data.OnOlderVersions.Should().OnlyContain(p => p.AppVersion == "0.9.0");

        var legacy = data.LegacyVersionNumber;
        legacy.Should().Be("0.9.0");
        data.OnOlderVersions.Should().OnlyContain(p => p.AppVersion == legacy,
            "this equality is how the page knows which rows to show as \"1.0.17 or earlier\"");
        data.Versions[1].AppVersion.Should().Be(legacy);

        // Counting is unchanged, so it has no special case either way. Before
        // anybody has updated, every phone reports 0.9.0: it is then the only
        // version seen in use, which makes it the newest seen, and nobody is
        // behind anybody.
        var allOld = new FakeOpsRepository { CountingBeganUtc = Now.AddDays(-6) };
        allOld.Rows.Add(Seen(Ramesh, "0.9.0", Now.AddHours(-1)));
        allOld.Rows.Add(Seen(Meena, "0.9.0", Now.AddDays(-3)));

        var (before, _) = await Ask(allOld);

        before.People.Should().Be(2);
        before.NewestVersion.Should().Be("0.9.0", "newest means newest seen in use, and nothing newer was seen");
        before.Versions.Should().Equal(new AppVersionRowDto("0.9.0", 2, true));
        before.OnOlderVersions.Should().BeEmpty("nobody is on a lower version than anybody else");
        before.LegacyVersionNumber.Should().Be("0.9.0");
        allOld.FarmNameCalls.Should().BeEmpty("with nobody behind, the cross-farm reader is not opened");
    }

    // ------------------------------------------------------------------
    // Nothing measured yet, and the device totals
    // ------------------------------------------------------------------

    [Fact]
    public async Task With_no_rows_nothing_is_measured()
    {
        // The recording has only just gone live: no app.seen row exists.
        var repo = new FakeOpsRepository
        {
            CountingBeganUtc = null,
            Devices = new SignInDevices(Phones: 4, OtherDevices: 1, PeopleWithUnknownDevice: 2),
        };

        var handler = new GetAppVersionsHandler(repo, new FixedClock(Now));
        var result = await handler.HandleAsync(new GetAppVersionsQuery(7, AdminUser));

        result.IsSuccess.Should().BeTrue("\"nothing recorded yet\" is an answer, not a failure");
        var data = result.Value!.Data;

        data.MeasuredSinceUtc.Should().BeNull(
            "null is how the route says \"not measured yet\"; the page must not show a zero it did not measure");
        data.People.Should().Be(0);
        data.NewestVersion.Should().BeNull("no version has been seen in use");
        data.Versions.Should().NotBeNull().And.BeEmpty();
        data.OnOlderVersions.Should().NotBeNull().And.BeEmpty();

        repo.FarmNameCalls.Should().BeEmpty("there is nobody to look up, so the cross-farm reader is not opened");
        repo.NameCalls.Should().BeEmpty();

        // The device figures do not depend on app.seen: the page still shows them.
        data.Phones.Should().Be(4);
        data.OtherDevices.Should().Be(1);
        data.PeopleWithUnknownDevice.Should().Be(2);
    }

    [Fact]
    public async Task Device_totals_come_from_sign_in_records()
    {
        var repo = new FakeOpsRepository
        {
            CountingBeganUtc = Now.AddDays(-6),
            Devices = new SignInDevices(Phones: 12, OtherDevices: 3, PeopleWithUnknownDevice: 5),
        };
        repo.Rows.Add(Seen(Sunita, "1.0.18", Now.AddHours(-1)));
        repo.Rows.Add(Seen(Ramesh, "1.0.18", Now.AddHours(-2)));

        var (data, _) = await Ask(repo);

        data.Phones.Should().Be(12);
        data.OtherDevices.Should().Be(3, "a browser sign-in is shown on its own, never counted as a phone");
        data.PeopleWithUnknownDevice.Should().Be(5);

        data.People.Should().Be(2,
            "people come from app.seen and devices from sign-in records; neither figure is worked out from the other");
        repo.SignInDevicesSince.Should().NotBeEmpty();
        repo.SignInDevicesSince.Should().OnlyContain(since => since == Now.AddDays(-7),
            "the device totals cover the same period as the people");
    }

    // ------------------------------------------------------------------
    // The period
    // ------------------------------------------------------------------

    [Fact]
    public async Task Days_other_than_7_or_30_fall_back_to_7()
    {
        int?[] notOffered = [null, 0, 1, -7, 8, 14, 29, 31, 90, 365, int.MaxValue, int.MinValue];

        foreach (var asked in notOffered)
        {
            var repo = SunitaThisWeekRameshTenDaysAgo();

            var (data, meta) = await Ask(repo, asked);

            var because = $"days={asked?.ToString() ?? "(not given)"} is not one of the two periods the page offers";
            data.Days.Should().Be(7, because);
            meta.Window.Should().Be("last 7 days", because);
            repo.AppSeenSince.Should().NotBeEmpty(because);
            repo.AppSeenSince.Should().OnlyContain(since => since == Now.AddDays(-7), because);
            data.People.Should().Be(1, because);
        }

        // The control: the two periods the page does offer are honoured, so
        // "always 7" does not pass.
        var (seven, sevenMeta) = await Ask(SunitaThisWeekRameshTenDaysAgo(), 7);
        seven.Days.Should().Be(7);
        sevenMeta.Window.Should().Be("last 7 days");
        seven.People.Should().Be(1);

        var (thirty, thirtyMeta) = await Ask(SunitaThisWeekRameshTenDaysAgo(), 30);
        thirty.Days.Should().Be(30);
        thirtyMeta.Window.Should().Be("last 30 days");
        thirty.People.Should().Be(2);
    }

    [Fact]
    public async Task The_window_starts_that_many_days_before_now()
    {
        // Now is 10:00 UTC on 12 November 2026.
        var sevenDaysBefore = new DateTime(2026, 11, 5, 10, 0, 0, DateTimeKind.Utc);
        var thirtyDaysBefore = new DateTime(2026, 10, 13, 10, 0, 0, DateTimeKind.Utc);

        var week = SunitaThisWeekRameshTenDaysAgo();
        var (weekData, weekMeta) = await Ask(week, 7);

        week.AppSeenSince.Should().NotBeEmpty();
        week.AppSeenSince.Should().OnlyContain(since => since == sevenDaysBefore,
            "the people are counted from seven days before the clock's now");
        week.SignInDevicesSince.Should().NotBeEmpty();
        week.SignInDevicesSince.Should().OnlyContain(since => since == sevenDaysBefore,
            "the device totals cover the same seven days");
        weekData.Days.Should().Be(7);
        weekData.People.Should().Be(1, "Ramesh last used the app ten days ago, outside the week");

        weekMeta.Source.Should().Be("live");
        weekMeta.Window.Should().Be("last 7 days");
        weekMeta.LastRefreshedUtc.Should().Be(Now, "the answer is stamped with the clock's now, not the machine's");
        weekMeta.TtlSeconds.Should().Be(0, "this answer is not cached");

        var month = SunitaThisWeekRameshTenDaysAgo();
        var (monthData, monthMeta) = await Ask(month, 30);

        month.AppSeenSince.Should().NotBeEmpty();
        month.AppSeenSince.Should().OnlyContain(since => since == thirtyDaysBefore);
        month.SignInDevicesSince.Should().NotBeEmpty();
        month.SignInDevicesSince.Should().OnlyContain(since => since == thirtyDaysBefore);
        monthData.Days.Should().Be(30);
        monthData.People.Should().Be(2, "ten days ago is inside thirty days");

        monthMeta.Source.Should().Be("live");
        monthMeta.Window.Should().Be("last 30 days");
        monthMeta.LastRefreshedUtc.Should().Be(Now);
        monthMeta.TtlSeconds.Should().Be(0);

        // "Counting since" is the day the recording began, whatever the
        // period: forty days ago here, earlier than either window.
        weekData.MeasuredSinceUtc.Should().Be(Now.AddDays(-40));
        monthData.MeasuredSinceUtc.Should().Be(Now.AddDays(-40));
    }

    // ------------------------------------------------------------------
    // A failed query is an error, never an empty success
    // ------------------------------------------------------------------

    [Fact]
    public async Task A_failing_repository_is_never_an_empty_answer()
    {
        string[] queries =
        [
            nameof(IAdminOpsRepository.GetAppSeenAsync),
            nameof(IAdminOpsRepository.GetAppSeenStartAsync),
            nameof(IAdminOpsRepository.GetSignInDevicesAsync),
            nameof(IAdminOpsRepository.GetPeopleNamesAsync),
            nameof(IAdminOpsRepository.GetFarmNamesByPersonAsync),
        ];

        foreach (var failing in queries)
        {
            // Somebody is behind, so all five queries are needed.
            var repo = new FakeOpsRepository { CountingBeganUtc = Now.AddDays(-6), FailIn = failing };
            repo.Rows.Add(Seen(Sunita, "1.0.18", Now.AddHours(-1)));
            repo.Rows.Add(Seen(Ramesh, "1.0.17", Now.AddHours(-2)));
            repo.Names[Ramesh] = "Ramesh Patil";
            repo.FarmNames[Ramesh] = new[] { "Patil Wadi" };

            var handler = new GetAppVersionsHandler(repo, new FixedClock(Now));

            var thrown = await Assert.ThrowsAsync<InvalidOperationException>(
                () => handler.HandleAsync(new GetAppVersionsQuery(7, AdminUser)));

            thrown.Should().BeSameAs(repo.Failure,
                $"when {failing} fails the failure reaches the server's own error path as it is: "
                + "an empty list would tell the team that nobody is behind");
            repo.Calls.Should().Contain(failing,
                "the failing query really was asked; if it never was, this proved nothing");
        }
    }

    // ------------------------------------------------------------------
    // Helpers
    // ------------------------------------------------------------------

    private static AppSeenRow Seen(Guid person, string version, DateTime atUtc) => new(person, version, atUtc);

    /// <summary>
    /// Counting began forty days ago. Sunita used the app two days ago and
    /// Ramesh ten days ago, both on 1.0.18: one person in a week, two in
    /// thirty days.
    /// </summary>
    private static FakeOpsRepository SunitaThisWeekRameshTenDaysAgo()
    {
        var repo = new FakeOpsRepository { CountingBeganUtc = Now.AddDays(-40) };
        repo.Rows.Add(Seen(Sunita, "1.0.18", Now.AddDays(-2)));
        repo.Rows.Add(Seen(Ramesh, "1.0.18", Now.AddDays(-10)));
        return repo;
    }

    /// <summary>One of the many people behind, numbered from 1. None collides with the named people above.</summary>
    private static Guid Person(int number) => new(number, 0, 0, new byte[8]);

    private static string PersonName(int number) => $"Person {number:D3}";

    /// <summary>
    /// Counting began six days ago. Sunita is on 1.0.18. <paramref name="behind"/>
    /// more people are on 1.0.17, person <c>n</c> last seen <c>n</c> minutes
    /// ago, each with a name. The rows are added in a scrambled order, because
    /// the repository promises none.
    /// </summary>
    private static FakeOpsRepository OneUpToDateAnd(int behind)
    {
        var repo = new FakeOpsRepository { CountingBeganUtc = Now.AddDays(-6) };
        repo.Rows.Add(Seen(Sunita, "1.0.18", Now.AddSeconds(-30)));

        // 211 is a prime above every count used here, so n -> 37n mod 211
        // gives each person a different sort key: a fixed, scrambled order.
        foreach (var number in Enumerable.Range(1, behind).OrderBy(n => (n * 37) % 211))
        {
            repo.Rows.Add(Seen(Person(number), "1.0.17", Now.AddMinutes(-number)));
            repo.Names[Person(number)] = PersonName(number);
        }

        return repo;
    }

    /// <summary>Asks as the admin, at <see cref="Now"/>, and expects an answer.</summary>
    private static async Task<(AppVersionsDto Data, AdminMetaDto Meta)> Ask(FakeOpsRepository repo, int? days = 7)
    {
        var handler = new GetAppVersionsHandler(repo, new FixedClock(Now));

        var result = await handler.HandleAsync(new GetAppVersionsQuery(days, AdminUser));

        result.IsSuccess.Should().BeTrue("the repository answered, so the handler has an answer");
        result.Value.Should().NotBeNull();
        return (result.Value!.Data, result.Value.Meta);
    }

    private sealed class FixedClock(DateTime now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => new(now, TimeSpan.Zero);
    }

    /// <summary>
    /// Hand-written <see cref="IAdminOpsRepository"/>. It behaves as the real
    /// one is specified to: rows are returned only from the asked-for moment
    /// on, in no particular order; names and farm names come back only for
    /// the people asked about, and only where there is something on record.
    /// It writes down everything it was asked. The three members that existed
    /// before this plan throw, so an unexpected code path fails loudly.
    /// </summary>
    private sealed class FakeOpsRepository : IAdminOpsRepository
    {
        // What the store holds.
        public List<AppSeenRow> Rows { get; } = new();

        public DateTime? CountingBeganUtc { get; set; }

        public SignInDevices Devices { get; set; } = new(Phones: 0, OtherDevices: 0, PeopleWithUnknownDevice: 0);

        public Dictionary<Guid, string?> Names { get; } = new();

        public Dictionary<Guid, IReadOnlyList<string>> FarmNames { get; } = new();

        // Which query fails, by method name. Null: none.
        public string? FailIn { get; set; }

        public InvalidOperationException Failure { get; } = new("the analytics store did not answer");

        // What the handler asked.
        public List<string> Calls { get; } = new();

        public List<DateTime> AppSeenSince { get; } = new();

        public List<DateTime> SignInDevicesSince { get; } = new();

        public List<Guid[]> NameCalls { get; } = new();

        public List<(Guid AdminUserId, Guid[] PersonIds)> FarmNameCalls { get; } = new();

        public Task<IReadOnlyList<AppSeenRow>> GetAppSeenAsync(DateTime sinceUtc, CancellationToken ct = default)
        {
            Calls.Add(nameof(GetAppSeenAsync));
            AppSeenSince.Add(sinceUtc);

            if (FailIn == nameof(GetAppSeenAsync))
            {
                return Task.FromException<IReadOnlyList<AppSeenRow>>(Failure);
            }

            IReadOnlyList<AppSeenRow> inWindow = Rows.Where(r => r.SeenAtUtc >= sinceUtc).ToList();
            return Task.FromResult(inWindow);
        }

        public Task<DateTime?> GetAppSeenStartAsync(CancellationToken ct = default)
        {
            Calls.Add(nameof(GetAppSeenStartAsync));

            return FailIn == nameof(GetAppSeenStartAsync)
                ? Task.FromException<DateTime?>(Failure)
                : Task.FromResult(CountingBeganUtc);
        }

        public Task<SignInDevices> GetSignInDevicesAsync(DateTime sinceUtc, CancellationToken ct = default)
        {
            Calls.Add(nameof(GetSignInDevicesAsync));
            SignInDevicesSince.Add(sinceUtc);

            return FailIn == nameof(GetSignInDevicesAsync)
                ? Task.FromException<SignInDevices>(Failure)
                : Task.FromResult(Devices);
        }

        public Task<IReadOnlyDictionary<Guid, string?>> GetPeopleNamesAsync(
            IReadOnlyCollection<Guid> personIds, CancellationToken ct = default)
        {
            Calls.Add(nameof(GetPeopleNamesAsync));
            NameCalls.Add(personIds.ToArray());

            if (FailIn == nameof(GetPeopleNamesAsync))
            {
                return Task.FromException<IReadOnlyDictionary<Guid, string?>>(Failure);
            }

            IReadOnlyDictionary<Guid, string?> found = personIds
                .Distinct()
                .Where(Names.ContainsKey)
                .ToDictionary(id => id, id => Names[id]);
            return Task.FromResult(found);
        }

        public Task<IReadOnlyDictionary<Guid, IReadOnlyList<string>>> GetFarmNamesByPersonAsync(
            Guid adminUserId, IReadOnlyCollection<Guid> personIds, CancellationToken ct = default)
        {
            Calls.Add(nameof(GetFarmNamesByPersonAsync));
            FarmNameCalls.Add((adminUserId, personIds.ToArray()));

            if (FailIn == nameof(GetFarmNamesByPersonAsync))
            {
                return Task.FromException<IReadOnlyDictionary<Guid, IReadOnlyList<string>>>(Failure);
            }

            IReadOnlyDictionary<Guid, IReadOnlyList<string>> found = personIds
                .Distinct()
                .Where(FarmNames.ContainsKey)
                .ToDictionary(id => id, id => FarmNames[id]);
            return Task.FromResult(found);
        }

        // The members that were on the port before this plan. This handler has
        // no business calling them.
        public Task<AdminOpsHealthDto> GetOpsHealthAsync(CancellationToken ct = default) =>
            throw new NotSupportedException();

        public Task<OpsErrorsPageDto> GetErrorsPagedAsync(
            int page, int pageSize, string? endpoint, DateTime? since, CancellationToken ct = default) =>
            throw new NotSupportedException();

        public Task<OpsVoiceTrendDto> GetVoiceTrendAsync(int days, CancellationToken ct = default) =>
            throw new NotSupportedException();

        // Added to the port after this plan, by plan CR-1a Task R1 (spec
        // control-room-go-live-must-haves-2026-11-10): the read behind
        // GET /shramsafal/admin/ops/recorded. This handler has no business
        // calling it either.
        public Task<IReadOnlyList<OpsRecordedRowDto>> GetRecordedAsync(
            DateTime sinceUtc, CancellationToken ct = default) =>
            throw new NotSupportedException();
    }
}
