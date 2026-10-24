// spec: 2026-08-25-prod-cutover-waves
using System;
using System.Linq;
using System.Threading.Tasks;
using AgriSync.Bootstrapper.Infrastructure;
using FluentAssertions;
using Xunit;
using Xunit.Abstractions;
using H = ShramSafal.Sync.IntegrationTests.Labour.PurveshDemoReseedHarness;

namespace ShramSafal.Sync.IntegrationTests.Labour;

/// <summary>
/// spec: 2026-08-25-prod-cutover-waves (demo-seed-v3) — the command's safety preconditions. It runs
/// only when exactly one user holds the demo phone, the fixed demo farm is owned by that login with
/// the demo name and its 4 plots exist, and the schema is not behind the binary. Otherwise it exits
/// 2 (refused) and NOTHING anywhere in the database changes — proven by a whole-database snapshot
/// taken before and after, not by reading back one table.
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class PurveshDemoReseedRefusalRealPostgresTests(
    PurveshDemoReseedTemplateFixture fixture, ITestOutputHelper output)
    : IClassFixture<PurveshDemoReseedTemplateFixture>
{
    private static readonly DateTime RunUtc = new(2026, 3, 10, 6, 30, 0, DateTimeKind.Utc);

    [Theory]
    [InlineData("demo-login-missing")]
    [InlineData("farm-renamed")]
    [InlineData("farm-owned-by-another-login")]
    [InlineData("a-demo-plot-missing")]
    [InlineData("pending-migration")]
    public async Task Refuses_with_exit_2_and_writes_nothing(string precondition)
    {
        await using var s = await PurveshDemoReseedScratch.CloneAsync(fixture.Template);
        (await H.CanBypassRlsAsync(s.AppConn)).Should().BeFalse();
        await BreakAsync(s, precondition);

        var before = await s.SnapshotAsync();
        foreach (var dryRun in new[] { true, false })
        {
            var run = await H.RunReseedAsync(s.AppProvider(), RunUtc, dryRun);
            output.WriteLine($"[EVIDENCE] {precondition} dryRun={dryRun} exit={run.ExitCode}\n{run.Output}");
            run.ExitCode.Should().Be(PurveshDemoReseedCommand.ExitRefused,
                $"'{precondition}' violates a safety precondition: refused, not failed, not done");
        }

        var after = await s.SnapshotAsync();
        H.Diff(before, after).Select(d => $"{d.Table}(-{d.Removed.Count}/+{d.Added.Count})").Should().BeEmpty(
            "a refusal writes nothing, anywhere");
    }

    private static async Task BreakAsync(PurveshDemoReseedScratch s, string precondition)
    {
        var demoFarm = ("farm", (object)PurveshDemoSeeder.DemoFarmId);
        switch (precondition)
        {
            case "demo-login-missing":
                // Nobody holds the demo phone any more (the login was re-numbered).
                await H.ExecAsync(s.SuperuserConn,
                    "UPDATE public.users SET phone = '9899999999' WHERE phone = @phone",
                    ("phone", PurveshDemoSeeder.DemoOwnerPhone));
                (await H.CountAsync(s.SuperuserConn, "SELECT count(*) FROM public.users WHERE phone = @phone",
                    ("phone", PurveshDemoSeeder.DemoOwnerPhone))).Should().Be(0);
                break;

            case "farm-renamed":
                await H.ExecAsync(s.SuperuserConn,
                    "UPDATE ssf.farms SET name = name || ' (माझे खरे शेत)' WHERE \"Id\" = @farm", demoFarm);
                break;

            case "farm-owned-by-another-login":
                await H.ExecAsync(s.SuperuserConn,
                    "UPDATE ssf.farms SET owner_user_id = @other WHERE \"Id\" = @farm",
                    demoFarm, ("other", s.Template.StrangerOwnerId));
                break;

            case "a-demo-plot-missing":
                await H.ExecAsync(s.SuperuserConn, """
                    SET session_replication_role = replica;
                    DELETE FROM ssf.plots WHERE "Id" = (SELECT "Id" FROM ssf.plots WHERE farm_id = @farm ORDER BY "Id" LIMIT 1);
                    """, demoFarm);
                (await H.CountAsync(s.SuperuserConn, "SELECT count(*) FROM ssf.plots WHERE farm_id = @farm", demoFarm))
                    .Should().Be(3);
                break;

            case "pending-migration":
                // The database is one migration behind this binary.
                await H.ExecAsync(s.SuperuserConn, """
                    DELETE FROM ssf."__ef_migrations"
                    WHERE "MigrationId" = (SELECT max("MigrationId") FROM ssf."__ef_migrations");
                    """);
                break;

            default:
                throw new ArgumentOutOfRangeException(nameof(precondition), precondition, null);
        }
    }
}
