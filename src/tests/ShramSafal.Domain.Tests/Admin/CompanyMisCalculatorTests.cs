// spec: company-mis-real-numbers-2026-11-15 (plan CR-2a, Task 2, amendments A1, A5, A6, A7)
//
// The counting rules of the plan's table, as pure code. Written by the
// test-writer from the spec and the plan only: every expected value below is
// worked out by hand from the plan's "Counting rules" (shared definitions and
// rows 1..38) and the binding amendments, never from what the code returns.
//
// Fixed instant: countedAtUtc = 06:30 UTC on 14 Nov 2026 = 12:00 India time,
// so "today" is 14 Nov and a day is complete when it is 13 Nov or earlier.
// 14 Nov 2026 is a Saturday; 9 Nov is a Monday.
//
// Rows are hand-built. A farm's FirstEntryUtc / LastEntryUtc are filled the way
// the plan says the reader fills them (earliest / latest entry before the
// counting instant, leaving out entries of excluded accounts) unless a test
// sets them on purpose (amendment A5). Made-up GUIDs and names only.

using System.Reflection;
using FluentAssertions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Admin.GetCompanyMis;
using Xunit;

namespace ShramSafal.Domain.Tests.Admin;

public sealed class CompanyMisCalculatorTests
{
    private static readonly TimeSpan IstOffset = TimeSpan.FromMinutes(330);
    private static readonly DateTime CountedAt = new(2026, 11, 14, 6, 30, 0, DateTimeKind.Utc);

    private const string DenominatorZero = "denominator_zero";
    private const string NoCompleteWindow = "no_complete_window";
    private const string FarmListUnreadable = "farm_list_unreadable";
    private const string NoSamples = "no_samples";
    private const string TooManyFarms = "too_many_farms_for_live_count";

    // ------------------------------------------------------------------
    // India day
    // ------------------------------------------------------------------

    [Fact]
    public void Entries_at_0030_and_2330_IST_land_on_the_same_india_day()
    {
        var farm = G(1);
        var owner = G(101);
        var rows = new Seed()
            .Farm(farm, owner)
            .Entry(farm, owner, new DateTime(2026, 11, 9, 19, 0, 0, DateTimeKind.Utc))   // 00:30 IST 10 Nov
            .Entry(farm, owner, new DateTime(2026, 11, 10, 18, 0, 0, DateTimeKind.Utc))  // 23:30 IST 10 Nov
            .Build();

        var tenth = Compute(rows, D(11, 10), D(11, 10));
        Measured(tenth.Overview.LogsRecorded).Should().Be(2, "both entries are on 10 Nov in India time");
        tenth.Overview.Dau.Current.Value.Should().Be(1);

        var ninth = Compute(rows, D(11, 9), D(11, 9));
        Measured(ninth.Overview.LogsRecorded).Should().Be(0,
            "the 00:30 entry is 9 Nov in UTC but 10 Nov in India; 9 Nov has no entry (a measured zero)");
    }

    // ------------------------------------------------------------------
    // Exclusions
    // ------------------------------------------------------------------

    [Fact]
    public void Excluded_accounts_are_left_out_of_every_count()
    {
        var x = G(900);          // a test account
        var r = G(101);          // a real farmer
        var r2 = G(102);         // another real farmer
        var fr = G(1);           // r's farm
        var fr2 = G(2);          // r2's farm: only the test account ever saved here
        var fx = G(3);           // the test account's own farm
        var jx = G(501);         // test account's voice job on a real farm
        var jOnFx = G(502);      // a real person's voice job on the test account's farm
        var jReal = G(503);      // a real voice job
        var excluded = new HashSet<Guid> { x };

        var rows = new Seed()
            .Farm(fr, r).Farm(fr2, r2).Farm(fx, x)
            .Entry(fr, r, Ist(11, 12))
            .Entry(fr, x, Ist(11, 12, 11), voice: true, job: jx)
            .Entry(fr2, x, Ist(11, 11))
            .Entry(fx, r, Ist(11, 12))
            .Entry(fx, x, Ist(11, 13))
            .Member(fr, r, "PrimaryOwner").Member(fr, x, "Worker")
            .Member(fx, x, "PrimaryOwner").Member(fx, r, "Worker")
            .Member(fr2, r2, "PrimaryOwner")
            .Plot(fr, 2.0m).Plot(fr2, 3.0m).Plot(fx, 5.0m)
            .User(r, Ist(11, 11)).User(x, Ist(11, 11))
            .Job(jx, fr, x, Ist(11, 12), "Succeeded", 700)
            .Job(jOnFx, fx, r, Ist(11, 12), "Succeeded", 800)
            .Job(jReal, fr, r, Ist(11, 12), "Succeeded", 500)
            .Build(excluded);

        var dto = Compute(rows, D(11, 10), D(11, 13), excluded);

        dto.ExcludedTestAccounts.Should().Be(1, "the answer carries the count of test accounts, never their ids");
        Measured(dto.Overview.LogsRecorded).Should().Be(1, "only the real farmer's entry on the real farm counts");
        Measured(dto.Overview.VoiceLogs).Should().Be(0, "the voice entry was saved by the test account");
        Measured(dto.Overview.ActiveFarms).Should().Be(1, "fr2's only entry is the test account's; fx is excluded");
        Measured(dto.Farms.FarmsRegistered).Should().Be(2, "the test account's farm is not a registered farm");
        Measured(dto.Overview.SignUps).Should().Be(1);
        Measured(dto.Acquisition.Verified).Should().Be(1);
        Measured(dto.Acquisition.HasFarm).Should().Be(1);
        Measured(dto.Acquisition.FirstLog).Should().Be(1);
        Measured(dto.Overview.Wau).Should().Be(1);
        Measured(dto.Overview.Mau).Should().Be(1);
        Measured(dto.Quality.VoiceRecordings).Should().Be(1,
            "the test account's job and any job on the test account's farm are left out");
        Measured(dto.Quality.TranscriptionAvgMs).Should().Be(500);
        Measured(dto.Retention.NeverLoggedFarms).Should().Be(1,
            "fr2 has only entries saved by the test account: after exclusion it never logged");
        Measured(dto.Farms.AcresCovered).Should().Be(2.0m, "only fr is active; fx is excluded");
        dto.Engagement.RoleMixOfMau.Should().BeEquivalentTo(new[] { new MisRoleCountDto("PrimaryOwner", 1) });
        dto.Overview.SignUpsByDay.Sum(p => p.Value).Should().Be(1);
        dto.Engagement.WhenLogged.Sum(c => c.Logs).Should().Be(1);
    }

    // ------------------------------------------------------------------
    // P4: not measured versus a true zero
    // ------------------------------------------------------------------

