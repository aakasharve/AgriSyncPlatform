// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (repair D-9, farm setup on the server)
// ERASURE PROVEN THROUGH THE WHOLE WORKER. A new erasure step once passed its own tests and then made EVERY erasure end Failed in the real worker. The
// disposition of the six farm-setup tables is KEEP (see ErasureWorker.cs: the rows describe the FARM; the user-id columns are opaque ids), carried by a
// comment that cannot fail - so this suite runs the REAL ErasureWorker through the real service provider over a database holding rows in ALL SIX tables
// and proves the request reaches Completed and that every row is untouched. Two subjects: the farm's owner, and the seat-holder who typed a change.
// And the EXPORT: the farm's owner receives his farm's setup (/farm_setup.json); a person who owns no farm receives none of it.
using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Text.Json;
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
using ShramSafal.Infrastructure.Persistence;
using ShramSafal.Infrastructure.Privacy;
using Xunit;
using static ShramSafal.Sync.IntegrationTests.Planning.ScheduleTaskDb;

namespace ShramSafal.Sync.IntegrationTests.Privacy;

[Trait("Category", "RequiresPostgres")]
public sealed class ErasureWorkerFarmSetupRealPostgresTests : IAsyncLifetime
{
    private static readonly Guid Plot1 = Guid.Parse("d9e00000-0000-4000-8000-0000000000c1");
    private static readonly Guid Plot2 = Guid.Parse("d9e00000-0000-4000-8000-0000000000c2");
    private static readonly Guid Source1 = Guid.Parse("d9e00000-0000-4000-8000-0000000000d1");
    private static readonly Guid Source2 = Guid.Parse("d9e00000-0000-4000-8000-0000000000d2");
    private static readonly Guid Motor = Guid.Parse("d9e00000-0000-4000-8000-0000000000e1");
    private static readonly Guid Machine = Guid.Parse("d9e00000-0000-4000-8000-0000000000f1");

    private static readonly string[] Tables =
        ["farm_water_sources", "farm_motors", "farm_power_times", "farm_machines", "plot_water_setups", "plot_water_links"];

    private readonly Planning.ScheduleTaskDb _db = new();
    private ServiceProvider _provider = default!;

