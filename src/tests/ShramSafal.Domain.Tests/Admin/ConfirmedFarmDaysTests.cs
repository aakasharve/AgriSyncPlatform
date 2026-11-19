// spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, Task 6 as replaced by C32; C33)
//
// The confirmed farm-days rule as pure code, written by the test-writer from the plan only:
//   - the old nightly view's rule (any entry that India day with a Confirmed/Verified event at or before
//     created + 48 hours, no lower bound) is ConfirmedOldRule
//   - Checked = a deliberate check (reason null or none of the five markers) by a person who is neither a test account
//     nor the person who saved the entry; SelfOnly = ConfirmedOldRule and not Checked
//   - India weeks (Monday to Sunday); the current week is partial and never the headline
//   - no goal is sent; a week with no active farm is null, never 0
//   - not measured (never 0): above the ceiling, no farm listed, a farm not readable
//   - test accounts: owned farms, saved entries and made checks are left out
//   - events at or after the counting instant are ignored
// Fixed instant: 06:30 UTC on Wed 18 Nov 2026 = 12:00 India time. Last complete week = Mon 9 - Sun 15 Nov, the week
// before it = Mon 2 Nov, the current (partial) week = Mon 16 Nov. Made-up GUIDs only.

using AgriSync.BuildingBlocks.Results;
using FluentAssertions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Admin.GetCompanyMis;
using ShramSafal.Application.UseCases.Admin.GetFarmsList;
using ShramSafal.Application.UseCases.Admin.GetWvfdHistory;
using ShramSafal.Domain.Logs;
using Xunit;

namespace ShramSafal.Domain.Tests.Admin;

public sealed class ConfirmedFarmDaysTests
{
    private static readonly TimeSpan IstOffset = TimeSpan.FromMinutes(330);
    private static readonly DateTime CountedAt = new(2026, 11, 18, 6, 30, 0, DateTimeKind.Utc);
    private static readonly Guid Admin = Guid.Parse("99999999-0000-0000-0000-0000000c2e60");
    private static readonly Guid Saver = Guid.Parse("c2e60000-0000-0000-0000-000000005a01");
    private static readonly Guid Checker = Guid.Parse("c2e60000-0000-0000-0000-000000005a02");
    private static readonly Guid TestAccount = Guid.Parse("c2e60000-0000-0000-0000-000000005a99");

    private const string SelfAttested = DailyLog.SelfAttestationReason;

    private static readonly DateOnly LastWeek = new(2026, 11, 9);
    private static readonly DateOnly PriorWeek = new(2026, 11, 2);
    private static readonly DateOnly CurrentWeek = new(2026, 11, 16);

    // ── The 48-hour rule and the checker rule ───────────────────────────────

    [Fact]
    public void A_self_attested_entry_counts_self_only_never_checked()
    {
        var farm = Id(1);
        var entries = new List<ConfirmedEntryRow>();
        var checks = new List<ConfirmedCheckRow>();

        // Mon: only the self-attestation written when the entry is saved (C23).
        var mon = Entry(entries, farm, Ist(11, 9, 10));
        checks.Add(Check(mon, VerificationStatus.Confirmed, SelfAttested, Saver, mon.CreatedAtUtc));

        // Tue: the saver's own "deliberate" check, no marker (a speaker with authority, reason null): still self.
        var tue = Entry(entries, farm, Ist(11, 10, 10));
        checks.Add(Check(tue, VerificationStatus.Verified, null, Saver, tue.CreatedAtUtc.AddHours(3)));

        var week = LastWeekOf(farm, Rows(Farms(farm), entries, checks));

        week.CheckedDays.Should().Be(0, "neither day was checked by a person other than the one who saved it");
        week.SelfOnlyDays.Should().Be(2);
        week.ConfirmedOldRuleDays.Should().Be(2, "the old view counted both days");
        week.EngagementTier.Should().Be("D", "the tier follows checked days, so a farm that only self-confirmed is D");
        week.Wvfd.Should().Be(0);
    }

