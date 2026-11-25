// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 12b, "The schedule owner's voice")
// ERASURE PROVEN THROUGH THE WHOLE WORKER. The disposition for ssf.schedule_owner_clips, ssf.schedule_owner_messages and ssf.schedule_owner_message_states is KEEP (see ErasureWorker.cs), carried
// by a comment that cannot fail - so this suite runs the REAL ErasureWorker through the real service provider over a database holding rows in all three tables, and proves the request reaches
// Completed and that the rows are untouched (P6: anonymise the person, never the work). A new erasure step once made EVERY erasure end Failed in the real worker; this is the proof it did not.
//
// Two subjects: the erased person is (a) the OWNER of the farm whose plot heard and decided, and (b) the sender of the messages (an opaque id: ShramSafal staff until slice 15).
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
public sealed class ErasureWorkerOwnerVoiceRealPostgresTests : IAsyncLifetime
{
    private static readonly Guid Plot1 = Guid.Parse("5c3e0000-0000-4000-8000-0000000000c1");
    private static readonly Guid Cycle1 = Guid.Parse("5c3e0000-0000-4000-8000-0000000000c2");

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
                VALUES (@plot, @farm, 'sched12b प्लॉट', 1.0, NOW(), NOW());
                INSERT INTO ssf.crop_cycles ("Id", farm_id, plot_id, crop_name, stage, start_date, created_at_utc, modified_at_utc)
                VALUES (@cycle, @farm, @plot, 'grape', 'Vegetative', CURRENT_DATE - 15, NOW(), NOW());
                """, ("plot", Plot1), ("cycle", Cycle1), ("farm", Farm1));
        }

        // One clip and one message by Worker1 (standing in for the staff sender), and what Farm1's plot did with it: heard, then accepted.
        await using (var db = _db.SuperContext())
        {
            var now = DateTime.UtcNow;
            var chain = Guid.NewGuid();
            var message = Guid.NewGuid();
            var clip = ScheduleOwnerClip.Create(Guid.NewGuid(), chain, Guid.NewGuid(), new UserId(Worker1), new string('a', 64), "audio/wav", 1000, 2000, now, out _)!;
            var row = ScheduleOwnerMessage.Create(message, chain, Guid.NewGuid(), "own-a", ScheduleOwnerMessageKind.Change, clip.Id, Guid.NewGuid(), null, null, null, null, new UserId(Worker1), now, out _)!;
            var heard = ScheduleOwnerMessageState.Heard(new FarmId(Farm1), Plot1, new UserId(Owner1), message, new UserId(Owner1), now);
            var accepted = ScheduleOwnerMessageState.Decided(new FarmId(Farm1), Plot1, Cycle1, new UserId(Owner1), message, ScheduleOwnerStateKind.Accepted, 1, new UserId(Owner1), now);
            accepted.RecordMoved(Guid.NewGuid(), 1, 2, false, Guid.NewGuid(), "फवारणी", "२ ग्रॅम");
            db.ScheduleOwnerClips.Add(clip);
            db.ScheduleOwnerMessages.Add(row);
            db.ScheduleOwnerMessageStates.AddRange(heard, accepted);
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
    public async Task Erasing_the_farm_owner_completes_and_leaves_the_voice_and_his_decisions_as_they_were()
    {
        await using var raw = new NpgsqlConnection(_db.SuperuserConn);
        await raw.OpenAsync();
        var before = await SnapshotAsync(raw);
        before.Rows.Should().Be("1/1/2", "the rows must really be there, or every assertion below would pass for the wrong reason");

        await RunOneErasurePassAsync(raw, Owner1);

        (await SnapshotAsync(raw)).Should().Be(before, "KEEP: every clip, message and state row is exactly what it was");
    }

    [Fact]
    public async Task Erasing_the_sender_completes_and_changes_nothing_the_farmers_decided()
    {
        await using var raw = new NpgsqlConnection(_db.SuperuserConn);
        await raw.OpenAsync();
        var before = await SnapshotAsync(raw);
        (await CountAsync(raw, "SELECT count(*) FROM ssf.schedule_owner_messages WHERE sent_by_user_id = @u", ("u", Worker1))).Should().Be(1);

        await RunOneErasurePassAsync(raw, Worker1);

        (await SnapshotAsync(raw)).Should().Be(before, "a creator's erasure is slice 15's own proof; until creators send, the sender's rows are KEPT and the farmers' decisions stand");
    }

    private sealed record Snapshot(string Rows, string Clips, string Messages, string States);

    private static async Task<Snapshot> SnapshotAsync(NpgsqlConnection db) => new(
        await CountAsync(db, "SELECT count(*) FROM ssf.schedule_owner_clips") + "/" + await CountAsync(db, "SELECT count(*) FROM ssf.schedule_owner_messages") + "/"
            + await CountAsync(db, "SELECT count(*) FROM ssf.schedule_owner_message_states"),
        (string)(await ScalarAsync(db, "SELECT coalesce(string_agg(row_to_json(c)::text, '|' ORDER BY id), '') FROM ssf.schedule_owner_clips c"))!,
        (string)(await ScalarAsync(db, "SELECT coalesce(string_agg(row_to_json(m)::text, '|' ORDER BY id), '') FROM ssf.schedule_owner_messages m"))!,
        (string)(await ScalarAsync(db, "SELECT coalesce(string_agg(row_to_json(s)::text, '|' ORDER BY id), '') FROM ssf.schedule_owner_message_states s"))!);

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

        status.Should().Be((int)ErasureStatus.Completed, "the real ErasureWorker must complete the request with rows in the owner-voice tables");
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