    [Fact]
    public void Ratios_with_nothing_to_divide_are_not_measured()
    {
        var rows = new Seed().Farm(G(1), G(101)).Build();

        var dto = Compute(rows, D(11, 10), D(11, 13));

        foreach (var (name, number) in new[]
                 {
                     ("stickiness", dto.Overview.StickinessPct),
                     ("voice share", dto.Overview.VoiceSharePct),
                     ("logs corrected %", dto.Quality.LogsCorrectedPct),
                     ("logs per active farm per week", dto.Engagement.LogsPerActiveFarmPerWeek),
                     ("voice parse success", dto.Quality.VoiceRecordingsSavedPct),
                 })
        {
            number.Current.Value.Should().BeNull(name);
            number.Current.NotMeasuredReason.Should().Be(DenominatorZero, name);
            number.Previous.NotMeasuredReason.Should().Be(DenominatorZero, name + " (previous)");
        }
    }

    [Fact]
    public void A_true_zero_is_a_measured_zero()
    {
        var rows = new Seed().Farm(G(1), G(101)).Build();

        var dto = Compute(rows, D(11, 10), D(11, 13));

        dto.FarmsListed.Should().Be(1);
        dto.FarmsNotReadable.Should().Be(0);
        dto.Overview.LogsRecorded.Current.Should().Be(new MisValueDto(0m, null));
        dto.Overview.LogsRecorded.Previous.Should().Be(new MisValueDto(0m, null));
        Measured(dto.Overview.VoiceLogs).Should().Be(0);
        Measured(dto.Overview.ActiveFarms).Should().Be(0);
        Measured(dto.Overview.Dau).Should().Be(0);
        Measured(dto.Overview.SignUps).Should().Be(0);
        Measured(dto.Quality.VoiceRecordings).Should().Be(0);
        Measured(dto.Quality.LogsCorrected).Should().Be(0);
        Measured(dto.Farms.FarmsRegistered).Should().Be(1);
        Measured(dto.Retention.NeverLoggedFarms).Should().Be(1);
    }

    [Fact]
    public void An_unreadable_farm_list_is_not_measured_not_zero()
    {
        var farm = G(1);
        var owner = G(101);
        var rows = new Seed()
            .Farm(farm, owner)
            .Member(farm, owner, "PrimaryOwner")
            .Plot(farm, 1m)
            .Entry(farm, owner, Ist(11, 12))
            .User(owner, Ist(11, 11))
            .Build(notReadable: 1);

        var dto = Compute(rows, D(11, 10), D(11, 13));

        dto.FarmsNotReadable.Should().Be(1);
        dto.FarmsListed.Should().Be(2);
        AssertFarmNumbersBlocked(dto, FarmListUnreadable);
    }

    [Fact]
    public void An_empty_farm_list_is_not_measured_not_zero()
    {
        var someone = G(101);
        var rows = new Seed().User(someone, Ist(11, 11)).Build();

        var dto = Compute(rows, D(11, 10), D(11, 13));

        dto.FarmsListed.Should().Be(0);
        AssertFarmNumbersBlocked(dto, FarmListUnreadable);
    }

    [Fact]
    public void More_farms_than_the_live_ceiling_is_not_measured_never_slow_or_zero()
    {
        // Amendment A1: above the ceiling the reader reads no per-farm rows and says so.
        var someone = G(101);
        var rows = new Seed().User(someone, Ist(11, 11)).Build(listed: 501, liveCountSkipped: true);

        var dto = Compute(rows, D(11, 10), D(11, 13));

        dto.FarmsListed.Should().Be(501);
        AssertFarmNumbersBlocked(dto, TooManyFarms);
    }

    [Fact]
    public void Sign_ups_by_day_stay_measured_when_farm_numbers_are_not()
    {
        // Amendment A6.
        var rows = new Seed()
            .User(G(101), Ist(11, 10, 9))
            .User(G(102), Ist(11, 10, 20))
            .User(G(103), new DateTime(2026, 11, 11, 19, 0, 0, DateTimeKind.Utc)) // 00:30 IST 12 Nov
            .Build(notReadable: 1);

        var dto = Compute(rows, D(11, 10), D(11, 12));

        Measured(dto.Overview.SignUps).Should().Be(3);
        dto.Overview.SignUpsByDay.Should().NotBeEmpty("an empty series beside a measured total would read as no sign-ups");
        dto.Overview.SignUpsByDay.Where(p => p.Value > 0).Should().BeEquivalentTo(new[]
        {
            new MisDayPointDto(D(11, 10), 2),
            new MisDayPointDto(D(11, 12), 1),
        });
        dto.Overview.SignUpsByDay.Sum(p => p.Value).Should().Be(3);
        dto.Overview.ActivePeopleByDay.Should().BeEmpty();
    }

    // ------------------------------------------------------------------
    // Retention windows
    // ------------------------------------------------------------------

    [Fact]
    public void Retention_counts_only_complete_days()
    {
        var farm = G(1);
        var newcomer = G(101);
        var rows = new Seed()
            .Farm(farm, newcomer)
            .Entry(farm, newcomer, Ist(11, 14, 9))
            .User(newcomer, Ist(11, 14, 8))  // verified today
            .Build();

        var dto = Compute(rows, D(11, 14), D(11, 14));

        Measured(dto.Acquisition.Verified).Should().Be(1);
        dto.Retention.D1Pct.Current.Should().Be(new MisValueDto(null, NoCompleteWindow), "15 Nov is not complete yet");
        dto.Retention.D30Pct.Current.Should().Be(new MisValueDto(null, NoCompleteWindow));
        dto.Retention.Curve.Should().HaveCount(31);
        dto.Retention.Curve.Select(c => c.Day).Should().BeEquivalentTo(Enumerable.Range(0, 31));
        dto.Retention.Curve.Should().OnlyContain(c => c.Eligible == 0 && c.ActivePct == null,
            "even day 0 (today) is not complete");
    }

    [Fact]
    public void Day_one_and_day_thirty_return_and_the_curve_count_eligible_people()
    {
        // Rows 19, 20 and 24 (no test of their own in the plan's list).
        var farm = G(1);
        var u1 = G(101);
        var u2 = G(102);
        var u3 = G(103);
        var u4 = G(104);
        var rows = new Seed()
            .Farm(farm, u1, Ist(9, 1))
            .User(u1, Ist(10, 1))
            .User(u2, Ist(10, 10))
            .User(u3, Ist(11, 13, 9))
            .User(u4, Ist(10, 20))
            .Entry(farm, u1, Ist(10, 2))                                              // u1 day 1
            .Entry(farm, u1, Ist(10, 31))                                             // u1 day 30
            .Entry(farm, u2, new DateTime(2026, 11, 8, 19, 0, 0, DateTimeKind.Utc))  // 00:30 IST 9 Nov = u2 day 30
            .Entry(farm, u3, Ist(11, 13, 10))                                         // u3 day 0
            .Build();

        var dto = Compute(rows, D(10, 1), D(11, 13));

        // D1: eligible u1, u2, u4 (u3's day 1 is 14 Nov, not complete); active u1 -> 1/3.
        Measured(dto.Retention.D1Pct).Should().Be(33.3m);
        // D30: eligible u1 (31 Oct) and u2 (9 Nov); u4's day 30 is 19 Nov. Both active.
        Measured(dto.Retention.D30Pct).Should().Be(100.0m);

        var curve = dto.Retention.Curve.ToDictionary(c => c.Day);
        curve.Should().HaveCount(31);
        curve[0].Should().Be(new MisCurvePointDto(0, 25.0m, 4), "all four have a complete day 0; only u3 saved on it");
        curve[1].Should().Be(new MisCurvePointDto(1, 33.3m, 3));
        curve[30].Should().Be(new MisCurvePointDto(30, 100.0m, 2));
    }

