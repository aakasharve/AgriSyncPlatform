// spec: company-mis-real-numbers-2026-11-15 (plan CR-2c, Task 1 tests; amendments E1, E2, E4, E5, E8, E9, E11)
//
// The CR-2c counting rules, as pure code. Written by the test-writer from the plan
// (CR-2c-mis-small-additions-PLAN.md: Task 1, Review Focus, amendments E1-E11) and the
// precedent rules it cites (CR-2a A8, A9; CR-2e C4, C16, C29), never from what the code
// returns: every expected value below is worked out by hand from those rules.
//
// Fixed instant: countedAtUtc = 06:30 UTC on 14 Nov 2026 = 12:00 India time, so "today" is
// 14 Nov. The usual period is 10..13 Nov; its previous period is 6..9 Nov.
//
// Rows are hand-built in the shape the reader hands over (ICompanyMisReader, CompanyMisRows
// and its CR-2c members). Made-up GUIDs, names and version numbers only.

using System.Reflection;
using System.Text.Json;
using FluentAssertions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Admin.GetCompanyMis;
using ShramSafal.Application.UseCases.Dfes;
using ShramSafal.Domain.Compare;
using ShramSafal.Domain.Dfes;
using Xunit;

namespace ShramSafal.Domain.Tests.Admin;

public sealed class CompanyMisAdditionsTests
{
    private static readonly TimeSpan IstOffset = TimeSpan.FromMinutes(330);
    private static readonly DateTime CountedAt = new(2026, 11, 14, 6, 30, 0, DateTimeKind.Utc);

    private const string DenominatorZero = "denominator_zero";
    private const string FarmListUnreadable = "farm_list_unreadable";
    private const string NoSamples = "no_samples";
    private const string TooManyFarms = "too_many_farms_for_live_count";
    private const string NotRecorded = "not_recorded";

    private const string Android = "android";
    private const string NotAndroid = "not_android";

    // E1: the feature keys (no schedule feature).
    private static readonly string[] FeatureKeys =
        ["entries", "voice", "costs", "attendance", "photos", "job_cards", "compare"];

    // Task 1f: the kind keys.
    private static readonly string[] KindKeys =
        ["water", "nutrition", "spray", "other_work", "labour", "not_recognised"];

    // ------------------------------------------------------------------
    // #52 app version adoption (Task 1a, E9, E11(3), E11(4), E11(5))
    // ------------------------------------------------------------------

    [Fact]
    public void Latest_version_per_person_counts_once()
    {
        // E11(4): each person counted once, on the version of their most recent row IN THE PERIOD
        // (A9: one function of a period of India days). Versions ordered numerically, newest first,
        // as the app-versions page orders them (Task 1a: "the same rule as the app-versions page").
        var a = G(101);
        var b = G(102);
        var c = G(103);
        var d = G(104);
        var e = G(105);
        var rows = new Seed()
            .Farm(G(1), G(901))
            .Seen(a, "1.0.15", Ist(11, 10), Android)
            .Seen(a, "1.0.17", Ist(11, 12), Android)
            .Seen(a, "1.0.18", Ist(11, 14, 9), Android)   // after the period's last day (13 Nov): not this period
            .Seen(b, "1.0.17", Ist(11, 11), Android)
            .Seen(c, "1.0.10", Ist(11, 11), Android)
            .Seen(d, "1.0.9", Ist(11, 13), Android)
            .Seen(e, "1.0.17", Ist(11, 8), Android)        // seen only in the previous period: not counted
            .Build();

        var dto = Compute(rows, D(11, 10), D(11, 13));

        dto.Quality.AppVersions.NotMeasuredReason.Should().BeNull();
        dto.Quality.AppVersions.Items.Should().BeEquivalentTo(new[]
        {
            new MisVersionShareDto("1.0.17", Android, 2, 50.0m),
            new MisVersionShareDto("1.0.10", Android, 1, 25.0m),
            new MisVersionShareDto("1.0.9", Android, 1, 25.0m),
        });
        dto.Quality.AppVersions.Items.Sum(i => i.People).Should().Be(4, "each person seen in the period once: a, b, c, d");
        dto.Quality.AppVersions.Items.Select(i => i.Version).Distinct().Should().Equal(
            new[] { "1.0.17", "1.0.10", "1.0.9" },
            "versions are ordered numerically, newest first (as text, 1.0.9 would sort above 1.0.17)");
    }

    [Fact]
    public void Web_is_counted_apart_from_phones()
    {
        // Task 1a, D-141 default, E9, E11(3): "android" is the Android app; a missing platform, or any
        // other value, is "not_android". Each person once, on the platform of their most recent row.
        var a = G(101);
        var b = G(102);
        var c = G(103);
        var e = G(105);
        var rows = new Seed()
            .Farm(G(1), G(901))
            .Seen(a, "1.0.17", Ist(11, 12), Android)
            .Seen(b, "1.0.17", Ist(11, 12), null)
            .Seen(c, "1.0.17", Ist(11, 11), "web")
            .Seen(e, "1.0.17", Ist(11, 10), Android)
            .Seen(e, "1.0.17", Ist(11, 12), null)           // e last used a browser
            .Build();

        var dto = Compute(rows, D(11, 10), D(11, 13));

        dto.Quality.AppVersions.Items.Should().BeEquivalentTo(new[]
        {
            new MisVersionShareDto("1.0.17", Android, 1, 25.0m),
            new MisVersionShareDto("1.0.17", NotAndroid, 3, 75.0m),
        });
        dto.Quality.AppVersions.Items.Select(i => i.Platform).Should().OnlyContain(
            p => p == Android || p == NotAndroid, "E11(3): only these two platform values are sent");
    }

    [Fact]
    public void A_test_accounts_app_seen_is_left_out()
    {
        var x = G(900);
        var a = G(101);
        var excluded = new HashSet<Guid> { x };
        var seed = new Seed()
            .Farm(G(1), G(901))
            .Seen(x, "1.0.17", Ist(11, 12), Android)
            .Seen(a, "1.0.15", Ist(11, 12), Android);

        // The control: without the list, the test account is counted.
        var counted = Compute(seed.Build(), D(11, 10), D(11, 13));
        counted.Quality.AppVersions.Items.Sum(i => i.People).Should().Be(2);

        var dto = Compute(seed.Build(excluded), D(11, 10), D(11, 13), excluded);

        dto.Quality.AppVersions.Items.Should().BeEquivalentTo(new[]
        {
            new MisVersionShareDto("1.0.15", Android, 1, 100.0m),
        }, "the test account's row is left out, and the share is of the people left");
    }