    [Fact]
    public void A_deliberate_check_within_48_hours_counts_checked()
    {
        var farm = Id(1);
        var entries = new List<ConfirmedEntryRow>();
        var checks = new List<ConfirmedCheckRow>();

        // Mon to Fri: a Confirmed event by ANOTHER person that carries one of the five markers is not a deliberate
        // check; it is still the old rule's "confirmed", so the day is self-only.
        var markers = new[]
        {
            DailyLog.SelfAttestationReason, DailyLog.BackfilledAttestationReason, DailyLog.EnRouteConfirmReason,
            DailyLog.SpeakerOwnMarkReason, DailyLog.NoConfirmAuthorityMarkReason,
        };
        for (var i = 0; i < markers.Length; i++)
        {
            var e = Entry(entries, farm, Ist(11, 9 + i, 10));
            checks.Add(Check(e, VerificationStatus.Confirmed, markers[i], Checker, e.CreatedAtUtc.AddHours(2)));
        }

        // Sat: a person other than the saver confirms with a stated reason: a deliberate check.
        var sat = Entry(entries, farm, Ist(11, 14, 10));
        checks.Add(Check(sat, VerificationStatus.Confirmed, SelfAttested, Saver, sat.CreatedAtUtc));
        checks.Add(Check(sat, VerificationStatus.Verified, null, Checker, sat.CreatedAtUtc.AddHours(5)));

        // Sun: a Draft event is neither the old rule nor a check.
        var sun = Entry(entries, farm, Ist(11, 15, 10));
        checks.Add(Check(sun, VerificationStatus.Draft, null, Checker, sun.CreatedAtUtc.AddHours(1)));

        var week = LastWeekOf(farm, Rows(Farms(farm), entries, checks));

        week.CheckedDays.Should().Be(1, "only Saturday has a person's deliberate check by someone else");
        week.SelfOnlyDays.Should().Be(5, "the five marker days are confirmed by the old rule but not checked");
        week.ConfirmedOldRuleDays.Should().Be(6, "Sunday's Draft event is not confirmed even by the old rule");
        week.Wvfd.Should().Be(1);
        week.EngagementTier.Should().Be("C");
    }

    [Fact]
    public void A_check_after_48_hours_does_not_count()
    {
        var farm = Id(1);
        var entries = new List<ConfirmedEntryRow>();
        var checks = new List<ConfirmedCheckRow>();

        // Mon: exactly 48 hours after the entry counts.
        var exact = Entry(entries, farm, Ist(11, 9, 10));
        checks.Add(Check(exact, VerificationStatus.Verified, null, Checker, exact.CreatedAtUtc.AddHours(48)));

        // Tue: one millisecond later does not. Its self-attestation is the day's only counted event.
        var late = Entry(entries, farm, Ist(11, 10, 10));
        checks.Add(Check(late, VerificationStatus.Confirmed, SelfAttested, Saver, late.CreatedAtUtc));
        checks.Add(Check(late, VerificationStatus.Verified, null, Checker,
            late.CreatedAtUtc.AddHours(48).AddMilliseconds(1)));

        // Wed: a late check and nothing else: not confirmed by the old rule at all.
        var onlyLate = Entry(entries, farm, Ist(11, 11, 10));
        checks.Add(Check(onlyLate, VerificationStatus.Verified, null, Checker,
            onlyLate.CreatedAtUtc.AddHours(48).AddMilliseconds(1)));

        var week = LastWeekOf(farm, Rows(Farms(farm), entries, checks));

        week.CheckedDays.Should().Be(1, "Monday only: exactly 48 hours counts");
        week.SelfOnlyDays.Should().Be(1, "Tuesday: the late check is not a check; the self-attestation is");
        week.ConfirmedOldRuleDays.Should().Be(2, "Wednesday has no event inside 48 hours");
    }

    [Fact]
    public void A_check_before_the_entry_has_no_lower_bound_as_the_old_rule()
    {
        var farm = Id(1);
        var entries = new List<ConfirmedEntryRow>();
        var e = Entry(entries, farm, Ist(11, 9, 10));
        var checks = new List<ConfirmedCheckRow>
        {
            Check(e, VerificationStatus.Verified, null, Checker, e.CreatedAtUtc.AddHours(-3)),
        };

        var week = LastWeekOf(farm, Rows(Farms(farm), entries, checks));

        week.ConfirmedOldRuleDays.Should().Be(1, "the old view has no lower bound");
        week.CheckedDays.Should().Be(1);
    }