    [Fact]
    public void Active_farm_means_an_entry_in_the_trailing_7_days()
    {
        var a = G(1);
        var b = G(2);
        var rows = new Seed()
            .Farm(a, G(101)).Farm(b, G(102))
            .Entry(a, G(101), Ist(11, 7))   // to - 6
            .Entry(b, G(102), Ist(11, 6))   // to - 7
            .Build();

        var dto = Compute(rows, D(11, 13), D(11, 13));

        Measured(dto.Overview.ActiveFarms).Should().Be(1, "an entry on to-6 counts, one on to-7 does not");
        Measured(dto.Farms.ActiveFarms).Should().Be(1, "Farms page active farms is the same number (row 33)");
    }

    [Fact]
    public void Active_person_means_someone_who_saved_an_entry()
    {
        var farm = G(1);
        var owner = G(101);
        var idleWorker = G(102);
        var rows = new Seed()
            .Farm(farm, owner)
            .Member(farm, owner, "PrimaryOwner")
            .Member(farm, idleWorker, "Worker")
            .Entry(farm, owner, Ist(11, 13))
            .Build();

        var dto = Compute(rows, D(11, 13), D(11, 13));

        Measured(dto.Overview.Dau).Should().Be(1, "a member with no entry is not active");
        Measured(dto.Overview.Wau).Should().Be(1);
        Measured(dto.Overview.Mau).Should().Be(1);
        dto.Engagement.RoleMixOfMau.Sum(r => r.People).Should().Be(1);
    }

    [Fact]
    public void Dau_wau_mau_stickiness_and_people_by_day()
    {
        // Rows 3 to 6 and amendment A7.
        var farm = G(1);
        var a = G(101);
        var b = G(102);
        var c = G(103);
        var d = G(104);
        var rows = new Seed()
            .Farm(farm, a, Ist(9, 1))
            .Entry(farm, a, Ist(11, 13))
            .Entry(farm, a, Ist(11, 11))
            .Entry(farm, b, Ist(11, 11, 9))
            .Entry(farm, b, Ist(11, 11, 15))
            .Entry(farm, b, Ist(11, 10))
            .Entry(farm, c, Ist(10, 20))
            .Entry(farm, d, Ist(10, 13))   // outside W30(13 Nov) = 15 Oct..13 Nov
            .Build();

        var dto = Compute(rows, D(11, 11), D(11, 13));

        Measured(dto.Overview.Dau).Should().Be(1);
        Measured(dto.Overview.Wau).Should().Be(2);
        Measured(dto.Overview.Mau).Should().Be(3);
        Measured(dto.Overview.StickinessPct).Should().Be(33.3m);
        dto.Overview.ActivePeopleByDay.Should().BeEquivalentTo(new[]
        {
            new MisDayPointDto(D(11, 11), 2),
            new MisDayPointDto(D(11, 12), 0),
            new MisDayPointDto(D(11, 13), 1),
        }, "one point per day of P: distinct people who saved that day");
    }

    // ------------------------------------------------------------------
    // Voice
    // ------------------------------------------------------------------

    [Fact]
    public void Voice_share_reads_the_entry_source_only()
    {
        var farm = G(1);
        var owner = G(101);
        var linkedJob = G(501);
        var unsavedJob = G(502);
        var rows = new Seed()
            .Farm(farm, owner)
            .Entry(farm, owner, Ist(11, 11), voice: true, job: linkedJob)
            .Entry(farm, owner, Ist(11, 12), voice: false)
            .Entry(farm, owner, Ist(11, 13), voice: false, job: unsavedJob) // a job link alone does not make it voice
            .Job(linkedJob, farm, owner, Ist(11, 11), "Succeeded", 400)
            .Job(unsavedJob, farm, owner, Ist(11, 13), "Succeeded", 400)
            .Job(G(503), farm, owner, Ist(11, 13), "Succeeded", 400)
            .Build();

        var dto = Compute(rows, D(11, 10), D(11, 13));

        Measured(dto.Overview.LogsRecorded).Should().Be(3);
        Measured(dto.Overview.VoiceLogs).Should().Be(1, "voice = the entry's own source is voice");
        Measured(dto.Overview.VoiceSharePct).Should().Be(33.3m);
    }

    [Fact]
    public void Voice_parse_success_counts_jobs_an_entry_saved()
    {
        // Row 28 (no test of its own in the plan's list).
        var farm = G(1);
        var owner = G(101);
        var j1 = G(501); var j2 = G(502); var j3 = G(503); var j4 = G(504); var j5 = G(505); var j6 = G(506);
        var rows = new Seed()
            .Farm(farm, owner)
            .Job(j1, farm, owner, Ist(11, 11), "Succeeded")
            .Job(j2, farm, owner, Ist(11, 11), "FallbackSucceeded")
            .Job(j3, farm, owner, Ist(11, 12), "Failed")
            .Job(j4, farm, owner, Ist(11, 12), "Running")                                       // not a finished job
            .Job(j5, farm, owner, Ist(11, 9, 23), "Succeeded")                                  // before P
            .Job(j6, farm, owner, new DateTime(2026, 11, 9, 19, 0, 0, DateTimeKind.Utc), "Succeeded") // 00:30 IST 10 Nov
            .Entry(farm, owner, Ist(11, 11), voice: true, job: j1)
            .Entry(farm, owner, Ist(11, 12), voice: true, job: j4)
            .Entry(farm, owner, Ist(11, 10), voice: true, job: j5)
            .Entry(farm, owner, Ist(11, 10), voice: true, job: j6)
            .Build();

        var dto = Compute(rows, D(11, 10), D(11, 13));

        Measured(dto.Quality.VoiceRecordings).Should().Be(4, "j1, j2, j3, j6: finished voice jobs created in P");
        Measured(dto.Quality.VoiceRecordingsSavedPct).Should().Be(50.0m, "j1 and j6 are referenced by an entry");
    }