    [Fact]
    public void App_versions_before_any_was_recorded_are_not_recorded()
    {
        // E11(5): no app.seen row by the period's end -> "not_recorded". Task 1a: AppVersionsSeenSince is the
        // India day of the first app.seen row. Recording began before the period but nobody was seen in it:
        // a real empty list ("None in this period"), no reason.
        var a = G(101);

        var never = Compute(new Seed().Farm(G(1), G(901)).Build(), D(11, 10), D(11, 13));
        never.Quality.AppVersions.Should().BeEquivalentTo(
            new MisListDto<MisVersionShareDto>([], NotRecorded));
        never.Quality.AppVersionsSeenSince.Should().BeNull();

        var startedAfter = Compute(
            new Seed().Farm(G(1), G(901)).Seen(a, "1.0.17", Ist(11, 14, 9), Android).Build(), D(11, 10), D(11, 13));
        startedAfter.Quality.AppVersions.Items.Should().BeEmpty();
        startedAfter.Quality.AppVersions.NotMeasuredReason.Should().Be(NotRecorded,
            "the first app.seen row is after the period's last day");
        startedAfter.Quality.AppVersionsSeenSince.Should().Be(D(11, 14));

        // 19:00 UTC on 11 Nov is 00:30 India time on 12 Nov: the start is an India day.
        var startedInside = Compute(
            new Seed().Farm(G(1), G(901))
                .Seen(a, "1.0.17", new DateTime(2026, 11, 11, 19, 0, 0, DateTimeKind.Utc), Android).Build(),
            D(11, 10), D(11, 13));
        startedInside.Quality.AppVersionsSeenSince.Should().Be(D(11, 12));
        startedInside.Quality.AppVersions.NotMeasuredReason.Should().BeNull();
        startedInside.Quality.AppVersions.Items.Should().ContainSingle()
            .Which.Should().Be(new MisVersionShareDto("1.0.17", Android, 1, 100.0m));

        var nobodyInPeriod = Compute(
            new Seed().Farm(G(1), G(901)).Seen(a, "1.0.17", Ist(11, 1), Android).Build(), D(11, 10), D(11, 13));
        nobodyInPeriod.Quality.AppVersions.Should().BeEquivalentTo(
            new MisListDto<MisVersionShareDto>([], null), "recorded, and nobody was seen: a real none");
        nobodyInPeriod.Quality.AppVersionsSeenSince.Should().Be(D(11, 1));
    }

    // ------------------------------------------------------------------
    // #10, #49 understanding score (Task 1b, E4, E5, E11(5))
    // ------------------------------------------------------------------

    [Fact]
    public void Unscored_days_are_not_counted_as_zero()
    {
        var f1 = G(1);
        var f2 = G(2);
        var rows = new Seed()
            .Farm(f1, G(901)).Farm(f2, G(902))
            .Day(f1, D(11, 11), "BasicWorkDay", 6)
            .Day(f1, D(11, 12), "BasicWorkDay", null)
            .Day(f2, D(11, 12), "RichWorkDay", 8)
            .Day(f2, D(11, 13), "UnaccountedDay", null)
            .Build();

        var dto = Compute(rows, D(11, 10), D(11, 13));

        dto.Overview.UnderstandingScoredDays.Current.Should().Be(new MisValueDto(2m, null),
            "two farm-days got a score; the two without one are left out");
        dto.Overview.UnderstandingMedian.Current.Should().Be(new MisValueDto(7.0m, null),
            "the middle of 6 and 8; counting the unscored days as 0 would give 3.0");
        Bucket(dto, 0).Should().Be(0, "an unscored day is not a 0");
        Bucket(dto, 6).Should().Be(1);
        Bucket(dto, 8).Should().Be(1);
    }

    [Fact]
    public void A_declared_no_work_day_is_not_scored()
    {
        // E4: a counted farm-day has a stored row, a non-null score, and a classification other than
        // DeclaredNoWorkDay.
        var f1 = G(1);
        var rows = new Seed()
            .Farm(f1, G(901))
            .Day(f1, D(11, 11), "DeclaredNoWorkDay", 10)
            .Day(f1, D(11, 12), "BasicWorkDay", 4)
            .Build();

        var dto = Compute(rows, D(11, 10), D(11, 13));

        dto.Overview.UnderstandingScoredDays.Current.Should().Be(new MisValueDto(1m, null));
        dto.Overview.UnderstandingMedian.Current.Should().Be(new MisValueDto(4.0m, null));
        Bucket(dto, 10).Should().Be(0, "the declared no-work day is not counted, whatever its breakdown scores");
    }

    [Fact]
    public void No_scored_day_is_not_measured()
    {
        var f1 = G(1);
        var rows = new Seed()
            .Farm(f1, G(901))
            .Day(f1, D(11, 11), "BasicWorkDay", null)
            .Day(f1, D(11, 12), "DeclaredNoWorkDay", 5)
            .Day(f1, D(11, 8), "BasicWorkDay", 7)            // previous period
            .Build();

        var dto = Compute(rows, D(11, 10), D(11, 13));

        dto.Overview.UnderstandingMedian.Current.Should().Be(new MisValueDto(null, NoSamples),
            "no farm-day of the period got a score: not measured, never 0");
        dto.Overview.UnderstandingScoredDays.Current.Should().Be(new MisValueDto(null, NoSamples),
            "Task 1b: zero counted days -> both not measured no_samples");
        dto.Overview.UnderstandingMedian.CurrentByDay.Should().HaveCount(4).And.OnlyContain(v => v == null);
        dto.Overview.UnderstandingScoredDays.CurrentByDay.Should().HaveCount(4).And.OnlyContain(v => v == null);

        dto.Overview.UnderstandingMedian.Previous.Should().Be(new MisValueDto(7.0m, null));
        dto.Overview.UnderstandingScoredDays.Previous.Should().Be(new MisValueDto(1m, null));

        // E11(5): the spread with no scored day is an empty list plus no_samples.
        dto.Quality.UnderstandingSpread.Should().BeEquivalentTo(new MisListDto<MisScoreBucketDto>([], NoSamples));
    }

    [Fact]
    public void Spread_has_all_eleven_scores()
    {
        var f1 = G(1);
        var f2 = G(2);
        var rows = new Seed()
            .Farm(f1, G(901)).Farm(f2, G(902))
            .Day(f1, D(11, 10), "BasicWorkDay", 0)            // E4: a computed 0 is a real 0
            .Day(f1, D(11, 11), "BasicWorkDay", 3)
            .Day(f2, D(11, 11), "RichWorkDay", 3)
            .Day(f2, D(11, 13), "RichWorkDay", 10)
            .Day(f2, D(11, 7), "RichWorkDay", 7)             // previous period: not in this spread
            .Build();

        var dto = Compute(rows, D(11, 10), D(11, 13));

        dto.Quality.UnderstandingSpread.NotMeasuredReason.Should().BeNull();
        dto.Quality.UnderstandingSpread.Items.Select(b => b.Score).Should().Equal(Enumerable.Range(0, 11),
            "all eleven scores 0..10 are present");
        dto.Quality.UnderstandingSpread.Items.Select(b => b.FarmDays).Should().Equal(
            new[] { 1, 0, 0, 2, 0, 0, 0, 0, 0, 0, 1 }, "zeros are real counts; the day scored 0 counts in bucket 0");
        dto.Overview.UnderstandingScoredDays.Current.Should().Be(new MisValueDto(4m, null),
            "E4: the day scored 0 counts as a scored day");
        dto.Overview.UnderstandingMedian.Current.Should().Be(new MisValueDto(3.0m, null), "the middle of 0, 3, 3, 10");
    }

