// spec: test-fixture-service-runtime-2026-06-06
/// <summary>
/// Proves the seed guard fires before any DI/DB access, Docker-free.
///
/// NOTE: The full seed happy-path (e.g. purvesh 4 plots/136 logs) is covered by the live
/// Playwright e2e suite (e2e.yml, ramu-demo fixture) and is deferred for purvesh pending
/// the RLS-safe-seeder fix (see interceptor-write-rowsaffected-desync spec). This class
/// only proves the seed-disabled guard, requiring no Docker or live database.
/// </summary>
using System.Threading.Tasks;
using AgriSync.Bootstrapper.Infrastructure;
using Microsoft.Extensions.Hosting;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Tenancy;

public sealed class TestFixtureServiceSeedGuardTests
{
    [Fact]
    public async Task Seed_when_AllowRuntimeSeed_false_throws_TestFixturesDisabled()
    {
        var svc = TestFixtureServiceFactory.ForTest(
            environmentName: Environments.Development,
            allowReset: true, allowSeed: false,           // seed disabled
            allowedOwnerAccountIds: [System.Guid.NewGuid()],
            ssf: null!);                                   // proves guard runs before DB/DI
        var ex = await Assert.ThrowsAsync<TestFixturesDisabledException>(
            () => svc.SeedFixtureAsync("ramu-demo"));
        Assert.Contains("seed", ex.Message, System.StringComparison.OrdinalIgnoreCase);
    }
}