    [Fact]
    public void Events_at_or_after_the_counting_instant_are_ignored()
    {
        var farm = Id(1);
        var entries = new List<ConfirmedEntryRow>();
        var e = Entry(entries, farm, Ist(11, 17, 10));
        var checks = new List<ConfirmedCheckRow>
        {
            Check(e, VerificationStatus.Verified, null, Checker, CountedAt),
            Check(e, VerificationStatus.Verified, null, Checker, CountedAt.AddMinutes(5)),
        };
        // An entry at the counting instant itself is not counted either.
        Entry(entries, farm, CountedAt);

        var days = ConfirmedFarmDays.Days(Rows(Farms(farm), entries, checks), new HashSet<Guid>(), CountedAt);

        var day = days.Should().ContainSingle().Which;
        day.ConfirmedOldRule.Should().BeFalse("the only check is at or after the counting instant");
        day.Checked.Should().BeFalse();
    }

    // ── Weeks ───────────────────────────────────────────────────────────────

    [Fact]
    public void Weeks_are_india_weeks()
    {
        var entries = new List<ConfirmedEntryRow>();
        var checks = new List<ConfirmedCheckRow>();

        // Sun 8 Nov 23:30 IST: the prior week (Mon 2 Nov).
        CheckedEntry(entries, checks, Id(1), Ist(11, 8, 23, 30));
        // Mon 9 Nov 00:10 IST is Sun 8 Nov 18:40 UTC: a UTC week would put it in the prior week; India's is last week.
        CheckedEntry(entries, checks, Id(2), Ist(11, 9, 0, 10));
        // Sun 15 Nov 23:30 IST: still last week.
        CheckedEntry(entries, checks, Id(3), Ist(11, 15, 23, 30));
        // Mon 16 Nov 00:30 IST is Sun 15 Nov 19:00 UTC: a UTC week would put it in last week; India's is the current.
        CheckedEntry(entries, checks, Id(4), Ist(11, 16, 0, 30));

        var dto = History(Rows(Farms(Id(1), Id(2), Id(3), Id(4)), entries, checks));

        dto.NotMeasuredReason.Should().BeNull();
        WeekOf(dto, PriorWeek).ActiveFarms.Should().Be(1, "only the 23:30 IST Sunday entry");
        WeekOf(dto, LastWeek).ActiveFarms.Should().Be(2, "00:10 IST Monday and 23:30 IST Sunday");
        WeekOf(dto, CurrentWeek).ActiveFarms.Should().Be(1, "00:30 IST Monday is in the new India week");
        dto.Farms.Select(f => f.FarmId).Should().BeEquivalentTo(new[] { Id(2), Id(3) });
        ConfirmedFarmDays.WeekStart(new DateOnly(2026, 11, 15)).Should().Be(LastWeek, "a Sunday belongs to the week it ends");
        ConfirmedFarmDays.WeekStart(new DateOnly(2026, 11, 16)).Should().Be(CurrentWeek);
    }

    [Fact]
    public void The_current_week_is_partial_and_not_the_headline()
    {
        var entries = new List<ConfirmedEntryRow>();
        var checks = new List<ConfirmedCheckRow>();

        // Last week: farm 1 has 2 checked days. The current week so far: farm 2 has 1 checked day.
        CheckedEntry(entries, checks, Id(1), Ist(11, 9, 10));
        CheckedEntry(entries, checks, Id(1), Ist(11, 10, 10));
        CheckedEntry(entries, checks, Id(2), Ist(11, 17, 10));

        var dto = History(Rows(Farms(Id(1), Id(2)), entries, checks), completeWeeks: 4);

        dto.Weeks.Should().HaveCount(5, "the chosen four complete weeks plus the current week so far");
        dto.Weeks.Select(w => w.WeekStart).Should().Equal(
            new DateOnly(2026, 10, 19), new DateOnly(2026, 10, 26), PriorWeek, LastWeek, CurrentWeek);
        dto.Weeks.Take(4).Should().OnlyContain(w => !w.IsPartial);
        dto.Weeks[^1].IsPartial.Should().BeTrue("the current week is flagged partial");
        dto.Weeks[^1].ActiveFarms.Should().Be(1);

        dto.CurrentWvfd.Should().Be(2m, "the headline is last week's average, not the current week's");
        dto.Farms.Select(f => f.FarmId).Should().Equal(Id(1));
    }