    [Fact]
    public void A_corrupt_components_row_is_left_out_not_zero()
    {
        // E5: the components reader is the day screen's own (UnderstandingComponents.Read, lifted unchanged);
        // a breakdown that cannot be read gives no score (null), never 0, and Company MIS leaves the row out.
        var corrupt = new[] { "{\"Execution\":\"x\"}", "[1,2,3]", "\"text\"" };
        foreach (var json in corrupt)
        {
            var read = () => CompanyMisCalculator.UnderstandingScoreOf(json);
            read.Should().NotThrow(json);
            read().Should().BeNull($"'{json}' cannot be read: no score, never 0");

            var breakdown = UnderstandingComponents.Read(json);
            breakdown.Execution.Should().BeEmpty(json);
            breakdown.Insight.Should().BeEmpty(json);
            breakdown.Learning.Should().BeEmpty(json);
        }

        CompanyMisCalculator.UnderstandingScoreOf(null).Should().BeNull();
        CompanyMisCalculator.UnderstandingScoreOf("{}").Should().BeNull("an unstamped shell row has nothing to score");
        CompanyMisCalculator.UnderstandingScoreOf(Components(0.7)).Should().Be(7);
        CompanyMisCalculator.UnderstandingScoreOf(Components(0.0)).Should().Be(0, "E4: a computed 0 is a real score");

        var f1 = G(1);
        var rows = new Seed()
            .Farm(f1, G(901))
            .Day(f1, D(11, 11), "BasicWorkDay", CompanyMisCalculator.UnderstandingScoreOf(corrupt[0]))
            .Day(f1, D(11, 12), "BasicWorkDay", CompanyMisCalculator.UnderstandingScoreOf(Components(0.5)))
            .Build();

        var dto = Compute(rows, D(11, 10), D(11, 13));

        dto.Overview.UnderstandingScoredDays.Current.Should().Be(new MisValueDto(1m, null), "the corrupt row is left out");
        dto.Overview.UnderstandingMedian.Current.Should().Be(new MisValueDto(5.0m, null));
        Bucket(dto, 0).Should().Be(0, "the corrupt row is not a 0");
    }

    // ------------------------------------------------------------------
    // #47, #50 sync failures (Task 1c, E2, E8, E11(1))
    // ------------------------------------------------------------------

    [Fact]
    public void No_uploads_is_not_a_zero_rate()
    {
        var dto = Compute(new Seed().Farm(G(1), G(901)).Build(), D(11, 10), D(11, 13));

        dto.Quality.SyncRefusedPct.Current.Should().Be(new MisValueDto(null, DenominatorZero),
            "nothing was sent: not measured, never 0%");
        dto.Quality.SyncRefusedPct.Previous.Should().Be(new MisValueDto(null, DenominatorZero));
        dto.Quality.SyncRefusedPct.CurrentByDay.Should().HaveCount(4).And.OnlyContain(v => v == null);
        dto.Quality.SyncRefusedChanges.Current.Should().Be(new MisValueDto(0m, null), "a real zero count");
        dto.Quality.SyncAcceptedChanges.Current.Should().Be(new MisValueDto(0m, null));
        dto.Quality.SyncAcceptedChanges.CurrentByDay.Should().Equal(0m, 0m, 0m, 0m);
    }

    [Fact]
    public void Refused_share_uses_refused_and_accepted()
    {
        var rows = new Seed()
            .Farm(G(1), G(901))
            .Sync(D(11, 11), refused: 1, accepted: 3)
            .Sync(D(11, 12), refused: 1, accepted: 0)
            .Sync(D(11, 8), refused: 0, accepted: 4)
            .Build();

        var dto = Compute(rows, D(11, 10), D(11, 13));

        dto.Quality.SyncRefusedChanges.Current.Should().Be(new MisValueDto(2m, null));
        dto.Quality.SyncAcceptedChanges.Current.Should().Be(new MisValueDto(3m, null));
        dto.Quality.SyncRefusedPct.Current.Should().Be(new MisValueDto(40.0m, null),
            "2 refused of (2 refused + 3 accepted); refused over accepted alone would be 66.7");

        // E8: the chart reads CurrentByDay of the two counts; each day by the same rule.
        dto.Quality.SyncRefusedChanges.CurrentByDay.Should().Equal(0m, 1m, 1m, 0m);
        dto.Quality.SyncAcceptedChanges.CurrentByDay.Should().Equal(0m, 3m, 0m, 0m);
        dto.Quality.SyncRefusedPct.CurrentByDay.Should().Equal(null, 25.0m, 100.0m, null);

        dto.Quality.SyncRefusedChanges.Previous.Should().Be(new MisValueDto(0m, null));
        dto.Quality.SyncAcceptedChanges.Previous.Should().Be(new MisValueDto(4m, null));
        dto.Quality.SyncRefusedPct.Previous.Should().Be(new MisValueDto(0.0m, null), "0 of 4 is a real 0%");
    }

    [Fact]
    public void A_period_before_refusals_were_recorded_is_not_recorded()
    {
        // E2 + E11(1): SyncRefusalsRecordedSince = 2026-08-27 (first full India day after 28f70962 reached
        // production). A period with an earlier day has refused attempts and the share not measured; accepted
        // changes stay measured. By day (E8, DayForm.During) each day is judged alone.
        CompanyMisCalculator.SyncRefusalsRecordedSince.Should().Be(new DateOnly(2026, 8, 27));

        var rows = new Seed()
            .Farm(G(1), G(901))
            .Sync(new DateOnly(2026, 8, 25), refused: 0, accepted: 5)
            .Sync(new DateOnly(2026, 8, 28), refused: 1, accepted: 2)
            .Build();

        var dto = Compute(rows, new DateOnly(2026, 8, 24), new DateOnly(2026, 8, 30));

        dto.Quality.SyncRefusedChanges.Current.Should().Be(new MisValueDto(null, NotRecorded));
        dto.Quality.SyncRefusedPct.Current.Should().Be(new MisValueDto(null, NotRecorded));
        dto.Quality.SyncAcceptedChanges.Current.Should().Be(new MisValueDto(7m, null),
            "accepted changes were always recorded");
        dto.Quality.SyncRefusedChanges.CurrentByDay.Should().Equal(null, null, null, 0m, 1m, 0m, 0m);
        dto.Quality.SyncRefusedPct.CurrentByDay.Should().Equal(null, null, null, null, 33.3m, null, null);
        dto.Quality.SyncAcceptedChanges.CurrentByDay.Should().Equal(0m, 5m, 0m, 0m, 2m, 0m, 0m);
        dto.Quality.SyncRefusedChanges.Previous.Should().Be(new MisValueDto(null, NotRecorded));

        var fromTheFirstDay = Compute(rows, new DateOnly(2026, 8, 27), new DateOnly(2026, 8, 30));
        fromTheFirstDay.Quality.SyncRefusedChanges.Current.Should().Be(new MisValueDto(1m, null));
        fromTheFirstDay.Quality.SyncRefusedPct.Current.Should().Be(new MisValueDto(33.3m, null));
    }

