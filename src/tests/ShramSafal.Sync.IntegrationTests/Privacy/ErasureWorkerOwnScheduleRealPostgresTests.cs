// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 3, "Own schedule store and make main")
// ERASURE PROVEN THROUGH THE WHOLE WORKER. A new erasure step once passed its own tests and then made EVERY erasure end Failed in the real worker (a service it
// asked for did not exist there). The disposition for ssf.own_schedule_items and ssf.own_schedule_item_revisions is KEEP (see ErasureWorker.cs), carried by a
// comment that cannot fail - so this suite runs the REAL ErasureWorker through the real service provider over a database holding rows in both tables, and proves
// the request reaches Completed and that the rows are untouched (P6: anonymise the person, never the work).
//
// Two subjects: the erased person is (a) the OWNER of the farm whose works name him as owner_user_id, and (b) the seat-holder who TYPED a work for that owner.
using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using ShramSafal.Application.Privacy.Ports;
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.Privacy;
using ShramSafal.Infrastructure;
using ShramSafal.Infrastructure.Privacy;
using Xunit;
using static ShramSafal.Sync.IntegrationTests.Planning.ScheduleTaskDb;

namespace ShramSafal.Sync.IntegrationTests.Privacy;

[Trait("Category", "RequiresPostgres")]
public sealed class ErasureWorkerOwnScheduleRealPostgresTests : IAsyncLifetime
{
    private static readonly Guid Plot1 = Guid.Parse("5c3d0000-0000-4000-8000-0000000000c1");
    private static readonly Guid Cycle1 = Guid.Parse("5c3d0000-0000-4000-8000-0000000000c2");

    private readonly Planning.ScheduleTaskDb _db = new();
    private ServiceProvider _provider = default!;