    [Fact]
    public void No_goal_is_sent()
    {
        var entries = new List<ConfirmedEntryRow>();
        var checks = new List<ConfirmedCheckRow>();
        CheckedEntry(entries, checks, Id(1), Ist(11, 9, 10));

        History(Rows(Farms(Id(1)), entries, checks)).GoalWvfd.Should().BeNull("W5: no goal is set, so none is sent");
        History(Rows(Farms(Id(1)), entries, checks, listed: 0)).GoalWvfd.Should().BeNull("not even when not measured");
    }

    [Fact]
    public void A_week_with_no_active_farm_is_null_not_zero()
    {
        var entries = new List<ConfirmedEntryRow>();
        var checks = new List<ConfirmedCheckRow>();

        // The prior week: a farm saved an entry nobody confirmed (active, zero checked days: 0 is real).
        Entry(entries, Id(1), Ist(11, 3, 10));
        // Last week: nothing. The current week: one checked entry.
        CheckedEntry(entries, checks, Id(1), Ist(11, 17, 10));

        var dto = History(Rows(Farms(Id(1)), entries, checks));

        var last = WeekOf(dto, LastWeek);
        last.ActiveFarms.Should().Be(0);
        last.AvgWvfd.Should().BeNull("no farm saved an entry that week: not measured, never 0");
        last.AvgSelfOnlyDays.Should().BeNull();
        dto.CurrentWvfd.Should().BeNull();
        dto.CurrentSelfOnlyDays.Should().BeNull();
        dto.Farms.Should().BeEmpty();

        var prior = WeekOf(dto, PriorWeek);
        prior.ActiveFarms.Should().Be(1);
        prior.AvgWvfd.Should().Be(0m, "an active farm with no checked day IS a real zero");
        dto.PriorWvfd.Should().Be(0m);
    }

    [Fact]
    public void The_average_is_checked_days_per_active_farm_rounded_to_two_places()
    {
        var entries = new List<ConfirmedEntryRow>();
        var checks = new List<ConfirmedCheckRow>();

        // Three active farms last week: 2, 1 and 1 checked days = 4 / 3 = 1.33; self-only 0, 1, 0 = 0.33.
        CheckedEntry(entries, checks, Id(1), Ist(11, 9, 10));
        CheckedEntry(entries, checks, Id(1), Ist(11, 10, 10));
        CheckedEntry(entries, checks, Id(2), Ist(11, 9, 10));
        CheckedEntry(entries, checks, Id(3), Ist(11, 9, 10));
        var self = Entry(entries, Id(2), Ist(11, 11, 10));
        checks.Add(Check(self, VerificationStatus.Confirmed, SelfAttested, Saver, self.CreatedAtUtc));

        var dto = History(Rows(Farms(Id(1), Id(2), Id(3)), entries, checks));

        dto.CurrentWvfd.Should().Be(1.33m);
        dto.CurrentSelfOnlyDays.Should().Be(0.33m);
        WeekOf(dto, LastWeek).ActiveFarms.Should().Be(3);

        // Every farm with a counted entry last week is listed (no top-50), ordered by checked days, then self-only
        // days, then farm id.
        dto.Farms.Should().Equal(
            new WvfdFarmRowDto(Id(1), 2, 0, "C"),
            new WvfdFarmRowDto(Id(2), 1, 1, "C"),
            new WvfdFarmRowDto(Id(3), 1, 0, "C"));
    }

    [Fact]
    public void Every_farm_with_a_counted_entry_is_listed_with_no_limit_of_fifty()
    {
        var entries = new List<ConfirmedEntryRow>();
        var checks = new List<ConfirmedCheckRow>();
        var farms = Enumerable.Range(1, 60).Select(Id).ToArray();
        foreach (var farm in farms)
        {
            CheckedEntry(entries, checks, farm, Ist(11, 9, 10));
        }

        var dto = History(Rows(Farms(farms), entries, checks));

        dto.Farms.Should().HaveCount(60, "W6's tier counts must be complete");
    }