    // ------------------------------------------------------------------
    // #29, #31 feature use (Task 1d, E1, E11(5), A8, P7)
    // ------------------------------------------------------------------

    [Fact]
    public void No_feature_share_exceeds_100()
    {
        // Review Focus 3: the base is everyone who did any counted thing in the period, so a person who marked
        // attendance but saved no entry cannot push a share above 100.
        var f1 = G(1);
        var owner = G(101);
        var w1 = G(102);
        var w2 = G(103);
        var w3 = G(104);
        var rows = new Seed()
            .Farm(f1, owner)
            .Member(f1, owner, "PrimaryOwner").Member(f1, w1, "Worker").Member(f1, w2, "Worker").Member(f1, w3, "Worker")
            .Entry(f1, owner, Ist(11, 11))
            .Use(f1, w1, Ist(11, 12), "attendance")
            .Use(f1, w2, Ist(11, 12), "attendance")
            .Use(f1, w2, Ist(11, 12, 15), "photos")
            .Use(f1, w3, Ist(11, 8), "attendance")           // previous period: not in this base
            .Build();

        var dto = Compute(rows, D(11, 10), D(11, 13));
        var use = dto.Engagement.FeatureUse;

        use.NotMeasuredReason.Should().BeNull();
        Feature(dto, "entries").Should().Be(new MisFeatureUseDto("entries", 1, 33.3m, null));
        Feature(dto, "attendance").Should().Be(new MisFeatureUseDto("attendance", 2, 66.7m, null),
            "2 of the 3 people who did anything; over entry savers alone it would be 200%");
        Feature(dto, "photos").Should().Be(new MisFeatureUseDto("photos", 1, 33.3m, null));
        Feature(dto, "voice").Should().Be(new MisFeatureUseDto("voice", 0, 0.0m, null), "a real 0 of 3");
        Feature(dto, "costs").Should().Be(new MisFeatureUseDto("costs", 0, 0.0m, null));
        Feature(dto, "job_cards").Should().Be(new MisFeatureUseDto("job_cards", 0, 0.0m, null));
        use.Items.Where(i => i.SharePct is not null).Should().OnlyContain(i => i.SharePct <= 100m);
    }

    [Fact]
    public void Nobody_counted_is_not_a_zero_share()
    {
        // E11(5): a feature share with nobody counted -> denominator_zero per item (People 0, SharePct null).
        var f1 = G(1);
        var rows = new Seed().Farm(f1, G(101)).Use(f1, G(101), Ist(11, 1), "costs").Build();

        var dto = Compute(rows, D(11, 10), D(11, 13));

        dto.Engagement.FeatureUse.NotMeasuredReason.Should().BeNull();
        foreach (var key in FeatureKeys.Where(k => k != "compare"))
        {
            Feature(dto, key).Should().Be(new MisFeatureUseDto(key, 0, null, DenominatorZero), key);
        }

        Feature(dto, "compare").Should().Be(new MisFeatureUseDto("compare", null, null, NotRecorded));
        dto.Engagement.FeatureUseByRole.Should().BeEquivalentTo(new MisListDto<MisFeatureRoleDto>([], null));
    }

    [Fact]
    public void Compare_is_not_recorded()
    {
        var f1 = G(1);
        var owner = G(101);
        var rows = new Seed()
            .Farm(f1, owner).Member(f1, owner, "PrimaryOwner")
            .Entry(f1, owner, Ist(11, 12))
            .Build();

        var dto = Compute(rows, D(11, 10), D(11, 13));

        Feature(dto, "compare").Should().Be(new MisFeatureUseDto("compare", null, null, NotRecorded),
            "opening Compare writes no record anywhere: People and share null, never 0");
        dto.Engagement.FeatureUseByRole.Items.Should().NotContain(r => r.Feature == "compare");
    }

    [Fact]
    public void No_schedule_feature_is_counted()
    {
        // E1: schedule_checks is a staff act and schedule_subscriptions records no person.
        var f1 = G(1);
        var owner = G(101);
        var rows = new Seed().Farm(f1, owner).Member(f1, owner, "PrimaryOwner").Entry(f1, owner, Ist(11, 12)).Build();

        var dto = Compute(rows, D(11, 10), D(11, 13));

        dto.Engagement.FeatureUse.Items.Select(i => i.Feature).Should().BeEquivalentTo(FeatureKeys,
            "one item per E1 feature key, no schedule feature");
        dto.Engagement.FeatureUse.Items.Should().HaveCount(7);
    }

    [Fact]
    public void A_person_with_two_roles_counts_once_per_role()
    {
        // Task 1d: the role is the person's farm_memberships.role on the farm where the use happened, by A8
        // (Active memberships only, else Unknown); a person counts once per (feature, role). P7: naming the
        // role never changes the feature count.
        var f1 = G(1);
        var f2 = G(2);
        var p = G(101);
        var q = G(102);
        var r = G(103);
        var rows = new Seed()
            .Farm(f1, p).Farm(f2, G(902))
            .Member(f1, p, "PrimaryOwner").Member(f2, p, "Worker")
            .Member(f1, q, "Worker")
            .Member(f2, r, "Worker", status: 5)               // revoked: names no role (A8)
            .Entry(f1, p, Ist(11, 11)).Entry(f1, p, Ist(11, 12))
            .Entry(f2, p, Ist(11, 12))
            .Entry(f1, q, Ist(11, 12))
            .Entry(f2, r, Ist(11, 13))
            .Use(f1, p, Ist(11, 11), "costs").Use(f1, p, Ist(11, 12), "costs")
            .Job(G(700), f2, p, Ist(11, 12), "Succeeded", 900)
            .Build();

        var dto = Compute(rows, D(11, 10), D(11, 13));

        dto.Engagement.FeatureUseByRole.NotMeasuredReason.Should().BeNull();
        dto.Engagement.FeatureUseByRole.Items.Should().BeEquivalentTo(new[]
        {
            new MisFeatureRoleDto("entries", "PrimaryOwner", 1),
            new MisFeatureRoleDto("entries", "Worker", 2),     // p on f2, q on f1
            new MisFeatureRoleDto("entries", "Unknown", 1),    // r: no Active membership on f2
            new MisFeatureRoleDto("costs", "PrimaryOwner", 1), // p twice on f1: once
            new MisFeatureRoleDto("voice", "Worker", 1),       // p's recording on f2
        });
        Feature(dto, "entries").People.Should().Be(3, "p, q, r: p counted once whatever roles he holds (P7)");
        Feature(dto, "costs").People.Should().Be(1);
        Feature(dto, "voice").People.Should().Be(1);
    }

