// spec: test-fixture-service-runtime-2026-06-06
using AgriSync.Bootstrapper.Infrastructure;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;

namespace ShramSafal.Sync.IntegrationTests.Tenancy;

internal static class TestFixtureServiceFactory
{
    public static TestFixtureService ForTest(
        string environmentName, bool allowReset, bool allowSeed,
        System.Collections.Generic.List<System.Guid> allowedOwnerAccountIds,
        ShramSafal.Infrastructure.Persistence.ShramSafalDbContext ssf)
    {
        var env = new FakeHostEnvironment { EnvironmentName = environmentName };
        var opts = Options.Create(new TestFixtureOptions
        {
            AllowRuntimeReset = allowReset,
            AllowRuntimeSeed = allowSeed,
            AllowedOwnerAccountIds = allowedOwnerAccountIds,
        });
        var services = new SingleInstanceProvider(ssf);
        return new TestFixtureService(env, opts, services, NullLogger<TestFixtureService>.Instance);
    }

    private sealed class FakeHostEnvironment : IHostEnvironment
    {
        public string EnvironmentName { get; set; } = Environments.Development;
        public string ApplicationName { get; set; } = "tests";
        public string ContentRootPath { get; set; } = ".";
        public Microsoft.Extensions.FileProviders.IFileProvider ContentRootFileProvider { get; set; } = null!;
    }

    private sealed class SingleInstanceProvider(
        ShramSafal.Infrastructure.Persistence.ShramSafalDbContext ssf) : System.IServiceProvider
    {
        public object? GetService(System.Type t) =>
            t == typeof(ShramSafal.Infrastructure.Persistence.ShramSafalDbContext) ? ssf : null;
    }
}
