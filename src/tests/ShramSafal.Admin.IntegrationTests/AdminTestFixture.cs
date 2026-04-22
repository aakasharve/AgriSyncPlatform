using Accounts.Infrastructure.Persistence;
using AgriSync.BuildingBlocks.Analytics;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using ShramSafal.Application.Admin.Ports;
using ShramSafal.Infrastructure.Admin;
using ShramSafal.Infrastructure.Persistence;
using User.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Admin.IntegrationTests;

/// <summary>
/// Per-assembly fixture that stands up a dedicated test database on the
/// developer's local Postgres (port 5433). Docker-free by design — the plan
/// originally called for Testcontainers; this repo does not require Docker
/// so we use the same Postgres server that `dotnet ef database update`
/// already targets.
///
/// Lifecycle:
///   InitializeAsync  → DROP + CREATE agrisync_admin_test → MigrateAsync() → build DI
///   DisposeAsync     → DROP agrisync_admin_test
///
/// Parallel safety: tests within the fixture share the one DB; tests use
/// unique GUIDs so they never collide on keys. Across assemblies, each
/// assembly gets its own fixture name.
///
/// Connection override: ADMIN_TESTS_ADMIN_ROOT_CONN environment variable
/// points to the maintenance DB (default: the repo's standard dev Postgres).
/// </summary>
public sealed class AdminTestFixture : IAsyncLifetime
{
    private const string TestDbName = "agrisync_admin_test";

    private const string DefaultRootConnectionString =
        "Host=localhost;Port=5433;Database=postgres;Username=postgres;Password=akash123";

    private readonly string _rootConnString;
    private readonly string _testConnString;

    public IServiceProvider Services { get; private set; } = default!;

    public string ConnectionString => _testConnString;

    public AdminTestFixture()
    {
        _rootConnString = Environment.GetEnvironmentVariable("ADMIN_TESTS_ADMIN_ROOT_CONN")
                         ?? DefaultRootConnectionString;

        var builder = new NpgsqlConnectionStringBuilder(_rootConnString) { Database = TestDbName };
        _testConnString = builder.ConnectionString;
    }

    public async Task InitializeAsync()
    {
        await DropDatabaseIfExistsAsync();
        await CreateDatabaseAsync();

        var services = new ServiceCollection();
        services.AddLogging();

        // Four DbContexts — ShramSafal migrations reference accounts.subscriptions
        // (view projection) AND analytics.events (mis.admin_scope_health matview),
        // so all prior schemas must exist before ShramSafal migrates. Order
        // mirrors the real Bootstrapper boot sequence.
        services.AddDbContext<UserDbContext>(o => o.UseNpgsql(_testConnString));
        services.AddDbContext<AccountsDbContext>(o => o.UseNpgsql(_testConnString));
        services.AddDbContext<AnalyticsDbContext>(o => o.UseNpgsql(_testConnString));
        services.AddDbContext<ShramSafalDbContext>(o => o.UseNpgsql(_testConnString));

        // Production Infrastructure bindings for the three admin ports.
        services.AddScoped<IEntitlementResolver, EntitlementResolver>();
        services.AddScoped<IOrgFarmScopeProjector, OrgFarmScopeProjector>();
        services.AddSingleton<IResponseRedactor, ResponseRedactor>();

        // Test-only fake for the analytics port — captures emits in memory so
        // tests can assert on the resolver's observability contract.
        services.AddSingleton<FakeAnalyticsWriter>();
        services.AddSingleton<IAnalyticsWriter>(sp => sp.GetRequiredService<FakeAnalyticsWriter>());

        Services = services.BuildServiceProvider();

        await using var scope = Services.CreateAsyncScope();

        // Analytics first: it uses EnsureCreated (no migrations), which no-ops
        // on a DB that already has ANY tables. So it must run on the empty DB
        // before any MigrateAsync call lands objects in other schemas.
        await scope.ServiceProvider.GetRequiredService<AnalyticsDbContext>().Database.EnsureCreatedAsync();
        await scope.ServiceProvider.GetRequiredService<UserDbContext>().Database.MigrateAsync();
        await scope.ServiceProvider.GetRequiredService<AccountsDbContext>().Database.MigrateAsync();
        await scope.ServiceProvider.GetRequiredService<ShramSafalDbContext>().Database.MigrateAsync();
    }

    public async Task DisposeAsync()
    {
        if (Services is IAsyncDisposable async) await async.DisposeAsync();
        else if (Services is IDisposable sync) sync.Dispose();

        await DropDatabaseIfExistsAsync();
    }

    public FakeAnalyticsWriter GetAnalyticsFake()
        => Services.GetRequiredService<FakeAnalyticsWriter>();

    private async Task CreateDatabaseAsync()
    {
        await using var conn = new NpgsqlConnection(_rootConnString);
        await conn.OpenAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = $"CREATE DATABASE \"{TestDbName}\"";
        await cmd.ExecuteNonQueryAsync();
    }

    private async Task DropDatabaseIfExistsAsync()
    {
        await using var conn = new NpgsqlConnection(_rootConnString);
        await conn.OpenAsync();

        // Terminate any existing backends on the test DB so DROP doesn't block.
        await using (var kill = conn.CreateCommand())
        {
            kill.CommandText =
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity " +
                "WHERE datname = @db AND pid <> pg_backend_pid()";
            kill.Parameters.AddWithValue("db", TestDbName);
            await kill.ExecuteNonQueryAsync();
        }

        await using var drop = conn.CreateCommand();
        drop.CommandText = $"DROP DATABASE IF EXISTS \"{TestDbName}\"";
        await drop.ExecuteNonQueryAsync();
    }
}

[CollectionDefinition(nameof(AdminTestCollection))]
public sealed class AdminTestCollection : ICollectionFixture<AdminTestFixture> { }