    [Fact]
    public void P95_is_nearest_rank_and_no_samples_is_not_measured()
    {
        var farm = G(1);
        var owner = G(101);
        var seed = new Seed().Farm(farm, owner);
        // 20 successful latencies 100, 200, ... 2000 spread over 10 finished jobs.
        for (var i = 0; i < 10; i++)
        {
            seed.Job(G(600 + i), farm, owner, Ist(11, 11), "Succeeded", (2 * i + 1) * 100, (2 * i + 2) * 100);
        }
        seed.Job(G(650), farm, owner, Ist(11, 11), "Running", 99_999);   // not a finished job: not a sample
        var dto = Compute(seed.Build(), D(11, 10), D(11, 13));

        Measured(dto.Quality.TranscriptionAvgMs).Should().Be(1050m);
        Measured(dto.Quality.TranscriptionP95Ms).Should().Be(1900m, "nearest rank: ceil(0.95 x 20) = 19th smallest");
        dto.Quality.TranscriptionAvgMs.Previous.Should().Be(new MisValueDto(null, NoSamples));
        dto.Quality.TranscriptionP95Ms.Previous.Should().Be(new MisValueDto(null, NoSamples));

        // A finished job with no successful attempt is a job but not a sample.
        var noSamples = new Seed().Farm(farm, owner).Job(G(700), farm, owner, Ist(11, 11), "Failed").Build();
        var empty = Compute(noSamples, D(11, 10), D(11, 13));
        Measured(empty.Quality.VoiceRecordings).Should().Be(1);
        empty.Quality.TranscriptionAvgMs.Current.Should().Be(new MisValueDto(null, NoSamples));
        empty.Quality.TranscriptionP95Ms.Current.Should().Be(new MisValueDto(null, NoSamples));
    }

    // ------------------------------------------------------------------
    // Acquisition
    // ------------------------------------------------------------------

    [Fact]
    public void Habit_needs_three_india_days_in_the_first_seven()
    {
        var farm = G(1);
        var u1 = G(101); var u2 = G(102); var u3 = G(103); var u4 = G(104);
        var rows = new Seed()
            .Farm(farm, u1, Ist(9, 1))
            .User(u1, Ist(11, 1, 8)).User(u2, Ist(11, 1, 8)).User(u3, Ist(11, 1, 8))
            .User(u4, Ist(11, 10, 8))
            // u1: 1, 3 and 7 Nov (7 Nov at 23:30 India time) -> 3 days
            .Entry(farm, u1, Ist(11, 1)).Entry(farm, u1, Ist(11, 3))
            .Entry(farm, u1, new DateTime(2026, 11, 7, 18, 0, 0, DateTimeKind.Utc))
            // u2: 2 Nov twice and 5 Nov -> 2 days
            .Entry(farm, u2, Ist(11, 2, 9)).Entry(farm, u2, Ist(11, 2, 17)).Entry(farm, u2, Ist(11, 5))
            // u3: 1 and 2 Nov, then 00:30 India time on 8 Nov (7 Nov in UTC) = day 7, outside day0..day0+6
            .Entry(farm, u3, Ist(11, 1)).Entry(farm, u3, Ist(11, 2))
            .Entry(farm, u3, new DateTime(2026, 11, 7, 19, 0, 0, DateTimeKind.Utc))
            // u4: three days, but day0+6 = 16 Nov is not complete
            .Entry(farm, u4, Ist(11, 10)).Entry(farm, u4, Ist(11, 11)).Entry(farm, u4, Ist(11, 12))
            .Build();

        var dto = Compute(rows, D(11, 1), D(11, 13));

        Measured(dto.Acquisition.HabitEligible).Should().Be(3, "u4's first week is not complete");
        Measured(dto.Acquisition.Habit).Should().Be(1, "only u1 saved on three India days of the first seven");
        Measured(dto.Acquisition.FirstLog).Should().Be(4);
    }

    [Fact]
    public void Has_a_farm_means_owning_one_or_an_active_membership()
    {
        // Row 12 (no test of its own in the plan's list).
        var farm = G(1);
        var owner = G(101); var activeMember = G(102); var invited = G(103); var nobody = G(104);
        var rows = new Seed()
            .Farm(farm, owner, Ist(11, 11))
            .Member(farm, activeMember, "Worker", status: 3)
            .Member(farm, invited, "Worker", status: 1)
            .User(owner, Ist(11, 11)).User(activeMember, Ist(11, 11))
            .User(invited, Ist(11, 12)).User(nobody, Ist(11, 12))
            .Build();

        var dto = Compute(rows, D(11, 10), D(11, 13));

        Measured(dto.Acquisition.Verified).Should().Be(4);
        Measured(dto.Acquisition.HasFarm).Should().Be(2, "the owner and the Active (status 3) member");
        Measured(dto.Acquisition.FirstLog).Should().Be(0);
    }

    // ------------------------------------------------------------------
    // Farm bands
    // ------------------------------------------------------------------

    [Fact]
    public void Silent_bands_and_never_logged_partition_the_registered_farms()
    {
        var a = G(1); var b = G(2); var c = G(3); var d = G(4); var e = G(5); var f = G(6); var late = G(7);
        var rows = new Seed()
            .Farm(a, G(101), Ist(10, 1)).Farm(b, G(102), Ist(10, 1)).Farm(c, G(103), Ist(10, 1))
            .Farm(d, G(104), Ist(10, 1)).Farm(e, G(105), Ist(10, 1)).Farm(f, G(106), Ist(10, 1))
            .Farm(late, G(107), Ist(11, 14, 9))           // registered after `to`
            .Entry(a, G(101), Ist(11, 13))                // age 0
            .Entry(b, G(102), Ist(11, 7))                 // age 6
            .Entry(c, G(103), Ist(11, 6))                 // age 7 ...
            .Entry(c, G(103), Ist(11, 14, 9))             // ... an entry after `to` does not change its age at `to`
            .Entry(d, G(104), Ist(10, 15))                // age 29
            .Entry(e, G(105), Ist(10, 14))                // age 30
            .Entry(late, G(107), Ist(11, 14, 10))
            .Build();

        var dto = Compute(rows, D(11, 13), D(11, 13));

        Measured(dto.Farms.FarmsRegistered).Should().Be(6);
        Measured(dto.Retention.ActiveFarms0To6).Should().Be(2);
        Measured(dto.Retention.QuietFarms7To29).Should().Be(2);
        Measured(dto.Retention.SilentFarms30Plus).Should().Be(1);
        Measured(dto.Retention.NeverLoggedFarms).Should().Be(1);
        (Measured(dto.Retention.ActiveFarms0To6) + Measured(dto.Retention.QuietFarms7To29)
            + Measured(dto.Retention.SilentFarms30Plus) + Measured(dto.Retention.NeverLoggedFarms))
            .Should().Be(Measured(dto.Farms.FarmsRegistered), "the four bands partition the registered farms");
    }

    [Fact]
    public void A_farm_that_logged_before_the_loaded_window_is_silent_not_never_logged()
    {
        // Amendment A5: no loaded entry, but the farm's first entry (all time) is long before `to`.
        var farm = G(1);
        var march = new DateTime(2026, 3, 1, 5, 0, 0, DateTimeKind.Utc);
        var rows = new Seed()
            .FarmWithHistory(farm, G(101), Ist(1, 1), firstEntryUtc: march, lastEntryUtc: march)
            .Build();

        var dto = Compute(rows, D(11, 10), D(11, 13));

        Measured(dto.Retention.SilentFarms30Plus).Should().Be(1);
        Measured(dto.Retention.NeverLoggedFarms).Should().Be(0);
        dto.Retention.SilentFarms30Plus.Previous.Value.Should().Be(1);
        dto.Retention.WinBackByDay.Sum(p => p.Value).Should().Be(0, "a farm silent 30+ days is not in the 7..29 band");
    }

