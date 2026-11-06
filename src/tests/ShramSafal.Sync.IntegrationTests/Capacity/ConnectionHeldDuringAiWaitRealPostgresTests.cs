// spec: plr-d10-redesign-real-integration-2026-10-25 (lane OPS-1, F36)
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Diagnostics;
using AgriSync.BuildingBlocks.Persistence;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Capacity;

/// <summary>
/// F36 measured on real PostgreSQL: many simultaneous "voice parse" requests, each doing a little database work, then
/// waiting a fixed time on a stand-in model call, then a little more database work, through the REAL
/// <see cref="TenantTransactionMiddleware"/>. The pool is capped (as in production). Without the release the whole
/// wait is spent holding a connection, so throughput is the cap divided by the wait; with it the connection is only
/// held for the database work. The test prints both runs and asserts the release run finished far sooner and that
/// neither run starved a request.
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class ConnectionHeldDuringAiWaitRealPostgresTests(ITestOutputHelper output)
{
    private const int Requests = 60;
    private const int PoolCap = 12;
    private const int ModelWaitMs = 400;

    private sealed class ProbeDb(DbContextOptions<ProbeDb> options) : DbContext(options);

    private sealed class Registry(ProbeDb db) : ITenantScopedDbContextRegistry
    {
        public IReadOnlyList<DbContext> GetWritingContexts(IServiceProvider scopedServices) => new DbContext[] { db };
    }

    private sealed record Run(int Failed, int PeakServerConnections, long ElapsedMs);

    private static async Task<Run> RunAsync(string rootConn, bool release)
    {
        var app = $"ops1-f36-{(release ? "release" : "hold")}-{Guid.NewGuid():N}";
        var builder = new NpgsqlConnectionStringBuilder(rootConn)
        {
            ApplicationName = app,
            MaxPoolSize = PoolCap,
            Timeout = 60,
            Pooling = true,
        };
        var options = new DbContextOptionsBuilder<ProbeDb>().UseNpgsql(builder.ConnectionString).Options;
        var sp = new ServiceCollection().AddScoped<RequestTransactionRelease>().BuildServiceProvider();

        using var stop = new CancellationTokenSource();
        var peak = 0;
        var sampler = Task.Run(async () =>
        {
            await using var monitor = new NpgsqlConnection(new NpgsqlConnectionStringBuilder(rootConn) { Pooling = false }.ConnectionString);
            await monitor.OpenAsync();
            while (!stop.IsCancellationRequested)
            {
                await using var cmd = new NpgsqlCommand("select count(*) from pg_stat_activity where application_name = @a", monitor);
                cmd.Parameters.AddWithValue("a", app);
                var n = Convert.ToInt32(await cmd.ExecuteScalarAsync());
                peak = Math.Max(peak, n);
                await Task.Delay(20);
            }
        });

        var failed = 0;
        var clock = Stopwatch.StartNew();
        var tasks = Enumerable.Range(0, Requests).Select(async _ =>
        {
            try
            {
                await using var db = new ProbeDb(options);
                var http = new DefaultHttpContext { RequestServices = sp.CreateScope().ServiceProvider };
                http.Request.Path = "/shramsafal/ai/voice-parse";
                var rel = http.RequestServices.GetRequiredService<RequestTransactionRelease>();
                var mw = new TenantTransactionMiddleware(async __ =>
                {
                    await db.Database.ExecuteSqlRawAsync("select 1");
                    if (release)
                    {
                        await rel.RunWithoutConnectionsAsync(() => Task.Delay(ModelWaitMs), CancellationToken.None);
                    }
                    else
                    {
                        await Task.Delay(ModelWaitMs);
                    }

                    await db.Database.ExecuteSqlRawAsync("select 1");
                });
                await mw.InvokeAsync(http, new Registry(db), new TenantContext());
            }
            catch (NpgsqlException)
            {
                Interlocked.Increment(ref failed);
            }
        }).ToArray();
        await Task.WhenAll(tasks);
        clock.Stop();
        stop.Cancel();
        await sampler;
        NpgsqlConnection.ClearAllPools();
        return new Run(failed, peak, clock.ElapsedMilliseconds);
    }

    [Fact]
    public async Task Releasing_the_connection_during_the_model_wait_cuts_held_connections_and_time()
    {
        var rootConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();

        var held = await RunAsync(rootConn, release: false);
        var released = await RunAsync(rootConn, release: true);

        output.WriteLine($"[EVIDENCE] {Requests} simultaneous requests, pool cap {PoolCap}, model wait {ModelWaitMs} ms");
        output.WriteLine($"[EVIDENCE] BEFORE (connection held during the wait): peak server connections {held.PeakServerConnections}, elapsed {held.ElapsedMs} ms, failed {held.Failed}");
        output.WriteLine($"[EVIDENCE] AFTER  (connection released during the wait): peak server connections {released.PeakServerConnections}, elapsed {released.ElapsedMs} ms, failed {released.Failed}");

        Assert.Equal(0, held.Failed);
        Assert.Equal(0, released.Failed);
        Assert.True(held.PeakServerConnections <= PoolCap, "the pool cap must bound the server connections");
        Assert.True(held.PeakServerConnections >= PoolCap - 2, "without the release the burst should have used the whole cap");
        Assert.True(released.ElapsedMs < held.ElapsedMs / 2,
            $"with the release the burst should finish in well under half the time ({released.ElapsedMs} vs {held.ElapsedMs} ms)");
    }
}