    // ── Tiers ───────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(0, "D")]
    [InlineData(1, "C")]
    [InlineData(2, "C")]
    [InlineData(3, "B")]
    [InlineData(4, "B")]
    [InlineData(5, "A")]
    [InlineData(7, "A")]
    public void Tier_filter_uses_the_counted_tiers(int checkedDays, string tier)
    {
        ConfirmedFarmDays.TierOf(checkedDays).Should().Be(tier);

        // End to end through the rule: a farm with that many checked days (and a self-only day beside them, which
        // never lifts the tier) lands in that tier.
        var entries = new List<ConfirmedEntryRow>();
        var checks = new List<ConfirmedCheckRow>();
        for (var d = 0; d < checkedDays; d++)
        {
            CheckedEntry(entries, checks, Id(1), Ist(11, 9 + d, 10));
        }

        if (checkedDays < 7)
        {
            var self = Entry(entries, Id(1), Ist(11, 15, 12));
            checks.Add(Check(self, VerificationStatus.Confirmed, SelfAttested, Saver, self.CreatedAtUtc));
        }

        var week = LastWeekOf(Id(1), Rows(Farms(Id(1)), entries, checks));
        week.EngagementTier.Should().Be(tier);
    }

    [Fact]
    public void The_old_rule_tier_is_kept_for_the_equivalence_check_only()
    {
        var entries = new List<ConfirmedEntryRow>();
        var checks = new List<ConfirmedCheckRow>();
        for (var d = 0; d < 5; d++)
        {
            var e = Entry(entries, Id(1), Ist(11, 9 + d, 10));
            checks.Add(Check(e, VerificationStatus.Confirmed, SelfAttested, Saver, e.CreatedAtUtc));
        }

        var week = LastWeekOf(Id(1), Rows(Farms(Id(1)), entries, checks));

        week.ConfirmedOldRuleTier.Should().Be("A", "the old view counted all five self-attested days");
        week.EngagementTier.Should().Be("D", "the headline tier counts checked days only");
        week.ConfirmedOldRuleWvfd.Should().Be(5);
    }

    // ── Not measured ────────────────────────────────────────────────────────

    [Fact]
    public void Above_the_ceiling_is_not_measured()
    {
        var rows = new ConfirmedFarmDaysRows(501, 0, [], [], [], LiveCountSkipped: true);

        ConfirmedFarmDays.NotMeasuredReason(rows).Should().Be("too_many_farms_for_live_count");
        var dto = History(rows);

        AssertNotMeasured(dto, "too_many_farms_for_live_count");
        Action asFarmDays = () => ConfirmedFarmDays.LastCompleteWeek(rows, new HashSet<Guid>(), CountedAt);
        asFarmDays.Should().Throw<InvalidOperationException>(
            "All Farms must never say \"No entry last week\" for farms whose entries were not read");
    }

    [Fact]
    public void An_unreadable_farm_list_is_not_measured()
    {
        // No farm listed at all.
        AssertNotMeasured(History(Rows(Farms(), [], [], listed: 0)), "farm_list_unreadable");

        // A farm listed but not readable: a number over the others would be partial.
        var entries = new List<ConfirmedEntryRow>();
        var checks = new List<ConfirmedCheckRow>();
        CheckedEntry(entries, checks, Id(1), Ist(11, 9, 10));
        var partial = new ConfirmedFarmDaysRows(2, 1, Farms(Id(1)), entries, checks, false);

        ConfirmedFarmDays.NotMeasuredReason(partial).Should().Be("farm_list_unreadable");
        AssertNotMeasured(History(partial), "farm_list_unreadable");

        // The ceiling is reported before an unreadable farm (the Company MIS order).
        ConfirmedFarmDays.NotMeasuredReason(new ConfirmedFarmDaysRows(900, 3, [], [], [], true))
            .Should().Be("too_many_farms_for_live_count");
    }

    // ── Test accounts ───────────────────────────────────────────────────────