    // ------------------------------------------------------------------
    // #59 crops on active farms (Task 1e, E9)
    // ------------------------------------------------------------------

    [Fact]
    public void Crop_names_are_grouped_by_trimmed_lower_case()
    {
        // Review Focus 4: "Grapes " and "grapes" are one row (shown with the most common spelling); a Marathi
        // name stays its own row. Ordered by farms, then acres, then name.
        var f1 = G(1);
        var f2 = G(2);
        var f3 = G(3);
        var rows = new Seed()
            .Farm(f1, G(901)).Farm(f2, G(902)).Farm(f3, G(903))
            .Entry(f1, G(901), Ist(11, 12)).Entry(f2, G(902), Ist(11, 12)).Entry(f3, G(903), Ist(11, 12))
            .Crop(f1, G(11), "Grapes", 2.0m, D(10, 1))
            .Crop(f2, G(12), "Grapes", 1.5m, D(10, 1))
            .Crop(f3, G(13), "grapes ", 1.0m, D(10, 1))
            .Crop(f3, G(14), " GRAPES", 0.5m, D(10, 1))
            .Crop(f1, G(15), "द्राक्ष", 0.75m, D(10, 1))
            .Crop(f2, G(16), "Onion", 2.5m, D(10, 1))
            .Build();

        var dto = Compute(rows, D(11, 10), D(11, 13));

        dto.Farms.CropsOnActiveFarms.NotMeasuredReason.Should().BeNull();
        dto.Farms.CropsOnActiveFarms.Items.Should().Equal(
            new MisCropRowDto("Grapes", 3, 5.0m),
            new MisCropRowDto("Onion", 1, 2.5m),
            new MisCropRowDto("द्राक्ष", 1, 0.75m));
    }

    [Fact]
    public void An_ended_crop_before_the_period_is_left_out()
    {
        // Task 1e + E9: cycles with start_date on or before the period's last day and end_date null or on or after
        // its first day.
        var f1 = G(1);
        var rows = new Seed()
            .Farm(f1, G(901)).Entry(f1, G(901), Ist(11, 12))
            .Crop(f1, G(11), "Wheat", 1.0m, D(6, 1), end: D(11, 9))     // ended the day before: out
            .Crop(f1, G(12), "Onion", 2.0m, D(6, 1), end: D(11, 10))    // ended on the first day: in
            .Crop(f1, G(13), "Tomato", 3.0m, D(11, 14))                 // starts after the last day: out
            .Crop(f1, G(14), "Grapes", 4.0m, D(10, 1))                  // still running: in
            .Crop(f1, G(15), "Maize", 5.0m, D(11, 13))                  // starts on the last day: in
            .Build();

        var dto = Compute(rows, D(11, 10), D(11, 13));

        dto.Farms.CropsOnActiveFarms.Items.Should().Equal(
            new MisCropRowDto("Maize", 1, 5.0m),
            new MisCropRowDto("Grapes", 1, 4.0m),
            new MisCropRowDto("Onion", 1, 2.0m));
    }

    [Fact]
    public void Crops_on_farms_not_active_are_left_out()
    {
        // Task 1e: active farms = the existing active-farm rule (CR-2a: >= 1 entry in the 7 days ending the period's
        // last day).
        var active = G(1);
        var quiet = G(2);
        var rows = new Seed()
            .Farm(active, G(901)).Farm(quiet, G(902))
            .Entry(active, G(901), Ist(11, 12))
            .Entry(quiet, G(902), Ist(11, 1))                            // last entry 12 days before 13 Nov
            .Crop(active, G(11), "Grapes", 1.0m, D(10, 1))
            .Crop(quiet, G(12), "Grapes", 3.0m, D(10, 1))
            .Crop(quiet, G(13), "Onion", 2.0m, D(10, 1))
            .Build();

        var dto = Compute(rows, D(11, 10), D(11, 13));

        dto.Farms.CropsOnActiveFarms.Items.Should().Equal(new MisCropRowDto("Grapes", 1, 1.0m));
    }

    [Fact]
    public void A_plot_with_two_crops_counts_for_both()
    {
        // Task 1e: Acres = the sum of the DISTINCT plots' areas under such cycles; a plot with two crops counts for
        // both, but one plot with two cycles of one crop counts once for it.
        var f1 = G(1);
        var plot1 = G(11);
        var plot2 = G(12);
        var rows = new Seed()
            .Farm(f1, G(901)).Entry(f1, G(901), Ist(11, 12))
            .Crop(f1, plot1, "Grapes", 2.0m, D(6, 1))
            .Crop(f1, plot1, "Grapes", 2.0m, D(11, 1))
            .Crop(f1, plot1, "Onion", 2.0m, D(10, 1))
            .Crop(f1, plot2, "Grapes", 1.0m, D(10, 1))
            .Build();

        var dto = Compute(rows, D(11, 10), D(11, 13));

        dto.Farms.CropsOnActiveFarms.Items.Should().Equal(
            new MisCropRowDto("Grapes", 1, 3.0m),
            new MisCropRowDto("Onion", 1, 2.0m));
    }

    // ------------------------------------------------------------------
    // #26 entries by kind (Task 1f, E9, E11(2))
    // ------------------------------------------------------------------

    [Fact]
    public void Entries_count_once_per_kind()
    {
        WorkWordsMeanWhatThisTestSays();

        var f1 = G(1);
        var o = G(901);
        var rows = new Seed()
            .Farm(f1, o)
            .Entry(f1, o, Ist(11, 10), tasks: ["irrigation", "drip irrigation"])  // water, once
            .Entry(f1, o, Ist(11, 11), tasks: ["irrigation", "spraying"])         // water and spray
            .Entry(f1, o, Ist(11, 11, 12), tasks: [])                             // no task line: not recognised
            .Entry(f1, o, Ist(11, 12), tasks: ["zzqq"])                           // not recognised
            .Entry(f1, o, Ist(11, 12, 12), tasks: ["fertilizer"])                 // nutrition
            .Entry(f1, o, Ist(11, 13), tasks: ["pruning", "pruning"])             // other work, once
            .Entry(f1, o, Ist(11, 8), tasks: ["irrigation"])                      // previous period
            .Build();

        var dto = Compute(rows, D(11, 10), D(11, 13));

        dto.Engagement.LogsByKind.NotMeasuredReason.Should().BeNull();
        dto.Engagement.LogsByKind.Items.Should().BeEquivalentTo(new[]
        {
            new MisKindCountDto("water", 2),
            new MisKindCountDto("nutrition", 1),
            new MisKindCountDto("spray", 1),
            new MisKindCountDto("other_work", 1),
            new MisKindCountDto("labour", 0),
            new MisKindCountDto("not_recognised", 2),
        }, "every kind is present, zeros real; an entry counts once per distinct kind");
    }

