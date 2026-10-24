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
/// spec: 2026-08-25-prod-cutover-waves (demo-seed-v3) — the STARTUP whole-farm functions,
/// <see cref="PurveshDemoSeeder.ClearPurveshDemoAsync"/> and
/// <see cref="PurveshDemoSeeder.SeedPurveshDemoAsync"/>, refuse in a Production host BEFORE they touch
/// the database. Each throws <see cref="PurveshDemoStartupSeedRefusedException"/> whose message
/// starts with the method's own name and a colon and carries
/// <see cref="PurveshDemoSeeder.ProductionRefusalMessage"/>; the database is byte-identical
/// afterwards; and the refusal comes before any connection is even opened. Development is
/// unchanged: the very same call in a Development host still clears the demo farm.
/// </summary>
/// <remarks>
/// <para>Driven the way Program.cs drives the startup path: the seeder is resolved from a
/// production-shaped DI graph in a scope elevated with
/// <see cref="TenantContext.ElevateToAdminCrossTenant"/>, and the host environment is the
/// <c>IHostEnvironment</c> that graph registers. Both connections the path can meet are proven: the
/// superuser one and <c>agrisync_app</c> (non-superuser, no BYPASSRLS).</para>
/// <para>The template carries no non-seed worker, so the Development contrast can actually clear
/// (a non-seed worker makes the clear refuse by design — pinned elsewhere).</para>
/// </remarks>
[Trait("Category", "RequiresPostgres")]
public sealed class PurveshDemoStartupSeedProductionRefusalRealPostgresTests(
    PurveshDemoReseedTemplateWithoutNonSeedWorkerFixture fixture, ITestOutputHelper output)
    : IClassFixture<PurveshDemoReseedTemplateWithoutNonSeedWorkerFixture>
{
    private const string Clear = nameof(PurveshDemoSeeder.ClearPurveshDemoAsync);
    private const string Seed = nameof(PurveshDemoSeeder.SeedPurveshDemoAsync);

    [Theory]
    [InlineData("superuser")]
    [InlineData("agrisync_app")]
    public async Task In_Production_the_startup_clear_and_seed_refuse_and_the_database_stays_byte_identical(string connectAs)
    {
        await using var s = await PurveshDemoReseedScratch.CloneAsync(fixture.Template);
        if (connectAs == "agrisync_app")
        {
            (await H.CanBypassRlsAsync(s.AppConn)).Should().BeFalse("the app-role proof must not be able to bypass RLS");
        }

        var before = await s.SnapshotAsync();
        before.Rows("ssf.farms").Should().Contain(
            r => r.StartsWith("(" + PurveshDemoSeeder.DemoFarmId.ToString("D") + ",", StringComparison.Ordinal),
            "arrange: the demo farm these methods would delete or rebuild is present");

        var production = ProviderFor(s, connectAs, "Production");
        await AssertRefusedAsync(production, Clear, seeder => seeder.ClearPurveshDemoAsync());
        await AssertRefusedAsync(production, Seed, seeder => seeder.SeedPurveshDemoAsync());

        H.Diff(before, await s.SnapshotAsync())
            .Select(d => $"{d.Table}(-{d.Removed.Count}/+{d.Added.Count})")
            .Should().BeEmpty($"as {connectAs}, a Production refusal happens before the database is touched: "
                + "every row of every table is byte-identical afterwards");
    }

    /// <summary>
    /// "Before touching the database", taken literally: the graph points at an endpoint where nothing
    /// listens. Had either method opened a connection first, the failure would be a connection error,
    /// not the refusal.
    /// </summary>
    [Fact]
    public async Task In_Production_the_refusal_comes_before_any_connection_is_opened()
    {
        const string nowhere =
            "Host=127.0.0.1;Port=1;Database=ssf_reseed_nowhere;Username=nobody;Password=unused;Timeout=3;Pooling=false";
        await using var production = H.BuildProvider(nowhere, "Production");

        await AssertRefusedAsync(production, Clear, seeder => seeder.ClearPurveshDemoAsync());
        await AssertRefusedAsync(production, Seed, seeder => seeder.SeedPurveshDemoAsync());
    }

    /// <summary>
    /// The contrast: the SAME call, on the same kind of clone and connection, in a Development host,
    /// still runs and removes the demo farm — while the other farms stay.
    /// </summary>
    [Theory]
    [InlineData("superuser")]
    [InlineData("agrisync_app")]
    public async Task In_Development_the_same_startup_clear_still_removes_the_demo_farm(string connectAs)
    {
        await using var s = await PurveshDemoReseedScratch.CloneAsync(fixture.Template);
        var development = ProviderFor(s, connectAs, "Development");

        string summary;
        await using (var scope = development.CreateAsyncScope())
        {
            scope.ServiceProvider.GetRequiredService<TenantContext>().ElevateToAdminCrossTenant();
            summary = await scope.ServiceProvider.GetRequiredService<PurveshDemoSeeder>().ClearPurveshDemoAsync();
        }

        output.WriteLine($"[EVIDENCE] Development clear as {connectAs}: {summary}");
        (await FarmCountAsync(s, PurveshDemoSeeder.DemoFarmId)).Should().Be(0,
            "in Development the startup clear still removes the demo farm");
        (await FarmCountAsync(s, fixture.Template.TwinFarmId)).Should().Be(1, "and leaves the other farms");
        (await FarmCountAsync(s, fixture.Template.StrangerFarmId)).Should().Be(1);
    }

    // ── helpers ─────────────────────────────────────────────────────────────

    private static IServiceProvider ProviderFor(PurveshDemoReseedScratch s, string connectAs, string environmentName) =>
        connectAs switch
        {
            "superuser" => s.SuperuserProvider(environmentName: environmentName),
            "agrisync_app" => s.AppProvider(environmentName: environmentName),
            _ => throw new ArgumentOutOfRangeException(nameof(connectAs), connectAs, null),
        };

    private async Task AssertRefusedAsync(
        IServiceProvider provider, string method, Func<PurveshDemoSeeder, Task<string>> call)
    {
        await using var scope = provider.CreateAsyncScope();
        scope.ServiceProvider.GetRequiredService<TenantContext>().ElevateToAdminCrossTenant();
        var seeder = scope.ServiceProvider.GetRequiredService<PurveshDemoSeeder>();

        var act = () => call(seeder);
        var refused = await act.Should().ThrowExactlyAsync<PurveshDemoStartupSeedRefusedException>(
            $"{method} must refuse in a Production host");
        var message = refused.Which.Message;
        output.WriteLine($"[EVIDENCE] {method}: {message}");

        message.Should().StartWith(method + ":", "the refusal starts with the name of the method that refused");
        message.Should().Contain(PurveshDemoSeeder.ProductionRefusalMessage);
    }

    private static Task<long> FarmCountAsync(PurveshDemoReseedScratch s, Guid farmId) =>
        H.CountAsync(s.SuperuserConn, "SELECT count(*) FROM ssf.farms WHERE \"Id\" = @f", ("f", farmId));
}
