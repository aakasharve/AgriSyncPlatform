// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 5, "Own schedule feeds नियोजन")
// ERASURE PROVEN THROUGH THE WHOLE WORKER. The disposition for ssf.schedule_task_events and the slice-5 columns of ssf.planned_work is KEEP (see ErasureWorker.cs),
// carried by a comment that cannot fail - so this suite runs the REAL ErasureWorker through the real service provider over a database holding an answer about a
// sign and a plan linked to an own work, and proves the request reaches Completed and that the rows are untouched (P6: anonymise the person, never the work).
//
// Two subjects: the erased person is (a) the worker who ANSWERED "seen", and (b) the farm owner who made the plan.
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
public sealed class ErasureWorkerScheduleFeedRealPostgresTests : IAsyncLifetime
{
    private static readonly Guid Plot1 = Guid.Parse("5c5d0000-0000-4000-8000-0000000000c1");
    private static readonly Guid Cycle1 = Guid.Parse("5c5d0000-0000-4000-8000-0000000000c2");

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
                VALUES (@plot, @farm, 'sched5 प्लॉट', 1.0, NOW(), NOW());
                INSERT INTO ssf.crop_cycles ("Id", farm_id, plot_id, crop_name, stage, start_date, created_at_utc, modified_at_utc)
                VALUES (@cycle, @farm, @plot, 'grape', 'Vegetative', CURRENT_DATE - 15, NOW(), NOW());
                """, ("plot", Plot1), ("cycle", Cycle1), ("farm", Farm1));
        }

        // One "when seen" work, the owner's plan of it, and the worker's answer "seen" that moved the plan.
        await using (var db = _db.SuperContext())
        {
            var now = DateTime.UtcNow;
            var today = DateOnly.FromDateTime(now);
            var item = OwnScheduleItem.Create(
                new FarmId(Farm1), Plot1, Cycle1, new UserId(Owner1), Content("sign-a", ScheduleTaskTiming.WhenSeen("फुले दिसली", 10)), new UserId(Owner1), now,
                out var revision, out var problem)!;
            problem.Should().BeNull();
            var plan = PlannedWork.CreateFromSchedule(
                PlannedWork.ScheduleIdFor(item.Id, 1), new FarmId(Farm1), item.Name, Plot1, null, null, item.Id, item.TaskKey, 1,
                new ScheduleResolution(new ScheduleWindow(today, today), new ScheduleWindow(today.AddDays(5), today.AddDays(5)), ScheduleDueSource.Record),
                ScheduleSignAnswer.Seen, today, Owner1, now);
            var answer = ScheduleTaskEvent.Create(
                Guid.NewGuid(), new FarmId(Farm1), Plot1, Cycle1, item.Id, item.TaskKey, ScheduleSignAnswer.Seen, today, Worker1, now, out var eventProblem)!;
            eventProblem.Should().BeNull();
            db.OwnScheduleItems.Add(item);
            db.OwnScheduleItemRevisions.Add(revision!);
            db.PlannedWork.Add(plan);
            db.ScheduleTaskEvents.Add(answer);
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
    public async Task Erasing_the_worker_who_answered_completes_and_leaves_the_answer_and_the_plan_as_they_were()
    {
        await using var raw = new NpgsqlConnection(_db.SuperuserConn);
        await raw.OpenAsync();
        var before = await SnapshotAsync(raw);
        before.Events.Should().Be(1, "the rows must really be there, or every assertion below would pass for the wrong reason");
        before.Plans.Should().Be(1);

        await RunOneErasurePassAsync(raw, Worker1);

        (await SnapshotAsync(raw)).Should().Be(before, "KEEP: the answer and the plan it moved are exactly what they were");
    }

    [Fact]
    public async Task Erasing_the_owner_who_made_the_plan_completes_and_changes_nothing_of_the_schedule_feed()
    {
        await using var raw = new NpgsqlConnection(_db.SuperuserConn);
        await raw.OpenAsync();
        var before = await SnapshotAsync(raw);

        await RunOneErasurePassAsync(raw, Owner1);

        (await SnapshotAsync(raw)).Should().Be(before);
    }

    private sealed record Snapshot(long Events, long Plans, string EventRows, string PlanLinks);

    private static async Task<Snapshot> SnapshotAsync(NpgsqlConnection db) => new(
        await CountAsync(db, "SELECT count(*) FROM ssf.schedule_task_events"),
        await CountAsync(db, "SELECT count(*) FROM ssf.planned_work WHERE own_item_id IS NOT NULL"),
        (string)(await ScalarAsync(db, "SELECT coalesce(string_agg(row_to_json(e)::text, '|' ORDER BY id), '') FROM ssf.schedule_task_events e"))!,
        (string)(await ScalarAsync(db, """
            SELECT coalesce(string_agg(concat_ws(',', id, own_item_id, schedule_task_key, occurrence, schedule_due_on, expected_from, expected_to, sign_answer,
                                                 planned_date, status), '|' ORDER BY id), '')
            FROM ssf.planned_work WHERE own_item_id IS NOT NULL
            """))!);

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

        status.Should().Be((int)ErasureStatus.Completed, "the real ErasureWorker must complete the request with an answer and a linked plan present");
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
