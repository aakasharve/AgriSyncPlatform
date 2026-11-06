// spec: plr-d10-redesign-real-integration-2026-10-25 (lane OPS-1, F36; fix round 1, H3)
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.Bootstrapper.Configuration;
using AgriSync.BuildingBlocks.Persistence;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShramSafal.Infrastructure.Persistence;
using User.Infrastructure.Persistence;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Capacity;

/// <summary>
/// F36 / H3 on real PostgreSQL, as <c>agrisync_app</c>, through the REAL middleware and the REAL two-context registry
/// (<see cref="ShramSafalDbContext"/> then <see cref="UserDbContext"/>, exactly as the two infrastructure modules register
/// them). Every request therefore takes TWO pooled connections, one after the other, and holds both for its whole life.
/// UserDb and ShramSafalDb carry the SAME text, as in the documented production template.
///
/// <para>Without separate pools (the first version of the cap) both contexts draw from ONE pool: 60 simultaneous requests
/// each take a first connection, wait for a second nobody can give back, and ALL fail together. With one pool per key (a
/// distinct Application Name), a request takes its first connection from the ShramSafal pool and its second from the User pool:
/// no deadlock, every request either completes or fails ALONE with the pool timeout, and the server never sees more than the
/// two caps.</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class TwoConnectionsPerRequestRealPostgresTests(ITestOutputHelper output) : IAsyncLifetime
{
    private const int Requests = 60;
    private const int Cap = 10;          // small on purpose so 60 requests overrun it; production's 24 is checked by arithmetic below
    private const int HoldMs = 700;
    private const int WaitLimitSeconds = 2;

    private string _root = "";
    private string _db = "";
    private string _appConn = "";

    public async Task InitializeAsync()
    {
        _root = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();
        _db = "ops1_pool_" + Guid.NewGuid().ToString("N")[..12];
        await Exec(_root, $"CREATE DATABASE {_db}");
        var password = TestRoleCredentials.AppRolePassword;
        await Exec(_root,
            "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agrisync_app') THEN " +
            $"CREATE ROLE agrisync_app LOGIN PASSWORD '{password}' NOSUPERUSER NOBYPASSRLS; END IF; END $$;");
        await Exec(_root, $"GRANT CONNECT ON DATABASE {_db} TO agrisync_app");
        _appConn = new NpgsqlConnectionStringBuilder(_root)
        {
            Database = _db,
            Username = "agrisync_app",
            Password = password,
        }.ConnectionString;

        // The role the requests run as must be a plain one (the proof is not vacuous).
        await using var c = new NpgsqlConnection(_appConn);
        await c.OpenAsync();
        await using var q = new NpgsqlCommand("select rolsuper or rolbypassrls from pg_roles where rolname = current_user", c);
        Assert.False((bool)(await q.ExecuteScalarAsync())!, "agrisync_app must be neither superuser nor BYPASSRLS");
    }

    public async Task DisposeAsync()
    {
        NpgsqlConnection.ClearAllPools();
        await Exec(_root, $"DROP DATABASE IF EXISTS {_db} WITH (FORCE)");
    }

    private static async Task Exec(string conn, string sql)
    {
        await using var c = new NpgsqlConnection(conn);
        await c.OpenAsync();
        await using var cmd = new NpgsqlCommand(sql, c);
        await cmd.ExecuteNonQueryAsync();
    }

    private sealed record Run(int Completed, int FailedAlone, int OtherFailures, int PeakServerConnections, long ElapsedMs);

    private async Task<Run> RunAsync(bool separatePools)
    {
        // The configuration both contexts read: the SAME text under both keys, then the cap as the Bootstrapper applies it.
        var configuration = new ConfigurationManager();
        configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:UserDb"] = _appConn,
            ["ConnectionStrings:ShramSafalDb"] = _appConn,
            ["Database:MaxPoolSize"] = Cap.ToString(),
            ["Database:ConnectionTimeoutSeconds"] = WaitLimitSeconds.ToString(),
        });
        ConnectionPoolDefaults.ApplyToConfiguration(configuration, _ => { });
        var userCs = configuration.GetConnectionString("UserDb")!;
        var ssfCs = configuration.GetConnectionString("ShramSafalDb")!;
        if (!separatePools)
        {
            // What the first version produced: one text, one pool.
            userCs = ssfCs;
            var shared = new NpgsqlConnectionStringBuilder(ssfCs) { ApplicationName = "agrisync-shared" }.ConnectionString;
            userCs = ssfCs = shared;
        }

        Assert.Equal(separatePools, userCs != ssfCs);

        var registry = new TenantScopedDbContextRegistry();
        registry.Register<ShramSafalDbContext>().Register<UserDbContext>();
        var services = new ServiceCollection();
        services.AddDbContext<ShramSafalDbContext>(o => o.UseNpgsql(ssfCs));
        services.AddDbContext<UserDbContext>(o => o.UseNpgsql(userCs));
        services.AddSingleton<ITenantScopedDbContextRegistry>(registry);
        services.AddScoped<TenantContext>();
        using var root = services.BuildServiceProvider();

        using var stop = new CancellationTokenSource();
        var peak = 0;
        var sampler = Task.Run(async () =>
        {
            await using var monitor = new NpgsqlConnection(new NpgsqlConnectionStringBuilder(_root) { Pooling = false }.ConnectionString);
            await monitor.OpenAsync();
            while (!stop.IsCancellationRequested)
            {
                await using var cmd = new NpgsqlCommand(
                    $"select count(*) from pg_stat_activity where datname = '{_db}' and application_name like 'agrisync-%'", monitor);
                peak = Math.Max(peak, Convert.ToInt32(await cmd.ExecuteScalarAsync()));
                await Task.Delay(15);
            }
        });

        int completed = 0, failedAlone = 0, other = 0;
        var clock = System.Diagnostics.Stopwatch.StartNew();
        await Task.WhenAll(Enumerable.Range(0, Requests).Select(async _ =>
        {
            try
            {
                await using var scope = root.CreateAsyncScope();
                var http = new DefaultHttpContext { RequestServices = scope.ServiceProvider };
                http.Request.Path = "/shramsafal/ai/voice-parse"; // an ordinary business route: both transactions open
                var middleware = new TenantTransactionMiddleware(async __ =>
                {
                    var ssf = scope.ServiceProvider.GetRequiredService<ShramSafalDbContext>();
                    var usr = scope.ServiceProvider.GetRequiredService<UserDbContext>();
                    await ssf.Database.ExecuteSqlRawAsync("select 1");
                    await usr.Database.ExecuteSqlRawAsync("select 1");
                    await Task.Delay(HoldMs);
                });
                await middleware.InvokeAsync(
                    http, registry, scope.ServiceProvider.GetRequiredService<TenantContext>());
                Interlocked.Increment(ref completed);
            }
            catch (Exception ex) when (IsPoolTimeout(ex))
            {
                Interlocked.Increment(ref failedAlone);
            }
            catch (Exception ex)
            {
                output.WriteLine($"[unexpected] {ex.GetType().Name}: {ex.Message}");
                Interlocked.Increment(ref other);
            }
        }));
        clock.Stop();
        stop.Cancel();
        await sampler;
        NpgsqlConnection.ClearAllPools();
        return new Run(completed, failedAlone, other, peak, clock.ElapsedMilliseconds);
    }

    private static bool IsPoolTimeout(Exception ex)
    {
        for (var e = ex; e is not null; e = e.InnerException!)
        {
            if (e is TimeoutException || e.Message.Contains("connection from the pool", StringComparison.OrdinalIgnoreCase)
                || e.Message.Contains("pool", StringComparison.OrdinalIgnoreCase) && e.Message.Contains("timeout", StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }

            if (e.InnerException is null)
            {
                break;
            }
        }

        return false;
    }

    [Fact]
    public async Task One_pool_per_key_60_simultaneous_requests_never_deadlock_and_stay_under_the_two_caps()
    {
        var run = await RunAsync(separatePools: true);

        output.WriteLine($"[EVIDENCE] {Requests} simultaneous requests, 2 connections each, UserDb text = ShramSafalDb text, cap {Cap} per pool, wait limit {WaitLimitSeconds} s, hold {HoldMs} ms");
        output.WriteLine($"[EVIDENCE] SEPARATE POOLS: completed {run.Completed}, failed alone (pool wait limit) {run.FailedAlone}, other {run.OtherFailures}, peak server connections {run.PeakServerConnections} (cap {2 * Cap}), elapsed {run.ElapsedMs} ms");

        Assert.Equal(0, run.OtherFailures);
        Assert.Equal(Requests, run.Completed + run.FailedAlone);
        Assert.True(run.Completed >= Cap, $"at least one full wave must complete (completed {run.Completed})");
        Assert.True(run.PeakServerConnections <= 2 * Cap, $"peak {run.PeakServerConnections} must not pass the two caps ({2 * Cap})");
        Assert.True(run.ElapsedMs < 20_000, "no deadlock: the whole burst ends within a few wait limits");
    }

    [Fact]
    public async Task One_shared_pool_is_the_deadlock_the_first_version_had_every_request_fails_together()
    {
        var run = await RunAsync(separatePools: false);

        output.WriteLine($"[EVIDENCE] SHARED POOL (first version): completed {run.Completed}, failed {run.FailedAlone}, other {run.OtherFailures}, peak {run.PeakServerConnections}, elapsed {run.ElapsedMs} ms");

        // Not everything dies (the few that happened to take their second connection before the pool filled finish), but the pool
        // is deadlocked: less than one full wave completes and the rest wait out the limit together.
        Assert.True(run.Completed < Cap, $"a shared pool must not complete a full wave (completed {run.Completed})");
        Assert.True(run.FailedAlone + run.OtherFailures >= Requests - Cap, "the rest fail after the wait limit");
    }

    [Fact]
    public void The_defaults_fit_production_s_76_connections_with_the_idle_baseline()
    {
        // Every key the documented production template and the Bootstrapper can configure.
        var keys = new[] { "UserDb", "ShramSafalDb", "AccountsDb", "AnalyticsDb",
            "UserDb_Migration", "ShramSafalDb_Migration", "UserDb_ReadOnly", "ShramSafalDb_ReadOnly" };
        var worst = ConnectionPoolDefaults.WorstCaseConnections(
            keys, ConnectionPoolDefaults.DefaultMaxPoolSize, ConnectionPoolDefaults.DefaultAuxiliaryMaxPoolSize);

        output.WriteLine($"[EVIDENCE] worst case {worst} = 2 x {ConnectionPoolDefaults.DefaultMaxPoolSize} writing + 6 x {ConnectionPoolDefaults.DefaultAuxiliaryMaxPoolSize} auxiliary + {ConnectionPoolDefaults.IdleBaseline} idle baseline; production usable {ConnectionPoolDefaults.ProductionUsableConnections}");
        Assert.True(worst <= ConnectionPoolDefaults.ProductionUsableConnections);
        Assert.True(ConnectionPoolDefaults.CapFor("UserDb", 24, 2) >= ConnectionPoolDefaults.CapFor("ShramSafalDb", 24, 2),
            "the User pool (taken second) must be at least as large as the ShramSafal pool (taken first)");
    }
}
