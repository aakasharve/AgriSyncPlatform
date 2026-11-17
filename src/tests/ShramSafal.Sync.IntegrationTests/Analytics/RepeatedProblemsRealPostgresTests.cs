// spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, Task 2; amendments C1, C2, C6, C16)
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Npgsql;
using ShramSafal.Application.Contracts.Dtos;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Analytics;

/// <summary>
/// spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, Task 2). Written by
/// the test-writer from the plan only.
///
/// <para>
/// One rule, two windows. A problem is an <c>api.error</c>, a <c>client.error</c>
/// or an <c>ai.invocation</c> with <c>props.outcome = 'failure'</c> (C1); its farm
/// is <c>farm_id</c>, else the uuid <c>props.routeFarmId</c> of a server-written
/// row (Task 1, C2); a problem met by a test account (person = actor_user_id,
/// else a uuid <c>props.personId</c>) is not counted (C16). Suffering: last 7
/// days, 3 or more, at most 50. Live Health: last 24 hours, 2 or more, at most
/// 10. Both ordered by count, then latest. Each problem lands in exactly one of
/// the four areas, so the areas add up to the count. Read from
/// <c>analytics.events</c> on request as <c>agrisync_app</c>; failures escape.
/// </para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class RepeatedProblemsRealPostgresTests(Xunit.Abstractions.ITestOutputHelper output)
    : AdminErrorEventsRealPostgresHarness(output)
{
    private const string EntryRoute = "POST /shramsafal/logs";

    private static readonly Guid Admin = E("ad01");
    private static readonly Guid Farm1 = E("f001");
    private static readonly Guid Farm2 = E("f002");
    private static readonly Guid Farm3 = E("f003");
    private static readonly Guid TestFarm = E("f0e0");
    private static readonly Guid Owner1 = E("1001");
    private static readonly Guid Owner2 = E("1002");
    private static readonly Guid TestAccount = E("e0e0");
    private static readonly Guid RealPerson = E("3001");

    protected override string ScratchPrefix => "ssf_cr2e_repeat";

    private static Guid E(string tail) => Guid.Parse("c2e2" + tail.PadLeft(28, '0'));

    protected override async Task SeedAsync(NpgsqlConnection db)
    {
        await EnsurePreviousMonthPartitionAsync(db);

        await SeedUserAsync(db, Owner1, "0000008001", "Fake Repeat Owner One", Ist(10, 1), Ist(10, 1));
        await SeedUserAsync(db, Owner2, "0000008002", "Fake Repeat Owner Two", Ist(10, 2), Ist(10, 2));
        await SeedUserAsync(db, TestAccount, "0000008099", "Fake Test Account", Ist(10, 3), Ist(10, 3));
        await SeedUserAsync(db, RealPerson, "0000008301", "Fake Real Person", Ist(10, 4), Ist(10, 4));
        await SeedFarmAsync(db, Farm1, "Fake Repeat Farm One", Owner1, E("a001"), Ist(10, 1));
        await SeedFarmAsync(db, Farm2, "Fake Repeat Farm Two", Owner2, E("a002"), Ist(10, 2));
        await SeedFarmAsync(db, TestFarm, "Fake Test Account Farm", TestAccount, E("a0e0"), Ist(10, 3));
        await SeedMembershipAsync(db, Farm1, Owner1, E("a001"), "PrimaryOwner");
        await SeedMembershipAsync(db, Farm2, Owner2, E("a002"), "PrimaryOwner");
        await SeedMembershipAsync(db, TestFarm, TestAccount, E("a0e0"), "PrimaryOwner");
    }

    // ── the two windows ──────────────────────────────────────────────────────

    [SkippableFact]
    public async Task Seven_days_three_problems_lists_the_farm()
    {
        await GuardAsync();

        await WriteRowsAsync(async db =>
        {
            await ProblemAsync(db, Farm1, TimeSpan.FromHours(1));
            await ProblemAsync(db, Farm1, TimeSpan.FromDays(2));
            await ProblemAsync(db, Farm1, TimeSpan.FromDays(6));
        });

        var suffering = await SufferingAsync();

        var farm1 = suffering.Single(s => s.FarmId == Farm1);
        Output.WriteLine($"[EVIDENCE] farm1 problems={farm1.ProblemCount} last={farm1.LastProblemAt:O}");
        farm1.ProblemCount.Should().Be(3, "three problems inside the last 7 days");
        farm1.EntryProblems.Should().Be(3, "each was on POST …/logs");
        AsUtc(farm1.LastProblemAt).Should().BeCloseTo(Now.AddHours(-1), TimeSpan.FromMilliseconds(1), "the latest problem");
    }

    [SkippableFact]
    public async Task Two_problems_in_seven_days_does_not()
    {
        await GuardAsync();

        await WriteRowsAsync(async db =>
        {
            // Farm 2: two inside the week, one eight days old.
            await ProblemAsync(db, Farm2, TimeSpan.FromHours(1));
            await ProblemAsync(db, Farm2, TimeSpan.FromDays(6));
            await ProblemAsync(db, Farm2, TimeSpan.FromDays(8));

            // The control: farm 1 has three inside the week.
            await ProblemAsync(db, Farm1, TimeSpan.FromHours(2));
            await ProblemAsync(db, Farm1, TimeSpan.FromHours(3));
            await ProblemAsync(db, Farm1, TimeSpan.FromHours(4));
        });

        var suffering = await SufferingAsync();

        suffering.Select(s => s.FarmId).Should().NotContain(Farm2, "two problems in 7 days is under the three-problem rule");
        suffering.Select(s => s.FarmId).Should().Contain(Farm1);
    }

    [SkippableFact]
    public async Task Twenty_four_hours_two_problems_lists_the_farm_on_live()
    {
        await GuardAsync();

        await WriteRowsAsync(async db =>
        {
            await ProblemAsync(db, Farm1, TimeSpan.FromHours(1));
            await ProblemAsync(db, Farm1, TimeSpan.FromHours(23));
            await ProblemAsync(db, Farm2, TimeSpan.FromHours(1));
        });

        var live = await LiveAsync();

        var farm1 = live.Single(f => f.FarmId == Farm1);
        Output.WriteLine($"[EVIDENCE] live farm1 errors={farm1.ErrorCount} last={farm1.LastErrorAt:O}");
        farm1.ErrorCount.Should().Be(2, "two problems in the last 24 hours is the Live rule");
        AsUtc(farm1.LastErrorAt).Should().BeCloseTo(Now.AddHours(-1), TimeSpan.FromMilliseconds(1));
        live.Select(f => f.FarmId).Should().NotContain(Farm2, "one problem is under the Live rule");
    }

    [SkippableFact]
    public async Task A_problem_older_than_24_hours_does_not_count_on_live()
    {
        await GuardAsync();

        await WriteRowsAsync(async db =>
        {
            await ProblemAsync(db, Farm1, TimeSpan.FromHours(1));
            await ProblemAsync(db, Farm1, TimeSpan.FromHours(2));
            await ProblemAsync(db, Farm1, TimeSpan.FromHours(25));
            await ProblemAsync(db, Farm2, TimeSpan.FromHours(1));
            await ProblemAsync(db, Farm2, TimeSpan.FromHours(25));
        });

        var live = await LiveAsync();

        live.Single(f => f.FarmId == Farm1).ErrorCount.Should().Be(2, "the 25-hour-old problem is outside the window");
        live.Select(f => f.FarmId).Should().NotContain(Farm2, "one problem in 24 hours, one older");

        // The same rows on the 7-day page do count.
        (await SufferingAsync()).Single(s => s.FarmId == Farm1).ProblemCount.Should().Be(3);
    }

    // ── what counts as a problem ─────────────────────────────────────────────

    [SkippableFact]
    public async Task A_failed_voice_call_counts_as_voice()
    {
        await GuardAsync();

        await WriteRowsAsync(async db =>
        {
            foreach (var hours in new[] { 1, 2, 3 })
            {
                await ProblemAsync(db, Farm1, TimeSpan.FromHours(hours), type: AiInvocation, route: null, outcome: "failure");
            }
        });

        var farm1 = (await SufferingAsync()).Single(s => s.FarmId == Farm1);
        farm1.ProblemCount.Should().Be(3);
        farm1.VoiceProblems.Should().Be(3, "a failed voice call is a voice problem");
        (farm1.SyncProblems, farm1.EntryProblems, farm1.OtherProblems).Should().Be((0, 0, 0));

        var live = (await LiveAsync()).Single(f => f.FarmId == Farm1);
        live.ErrorCount.Should().Be(3);
        live.VoiceErrors.Should().Be(3);
        (live.SyncErrors, live.LogErrors, live.OtherErrors).Should().Be((0, 0, 0));
    }

    [SkippableFact]
    public async Task A_successful_voice_call_does_not_count()
    {
        await GuardAsync();

        await WriteRowsAsync(async db =>
        {
            await ProblemAsync(db, Farm1, TimeSpan.FromMinutes(10));
            await ProblemAsync(db, Farm1, TimeSpan.FromMinutes(20));
            foreach (var minutes in new[] { 1, 2, 3, 4, 5 })
            {
                await ProblemAsync(db, Farm1, TimeSpan.FromMinutes(minutes), type: AiInvocation, route: null, outcome: "success");
            }

            await ProblemAsync(db, Farm2, TimeSpan.FromMinutes(10));
            foreach (var minutes in new[] { 1, 2, 3 })
            {
                await ProblemAsync(db, Farm2, TimeSpan.FromMinutes(minutes), type: AiInvocation, route: null, outcome: "success");
            }
        });

        (await SufferingAsync()).Select(s => s.FarmId).Should().NotContain(Farm1,
            "two problems plus five successful voice calls is two problems, under the 7-day rule");

        var live = await LiveAsync();
        var farm1 = live.Single(f => f.FarmId == Farm1);
        farm1.ErrorCount.Should().Be(2, "the successful voice calls are not problems");
        farm1.VoiceErrors.Should().Be(0);
        live.Select(f => f.FarmId).Should().NotContain(Farm2);
    }

    [SkippableFact]
    public async Task A_route_farm_row_counts_for_that_farm()
    {
        await GuardAsync();

        await WriteRowsAsync(async db =>
        {
            // Farm 1: three server errors with no farm on the row, on requests that named farm 1.
            foreach (var hours in new[] { 1, 2, 3 })
            {
                await ProblemAsync(db, farm: null, TimeSpan.FromHours(hours), routeFarm: Farm1);
            }

            // Farm 2: phone reports claiming farm 2, and slow or refused requests that named it.
            // None of them is a problem tied to farm 2.
            foreach (var hours in new[] { 1, 2, 3 })
            {
                await ProblemAsync(db, farm: null, TimeSpan.FromHours(hours), type: ClientError, routeFarm: Farm2);
                await ProblemAsync(db, farm: null, TimeSpan.FromHours(hours), type: ApiSlow, routeFarm: Farm2);
                await ProblemAsync(db, farm: null, TimeSpan.FromHours(hours), type: ApiRefused, routeFarm: Farm2);
            }

            // Garbage routeFarmId neither names a farm nor breaks the read.
            await ProblemAsync(db, farm: null, TimeSpan.FromHours(1), routeFarmRaw: "x'; drop table y");
            await ProblemAsync(db, farm: null, TimeSpan.FromHours(1), routeFarmRaw: "not-a-uuid");
        });

        var suffering = await SufferingAsync();
        suffering.Single(s => s.FarmId == Farm1).ProblemCount.Should().Be(3, "the farm the request named (C2)");
        suffering.Select(s => s.FarmId).Should().NotContain(Farm2,
            "a phone report cannot name a farm, and slow or refused requests are not problems");

        var live = await LiveAsync();
        live.Single(f => f.FarmId == Farm1).ErrorCount.Should().Be(3);
        live.Select(f => f.FarmId).Should().NotContain(Farm2);
    }

    // ── areas, order, limits ─────────────────────────────────────────────────

    [SkippableFact]
    public async Task Area_counts_add_up_to_the_problem_count()
    {
        await GuardAsync();

        await WriteRowsAsync(async db =>
        {
            await ProblemAsync(db, Farm1, TimeSpan.FromHours(1), route: "POST /shramsafal/sync/push");
            await ProblemAsync(db, Farm1, TimeSpan.FromHours(2), route: "POST /shramsafal/logs/{id:guid}/verify");
            await ProblemAsync(db, Farm1, TimeSpan.FromHours(3), route: "POST /shramsafal/ai/parse-voice");
            await ProblemAsync(db, Farm1, TimeSpan.FromHours(4), type: AiInvocation, route: null, outcome: "failure");
            await ProblemAsync(db, Farm1, TimeSpan.FromHours(5), type: ClientError, route: null);
            await ProblemAsync(db, Farm1, TimeSpan.FromHours(6), route: "GET /shramsafal/cr2e/a-route-nobody-mapped");
            await ProblemAsync(db, Farm1, TimeSpan.FromHours(7), route: null);

            await ProblemAsync(db, Farm2, TimeSpan.FromHours(1), route: "GET /shramsafal/sync/pull");
            await ProblemAsync(db, Farm2, TimeSpan.FromHours(2), route: "GET /shramsafal/sync/pull");
            await ProblemAsync(db, Farm2, TimeSpan.FromHours(3), route: "POST /shramsafal/voice-diary/persist");
        });

        var suffering = await SufferingAsync();
        var farm1 = suffering.Single(s => s.FarmId == Farm1);
        Output.WriteLine(
            $"[EVIDENCE] farm1 total={farm1.ProblemCount} sync={farm1.SyncProblems} entries={farm1.EntryProblems} voice={farm1.VoiceProblems} other={farm1.OtherProblems}");
        farm1.ProblemCount.Should().Be(7);
        farm1.SyncProblems.Should().Be(1, "POST …/sync/push");
        farm1.EntryProblems.Should().Be(1, "POST …/logs/{id:guid}/verify");
        farm1.VoiceProblems.Should().Be(2, "…/ai/parse-voice and the failed voice call");
        farm1.OtherProblems.Should().Be(3, "the phone report, the unknown route and the row with no route");

        var farm2 = suffering.Single(s => s.FarmId == Farm2);
        (farm2.ProblemCount, farm2.SyncProblems, farm2.VoiceProblems).Should().Be((3, 2, 1), "sync pull twice, the voice diary once (C18)");

        foreach (var item in suffering)
        {
            (item.SyncProblems + item.EntryProblems + item.VoiceProblems + item.OtherProblems).Should().Be(
                item.ProblemCount, "every problem lands in exactly one area (farm {0})", item.FarmId);
        }

        var live = await LiveAsync();
        var liveFarm1 = live.Single(f => f.FarmId == Farm1);
        (liveFarm1.ErrorCount, liveFarm1.SyncErrors, liveFarm1.LogErrors, liveFarm1.VoiceErrors, liveFarm1.OtherErrors)
            .Should().Be((7, 1, 1, 2, 3), "the Live areas follow the same table");
        foreach (var item in live)
        {
            (item.SyncErrors + item.LogErrors + item.VoiceErrors + item.OtherErrors).Should().Be(
                item.ErrorCount, "every problem lands in exactly one area (farm {0})", item.FarmId);
        }
    }

    [SkippableFact]
    public async Task Farms_are_ordered_by_count_then_latest()
    {
        await GuardAsync();

        await WriteRowsAsync(async db =>
        {
            foreach (var hours in new[] { 3, 4, 5, 6, 7 })
            {
                await ProblemAsync(db, Farm1, TimeSpan.FromHours(hours));     // 5, latest 3 h ago
            }

            foreach (var hours in new[] { 2, 8, 9 })
            {
                await ProblemAsync(db, Farm3, TimeSpan.FromHours(hours));     // 3, latest 2 h ago
            }

            foreach (var hours in new[] { 1, 8, 9 })
            {
                await ProblemAsync(db, Farm2, TimeSpan.FromHours(hours));     // 3, latest 1 h ago
            }
        });

        (await SufferingAsync()).Select(s => s.FarmId).Should().Equal(new[] { Farm1, Farm2, Farm3 },
            "by count, then the latest problem first");
        (await LiveAsync()).Select(f => f.FarmId).Should().Equal(new[] { Farm1, Farm2, Farm3 });
    }

    [SkippableFact]
    public async Task At_most_50_on_suffering_and_10_on_live()
    {
        await GuardAsync();

        // 52 farms, three problems each in the last 24 hours; farm n's latest is n minutes ago.
        static Guid Many(int n) => Guid.Parse($"c2e2bbbb-0000-0000-0000-{n:D12}");
        await WriteRowsAsync(async db =>
        {
            for (var n = 1; n <= 52; n++)
            {
                await ProblemAsync(db, Many(n), TimeSpan.FromMinutes(n));
                await ProblemAsync(db, Many(n), TimeSpan.FromMinutes(100 + n));
                await ProblemAsync(db, Many(n), TimeSpan.FromMinutes(200 + n));
            }
        });

        var suffering = await SufferingAsync();
        Output.WriteLine($"[EVIDENCE] suffering={suffering.Count}");
        suffering.Select(s => s.FarmId).Should().Equal(Enumerable.Range(1, 50).Select(Many), "at most 50, latest first on a tie");

        var live = await LiveAsync();
        live.Select(f => f.FarmId).Should().Equal(Enumerable.Range(1, 10).Select(Many), "at most 10 on Live");
    }

    // ── C1 and C16: one count everywhere ─────────────────────────────────────

    [SkippableFact]
    public async Task The_same_farm_shows_the_same_24_hour_count_on_all_farms_and_live()
    {
        await GuardAsync();

        await WriteRowsAsync(async db =>
        {
            // Problems in the last 24 hours: 4.
            await ProblemAsync(db, Farm1, TimeSpan.FromHours(1));
            await ProblemAsync(db, farm: null, TimeSpan.FromHours(2), routeFarm: Farm1);
            await ProblemAsync(db, Farm1, TimeSpan.FromHours(3), type: ClientError, route: null);
            await ProblemAsync(db, Farm1, TimeSpan.FromHours(4), type: AiInvocation, route: null, outcome: "failure");

            // Not problems, or not farm 1's, or not in the last 24 hours.
            await ProblemAsync(db, Farm1, TimeSpan.FromHours(1), type: AiInvocation, route: null, outcome: "success");
            await ProblemAsync(db, Farm1, TimeSpan.FromHours(1), type: ApiSlow);
            await ProblemAsync(db, farm: null, TimeSpan.FromHours(1), type: ApiSlow, routeFarm: Farm1);
            await ProblemAsync(db, farm: null, TimeSpan.FromHours(1), type: ApiRefused, routeFarm: Farm1);
            await ProblemAsync(db, farm: null, TimeSpan.FromHours(1), type: ClientError, routeFarm: Farm1);
            await ProblemAsync(db, Farm1, TimeSpan.FromHours(25));
        });

        var provider = BuildProvider();
        await using var scope = AdminScope(provider);
        var farmsList = await MisRepository(scope.ServiceProvider).GetFarmsListAsync(Admin, 1, 50, null, null);
        var allFarms = farmsList.Items.Single(i => i.FarmId == Farm1).Errors24h;
        var live = (await OpsRepository(scope.ServiceProvider).GetOpsHealthAsync())
            .TopSufferingFarms.Single(f => f.FarmId == Farm1).ErrorCount;
        var week = (await MisRepository(scope.ServiceProvider).GetSufferingAsync())
            .Single(s => s.FarmId == Farm1).ProblemCount;

        Output.WriteLine($"[EVIDENCE] farm1 allFarms24h={allFarms} live24h={live} suffering7d={week}");
        allFarms.Should().Be(4, "api.error by both farm rules, client.error and the failed voice call");
        live.Should().Be(allFarms, "one definition of a problem: All Farms and Live show the same 24-hour count (C1)");
        week.Should().Be(5, "the same rule over 7 days adds the 25-hour-old problem");
    }

    [SkippableFact]
    public async Task A_problem_met_by_a_test_account_is_not_counted_anywhere()
    {
        await GuardAsync();

        await WriteRowsAsync(async db =>
        {
            // Met by the test account: not counted (person = actor_user_id, else a uuid personId).
            await ProblemAsync(db, Farm1, TimeSpan.FromHours(1), actor: TestAccount);
            await ProblemAsync(db, Farm1, TimeSpan.FromHours(2), personId: TestAccount.ToString("D"));
            await ProblemAsync(db, Farm1, TimeSpan.FromHours(3), type: ClientError, route: null, actor: TestAccount);
            await ProblemAsync(db, Farm1, TimeSpan.FromHours(4), type: AiInvocation, route: null, outcome: "failure", actor: TestAccount);
            await ProblemAsync(db, Farm1, TimeSpan.FromHours(5), actor: TestAccount, personId: RealPerson.ToString("D"));

            // Met by a real person, or by nobody known: counted. A garbage personId must not fail the read.
            await ProblemAsync(db, Farm1, TimeSpan.FromHours(1), actor: RealPerson);
            await ProblemAsync(db, farm: null, TimeSpan.FromHours(2), routeFarm: Farm1, personId: RealPerson.ToString("D"));
            await ProblemAsync(db, Farm1, TimeSpan.FromHours(3), personId: "not-a-uuid");
            await ProblemAsync(db, Farm1, TimeSpan.FromHours(4));
            await ProblemAsync(db, Farm1, TimeSpan.FromHours(5), actor: RealPerson, personId: TestAccount.ToString("D"));

            // A real person's problems on the test account's farm still count.
            foreach (var hours in new[] { 1, 2, 3 })
            {
                await ProblemAsync(db, TestFarm, TimeSpan.FromHours(hours), actor: RealPerson);
            }
        });

        // The control: with no test accounts configured, every seeded row of farm 1 counts.
        var plain = BuildProvider();
        await using (var plainScope = AdminScope(plain))
        {
            (await OpsRepository(plainScope.ServiceProvider).GetOpsHealthAsync())
                .TopSufferingFarms.Single(f => f.FarmId == Farm1).ErrorCount.Should().Be(10);
        }

        var provider = BuildProvider(excludedUserIds: new[] { TestAccount });
        await using var scope = AdminScope(provider);
        var allFarms = (await MisRepository(scope.ServiceProvider).GetFarmsListAsync(Admin, 1, 50, null, null))
            .Items.Single(i => i.FarmId == Farm1).Errors24h;
        var liveFarms = (await OpsRepository(scope.ServiceProvider).GetOpsHealthAsync()).TopSufferingFarms;
        var suffering = await MisRepository(scope.ServiceProvider).GetSufferingAsync();

        Output.WriteLine(
            $"[EVIDENCE] farm1 allFarms={allFarms} live={liveFarms.Single(f => f.FarmId == Farm1).ErrorCount} suffering={suffering.Single(s => s.FarmId == Farm1).ProblemCount}");
        allFarms.Should().Be(5, "the five rows met by the test account are left out of All Farms (F6)");
        liveFarms.Single(f => f.FarmId == Farm1).ErrorCount.Should().Be(5, "and out of Live (L7)");
        suffering.Single(s => s.FarmId == Farm1).ProblemCount.Should().Be(5, "and out of Suffering (U1)");

        liveFarms.Single(f => f.FarmId == TestFarm).ErrorCount.Should().Be(3, "a real person's problem on a test farm still counts");
        suffering.Single(s => s.FarmId == TestFarm).ProblemCount.Should().Be(3);
    }

    [SkippableFact]
    public async Task A_broken_read_escapes_never_an_empty_list()
    {
        await GuardAsync();

        var droppedName = $"ssf_cr2e_dropped_{Guid.NewGuid():N}";
        await using (var admin = new NpgsqlConnection(AdminConn))
        {
            await admin.OpenAsync();
            await ExecAsync(admin, $"CREATE DATABASE \"{droppedName}\"");
            await ExecAsync(admin, $"DROP DATABASE \"{droppedName}\"");
        }

        var droppedConn = new NpgsqlConnectionStringBuilder(AppConn) { Database = droppedName }.ConnectionString;
        await using var scope = AdminScope(BuildProvider(analyticsConn: droppedConn));

        var suffering = () => MisRepository(scope.ServiceProvider).GetSufferingAsync();
        var live = () => OpsRepository(scope.ServiceProvider).GetOpsHealthAsync();

        await suffering.Should().ThrowAsync<Exception>("a failed read escapes to the 500 path, never an empty list");
        await live.Should().ThrowAsync<Exception>("a failed read escapes to the 500 path, never an empty list");
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private async Task WriteRowsAsync(Func<NpgsqlConnection, Task> seed)
    {
        await using var db = await OpenSuperuserAsync();
        await seed(db);
    }

    /// <summary>One analytics row at <paramref name="ago"/> before the test started.</summary>
    private Task ProblemAsync(
        NpgsqlConnection db, Guid? farm, TimeSpan ago,
        string type = ApiError, string? route = EntryRoute, Guid? actor = null, string? personId = null,
        Guid? routeFarm = null, string? routeFarmRaw = null, string? outcome = null) =>
        EventAsync(db, type, Now - ago, farm, actor, Props(
            ("endpoint", route ?? "GET /shramsafal/cr2e/no-route"),
            ("statusCode", type == AiInvocation ? (object?)null : 500),
            ("latencyMs", 10),
            ("route", route),
            ("routeFarmId", routeFarm?.ToString("D") ?? routeFarmRaw),
            ("personId", personId),
            ("outcome", outcome)));

    private async Task<IReadOnlyList<SufferingItemDto>> SufferingAsync()
    {
        await using var scope = AdminScope(BuildProvider());
        return await MisRepository(scope.ServiceProvider).GetSufferingAsync();
    }

    private async Task<IReadOnlyList<OpsFarmErrorDto>> LiveAsync()
    {
        await using var scope = AdminScope(BuildProvider());
        return (await OpsRepository(scope.ServiceProvider).GetOpsHealthAsync()).TopSufferingFarms;
    }
}