    [Fact]
    public void A_test_accounts_entries_and_checks_are_not_counted()
    {
        var excluded = new HashSet<Guid> { TestAccount };
        var entries = new List<ConfirmedEntryRow>();
        var checks = new List<ConfirmedCheckRow>();

        // Farm 1 (real): an entry saved by the test account with a real check (left out); an entry saved by the real
        // saver whose ONLY check was made by the test account (ignored entirely: not even the old rule); the same with
        // a self-attestation beside it (self-only); and a real checked entry (the control).
        var byTest = Entry(entries, Id(1), Ist(11, 9, 10), TestAccount);
        checks.Add(Check(byTest, VerificationStatus.Verified, null, Checker, byTest.CreatedAtUtc.AddHours(1)));

        var testCheckOnly = Entry(entries, Id(1), Ist(11, 10, 10));
        checks.Add(Check(testCheckOnly, VerificationStatus.Verified, null, TestAccount, testCheckOnly.CreatedAtUtc.AddHours(1)));

        var testCheckPlusSelf = Entry(entries, Id(1), Ist(11, 11, 10));
        checks.Add(Check(testCheckPlusSelf, VerificationStatus.Confirmed, SelfAttested, Saver, testCheckPlusSelf.CreatedAtUtc));
        checks.Add(Check(testCheckPlusSelf, VerificationStatus.Verified, null, TestAccount, testCheckPlusSelf.CreatedAtUtc.AddHours(1)));

        CheckedEntry(entries, checks, Id(1), Ist(11, 12, 10));

        // Farm 2: owned by the test account, with a fully checked entry: left out with everything on it.
        CheckedEntry(entries, checks, Id(2), Ist(11, 9, 10));

        var rows = new ConfirmedFarmDaysRows(
            2, 0, [new ConfirmedFarmRow(Id(1), Saver), new ConfirmedFarmRow(Id(2), TestAccount)], entries, checks, false);

        var week = ConfirmedFarmDays.Weeks(ConfirmedFarmDays.Days(rows, excluded, CountedAt))
            .Should().ContainSingle(w => w.WeekStart == LastWeek && w.FarmId == Id(1)).Which;
        week.CheckedDays.Should().Be(1, "only the real checked entry");
        week.SelfOnlyDays.Should().Be(1, "the self-attestation; the test account's check changes nothing");
        week.ConfirmedOldRuleDays.Should().Be(2);

        var dto = ConfirmedFarmDays.History(rows, excluded, CountedAt, 4);
        dto.Farms.Select(f => f.FarmId).Should().Equal(new[] { Id(1) }, "the farm owned by the test account is left out");
        WeekOf(dto, LastWeek).ActiveFarms.Should().Be(1);

        // Without the exclusion list the same rows count the test account's farm and entry.
        ConfirmedFarmDays.History(rows, new HashSet<Guid>(), CountedAt, 4).Farms.Should().HaveCount(2);
    }

    // ── All Farms uses the same function ────────────────────────────────────

    [Fact]
    public void All_farms_uses_the_same_function_and_one_factory_open()
    {
        var entries = new List<ConfirmedEntryRow>();
        var checks = new List<ConfirmedCheckRow>();
        CheckedEntry(entries, checks, Id(1), Ist(11, 9, 10));
        CheckedEntry(entries, checks, Id(1), Ist(11, 10, 10));
        var self = Entry(entries, Id(2), Ist(11, 9, 10));
        checks.Add(Check(self, VerificationStatus.Confirmed, SelfAttested, Saver, self.CreatedAtUtc));
        var rows = Rows(Farms(Id(1), Id(2), Id(3)), entries, checks);

        var history = History(rows);
        var lastWeek = ConfirmedFarmDays.LastCompleteWeek(rows, new HashSet<Guid>(), CountedAt);

        // Both views of the same rows agree, farm by farm.
        foreach (var row in history.Farms)
        {
            var week = lastWeek[row.FarmId]!;
            week.Wvfd.Should().Be(row.CheckedDays);
            week.SelfOnlyDays.Should().Be(row.SelfOnlyDays);
            week.EngagementTier.Should().Be(row.EngagementTier);
        }

        lastWeek.Should().ContainKey(Id(3));
        lastWeek[Id(3)].Should().BeNull("a readable farm with no counted entry last week is \"No entry last week\", not tier D");
    }

    // ── The route's handler: platform owners only ───────────────────────────

    [Fact]
    public async Task The_wvfd_route_refuses_a_non_platform_admin()
    {
        var reader = new RecordingReader(Rows(Farms(Id(1)), [], []));
        var handler = new GetWvfdHistoryHandler(reader, CompanyMisExclusions.None, new FixedClock(CountedAt));

        var refused = await handler.HandleAsync(new GetWvfdHistoryQuery(4, Admin, IsPlatformAdmin: false));

        refused.IsSuccess.Should().BeFalse();
        refused.Error.Kind.Should().Be(ErrorKind.Forbidden);
        reader.Calls.Should().Be(0, "a refused caller opens no audited factory and reads no farm");

        var allowed = await handler.HandleAsync(new GetWvfdHistoryQuery(4, Admin, IsPlatformAdmin: true));
        allowed.IsSuccess.Should().BeTrue();
        reader.Calls.Should().Be(1);
        reader.AdminUserId.Should().Be(Admin, "the signed-in admin is named on the factory's audit row");
        reader.CountedAtUtc.Should().Be(CountedAt);
        reader.SinceUtc.Should().Be(new DateTime(2026, 10, 18, 18, 30, 0, DateTimeKind.Utc),
            "entries load from 00:00 India time of the Monday 4 weeks before this week's Monday (19 Oct)");
        allowed.Value!.Meta.Source.Should().Be("live");
    }

