// spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, Task 5 as replaced by C29; C30; Review Focus 4)
//
// The two live alert checks as pure code, written by the test-writer from the plan only:
//   - R9: api.error rows in the 60 minutes before the request; a breach when MORE than 30
//   - R10: voice jobs created in the 6 hours before the request that have FINISHED (Succeeded,
//     FallbackSucceeded, Failed); fewer than 5 finished is "not judged" (never clear); a breach when MORE than
//     20 percent failed; jobs started by a test account and jobs on a farm owned by one are left out
//   - the voice-check handler refuses a caller who is not a platform admin before anything is read, and a failed
//     read escapes (never an answer that reads as clear)
// Fixed instant: 06:30 UTC on 14 Nov 2026. Made-up GUIDs only.

using AgriSync.BuildingBlocks.Results;
using FluentAssertions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Admin.GetCompanyMis;
using ShramSafal.Application.UseCases.Admin.GetOpsHealth;
using Xunit;

namespace ShramSafal.Domain.Tests.Admin;

public sealed class LiveAlertRulesTests
{
    private static readonly DateTime Now = new(2026, 11, 14, 6, 30, 0, DateTimeKind.Utc);
    private static readonly DateTime WindowStart = Now.AddHours(-6);
    private static readonly Guid AdminUser = Guid.Parse("99999999-0000-0000-0000-0000000c2e05");
    private static readonly Guid TestAccount = Guid.Parse("c2e50000-0000-0000-0000-0000000009aa");

    // ── R9 ───────────────────────────────────────────────────────────────────

    [Fact]
    public void Thirty_one_errors_in_an_hour_is_a_breach()
    {
        var start = Now.AddMinutes(-60);

        var check = LiveAlertRules.ApiErrors(31, start, Now);

        check.Rule.Should().Be("R9");
        check.State.Should().Be("breach");
        check.Counted.Should().Be(31);
        check.OutOf.Should().BeNull("R9 has no denominator");
        check.WindowStartUtc.Should().Be(start);
        check.WindowEndUtc.Should().Be(Now);
        check.Reason.Should().BeNull("a judged check has no reason");
    }

    [Fact]
    public void Thirty_is_clear()
    {
        var check = LiveAlertRules.ApiErrors(30, Now.AddMinutes(-60), Now);

        check.State.Should().Be("clear", "exactly 30 is not MORE than 30");
        check.Counted.Should().Be(30);
        LiveAlertRules.ApiErrors(0, Now.AddMinutes(-60), Now).State.Should().Be("clear");
    }

    // ── R10 ──────────────────────────────────────────────────────────────────

    /// <summary>Review Focus 4: two recordings, one failed, is neither "voice failing" nor "clear".</summary>
    [Fact]
    public void Too_few_recordings_is_not_judged()
    {
        var farm = Farm(1);

        var two = LiveAlertRules.VoiceRecordings(
            Rows(new[] { FarmRow(farm, Owner(1)) }, Jobs(farm, Owner(1), succeeded: 1, failed: 1)),
            NoExclusions, WindowStart, Now);
        two.State.Should().Be("not_judged");
        two.Reason.Should().Be("too_few_recordings");

        var fourAllFailed = LiveAlertRules.VoiceRecordings(
            Rows(new[] { FarmRow(farm, Owner(1)) }, Jobs(farm, Owner(1), succeeded: 0, failed: 4)),
            NoExclusions, WindowStart, Now);
        fourAllFailed.State.Should().Be("not_judged", "four finished is too few, even when every one failed");
        fourAllFailed.Reason.Should().Be("too_few_recordings");

        var noJobs = LiveAlertRules.VoiceRecordings(
            Rows(new[] { FarmRow(farm, Owner(1)) }, Array.Empty<MisVoiceJobRow>()), NoExclusions, WindowStart, Now);
        noJobs.State.Should().Be("not_judged", "a quiet six hours is not clear");

        // Jobs that have not finished do not count toward the five.
        var unfinished = Jobs(farm, Owner(1), succeeded: 4, failed: 0)
            .Concat(new[]
            {
                Job(100, farm, Owner(1), Now.AddHours(-1), "Queued"),
                Job(101, farm, Owner(1), Now.AddHours(-1), "Running"),
            }).ToList();
        LiveAlertRules.VoiceRecordings(Rows(new[] { FarmRow(farm, Owner(1)) }, unfinished), NoExclusions, WindowStart, Now)
            .State.Should().Be("not_judged", "queued and running jobs have not finished");

        // The control: five finished is judged.
        var five = LiveAlertRules.VoiceRecordings(
            Rows(new[] { FarmRow(farm, Owner(1)) }, Jobs(farm, Owner(1), succeeded: 4, failed: 1)),
            NoExclusions, WindowStart, Now);
        five.State.Should().Be("clear", "five finished, one failed is 20 percent: judged, and clear");
        five.Reason.Should().BeNull();
    }

