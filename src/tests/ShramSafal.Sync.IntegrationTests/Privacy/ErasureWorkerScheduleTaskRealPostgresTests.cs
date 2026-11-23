// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 2, "Task format and three timers")
// ERASURE PROVEN THROUGH THE WHOLE WORKER. A lesson of this project: a new erasure step once passed its own tests and then made EVERY erasure end Failed in the real
// worker (a service it asked for did not exist there). The disposition for ssf.schedule_tasks and ssf.schedule_challenges is KEEP (see ErasureWorker.cs), and a KEEP is carried
// by a comment, which cannot fail - so this suite runs the REAL ErasureWorker, through the real service provider, over a database that holds rows in both new tables, and proves
// the request reaches Completed and that the tables are untouched. If a step is ever added that cannot run against them (an UPDATE on an append-only table, a missing service), this fails.
//
// Two subjects, one schedule: the erased person is (a) the OWNER of a schedule whose tasks name him as owner_user_id, and (b) the TYPIST who made the version for that owner.
// Both erasures complete and leave the schedule, its tasks and its challenges exactly as they were (P6: anonymise the person, never the work).
using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Npgsql;
using ShramSafal.Application.Privacy.Ports;
using ShramSafal.Domain.Privacy;
using ShramSafal.Infrastructure;
using ShramSafal.Infrastructure.Privacy;
using Xunit;
using static ShramSafal.Sync.IntegrationTests.Planning.ScheduleTaskDb;

namespace ShramSafal.Sync.IntegrationTests.Privacy;

[Trait("Category", "RequiresPostgres")]
public sealed class ErasureWorkerScheduleTaskRealPostgresTests : IAsyncLifetime
{
    private readonly Planning.ScheduleTaskDb _db = new();
    private ServiceProvider _provider = default!;

    public async Task InitializeAsync()
    {
        await _db.InitializeAsync();

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
    public async Task Erasing_the_owner_of_a_schedule_completes_and_leaves_its_tasks_and_challenges_as_they_were()
    {
        await using var raw = new NpgsqlConnection(_db.SuperuserConn);
        await raw.OpenAsync();
        var before = await SnapshotAsync(raw);
        before.Tasks.Should().Be(4, "the rows must really be there before the run, or every assertion below would pass for the wrong reason");
        before.Challenges.Should().Be(4);
        (await CountAsync(raw, "SELECT count(*) FROM ssf.schedule_tasks WHERE owner_user_id = @u", ("u", Owner1))).Should().Be(1);

        await RunOneErasurePassAsync(raw, Owner1);

        (await SnapshotAsync(raw)).Should().Be(before, "KEEP: the tasks and challenges (and every hash) are exactly what they were");
        (await CountAsync(raw, "SELECT count(*) FROM ssf.schedule_tasks WHERE owner_user_id = @u", ("u", Owner1)))
            .Should().Be(1, "the opaque owner id stays, as schedule_templates.owner_user_id does; no name is beside it");
        (await CountAsync(raw, "SELECT count(*) FROM ssf.schedule_templates WHERE \"Id\" = @id AND owner_user_id = @u", ("id", Team1Id), ("u", Owner1))).Should().Be(1);
    }

    [Fact]
    public async Task Erasing_the_typist_who_made_a_version_for_its_owner_completes_and_changes_nothing_of_the_schedule()
    {
        await using var raw = new NpgsqlConnection(_db.SuperuserConn);
        await raw.OpenAsync();
        var before = await SnapshotAsync(raw);

        await RunOneErasurePassAsync(raw, Worker1);

        (await SnapshotAsync(raw)).Should().Be(before);
        (await CountAsync(raw, "SELECT count(*) FROM ssf.schedule_tasks WHERE task_key = @k AND owner_user_id = @o", ("k", Team1Task), ("o", Owner1)))
            .Should().Be(1, "the task is the OWNER's schedule's; erasing the person who typed it does not touch it");
    }

    private sealed record Snapshot(long Tasks, long Challenges, string TaskHashes, string ChallengeHashes);

    private static async Task<Snapshot> SnapshotAsync(NpgsqlConnection db)
    {
        async Task<string> Hashes(string table) => (string)(await ScalarAsync(db, $"SELECT coalesce(string_agg(content_hash || owner_user_id::text || tenant_scope::text, ',' ORDER BY id), '') FROM {table}"))!;
        return new Snapshot(
            await CountAsync(db, "SELECT count(*) FROM ssf.schedule_tasks"),
            await CountAsync(db, "SELECT count(*) FROM ssf.schedule_challenges"),
            await Hashes("ssf.schedule_tasks"),
            await Hashes("ssf.schedule_challenges"));
    }

    /// <summary>Runs the real worker until the request reaches a terminal status; asserts Completed. Polls rather than sleeping a fixed interval (a widening manifest outgrows any budget).</summary>
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

        status.Should().Be((int)ErasureStatus.Completed, "the real ErasureWorker must complete the request with rows in the new tables");
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