    public async Task InitializeAsync()
    {
        await _db.InitializeAsync();

        await using (var raw = new NpgsqlConnection(_db.SuperuserConn))
        {
            await raw.OpenAsync();
            await ExecAsync(raw, """
                INSERT INTO ssf.plots ("Id", farm_id, name, area_in_acres, created_at_utc, modified_at_utc)
                VALUES (@plot, @farm, 'sched3 प्लॉट', 1.0, NOW(), NOW());
                INSERT INTO ssf.crop_cycles ("Id", farm_id, plot_id, crop_name, stage, start_date, created_at_utc, modified_at_utc)
                VALUES (@cycle, @farm, @plot, 'grape', 'Vegetative', CURRENT_DATE - 15, NOW(), NOW());
                """, ("plot", Plot1), ("cycle", Cycle1), ("farm", Farm1));
        }

        // Two works on owner 1's farm: one he saved, one his worker typed for him (and then changed: two revisions).
        await using (var db = _db.SuperContext())
        {
            var now = DateTime.UtcNow;
            var a = OwnScheduleItem.Create(new FarmId(Farm1), Plot1, Cycle1, new UserId(Owner1), Content("own-a"), new UserId(Owner1), now, out var ra, out var pa)!;
            pa.Should().BeNull();
            var b = OwnScheduleItem.Create(new FarmId(Farm1), Plot1, Cycle1, new UserId(Owner1), Content("own-b"), new UserId(Worker1), now, out var rb, out _)!;
            b.Save(Content("own-b") with { Name = "काम own-b बदल" }, new UserId(Owner1), new UserId(Worker1), now.AddMinutes(1), out var rb2, out _).Should().BeTrue();
            db.OwnScheduleItems.AddRange(a, b);
            db.OwnScheduleItemRevisions.AddRange(ra!, rb!, rb2!);
            await db.SaveChangesAsync();
        }

        var services = new ServiceCollection();
        services.AddLogging();
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:ShramSafalDb"] = _db.SuperuserConn,
                ["ConnectionStrings:ShramSafalDb_Migration"] = _db.SuperuserConn,
                ["ConnectionStrings:UserDb"] = _db.SuperuserConn,
            })
            .Build();
        services.AddSingleton<IConfiguration>(config);
        services.AddShramSafalInfrastructure(config);
        services.AddSingleton<IRetainedBlobStore, InMemoryRetainedBlobStore>();
        _provider = services.BuildServiceProvider();
    }

    public async Task DisposeAsync()
    {
        if (_provider is not null)
        {
            await _provider.DisposeAsync();
        }

        await _db.DisposeAsync();
    }

    [Fact]
    public async Task Erasing_the_farm_owner_completes_and_leaves_his_own_schedule_works_and_history_as_they_were()
    {
        await using var raw = new NpgsqlConnection(_db.SuperuserConn);
        await raw.OpenAsync();
        var before = await SnapshotAsync(raw);
        before.Items.Should().Be(2, "the rows must really be there, or every assertion below would pass for the wrong reason");
        before.Revisions.Should().Be(3);

        await RunOneErasurePassAsync(raw, Owner1);

        (await SnapshotAsync(raw)).Should().Be(before, "KEEP: every work, every revision and every hash is exactly what it was");
    }

    [Fact]
    public async Task Erasing_the_seat_holder_who_typed_a_work_completes_and_changes_nothing_of_the_owners_schedule()
    {
        await using var raw = new NpgsqlConnection(_db.SuperuserConn);
        await raw.OpenAsync();
        var before = await SnapshotAsync(raw);
        (await CountAsync(raw, "SELECT count(*) FROM ssf.own_schedule_item_revisions WHERE by_user_id = @u", ("u", Worker1))).Should().Be(2);

        await RunOneErasurePassAsync(raw, Worker1);

        (await SnapshotAsync(raw)).Should().Be(before, "the work is the owner's schedule's; erasing the person who typed it does not touch it");
    }

    private sealed record Snapshot(long Items, long Revisions, string ItemRows, string RevisionRows);

    private static async Task<Snapshot> SnapshotAsync(NpgsqlConnection db)
    {
        var items = (string)(await ScalarAsync(db, "SELECT coalesce(string_agg(row_to_json(i)::text, '|' ORDER BY id), '') FROM ssf.own_schedule_items i"))!;
        var revisions = (string)(await ScalarAsync(db, "SELECT coalesce(string_agg(row_to_json(r)::text, '|' ORDER BY id), '') FROM ssf.own_schedule_item_revisions r"))!;
        return new Snapshot(
            await CountAsync(db, "SELECT count(*) FROM ssf.own_schedule_items"),
            await CountAsync(db, "SELECT count(*) FROM ssf.own_schedule_item_revisions"),
            items,
            revisions);
    }

    /// <summary>Runs the real worker until the request reaches a terminal status; asserts Completed.</summary>
    private async Task RunOneErasurePassAsync(NpgsqlConnection raw, Guid userId)
    {
        var requestId = Guid.NewGuid();
        await using (var seed = new NpgsqlConnection(_db.SuperuserConn))
        {
            await seed.OpenAsync();
            await ExecAsync(seed, """
                INSERT INTO ssf.erasure_requests (id, requested_by_user_id, on_behalf_of_user_id, status, requested_at_utc)
                VALUES (@id, @uid, NULL, 0, NOW() - INTERVAL '31 days');
                """, ("id", requestId), ("uid", userId));
        }

        var worker = new ErasureWorker(_provider.GetRequiredService<IServiceScopeFactory>(), NullLogger<ErasureWorker>.Instance);
        using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(120));
        var workerTask = worker.StartAsync(cts.Token);

        var status = (int)ErasureStatus.Requested;
        var deadline = DateTime.UtcNow.AddSeconds(90);
        while (DateTime.UtcNow < deadline)
        {
            status = (int)(await ScalarAsync(raw, "SELECT status FROM ssf.erasure_requests WHERE id = @id", ("id", requestId)))!;
            if (status == (int)ErasureStatus.Completed || status == (int)ErasureStatus.Failed)
            {
                break;
            }

            await Task.Delay(TimeSpan.FromMilliseconds(200), CancellationToken.None);
        }

        cts.Cancel();
        try
        {
            await workerTask;
        }
        catch (OperationCanceledException)
        {
        }

        status.Should().Be((int)ErasureStatus.Completed, "the real ErasureWorker must complete the request with rows in the own-schedule tables");
    }

    private static async Task<object?> ScalarAsync(NpgsqlConnection db, string sql, params (string Name, object Value)[] args)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in args)
        {
            cmd.Parameters.AddWithValue(name, value);
        }

        return await cmd.ExecuteScalarAsync();
    }

    private static async Task<long> CountAsync(NpgsqlConnection db, string sql, params (string Name, object Value)[] args) =>
        Convert.ToInt64(await ScalarAsync(db, sql, args));
}