    [Fact]
    public void Labour_entries_count_as_labour()
    {
        // Task 1f: capture_scope = labour also counts under labour. E11(2): a labour entry with no task line counts
        // under labour only. E9: capture_scope null (any other door, or saved before lane F1) is not labour.
        WorkWordsMeanWhatThisTestSays();

        var f1 = G(1);
        var o = G(901);
        var rows = new Seed()
            .Farm(f1, o)
            .Entry(f1, o, Ist(11, 10), tasks: ["pruning"], scope: "labour")   // labour and other work
            .Entry(f1, o, Ist(11, 11), tasks: [], scope: "labour")            // labour only
            .Entry(f1, o, Ist(11, 12), tasks: [], scope: null)                // not recognised
            .Entry(f1, o, Ist(11, 13), tasks: ["zzqq"], scope: "labour")      // labour and not recognised
            .Build();

        var dto = Compute(rows, D(11, 10), D(11, 13));

        dto.Engagement.LogsByKind.Items.Should().BeEquivalentTo(new[]
        {
            new MisKindCountDto("water", 0),
            new MisKindCountDto("nutrition", 0),
            new MisKindCountDto("spray", 0),
            new MisKindCountDto("other_work", 1),
            new MisKindCountDto("labour", 3),
            new MisKindCountDto("not_recognised", 2),
        });
    }

    // ------------------------------------------------------------------
    // Global Constraints: the farm block, test accounts; A9 previous period
    // ------------------------------------------------------------------

    [Fact]
    public void The_farm_block_reaches_every_farm_item_not_versions_or_sync()
    {
        var f1 = G(1);
        var owner = G(101);
        Seed Full() => new Seed()
            .Farm(f1, owner).Member(f1, owner, "PrimaryOwner")
            .Entry(f1, owner, Ist(11, 12), tasks: ["irrigation"])
            .Use(f1, owner, Ist(11, 12), "costs")
            .Day(f1, D(11, 12), "BasicWorkDay", 6)
            .Crop(f1, G(11), "Grapes", 1.0m, D(10, 1))
            .User(owner, Ist(11, 11))
            .Seen(owner, "1.0.17", Ist(11, 12), Android)
            .Sync(D(11, 11), refused: 1, accepted: 1);

        foreach (var (name, rows, reason) in new[]
                 {
                     ("unreadable farm", Full().Build(notReadable: 1), FarmListUnreadable),
                     ("empty farm list", new Seed().User(owner, Ist(11, 11)).Seen(owner, "1.0.17", Ist(11, 12), Android)
                         .Sync(D(11, 11), refused: 1, accepted: 1).Build(), FarmListUnreadable),
                     ("above the ceiling", Full().Build(listed: 501, liveCountSkipped: true), TooManyFarms),
                 })
        {
            var dto = Compute(rows, D(11, 10), D(11, 13));

            foreach (var (item, number) in new[]
                     {
                         ("understandingMedian", dto.Overview.UnderstandingMedian),
                         ("understandingScoredDays", dto.Overview.UnderstandingScoredDays),
                     })
            {
                number.Current.Should().Be(new MisValueDto(null, reason), $"{name}: {item}");
                number.Previous.Should().Be(new MisValueDto(null, reason), $"{name}: {item} (previous)");
                number.CurrentByDay.Should().BeNull($"{name}: {item} has no day list when blocked (A9)");
                number.PreviousByDay.Should().BeNull($"{name}: {item}");
            }

            dto.Quality.UnderstandingSpread.Should().BeEquivalentTo(new MisListDto<MisScoreBucketDto>([], reason), name);
            dto.Engagement.FeatureUse.Should().BeEquivalentTo(new MisListDto<MisFeatureUseDto>([], reason), name);
            dto.Engagement.FeatureUseByRole.Should().BeEquivalentTo(new MisListDto<MisFeatureRoleDto>([], reason), name);
            dto.Engagement.LogsByKind.Should().BeEquivalentTo(new MisListDto<MisKindCountDto>([], reason), name);
            dto.Farms.CropsOnActiveFarms.Should().BeEquivalentTo(new MisListDto<MisCropRowDto>([], reason), name);

            // Not farm-derived: the server's sync and the app versions stay measured.
            dto.Quality.SyncRefusedChanges.Current.Should().Be(new MisValueDto(1m, null), name);
            dto.Quality.SyncAcceptedChanges.Current.Should().Be(new MisValueDto(1m, null), name);
            dto.Quality.SyncRefusedPct.Current.Should().Be(new MisValueDto(50.0m, null), name);
            dto.Quality.SyncRefusedChanges.CurrentByDay.Should().Equal(new decimal?[] { 0m, 1m, 0m, 0m }, name);
            dto.Quality.AppVersions.Should().BeEquivalentTo(new MisListDto<MisVersionShareDto>(
                [new MisVersionShareDto("1.0.17", Android, 1, 100.0m)], null), name);
            dto.Quality.AppVersionsSeenSince.Should().Be(D(11, 12), name);
        }
    }

    [Fact]
    public void Test_accounts_are_left_out_of_the_farm_items()
    {
        // Global Constraints (C30(2) Company MIS rule): people in the list are left out of every person-based count;
        // farms owned by one are left out of every farm-based count. Sync is the stated exception (it records no
        // person on the accepted side) and is not tested here.
        WorkWordsMeanWhatThisTestSays();

        var x = G(900);
        var o = G(101);
        var real = G(1);
        var demo = G(9);
        var excluded = new HashSet<Guid> { x };
        var seed = new Seed()
            .Farm(real, o).Farm(demo, x)
            .Member(real, o, "PrimaryOwner").Member(real, x, "Worker").Member(demo, x, "PrimaryOwner").Member(demo, o, "Worker")
            .Entry(real, o, Ist(11, 12), tasks: ["pruning"])
            .Entry(real, x, Ist(11, 12), tasks: ["irrigation"])        // the test account's entry on a real farm
            .Entry(demo, x, Ist(11, 12), tasks: ["spraying"])
            .Use(real, x, Ist(11, 12), "attendance")                    // the test account's use on a real farm
            .Use(demo, o, Ist(11, 12), "costs")                         // a real person's use on the test farm
            .Day(real, D(11, 12), "BasicWorkDay", 5)
            .Day(demo, D(11, 12), "BasicWorkDay", 9)
            .Crop(real, G(11), "Onion", 1.0m, D(10, 1))
            .Crop(demo, G(19), "Grapes", 3.0m, D(10, 1));

        var dto = Compute(seed.Build(excluded), D(11, 10), D(11, 13), excluded);

        dto.Overview.UnderstandingScoredDays.Current.Should().Be(new MisValueDto(1m, null), "the test farm's day is left out");
        dto.Overview.UnderstandingMedian.Current.Should().Be(new MisValueDto(5.0m, null));
        Feature(dto, "entries").Should().Be(new MisFeatureUseDto("entries", 1, 100.0m, null),
            "only the real person, on the real farm, counts; he is the whole base");
        Feature(dto, "attendance").Should().Be(new MisFeatureUseDto("attendance", 0, 0.0m, null));
        Feature(dto, "costs").Should().Be(new MisFeatureUseDto("costs", 0, 0.0m, null), "his cost was on the test farm");
        dto.Engagement.FeatureUseByRole.Items.Should().BeEquivalentTo(new[] { new MisFeatureRoleDto("entries", "PrimaryOwner", 1) });
        dto.Farms.CropsOnActiveFarms.Items.Should().Equal(new MisCropRowDto("Onion", 1, 1.0m));
        dto.Engagement.LogsByKind.Items.Should().ContainEquivalentOf(new MisKindCountDto("other_work", 1));
        dto.Engagement.LogsByKind.Items.Should().ContainEquivalentOf(new MisKindCountDto("water", 0));
        dto.Engagement.LogsByKind.Items.Should().ContainEquivalentOf(new MisKindCountDto("spray", 0));
    }