    [Fact]
    public void Two_failed_of_ten_is_clear_three_is_a_breach()
    {
        var farm = Farm(1);
        var farms = new[] { FarmRow(farm, Owner(1)) };

        var twoOfTen = LiveAlertRules.VoiceRecordings(
            Rows(farms, Jobs(farm, Owner(1), succeeded: 8, failed: 2)), NoExclusions, WindowStart, Now);
        twoOfTen.State.Should().Be("clear", "exactly 20 percent is not over 20 percent");
        twoOfTen.Counted.Should().Be(2);
        twoOfTen.OutOf.Should().Be(10);

        var threeOfTen = LiveAlertRules.VoiceRecordings(
            Rows(farms, Jobs(farm, Owner(1), succeeded: 7, failed: 3)), NoExclusions, WindowStart, Now);
        threeOfTen.State.Should().Be("breach");
        threeOfTen.Rule.Should().Be("R10");
        threeOfTen.Counted.Should().Be(3);
        threeOfTen.OutOf.Should().Be(10);
        threeOfTen.WindowStartUtc.Should().Be(WindowStart);
        threeOfTen.WindowEndUtc.Should().Be(Now);

        // A fallback success is a success, not a failure.
        var fallbacks = Jobs(farm, Owner(1), succeeded: 7, failed: 2)
            .Concat(new[] { Job(200, farm, Owner(1), Now.AddHours(-2), "FallbackSucceeded") }).ToList();
        var fallback = LiveAlertRules.VoiceRecordings(Rows(farms, fallbacks), NoExclusions, WindowStart, Now);
        fallback.Counted.Should().Be(2);
        fallback.OutOf.Should().Be(10);
        fallback.State.Should().Be("clear");
    }

    [Fact]
    public void A_test_accounts_recording_is_not_counted()
    {
        var realFarm = Farm(1);
        var testFarm = Farm(2);
        var farms = new[] { FarmRow(realFarm, Owner(1)), FarmRow(testFarm, TestAccount) };
        var excluded = new HashSet<Guid> { TestAccount };

        // (a) A job STARTED by a test account, on a real farm: five real successes and five test failures.
        var startedByTest = Jobs(realFarm, Owner(1), succeeded: 5, failed: 0)
            .Concat(Jobs(realFarm, TestAccount, succeeded: 0, failed: 5, firstId: 50)).ToList();
        var a = LiveAlertRules.VoiceRecordings(Rows(farms, startedByTest), excluded, WindowStart, Now);
        a.State.Should().Be("clear", "the five failures were started by a test account");
        a.Counted.Should().Be(0);
        a.OutOf.Should().Be(5);
        LiveAlertRules.VoiceRecordings(Rows(farms, startedByTest), NoExclusions, WindowStart, Now)
            .State.Should().Be("breach", "the control: counted without the exclusion, the same rows are a breach");

        // (b) A job on a farm OWNED by a test account, started by a real person.
        var onTestFarm = Jobs(realFarm, Owner(1), succeeded: 5, failed: 0)
            .Concat(Jobs(testFarm, Owner(2), succeeded: 0, failed: 5, firstId: 50)).ToList();
        var b = LiveAlertRules.VoiceRecordings(Rows(farms, onTestFarm), excluded, WindowStart, Now);
        b.State.Should().Be("clear", "the failures are on a farm owned by a test account");
        b.Counted.Should().Be(0);
        b.OutOf.Should().Be(5);
        LiveAlertRules.VoiceRecordings(Rows(farms, onTestFarm), NoExclusions, WindowStart, Now)
            .State.Should().Be("breach", "the control: counted without the exclusion, the same rows are a breach");

        // Only test-account recordings: nothing left to judge.
        var onlyTest = Jobs(testFarm, TestAccount, succeeded: 3, failed: 7);
        LiveAlertRules.VoiceRecordings(Rows(farms, onlyTest), excluded, WindowStart, Now)
            .State.Should().Be("not_judged");
    }

