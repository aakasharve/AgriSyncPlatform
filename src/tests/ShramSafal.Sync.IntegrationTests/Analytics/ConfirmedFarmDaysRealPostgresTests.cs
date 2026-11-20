// spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, Task 6 as replaced by C32; C33)
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.BuildingBlocks.Results;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Admin.GetCompanyMis;
using ShramSafal.Application.UseCases.Admin.GetFarmsList;
using ShramSafal.Application.UseCases.Admin.GetWvfdHistory;
using ShramSafal.Infrastructure.Persistence;
using ShramSafal.Infrastructure.Persistence.Repositories;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Analytics;

/// <summary>
/// spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, Task 6 as replaced by C32, C33). Written by the test-writer
/// from the plan only.
///
/// <para>
/// Confirmed farm-days are counted live: farm keys ONCE through the audited factory, every farm's entries and their
/// verification events read as <c>agrisync_app</c> under row-level security one farm at a time, and the rule
/// (<c>ConfirmedFarmDays</c>) applied to the rows. A day counts as <c>Checked</c> only for a deliberate check by a
/// person other than the one who saved the entry; a self-attestation is <c>SelfOnly</c>, shown apart. The old nightly
/// view <c>mis.wvfd_weekly</c> is on no read path; <see cref="Ported_rule_matches_the_old_view_on_the_same_rows"/> is
/// the one-time equivalence check against it. Failures escape.
/// </para>
///
/// Fixed counting instant: 06:30 UTC on Wed 18 Nov 2026 (12:00 India time). Last complete India week = Mon 9 to Sun
/// 15 Nov, the week before = Mon 2 Nov, the current (partial) week = Mon 16 Nov. Every event is seeded BEFORE the
/// counting instant. Made-up GUIDs and users only.
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class ConfirmedFarmDaysRealPostgresTests(Xunit.Abstractions.ITestOutputHelper output)
    : AdminCountingRealPostgresHarness(output)
{
    private static readonly DateTime CountedAt = new(2026, 11, 18, 6, 30, 0, DateTimeKind.Utc);
    private static readonly DateOnly LastWeek = new(2026, 11, 9);
    private static readonly DateOnly PriorWeek = new(2026, 11, 2);
    private static readonly DateOnly CurrentWeek = new(2026, 11, 16);

    private static readonly Guid Admin = G("ad06");
    private static readonly Guid Saver = G("5a01");
    private static readonly Guid Checker = G("5a02");
    private static readonly Guid TestAccount = G("5a99");

    private const string SelfAttested = "self-attested-at-creation";

    protected override string ScratchPrefix => "ssf_cr2e_wvfd";

    /// <summary>Every test seeds the rows it needs as the superuser.</summary>
    protected override Task SeedAsync(NpgsqlConnection db) => Task.CompletedTask;

    // ── the old view, once ───────────────────────────────────────────────────

    /// <summary>
    /// A one-time equivalence check. Root refreshes <c>mis.wvfd_weekly</c> over the SAME seeded rows; per farm-week
    /// the old <c>wvfd</c> equals <c>LEAST(ConfirmedOldRule days, 7)</c> and the old tier equals the cut-offs over
    /// ConfirmedOldRule days. The rows hit the rule's edges: exactly 48 hours, 48 hours plus a millisecond, a check
    /// before the entry (no lower bound), a Disputed and a Draft event, two entries on one India day, and entries
    /// either side of India midnight and of the India week.
    /// </summary>
    [SkippableFact]
    public async Task Ported_rule_matches_the_old_view_on_the_same_rows()
    {
        await GuardAsync();

        var a = Fm(1); var b = Fm(2); var c = Fm(3); var d = Fm(4); var e = Fm(5);
        await using (var db = await SuperuserAsync())
        {
            foreach (var farm in new[] { a, b, c, d, e })
            {
                await SeedFarmRowAsync(db, farm);
            }

            // A: five days Mon 9 - Fri 13, each confirmed at +1h; a second, unconfirmed entry on Monday.
            for (var day = 9; day <= 13; day++)
            {
                var entry = await SeedEntryRowAsync(db, a, Ist(11, day, 10));
                await SeedEventAsync(db, entry, "Confirmed", SelfAttested, Saver, Ist(11, day, 11));
            }

            await SeedEntryRowAsync(db, a, Ist(11, 9, 15));

            // B: the edges.
            var exact = await SeedEntryRowAsync(db, b, Ist(11, 9, 10));
            await SeedEventAsync(db, exact, "Verified", null, Checker, Ist(11, 9, 10).AddHours(48));          // counts
            var late = await SeedEntryRowAsync(db, b, Ist(11, 10, 10));
            await SeedEventAsync(db, late, "Verified", null, Checker, Ist(11, 10, 10).AddHours(48).AddMilliseconds(1)); // not
            var before = await SeedEntryRowAsync(db, b, Ist(11, 11, 10));
            await SeedEventAsync(db, before, "Confirmed", null, Checker, Ist(11, 11, 10).AddHours(-2));         // counts
            var disputed = await SeedEntryRowAsync(db, b, Ist(11, 12, 10));
            await SeedEventAsync(db, disputed, "Disputed", null, Checker, Ist(11, 12, 11));                     // not
            var draft = await SeedEntryRowAsync(db, b, Ist(11, 13, 10));
            await SeedEventAsync(db, draft, "Draft", null, Checker, Ist(11, 13, 11));                           // not
            await SeedEntryRowAsync(db, b, Ist(11, 14, 9));                                                     // same day, unconfirmed
            var sameDay = await SeedEntryRowAsync(db, b, Ist(11, 14, 17));
            await SeedEventAsync(db, sameDay, "Verified", null, Checker, Ist(11, 14, 18));                      // counts the day
            var sundayNight = await SeedEntryRowAsync(db, b, Ist(11, 15, 23, 30));
            await SeedEventAsync(db, sundayNight, "Confirmed", SelfAttested, Saver, Ist(11, 15, 23, 31));       // counts, last week
            var prior = await SeedEntryRowAsync(db, b, Ist(11, 8, 23, 30));
            await SeedEventAsync(db, prior, "Verified", null, Checker, Ist(11, 9, 1));                          // prior week, counts

            // C: entries nobody confirmed, in two weeks (tier D, and the row exists).
            await SeedEntryRowAsync(db, c, Ist(11, 3, 10));
            await SeedEntryRowAsync(db, c, Ist(11, 10, 10));

            // D: India midnight and the current week.
            var monday = await SeedEntryRowAsync(db, d, Ist(11, 9, 0, 10));
            await SeedEventAsync(db, monday, "Verified", null, Checker, Ist(11, 9, 1));
            var newWeek = await SeedEntryRowAsync(db, d, Ist(11, 16, 0, 30));
            await SeedEventAsync(db, newWeek, "Verified", null, Checker, Ist(11, 16, 2));

            // E: seven days Mon - Sun, all confirmed (the cap).
            for (var day = 9; day <= 15; day++)
            {
                var entry = await SeedEntryRowAsync(db, e, Ist(11, day, 12));
                await SeedEventAsync(db, entry, "Confirmed", SelfAttested, Saver, Ist(11, day, 12));
            }

            await ExecAsync(db, "REFRESH MATERIALIZED VIEW mis.wvfd_weekly");
        }

        var old = new Dictionary<(Guid Farm, DateOnly Week), (int Wvfd, string Tier)>();
        await using (var root = await SuperuserAsync())
        {
            await using var cmd = root.CreateCommand();
            cmd.CommandText = "SELECT farm_id, week_start, wvfd, engagement_tier FROM mis.wvfd_weekly WHERE farm_id = ANY(@farms)";
            cmd.Parameters.AddWithValue("farms", new[] { a, b, c, d, e });
            await using var reader = await cmd.ExecuteReaderAsync();
            while (await reader.ReadAsync())
            {
                old[(reader.GetGuid(0), reader.GetFieldValue<DateOnly>(1))] = (reader.GetInt32(2), reader.GetString(3));
            }
        }

        var provider = BuildProvider();
        await using var scope = AdminScope(provider);
        var rows = await scope.ServiceProvider.GetRequiredService<IConfirmedFarmDaysReader>()
            .ReadAllAsync(Admin, Ist(9, 1), CountedAt);
        rows.FarmsNotReadable.Should().Be(0);
        var ported = ConfirmedFarmDays.Weeks(ConfirmedFarmDays.Days(rows, new HashSet<Guid>(), CountedAt))
            .ToDictionary(w => (w.FarmId, w.WeekStart));

        foreach (var kv in old.OrderBy(k => k.Key.Farm).ThenBy(k => k.Key.Week))
        {
            Output.WriteLine($"[EVIDENCE] old {kv.Key.Farm.ToString()[^2..]} {kv.Key.Week:yyyy-MM-dd} wvfd={kv.Value.Wvfd} tier={kv.Value.Tier}"
                + (ported.TryGetValue(kv.Key, out var p) ? $" | ported oldRuleDays={p.ConfirmedOldRuleDays} wvfd={p.ConfirmedOldRuleWvfd} tier={p.ConfirmedOldRuleTier}" : " | ported: (none)"));
        }

        // Not vacuous: the old view has all four tiers and the cap's 7.
        old.Values.Select(v => v.Tier).Distinct().Should().BeEquivalentTo(new[] { "A", "B", "C", "D" });
        old.Values.Select(v => v.Wvfd).Should().Contain(7).And.Contain(0);

        ported.Keys.Should().BeEquivalentTo(old.Keys, "a farm-week exists exactly when the farm saved an entry that week");
        foreach (var (key, view) in old)
        {
            var week = ported[key];
            week.ConfirmedOldRuleWvfd.Should().Be(view.Wvfd, $"farm {key.Farm} week {key.Week:yyyy-MM-dd}: LEAST(old-rule days, 7)");
            week.ConfirmedOldRuleTier.Should().Be(view.Tier, $"farm {key.Farm} week {key.Week:yyyy-MM-dd}: tier on the uncapped old-rule days");
        }

        // Spot values, so the equality above is not two wrong numbers agreeing.
        ported[(a, LastWeek)].ConfirmedOldRuleDays.Should().Be(5);
        ported[(b, LastWeek)].ConfirmedOldRuleDays.Should().Be(4, "9 (exactly 48 h), 11 (before the entry), 14 and 15 Nov");
        ported[(b, PriorWeek)].ConfirmedOldRuleDays.Should().Be(1);
        ported[(c, LastWeek)].ConfirmedOldRuleDays.Should().Be(0);
        ported[(e, LastWeek)].ConfirmedOldRuleDays.Should().Be(7);
    }

    // ── the rule, through the real database ─────────────────────────────────

    [SkippableFact]
    public async Task A_self_attested_entry_counts_self_only_never_checked()
    {
        await GuardAsync();

        var farm = Fm(1);
        await using (var db = await SuperuserAsync())
        {
            await SeedFarmRowAsync(db, farm);
            var mon = await SeedEntryRowAsync(db, farm, Ist(11, 9, 10));
            await SeedEventAsync(db, mon, "Confirmed", SelfAttested, Saver, Ist(11, 9, 10));
            // The saver's own deliberate check (no marker): a person, but the person who saved it.
            var tue = await SeedEntryRowAsync(db, farm, Ist(11, 10, 10));
            await SeedEventAsync(db, tue, "Verified", null, Saver, Ist(11, 10, 13));
        }

        var dto = await HistoryAsync(BuildProvider());

        var row = dto.Farms.Should().ContainSingle(f => f.FarmId == farm).Which;
        Output.WriteLine($"[EVIDENCE] checked={row.CheckedDays} selfOnly={row.SelfOnlyDays} tier={row.EngagementTier} headline={dto.CurrentWvfd} selfOnlyAvg={dto.CurrentSelfOnlyDays}");
        row.CheckedDays.Should().Be(0);
        row.SelfOnlyDays.Should().Be(2, "a check by the entry's own saver is SelfOnly, never Checked");
        row.EngagementTier.Should().Be("D");
        dto.CurrentWvfd.Should().Be(0m, "the headline counts checked days only; an active farm with none is a real 0");
        dto.CurrentSelfOnlyDays.Should().Be(2m);
    }

    [SkippableFact]
    public async Task A_deliberate_check_within_48_hours_counts_checked()
    {
        await GuardAsync();

        var farm = Fm(1);
        await using (var db = await SuperuserAsync())
        {
            await SeedFarmRowAsync(db, farm);

            // Mon-Fri: another person's Confirmed event, each with one of the five markers: not a deliberate check.
            var markers = new[]
            {
                "self-attested-at-creation", "self-attested-backfilled", "confirmed-en-route", "speaker-own-mark",
                "mark-without-confirm-authority",
            };
            for (var i = 0; i < markers.Length; i++)
            {
                var e = await SeedEntryRowAsync(db, farm, Ist(11, 9 + i, 10));
                await SeedEventAsync(db, e, "Confirmed", markers[i], Checker, Ist(11, 9 + i, 12));
            }

            // Sat: the self-attestation plus a deliberate check by another person.
            var sat = await SeedEntryRowAsync(db, farm, Ist(11, 14, 10));
            await SeedEventAsync(db, sat, "Confirmed", SelfAttested, Saver, Ist(11, 14, 10));
            await SeedEventAsync(db, sat, "Verified", null, Checker, Ist(11, 14, 15));

            // Sun: a Draft event: neither the old rule nor a check.
            var sun = await SeedEntryRowAsync(db, farm, Ist(11, 15, 10));
            await SeedEventAsync(db, sun, "Draft", null, Checker, Ist(11, 15, 11));
        }

        var dto = await HistoryAsync(BuildProvider());

        var row = dto.Farms.Should().ContainSingle(f => f.FarmId == farm).Which;
        Output.WriteLine($"[EVIDENCE] checked={row.CheckedDays} selfOnly={row.SelfOnlyDays} tier={row.EngagementTier}");
        row.CheckedDays.Should().Be(1, "only Saturday has a deliberate check by someone else");
        row.SelfOnlyDays.Should().Be(5, "the five marker days are confirmed by the old rule but not checked");
        row.EngagementTier.Should().Be("C");
        dto.CurrentWvfd.Should().Be(1m);
    }

    [SkippableFact]
    public async Task A_check_after_48_hours_does_not_count()
    {
        await GuardAsync();

        var farm = Fm(1);
        await using (var db = await SuperuserAsync())
        {
            await SeedFarmRowAsync(db, farm);

            var exact = await SeedEntryRowAsync(db, farm, Ist(11, 9, 10));
            await SeedEventAsync(db, exact, "Verified", null, Checker, Ist(11, 9, 10).AddHours(48));

            var late = await SeedEntryRowAsync(db, farm, Ist(11, 10, 10));
            await SeedEventAsync(db, late, "Confirmed", SelfAttested, Saver, Ist(11, 10, 10));
            await SeedEventAsync(db, late, "Verified", null, Checker, Ist(11, 10, 10).AddHours(48).AddMilliseconds(1));

            var onlyLate = await SeedEntryRowAsync(db, farm, Ist(11, 11, 10));
            await SeedEventAsync(db, onlyLate, "Verified", null, Checker, Ist(11, 11, 10).AddHours(48).AddMilliseconds(1));
        }

        var dto = await HistoryAsync(BuildProvider());

        var row = dto.Farms.Should().ContainSingle(f => f.FarmId == farm).Which;
        Output.WriteLine($"[EVIDENCE] checked={row.CheckedDays} selfOnly={row.SelfOnlyDays}");
        row.CheckedDays.Should().Be(1, "exactly 48 hours counts");
        row.SelfOnlyDays.Should().Be(1, "48 hours and a millisecond does not: that day keeps only its self-attestation");
        // Wednesday has no event inside 48 hours at all: neither checked nor self-only.
        (row.CheckedDays + row.SelfOnlyDays).Should().Be(2);
    }

    [SkippableFact]
    public async Task Weeks_are_india_weeks()
    {
        await GuardAsync();

        await using (var db = await SuperuserAsync())
        {
            await SeedCheckedDayAsync(db, Fm(1), Ist(11, 8, 23, 30));  // Sun, prior week
            await SeedCheckedDayAsync(db, Fm(2), Ist(11, 9, 0, 10));   // Mon 00:10 IST = Sun 18:40 UTC: last week in India
            await SeedCheckedDayAsync(db, Fm(3), Ist(11, 15, 23, 30)); // Sun 23:30 IST: still last week
            await SeedCheckedDayAsync(db, Fm(4), Ist(11, 16, 0, 30));  // Mon 00:30 IST = Sun 19:00 UTC: the current week in India
        }

        var dto = await HistoryAsync(BuildProvider());

        dto.NotMeasuredReason.Should().BeNull();
        Week(dto, PriorWeek).ActiveFarms.Should().Be(1, "only the 23:30 IST Sunday entry");
        Week(dto, LastWeek).ActiveFarms.Should().Be(2, "00:10 IST Monday and 23:30 IST Sunday");
        Week(dto, CurrentWeek).ActiveFarms.Should().Be(1, "00:30 IST Monday is in the new India week, though still Sunday in UTC");
        dto.Farms.Select(f => f.FarmId).Should().BeEquivalentTo(new[] { Fm(2), Fm(3) });
    }

    [SkippableFact]
    public async Task The_current_week_is_partial_and_not_the_headline()
    {
        await GuardAsync();

        await using (var db = await SuperuserAsync())
        {
            await SeedCheckedDayAsync(db, Fm(1), Ist(11, 9, 10));
            await SeedCheckedDayAsync(db, Fm(1), Ist(11, 10, 10), seedFarm: false);
            await SeedCheckedDayAsync(db, Fm(2), Ist(11, 17, 10)); // the current week so far
        }

        var dto = await HistoryAsync(BuildProvider(), weeks: 4);

        dto.Weeks.Should().HaveCount(5, "four complete weeks plus the current week so far");
        dto.Weeks.Select(w => w.WeekStart).Should().Equal(
            new DateOnly(2026, 10, 19), new DateOnly(2026, 10, 26), PriorWeek, LastWeek, CurrentWeek);
        dto.Weeks.Take(4).Should().OnlyContain(w => !w.IsPartial);
        dto.Weeks[^1].IsPartial.Should().BeTrue();
        dto.Weeks[^1].ActiveFarms.Should().Be(1);
        dto.CurrentWvfd.Should().Be(2m, "the headline is last week's average (farm 1's two checked days), not the current week's");
        dto.Farms.Select(f => f.FarmId).Should().Equal(new[] { Fm(1) }, "the farm that only saved this week is not in last week's list");
    }

    [SkippableFact]
    public async Task No_goal_is_sent()
    {
        await GuardAsync();

        await using (var db = await SuperuserAsync())
        {
            await SeedCheckedDayAsync(db, Fm(1), Ist(11, 9, 10));
        }

        var dto = await HistoryAsync(BuildProvider());

        dto.NotMeasuredReason.Should().BeNull();
        dto.CurrentWvfd.Should().Be(1m, "the numbers are real, and still no goal is sent");
        dto.GoalWvfd.Should().BeNull("W5: the goal is not set; the old code-constant 4.5 is gone");
    }

    [SkippableFact]
    public async Task A_week_with_no_active_farm_is_null_not_zero()
    {
        await GuardAsync();

        await using (var db = await SuperuserAsync())
        {
            await SeedFarmRowAsync(db, Fm(1));
            await SeedEntryRowAsync(db, Fm(1), Ist(11, 3, 10));      // prior week: an entry nobody confirmed (a real 0)
            await SeedCheckedDayAsync(db, Fm(1), Ist(11, 17, 10), seedFarm: false); // current week; last week has nothing
        }

        var dto = await HistoryAsync(BuildProvider());

        var last = Week(dto, LastWeek);
        last.ActiveFarms.Should().Be(0);
        last.AvgWvfd.Should().BeNull("no farm saved an entry that week: never 0");
        last.AvgSelfOnlyDays.Should().BeNull();
        dto.CurrentWvfd.Should().BeNull();
        dto.CurrentSelfOnlyDays.Should().BeNull();
        dto.Farms.Should().BeEmpty();
        dto.NotMeasuredReason.Should().BeNull("the platform was read; last week simply had no active farm");

        Week(dto, PriorWeek).ActiveFarms.Should().Be(1);
        Week(dto, PriorWeek).AvgWvfd.Should().Be(0m, "an active farm with no checked day is a real zero");
        dto.PriorWvfd.Should().Be(0m);
    }

    // ── not measured ────────────────────────────────────────────────────────

    [SkippableFact]
    public async Task Above_the_ceiling_is_not_measured()
    {
        await GuardAsync();

        await using (var db = await SuperuserAsync())
        {
            await SeedCheckedDayAsync(db, Fm(1), Ist(11, 9, 10));
            await SeedCheckedDayAsync(db, Fm(2), Ist(11, 9, 10));
        }

        var provider = BuildProvider();
        await using var scope = AdminScope(provider);
        var sp = scope.ServiceProvider;
        var reader = new ConfirmedFarmDaysReader(
            sp.GetRequiredService<ShramSafalDbContext>(),
            sp.GetRequiredService<IAdminDbContextFactory<ShramSafalDbContext>>(),
            maxFarmsForLiveCount: 1);

        var rows = await reader.ReadAllAsync(Admin, Ist(10, 1), CountedAt);
        Output.WriteLine($"[EVIDENCE] ceiling=1 farmsListed={rows.FarmsListed} skipped={rows.LiveCountSkipped} farms={rows.Farms.Count} entries={rows.Entries.Count}");
        rows.LiveCountSkipped.Should().BeTrue();
        rows.FarmsListed.Should().Be(2);
        rows.Farms.Should().BeEmpty("no per-farm read above the ceiling");
        rows.Entries.Should().BeEmpty();
        rows.Checks.Should().BeEmpty();

        var result = await new GetWvfdHistoryHandler(reader, sp.GetRequiredService<CompanyMisExclusions>(), new FixedClock(CountedAt))
            .HandleAsync(new GetWvfdHistoryQuery(4, Admin, IsPlatformSeat: true));

        result.IsSuccess.Should().BeTrue();
        AssertNotMeasured(result.Value!.Data, "too_many_farms_for_live_count");
    }

    [SkippableFact]
    public async Task An_unreadable_farm_list_is_not_measured()
    {
        await GuardAsync();

        var provider = BuildProvider();

        // A platform with no farm at all.
        AssertNotMeasured(await HistoryAsync(provider), "farm_list_unreadable");

        // A farm with no owner account cannot be read: a number over the others would be partial.
        await using (var db = await SuperuserAsync())
        {
            await SeedCheckedDayAsync(db, Fm(1), Ist(11, 9, 10));
            await SeedFarmRowAsync(db, Fm(2), account: Guid.Empty);
            await SeedEntryRowAsync(db, Fm(2), Ist(11, 9, 10));
        }

        var dto = await HistoryAsync(provider);
        Output.WriteLine($"[EVIDENCE] reason={dto.NotMeasuredReason} headline={dto.CurrentWvfd?.ToString() ?? "null"}");
        AssertNotMeasured(dto, "farm_list_unreadable");
    }

    // ── test accounts ───────────────────────────────────────────────────────

    [SkippableFact]
    public async Task A_test_accounts_entries_and_checks_are_not_counted()
    {
        await GuardAsync();

        var real = Fm(1);
        var testOwned = Fm(2);
        await using (var db = await SuperuserAsync())
        {
            await SeedFarmRowAsync(db, real);
            await SeedFarmRowAsync(db, testOwned, owner: TestAccount);

            // An entry saved by the test account, with a real check: left out.
            var byTest = await SeedEntryRowAsync(db, real, Ist(11, 9, 10), operatorUserId: TestAccount);
            await SeedEventAsync(db, byTest, "Verified", null, Checker, Ist(11, 9, 11));

            // A real entry whose only check was made by the test account: ignored entirely, not even the old rule.
            var testCheckOnly = await SeedEntryRowAsync(db, real, Ist(11, 10, 10));
            await SeedEventAsync(db, testCheckOnly, "Verified", null, TestAccount, Ist(11, 10, 11));

            // The same with a self-attestation beside the test account's check: self-only.
            var testCheckPlusSelf = await SeedEntryRowAsync(db, real, Ist(11, 11, 10));
            await SeedEventAsync(db, testCheckPlusSelf, "Confirmed", SelfAttested, Saver, Ist(11, 11, 10));
            await SeedEventAsync(db, testCheckPlusSelf, "Verified", null, TestAccount, Ist(11, 11, 11));

            // The control: a real checked entry.
            await SeedCheckedDayAsync(db, real, Ist(11, 12, 10), seedFarm: false);

            // A farm owned by the test account, fully checked: left out with everything on it.
            await SeedCheckedDayAsync(db, testOwned, Ist(11, 9, 10), seedFarm: false);
        }

        var dto = await HistoryAsync(BuildProvider(new[] { TestAccount }));

        var row = dto.Farms.Should().ContainSingle().Which;
        Output.WriteLine($"[EVIDENCE] farm={row.FarmId} checked={row.CheckedDays} selfOnly={row.SelfOnlyDays}");
        row.FarmId.Should().Be(real, "the farm owned by the test account is left out");
        row.CheckedDays.Should().Be(1, "only the real checked entry");
        row.SelfOnlyDays.Should().Be(1, "the self-attestation; the test account's check adds nothing");
        Week(dto, LastWeek).ActiveFarms.Should().Be(1);

        // The control: without the exclusion list the same rows count the test account's farm.
        var unfiltered = await HistoryAsync(BuildProvider());
        unfiltered.Farms.Select(f => f.FarmId).Should().BeEquivalentTo(new[] { real, testOwned });
    }

    // ── All Farms ───────────────────────────────────────────────────────────

    [SkippableFact]
    public async Task Tier_filter_uses_the_counted_tiers()
    {
        await GuardAsync();

        var a = Fm(1); var selfOnlyFive = Fm(2); var b = Fm(3); var c = Fm(4); var noEntry = Fm(5); var unconfirmed = Fm(6);
        await using (var db = await SuperuserAsync())
        {
            for (var day = 9; day <= 13; day++)
            {
                await SeedCheckedDayAsync(db, a, Ist(11, day, 10), seedFarm: day == 9);
            }

            await SeedFarmRowAsync(db, selfOnlyFive);
            for (var day = 9; day <= 13; day++)
            {
                var e = await SeedEntryRowAsync(db, selfOnlyFive, Ist(11, day, 10));
                await SeedEventAsync(db, e, "Confirmed", SelfAttested, Saver, Ist(11, day, 10));
            }

            for (var day = 9; day <= 11; day++)
            {
                await SeedCheckedDayAsync(db, b, Ist(11, day, 10), seedFarm: day == 9);
            }

            await SeedCheckedDayAsync(db, c, Ist(11, 9, 10));
            await SeedFarmRowAsync(db, noEntry);
            await SeedEntryRowAsync(db, noEntry, Ist(11, 3, 10));       // an entry only in the prior week
            await SeedFarmRowAsync(db, unconfirmed);
            await SeedEntryRowAsync(db, unconfirmed, Ist(11, 10, 10));  // last week, never confirmed
        }

        var provider = BuildProvider();

        async Task<IReadOnlyList<FarmSummaryDto>> Filter(string? tier)
        {
            await using var scope = AdminScope(provider);
            var result = await FarmsHandler(scope.ServiceProvider).HandleAsync(new GetFarmsListQuery(1, 50, null, tier, Admin, MayReadPhones: true, AuditDeviceId: "dev", AuditIpHash: "ip"));
            result.IsSuccess.Should().BeTrue(result.IsSuccess ? string.Empty : result.Error.Description);
            return result.Value!.Data.Items;
        }

        (await Filter("A")).Select(f => f.FarmId).Should().Equal(new[] { a },
            "five CHECKED days; the farm with five self-only days is not tier A");
        (await Filter("B")).Select(f => f.FarmId).Should().Equal(new[] { b });
        (await Filter("C")).Select(f => f.FarmId).Should().Equal(new[] { c });
        (await Filter("D")).Select(f => f.FarmId).Should().BeEquivalentTo(new[] { selfOnlyFive, unconfirmed },
            "tier D = active last week with no checked day; the farm with no entry last week is in no tier");

        var all = await Filter(null);
        all.Should().HaveCount(6);
        var self = all.Single(f => f.FarmId == selfOnlyFive);
        self.Wvfd7d.Should().Be(0);
        self.SelfOnlyDays7d.Should().Be(5, "shown apart, never added in");
        self.EngagementTier.Should().Be("D");
        all.Single(f => f.FarmId == a).Wvfd7d.Should().Be(5);
        var none = all.Single(f => f.FarmId == noEntry);
        none.Wvfd7d.Should().BeNull("\"No entry last week\", never 0");
        none.SelfOnlyDays7d.Should().BeNull();
        none.EngagementTier.Should().BeNull("never tier D");
        none.ConfirmedDaysNotMeasuredReason.Should().BeNull("it was read: it simply saved nothing last week");
    }

    [SkippableFact]
    public async Task All_farms_uses_the_same_function_and_one_factory_open()
    {
        await GuardAsync();

        await using (var db = await SuperuserAsync())
        {
            await SeedCheckedDayAsync(db, Fm(1), Ist(11, 9, 10));
            await SeedCheckedDayAsync(db, Fm(1), Ist(11, 10, 10), seedFarm: false);
            await SeedFarmRowAsync(db, Fm(2));
            var e = await SeedEntryRowAsync(db, Fm(2), Ist(11, 11, 10));
            await SeedEventAsync(db, e, "Confirmed", SelfAttested, Saver, Ist(11, 11, 10));
            await SeedCheckedDayAsync(db, Fm(3), Ist(11, 12, 10));
        }

        var provider = BuildProvider();
        (await CrossFarmAuditRowsAsync(Admin)).Should().Be(0);

        var history = await HistoryAsync(provider);
        (await CrossFarmAuditRowsAsync(Admin)).Should().Be(1, "the confirmed farm-days route opens the audited factory once");

        await using var scope = AdminScope(provider);
        var page = (await FarmsHandler(scope.ServiceProvider)
            .HandleAsync(new GetFarmsListQuery(1, 50, null, null, Admin, MayReadPhones: true, AuditDeviceId: "dev", AuditIpHash: "ip"))).Value!.Data.Items;
        (await CrossFarmAuditRowsAsync(Admin)).Should().Be(2, "All Farms opens it once: the farm keys come from that same open");

        await using var scope2 = AdminScope(provider);
        var filtered = (await FarmsHandler(scope2.ServiceProvider)
            .HandleAsync(new GetFarmsListQuery(1, 50, null, "C", Admin, MayReadPhones: true, AuditDeviceId: "dev", AuditIpHash: "ip"))).Value!.Data.Items;
        (await CrossFarmAuditRowsAsync(Admin)).Should().Be(3, "the tier filter reads every farm from the same single open");
        filtered.Select(f => f.FarmId).Should().BeEquivalentTo(new[] { Fm(1), Fm(3) }, "farm 1 has two checked days and farm 3 one: both C; farm 2 only self-confirmed is D");

        history.Farms.Should().HaveCount(3);
        foreach (var row in history.Farms)
        {
            var item = page.Single(f => f.FarmId == row.FarmId);
            Output.WriteLine($"[EVIDENCE] farm {row.FarmId.ToString()[^2..]}: route checked={row.CheckedDays} selfOnly={row.SelfOnlyDays} tier={row.EngagementTier} | page {item.Wvfd7d}/{item.SelfOnlyDays7d}/{item.EngagementTier}");
            item.Wvfd7d.Should().Be(row.CheckedDays);
            item.SelfOnlyDays7d.Should().Be(row.SelfOnlyDays);
            item.EngagementTier.Should().Be(row.EngagementTier);
        }
    }

    [SkippableFact]
    public async Task One_unreadable_farm_marks_its_row_not_measured_not_the_page()
    {
        await GuardAsync();

        await SeedPageWithOneUnreadableFarmAsync();

        var provider = BuildProvider();
        await using var scope = AdminScope(provider);
        var result = await FarmsHandler(scope.ServiceProvider).HandleAsync(new GetFarmsListQuery(1, 50, null, null, Admin, MayReadPhones: true, AuditDeviceId: "dev", AuditIpHash: "ip"));

        result.IsSuccess.Should().BeTrue("one unreadable farm must not make All Farms answer 500");
        var items = result.Value!.Data.Items;
        items.Should().HaveCount(3);

        var orphan = items.Single(f => f.FarmId == Fm(3));
        orphan.Wvfd7d.Should().BeNull();
        orphan.SelfOnlyDays7d.Should().BeNull();
        orphan.EngagementTier.Should().BeNull();
        orphan.ConfirmedDaysNotMeasuredReason.Should().Be("farm_unreadable", "\"not measured\", never \"No entry last week\"");

        var good = items.Single(f => f.FarmId == Fm(1));
        good.Wvfd7d.Should().Be(2);
        good.ConfirmedDaysNotMeasuredReason.Should().BeNull();

        var none = items.Single(f => f.FarmId == Fm(2));
        none.Wvfd7d.Should().BeNull();
        none.ConfirmedDaysNotMeasuredReason.Should().BeNull("a readable farm with no entry last week is \"No entry last week\"");
    }

    [SkippableFact]
    public async Task Tier_filter_with_an_unreadable_farm_is_not_measured()
    {
        await GuardAsync();

        await SeedPageWithOneUnreadableFarmAsync();

        var provider = BuildProvider();
        await using var scope = AdminScope(provider);
        var result = await FarmsHandler(scope.ServiceProvider).HandleAsync(new GetFarmsListQuery(1, 50, null, "C", Admin, MayReadPhones: true, AuditDeviceId: "dev", AuditIpHash: "ip"));

        result.IsSuccess.Should().BeFalse("a filter that silently left the unreadable farm out of every tier would be incomplete");
        result.Error.Kind.Should().Be(ErrorKind.Conflict);
        result.Error.Code.Should().Be("tier_filter_not_measured");
    }

    [SkippableFact]
    public async Task Tier_filter_above_the_ceiling_is_refused()
    {
        await GuardAsync();

        await using (var db = await SuperuserAsync())
        {
            await SeedCheckedDayAsync(db, Fm(1), Ist(11, 9, 10));
            await SeedCheckedDayAsync(db, Fm(2), Ist(11, 9, 10));
        }

        var provider = BuildProvider();
        await using var scope = AdminScope(provider);
        var sp = scope.ServiceProvider;
        var reader = new ConfirmedFarmDaysReader(
            sp.GetRequiredService<ShramSafalDbContext>(),
            sp.GetRequiredService<IAdminDbContextFactory<ShramSafalDbContext>>(),
            maxFarmsForLiveCount: 1);

        var result = await new GetFarmsListHandler(Repository(sp, reader), new RecordingControlRoomHistory(), new FixedControlRoomStore())
            .HandleAsync(new GetFarmsListQuery(1, 50, null, "C", Admin, MayReadPhones: true, AuditDeviceId: "dev", AuditIpHash: "ip"));

        result.IsSuccess.Should().BeFalse();
        result.Error.Kind.Should().Be(ErrorKind.Conflict);
        result.Error.Code.Should().Be("tier_filter_too_many_farms");
    }

    [SkippableFact]
    public async Task An_unknown_tier_is_refused()
    {
        await GuardAsync();

        await using (var db = await SuperuserAsync())
        {
            await SeedCheckedDayAsync(db, Fm(1), Ist(11, 9, 10));
        }

        var provider = BuildProvider();
        foreach (var tier in new[] { "E", "AB", "7", "A;--" })
        {
            await using var scope = AdminScope(provider);
            var result = await FarmsHandler(scope.ServiceProvider).HandleAsync(new GetFarmsListQuery(1, 50, null, tier, Admin, MayReadPhones: true, AuditDeviceId: "dev", AuditIpHash: "ip"));

            result.IsSuccess.Should().BeFalse(tier);
            result.Error.Kind.Should().Be(ErrorKind.Validation, tier);
            result.Error.Code.Should().Be("tier_invalid", tier);
        }

        (await CrossFarmAuditRowsAsync(Admin)).Should().Be(0, "refused at once: nothing was read, no audited factory opened");
    }

    /// <summary>C35 (1): a farm owned by a test account is on All Farms, but never "No entry last week".</summary>
    [SkippableFact]
    public async Task A_test_account_farm_row_says_test_account_not_no_entry()
    {
        await GuardAsync();

        await using (var db = await SuperuserAsync())
        {
            await SeedCheckedDayAsync(db, Fm(1), Ist(11, 9, 10));
            await SeedFarmRowAsync(db, Fm(2), owner: TestAccount);
            await SeedCheckedDayAsync(db, Fm(2), Ist(11, 9, 10), seedFarm: false);
        }

        var provider = BuildProvider(new[] { TestAccount });
        await using var scope = AdminScope(provider);
        var result = await FarmsHandler(scope.ServiceProvider).HandleAsync(new GetFarmsListQuery(1, 50, null, null, Admin, MayReadPhones: true, AuditDeviceId: "dev", AuditIpHash: "ip"));

        result.IsSuccess.Should().BeTrue();
        var items = result.Value!.Data.Items;
        items.Should().HaveCount(2);
        var test = items.Single(f => f.FarmId == Fm(2));
        test.ConfirmedDaysNotMeasuredReason.Should().Be("test_account");
        test.Wvfd7d.Should().BeNull();
        test.SelfOnlyDays7d.Should().BeNull();
        test.EngagementTier.Should().BeNull();
        var real = items.Single(f => f.FarmId == Fm(1));
        real.ConfirmedDaysNotMeasuredReason.Should().BeNull();
        real.Wvfd7d.Should().Be(1);
    }

    /// <summary>
    /// C35 (2): a farm the admin open lists but whose own row does not come back under its row-level security (the
    /// reader's <c>notReadable++</c> on a null farm). Built by narrowing the farms policy in the scratch database so
    /// one named farm is hidden from the farm scope; the admin open still lists it.
    /// </summary>
    [SkippableFact]
    public async Task A_farm_whose_own_row_does_not_come_back_is_not_measured()
    {
        await GuardAsync();

        await using (var db = await SuperuserAsync())
        {
            await SeedCheckedDayAsync(db, Fm(1), Ist(11, 9, 10));
            await SeedFarmRowAsync(db, Fm(2));
            await SeedEntryRowAsync(db, Fm(2), Ist(11, 9, 10));
        }

        var provider = BuildProvider();

        // The control: before the policy is narrowed, both routes measure.
        (await HistoryAsync(provider)).NotMeasuredReason.Should().BeNull();

        await ExecAsSuperuserAsync($"""
            ALTER POLICY p_tenant_farms ON ssf.farms
            USING ("Id" = current_setting('agrisync.farm_id', true)::uuid AND "Id" <> '{Fm(2)}'::uuid);
            """);

        var dto = await HistoryAsync(provider);
        Output.WriteLine($"[EVIDENCE] reason={dto.NotMeasuredReason} headline={dto.CurrentWvfd?.ToString() ?? "null"}");
        AssertNotMeasured(dto, "farm_list_unreadable");

        await using var scope = AdminScope(provider);
        var result = await FarmsHandler(scope.ServiceProvider).HandleAsync(new GetFarmsListQuery(1, 50, null, null, Admin, MayReadPhones: true, AuditDeviceId: "dev", AuditIpHash: "ip"));
        result.IsSuccess.Should().BeTrue("one unreadable farm never makes All Farms answer 500");
        var items = result.Value!.Data.Items;
        var hidden = items.Single(f => f.FarmId == Fm(2));
        hidden.ConfirmedDaysNotMeasuredReason.Should().Be("farm_unreadable");
        hidden.Wvfd7d.Should().BeNull();
        items.Single(f => f.FarmId == Fm(1)).Wvfd7d.Should().Be(1, "the readable farm is still counted");
    }

    // ── the route, row-level security and failures ──────────────────────────

    /// <summary>
    /// The route's own gate lives in the route delegate (see the architecture test of the same name). Here the
    /// handler, on the real database: a caller who is not a platform admin is refused before anything is read.
    /// </summary>
    [SkippableFact]
    public async Task The_wvfd_route_refuses_a_non_platform_admin()
    {
        await GuardAsync();

        await using (var db = await SuperuserAsync())
        {
            await SeedCheckedDayAsync(db, Fm(1), Ist(11, 9, 10));
        }

        var provider = BuildProvider();
        await using var scope = AdminScope(provider);
        var handler = HistoryHandler(scope.ServiceProvider);

        var refused = await handler.HandleAsync(new GetWvfdHistoryQuery(4, Admin, IsPlatformSeat: false));

        refused.IsSuccess.Should().BeFalse();
        refused.Error.Kind.Should().Be(ErrorKind.Forbidden);
        (await AllCrossFarmAuditRowsAsync()).Should().Be(0, "a refused caller opens no audited factory");

        var allowed = await handler.HandleAsync(new GetWvfdHistoryQuery(4, Admin, IsPlatformSeat: true));
        allowed.IsSuccess.Should().BeTrue();
        allowed.Value!.Data.CurrentWvfd.Should().Be(1m);
        (await CrossFarmAuditRowsAsync(Admin)).Should().Be(1, "the control: a platform owner is let in and the audit row names them");
    }

    [SkippableFact]
    public async Task Reads_through_row_level_security()
    {
        await GuardAsync(); // E3: agrisync_app, neither superuser nor BYPASSRLS

        var f1 = Fm(1); var f2 = Fm(2);
        await using (var db = await SuperuserAsync())
        {
            await SeedCheckedDayAsync(db, f1, Ist(11, 9, 10));
            await SeedCheckedDayAsync(db, f1, Ist(11, 10, 10), seedFarm: false);
            await SeedCheckedDayAsync(db, f2, Ist(11, 9, 10));
        }

        var provider = BuildProvider();
        await using var scope = AdminScope(provider);
        var sp = scope.ServiceProvider;

        // The counting connection really is the app login (E3), not the admin one.
        var ctx = sp.GetRequiredService<ShramSafalDbContext>();
        var conn = ctx.Database.GetDbConnection();
        await conn.OpenAsync();
        await using (var cmd = conn.CreateCommand())
        {
            cmd.CommandText = "SELECT current_user, rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user";
            await using var r = await cmd.ExecuteReaderAsync();
            (await r.ReadAsync()).Should().BeTrue();
            Output.WriteLine($"[EVIDENCE] counting connection user='{r.GetString(0)}' super-or-bypass={r.GetBoolean(1)}");
            r.GetString(0).Should().Be(IntegrationPostgres.AppRoleUser);
            r.GetBoolean(1).Should().BeFalse();
        }

        await conn.CloseAsync();

        var reader = sp.GetRequiredService<IConfirmedFarmDaysReader>();
        var rows = await reader.ReadAllAsync(Admin, Ist(10, 1), CountedAt);
        rows.FarmsNotReadable.Should().Be(0);
        rows.Entries.Should().HaveCount(3);
        rows.Entries.Count(e => e.FarmId == f1).Should().Be(2);
        rows.Entries.Count(e => e.FarmId == f2).Should().Be(1);
        rows.Checks.Should().HaveCount(6, "each entry carries its self-attestation and a check");

        // Row-level security is really on: the app login with no farm scope sees none of the seeded rows ...
        await using (var app = new NpgsqlConnection(AppConn))
        {
            await app.OpenAsync();
            await using var cmd = app.CreateCommand();
            cmd.CommandText = "SELECT count(*) FROM ssf.daily_logs";
            Convert.ToInt64(await cmd.ExecuteScalarAsync()).Should().Be(0, "no farm scope, no rows: row-level security is forced");
        }

        // ... so a farm's rows come back only inside that farm's own scope, and never another farm's.
        var one = await reader.ReadFarmsAsync([new ConfirmedFarmKey(f2, Ac(2))], Ist(10, 1), CountedAt);
        one.Entries.Should().ContainSingle().Which.FarmId.Should().Be(f2, "farm 1's entries are never read in farm 2's scope");
        one.Checks.Should().HaveCount(2);
        ConfirmedFarmDays.History(one, new HashSet<Guid>(), CountedAt, 4).Farms
            .Should().ContainSingle(f => f.FarmId == f2 && f.CheckedDays == 1);

        // ... and the admin (cross-farm) login never reads them: here it is a login made for this test that reads
        // past row-level security (BYPASSRLS) but may only list the farm keys and write the audit row. Any entry or
        // event read through it would be refused, so the counts coming back prove they are read as agrisync_app.
        var role = $"cr2e_lister_{Guid.NewGuid():N}"[..24];
        var listerConn = new NpgsqlConnectionStringBuilder(SuperuserConn) { Username = role, Password = "x" }.ConnectionString;
        await ExecAsSuperuserAsync($"""
            CREATE ROLE {role} LOGIN BYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE;
            GRANT CONNECT ON DATABASE "{ScratchDbName}" TO {role};
            GRANT USAGE ON SCHEMA ssf TO {role};
            GRANT SELECT ("Id", owner_account_id) ON ssf.farms TO {role};
            GRANT INSERT ON ssf.audit_events TO {role};
            """);
        try
        {
            await using (var lister = new NpgsqlConnection(listerConn))
            {
                await lister.OpenAsync();
                foreach (var sql in new[] { "SELECT count(*) FROM ssf.daily_logs", "SELECT count(*) FROM ssf.verification_events" })
                {
                    await using var cmd = lister.CreateCommand();
                    cmd.CommandText = sql;
                    var refused = async () => await cmd.ExecuteScalarAsync();
                    (await refused.Should().ThrowAsync<PostgresException>(sql)).Which.SqlState.Should().Be("42501", sql);
                }
            }

            var viaLister = BuildProvider(migrationConn: listerConn);
            var dto = await HistoryAsync(viaLister);
            dto.NotMeasuredReason.Should().BeNull();
            dto.Farms.Select(f => (f.FarmId, f.CheckedDays)).Should().BeEquivalentTo(new[] { (f1, 2), (f2, 1) });
        }
        finally
        {
            NpgsqlConnection.ClearAllPools();
            await ExecAsSuperuserAsync(
                $"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename = '{role}'; DROP OWNED BY {role};");
            await using var admin = new NpgsqlConnection(AdminConn);
            await admin.OpenAsync();
            await ExecAsync(admin, $"REVOKE ALL ON DATABASE \"{ScratchDbName}\" FROM {role}; DROP ROLE {role};");
        }
    }

    /// <summary>
    /// C19: the per-farm query fails on the server AFTER the connection opened (the app login loses SELECT on
    /// <c>ssf.verification_events</c>); the failure escapes, never an empty answer, zeros or "No entry last week".
    /// </summary>
    [SkippableFact]
    public async Task A_failed_per_farm_read_escapes()
    {
        await GuardAsync();

        await using (var db = await SuperuserAsync())
        {
            await SeedCheckedDayAsync(db, Fm(1), Ist(11, 9, 10));
        }

        var provider = BuildProvider();

        // The control: while the app login may read events, the numbers come back.
        (await HistoryAsync(provider)).CurrentWvfd.Should().Be(1m);

        await ExecAsSuperuserAsync($"REVOKE SELECT ON ssf.verification_events FROM {IntegrationPostgres.AppRoleUser}");

        // The construction: the app login is now refused that read on the server, after its connection opened.
        await using (var app = new NpgsqlConnection(AppConn))
        {
            await app.OpenAsync();
            await using var cmd = app.CreateCommand();
            cmd.CommandText = "SELECT count(*) FROM ssf.verification_events";
            var refused = async () => await cmd.ExecuteScalarAsync();
            (await refused.Should().ThrowAsync<PostgresException>()).Which.SqlState.Should().Be("42501");
        }

        await using var scope = AdminScope(provider);
        var route = () => HistoryHandler(scope.ServiceProvider)
            .HandleAsync(new GetWvfdHistoryQuery(4, Admin, IsPlatformSeat: true));
        var thrown = await route.Should().ThrowAsync<Exception>(
            "a failed per-farm read escapes (the route answers 500), never zeros or an empty answer");
        Output.WriteLine($"[EVIDENCE] confirmed farm-days: thrown={thrown.Which.GetType().Name}: {thrown.Which.Message}");
        thrown.Which.ToString().Should().Contain("permission denied", "it is the refused query that escaped");

        // All Farms reads the same way: it escapes there too.
        await using var scope2 = AdminScope(provider);
        var farms = () => FarmsHandler(scope2.ServiceProvider).HandleAsync(new GetFarmsListQuery(1, 50, null, null, Admin, MayReadPhones: true, AuditDeviceId: "dev", AuditIpHash: "ip"));
        var thrownFarms = await farms.Should().ThrowAsync<Exception>("All Farms never answers a page of \"No entry last week\" for a failed read");
        thrownFarms.Which.ToString().Should().Contain("permission denied");
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    /// <summary>Farm 1 with two checked days last week, farm 2 readable with only an older entry, farm 3 with no owner account.</summary>
    private async Task SeedPageWithOneUnreadableFarmAsync()
    {
        await using var db = await SuperuserAsync();
        await SeedCheckedDayAsync(db, Fm(1), Ist(11, 9, 10));
        await SeedCheckedDayAsync(db, Fm(1), Ist(11, 10, 10), seedFarm: false);
        await SeedFarmRowAsync(db, Fm(2));
        await SeedEntryRowAsync(db, Fm(2), Ist(11, 3, 10));
        await SeedFarmRowAsync(db, Fm(3), account: Guid.Empty);
        await SeedEntryRowAsync(db, Fm(3), Ist(11, 10, 10));
    }

    private static Guid Fm(int n) => G($"f0{n:x2}");

    private static Guid Ac(int n) => G($"a0{n:x2}");

    private async Task<NpgsqlConnection> SuperuserAsync()
    {
        var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        return db;
    }

    private static Task SeedFarmRowAsync(NpgsqlConnection db, Guid farm, Guid? owner = null, Guid? account = null) =>
        SeedFarmAsync(db, farm, "Fake Farm " + farm.ToString()[^3..], owner ?? Saver, account ?? FarmAccount(farm), Ist(9, 1));

    /// <summary>One owner account per farm (farm n has account n), so row-level security separates the farms.</summary>
    private static Guid FarmAccount(Guid farm) => G("a" + farm.ToString("N")[^3..]);

    /// <summary>An entry (seeding its farm on first use is the caller's job). Returns the entry id.</summary>
    private static async Task<Guid> SeedEntryRowAsync(
        NpgsqlConnection db, Guid farm, DateTime createdAtUtc, Guid? operatorUserId = null)
    {
        var id = Guid.NewGuid();
        var plot = Guid.NewGuid();
        await ExecAsync(db, """
            INSERT INTO ssf.daily_logs ("Id", farm_id, plot_id, crop_cycle_id, plot_ids, scope,
                                        operator_user_id, log_date, created_at_utc,
                                        source, model_version, prompt_version, source_ai_job_id, content_version)
            VALUES (@id, @fid, @plot, @cycle, ARRAY[@plot], 'Plot',
                    @op, @date, @created,
                    'manual', 'unknown', 'unknown', NULL, 1);
            """,
            ("id", id), ("fid", farm), ("plot", plot), ("cycle", Guid.NewGuid()),
            ("op", operatorUserId ?? Saver), ("date", DateOnly.FromDateTime(createdAtUtc + IstOffset)),
            ("created", createdAtUtc));
        return id;
    }

    private static Task SeedEventAsync(
        NpgsqlConnection db, Guid entry, string status, string? reason, Guid by, DateTime occurredAtUtc) =>
        ExecAsync(db, """
            INSERT INTO ssf.verification_events ("Id", daily_log_id, status, reason, verified_by_user_id, occurred_at_utc)
            VALUES (@id, @log, @status, @reason, @by, @at);
            """,
            ("id", Guid.NewGuid()), ("log", entry), ("status", status), ("reason", reason), ("by", by), ("at", occurredAtUtc));

    /// <summary>
    /// One checked day: an entry saved by <see cref="Saver"/> with its self-attestation and, four hours later, a
    /// deliberate check by <see cref="Checker"/>. Seeds the farm unless told not to.
    /// </summary>
    private static async Task SeedCheckedDayAsync(
        NpgsqlConnection db, Guid farm, DateTime createdAtUtc, bool seedFarm = true)
    {
        if (seedFarm)
        {
            await SeedFarmRowAsync(db, farm);
        }

        var entry = await SeedEntryRowAsync(db, farm, createdAtUtc);
        await SeedEventAsync(db, entry, "Confirmed", SelfAttested, Saver, createdAtUtc);
        await SeedEventAsync(db, entry, "Verified", null, Checker, createdAtUtc.AddHours(4));
    }

    private GetWvfdHistoryHandler HistoryHandler(IServiceProvider sp) =>
        new(sp.GetRequiredService<IConfirmedFarmDaysReader>(), sp.GetRequiredService<CompanyMisExclusions>(),
            new FixedClock(CountedAt));

    private async Task<WvfdHistoryDto> HistoryAsync(ServiceProvider provider, int weeks = 4)
    {
        await using var scope = AdminScope(provider);
        var result = await HistoryHandler(scope.ServiceProvider)
            .HandleAsync(new GetWvfdHistoryQuery(weeks, Admin, IsPlatformSeat: true));
        result.IsSuccess.Should().BeTrue(result.IsSuccess ? string.Empty : result.Error.Description);
        result.Value!.Data.CountedAtUtc.Should().Be(CountedAt);
        result.Value.Meta.Source.Should().Be("live");
        return result.Value.Data;
    }

    private static AdminMisRepository Repository(IServiceProvider sp, IConfirmedFarmDaysReader? reader = null) =>
        new(sp.GetRequiredService<AnalyticsDbContext>(), sp.GetRequiredService<CompanyMisExclusions>(),
            reader ?? sp.GetRequiredService<IConfirmedFarmDaysReader>(),
            sp.GetRequiredService<IAdminDbContextFactory<ShramSafalDbContext>>(),
            new FixedClock(CountedAt));

    private static GetFarmsListHandler FarmsHandler(IServiceProvider sp) =>
        new(Repository(sp), new RecordingControlRoomHistory(), new FixedControlRoomStore());

    private static WvfdWeekDto Week(WvfdHistoryDto dto, DateOnly weekStart) =>
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
    }

    private sealed class FixedClock(DateTime now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => new(DateTime.SpecifyKind(now, DateTimeKind.Utc));
    }
}