    [Fact]
    public void Previous_period_uses_the_same_rule()
    {
        // A9 / E8: every new number's Previous is the same rule on the previous period, and each day of the day
        // lists (DayForm.During) is the same rule on that one day.
        var f1 = G(1);
        var f2 = G(2);
        var rows = new Seed()
            .Farm(f1, G(901)).Farm(f2, G(902))
            .Day(f1, D(11, 7), "BasicWorkDay", 4)
            .Day(f1, D(11, 8), "BasicWorkDay", 6)
            .Day(f2, D(11, 8), "RichWorkDay", 9)
            .Day(f1, D(11, 11), "BasicWorkDay", 5)
            .Day(f1, D(11, 12), "BasicWorkDay", 7)
            .Day(f2, D(11, 12), "RichWorkDay", null)
            .Day(f2, D(11, 3), "RichWorkDay", 2)
            .Sync(D(11, 7), refused: 2, accepted: 3)
            .Sync(D(11, 12), refused: 1, accepted: 1)
            .Sync(D(11, 4), refused: 0, accepted: 6)
            .Build();

        var dto = Compute(rows, D(11, 10), D(11, 13));
        var previous = Compute(rows, D(11, 6), D(11, 9));

        foreach (var (name, now, before) in NewNumbers(dto).Zip(NewNumbers(previous), (n, p) => (n.Name, n.Number, p.Number)))
        {
            now.Previous.Should().Be(before.Current, $"{name}: Previous is the same rule on 6..9 Nov");
            now.PreviousByDay.Should().Equal(before.CurrentByDay, $"{name}: and so are its days");
            now.CurrentByDay.Should().HaveCount(4, name);
        }

        // Worked out by hand, so the equality above is not two copies of one mistake.
        dto.Overview.UnderstandingMedian.Previous.Should().Be(new MisValueDto(6.0m, null), "middle of 4, 6, 9");
        dto.Overview.UnderstandingScoredDays.Previous.Should().Be(new MisValueDto(3m, null));
        dto.Overview.UnderstandingMedian.Current.Should().Be(new MisValueDto(6.0m, null), "middle of 5 and 7");
        dto.Quality.SyncRefusedChanges.Previous.Should().Be(new MisValueDto(2m, null));
        dto.Quality.SyncAcceptedChanges.Previous.Should().Be(new MisValueDto(3m, null));
        dto.Quality.SyncRefusedPct.Previous.Should().Be(new MisValueDto(40.0m, null));

        // Each day of the current day lists is the rule on that one day.
        for (var i = 0; i < 4; i++)
        {
            var day = D(11, 10).AddDays(i);
            var single = Compute(rows, day, day);
            foreach (var (name, number, alone) in NewNumbers(dto).Zip(NewNumbers(single), (n, s) => (n.Name, n.Number, s.Number)))
            {
                number.CurrentByDay![i].Should().Be(alone.Current.Value, $"{name} on {day}");
            }
        }

        dto.Overview.UnderstandingMedian.CurrentByDay.Should().Equal(null, 5.0m, 7.0m, null);
        dto.Overview.UnderstandingScoredDays.CurrentByDay.Should().Equal(null, 1m, 1m, null);
    }

    // ------------------------------------------------------------------
    // Harness
    // ------------------------------------------------------------------

    private static IEnumerable<(string Name, MisNumberDto Number)> NewNumbers(CompanyMisDto dto) => new[]
    {
        ("overview.understandingMedian", dto.Overview.UnderstandingMedian),
        ("overview.understandingScoredDays", dto.Overview.UnderstandingScoredDays),
        ("quality.syncRefusedChanges", dto.Quality.SyncRefusedChanges),
        ("quality.syncAcceptedChanges", dto.Quality.SyncAcceptedChanges),
        ("quality.syncRefusedPct", dto.Quality.SyncRefusedPct),
    };

    /// <summary>The fixture's work words read as the tests above say (WorkRecogniser is the plan's named source).</summary>
    private static void WorkWordsMeanWhatThisTestSays()
    {
        WorkRecogniser.Recognise("irrigation")!.Part.Should().Be(WorkPart.Irrigation);
        WorkRecogniser.Recognise("drip irrigation")!.Part.Should().Be(WorkPart.Irrigation);
        WorkRecogniser.Recognise("spraying")!.Part.Should().Be(WorkPart.Spray);
        WorkRecogniser.Recognise("fertilizer")!.Part.Should().Be(WorkPart.Nutrition);
        WorkRecogniser.Recognise("pruning")!.Part.Should().Be(WorkPart.Work);
        WorkRecogniser.Recognise("zzqq").Should().BeNull("a word the list does not know");
    }

    private static MisFeatureUseDto Feature(CompanyMisDto dto, string key) =>
        dto.Engagement.FeatureUse.Items.Should().ContainSingle(i => i.Feature == key, key).Which;

    private static int Bucket(CompanyMisDto dto, int score) =>
        dto.Quality.UnderstandingSpread.Items.Should().ContainSingle(b => b.Score == score).Which.FarmDays;

    /// <summary>A stored breakdown the day screen's reader understands: one applicable part, this much covered.</summary>
    private static string Components(double coverage) =>
        JsonSerializer.Serialize(new LensInput([new ScoredDimension("FAKE_PART", 10, true, coverage, 1.0)], [], []));

    private static DateOnly D(int month, int day) => new(2026, month, day);

    /// <summary>A UTC instant given as an India-time wall clock in 2026.</summary>
    private static DateTime Ist(int month, int day, int hour = 10, int minute = 0) =>
        new DateTime(2026, month, day, hour, minute, 0, DateTimeKind.Utc) - IstOffset;

    private static Guid G(int n) => Guid.Parse($"c2c00000-0000-0000-0000-{n:D12}");