    [Fact]
    public void A_farm_with_no_entry_ever_is_never_logged()
    {
        var never = G(1);
        var firstAfterTo = G(2);
        var rows = new Seed()
            .FarmWithHistory(never, G(101), Ist(1, 1), firstEntryUtc: null, lastEntryUtc: null)
            .Farm(firstAfterTo, G(102), Ist(1, 1))
            .Entry(firstAfterTo, G(102), Ist(11, 14, 9))  // its first entry ever is after `to`
            .Build();

        var dto = Compute(rows, D(11, 10), D(11, 13));

        Measured(dto.Retention.NeverLoggedFarms).Should().Be(2);
        Measured(dto.Retention.SilentFarms30Plus).Should().Be(0);
        Measured(dto.Retention.QuietFarms7To29).Should().Be(0);
    }

    [Fact]
    public void Win_back_by_day_uses_the_last_entry_as_of_each_day()
    {
        var a = G(1); var b = G(2); var c = G(3); var d = G(4); var e = G(5);
        var rows = new Seed()
            .Farm(a, G(101), Ist(10, 1)).Farm(b, G(102), Ist(10, 1)).Farm(c, G(103), Ist(11, 11))
            .Farm(d, G(104), Ist(10, 1)).Farm(e, G(105), Ist(10, 1))
            .Entry(a, G(101), Ist(11, 1)).Entry(a, G(101), Ist(11, 11))
            .Entry(b, G(102), Ist(11, 3))
            .Entry(d, G(104), new DateTime(2026, 11, 3, 19, 0, 0, DateTimeKind.Utc)) // 00:30 IST 4 Nov
            .Entry(e, G(105), Ist(10, 13))
            .Build();

        var dto = Compute(rows, D(11, 10), D(11, 12));

        // 10 Nov: a (9), b (7), e (28); d is 6.   11 Nov: b (8), d (7), e (29); a logged that day.
        // 12 Nov: b (9), d (8); e is 30.          c never logged.
        dto.Retention.WinBackByDay.Should().BeEquivalentTo(new[]
        {
            new MisDayPointDto(D(11, 10), 3),
            new MisDayPointDto(D(11, 11), 3),
            new MisDayPointDto(D(11, 12), 2),
        });
    }

    // ------------------------------------------------------------------
    // Engagement
    // ------------------------------------------------------------------

    [Fact]
    public void Role_mix_counts_each_person_once_with_the_stated_tie_rule()
    {
        var f1 = G(1); var f2 = G(2); var f3 = G(3);
        var p1 = G(101); var p2 = G(102); var p3 = G(103); var p4 = G(104); var p5 = G(105);
        var rows = new Seed()
            .Farm(f1, G(901), Ist(9, 1)).Farm(f2, G(902), Ist(9, 1)).Farm(f3, G(903), Ist(9, 1))
            // p1: most entries on f1 -> his role there
            .Member(f1, p1, "Worker").Member(f2, p1, "Mukadam")
            .Entry(f1, p1, Ist(11, 1)).Entry(f1, p1, Ist(11, 2)).Entry(f1, p1, Ist(11, 3)).Entry(f2, p1, Ist(11, 4))
            // p2: 2 and 2; the more recent last entry is on f2
            .Member(f1, p2, "PrimaryOwner").Member(f2, p2, "Worker")
            .Entry(f1, p2, Ist(11, 4)).Entry(f1, p2, Ist(11, 5)).Entry(f2, p2, Ist(11, 9)).Entry(f2, p2, Ist(11, 10))
            // p3: 1 and 1 at the same instant -> SecondaryOwner before Mukadam
            .Member(f1, p3, "SecondaryOwner").Member(f2, p3, "Mukadam")
            .Entry(f1, p3, Ist(11, 8)).Entry(f2, p3, Ist(11, 8))
            // p4: no membership on the farm he saved on
            .Entry(f3, p4, Ist(11, 12))
            // p5: only before W30(13 Nov)
            .Member(f1, p5, "PrimaryOwner").Entry(f1, p5, Ist(10, 1))
            .Build();

        var dto = Compute(rows, D(11, 13), D(11, 13));

        dto.Engagement.RoleMixOfMau.Should().BeEquivalentTo(new[]
        {
            new MisRoleCountDto("Worker", 2),
            new MisRoleCountDto("SecondaryOwner", 1),
            new MisRoleCountDto("Unknown", 1),
        });
        dto.Engagement.RoleMixOfMau.Sum(r => r.People).Should().Be((int)Measured(dto.Overview.Mau));
    }

    [Fact]
    public void Role_mix_reads_only_an_active_membership_on_the_chosen_farm()
    {
        // Amendment A8: no Active (status 3) membership on the chosen farm -> Unknown.
        var f1 = G(1); var f2 = G(2);
        var formerMukadam = G(101); var activeWorker = G(102);
        var rows = new Seed()
            .Farm(f1, G(901), Ist(9, 1)).Farm(f2, G(902), Ist(9, 1))
            // chosen farm f1 (two entries); his membership there is no longer Active (status 4);
            // an Active membership on f2, where he saved less, does not stand in for it.
            .Member(f1, formerMukadam, "Mukadam", status: 4)
            .Member(f2, formerMukadam, "SecondaryOwner", status: 3)
            .Entry(f1, formerMukadam, Ist(11, 10)).Entry(f1, formerMukadam, Ist(11, 11)).Entry(f2, formerMukadam, Ist(11, 9))
            .Member(f1, activeWorker, "Worker", status: 3)
            .Entry(f1, activeWorker, Ist(11, 12))
            .Build();

        var dto = Compute(rows, D(11, 13), D(11, 13));

        dto.Engagement.RoleMixOfMau.Should().BeEquivalentTo(new[]
        {
            new MisRoleCountDto("Unknown", 1),
            new MisRoleCountDto("Worker", 1),
        });
    }