    // ── C33: the tier on All Farms ──────────────────────────────────────────

    [Theory]
    [InlineData("E")]
    [InlineData("Z")]
    [InlineData("AB")]
    [InlineData("1")]
    [InlineData("A; DROP TABLE ssf.farms")]
    public async Task An_unknown_tier_is_refused(string tier)
    {
        var repo = new RecordingFarmsRepository();
        var handler = new GetFarmsListHandler(repo);

        var result = await handler.HandleAsync(new GetFarmsListQuery(1, 50, null, tier, Admin));

        result.IsSuccess.Should().BeFalse();
        result.Error.Kind.Should().Be(ErrorKind.Validation, "the route answers 400");
        result.Error.Code.Should().Be("tier_invalid");
        repo.Calls.Should().Be(0, "refused at once, before anything is read");
    }

    [Theory]
    [InlineData("A")]
    [InlineData("B")]
    [InlineData("C")]
    [InlineData("D")]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    public async Task A_valid_or_blank_tier_is_read(string? tier)
    {
        var repo = new RecordingFarmsRepository();

        var result = await new GetFarmsListHandler(repo).HandleAsync(new GetFarmsListQuery(1, 50, null, tier, Admin));

        result.IsSuccess.Should().BeTrue();
        repo.Calls.Should().Be(1);
    }

    [Theory]
    [InlineData("tier_filter_too_many_farms")]
    [InlineData("tier_filter_not_measured")]
    public async Task A_refused_tier_filter_is_a_409_never_an_empty_list(string code)
    {
        var repo = new RecordingFarmsRepository { RefusalCode = code };

        var result = await new GetFarmsListHandler(repo).HandleAsync(new GetFarmsListQuery(1, 50, null, "A", Admin));

        result.IsSuccess.Should().BeFalse();
        result.Error.Kind.Should().Be(ErrorKind.Conflict);
        result.Error.Code.Should().Be(code);
    }

