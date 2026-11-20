// spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, Task 5 as replaced by C29; C9, C11, C30)
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.BuildingBlocks.Results;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Admin.GetCompanyMis;
using ShramSafal.Application.UseCases.Admin.GetOpsHealth;
using ShramSafal.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Analytics;

/// <summary>
/// spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, Task 5 as replaced by C29). Written by the test-writer
/// from the plan only.
///
/// <para>
/// R9 (server errors) is counted live from <c>analytics.events</c> by the REAL <c>AdminOpsRepository</c>: the
/// <c>api.error</c> rows of the 60 minutes before the request, a breach above 30, no nightly view and no audited
/// factory. R10 (voice recordings failing) is counted by the REAL Company MIS reader and the voice-check handler:
/// jobs of the 6 hours before the request read farm by farm as <c>agrisync_app</c> under row-level security, test
/// accounts left out, failures escaping. R9 reads <c>DateTime.UtcNow</c>, so every row is seeded relative to the
/// moment the test started (never to a fixed date); no boundary is seeded closer than a minute.
/// </para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class LiveAlertRulesRealPostgresTests(Xunit.Abstractions.ITestOutputHelper output)
    : AdminErrorEventsRealPostgresHarness(output)
{
    private static readonly Guid Admin = G("e5ad");
    private static readonly Guid U1 = G("e501");
    private static readonly Guid U2 = G("e502");
    private static readonly Guid Account1 = G("e5a1");
    private static readonly Guid Account2 = G("e5a2");
    private static readonly Guid F1 = G("e5f1");
    private static readonly Guid F2 = G("e5f2");

    private static readonly Guid TestUser = G("e590");
    private static readonly Guid TestOwnerAccount = G("e5a9");
    private static readonly Guid TestOwnedFarm = G("e5f9");

    protected override string ScratchPrefix => "ssf_cr2e_alerts";

    /// <summary>Two real farms with owners, so voice jobs can be seeded under row-level security.</summary>
    protected override async Task SeedAsync(NpgsqlConnection db)
    {
        await EnsurePreviousMonthPartitionAsync(db);
        await SeedOwnedFarmAsync(db, F1, U1, Account1, "Fake Alert Farm One", "9000000501");
        await SeedOwnedFarmAsync(db, F2, U2, Account2, "Fake Alert Farm Two", "9000000502");
    }

    // ── R9 ───────────────────────────────────────────────────────────────────

    [SkippableFact]
    public async Task Thirty_one_errors_in_an_hour_is_a_breach()
    {
        await GuardAsync();
        await using (var db = await OpenSuperuserAsync())
        {
            await ManyAsync(db, ApiError, 30, Now.AddMinutes(-10));
            // The 31st was met by a test account: R9 measures the server, so it still counts.
            await EventAsync(db, ApiError, Now.AddMinutes(-5), actorUserId: TestUser);
        }

        var health = await HealthAsync(BuildProvider(excludedUserIds: new[] { TestUser }));

        health.AlertR9.Rule.Should().Be("R9");
        health.AlertR9.State.Should().Be("breach");
        health.AlertR9.Counted.Should().Be(31, "every server error counts, test accounts included");
        health.AlertR9.OutOf.Should().BeNull();
        health.AlertR9.Reason.Should().BeNull();
        AsUtc(health.AlertR9.WindowEndUtc).Should().BeCloseTo(AsUtc(health.ComputedAtUtc), TimeSpan.FromSeconds(1),
            "the window ends when the snapshot was computed");
        (AsUtc(health.AlertR9.WindowEndUtc) - AsUtc(health.AlertR9.WindowStartUtc)).Should().Be(TimeSpan.FromMinutes(60));
        Output.WriteLine($"[EVIDENCE] R9 state={health.AlertR9.State} counted={health.AlertR9.Counted}");
    }

    [SkippableFact]
    public async Task Thirty_is_clear()
    {
        await GuardAsync();
        await using (var db = await OpenSuperuserAsync())
        {
            await ManyAsync(db, ApiError, 30, Now.AddMinutes(-10));
            // Other problem types are not api.error and never count toward R9.
            await ManyAsync(db, ApiSlow, 10, Now.AddMinutes(-10));
            await ManyAsync(db, ClientError, 10, Now.AddMinutes(-10));
            await ManyAsync(db, ApiRefused, 10, Now.AddMinutes(-10));
        }

        var health = await HealthAsync(BuildProvider());

        health.AlertR9.State.Should().Be("clear", "30 is not MORE than 30");
        health.AlertR9.Counted.Should().Be(30, "only api.error rows are counted");
    }

    [SkippableFact]
    public async Task An_error_61_minutes_ago_does_not_count()
    {
        await GuardAsync();
        await using (var db = await OpenSuperuserAsync())
        {
            await ManyAsync(db, ApiError, 30, Now.AddMinutes(-10));
            await ManyAsync(db, ApiError, 5, Now.AddMinutes(-61));
        }

        var provider = BuildProvider();
        var before = await HealthAsync(provider);
        before.AlertR9.Counted.Should().Be(30, "the five errors 61 minutes ago are outside the 60-minute window");
        before.AlertR9.State.Should().Be("clear");

        // The control: one error 59 minutes ago is inside the window and tips it over. "59 minutes ago" is
        // read from the clock NOW, after the seeding and the first read, not from `Now` (the moment the test
        // started): on a slow run the scratch database and the first read can take over a minute, and a
        // control placed 59 minutes before the test started would by then be more than 60 minutes old and
        // fall out of the window for a reason that has nothing to do with the rule (plan CR-2d, test-writer).
        var controlAtUtc = Micro(DateTime.UtcNow).AddMinutes(-59);
        await using (var db = await OpenSuperuserAsync())
        {
            await EventAsync(db, ApiError, controlAtUtc);
        }

        var after = await HealthAsync(provider);
        AsUtc(after.AlertR9.WindowStartUtc).Should().BeBefore(controlAtUtc,
            "the control must sit inside the window it is meant to tip; if this fails, the run was too slow to judge");
        after.AlertR9.Counted.Should().Be(31);
        after.AlertR9.State.Should().Be("breach");
    }

    [SkippableFact]
    public async Task The_health_answer_reads_no_nightly_view()
    {
        await GuardAsync();

        var views = await ScalarAsSuperuserAsync(
            "SELECT count(*) FROM pg_matviews WHERE schemaname = 'mis' AND matviewname LIKE 'alert\\_r%'");
        views.Should().BeGreaterThan(0, "the construction: the nightly alert materialized views exist in the migrated database");

        await ExecAsSuperuserAsync("""
            DO $$
            DECLARE v record;
            BEGIN
                FOR v IN SELECT schemaname, matviewname FROM pg_matviews WHERE schemaname = 'mis' AND matviewname LIKE 'alert\_r%'
                LOOP
                    EXECUTE format('DROP MATERIALIZED VIEW %I.%I CASCADE', v.schemaname, v.matviewname);
                END LOOP;
            END
            $$;
            """);
        (await ScalarAsSuperuserAsync("SELECT count(*) FROM pg_matviews WHERE schemaname = 'mis' AND matviewname LIKE 'alert\\_r%'"))
            .Should().Be(0);

        await using (var db = await OpenSuperuserAsync())
        {
            await ManyAsync(db, ApiError, 31, Now.AddMinutes(-10));
        }

        var health = await HealthAsync(BuildProvider());

        health.AlertR9.State.Should().Be("breach", "R9 is counted live; the dropped nightly views are not needed");
        health.AlertR9.Counted.Should().Be(31);
    }

    [SkippableFact]
    public async Task The_health_answer_keeps_the_old_fields_honest_for_older_clients()
    {
        await GuardAsync();
        var provider = BuildProvider();

        // Breach: 31 errors.
        await using (var db = await OpenSuperuserAsync())
        {
            await ManyAsync(db, ApiError, 31, Now.AddMinutes(-10));
        }

        var breach = await HealthAsync(provider);
        breach.AlertR9.State.Should().Be("breach");
        breach.ApiErrorSpike.Should().Be(true, "apiErrorSpike equals the R9 breach (C30)");
        breach.VoiceDegraded.Should().BeNull("voiceDegraded is always null: the voice check has its own route, never a made-up clear");

        using (var doc = JsonDocument.Parse(JsonSerializer.Serialize(breach, new JsonSerializerOptions(JsonSerializerDefaults.Web))))
        {
            doc.RootElement.GetProperty("apiErrorSpike").GetBoolean().Should().BeTrue("the old field is on the wire");
            doc.RootElement.TryGetProperty("voiceDegraded", out var voice).Should().BeTrue("the old field is on the wire, as null");
            voice.ValueKind.Should().Be(JsonValueKind.Null);
            doc.RootElement.GetProperty("alertR9").GetProperty("state").GetString().Should().Be("breach");
        }
    }

    [SkippableFact]
    public async Task Old_field_apiErrorSpike_is_false_when_clear()
    {
        await GuardAsync();
        await using (var db = await OpenSuperuserAsync())
        {
            await ManyAsync(db, ApiError, 30, Now.AddMinutes(-10));
        }

        var health = await HealthAsync(BuildProvider());

        health.AlertR9.State.Should().Be("clear");
        health.ApiErrorSpike.Should().Be(false, "= AlertR9.State == breach");
        health.VoiceDegraded.Should().BeNull();
    }

    [SkippableFact]
    public async Task Polled_health_opens_no_admin_factory()
    {
        await GuardAsync();
        await using (var db = await OpenSuperuserAsync())
        {
            // A farm-named error and a spike, so every read in the health answer has something to read.
            await EventAsync(db, ApiError, Now.AddMinutes(-10), farmId: F1, props: Props(("endpoint", "/x")));
            await EventAsync(db, ApiError, Now.AddMinutes(-9), farmId: F1, props: Props(("endpoint", "/x")));
            await ManyAsync(db, ApiError, 31, Now.AddMinutes(-8));
        }

        var provider = BuildProvider();
        await using var scope = AdminScope(provider);
        var counting = new CountingAdminFactory(scope.ServiceProvider.GetRequiredService<IAdminDbContextFactory<ShramSafalDbContext>>());
        var repository = OpsRepository(scope.ServiceProvider, counting);
        var auditBefore = await AllCrossFarmAuditRowsAsync();

        var health = await repository.GetOpsHealthAsync();
        await repository.GetOpsHealthAsync();

        health.AlertR9.State.Should().Be("breach", "the answer was really computed");
        health.TopSufferingFarms.Should().NotBeNull();
        counting.Opens.Should().Be(0, "the polled health answer reads analytics.events only (C9)");
        (await AllCrossFarmAuditRowsAsync()).Should().Be(auditBefore, "no cross-farm audit row is written by a poll");

        // The control: the same counting factory does count (and audit) a real open.
        await using (await counting.CreateAsync("control", Admin, default))
        {
        }

        counting.Opens.Should().Be(1);
        (await AllCrossFarmAuditRowsAsync()).Should().Be(auditBefore + 1);
    }

    /// <summary>
    /// C31 fix (5) / C19: the R9 count fails on the server AFTER the connection opened, while the reads before it in
    /// the health answer (voice, recent errors, repeated-problem farms) still work. The failure is a row-level policy
    /// that raises only for the statement whose text carries R9's own upper bound (<c>occurred_at_utc &lt; $n</c>, which
    /// no other events read uses). The health read throws (the route answers 500), never "clear" or 0.
    /// </summary>
    [SkippableFact]
    public async Task A_failed_R9_count_escapes()
    {
        await GuardAsync();
        await using (var db = await OpenSuperuserAsync())
        {
            await ManyAsync(db, ApiError, 3, Now.AddMinutes(-10));
        }

        var provider = BuildProvider();

        // The control: before the failure is armed, the whole health answer is computed.
        (await HealthAsync(provider)).AlertR9.Counted.Should().Be(3);

        await ExecAsSuperuserAsync($"""
            CREATE FUNCTION public.c31_refuse_r9() RETURNS boolean LANGUAGE plpgsql AS
            $$ BEGIN RAISE EXCEPTION 'c31: the R9 count may not be read'; END $$;
            ALTER TABLE analytics.events ENABLE ROW LEVEL SECURITY;
            CREATE POLICY c31_refuse_r9_count ON analytics.events FOR SELECT TO {IntegrationPostgres.AppRoleUser}
                USING (true);
            CREATE POLICY c31_refuse_r9_only ON analytics.events AS RESTRICTIVE FOR SELECT TO {IntegrationPostgres.AppRoleUser}
                USING (current_query() NOT LIKE '%occurred_at_utc < $%' OR public.c31_refuse_r9());
            """);

        await using var scope = AdminScope(provider);
        var repository = OpsRepository(scope.ServiceProvider);

        // The construction: the reads before R9 still work as the same login (they read the same rows).
        var load = () => repository.GetOpsHealthAsync();
        var thrown = await load.Should().ThrowAsync<Exception>(
            "a failed R9 count escapes (the route answers 500), never an answer that reads as clear or as 0");
        Output.WriteLine($"[EVIDENCE] thrown={thrown.Which.GetType().Name}: {thrown.Which.Message}");
        thrown.Which.ToString().Should().Contain("c31: the R9 count may not be read", "it is the R9 count that escaped");
        thrown.Which.ToString().Should().Contain("GetApiErrorCheckAsync", "the earlier reads did not fail; the R9 count did");
    }

    // ── R10 ──────────────────────────────────────────────────────────────────

    [SkippableFact]
    public async Task R10_reads_through_row_level_security()
    {
        await GuardAsync();
        await using (var db = await OpenSuperuserAsync())
        {
            // 10 finished voice jobs across two farms: 7 succeeded, 3 failed, all inside the six hours.
            await JobsAsync(db, F1, U1, succeeded: 4, failed: 2, firstMinutesAgo: 20);
            await JobsAsync(db, F2, U2, succeeded: 3, failed: 1, firstMinutesAgo: 120);
            // Outside the six hours: never counted.
            await SeedVoiceJobAsync(db, Guid.NewGuid(), F1, U1, Now.AddHours(-7), "Failed");
        }

        // The control: the rows are there, and the same role sees none of them without a farm setting.
        (await ScalarAsSuperuserAsync("SELECT count(*) FROM ssf.ai_jobs")).Should().Be(11);
        long asAppRole;
        await using (var app = new NpgsqlConnection(AppConn))
        {
            await app.OpenAsync();
            await using var cmd = app.CreateCommand();
            cmd.CommandText = "SELECT count(*) FROM ssf.ai_jobs";
            asAppRole = Convert.ToInt64(await cmd.ExecuteScalarAsync());
        }

        asAppRole.Should().Be(0, "row-level security hides every job from the app role without a farm setting");

        var check = await VoiceCheckAsync(BuildProvider());

        Output.WriteLine($"[EVIDENCE] ai_jobs: app-role-without-farm-setting={asAppRole} R10 counted={check.Counted} of {check.OutOf} state={check.State}");
        check.Rule.Should().Be("R10");
        check.State.Should().Be("breach", "3 of 10 failed is over 20 percent");
        check.Counted.Should().Be(3);
        check.OutOf.Should().Be(10, "the reader, as the same role, sees the jobs farm by farm; the job 7 hours old is not counted");
        (AsUtc(check.WindowEndUtc) - AsUtc(check.WindowStartUtc)).Should().Be(TimeSpan.FromHours(6));
        AsUtc(check.WindowEndUtc).Should().BeCloseTo(DateTime.UtcNow, TimeSpan.FromMinutes(1));
        (await CrossFarmAuditRowsAsync(Admin)).Should().Be(1, "one cross-farm audit row naming the admin");
    }

    [SkippableFact]
    public async Task Two_failed_of_ten_is_clear_on_real_rows()
    {
        await GuardAsync();
        await using (var db = await OpenSuperuserAsync())
        {
            await JobsAsync(db, F1, U1, succeeded: 6, failed: 1, firstMinutesAgo: 20);
            await JobsAsync(db, F2, U2, succeeded: 2, failed: 1, firstMinutesAgo: 120);
        }

        var check = await VoiceCheckAsync(BuildProvider());

        check.State.Should().Be("clear", "exactly 20 percent");
        check.Counted.Should().Be(2);
        check.OutOf.Should().Be(10);
    }

    [SkippableFact]
    public async Task Too_few_recordings_is_not_judged_on_real_rows()
    {
        await GuardAsync();
        await using (var db = await OpenSuperuserAsync())
        {
            await JobsAsync(db, F1, U1, succeeded: 1, failed: 1, firstMinutesAgo: 20);
            await SeedVoiceJobAsync(db, Guid.NewGuid(), F1, U1, Now.AddMinutes(-30), "Running");
        }

        var check = await VoiceCheckAsync(BuildProvider());

        check.State.Should().Be("not_judged");
        check.Reason.Should().Be("too_few_recordings");
    }

    [SkippableFact]
    public async Task A_test_accounts_recording_is_not_counted()
    {
        await GuardAsync();
        await using (var db = await OpenSuperuserAsync())
        {
            await SeedOwnedFarmAsync(db, TestOwnedFarm, TestUser, TestOwnerAccount, "Fake Test Account Farm", "9000000590");

            // Five real successes.
            await JobsAsync(db, F1, U1, succeeded: 5, failed: 0, firstMinutesAgo: 20);
            // (a) Five failures STARTED by a test account, on a real farm.
            await JobsAsync(db, F2, TestUser, succeeded: 0, failed: 5, firstMinutesAgo: 60);
            // (b) Five failures by a real person on a farm OWNED by a test account.
            await JobsAsync(db, TestOwnedFarm, U2, succeeded: 0, failed: 5, firstMinutesAgo: 90);
        }

        var counted = await VoiceCheckAsync(BuildProvider(excludedUserIds: new[] { TestUser }));
        counted.State.Should().Be("clear", "both kinds of test-account failure are left out");
        counted.Counted.Should().Be(0);
        counted.OutOf.Should().Be(5);

        // The control: with no exclusion, the same rows are a breach (10 of 15).
        var control = await VoiceCheckAsync(BuildProvider());
        control.State.Should().Be("breach");
        control.Counted.Should().Be(10);
        control.OutOf.Should().Be(15);
    }

    [SkippableFact]
    public async Task Voice_check_refuses_a_non_platform_admin()
    {
        await GuardAsync();
        await using (var db = await OpenSuperuserAsync())
        {
            await JobsAsync(db, F1, U1, succeeded: 10, failed: 0, firstMinutesAgo: 20);
        }

        var provider = BuildProvider();
        var before = await AllCrossFarmAuditRowsAsync();
        await using (var scope = AdminScope(provider))
        {
            var refused = await VoiceHandler(scope.ServiceProvider)
                .HandleAsync(new GetVoiceCheckQuery(Admin, IsPlatformSeat: false));

            refused.IsSuccess.Should().BeFalse();
            refused.Error.Kind.Should().Be(ErrorKind.Forbidden);
        }

        (await AllCrossFarmAuditRowsAsync()).Should().Be(before, "nothing was read: no cross-farm context was opened");

        // The control: a platform admin is let in and one audit row is written.
        var ok = await VoiceCheckAsync(provider);
        ok.State.Should().Be("clear");
        (await AllCrossFarmAuditRowsAsync()).Should().Be(before + 1);
    }

    /// <summary>
    /// C29 / C19: the voice query fails on the server AFTER the connection opened (the app login loses SELECT on
    /// <c>ssf.ai_jobs</c>; the farm keys, entries and plots reads before it still work). The failure escapes (the
    /// route answers 500), never an answer that reads as clear or as quiet.
    /// </summary>
    [SkippableFact]
    public async Task A_failed_voice_read_escapes()
    {
        await GuardAsync();
        await using (var db = await OpenSuperuserAsync())
        {
            await JobsAsync(db, F1, U1, succeeded: 10, failed: 0, firstMinutesAgo: 20);
        }

        var provider = BuildProvider();

        // The control: while the app login may read AI jobs, the check is judged.
        (await VoiceCheckAsync(provider)).OutOf.Should().Be(10);

        await ExecAsSuperuserAsync($"REVOKE SELECT ON ssf.ai_jobs FROM {IntegrationPostgres.AppRoleUser}");

        // The construction: the app login is now refused the AI jobs read on the server.
        await using (var app = new NpgsqlConnection(AppConn))
        {
            await app.OpenAsync();
            await using var cmd = app.CreateCommand();
            cmd.CommandText = "SELECT count(*) FROM ssf.ai_jobs";
            var refused = async () => await cmd.ExecuteScalarAsync();
            (await refused.Should().ThrowAsync<PostgresException>()).Which.SqlState.Should().Be("42501");
        }

        await using var scope = AdminScope(provider);
        var load = () => VoiceHandler(scope.ServiceProvider).HandleAsync(new GetVoiceCheckQuery(Admin, IsPlatformSeat: true));

        var thrown = await load.Should().ThrowAsync<Exception>(
            "a failed voice read escapes (the route answers 500), never an answer that reads as clear");
        Output.WriteLine($"[EVIDENCE] thrown={thrown.Which.GetType().Name}: {thrown.Which.Message}");
        thrown.Which.ToString().Should().Contain("permission denied", "it is the refused AI jobs query that escaped");
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static async Task ManyAsync(NpgsqlConnection db, string type, int count, DateTime at)
    {
        for (var i = 0; i < count; i++)
        {
            await EventAsync(db, type, at.AddSeconds(-i), props: Props(("endpoint", "/fake/endpoint"), ("statusCode", 500)));
        }
    }

    /// <summary>Finished jobs, one a minute apart going back from <paramref name="firstMinutesAgo"/>.</summary>
    private async Task JobsAsync(
        NpgsqlConnection db, Guid farm, Guid user, int succeeded, int failed, int firstMinutesAgo)
    {
        var minutes = firstMinutesAgo;
        for (var i = 0; i < succeeded; i++)
        {
            await SeedVoiceJobAsync(db, Guid.NewGuid(), farm, user, Now.AddMinutes(-minutes++), "Succeeded", 1000);
        }

        for (var i = 0; i < failed; i++)
        {
            await SeedVoiceJobAsync(db, Guid.NewGuid(), farm, user, Now.AddMinutes(-minutes++), "Failed");
        }
    }

    private static async Task SeedOwnedFarmAsync(
        NpgsqlConnection db, Guid farm, Guid owner, Guid account, string name, string fakePhone)
    {
        await SeedFarmAsync(db, farm, name, owner, account, DateTime.UtcNow.AddDays(-30));
        await SeedMembershipAsync(db, farm, owner, account, "PrimaryOwner");
        await SeedUserAsync(db, owner, fakePhone, name + " Owner", DateTime.UtcNow.AddDays(-30), DateTime.UtcNow.AddDays(-30));
    }

    private static async Task<AdminOpsHealthDto> HealthAsync(ServiceProvider provider)
    {
        await using var scope = AdminScope(provider);
        return await OpsRepository(scope.ServiceProvider).GetOpsHealthAsync();
    }

    private static GetVoiceCheckHandler VoiceHandler(IServiceProvider sp) =>
        new(sp.GetRequiredService<ICompanyMisReader>(), sp.GetRequiredService<CompanyMisExclusions>(), TimeProvider.System);

    private static async Task<AlertCheckDto> VoiceCheckAsync(ServiceProvider provider)
    {
        await using var scope = AdminScope(provider);
        var result = await VoiceHandler(scope.ServiceProvider).HandleAsync(new GetVoiceCheckQuery(Admin, IsPlatformSeat: true));
        result.IsSuccess.Should().BeTrue(result.IsSuccess ? string.Empty : result.Error.Description);
        return result.Value!;
    }
}
