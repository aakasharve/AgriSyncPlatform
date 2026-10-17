// spec: 2026-08-25-prod-cutover-waves
using System;
using System.Linq;
using System.Threading.Tasks;
using AgriSync.Bootstrapper.Infrastructure;
using AgriSync.BuildingBlocks.Persistence;
using FluentAssertions;
using Microsoft.Extensions.DependencyInjection;
using Xunit;
using Xunit.Abstractions;
using H = ShramSafal.Sync.IntegrationTests.Labour.PurveshDemoReseedHarness;

namespace ShramSafal.Sync.IntegrationTests.Labour;

/// <summary>
/// spec: 2026-08-25-prod-cutover-waves (demo-seed-v3) — the OLD startup path,
/// <c>CLEAR_PURVESH_DEMO=true</c> (<see cref="PurveshDemoSeeder.ClearPurveshDemoAsync"/>, run by
/// Program.cs in an admin-elevated scope), must still remove the WHOLE demo farm once the v3 reseed
/// has given it a labour layer — workers, engagements, attributions, हजेरी marks — and nothing
/// else: the same-owner same-name twin farm and the stranger farm stay hash-identical, and a login
/// the seeder did not create survives.
/// </summary>
/// <remarks>
/// <para>The clear is driven exactly as Program.cs drives it (DI-resolved seeder, scope elevated
/// with <see cref="TenantContext.ElevateToAdminCrossTenant"/>, Development environment) on BOTH
/// connections it can meet: the superuser one the existing teardown proofs
/// (<see cref="PurveshDemoSeederFieldOperatorTeardownRealPostgresTests"/>) use, and
/// <c>agrisync_app</c> — the role the TRACKED <c>appsettings.Development.json</c> gives the
/// startup path's <c>ShramSafalDb</c>/<c>UserDb</c>, i.e. what a developer's
/// <c>CLEAR_PURVESH_DEMO=true</c> actually runs as.</para>
/// <para>The template here carries NO non-seed worker: a non-seed worker makes the clear refuse by
/// design, which the last test pins after a v3 reseed.</para>
/// </remarks>
[Trait("Category", "RequiresPostgres")]
public sealed class PurveshDemoClearAfterReseedRealPostgresTests(
    PurveshDemoReseedTemplateWithoutNonSeedWorkerFixture fixture, ITestOutputHelper output)
    : IClassFixture<PurveshDemoReseedTemplateWithoutNonSeedWorkerFixture>
{
    private static readonly DateTime RunUtc = new(2026, 3, 10, 6, 30, 0, DateTimeKind.Utc);

    private static readonly string[] LabourLayerTables =
    [
        "ssf.field_operators", "ssf.labour_assignments", "ssf.field_operator_work_rows", "ssf.attendance_marks",
    ];

    /// <summary>Delivery queue / audit trail: not farm content, and not what "the demo farm" means.</summary>
    private static readonly string[] DeliveryAndAuditTables = ["ssf.outbox_messages", "ssf.audit_events"];

    /// <summary>The non-farm rows the v2 clear names in its own summary (users … benefitLedgerEntries).</summary>
    private static readonly string[] SeederGlobalTables =
    [
        "public.users", "public.memberships", "ssf.schedule_templates", "ssf.template_activities",
        "ssf.price_configs", "accounts.owner_accounts", "accounts.owner_account_memberships",
        "accounts.subscriptions", "accounts.referral_codes", "accounts.referral_relationships",
        "accounts.growth_events", "accounts.benefit_ledger_entries",
    ];

    [Theory]
    [InlineData("superuser")]
    [InlineData("agrisync_app")]
    public async Task Clear_removes_the_whole_demo_farm_including_its_labour_layer_and_nothing_else(string connectAs)
    {
        await using var s = await PurveshDemoReseedScratch.CloneAsync(fixture.Template);
        var reseed = await H.RunReseedAsync(s.AppProvider(), RunUtc, dryRun: false);
        reseed.ExitCode.Should().Be(PurveshDemoReseedCommand.ExitOk, reseed.Output);

        var reseeded = await s.SnapshotAsync();
        var demoOwned = await H.OwnedIdsAsync(s.SuperuserConn, PurveshDemoSeeder.DemoFarmId, reseeded);
        foreach (var table in LabourLayerTables)
        {
            reseeded.Rows(table).Count(r => H.Mentions(r, demoOwned)).Should().BeGreaterThan(0,
                $"arrange: the reseed gave the demo farm a labour layer in {table}");
        }

        // A login the seeder never created (another farmer on the same server).
        var bystanderUser = Guid.Parse("5e000000-0000-0000-0000-00000000aa01");
        await H.ExecAsync(s.SuperuserConn, """
            INSERT INTO public.users
            SELECT (jsonb_populate_record(NULL::public.users,
                        to_jsonb(u) || jsonb_build_object('Id', @id, 'phone', '9811111111', 'display_name', 'Bystander'))).*
            FROM public.users u WHERE u.phone = @demoPhone
            """, ("id", bystanderUser), ("demoPhone", PurveshDemoSeeder.DemoOwnerPhone));

        var before = await s.SnapshotAsync();
        var otherFarms = new[] { ("twin", fixture.Template.TwinFarmId), ("stranger", fixture.Template.StrangerFarmId) };
        var otherOwned = await Task.WhenAll(otherFarms.Select(f => H.OwnedIdsAsync(s.SuperuserConn, f.Item2, before)));

        var result = await ClearAsync(s, connectAs);
        output.WriteLine($"[EVIDENCE] clear as {connectAs}: {result}");

        var after = await s.SnapshotAsync();
        var leftovers = after.Tables
            .Where(kv => !DeliveryAndAuditTables.Contains(kv.Key))
            .Select(kv => (Table: kv.Key, Count: kv.Value.Count(r => H.Mentions(r, demoOwned))))
            .Where(x => x.Count > 0)
            .Select(x => $"{x.Table}: {x.Count} row(s)")
            .ToList();
        string.Join("; ", leftovers).Should().BeEmpty(
            $"CLEAR_PURVESH_DEMO (as {connectAs}) removes the whole demo farm — its labour layer included");

        for (var i = 0; i < otherFarms.Length; i++)
        {
            var b = H.Footprint(before, otherOwned[i]);
            b.Count.Should().BeGreaterThan(5);
            H.Sha256(H.Footprint(after, otherOwned[i])).Should().Be(H.Sha256(b),
                $"the {otherFarms[i].Item1} farm must be byte-identical after the demo clear");
        }

        // Nothing else: no row is added or rewritten, and every removed row is either the demo
        // farm's or one of the seeder's own global rows (its logins, account, templates, price
        // configs — the clear's documented scope); a login it did not create survives.
        var diffs = H.Diff(before, after);
        diffs.SelectMany(d => d.Added.Select(r => $"+ {d.Table} {r}")).Should().BeEmpty("a clear only deletes");
        diffs.SelectMany(d => d.Removed.Where(r => !H.Mentions(r, demoOwned) && !SeederGlobalTables.Contains(d.Table))
                .Select(r => $"- {d.Table} {r}"))
            .Should().BeEmpty("outside the demo farm the clear removes only the seeder's own global rows");
        after.Rows("public.users").Should().Contain(
            r => r.StartsWith("(" + bystanderUser.ToString("D") + ",", StringComparison.Ordinal),
            "a login the seeder did not create is not the demo's to delete");
    }

    [Fact]
    public async Task Clear_still_refuses_and_deletes_nothing_when_a_non_seed_worker_joins_the_reseeded_demo_farm()
    {
        await using var s = await PurveshDemoReseedScratch.CloneAsync(fixture.Template);
        var reseed = await H.RunReseedAsync(s.AppProvider(), RunUtc, dryRun: false);
        reseed.ExitCode.Should().Be(PurveshDemoReseedCommand.ExitOk, reseed.Output);

        await H.ExecAsync(s.SuperuserConn, """
            INSERT INTO ssf.field_operators
                ("Id", display_name, display_name_normalized, full_name, originating_farm_id, created_by_user_id, created_at_utc, is_active)
            VALUES (@id, 'खरा कामगार', 'खरा कामगार', NULL, @farm, @owner, NOW(), TRUE);
            """,
            ("id", Guid.NewGuid()), ("farm", PurveshDemoSeeder.DemoFarmId), ("owner", fixture.Template.OwnerUserId));

        var before = await s.SnapshotAsync();
        var act = () => ClearAsync(s, "superuser");
        (await act.Should().ThrowAsync<InvalidOperationException>())
            .WithMessage($"*{PurveshDemoSeeder.NonSeedFieldOperatorDataMessage}*");

        H.Diff(before, await s.SnapshotAsync()).Select(d => d.Table).Should().BeEmpty(
            "the guard is the protection, not a prelude to deletion — the v3 seed workers do not dilute it");
    }

    private static async Task<string> ClearAsync(PurveshDemoReseedScratch s, string connectAs)
    {
        var provider = connectAs switch
        {
            "superuser" => s.SuperuserProvider(environmentName: "Development"),
            "agrisync_app" => s.AppProvider(environmentName: "Development"),
            _ => throw new ArgumentOutOfRangeException(nameof(connectAs), connectAs, null),
        };
        await using var scope = provider.CreateAsyncScope();
        scope.ServiceProvider.GetRequiredService<TenantContext>().ElevateToAdminCrossTenant();
        return await scope.ServiceProvider.GetRequiredService<PurveshDemoSeeder>().ClearPurveshDemoAsync();
    }
}