    [Fact]
    public void Only_recordings_created_in_the_six_hours_are_counted()
    {
        var farm = Farm(1);
        var farms = new[] { FarmRow(farm, Owner(1)) };
        var rows = Jobs(farm, Owner(1), succeeded: 5, failed: 0)
            .Concat(new[]
            {
                Job(300, farm, Owner(1), Now.AddHours(-7), "Failed"),
                Job(301, farm, Owner(1), Now.AddHours(-8), "Failed"),
                Job(302, farm, Owner(1), Now.AddMinutes(1), "Failed"),
            }).ToList();

        var check = LiveAlertRules.VoiceRecordings(Rows(farms, rows), NoExclusions, WindowStart, Now);

        check.OutOf.Should().Be(5, "jobs older than six hours, or created after the counting instant, are not counted");
        check.Counted.Should().Be(0);
        check.State.Should().Be("clear");
    }

    [Fact]
    public void A_list_that_could_not_be_read_is_not_judged_and_never_clear()
    {
        var farm = Farm(1);
        var jobs = Jobs(farm, Owner(1), succeeded: 10, failed: 0);

        var skipped = LiveAlertRules.VoiceRecordings(
            Rows(new[] { FarmRow(farm, Owner(1)) }, jobs) with { LiveCountSkipped = true }, NoExclusions, WindowStart, Now);
        skipped.State.Should().Be("not_judged");
        skipped.Reason.Should().Be("too_many_farms_for_live_count");

        var unreadable = LiveAlertRules.VoiceRecordings(
            Rows(new[] { FarmRow(farm, Owner(1)) }, jobs) with { FarmsNotReadable = 1 }, NoExclusions, WindowStart, Now);
        unreadable.State.Should().Be("not_judged");
        unreadable.Reason.Should().Be("farm_list_unreadable");

        var noFarms = LiveAlertRules.VoiceRecordings(
            Rows(Array.Empty<MisFarmRow>(), Array.Empty<MisVoiceJobRow>()), NoExclusions, WindowStart, Now);
        noFarms.State.Should().Be("not_judged", "a platform with no farm listed is not measured, never clear");
        noFarms.Reason.Should().Be("farm_list_unreadable");
    }

    // ── the voice-check handler ──────────────────────────────────────────────

    [Fact]
    public async Task Voice_check_refuses_a_non_platform_admin()
    {
        var reader = new FakeReader(Rows(Array.Empty<MisFarmRow>(), Array.Empty<MisVoiceJobRow>()));

        var result = await Handler(reader).HandleAsync(new GetVoiceCheckQuery(AdminUser, IsPlatformAdmin: false));

        result.IsSuccess.Should().BeFalse();
        result.Error.Kind.Should().Be(ErrorKind.Forbidden, "the route answers 403");
        result.Value.Should().BeNull("a refusal carries no part of the answer");
        reader.Calls.Should().Be(0, "nothing is read, so no audited cross-farm context is opened");
    }

    [Fact]
    public async Task Voice_check_reads_six_hours_ending_now_as_the_admin_and_judges()
    {
        var farm = Farm(1);
        var reader = new FakeReader(Rows(new[] { FarmRow(farm, Owner(1)) }, Jobs(farm, Owner(1), succeeded: 7, failed: 3)));
        var excluded = new HashSet<Guid> { TestAccount };

        var result = await Handler(reader, new CompanyMisExclusions(excluded))
            .HandleAsync(new GetVoiceCheckQuery(AdminUser, IsPlatformAdmin: true));

        result.IsSuccess.Should().BeTrue(result.IsSuccess ? string.Empty : result.Error.Description);
        reader.Calls.Should().Be(1);
        reader.AdminUserId.Should().Be(AdminUser, "the signed-in admin is named on the audit row");
        reader.SinceUtc.Should().Be(Now.AddHours(-6));
        reader.CountedAtUtc.Should().Be(Now);
        reader.Excluded.Should().BeEquivalentTo(excluded);
        result.Value!.State.Should().Be("breach");
        result.Value.Counted.Should().Be(3);
        result.Value.OutOf.Should().Be(10);
        result.Value.WindowEndUtc.Should().Be(Now, "the answer says when it was counted");
        result.Value.WindowStartUtc.Should().Be(Now.AddHours(-6));
    }

