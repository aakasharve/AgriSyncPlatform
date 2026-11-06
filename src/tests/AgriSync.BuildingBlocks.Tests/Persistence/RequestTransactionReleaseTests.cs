// spec: plr-d10-redesign-real-integration-2026-10-25 (lane OPS-1, F36)
using AgriSync.BuildingBlocks.Persistence;
using Microsoft.AspNetCore.Http;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace AgriSync.BuildingBlocks.Tests.Persistence;

/// <summary>
/// F36: a slow call that does not use the database (an AI provider, a retry back-off) must not keep the request's
/// database connection checked out. The middleware opens a transaction per context at the start of the request, and
/// a transaction owns its connection, so before this change every voice parse held two pooled connections for the
/// whole model wait. These tests drive the REAL middleware and prove, with a real (file) database:
///   1. while the work runs the context has no open transaction and its connection is closed,
///   2. what was saved before the call is committed (survives a failure of the work),
///   3. afterwards the request has a transaction again and the middleware commits the later write,
///   4. a failure inside the work still leaves the request with a transaction to roll back.
/// </summary>
public sealed class RequestTransactionReleaseTests : IDisposable
{
    private readonly string _dbFile = Path.Combine(Path.GetTempPath(), $"ops1-release-{Guid.NewGuid():N}.db");

    public void Dispose()
    {
        SqliteConnection.ClearAllPools();
        try
        {
            File.Delete(_dbFile);
        }
        catch (IOException)
        {
            // A leftover temp file is harmless; the pool was cleared above.
        }
    }

    private sealed class Row
    {
        public int Id { get; set; }
        public string Name { get; set; } = "";
    }

    private sealed class TestDb(DbContextOptions<TestDb> options) : DbContext(options)
    {
        public DbSet<Row> Rows => Set<Row>();
    }

    private sealed class SingleContextRegistry(TestDb db) : ITenantScopedDbContextRegistry
    {
        public IReadOnlyList<DbContext> GetWritingContexts(IServiceProvider scopedServices) => new DbContext[] { db };
    }

    private (TestDb Db, ServiceProvider Services) Build()
    {
        var options = new DbContextOptionsBuilder<TestDb>().UseSqlite($"Data Source={_dbFile}").Options;
        var db = new TestDb(options);
        db.Database.EnsureCreated();
        var services = new ServiceCollection().AddScoped<RequestTransactionRelease>().BuildServiceProvider();
        return (db, services);
    }

    private int CountRows()
    {
        using var verify = new TestDb(new DbContextOptionsBuilder<TestDb>().UseSqlite($"Data Source={_dbFile}").Options);
        return verify.Rows.Count();
    }

    private static HttpContext Http(ServiceProvider root)
    {
        var http = new DefaultHttpContext { RequestServices = root.CreateScope().ServiceProvider };
        http.Request.Path = "/shramsafal/ai/voice-parse";
        return http;
    }

    [Fact]
    public async Task Connection_is_closed_and_work_is_committed_while_the_slow_call_waits()
    {
        var (db, root) = Build();
        using var _ = root;
        using var __ = db;
        var http = Http(root);
        var release = http.RequestServices.GetRequiredService<RequestTransactionRelease>();

        bool txOpenDuringWork = true;
        bool connectionOpenDuringWork = true;
        int rowsVisibleToOthersDuringWork = -1;

        var middleware = new TenantTransactionMiddleware(async _ =>
        {
            db.Rows.Add(new Row { Name = "before-call" });
            await db.SaveChangesAsync();

            await release.RunWithoutConnectionsAsync(async () =>
            {
                txOpenDuringWork = db.Database.CurrentTransaction is not null;
                connectionOpenDuringWork = db.Database.GetDbConnection().State == System.Data.ConnectionState.Open;
                rowsVisibleToOthersDuringWork = CountRows();
                await Task.Yield();
            }, CancellationToken.None);

            db.Rows.Add(new Row { Name = "after-call" });
            await db.SaveChangesAsync();
            Assert.NotNull(db.Database.CurrentTransaction);
        });

        await middleware.InvokeAsync(http, new SingleContextRegistry(db), new TenantContext());

        Assert.False(txOpenDuringWork, "the request transaction (and so its pooled connection) must be released during the wait");
        Assert.False(connectionOpenDuringWork, "the connection must be closed while the slow call waits");
        Assert.Equal(1, rowsVisibleToOthersDuringWork);
        Assert.Equal(2, CountRows());
        Assert.Equal(1, release.ReleaseCount);
    }

    [Fact]
    public async Task A_failure_inside_the_slow_call_leaves_a_transaction_to_roll_back_and_keeps_the_saved_row()
    {
        var (db, root) = Build();
        using var _ = root;
        using var __ = db;
        var http = Http(root);
        var release = http.RequestServices.GetRequiredService<RequestTransactionRelease>();

        var middleware = new TenantTransactionMiddleware(async _ =>
        {
            db.Rows.Add(new Row { Name = "saved-before-call" });
            await db.SaveChangesAsync();

            await release.RunWithoutConnectionsAsync<int>(
                () => throw new InvalidOperationException("provider exploded"),
                CancellationToken.None);
        });

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            middleware.InvokeAsync(http, new SingleContextRegistry(db), new TenantContext()));

        // The row saved before the call was committed by the release; the later rollback does not undo it.
        Assert.Equal(1, CountRows());
        Assert.Null(db.Database.CurrentTransaction);
    }

    [Fact]
    public async Task Without_an_open_request_transaction_the_work_just_runs()
    {
        var release = new RequestTransactionRelease();
        var ran = false;

        var result = await release.RunWithoutConnectionsAsync(() =>
        {
            ran = true;
            return Task.FromResult(42);
        }, CancellationToken.None);

        Assert.True(ran);
        Assert.Equal(42, result);
        Assert.Equal(0, release.ReleaseCount);
    }

    [Fact]
    public async Task Unsaved_changes_are_not_lost_and_are_saved_in_the_new_transaction()
    {
        var (db, root) = Build();
        using var _ = root;
        using var __ = db;
        var http = Http(root);
        var release = http.RequestServices.GetRequiredService<RequestTransactionRelease>();

        var middleware = new TenantTransactionMiddleware(async _ =>
        {
            db.Rows.Add(new Row { Name = "tracked-not-saved" });
            await release.RunWithoutConnectionsAsync(() => Task.CompletedTask, CancellationToken.None);
            await db.SaveChangesAsync();
        });

        await middleware.InvokeAsync(http, new SingleContextRegistry(db), new TenantContext());

        Assert.Equal(1, CountRows());
    }
}