    public async Task InitializeAsync()
    {
        await _db.InitializeAsync();

        // Rows in every one of the six tables, on owner 1's farm (written by him, one changed by his worker) and one source on owner 2's farm.
        await using (var raw = new NpgsqlConnection(_db.SuperuserConn))
        {
            await raw.OpenAsync();
            await ExecAsync(raw, """
                INSERT INTO ssf.plots ("Id", farm_id, name, area_in_acres, created_at_utc, modified_at_utc)
                VALUES (@plot1, @farm1, 'd9 प्लॉट', 1.0, NOW(), NOW()), (@plot2, @farm2, 'd9 दुसरा', 1.0, NOW(), NOW());
                INSERT INTO ssf.farm_water_sources (id, farm_id, name, source_type, is_available, notes, revision, state,
                                                    created_by_user_id, created_at_utc, updated_by_user_id, updated_at_utc)
                VALUES (@source1, @farm1, 'मुख्य विहीर', 'well', TRUE, 'घराजवळ', 2, 0, @owner1, NOW(), @worker1, NOW()),
                       (@source2, @farm2, 'दुसऱ्याची बोअर', 'borewell', TRUE, NULL, 1, 0, @owner2, NOW(), @owner2, NOW());
                INSERT INTO ssf.farm_motors (id, farm_id, water_source_id, name, hp, phase, power_source, power_source_name, has_drip, drip_pipe_size,
                                             drip_has_filter, drip_flow_lph, state, created_by_user_id, created_at_utc, updated_by_user_id, updated_at_utc)
                VALUES (@motor, @farm1, @source1, '५ एचपी', 5, 3, 'mseb', NULL, TRUE, '16mm', TRUE, 4, 0, @owner1, NOW(), @worker1, NOW());
                INSERT INTO ssf.farm_power_times (farm_id, content, content_hash, revision, updated_by_user_id, updated_at_utc)
                VALUES (@farm1, '{"singlePhase":{"patternMode":"FIXED_WEEKLY","alternateWeeklyPattern":false,"weekAOffWindows":[],"weekBOffWindows":[]},"threePhase":{"patternMode":"FIXED_WEEKLY","alternateWeeklyPattern":false,"weekAOffWindows":[],"weekBOffWindows":[]}}'::jsonb,
                        repeat('a', 64), 1, @owner1, NOW());
                INSERT INTO ssf.farm_machines (id, farm_id, name, machine_type, ownership, company, revision, state,
                                               created_by_user_id, created_at_utc, updated_by_user_id, updated_at_utc)
                VALUES (@machine, @farm1, 'महिंद्रा 575', 'tractor', 'owned', 'Mahindra', 1, 0, @owner1, NOW(), @owner1, NOW());
                INSERT INTO ssf.plot_water_setups (plot_id, farm_id, irrigation_method, revision, updated_by_user_id, updated_at_utc)
                VALUES (@plot1, @farm1, 'drip', 1, @worker1, NOW());
                INSERT INTO ssf.plot_water_links (id, farm_id, plot_id, water_source_id, motor_id, state,
                                                  created_by_user_id, created_at_utc, updated_by_user_id, updated_at_utc)
                VALUES (gen_random_uuid(), @farm1, @plot1, @source1, @motor, 0, @worker1, NOW(), @worker1, NOW());
                """,
                ("plot1", Plot1), ("plot2", Plot2), ("farm1", Farm1), ("farm2", Farm2), ("owner1", Owner1), ("owner2", Owner2), ("worker1", Worker1),
                ("source1", Source1), ("source2", Source2), ("motor", Motor), ("machine", Machine));
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

    [Theory]
    [InlineData("owner")]
    [InlineData("typist")]
    public async Task Erasing_the_owner_or_the_person_who_typed_completes_and_leaves_every_farm_setup_row_as_it_was(string who)
    {
        await using var raw = new NpgsqlConnection(_db.SuperuserConn);
        await raw.OpenAsync();
        var before = await SnapshotAsync(raw);
        before.Should().HaveCount(6);
        before.Values.Should().OnlyContain(rows => rows.Length > 0, "rows must really be in ALL SIX tables, or the proof below would pass for the wrong reason");

        await RunOneErasurePassAsync(raw, who == "owner" ? Owner1 : Worker1);

        (await SnapshotAsync(raw)).Should().BeEquivalentTo(before, "KEEP: the rows describe the farm; every row, id and word is exactly what it was");
    }

    [Fact]
    public async Task The_export_gives_the_farms_owner_his_farms_setup_and_nobody_elses()
    {
        var write = typeof(ExportWorker).GetMethod("WriteFarmSetupAsync", BindingFlags.Static | BindingFlags.NonPublic | BindingFlags.Public);
        write.Should().NotBeNull("ExportWorker writes the farm's setup for its owner (WriteFarmSetupAsync)");

        async Task<JsonElement> ExportOfAsync(Guid user)
        {
            using var buffer = new MemoryStream();
            await using (var db = _db.SuperContext())
            {
                using var zip = new ZipArchive(buffer, ZipArchiveMode.Create, leaveOpen: true);
                await (Task)write!.Invoke(null, [zip, db, user, CancellationToken.None])!;
            }

            buffer.Position = 0;
            using var read = new ZipArchive(buffer, ZipArchiveMode.Read);
            read.Entries.Select(e => e.FullName).Should().Equal("farm_setup.json");
            using var document = JsonDocument.Parse(new StreamReader(read.GetEntry("farm_setup.json")!.Open()).ReadToEnd());
            return document.RootElement.Clone();
        }

        var owner = await ExportOfAsync(Owner1);
        var text = System.Text.RegularExpressions.Regex.Unescape(owner.GetRawText()); // the export may write Marathi as \u escapes
        text.Should().Contain("मुख्य विहीर").And.Contain("५ एचपी").And.Contain("महिंद्रा 575").And.Contain("FIXED_WEEKLY").And.Contain("drip");
        text.Should().Contain(Source1.ToString()).And.Contain(Motor.ToString()).And.Contain(Machine.ToString()).And.Contain(Plot1.ToString());
        text.Should().NotContain(Source2.ToString(), "another owner's farm is not his data").And.NotContain("बोअर");
        owner.GetProperty("farms").EnumerateArray().Select(f => f.GetProperty("farmId").GetGuid()).Should().Equal(Farm1);

        // A seat-holder owns no farm: the setup is the farm's, exported for its owner.
        (await ExportOfAsync(Worker1)).GetProperty("farms").GetArrayLength().Should().Be(0);
        (await ExportOfAsync(Owner2)).GetRawText().Should().Contain(Source2.ToString()).And.NotContain(Source1.ToString());
    }

    private static async Task<Dictionary<string, string>> SnapshotAsync(NpgsqlConnection db)
    {
        var snapshot = new Dictionary<string, string>();
        foreach (var table in Tables)
        {
            snapshot[table] = (string)(await ScalarAsync(db, $"SELECT coalesce(string_agg(row_to_json(t)::text, '|' ORDER BY row_to_json(t)::text), '') FROM ssf.{table} t"))!;
        }

        return snapshot;
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

        status.Should().Be((int)ErasureStatus.Completed, "the real ErasureWorker must complete the request with rows in the farm-setup tables");
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
}
