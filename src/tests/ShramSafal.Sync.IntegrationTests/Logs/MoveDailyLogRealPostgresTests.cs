// spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF-S)
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShramSafal.Api;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Sync.PullSyncChanges;
using ShramSafal.Application.UseCases.Sync.PushSyncBatch;
using ShramSafal.Domain.Dfes;
using ShramSafal.Infrastructure.Persistence;
using ShramSafal.Sync.IntegrationTests.Memberships;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Logs;

/// <summary>
/// <b>Lane OF-S — a saved record moved to another plot / day (<c>move_daily_log</c>)</b>, and no record of done work
/// on a day that has not happened (<c>create_daily_log</c> + the move), on the real <c>/sync/push</c> → Postgres →
/// <c>/sync/pull</c> path as the non-superuser <c>agrisync_app</c> role (doctrine E3: every fact first proves the role
/// is neither superuser nor BYPASSRLS).
///
/// <para>Each fact builds its OWN scratch database (full migration chain) on the cluster named by
/// <c>REQUIRES_POSTGRES_ROOT_CONN</c> and drops it on dispose. Fail-loud: no reachable Postgres is a FAILURE.</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class MoveDailyLogRealPostgresTests(Xunit.Abstractions.ITestOutputHelper output) : IAsyncLifetime
{
    private const string AppRoleUser = TestRoleCredentials.AppRoleUser;
    private static string AppRolePassword => TestRoleCredentials.AppRolePassword;

    private static readonly Guid FarmA = Guid.Parse("0f5e0000-0000-4000-8000-0000000000a1");
    private static readonly Guid OwnerA = Guid.Parse("0f5e0000-0000-4000-8000-0000000000a2");
    private static readonly Guid AccountA = Guid.Parse("0f5e0000-0000-4000-8000-0000000000a3");
    private static readonly Guid PlotA1 = Guid.Parse("0f5e0000-0000-4000-8000-0000000000a4");
    private static readonly Guid CycleA1 = Guid.Parse("0f5e0000-0000-4000-8000-0000000000a5");
    private static readonly Guid PlotA2 = Guid.Parse("0f5e0000-0000-4000-8000-0000000000a6");
    private static readonly Guid CycleA2 = Guid.Parse("0f5e0000-0000-4000-8000-0000000000a7");
    // A plot whose only season starts in December: nothing covers an October day.
    private static readonly Guid PlotA3 = Guid.Parse("0f5e0000-0000-4000-8000-0000000000a8");
    private static readonly Guid CycleA3 = Guid.Parse("0f5e0000-0000-4000-8000-0000000000a9");
    private static readonly Guid WorkerA = Guid.Parse("0f5e0000-0000-4000-8000-0000000000aa");
    private static readonly Guid MukadamA = Guid.Parse("0f5e0000-0000-4000-8000-0000000000ab");
    private static readonly Guid DualAB = Guid.Parse("0f5e0000-0000-4000-8000-0000000000ac");

    private static readonly Guid FarmB = Guid.Parse("0f5e0000-0000-4000-8000-0000000000b1");
    private static readonly Guid OwnerB = Guid.Parse("0f5e0000-0000-4000-8000-0000000000b2");
    private static readonly Guid AccountB = Guid.Parse("0f5e0000-0000-4000-8000-0000000000b3");
    private static readonly Guid PlotB = Guid.Parse("0f5e0000-0000-4000-8000-0000000000b4");
    private static readonly Guid CycleB = Guid.Parse("0f5e0000-0000-4000-8000-0000000000b5");

    private const string SavedDay = "2026-10-30";

    private string _adminConn = string.Empty;
    private string _superuserConn = string.Empty;
    private string _appConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private ServiceProvider? _rootProvider;

    public async Task InitializeAsync()
    {
        _adminConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();

        _scratchDbName = $"ssf_ofs_move_{Guid.NewGuid():N}";
        await using (var admin = new NpgsqlConnection(_adminConn))
        {
            await admin.OpenAsync();
            await ExecAsync(admin, $"CREATE DATABASE \"{_scratchDbName}\"");
        }

        _superuserConn = new NpgsqlConnectionStringBuilder(_adminConn) { Database = _scratchDbName }.ConnectionString;
        _appConn = new NpgsqlConnectionStringBuilder(_superuserConn)
        {
            Username = AppRoleUser,
            Password = AppRolePassword,
        }.ConnectionString;

        await IntegrationMigrationChain.ApplyAsync(_superuserConn);

        await using (var raw = new NpgsqlConnection(_superuserConn))
        {
            await raw.OpenAsync();
            await ExecAsync(raw, $"""
                GRANT USAGE ON SCHEMA public, analytics TO {AppRoleUser};
                GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public, analytics TO {AppRoleUser};
                GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public, analytics TO {AppRoleUser};
                """);
            await ExecAsync(raw, """
                INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status)
                VALUES (@farmA, 'OF-S Farm A', @ownerA, @accountA, NOW(), NOW(), 3.0, 'Unchecked'),
                       (@farmB, 'OF-S Farm B', @ownerB, @accountB, NOW(), NOW(), 3.0, 'Unchecked');
                INSERT INTO ssf.farm_memberships ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status)
                VALUES (gen_random_uuid(), @farmA, @ownerA, 'PrimaryOwner', NOW(), NOW(), @accountA, 3),
                       (gen_random_uuid(), @farmA, @workerA, 'Worker', NOW(), NOW(), @accountA, 3),
                       (gen_random_uuid(), @farmA, @dualAB, 'Worker', NOW(), NOW(), @accountA, 3),
                       (gen_random_uuid(), @farmB, @ownerB, 'PrimaryOwner', NOW(), NOW(), @accountB, 3),
                       (gen_random_uuid(), @farmB, @dualAB, 'Worker', NOW(), NOW(), @accountB, 3);
                INSERT INTO ssf.farm_memberships ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status, can_manage_labour_records)
                VALUES (gen_random_uuid(), @farmA, @mukadamA, 'Mukadam', NOW(), NOW(), @accountA, 3, TRUE);
                INSERT INTO ssf.plots ("Id", farm_id, name, area_in_acres, created_at_utc, modified_at_utc)
                VALUES (@plotA1, @farmA, 'Plot A1', 1.0, NOW(), NOW()),
                       (@plotA2, @farmA, 'Plot A2', 1.0, NOW(), NOW()),
                       (@plotA3, @farmA, 'Plot A3', 1.0, NOW(), NOW()),
                       (@plotB, @farmB, 'Plot B', 1.0, NOW(), NOW());
                INSERT INTO ssf.crop_cycles ("Id", farm_id, plot_id, crop_name, stage, start_date, created_at_utc, modified_at_utc)
                VALUES (@cycleA1, @farmA, @plotA1, 'Grapes', 'Vegetative', DATE '2026-01-01', NOW(), NOW()),
                       (@cycleA2, @farmA, @plotA2, 'Sugarcane', 'Vegetative', DATE '2026-01-01', NOW(), NOW()),
                       (@cycleA3, @farmA, @plotA3, 'Onion', 'Sowing', DATE '2026-12-01', NOW(), NOW()),
                       (@cycleB, @farmB, @plotB, 'Grapes', 'Vegetative', DATE '2026-01-01', NOW(), NOW());
                """,
                ("farmA", FarmA), ("ownerA", OwnerA), ("accountA", AccountA), ("workerA", WorkerA),
                ("mukadamA", MukadamA), ("dualAB", DualAB),
                ("plotA1", PlotA1), ("cycleA1", CycleA1), ("plotA2", PlotA2), ("cycleA2", CycleA2),
                ("plotA3", PlotA3), ("cycleA3", CycleA3),
                ("farmB", FarmB), ("ownerB", OwnerB), ("accountB", AccountB), ("plotB", PlotB), ("cycleB", CycleB));

            await UpgradedSeats.CarryAsync(raw, FarmA);
        }

        var services = new ServiceCollection();
        services.AddLogging();
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:ShramSafalDb"] = _appConn,
                ["ConnectionStrings:UserDb"] = _appConn,
                ["ConnectionStrings:ShramSafalDb_Migration"] = _superuserConn,
            }!)
            .Build();
        services.AddSingleton<IConfiguration>(config);
        services.AddShramSafalApi(config);
        services.AddScoped<IIdGenerator, GuidIdGenerator>();
        services.AddScoped<IClock, SystemClock>();
        services.AddSingleton<IEntitlementPolicy, AllowAllEntitlementPolicy>();
        services.AddSingleton<IAnalyticsWriter, NoopAnalyticsWriter>();

        _rootProvider = services.BuildServiceProvider();
    }

    public async Task DisposeAsync()
    {
        if (_rootProvider is not null)
        {
            await _rootProvider.DisposeAsync();
        }

        if (string.IsNullOrEmpty(_scratchDbName) || string.IsNullOrEmpty(_adminConn))
        {
            return;
        }

        try
        {
            await using var admin = new NpgsqlConnection(_adminConn);
            await admin.OpenAsync();
            await ExecAsync(admin,
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = @db AND pid <> pg_backend_pid()",
                ("db", _scratchDbName));
            await ExecAsync(admin, $"DROP DATABASE IF EXISTS \"{_scratchDbName}\"");
        }
        catch (Exception ex)
        {
            // Best-effort teardown, never silent: a leaked scratch DB is harmless but is said.
            output.WriteLine($"[TEARDOWN] scratch database {_scratchDbName} was not dropped: {ex.GetType().Name}");
        }
    }

    // ── 1. Place ─────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_move_to_another_plot_lands_with_its_season_a_new_version_a_ledger_row_and_the_pull_shows_it()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();
        var logId = await CreateLogAsync(OwnerA, "req-ofs-create-plot");
        var before = await PullDailyLogAsync(OwnerA, logId);

        await PushAppliedAsync(OwnerA, "move_daily_log", "req-ofs-move-plot",
            MovePayload(logId, 1, plots: [PlotA2], reason: "चुकीचा प्लॉट"));

        var row = await ReadPlacementAsync(logId);
        output.WriteLine($"[EVIDENCE] after plot move: {row}");
        row.Should().Be(new Placement("Plot", PlotA2, [PlotA2], CycleA2, SavedDay, 2),
            "the record now names the chosen plot and the season on it that covers the day, one version on");

        var ledger = Assert.Single(await ReadAuditPayloadsAsync(logId, "LogMoved"));
        output.WriteLine($"[EVIDENCE] LogMoved ledger row: {ledger.GetRawText()}");
        ledger.GetProperty("from").GetProperty("plotIds")[0].GetGuid().Should().Be(PlotA1);
        ledger.GetProperty("from").GetProperty("cropCycleId").GetGuid().Should().Be(CycleA1);
        ledger.GetProperty("to").GetProperty("plotIds")[0].GetGuid().Should().Be(PlotA2);
        ledger.GetProperty("to").GetProperty("logDate").GetString().Should().Be(SavedDay);
        ledger.GetProperty("fromVersion").GetInt32().Should().Be(1);
        ledger.GetProperty("toVersion").GetInt32().Should().Be(2);
        ledger.GetProperty("reason").GetString().Should().Be("चुकीचा प्लॉट");
        (await ScalarAsync("SELECT actor_user_id FROM ssf.audit_events WHERE entity_id = @id AND action = 'LogMoved'", logId))
            .Should().Be(OwnerA, "the ledger says who moved it");

        var pulled = await PullDailyLogAsync(OwnerA, logId);
        pulled.PlotId.Should().Be(PlotA2);
        pulled.CropCycleId.Should().Be(CycleA2);
        pulled.LogDate.Should().Be(DateOnly.Parse(SavedDay));
        pulled.ContentVersion.Should().Be(2);
        JsonKeys(pulled).Should().BeEquivalentTo(JsonKeys(before),
            "the pulled record keeps its exact shape, so every installed phone still reads it (P11)");
    }

    [Fact]
    public async Task A_move_to_several_plots_or_the_whole_farm_carries_no_season()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();
        var logId = await CreateLogAsync(OwnerA, "req-ofs-create-multi");

        await PushAppliedAsync(OwnerA, "move_daily_log", "req-ofs-move-multi", MovePayload(logId, 1, plots: [PlotA1, PlotA2]));
        var multi = await ReadPlacementAsync(logId);
        output.WriteLine($"[EVIDENCE] after move to two plots: {multi}");
        multi.Scope.Should().Be("MultiPlot");
        multi.PlotId.Should().BeNull();
        multi.PlotIds.Should().BeEquivalentTo([PlotA1, PlotA2]);
        multi.CropCycleId.Should().BeNull();

        await PushAppliedAsync(OwnerA, "move_daily_log", "req-ofs-move-farm",
            MovePayload(logId, 2, wholeFarm: true, day: "2026-10-28"));
        var farm = await ReadPlacementAsync(logId);
        output.WriteLine($"[EVIDENCE] after move to the whole farm and an earlier day: {farm}");
        farm.Should().Be(new Placement("Farm", null, [], null, "2026-10-28", 3));
    }

    // ── 2. Day ───────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_move_to_another_day_takes_the_named_people_with_it_and_the_pull_shows_the_day()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();
        var logId = await CreateLogAsync(OwnerA, "req-ofs-create-day");
        var (_, workRowId) = await PlantNamedPersonAsync(logId, "बाळू");

        await PushAppliedAsync(OwnerA, "move_daily_log", "req-ofs-move-day", MovePayload(logId, 1, day: "2026-10-27"));

        var row = await ReadPlacementAsync(logId);
        output.WriteLine($"[EVIDENCE] after day move: {row}");
        row.Should().Be(new Placement("Plot", PlotA1, [PlotA1], CycleA1, "2026-10-27", 2));
        var workDate = Day(await ScalarAsync("SELECT work_date FROM ssf.field_operator_work_rows WHERE \"Id\" = @id", workRowId));
        output.WriteLine($"[EVIDENCE] बाळू's work row day: {workDate}");
        workDate.Should().Be("2026-10-27", "the person worked the same engagement, which now says that day");
        Assert.Single(await ReadAuditPayloadsAsync(logId, "LogMoved")).GetProperty("workRowsMoved").GetInt32().Should().Be(1);

        (await PullDailyLogAsync(OwnerA, logId)).LogDate.Should().Be(DateOnly.Parse("2026-10-27"));
    }

    [Fact]
    public async Task A_move_of_plot_and_day_together_is_one_change()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();
        var logId = await CreateLogAsync(OwnerA, "req-ofs-create-both");

        await PushAppliedAsync(OwnerA, "move_daily_log", "req-ofs-move-both", MovePayload(logId, 1, plots: [PlotA2], day: "2026-10-26"));

        var row = await ReadPlacementAsync(logId);
        output.WriteLine($"[EVIDENCE] after plot + day move: {row}");
        row.Should().Be(new Placement("Plot", PlotA2, [PlotA2], CycleA2, "2026-10-26", 2));
        (await ReadAuditPayloadsAsync(logId, "LogMoved")).Should().ContainSingle("one move, one ledger row");
    }

    // ── 3. Replay, stale ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task The_same_request_sent_twice_moves_the_record_once()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();
        var logId = await CreateLogAsync(OwnerA, "req-ofs-create-replay");
        var payload = MovePayload(logId, 1, plots: [PlotA2]);

        await PushAppliedAsync(OwnerA, "move_daily_log", "req-ofs-move-replay", payload);
        var again = Assert.Single((await PushAsync(OwnerA, "move_daily_log", "req-ofs-move-replay", payload)).Value!.Results);
        output.WriteLine($"[EVIDENCE] replay of the same request -> {again.Status}");
        again.Status.Should().Be("duplicate");

        (await ReadPlacementAsync(logId)).Version.Should().Be(2, "the replay changed nothing a second time");
        (await ReadAuditPayloadsAsync(logId, "LogMoved")).Should().ContainSingle();
        (await ScalarTextAsync("SELECT COUNT(*) FROM ssf.sync_mutations WHERE client_request_id = @id", "req-ofs-move-replay"))
            .Should().Be(1L, "one replay record for the request, however often it is sent");
    }

    [Fact]
    public async Task A_move_made_from_an_older_version_is_refused_and_the_newer_change_stands()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();
        var logId = await CreateLogAsync(OwnerA, "req-ofs-create-stale");
        await PushAppliedAsync(OwnerA, "move_daily_log", "req-ofs-move-first", MovePayload(logId, 1, plots: [PlotA2]));

        // A second phone that last saw version 1 asks to move it back to A1.
        var refused = await PushFailedAsync(MukadamA, "move_daily_log", "req-ofs-move-stale", MovePayload(logId, 1, plots: [PlotA1]));
        refused.ErrorCode.Should().Be("ShramSafal.LogMove.Conflict");

        (await ReadPlacementAsync(logId)).Should().Be(new Placement("Plot", PlotA2, [PlotA2], CycleA2, SavedDay, 2),
            "a stale move is never applied over the newer change");
        (await ReadAuditPayloadsAsync(logId, "LogMoved")).Should().ContainSingle();
    }

    // ── 4. No future day (H1) ────────────────────────────────────────────────────────────────

    [Fact]
    public async Task A_day_after_the_farms_today_is_refused_on_create_and_on_move_and_today_is_never_refused()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();
        var today = FarmLocalDay.From(DateTime.UtcNow);
        var tomorrow = today.AddDays(1).ToString("yyyy-MM-dd");
        var dayAfter = today.AddDays(2).ToString("yyyy-MM-dd");
        output.WriteLine($"[EVIDENCE] farm today (India) = {today:yyyy-MM-dd}; tomorrow = {tomorrow}");

        // fix 1 (B009) — an installed phone whose clock runs ahead never loses a record: create_daily_log takes the
        // farm's TOMORROW (the exact keys an installed 1.0.15–1.0.17 phone sends) and refuses only after it.
        var tomorrowLog = Guid.NewGuid();
        await PushAppliedAsync(OwnerA, "create_daily_log", "req-ofs-create-tomorrow", OldCreatePayload(tomorrowLog, OwnerA, tomorrow));
        var futureLog = Guid.NewGuid();
        var refusedCreate = await PushFailedAsync(OwnerA, "create_daily_log", "req-ofs-create-day-after",
            OldCreatePayload(futureLog, OwnerA, dayAfter));
        refusedCreate.ErrorCode.Should().Be("ShramSafal.LogDateInFuture.InvalidCommand");
        (await ScalarAsync("SELECT COUNT(*) FROM ssf.daily_logs WHERE \"Id\" = @id", futureLog)).Should().Be(0L);

        // The day an installed phone records on — today — is never refused (P11).
        var todayLog = Guid.NewGuid();
        await PushAppliedAsync(OwnerA, "create_daily_log", "req-ofs-create-today",
            OldCreatePayload(todayLog, OwnerA, today.ToString("yyyy-MM-dd")));

        var logId = await CreateLogAsync(OwnerA, "req-ofs-create-future-move");
        var refusedMove = await PushFailedAsync(OwnerA, "move_daily_log", "req-ofs-move-tomorrow", MovePayload(logId, 1, day: tomorrow));
        refusedMove.ErrorCode.Should().Be("ShramSafal.LogDateInFuture.InvalidCommand");
        (await ReadPlacementAsync(logId)).Should().Be(new Placement("Plot", PlotA1, [PlotA1], CycleA1, SavedDay, 1));

        await PushAppliedAsync(OwnerA, "move_daily_log", "req-ofs-move-today", MovePayload(logId, 1, day: today.ToString("yyyy-MM-dd")));
    }

    [Fact]
    public async Task No_season_on_the_chosen_plot_for_that_day_refuses_the_move()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();
        var logId = await CreateLogAsync(OwnerA, "req-ofs-create-nocycle");

        var refused = await PushFailedAsync(OwnerA, "move_daily_log", "req-ofs-move-nocycle", MovePayload(logId, 1, plots: [PlotA3]));
        refused.ErrorCode.Should().Be("ShramSafal.LogMoveNoCropCycle.InvalidCommand");
        (await ReadPlacementAsync(logId)).Should().Be(new Placement("Plot", PlotA1, [PlotA1], CycleA1, SavedDay, 1));
        (await ReadAuditPayloadsAsync(logId, "LogMoved")).Should().BeEmpty();
    }

    // ── 5. What is tied to the record ────────────────────────────────────────────────────────

    [Fact]
    public async Task A_day_move_is_refused_whole_when_a_hajeri_ruling_names_a_person_on_it_but_a_plot_move_is_not()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();
        var logId = await CreateLogAsync(OwnerA, "req-ofs-create-hajeri");
        var (operatorId, workRowId) = await PlantNamedPersonAsync(logId, "गणेश");
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.attendance_marks ("Id", farm_id, field_operator_id, work_date, day_mark, night_mark,
                                              recorded_by_user_id, recorded_at_utc, modified_at_utc)
            VALUES (gen_random_uuid(), @fid, @oid, DATE '2026-10-30', 1, 0, @uid, NOW(), NOW());
            """, ("fid", FarmA), ("oid", operatorId), ("uid", OwnerA));

        var refused = await PushFailedAsync(OwnerA, "move_daily_log", "req-ofs-move-hajeri", MovePayload(logId, 1, day: "2026-10-25"));
        refused.ErrorCode.Should().Be("ShramSafal.LogMoveAttendance.Conflict");
        (await ReadPlacementAsync(logId)).Should().Be(new Placement("Plot", PlotA1, [PlotA1], CycleA1, SavedDay, 1), "nothing changed");
        Day(await ScalarAsync("SELECT work_date FROM ssf.field_operator_work_rows WHERE \"Id\" = @id", workRowId))
            .Should().Be(SavedDay);
        (await ReadAuditPayloadsAsync(logId, "LogMoved")).Should().BeEmpty();

        // A ruling is about a person on a DAY and names no plot: a place-only move goes through.
        await PushAppliedAsync(OwnerA, "move_daily_log", "req-ofs-move-hajeri-plot", MovePayload(logId, 1, plots: [PlotA2]));
        (await ReadPlacementAsync(logId)).PlotId.Should().Be(PlotA2);
    }

    [Fact]
    public async Task Any_move_is_refused_whole_when_paid_money_is_linked_to_the_record()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();
        var logId = await CreateLogAsync(OwnerA, "req-ofs-create-paid");
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.job_cards (id, farm_id, plot_id, crop_cycle_id, created_by_user_id, planned_date, status,
                                       created_at_utc, modified_at_utc, linked_daily_log_id, line_items)
            VALUES (gen_random_uuid(), @fid, @pid, @cid, @uid, DATE '2026-10-30', 'PaidOut', NOW(), NOW(), @log, '[]'::jsonb);
            """, ("fid", FarmA), ("pid", PlotA1), ("cid", CycleA1), ("uid", OwnerA), ("log", logId));

        var refusedDay = await PushFailedAsync(OwnerA, "move_daily_log", "req-ofs-move-paid-day", MovePayload(logId, 1, day: "2026-10-25"));
        refusedDay.ErrorCode.Should().Be("ShramSafal.LogMoveJobCard.Conflict");
        var refusedPlot = await PushFailedAsync(OwnerA, "move_daily_log", "req-ofs-move-paid-plot", MovePayload(logId, 1, plots: [PlotA2]));
        refusedPlot.ErrorCode.Should().Be("ShramSafal.LogMoveJobCard.Conflict");
        (await ReadPlacementAsync(logId)).Should().Be(new Placement("Plot", PlotA1, [PlotA1], CycleA1, SavedDay, 1), "nothing changed");
    }

    // ── 6. A confirmed record re-opens ───────────────────────────────────────────────────────

    [Fact]
    public async Task A_confirmed_record_moved_by_someone_else_reopens_and_the_owners_own_move_is_reconfirmed_at_the_new_version()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();
        var logId = await CreateLogAsync(OwnerA, "req-ofs-create-confirmed");
        (await LatestStatusAsync(logId)).Should().Be("Verified", "the owner's own save is self-confirmed at creation");

        // The owner moves his own record: re-opened, then re-confirmed at the NEW version (the revise rule).
        await PushAppliedAsync(OwnerA, "move_daily_log", "req-ofs-move-own", MovePayload(logId, 1, plots: [PlotA2]));
        (await LatestStatusAsync(logId)).Should().Be("Verified");
        (await ScalarAsync(
            "SELECT MAX(confirmed_log_version) FROM ssf.verification_events WHERE daily_log_id = @id AND status = 'Verified'", logId))
            .Should().Be(2);

        // The mukadam (granted) moves it: re-opened for the owner, never re-confirmed on his behalf.
        await PushAppliedAsync(MukadamA, "move_daily_log", "req-ofs-move-mukadam", MovePayload(logId, 2, day: "2026-10-29"));
        (await LatestStatusAsync(logId)).Should().Be("Draft", "what the record says changed; the owner's confirmation no longer covers it");
        var reopened = (await ReadAuditPayloadsAsync(logId, "VerificationChanged")).Last();
        output.WriteLine($"[EVIDENCE] VerificationChanged after the mukadam's move: {reopened.GetRawText()}");
        reopened.GetProperty("trigger").GetString().Should().Be("LogMoved");
        reopened.GetProperty("from").GetString().Should().Be("Verified");
        reopened.GetProperty("to").GetString().Should().Be("Draft");
        reopened.GetProperty("reAttestedByCreator").GetBoolean().Should().BeFalse();
    }

    // ── 7. Who may, tenancy both ways ────────────────────────────────────────────────────────

    [Fact]
    public async Task A_seat_without_edit_rights_is_refused_and_nothing_changes()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();
        var logId = await CreateLogAsync(OwnerA, "req-ofs-create-worker");

        var refused = await PushFailedAsync(WorkerA, "move_daily_log", "req-ofs-move-worker", MovePayload(logId, 1, plots: [PlotA2]));
        refused.ErrorCode.Should().Be("ShramSafal.Forbidden");
        (await ReadPlacementAsync(logId)).Should().Be(new Placement("Plot", PlotA1, [PlotA1], CycleA1, SavedDay, 1));
    }

    [Fact]
    public async Task Tenancy_holds_both_ways_a_farm_B_seat_cannot_move_a_farm_A_record_nor_can_it_go_onto_a_farm_B_plot()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();
        var logId = await CreateLogAsync(OwnerA, "req-ofs-create-tenancy");
        var dualLog = await CreateLogAsync(DualAB, "req-ofs-create-dual");

        // Foreign PARENT: farm B's owner names farm A's record.
        var foreignSeat = await PushFailedAsync(OwnerB, "move_daily_log", "req-ofs-move-foreign-seat", MovePayload(logId, 1, plots: [PlotB]));
        output.WriteLine($"[EVIDENCE] farm B owner moving a farm A record -> {foreignSeat.ErrorCode}");
        foreignSeat.ErrorCode.Should().BeOneOf("ShramSafal.DailyLogNotFound", "ShramSafal.Forbidden");

        // Foreign CHILD: farm A's owner names a farm B plot; and a seat on BOTH farms tries it with his own record.
        var foreignPlot = await PushFailedAsync(OwnerA, "move_daily_log", "req-ofs-move-foreign-plot", MovePayload(logId, 1, plots: [PlotB]));
        foreignPlot.ErrorCode.Should().Be("ShramSafal.Forbidden");
        var dualForeignPlot = await PushFailedAsync(DualAB, "move_daily_log", "req-ofs-move-dual-plot", MovePayload(dualLog, 1, plots: [PlotB]));
        dualForeignPlot.ErrorCode.Should().Be("ShramSafal.Forbidden");

        (await ReadPlacementAsync(logId)).Should().Be(new Placement("Plot", PlotA1, [PlotA1], CycleA1, SavedDay, 1));
        (await ReadPlacementAsync(dualLog)).PlotId.Should().Be(PlotA1);
        (await ScalarAsync("SELECT COUNT(*) FROM ssf.daily_logs WHERE plot_id = @id", PlotB)).Should().Be(0L,
            "no farm A record ever lands on a farm B plot");
    }

    // ═════════════════════════════════════════════════════════════════════════════════════════
    // fix pass 1 (review REQUEST_CHANGES) — B002 money, B003 two cards, B008 the NEW day, B010 copies.
    // ═════════════════════════════════════════════════════════════════════════════════════════

    private static readonly Guid MoneyLog = Guid.Parse("0f5e4000-0000-4000-8000-0000000000d1");
    private static readonly Guid MoneyLabour = Guid.Parse("0f5e4000-0000-4000-8000-0000000000d2");

    // The phone's money entry ids for that record's lines: RFC 4122 v5 of "<logId>:<kind>:<lineId>" under the phone's
    // money namespace — computed OUTSIDE the code under test (Python uuid.uuid5 and the phone's own `uuid` package agree).
    private static readonly Guid InputMoney = Guid.Parse("46656035-4724-5c68-a7c2-14d3d932aed5");
    private static readonly Guid LabourMoney = Guid.Parse("b7aa5244-057f-5016-858f-afd0a605b7c7");

    /// <summary>A record with one input line and one paid crew, and the two money entries the phone made from them.</summary>
    private async Task CreateMoneyLogAsync(bool inputMoney = true, bool labourMoney = true, string labourMoneyDay = SavedDay)
    {
        var payload = OldCreatePayload(MoneyLog, OwnerA, SavedDay);
        payload["content"] = new
        {
            schema = 1,
            inputs = new object[] { new { id = "tm-input-0", productName = "इथरेल", method = "Spray", quantity = 250, unit = "मिली", cost = 500 } },
        };
        payload["labour"] = new object[] { new { labourAssignmentId = MoneyLabour, engagementType = "hired_daily", workerCount = 8, totalCost = 2800 } };
        await PushAppliedAsync(OwnerA, "create_daily_log", "req-ofs-money-create", payload);
        if (inputMoney)
        {
            await PushAppliedAsync(OwnerA, "add_cost_entry", "req-ofs-money-input", CostPayload(InputMoney, "fertilizer", 500m));
        }

        if (labourMoney)
        {
            await PushAppliedAsync(OwnerA, "add_cost_entry", "req-ofs-money-labour", CostPayload(LabourMoney, "labour_misc", 2800m, labourMoneyDay));
        }
    }

    private static Dictionary<string, object?> CostPayload(Guid id, string category, decimal amount, string entryDate = SavedDay) => new()
    {
        ["costEntryId"] = id,
        ["farmId"] = FarmA,
        ["categoryId"] = category,
        ["description"] = "from the record",
        ["amount"] = amount,
        ["currencyCode"] = "INR",
        ["entryDate"] = entryDate,
        ["plotId"] = PlotA1,
        ["cropCycleId"] = CycleA1,
        ["direction"] = "Expense",
    };

    private sealed record Money(Guid? PlotId, Guid? CropCycleId, string EntryDate, decimal Amount);

    private async Task<Money> ReadMoneyAsync(Guid costEntryId)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT plot_id, crop_cycle_id, entry_date, amount FROM ssf.cost_entries WHERE \"Id\" = @id";
        cmd.Parameters.AddWithValue("id", costEntryId);
        await using var r = await cmd.ExecuteReaderAsync();
        (await r.ReadAsync()).Should().BeTrue("the money entry must exist");
        return new Money(r.IsDBNull(0) ? null : r.GetGuid(0), r.IsDBNull(1) ? null : r.GetGuid(1), Day(r.GetValue(2)), r.GetDecimal(3));
    }

    [Fact]
    public async Task B002_the_records_money_follows_it_to_the_new_plot_season_and_day_keeping_its_amount()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();
        await CreateMoneyLogAsync();
        var unrelated = Guid.NewGuid();
        await PushAppliedAsync(OwnerA, "add_cost_entry", "req-ofs-money-other", CostPayload(unrelated, "fuel", 90m));

        await PushAppliedAsync(OwnerA, "move_daily_log", "req-ofs-money-move", MovePayload(MoneyLog, 1, plots: [PlotA2], day: "2026-10-27"));

        var input = await ReadMoneyAsync(InputMoney);
        var labour = await ReadMoneyAsync(LabourMoney);
        output.WriteLine($"[EVIDENCE] input money after move: {input}; labour money after move: {labour}");
        input.Should().Be(new Money(PlotA2, CycleA2, "2026-10-27", 500m));
        labour.Should().Be(new Money(PlotA2, CycleA2, "2026-10-27", 2800m), "the amount never changes on a move (P7)");
        (await ReadMoneyAsync(unrelated)).Should().Be(new Money(PlotA1, CycleA1, SavedDay, 90m), "money not made from this record stays");

        var ledger = Assert.Single(await ReadAuditPayloadsAsync(MoneyLog, "LogMoved"));
        output.WriteLine($"[EVIDENCE] LogMoved money: {ledger.GetProperty("moneyMoved").GetRawText()}");
        ledger.GetProperty("moneyMoved").GetArrayLength().Should().Be(2);
    }

    [Fact]
    public async Task B002_a_move_to_the_whole_farm_takes_the_money_off_any_plot_and_season()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();
        await CreateMoneyLogAsync();

        await PushAppliedAsync(OwnerA, "move_daily_log", "req-ofs-money-farm", MovePayload(MoneyLog, 1, wholeFarm: true));

        (await ReadMoneyAsync(InputMoney)).Should().Be(new Money(null, null, SavedDay, 500m));
        (await ReadMoneyAsync(LabourMoney)).Should().Be(new Money(null, null, SavedDay, 2800m));
    }

    [Fact]
    public async Task B002_money_that_can_no_longer_move_safely_refuses_the_whole_move_and_nothing_changes()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();
        await CreateMoneyLogAsync();
        // The crew's money became a job card's payout (tied to that card's plot).
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.job_cards (id, farm_id, plot_id, crop_cycle_id, created_by_user_id, planned_date, status,
                                       created_at_utc, modified_at_utc, line_items)
            VALUES (@jc, @fid, @pid, @cid, @uid, DATE '2026-10-30', 'PaidOut', NOW(), NOW(), '[]'::jsonb);
            UPDATE ssf.cost_entries SET job_card_id = @jc WHERE "Id" = @money;
            """, ("jc", Guid.NewGuid()), ("fid", FarmA), ("pid", PlotA1), ("cid", CycleA1), ("uid", OwnerA), ("money", LabourMoney));

        var refused = await PushFailedAsync(OwnerA, "move_daily_log", "req-ofs-money-tied", MovePayload(MoneyLog, 1, plots: [PlotA2]));
        refused.ErrorCode.Should().Be("ShramSafal.LogMoveJobCard.Conflict");
        (await ReadPlacementAsync(MoneyLog)).PlotId.Should().Be(PlotA1);
        (await ReadMoneyAsync(InputMoney)).PlotId.Should().Be(PlotA1, "the whole move is refused: no line moves alone");
    }

    [Fact]
    public async Task B003_a_cancelled_card_cannot_hide_a_paid_one_linked_to_the_same_record()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();
        var logId = await CreateLogAsync(OwnerA, "req-ofs-create-two-cards");
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.job_cards (id, farm_id, plot_id, crop_cycle_id, created_by_user_id, planned_date, status,
                                       created_at_utc, modified_at_utc, linked_daily_log_id, line_items)
            VALUES (gen_random_uuid(), @fid, @pid, @cid, @uid, DATE '2026-10-30', 'Cancelled', NOW() - INTERVAL '1 day', NOW(), @log, '[]'::jsonb),
                   (gen_random_uuid(), @fid, @pid, @cid, @uid, DATE '2026-10-30', 'PaidOut', NOW(), NOW(), @log, '[]'::jsonb);
            """, ("fid", FarmA), ("pid", PlotA1), ("cid", CycleA1), ("uid", OwnerA), ("log", logId));

        for (var i = 0; i < 3; i++)
        {
            // Whatever order the rows come back in, the paid card is seen.
            var refused = await PushFailedAsync(OwnerA, "move_daily_log", $"req-ofs-two-cards-{i}", MovePayload(logId, 1, plots: [PlotA2]));
            refused.ErrorCode.Should().Be("ShramSafal.LogMoveJobCard.Conflict");
        }

        (await ReadPlacementAsync(logId)).PlotId.Should().Be(PlotA1);
    }

    [Fact]
    public async Task B008_a_day_move_is_refused_when_a_named_person_is_absent_on_the_new_day_but_a_present_mark_is_fine()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();
        var logId = await CreateLogAsync(OwnerA, "req-ofs-create-new-day");
        var (operatorId, _) = await PlantNamedPersonAsync(logId, "सीता");
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.attendance_marks ("Id", farm_id, field_operator_id, work_date, day_mark, night_mark,
                                              recorded_by_user_id, recorded_at_utc, modified_at_utc)
            VALUES (gen_random_uuid(), @fid, @oid, DATE '2026-10-26', 3, 0, @uid, NOW(), NOW()),
                   (gen_random_uuid(), @fid, @oid, DATE '2026-10-25', 1, 0, @uid, NOW(), NOW());
            """, ("fid", FarmA), ("oid", operatorId), ("uid", OwnerA));

        var refused = await PushFailedAsync(OwnerA, "move_daily_log", "req-ofs-to-absent-day", MovePayload(logId, 1, day: "2026-10-26"));
        refused.ErrorCode.Should().Be("ShramSafal.LogMoveAttendance.Conflict");
        (await ReadPlacementAsync(logId)).LogDate.Should().Be(SavedDay, "nothing changed");

        await PushAppliedAsync(OwnerA, "move_daily_log", "req-ofs-to-present-day", MovePayload(logId, 1, day: "2026-10-25"));
        (await ReadPlacementAsync(logId)).LogDate.Should().Be("2026-10-25");
    }

    [Fact]
    public async Task B010_the_plot_on_an_observation_made_from_the_record_follows_the_move()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();
        var logId = await CreateLogAsync(OwnerA, "req-ofs-create-observation");
        var observationId = Guid.NewGuid();
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.observation_events ("Id", daily_log_id, plot_id, note_type, severity, source, text_raw, created_at_utc)
            VALUES (@id, @log, @pid, 'Observation', 'Normal', 'Voice', 'पानांवर डाग', NOW());
            """, ("id", observationId), ("log", logId), ("pid", PlotA1));

        await PushAppliedAsync(OwnerA, "move_daily_log", "req-ofs-observation-move", MovePayload(logId, 1, plots: [PlotA2]));

        (await ScalarAsync("SELECT plot_id FROM ssf.observation_events WHERE \"Id\" = @id", observationId)).Should().Be(PlotA2);
    }

    // ═════════════════════════════════════════════════════════════════════════════════════════
    // fix pass 2 (FIX-2.md) — orchestrator call: a stated amount whose money cannot be found refuses the move whole;
    // N1 the answer carries exactly the money moved; N2 the money's own day; N4 money not arrived; N5 an emptied day;
    // item 9 a plain reason per cause.
    // ═════════════════════════════════════════════════════════════════════════════════════════

    private static readonly Guid DetailsLog = Guid.Parse("0f5e5000-0000-4000-8000-0000000000e1");

    // v5 ids computed OUTSIDE the code under test (Python uuid.uuid5 under the phone's money namespace).
    private static readonly Guid DetailsInputMoney = Guid.Parse("2a97c372-e3e0-54a0-954c-9a12597cfa54"); // "<DetailsLog>:input:inp-1"
    private static readonly Guid DetailsExpenseMoney = Guid.Parse("d85bb122-f0be-5a64-b5f1-be0dc46906d7"); // "<DetailsLog>:activity-expense:exp-1"

    [Fact]
    public async Task F2_a_crews_stated_total_whose_money_was_saved_the_old_way_refuses_the_move_and_nothing_changes()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();
        await CreateMoneyLogAsync(labourMoney: false);
        // The crew's ₹2800 was saved the OLD way: under the crew's local line id (or a random id on 1.0.15-1.0.17), not its engagement.
        var oldKeyMoney = Guid.NewGuid();
        await PushAppliedAsync(OwnerA, "add_cost_entry", "req-ofs-old-key", CostPayload(oldKeyMoney, "labour_misc", 2800m));

        var refused = await PushFailedAsync(OwnerA, "move_daily_log", "req-ofs-old-key-move", MovePayload(MoneyLog, 1, plots: [PlotA2]));
        refused.ErrorCode.Should().Be("ShramSafal.LogMoveMoneyNotFound.Conflict");
        (await ReadPlacementAsync(MoneyLog)).Should().Be(new Placement("Plot", PlotA1, [PlotA1], CycleA1, SavedDay, 1), "nothing changed");
        (await ReadMoneyAsync(oldKeyMoney)).Should().Be(new Money(PlotA1, CycleA1, SavedDay, 2800m));
        (await ReadMoneyAsync(InputMoney)).Should().Be(new Money(PlotA1, CycleA1, SavedDay, 500m), "no line moves alone");
        (await ReadAuditPayloadsAsync(MoneyLog, "LogMoved")).Should().BeEmpty();
    }

    [Fact]
    public async Task F2_a_record_whose_details_were_kept_on_the_phone_is_refused_as_details_not_held()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();
        // Details withheld (they did not fit the contract): the create carries no content, the lines go the old way.
        await PushAppliedAsync(OwnerA, "create_daily_log", "req-ofs-details-create", OldCreatePayload(DetailsLog, OwnerA, SavedDay, withDetails: false));
        await PushAppliedAsync(OwnerA, "add_log_task", "req-ofs-details-task", new Dictionary<string, object?>
        {
            ["dailyLogId"] = DetailsLog,
            ["logTaskId"] = Guid.NewGuid(),
            ["activityType"] = "Spray इथरेल",
            ["notes"] = "Qty: 250 मिली • Cost: ₹500",
            ["occurredAtUtc"] = "2026-10-30T06:00:00Z",
        });
        await PushAppliedAsync(OwnerA, "add_cost_entry", "req-ofs-details-money", CostPayload(DetailsInputMoney, "fertilizer", 500m));
        var version = (await ReadPlacementAsync(DetailsLog)).Version;

        var refused = await PushFailedAsync(OwnerA, "move_daily_log", "req-ofs-details-move", MovePayload(DetailsLog, version, plots: [PlotA2]));
        refused.ErrorCode.Should().Be("ShramSafal.LogMoveDetailsNotHeld.Conflict");
        (await ReadPlacementAsync(DetailsLog)).PlotId.Should().Be(PlotA1);
        (await ReadMoneyAsync(DetailsInputMoney)).PlotId.Should().Be(PlotA1);
    }

    private static readonly Guid LabourOnlyLog = Guid.Parse("0f5e6000-0000-4000-8000-0000000000f1");
    private static readonly Guid LabourOnlyCrew = Guid.Parse("0f5e6000-0000-4000-8000-0000000000f2");
    // v5 id computed OUTSIDE the code under test (Python uuid.uuid5): "<LabourOnlyLog>:labour:<LabourOnlyCrew>".
    private static readonly Guid LabourOnlyCrewMoney = Guid.Parse("010e835f-5bb7-5c4e-814f-bef1500a6f46");

    [Fact]
    public async Task R3_2_an_empty_create_time_document_is_the_records_details_so_a_labour_only_record_moves_from_any_phone()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();
        // A per-plot part of a multi-plot voice save that holds only labour: this build sends an EMPTY details document.
        var logId = LabourOnlyLog;
        var assignment = LabourOnlyCrew;
        var payload = OldCreatePayload(logId, OwnerA, SavedDay);
        payload["labour"] = new object[] { new { labourAssignmentId = assignment, engagementType = "hired_daily", workerCount = 5, totalCost = 1500 } };
        await PushAppliedAsync(OwnerA, "create_daily_log", "req-ofs-r32-create", payload);
        var stored = await ScalarAsync("SELECT origin || ':' || document::text FROM ssf.daily_log_contents WHERE daily_log_id = @id", logId);
        output.WriteLine($"[EVIDENCE] stored create-time details: {stored}");
        ((string)stored!).Should().StartWith("create:", "an empty document is stored as the record's create-time details");
        (await ScalarAsync("SELECT COUNT(*) FROM ssf.log_tasks WHERE daily_log_id = @id", logId)).Should().Be(0L,
            "an empty document says nothing was done: no task line is written from it");
        // The crew's money, made at the save under its engagement id.
        var crewMoney = LabourOnlyCrewMoney;
        await PushAppliedAsync(OwnerA, "add_cost_entry", "req-ofs-r32-money", CostPayload(crewMoney, "labour_misc", 1500m));

        // Moved from a phone that did not make it: the move names nothing and claims nothing; the server alone decides.
        await PushAppliedAsync(OwnerA, "move_daily_log", "req-ofs-r32-move", MovePayload(logId, 1, plots: [PlotA2]));
        (await ReadPlacementAsync(logId)).PlotId.Should().Be(PlotA2);
        (await ReadMoneyAsync(crewMoney)).PlotId.Should().Be(PlotA2, "the crew's stated money moved with it");
    }

    [Fact]
    public async Task R3_4_a_record_without_create_time_details_is_refused_from_every_phone_whatever_it_claims()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();
        // A 1.0.15-1.0.17 voice save (or a withheld create): no create-time details on the server. Its expense's money exists.
        await PushAppliedAsync(OwnerA, "create_daily_log", "req-ofs-r34-create", OldCreatePayload(DetailsLog, OwnerA, SavedDay, withDetails: false));
        await PushAppliedAsync(OwnerA, "add_cost_entry", "req-ofs-r34-money", CostPayload(DetailsExpenseMoney, "transport", 200m));

        // As this build's phones send a move: refused, with its own true reason.
        var plain = await PushFailedAsync(OwnerA, "move_daily_log", "req-ofs-r34-plain", MovePayload(DetailsLog, 1, plots: [PlotA2]));
        plain.ErrorCode.Should().Be("ShramSafal.LogMoveDetailsNotHeld.Conflict");

        // A phone claiming it holds the details and naming the expense (the fix pass 3 vouch): no phone can unlock it.
        var vouched = MovePayload(DetailsLog, 1, plots: [PlotA2]);
        vouched["moneyLines"] = new object[] { new { kind = "activity-expense", lineId = "exp-1" } };
        vouched["moneyLinesComplete"] = true;
        await PushFailedAsync(OwnerA, "move_daily_log", "req-ofs-r34-vouched", vouched);

        (await ReadPlacementAsync(DetailsLog)).PlotId.Should().Be(PlotA1, "nothing changed");
        (await ReadMoneyAsync(DetailsExpenseMoney)).PlotId.Should().Be(PlotA1);
        (await ReadAuditPayloadsAsync(DetailsLog, "LogMoved")).Should().BeEmpty();
    }

    // v5 id computed OUTSIDE the code under test (Python uuid.uuid5): "<MoneyLog>:input:in-late".
    private static readonly Guid LateLineMoney = Guid.Parse("bb5f5c6b-a661-59e0-ac95-48edf7b2c773");

    [Fact]
    public async Task R3_1_a_line_priced_by_a_later_edit_never_blocks_a_move_and_money_found_for_a_later_line_moves_too()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();
        await CreateMoneyLogAsync();
        // A later edit prices two new lines. Lane OF-M: the edit itself makes their money on the server, under their
        // derived ids; the phone's own send of "in-late" is then the same entry again (answered from the store).
        await PushAppliedAsync(OwnerA, "revise_log_content", "req-ofs-r31-revise", new Dictionary<string, object?>
        {
            ["dailyLogId"] = MoneyLog,
            ["baseVersion"] = 1,
            ["content"] = new
            {
                schema = 1,
                inputs = new object[]
                {
                    new { id = "tm-input-0", productName = "इथरेल", quantity = 250, unit = "मिली", cost = 500 },
                    new { id = "in-late", productName = "युरिया", cost = 300 },
                    new { id = "in-edit", productName = "पोटॅश", cost = 700 },
                },
            },
            ["revisedAtUtc"] = DateTime.UtcNow.ToString("O"),
        });
        await PushAppliedAsync(OwnerA, "add_cost_entry", "req-ofs-r31-late-money", CostPayload(LateLineMoney, "fertilizer", 300m));
        var version = (await ReadPlacementAsync(MoneyLog)).Version;

        var answer = await PushAppliedAsync(OwnerA, "move_daily_log", "req-ofs-r31-move", MovePayload(MoneyLog, version, plots: [PlotA2]));

        (await ReadMoneyAsync(LateLineMoney)).PlotId.Should().Be(PlotA2, "money found for a later line follows the record too");
        (await ReadMoneyAsync(InputMoney)).PlotId.Should().Be(PlotA2);
        (await ReadMoneyAsync(LabourMoney)).PlotId.Should().Be(PlotA2);
        var moved = JsonSerializer.SerializeToElement(answer.Data, new JsonSerializerOptions(JsonSerializerDefaults.Web)).GetProperty("moneyMoved");
        output.WriteLine($"[EVIDENCE] money moved with edit-priced lines present: {moved.GetArrayLength()} entries");
        moved.GetArrayLength().Should().Be(4, "the input, the crew, and the two lines the edit priced (OF-M made their money)");
    }

    [Fact]
    public async Task N4_a_stated_amount_whose_money_has_not_arrived_refuses_the_move_until_it_does()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();
        await CreateMoneyLogAsync(inputMoney: false);

        var refused = await PushFailedAsync(OwnerA, "move_daily_log", "req-ofs-early-move", MovePayload(MoneyLog, 1, plots: [PlotA2]));
        refused.ErrorCode.Should().Be("ShramSafal.LogMoveMoneyNotFound.Conflict", "the input's ₹500 has not arrived: never moved without it");
        (await ReadMoneyAsync(LabourMoney)).PlotId.Should().Be(PlotA1);

        await PushAppliedAsync(OwnerA, "add_cost_entry", "req-ofs-money-input", CostPayload(InputMoney, "fertilizer", 500m));
        await PushAppliedAsync(OwnerA, "move_daily_log", "req-ofs-early-move", MovePayload(MoneyLog, 1, plots: [PlotA2]));
        (await ReadMoneyAsync(InputMoney)).PlotId.Should().Be(PlotA2);
        (await ReadMoneyAsync(LabourMoney)).PlotId.Should().Be(PlotA2);
    }

    [Fact]
    public async Task N2_a_plot_only_move_never_changes_a_money_entrys_day()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();
        // The phone dates a record's money on the day it was SAVED: here the crew's money on 10-31 for a 10-30 record.
        await CreateMoneyLogAsync(labourMoneyDay: "2026-10-31");

        await PushAppliedAsync(OwnerA, "move_daily_log", "req-ofs-n2-plot", MovePayload(MoneyLog, 1, plots: [PlotA2]));

        (await ReadMoneyAsync(InputMoney)).Should().Be(new Money(PlotA2, CycleA2, SavedDay, 500m));
        (await ReadMoneyAsync(LabourMoney)).Should().Be(new Money(PlotA2, CycleA2, "2026-10-31", 2800m), "a plot move is not a day move");
    }

    [Fact]
    public async Task N2_a_day_move_shifts_only_the_money_dated_on_the_records_old_day()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();
        await CreateMoneyLogAsync(labourMoneyDay: "2026-10-31");

        await PushAppliedAsync(OwnerA, "move_daily_log", "req-ofs-n2-day", MovePayload(MoneyLog, 1, day: "2026-10-27"));

        (await ReadMoneyAsync(InputMoney)).Should().Be(new Money(PlotA1, CycleA1, "2026-10-27", 500m), "dated on the old day: follows");
        (await ReadMoneyAsync(LabourMoney)).Should().Be(new Money(PlotA1, CycleA1, "2026-10-31", 2800m), "dated on another day: keeps it");
    }

    [Fact]
    public async Task N5_a_day_left_with_no_records_after_a_move_looks_exactly_like_a_day_that_never_had_any()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();
        var logId = await CreateLogAsync(OwnerA, "req-ofs-n5-create");
        (await DayAggregatesAsync(SavedDay)).Should().Be(1L, "the create scores its day");

        await PushAppliedAsync(OwnerA, "move_daily_log", "req-ofs-n5-move", MovePayload(logId, 1, day: "2026-10-28"));

        var left = await DayAggregatesAsync(SavedDay);
        output.WriteLine($"[EVIDENCE] day aggregates on the emptied day after the move: {left}; on a day never recorded: {await DayAggregatesAsync("2026-10-20")}");
        left.Should().Be(0L, "no score and no day type are left on a day with no records — the same as a day that never had one");
        (await DayAggregatesAsync("2026-10-28")).Should().Be(1L);
    }

    [Fact]
    public async Task Item9_an_allocated_money_entry_gives_its_own_plain_reason()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();
        await CreateMoneyLogAsync();
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.day_ledgers ("Id", farm_id, source_cost_entry_id, ledger_date, allocation_basis, created_by_user_id,
                                         created_at_utc, modified_at_utc)
            VALUES (gen_random_uuid(), @fid, @money, DATE '2026-10-30', 'equal', @uid, NOW(), NOW());
            """, ("fid", FarmA), ("money", InputMoney), ("uid", OwnerA));

        var refused = await PushFailedAsync(OwnerA, "move_daily_log", "req-ofs-shared", MovePayload(MoneyLog, 1, plots: [PlotA2]));
        refused.ErrorCode.Should().Be("ShramSafal.LogMoveMoneyShared.Conflict");
        (await ReadPlacementAsync(MoneyLog)).PlotId.Should().Be(PlotA1);
    }

    // ═════════════════════════════════════════════════════════════════════════════════════════
    // fix pass 3 (FIX-3.md) — R2-1 details the server never held; R2-2 a repeated move answers in the same shape.
    // ═════════════════════════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task R2_1_a_record_whose_details_the_server_never_held_is_refused_and_its_expense_never_stays_behind_silently()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();
        // Details withheld or saved by an old phone: no content on the server, and an expense makes no old-style line.
        await PushAppliedAsync(OwnerA, "create_daily_log", "req-ofs-r21-create", OldCreatePayload(DetailsLog, OwnerA, SavedDay, withDetails: false));
        await PushAppliedAsync(OwnerA, "add_cost_entry", "req-ofs-r21-money", CostPayload(DetailsExpenseMoney, "transport", 200m));

        var refused = await PushFailedAsync(OwnerA, "move_daily_log", "req-ofs-r21-other-phone", MovePayload(DetailsLog, 1, plots: [PlotA2]));
        refused.ErrorCode.Should().Be("ShramSafal.LogMoveDetailsNotHeld.Conflict");
        (await ReadPlacementAsync(DetailsLog)).PlotId.Should().Be(PlotA1, "nothing changed");
        (await ReadMoneyAsync(DetailsExpenseMoney)).PlotId.Should().Be(PlotA1, "the expense never stays behind silently");
        (await ReadAuditPayloadsAsync(DetailsLog, "LogMoved")).Should().BeEmpty();
    }

    [Fact]
    public async Task R2_1_a_record_the_server_holds_is_unchanged_it_moves_without_any_word_from_the_phone()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();
        await CreateMoneyLogAsync(); // create-time details on the server

        await PushAppliedAsync(OwnerA, "move_daily_log", "req-ofs-r21-held", MovePayload(MoneyLog, 1, plots: [PlotA2]));
        (await ReadMoneyAsync(InputMoney)).PlotId.Should().Be(PlotA2);
        (await ReadMoneyAsync(LabourMoney)).PlotId.Should().Be(PlotA2);
    }

    [Fact]
    public async Task R2_2_a_repeated_move_answers_in_the_same_shape_with_the_same_money()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();
        await CreateMoneyLogAsync();
        var move = MovePayload(MoneyLog, 1, plots: [PlotA2]);

        var first = await PushAppliedAsync(OwnerA, "move_daily_log", "req-ofs-r22-move", move);
        var again = await PushAsync(OwnerA, "move_daily_log", "req-ofs-r22-move", move);
        var replay = Assert.Single(again.Value!.Results);
        replay.Status.Should().Be("duplicate");

        var web = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        var firstData = JsonSerializer.SerializeToElement(first.Data, web);
        var replayData = JsonSerializer.SerializeToElement(replay.Data, web);
        output.WriteLine($"[EVIDENCE] repeated move answer keys: {string.Join(",", replayData.EnumerateObject().Select(p => p.Name))}");
        replayData.GetProperty("moneyMoved").GetArrayLength().Should().Be(2, "a repeat answers {{ log, moneyMoved }} exactly as the first answer did");
        replayData.GetProperty("moneyMoved")[0].GetProperty("id").GetGuid()
            .Should().Be(firstData.GetProperty("moneyMoved")[0].GetProperty("id").GetGuid());
        replayData.GetProperty("moneyMoved")[0].GetProperty("plotId").GetGuid().Should().Be(PlotA2);
        replayData.GetProperty("log").GetProperty("id").GetGuid().Should().Be(MoneyLog);
    }

    private async Task<long> DayAggregatesAsync(string day) =>
        (long)(await ScalarTextAsync(
            "SELECT COUNT(*) FROM ssf.daily_richness_aggregates WHERE farm_id = '0f5e0000-0000-4000-8000-0000000000a1' AND local_date = @id::date",
            day))!;

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers.
    // ─────────────────────────────────────────────────────────────────────────

    private sealed record Placement(string Scope, Guid? PlotId, Guid[] PlotIds, Guid? CropCycleId, string LogDate, int Version)
    {
        public bool Equals(Placement? other) =>
            other is not null && Scope == other.Scope && PlotId == other.PlotId && CropCycleId == other.CropCycleId
            && LogDate == other.LogDate && Version == other.Version
            && PlotIds.OrderBy(x => x).SequenceEqual(other.PlotIds.OrderBy(x => x));

        public override int GetHashCode() => HashCode.Combine(Scope, PlotId, CropCycleId, LogDate, Version);

        public override string ToString() =>
            $"scope={Scope} plot_id={PlotId?.ToString() ?? "NULL"} plot_ids=[{string.Join(",", PlotIds)}] "
            + $"crop_cycle_id={CropCycleId?.ToString() ?? "NULL"} log_date={LogDate} content_version={Version}";
    }

    private async Task<Placement> ReadPlacementAsync(Guid logId)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT scope, plot_id, plot_ids, crop_cycle_id, log_date, content_version FROM ssf.daily_logs WHERE "Id" = @id
            """;
        cmd.Parameters.AddWithValue("id", logId);
        await using var reader = await cmd.ExecuteReaderAsync();
        (await reader.ReadAsync()).Should().BeTrue("the record must exist");
        return new Placement(
            reader.GetString(0),
            reader.IsDBNull(1) ? null : reader.GetGuid(1),
            reader.GetFieldValue<Guid[]>(2),
            reader.IsDBNull(3) ? null : reader.GetGuid(3),
            Day(reader.GetValue(4)),
            reader.GetInt32(5));
    }

    /// <summary>A Postgres <c>date</c> as yyyy-MM-dd, whichever CLR type the driver hands back.</summary>
    private static string Day(object? value) => value switch
    {
        DateOnly d => d.ToString("yyyy-MM-dd"),
        DateTime t => t.ToString("yyyy-MM-dd"),
        _ => throw new InvalidOperationException($"not a date: {value?.GetType().Name ?? "null"}"),
    };

    private async Task<Guid> CreateLogAsync(Guid actor, string requestId)
    {
        var logId = Guid.NewGuid();
        await PushAppliedAsync(actor, "create_daily_log", requestId, OldCreatePayload(logId, actor, SavedDay));
        return logId;
    }

    /// <summary>A named person (field operator) on a labour engagement of this record, on its day.</summary>
    private async Task<(Guid OperatorId, Guid WorkRowId)> PlantNamedPersonAsync(Guid logId, string name)
    {
        var operatorId = Guid.NewGuid();
        var assignmentId = Guid.NewGuid();
        var workRowId = Guid.NewGuid();
        await ExecOnSuperuserAsync("""
            INSERT INTO ssf.labour_assignments ("Id", daily_log_id, engagement_type, worker_count, worker_names_json, created_at_utc, duration_hours, time_basis)
            VALUES (@aid, @log, 'Hired', 3, '[]'::jsonb, NOW(), 8, 'Assumed');
            INSERT INTO ssf.field_operators ("Id", display_name, display_name_normalized, full_name, originating_farm_id, created_by_user_id, created_at_utc, is_active)
            VALUES (@oid, @name, lower(@name), NULL, @fid, @uid, NOW(), TRUE);
            INSERT INTO ssf.field_operator_work_rows ("Id", field_operator_id, labour_assignment_id, farm_id, work_date,
                                                      display_name_at_attach, recorded_by_user_id, created_at_utc)
            VALUES (@wid, @oid, @aid, @fid, DATE '2026-10-30', @name, @uid, NOW());
            """, ("aid", assignmentId), ("log", logId), ("oid", operatorId), ("name", name), ("fid", FarmA), ("uid", OwnerA),
            ("wid", workRowId));
        return (operatorId, workRowId);
    }

    /// <summary>
    /// A create as THIS build sends it: with its details document, empty when there are none (fix pass 4, R3-2).
    /// <paramref name="withDetails"/> false = an older phone's save (1.0.15–1.0.17), or a create whose details were withheld.
    /// </summary>
    private static Dictionary<string, object?> OldCreatePayload(Guid dailyLogId, Guid operatorId, string logDate, bool withDetails = true)
    {
        var payload = new Dictionary<string, object?>
        {
            ["dailyLogId"] = dailyLogId,
            ["farmId"] = FarmA,
            ["plotId"] = PlotA1,
            ["cropCycleId"] = CycleA1,
            ["operatorUserId"] = operatorId,
            ["logDate"] = logDate,
        };
        if (withDetails) payload["content"] = new { schema = 1 };
        return payload;
    }

    private static Dictionary<string, object?> MovePayload(
        Guid dailyLogId, int baseVersion, Guid[]? plots = null, bool wholeFarm = false, string? day = null, string? reason = null)
    {
        var payload = new Dictionary<string, object?>
        {
            ["dailyLogId"] = dailyLogId,
            ["baseVersion"] = baseVersion,
            ["revisedAtUtc"] = DateTime.UtcNow.ToString("O"),
        };
        if (plots is not null) payload["newPlotIds"] = plots;
        if (wholeFarm) payload["wholeFarm"] = true;
        if (day is not null) payload["newLogDate"] = day;
        if (reason is not null) payload["reason"] = reason;
        return payload;
    }

    private async Task<string> LatestStatusAsync(Guid logId) =>
        (string)(await ScalarAsync(
            "SELECT status FROM ssf.verification_events WHERE daily_log_id = @id ORDER BY occurred_at_utc DESC LIMIT 1", logId))!;

    private static IEnumerable<string> JsonKeys(DailyLogDto dto) =>
        JsonSerializer.SerializeToElement(dto).EnumerateObject().Select(p => p.Name).ToArray();

    private async Task<List<JsonElement>> ReadAuditPayloadsAsync(Guid logId, string action)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT payload::text FROM ssf.audit_events WHERE entity_id = @id AND action = @action ORDER BY occurred_at_utc
            """;
        cmd.Parameters.AddWithValue("id", logId);
        cmd.Parameters.AddWithValue("action", action);
        await using var reader = await cmd.ExecuteReaderAsync();
        var rows = new List<JsonElement>();
        while (await reader.ReadAsync())
        {
            rows.Add(JsonDocument.Parse(reader.GetString(0)).RootElement.Clone());
        }

        return rows;
    }

    private async Task<SyncMutationResultDto> PushAppliedAsync(Guid actor, string mutationType, string clientRequestId, Dictionary<string, object?> payload)
    {
        var push = await PushAsync(actor, mutationType, clientRequestId, payload);
        push.IsSuccess.Should().BeTrue("the push must succeed: {0}", push.Error?.ToString() ?? "-");
        var result = Assert.Single(push.Value!.Results);
        result.Status.Should().Be("applied", "{0} error='{1}: {2}'", mutationType, result.ErrorCode, result.ErrorMessage);
        return result;
    }

    private async Task<SyncMutationResultDto> PushFailedAsync(Guid actor, string mutationType, string clientRequestId, Dictionary<string, object?> payload)
    {
        var push = await PushAsync(actor, mutationType, clientRequestId, payload);
        push.IsSuccess.Should().BeTrue("the batch itself is answered: {0}", push.Error?.ToString() ?? "-");
        var result = Assert.Single(push.Value!.Results);
        output.WriteLine($"[EVIDENCE] {mutationType} {clientRequestId} -> {result.Status} {result.ErrorCode}");
        result.Status.Should().Be("failed");
        return result;
    }

    private async Task<AgriSync.BuildingBlocks.Results.Result<SyncPushResponseDto>> PushAsync(
        Guid actor, string mutationType, string clientRequestId, Dictionary<string, object?> payload)
    {
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        sp.GetRequiredService<TenantContext>().ElevateToAdminCrossTenant();

        var command = new PushSyncBatchCommand(
            DeviceId: $"device-ofs-{actor:N}",
            AuthenticatedUserId: actor,
            ActorRole: "PrimaryOwner",
            Mutations: new[]
            {
                new PushSyncMutationCommand(clientRequestId, mutationType, JsonSerializer.SerializeToElement(payload)),
            },
            AppVersion: "1.0.18");

        return await sp.GetRequiredService<PushSyncBatchHandler>().HandleAsync(command);
    }

    private async Task<DailyLogDto> PullDailyLogAsync(Guid user, Guid dailyLogId)
    {
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        sp.GetRequiredService<TenantContext>().SetUserScoped(user);
        var result = await sp.GetRequiredService<PullSyncChangesHandler>()
            .HandleAsync(new PullSyncChangesQuery(DateTime.UnixEpoch, user));
        result.IsSuccess.Should().BeTrue("the pull must succeed: {0}", result.Error?.ToString() ?? "-");
        return result.Value!.DailyLogs.Should().ContainSingle(l => l.Id == dailyLogId, "the log must come back down").Subject;
    }

    private async Task AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync()
    {
        await using var app = new NpgsqlConnection(_appConn);
        await app.OpenAsync();
        await using var cmd = app.CreateCommand();
        cmd.CommandText =
            "SELECT current_user, (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user), current_database()";
        await using var reader = await cmd.ExecuteReaderAsync();
        (await reader.ReadAsync()).Should().BeTrue();
        var role = reader.GetString(0);
        var canBypass = reader.GetBoolean(1);
        var database = reader.GetString(2);

        role.Should().Be(AppRoleUser);
        canBypass.Should().BeFalse("an RLS proof run as a superuser or BYPASSRLS role proves nothing (E3)");
        database.Should().Be(_scratchDbName);
        output.WriteLine($"[PROVISIONING] role={role} superuser_or_bypassrls={canBypass} database={database}");
    }

    private async Task ExecOnSuperuserAsync(string sql, params (string Name, object Value)[] args)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await ExecAsync(db, sql, args);
    }

    private async Task<object?> ScalarTextAsync(string sql, string id)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        cmd.Parameters.AddWithValue("id", id);
        return await cmd.ExecuteScalarAsync();
    }

    private async Task<object?> ScalarAsync(string sql, Guid id)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        cmd.Parameters.AddWithValue("id", id);
        return await cmd.ExecuteScalarAsync();
    }

    private static async Task ExecAsync(NpgsqlConnection db, string sql, params (string Name, object Value)[] args)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in args)
        {
            cmd.Parameters.AddWithValue(name, value);
        }

        await cmd.ExecuteNonQueryAsync();
    }

    private sealed class AllowAllEntitlementPolicy : IEntitlementPolicy
    {
        public Task<EntitlementDecision> EvaluateAsync(
            UserId userId, FarmId farmId, PaidFeature feature, System.Threading.CancellationToken ct = default)
            => Task.FromResult(new EntitlementDecision(true, EntitlementReason.Allowed, null));
    }

    private sealed class NoopAnalyticsWriter : IAnalyticsWriter
    {
        public Task EmitAsync(AnalyticsEvent e, System.Threading.CancellationToken ct = default) => Task.CompletedTask;
        public Task EmitManyAsync(IEnumerable<AnalyticsEvent> events, System.Threading.CancellationToken ct = default) => Task.CompletedTask;
    }
}