    [Fact]
    public void The_heatmap_always_has_168_cells_in_india_time()
    {
        var farm = G(1);
        var rows = new Seed()
            .Farm(farm, G(101))
            .Entry(farm, G(101), new DateTime(2026, 11, 9, 19, 0, 0, DateTimeKind.Utc))  // Tue 10 Nov 00:30 IST
            .Entry(farm, G(101), new DateTime(2026, 11, 10, 18, 0, 0, DateTimeKind.Utc)) // Tue 10 Nov 23:30 IST
            .Build();

        var dto = Compute(rows, D(11, 9), D(11, 13));
        var cells = dto.Engagement.WhenLogged;

        cells.Should().HaveCount(168);
        cells.Select(c => (c.Weekday, c.Hour)).Distinct().Should().HaveCount(168);
        cells.Should().OnlyContain(c => c.Weekday >= 1 && c.Weekday <= 7 && c.Hour >= 0 && c.Hour <= 23);
        dto.Engagement.WhenLoggedClock.Should().Be("server-arrival");

        var tuesday = IsoWeekday(D(11, 10));
        tuesday.Should().Be(2);
        cells.Single(c => c.Weekday == tuesday && c.Hour == 0).Logs.Should().Be(1);
        cells.Single(c => c.Weekday == tuesday && c.Hour == 23).Logs.Should().Be(1);
        cells.Single(c => c.Weekday == 1 && c.Hour == 19).Logs.Should().Be(0, "Monday 19:00 is the UTC reading");
        cells.Sum(c => c.Logs).Should().Be(2);

        var none = Compute(new Seed().Farm(farm, G(101)).Build(), D(11, 9), D(11, 13));
        none.Engagement.WhenLogged.Should().HaveCount(168, "all 168 cells even with no entry");
        none.Engagement.WhenLogged.Should().OnlyContain(c => c.Logs == 0);
    }

    [Fact]
    public void Logs_by_week_start_on_monday_and_mark_partial_weeks()
    {
        var farm = G(1);
        var op = G(101);
        var rows = new Seed()
            .Farm(farm, op, Ist(9, 1))
            .Entry(farm, op, Ist(10, 27), voice: true)                                            // before P
            .Entry(farm, op, Ist(10, 28))                                                         // week 26 Oct, typed
            .Entry(farm, op, new DateTime(2026, 11, 1, 19, 0, 0, DateTimeKind.Utc), voice: true) // Mon 2 Nov 00:30 IST
            .Entry(farm, op, new DateTime(2026, 11, 8, 18, 0, 0, DateTimeKind.Utc))              // Sun 8 Nov 23:30 IST
            .Entry(farm, op, Ist(11, 9), voice: true)                                             // week 9 Nov
            .Build();

        var dto = Compute(rows, D(10, 28), D(11, 13));

        dto.Overview.LogsByWeek.Should().BeEquivalentTo(new[]
        {
            new MisWeekSplitDto(D(10, 26), Voice: 0, Typed: 1, IsPartial: true),   // cut by P
            new MisWeekSplitDto(D(11, 2), Voice: 1, Typed: 1, IsPartial: false),   // whole and complete
            new MisWeekSplitDto(D(11, 9), Voice: 1, Typed: 0, IsPartial: true),    // cut by P and not complete
        });
    }

    [Fact]
    public void Cohort_weeks_leave_incomplete_weeks_null()
    {
        var farm = G(1);
        var u1 = G(101); var u2 = G(102); var u3 = G(103);
        var rows = new Seed()
            .Farm(farm, u1, Ist(9, 1))
            .User(u1, Ist(10, 27))
            .User(u2, new DateTime(2026, 11, 1, 18, 0, 0, DateTimeKind.Utc))  // Sun 1 Nov 23:30 IST
            .User(u3, new DateTime(2026, 11, 1, 19, 0, 0, DateTimeKind.Utc))  // Mon 2 Nov 00:30 IST: next week
            .Entry(farm, u2, Ist(10, 28))   // week 0 does not count as week 1
            .Entry(farm, u1, Ist(11, 4))    // week 1
            .Entry(farm, u3, Ist(11, 4))
            .Build();

        var dto = Compute(rows, D(10, 26), D(11, 1));

        var row = dto.Retention.CohortByWeek.Should().ContainSingle().Which;
        row.WeekStart.Should().Be(D(10, 26));
        row.People.Should().Be(2, "u3 was verified on 2 Nov in India time");
        row.ActivePctByWeek.Should().Equal(50.0m, null, null, null);
    }

    [Fact]
    public void Logs_per_active_farm_per_week_and_corrections()
    {
        // Rows 15 and 31 (no test of their own in the plan's list).
        var f1 = G(1); var f2 = G(2); var f3 = G(3);
        var rows = new Seed()
            .Farm(f1, G(101), Ist(9, 1)).Farm(f2, G(102), Ist(9, 1)).Farm(f3, G(103), Ist(9, 1))
            .Entry(f1, G(101), Ist(11, 7)).Entry(f1, G(101), Ist(11, 9)).Entry(f1, G(101), Ist(11, 13), version: 2)
            .Entry(f2, G(102), Ist(11, 8)).Entry(f2, G(102), Ist(11, 12)).Entry(f2, G(102), Ist(11, 13))
            .Entry(f3, G(103), Ist(11, 6))
            .Build();

        var dto = Compute(rows, D(11, 13), D(11, 13));

        Measured(dto.Engagement.LogsPerActiveFarmPerWeek).Should().Be(3.0m, "6 entries in W7 over 2 active farms");
        Measured(dto.Quality.LogsCorrected).Should().Be(1);
        Measured(dto.Quality.LogsCorrectedPct).Should().Be(50.0m);
    }

    // ------------------------------------------------------------------
    // Farms page
    // ------------------------------------------------------------------

    [Fact]
    public void Acres_sum_plots_of_active_farms_only()
    {
        var a = G(1); var b = G(2);
        var rows = new Seed()
            .Farm(a, G(101), Ist(9, 1)).Farm(b, G(102), Ist(9, 1))
            .Plot(a, 1.5m).Plot(a, 2.25m).Plot(b, 4m)
            .Entry(a, G(101), Ist(11, 12))
            .Entry(b, G(102), Ist(11, 1))
            .Build();

        var dto = Compute(rows, D(11, 1), D(11, 13));

        Measured(dto.Farms.AcresCovered).Should().Be(3.75m);
        dto.Farms.AcresByWeek.Should().Equal(
            new MisAcresPointDto(D(11, 6), 4m),
            new MisAcresPointDto(D(11, 13), 3.75m));
    }

    [Fact]
    public void Farms_in_an_fpo_count_active_scopes_of_active_fpo_organisations()
    {
        var f1 = G(1); var f2 = G(2); var f3 = G(3); var f4 = G(4); var f5 = G(5); var f6 = G(6);
        var testAccount = G(900);
        var excluded = new HashSet<Guid> { testAccount };
        var rows = new Seed()
            .Farm(f1, G(101), Ist(9, 1)).Farm(f2, G(102), Ist(9, 1)).Farm(f3, G(103), Ist(9, 1))
            .Farm(f4, G(104), Ist(9, 1)).Farm(f5, G(105), Ist(9, 1)).Farm(f6, testAccount, Ist(9, 1))
            .Scope(f1, "Fake FPO Alpha", Ist(11, 1))
            .Scope(f2, "Fake FPO Alpha", Ist(11, 2))
            .Scope(f5, "Fake FPO Alpha", Ist(11, 3))
            .Scope(f1, "Fake FPO Beta", Ist(11, 5))
            .Scope(f3, "Fake FPO Beta", new DateTime(2026, 11, 13, 18, 0, 0, DateTimeKind.Utc))  // 23:30 IST 13 Nov
            .Scope(f4, "Fake FPO Beta", new DateTime(2026, 11, 13, 19, 0, 0, DateTimeKind.Utc))  // 00:30 IST 14 Nov
            .Scope(f6, "Fake FPO Alpha", Ist(11, 1))                                             // test account's farm
            .Build(excluded);

        var dto = Compute(rows, D(11, 10), D(11, 13), excluded);

        Measured(dto.Farms.FarmsInFpo).Should().Be(4, "f1, f2, f3, f5 (f1 counted once)");
        dto.Farms.FarmsPerFpo.Should().Equal(
            new MisFpoRowDto("Fake FPO Alpha", 3),
            new MisFpoRowDto("Fake FPO Beta", 2));
    }

