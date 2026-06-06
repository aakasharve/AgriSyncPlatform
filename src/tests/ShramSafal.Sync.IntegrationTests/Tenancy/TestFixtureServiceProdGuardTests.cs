// spec: test-fixture-service-runtime-2026-06-06
using System.Threading.Tasks;
using AgriSync.Bootstrapper.Infrastructure;
using Microsoft.Extensions.Hosting;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Tenancy;

public sealed class TestFixtureServiceProdGuardTests
{
    [Fact]
    public async Task Reset_in_production_throws_TestFixturesDisabled_and_touches_no_db()
    {
        // env = Production, flags ON, allowlist non-empty: must STILL refuse.
        var svc = TestFixtureServiceFactory.ForTest(
            environmentName: Environments.Production,
            allowReset: true, allowSeed: true,
            allowedOwnerAccountIds: [System.Guid.NewGuid()],
            ssf: null!); // null ctx proves the guard runs BEFORE any DB access

        var ex = await Assert.ThrowsAsync<TestFixturesDisabledException>(
            () => svc.ResetFixtureAsync("purvesh-demo"));
        Assert.Contains("production", ex.Message, System.StringComparison.OrdinalIgnoreCase);
    }
}