    /// <summary>Computes with the previous period the plan defines: same length, ending the day before `from`.</summary>
    private static CompanyMisDto Compute(CompanyMisRows rows, DateOnly from, DateOnly to, IReadOnlySet<Guid>? excluded = null)
    {
        var length = to.DayNumber - from.DayNumber + 1;
        var previousTo = from.AddDays(-1);
        var previousFrom = previousTo.AddDays(-(length - 1));
        var dto = CompanyMisCalculator.Compute(
            rows, new CompanyMisExclusions(excluded ?? new HashSet<Guid>()), from, to, previousFrom, previousTo, CountedAt);
        AssertHonest(dto, length);
        return dto;
    }

    /// <summary>
    /// P4 on every number (value null exactly when a reason is given) and on every CR-2c list (a reason means an
    /// empty list); A9 day lists have one entry per day when present.
    /// </summary>
    private static void AssertHonest(CompanyMisDto dto, int days)
    {
        foreach (var section in new object[] { dto.Overview, dto.Acquisition, dto.Engagement, dto.Retention, dto.Quality, dto.Farms })
        {
            foreach (var prop in section.GetType().GetProperties(BindingFlags.Public | BindingFlags.Instance))
            {
                var value = prop.GetValue(section);
                if (value is MisNumberDto number)
                {
                    foreach (var (which, v) in new[] { ("current", number.Current), ("previous", number.Previous) })
                    {
                        (v.Value is null).Should().Be(v.NotMeasuredReason is not null,
                            $"{section.GetType().Name}.{prop.Name} {which}: value is null exactly when a reason is given");
                    }

                    if (number.CurrentByDay is not null)
                    {
                        number.CurrentByDay.Should().HaveCount(days, prop.Name);
                    }
                }
                else if (prop.PropertyType.IsGenericType && prop.PropertyType.GetGenericTypeDefinition() == typeof(MisListDto<>))
                {
                    var items = (System.Collections.IEnumerable)prop.PropertyType.GetProperty("Items")!.GetValue(value)!;
                    var reason = (string?)prop.PropertyType.GetProperty("NotMeasuredReason")!.GetValue(value);
                    if (reason is not null)
                    {
                        items.Cast<object>().Should().BeEmpty($"{prop.Name}: a list with a reason has no items");
                    }
                }
            }
        }

        foreach (var f in dto.Engagement.FeatureUse.Items)
        {
            (f.SharePct is null).Should().Be(f.NotMeasuredReason is not null, $"feature {f.Feature}: share null exactly when a reason is given");
        }
    }

    /// <summary>Hand-built reader rows, CR-2a members plus the CR-2c members.</summary>
    private sealed class Seed
    {
        private readonly List<(Guid Id, Guid Owner, DateTime Created)> _farms = new();
        private readonly List<MisEntryRow> _entries = new();
        private readonly List<MisMembershipRow> _members = new();
        private readonly List<MisVoiceJobRow> _jobs = new();
        private readonly List<MisUserRow> _users = new();
        private readonly List<MisAppSeenRow> _seen = new();
        private readonly List<MisUnderstandingDayRow> _days = new();
        private readonly List<MisSyncDayRow> _sync = new();
        private readonly List<MisFeatureUseRow> _uses = new();
        private readonly List<MisCropCycleRow> _crops = new();

        public Seed Farm(Guid id, Guid owner)
        {
            _farms.Add((id, owner, Ist(1, 1)));
            return this;
        }

        public Seed Entry(Guid farm, Guid op, DateTime utc, string[]? tasks = null, string? scope = null)
        {
            _entries.Add(new MisEntryRow(farm, op, utc, false, 1, null, tasks ?? [], scope));
            return this;
        }

        public Seed Member(Guid farm, Guid user, string role, int status = 3)
        {
            _members.Add(new MisMembershipRow(farm, user, role, status));
            return this;
        }

        public Seed Job(Guid id, Guid farm, Guid user, DateTime utc, string status, params int[] latencies)
        {
            _jobs.Add(new MisVoiceJobRow(id, farm, user, utc, status, latencies));
            return this;
        }

        public Seed User(Guid id, DateTime verifiedUtc)
        {
            _users.Add(new MisUserRow(id, verifiedUtc));
            return this;
        }

        public Seed Seen(Guid person, string version, DateTime utc, string? platform)
        {
            _seen.Add(new MisAppSeenRow(person, version, utc, platform));
            return this;
        }

        public Seed Day(Guid farm, DateOnly day, string classification, int? score)
        {
            _days.Add(new MisUnderstandingDayRow(farm, day, classification, score));
            return this;
        }

        public Seed Sync(DateOnly day, int refused, int accepted)
        {
            _sync.Add(new MisSyncDayRow(day, refused, accepted));
            return this;
        }

        public Seed Use(Guid farm, Guid person, DateTime utc, string feature)
        {
            _uses.Add(new MisFeatureUseRow(farm, person, utc, feature));
            return this;
        }

        public Seed Crop(Guid farm, Guid plot, string name, decimal acres, DateOnly start, DateOnly? end = null)
        {
            _crops.Add(new MisCropCycleRow(farm, plot, name, start, end, acres));
            return this;
        }

        /// <summary>
        /// The reader's shape: first/last entry per farm leave out excluded accounts (A5); AppSeenStartUtc is the
        /// first app.seen row of all (the handler asks IAdminOpsRepository.GetAppSeenStartAsync, which leaves no
        /// one out); above the ceiling no per-farm row is read, the non-farm reads still are.
        /// </summary>
        public CompanyMisRows Build(
            IReadOnlySet<Guid>? excluded = null, int notReadable = 0, int? listed = null, bool liveCountSkipped = false)
        {
            excluded ??= new HashSet<Guid>();
            var farms = _farms.Select(f =>
            {
                var own = _entries
                    .Where(e => e.FarmId == f.Id && e.CreatedAtUtc < CountedAt && !excluded.Contains(e.OperatorUserId))
                    .Select(e => e.CreatedAtUtc)
                    .ToList();
                return new MisFarmRow(f.Id, f.Owner, f.Created,
                    own.Count == 0 ? null : own.Max(), own.Count == 0 ? null : own.Min());
            }).ToList();

            var seenStart = _seen.Count == 0 ? (DateTime?)null : _seen.Min(s => s.SeenAtUtc);

            if (liveCountSkipped)
            {
                return new CompanyMisRows(
                    listed ?? 0, 0, [], [], [], [], [], _users, [], LiveCountSkipped: true)
                {
                    AppSeen = _seen,
                    AppSeenStartUtc = seenStart,
                    SyncDays = _sync,
                };
            }

            return new CompanyMisRows(
                listed ?? farms.Count + notReadable, notReadable, farms, _entries, _members, [], _jobs, _users, [])
            {
                AppSeen = _seen,
                AppSeenStartUtc = seenStart,
                UnderstandingDays = _days,
                SyncDays = _sync,
                FeatureUses = _uses,
                CropCycles = _crops,
            };
        }
    }
}