    [Fact]
    public void The_not_measured_reasons_are_the_company_mis_words()
    {
        CompanyMisCalculator.TooManyFarmsForLiveCount.Should().Be("too_many_farms_for_live_count");
        CompanyMisCalculator.FarmListUnreadable.Should().Be("farm_list_unreadable");
        GetFarmsListHandler.FarmUnreadable.Should().Be("farm_unreadable");
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static Guid Id(int n) => Guid.Parse($"c2e60000-0000-0000-0000-{n:x12}");

    private static DateTime Ist(int month, int day, int hour, int minute = 0) =>
        new DateTime(2026, month, day, hour, minute, 0, DateTimeKind.Utc) - IstOffset;

    private static IReadOnlyList<ConfirmedFarmRow> Farms(params Guid[] farms) =>
        farms.Select(f => new ConfirmedFarmRow(f, Saver)).ToList();

    private static ConfirmedFarmDaysRows Rows(
        IReadOnlyList<ConfirmedFarmRow> farms, IReadOnlyList<ConfirmedEntryRow> entries,
        IReadOnlyList<ConfirmedCheckRow> checks, int? listed = null) =>
        new(listed ?? farms.Count, 0, farms, entries, checks, false);

    private static ConfirmedEntryRow Entry(List<ConfirmedEntryRow> into, Guid farm, DateTime createdAtUtc, Guid? saver = null)
    {
        var entry = new ConfirmedEntryRow(Guid.NewGuid(), farm, saver ?? Saver, createdAtUtc);
        into.Add(entry);
        return entry;
    }

    private static ConfirmedCheckRow Check(
        ConfirmedEntryRow entry, VerificationStatus status, string? reason, Guid by, DateTime at) =>
        new(entry.EntryId, status, reason, by, at);

    /// <summary>An entry with its self-attestation and a deliberate check by another person: one checked day.</summary>
    private static void CheckedEntry(
        List<ConfirmedEntryRow> entries, List<ConfirmedCheckRow> checks, Guid farm, DateTime createdAtUtc)
    {
        var e = Entry(entries, farm, createdAtUtc);
        checks.Add(Check(e, VerificationStatus.Confirmed, SelfAttested, Saver, createdAtUtc));
        checks.Add(Check(e, VerificationStatus.Verified, null, Checker, createdAtUtc.AddHours(4)));
    }

    private static WvfdHistoryDto History(ConfirmedFarmDaysRows rows, int completeWeeks = 4) =>
        ConfirmedFarmDays.History(rows, new HashSet<Guid>(), CountedAt, completeWeeks);

    private static ConfirmedFarmDays.FarmWeek LastWeekOf(Guid farm, ConfirmedFarmDaysRows rows) =>
        ConfirmedFarmDays.Weeks(ConfirmedFarmDays.Days(rows, new HashSet<Guid>(), CountedAt))
            .Should().ContainSingle(w => w.FarmId == farm && w.WeekStart == LastWeek).Which;

    private static WvfdWeekDto WeekOf(WvfdHistoryDto dto, DateOnly weekStart) =>
        dto.Weeks.Should().ContainSingle(w => w.WeekStart == weekStart).Which;

    private static void AssertNotMeasured(WvfdHistoryDto dto, string reason)
    {
        dto.NotMeasuredReason.Should().Be(reason);
        dto.CurrentWvfd.Should().BeNull("not measured: never 0");
        dto.CurrentSelfOnlyDays.Should().BeNull();
        dto.PriorWvfd.Should().BeNull();
        dto.GoalWvfd.Should().BeNull();
        dto.Weeks.Should().BeEmpty();
        dto.Farms.Should().BeEmpty();
        dto.CountedAtUtc.Should().Be(CountedAt);
    }

    private sealed class FixedClock(DateTime now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => new(DateTime.SpecifyKind(now, DateTimeKind.Utc));
    }

    private sealed class RecordingReader(ConfirmedFarmDaysRows rows) : IConfirmedFarmDaysReader
    {
        public int Calls { get; private set; }
        public Guid? AdminUserId { get; private set; }
        public DateTime? SinceUtc { get; private set; }
        public DateTime? CountedAtUtc { get; private set; }

        public Task<ConfirmedFarmDaysRows> ReadAllAsync(
            Guid adminUserId, DateTime sinceUtc, DateTime countedAtUtc, CancellationToken ct = default)
        {
            Calls++;
            AdminUserId = adminUserId;
            SinceUtc = DateTime.SpecifyKind(sinceUtc, DateTimeKind.Utc);
            CountedAtUtc = DateTime.SpecifyKind(countedAtUtc, DateTimeKind.Utc);
            return Task.FromResult(rows);
        }

        public Task<ConfirmedFarmDaysRows> ReadFarmsAsync(
            IReadOnlyCollection<ConfirmedFarmKey> keys, DateTime sinceUtc, DateTime countedAtUtc,
            CancellationToken ct = default) =>
            throw new NotSupportedException("the wvfd route reads through ReadAllAsync");
    }

    private sealed class RecordingFarmsRepository : IAdminMisRepository
    {
        public int Calls { get; private set; }
        public string? RefusalCode { get; init; }

        public Task<FarmsListDto> GetFarmsListAsync(
            Guid adminUserId, int page, int pageSize, string? search, string? tier, CancellationToken ct = default)
        {
            Calls++;
            return Task.FromResult(new FarmsListDto([], 0, page, pageSize) { RefusalCode = RefusalCode });
        }

        public Task<IReadOnlyList<FarmContactDto>> GetFarmContactsAsync(
            Guid adminUserId, IReadOnlyCollection<Guid> farmIds, CancellationToken ct = default) =>
            throw new NotSupportedException();

        public Task<IReadOnlyList<SilentChurnItemDto>> GetSilentChurnAsync(CancellationToken ct = default) =>
            throw new NotSupportedException();

        public Task<IReadOnlyList<SufferingItemDto>> GetSufferingAsync(CancellationToken ct = default) =>
            throw new NotSupportedException();

        public Task<UsersListDto> GetUsersListAsync(int page, int pageSize, string? search, CancellationToken ct = default) =>
            throw new NotSupportedException();
    }
}