    // ------------------------------------------------------------------
    // Previous period and rounding
    // ------------------------------------------------------------------

    [Fact]
    public void Every_number_has_a_previous_value_by_the_same_rule()
    {
        var f1 = G(1); var f2 = G(2); var f3 = G(3);
        var rows = new Seed()
            .Farm(f1, G(101), Ist(9, 1)).Farm(f2, G(102), Ist(9, 1)).Farm(f3, G(103), Ist(9, 1))
            // P = 7..13 Nov
            .Entry(f1, G(101), Ist(11, 10)).Entry(f1, G(101), Ist(11, 11))
            .Entry(f1, G(101), Ist(11, 12)).Entry(f1, G(101), Ist(11, 13))
            // Q = 31 Oct..6 Nov
            .Entry(f2, G(102), Ist(11, 1), voice: true).Entry(f2, G(102), Ist(11, 5)).Entry(f3, G(103), Ist(11, 3))
            .User(G(201), Ist(11, 8)).User(G(202), Ist(11, 2)).User(G(203), Ist(10, 31))
            .Build();

        var dto = CompanyMisCalculator.Compute(
            rows, CompanyMisExclusions.None, D(11, 7), D(11, 13), D(10, 31), D(11, 6), CountedAt);
        AssertEveryNumberIsHonest(dto);

        dto.Range.Should().Be(new MisRangeDto(D(11, 7), D(11, 13), 7));
        dto.PreviousRange.Should().Be(new MisRangeDto(D(10, 31), D(11, 6), 7));
        dto.Overview.LogsRecorded.Should().Be(new MisNumberDto(new MisValueDto(4m, null), new MisValueDto(3m, null)));
        dto.Overview.VoiceLogs.Should().Be(new MisNumberDto(new MisValueDto(0m, null), new MisValueDto(1m, null)));
        dto.Overview.VoiceSharePct.Should().Be(
            new MisNumberDto(new MisValueDto(0.0m, null), new MisValueDto(33.3m, null)),
            "0 of 4 is a measured 0%; 1 of 3 is 33.3%");
        dto.Overview.ActiveFarms.Should().Be(
            new MisNumberDto(new MisValueDto(1m, null), new MisValueDto(2m, null)),
            "at 13 Nov only f1; at 6 Nov f2 (5 Nov) and f3 (3 Nov)");
        dto.Overview.SignUps.Should().Be(new MisNumberDto(new MisValueDto(1m, null), new MisValueDto(2m, null)));
        dto.Farms.FarmsRegistered.Should().Be(new MisNumberDto(new MisValueDto(3m, null), new MisValueDto(3m, null)));
    }

    [Fact]
    public void Percentages_round_to_one_decimal_away_from_zero()
    {
        var farm = G(1);
        var op = G(101);
        var seed = new Seed().Farm(farm, op, Ist(9, 1));
        // 16 entries in P: 1 by voice (6.25% -> 6.3), 5 corrected (31.25% -> 31.3).
        for (var i = 0; i < 16; i++)
        {
            seed.Entry(farm, op, Ist(11, 10, 1 + i % 20, 0).AddMinutes(i), voice: i == 0, version: i < 5 ? 2 : 1);
        }

        var dto = Compute(seed.Build(), D(11, 10), D(11, 13));

        Measured(dto.Overview.VoiceSharePct).Should().Be(6.3m, "6.25 rounds away from zero, not to even (6.2)");
        Measured(dto.Quality.LogsCorrectedPct).Should().Be(31.3m, "31.25 rounds away from zero, not to even (31.2)");
    }

    // ------------------------------------------------------------------
    // Harness
    // ------------------------------------------------------------------

    private static DateOnly D(int month, int day) => new(2026, month, day);

    /// <summary>A UTC instant given as an India-time wall clock in 2026.</summary>
    private static DateTime Ist(int month, int day, int hour = 10, int minute = 0) =>
        new DateTime(2026, month, day, hour, minute, 0, DateTimeKind.Utc) - IstOffset;

    private static Guid G(int n) => Guid.Parse($"c2a00000-0000-0000-0000-{n:D12}");

    private static int IsoWeekday(DateOnly day) => day.DayOfWeek == DayOfWeek.Sunday ? 7 : (int)day.DayOfWeek;

    /// <summary>Computes with the previous period the plan defines: same length, ending the day before `from`.</summary>
    private static CompanyMisDto Compute(
        CompanyMisRows rows, DateOnly from, DateOnly to, IReadOnlySet<Guid>? excluded = null)
    {
        var length = to.DayNumber - from.DayNumber + 1;
        var previousTo = from.AddDays(-1);
        var previousFrom = previousTo.AddDays(-(length - 1));
        var dto = CompanyMisCalculator.Compute(
            rows, new CompanyMisExclusions(excluded ?? new HashSet<Guid>()), from, to, previousFrom, previousTo, CountedAt);
        AssertEveryNumberIsHonest(dto);
        return dto;
    }

    /// <summary>The current value, asserted to be measured (no reason).</summary>
    private static decimal Measured(MisNumberDto number)
    {
        number.Current.NotMeasuredReason.Should().BeNull("this number is measured here");
        number.Current.Value.Should().NotBeNull();
        return number.Current.Value!.Value;
    }

    /// <summary>
    /// Doctrine P4 on every number of the answer: Value is null exactly when a
    /// reason is given, for the current and the previous value.
    /// </summary>
    private static void AssertEveryNumberIsHonest(CompanyMisDto dto)
    {
        foreach (var section in new object[] { dto.Overview, dto.Acquisition, dto.Engagement, dto.Retention, dto.Quality, dto.Farms })
        {
            foreach (var prop in section.GetType().GetProperties(BindingFlags.Public | BindingFlags.Instance)
                         .Where(p => p.PropertyType == typeof(MisNumberDto)))
            {
                var number = (MisNumberDto)prop.GetValue(section)!;
                number.Should().NotBeNull(prop.Name);
                foreach (var (which, value) in new[] { ("current", number.Current), ("previous", number.Previous) })
                {
                    value.Should().NotBeNull($"{prop.Name} {which}");
                    (value.Value is null).Should().Be(value.NotMeasuredReason is not null,
                        $"{section.GetType().Name}.{prop.Name} {which}: value is null exactly when a reason is given");
                }
            }
        }

        dto.TimeZone.Should().Be("Asia/Kolkata");
        dto.CountedAtUtc.Should().Be(CountedAt);
        dto.Engagement.WhenLoggedClock.Should().Be("server-arrival");
    }