    [Fact]
    public async Task A_failed_voice_read_escapes()
    {
        var reader = new FakeReader(null!) { Throw = new InvalidOperationException("cr2e: the read failed") };

        var run = async () => await Handler(reader).HandleAsync(new GetVoiceCheckQuery(AdminUser, IsPlatformAdmin: true));

        await run.Should().ThrowAsync<InvalidOperationException>("a failed read is a 500, never an answer that reads as clear");
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static readonly IReadOnlySet<Guid> NoExclusions = new HashSet<Guid>();

    private static Guid Farm(int n) => Guid.Parse($"c2e50000-0000-0000-0000-{n:D12}");

    private static Guid Owner(int n) => Guid.Parse($"c2e50000-0000-0000-0001-{n:D12}");

    private static MisFarmRow FarmRow(Guid farm, Guid owner) =>
        new(farm, owner, Now.AddDays(-90), null, null);

    private static MisVoiceJobRow Job(int n, Guid farm, Guid user, DateTime createdAt, string status) =>
        new(Guid.Parse($"c2e50000-0000-0000-0002-{n:D12}"), farm, user, createdAt, status, Array.Empty<int>());

    /// <summary>Finished jobs inside the six hours: <paramref name="succeeded"/> Succeeded, <paramref name="failed"/> Failed.</summary>
    private static List<MisVoiceJobRow> Jobs(Guid farm, Guid user, int succeeded, int failed, int firstId = 1)
    {
        var jobs = new List<MisVoiceJobRow>();
        var id = firstId;
        for (var i = 0; i < succeeded; i++)
        {
            jobs.Add(Job(id++, farm, user, Now.AddMinutes(-30 - i), "Succeeded"));
        }

        for (var i = 0; i < failed; i++)
        {
            jobs.Add(Job(id++, farm, user, Now.AddMinutes(-90 - i), "Failed"));
        }

        return jobs;
    }

    private static CompanyMisRows Rows(IReadOnlyList<MisFarmRow> farms, IReadOnlyList<MisVoiceJobRow> jobs) =>
        new(farms.Count, 0, farms, Array.Empty<MisEntryRow>(), Array.Empty<MisMembershipRow>(),
            Array.Empty<MisPlotRow>(), jobs, Array.Empty<MisUserRow>(), Array.Empty<MisFpoScopeRow>());

    private static GetVoiceCheckHandler Handler(FakeReader reader, CompanyMisExclusions? exclusions = null) =>
        new(reader, exclusions ?? CompanyMisExclusions.None, new FixedClock(Now));

    private sealed class FixedClock(DateTime now) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => new(DateTime.SpecifyKind(now, DateTimeKind.Utc));
    }

    private sealed class FakeReader(CompanyMisRows rows) : ICompanyMisReader
    {
        public int Calls { get; private set; }
        public Guid? AdminUserId { get; private set; }
        public DateTime? SinceUtc { get; private set; }
        public DateTime? CountedAtUtc { get; private set; }
        public IReadOnlySet<Guid>? Excluded { get; private set; }
        public Exception? Throw { get; init; }

        public Task<CompanyMisRows> ReadAsync(
            Guid adminUserId, DateTime sinceUtc, DateTime countedAtUtc, IReadOnlySet<Guid> excludedUserIds,
            CancellationToken ct = default)
        {
            Calls++;
            AdminUserId = adminUserId;
            SinceUtc = DateTime.SpecifyKind(sinceUtc, DateTimeKind.Utc);
            CountedAtUtc = DateTime.SpecifyKind(countedAtUtc, DateTimeKind.Utc);
            Excluded = excludedUserIds;
            if (Throw is not null)
            {
                throw Throw;
            }

            return Task.FromResult(rows);
        }
    }
}