    /// <summary>
    /// Farm list unreadable / empty / above the ceiling: every log-, farm- and
    /// AI-derived number carries the reason, every such series is empty; the
    /// sign-up numbers (public.users) stay measured, sign-ups by day too (A6).
    /// </summary>
    private static void AssertFarmNumbersBlocked(CompanyMisDto dto, string reason)
    {
        var blocked = new (string Name, MisNumberDto Number)[]
        {
            ("overview.activeFarms", dto.Overview.ActiveFarms),
            ("overview.dau", dto.Overview.Dau),
            ("overview.wau", dto.Overview.Wau),
            ("overview.mau", dto.Overview.Mau),
            ("overview.stickinessPct", dto.Overview.StickinessPct),
            ("overview.logsRecorded", dto.Overview.LogsRecorded),
            ("overview.voiceLogs", dto.Overview.VoiceLogs),
            ("overview.voiceSharePct", dto.Overview.VoiceSharePct),
            ("acquisition.hasFarm", dto.Acquisition.HasFarm),
            ("acquisition.firstLog", dto.Acquisition.FirstLog),
            ("acquisition.habit", dto.Acquisition.Habit),
            ("engagement.logsPerActiveFarmPerWeek", dto.Engagement.LogsPerActiveFarmPerWeek),
            ("retention.d1Pct", dto.Retention.D1Pct),
            ("retention.d30Pct", dto.Retention.D30Pct),
            ("retention.activeFarms0To6", dto.Retention.ActiveFarms0To6),
            ("retention.quietFarms7To29", dto.Retention.QuietFarms7To29),
            ("retention.silentFarms30Plus", dto.Retention.SilentFarms30Plus),
            ("retention.neverLoggedFarms", dto.Retention.NeverLoggedFarms),
            ("quality.voiceRecordings", dto.Quality.VoiceRecordings),
            ("quality.voiceRecordingsSavedPct", dto.Quality.VoiceRecordingsSavedPct),
            ("quality.transcriptionAvgMs", dto.Quality.TranscriptionAvgMs),
            ("quality.transcriptionP95Ms", dto.Quality.TranscriptionP95Ms),
            ("quality.logsCorrected", dto.Quality.LogsCorrected),
            ("quality.logsCorrectedPct", dto.Quality.LogsCorrectedPct),
            ("farms.activeFarms", dto.Farms.ActiveFarms),
            ("farms.farmsRegistered", dto.Farms.FarmsRegistered),
            ("farms.acresCovered", dto.Farms.AcresCovered),
            ("farms.farmsInFpo", dto.Farms.FarmsInFpo),
        };

        foreach (var (name, number) in blocked)
        {
            number.Current.Should().Be(new MisValueDto(null, reason), name);
            number.Previous.Should().Be(new MisValueDto(null, reason), name + " (previous)");
        }

        dto.Overview.ActivePeopleByDay.Should().BeEmpty();
        dto.Overview.LogsByWeek.Should().BeEmpty();
        dto.Engagement.RoleMixOfMau.Should().BeEmpty();
        dto.Retention.CohortByWeek.Should().BeEmpty();
        dto.Retention.Curve.Should().BeEmpty();
        dto.Retention.WinBackByDay.Should().BeEmpty();
        dto.Farms.FarmsPerFpo.Should().BeEmpty();
        dto.Farms.AcresByWeek.Should().BeEmpty();

        Measured(dto.Overview.SignUps).Should().Be(1, "sign-ups come from public.users and stay measured");
        Measured(dto.Acquisition.Verified).Should().Be(1);
        dto.Overview.SignUpsByDay.Should().NotBeEmpty("amendment A6");
        dto.Overview.SignUpsByDay.Sum(p => p.Value).Should().Be(1);
    }

    /// <summary>Hand-built reader rows.</summary>
    private sealed class Seed
    {
        private readonly List<(Guid Id, Guid Owner, DateTime Created, bool Fixed, DateTime? First, DateTime? Last)> _farms = new();
        private readonly List<MisEntryRow> _entries = new();
        private readonly List<MisMembershipRow> _members = new();
        private readonly List<MisPlotRow> _plots = new();
        private readonly List<MisVoiceJobRow> _jobs = new();
        private readonly List<MisUserRow> _users = new();
        private readonly List<MisFpoScopeRow> _scopes = new();

        public Seed Farm(Guid id, Guid owner, DateTime? createdUtc = null)
        {
            _farms.Add((id, owner, createdUtc ?? Ist(1, 1), false, null, null));
            return this;
        }

        public Seed FarmWithHistory(Guid id, Guid owner, DateTime createdUtc, DateTime? firstEntryUtc, DateTime? lastEntryUtc)
        {
            _farms.Add((id, owner, createdUtc, true, firstEntryUtc, lastEntryUtc));
            return this;
        }

        public Seed Entry(Guid farm, Guid op, DateTime utc, bool voice = false, int version = 1, Guid? job = null)
        {
            _entries.Add(new MisEntryRow(farm, op, utc, voice, version, job));
            return this;
        }

        public Seed Member(Guid farm, Guid user, string role, int status = 3)
        {
            _members.Add(new MisMembershipRow(farm, user, role, status));
            return this;
        }

        public Seed Plot(Guid farm, decimal acres)
        {
            _plots.Add(new MisPlotRow(farm, acres));
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

        public Seed Scope(Guid farm, string org, DateTime grantedUtc)
        {
            _scopes.Add(new MisFpoScopeRow(farm, org, grantedUtc));
            return this;
        }

        public CompanyMisRows Build(
            IReadOnlySet<Guid>? excluded = null, int notReadable = 0, int? listed = null, bool liveCountSkipped = false)
        {
            excluded ??= new HashSet<Guid>();
            var farms = _farms.Select(f =>
            {
                if (f.Fixed)
                {
                    return new MisFarmRow(f.Id, f.Owner, f.Created, f.Last, f.First);
                }

                var own = _entries
                    .Where(e => e.FarmId == f.Id && e.CreatedAtUtc < CountedAt && !excluded.Contains(e.OperatorUserId))
                    .Select(e => e.CreatedAtUtc)
                    .ToList();
                return new MisFarmRow(
                    f.Id, f.Owner, f.Created,
                    own.Count == 0 ? null : own.Max(),
                    own.Count == 0 ? null : own.Min());
            }).ToList();

            if (liveCountSkipped)
            {
                return new CompanyMisRows(
                    listed ?? 0, 0, Array.Empty<MisFarmRow>(), Array.Empty<MisEntryRow>(),
                    Array.Empty<MisMembershipRow>(), Array.Empty<MisPlotRow>(), Array.Empty<MisVoiceJobRow>(),
                    _users, _scopes, LiveCountSkipped: true);
            }

            return new CompanyMisRows(
                listed ?? farms.Count + notReadable, notReadable, farms, _entries, _members, _plots, _jobs, _users,
                _scopes);
        }
    }
}
