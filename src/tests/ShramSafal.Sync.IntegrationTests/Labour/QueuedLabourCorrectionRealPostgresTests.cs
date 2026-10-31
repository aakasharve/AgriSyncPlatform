// spec: plr-d10-redesign-real-integration-2026-10-25 (lane OF-S)
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShramSafal.Api;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Labour.CorrectLabour;
using ShramSafal.Application.UseCases.Sync.PushSyncBatch;
using ShramSafal.Infrastructure.Persistence;
using ShramSafal.Sync.IntegrationTests.Memberships;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Labour;

/// <summary>
/// <b>Lane OF-S — a worker-count / hours correction made with no internet</b> (<c>correct_labour_assignment</c>),
/// queued and sent through <c>/sync/push</c>, reaching the SAME <see cref="CorrectLabourHandler"/> as the online route.
/// Run as the non-superuser <c>agrisync_app</c> role (E3 first). Each fact owns a scratch database.
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class QueuedLabourCorrectionRealPostgresTests(Xunit.Abstractions.ITestOutputHelper output) : IAsyncLifetime
{
    private const string AppRoleUser = TestRoleCredentials.AppRoleUser;
    private static string AppRolePassword => TestRoleCredentials.AppRolePassword;

    private static readonly Guid FarmA = Guid.Parse("0f5e1000-0000-4000-8000-0000000000a1");
    private static readonly Guid OwnerA = Guid.Parse("0f5e1000-0000-4000-8000-0000000000a2");
    private static readonly Guid AccountA = Guid.Parse("0f5e1000-0000-4000-8000-0000000000a3");
    private static readonly Guid PlotA = Guid.Parse("0f5e1000-0000-4000-8000-0000000000a4");
    private static readonly Guid CycleA = Guid.Parse("0f5e1000-0000-4000-8000-0000000000a5");
    private static readonly Guid MukadamA = Guid.Parse("0f5e1000-0000-4000-8000-0000000000a6");
    private static readonly Guid WorkerA = Guid.Parse("0f5e1000-0000-4000-8000-0000000000a7");

    private static readonly Guid FarmB = Guid.Parse("0f5e1000-0000-4000-8000-0000000000b1");
    private static readonly Guid OwnerB = Guid.Parse("0f5e1000-0000-4000-8000-0000000000b2");
    private static readonly Guid AccountB = Guid.Parse("0f5e1000-0000-4000-8000-0000000000b3");
    private static readonly Guid PlotB = Guid.Parse("0f5e1000-0000-4000-8000-0000000000b4");
    private static readonly Guid CycleB = Guid.Parse("0f5e1000-0000-4000-8000-0000000000b5");

    private string _adminConn = string.Empty;
    private string _superuserConn = string.Empty;
    private string _appConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private ServiceProvider? _rootProvider;

    public async Task InitializeAsync()
    {
        _adminConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();
        _scratchDbName = $"ssf_ofs_labour_{Guid.NewGuid():N}";
        await using (var admin = new NpgsqlConnection(_adminConn))
        {
            await admin.OpenAsync();
            await ExecAsync(admin, $"CREATE DATABASE \"{_scratchDbName}\"");
        }

        _superuserConn = new NpgsqlConnectionStringBuilder(_adminConn) { Database = _scratchDbName }.ConnectionString;
        _appConn = new NpgsqlConnectionStringBuilder(_superuserConn) { Username = AppRoleUser, Password = AppRolePassword }.ConnectionString;

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
                VALUES (@farmA, 'OF-S Labour A', @ownerA, @accountA, NOW(), NOW(), 3.0, 'Unchecked'),
                       (@farmB, 'OF-S Labour B', @ownerB, @accountB, NOW(), NOW(), 3.0, 'Unchecked');
                INSERT INTO ssf.farm_memberships ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status)
                VALUES (gen_random_uuid(), @farmA, @ownerA, 'PrimaryOwner', NOW(), NOW(), @accountA, 3),
                       (gen_random_uuid(), @farmA, @workerA, 'Worker', NOW(), NOW(), @accountA, 3),
                       (gen_random_uuid(), @farmB, @ownerB, 'PrimaryOwner', NOW(), NOW(), @accountB, 3);
                INSERT INTO ssf.farm_memberships ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status, can_manage_labour_records)
                VALUES (gen_random_uuid(), @farmA, @mukadamA, 'Mukadam', NOW(), NOW(), @accountA, 3, TRUE),
                       (gen_random_uuid(), @farmB, @mukadamA, 'Mukadam', NOW(), NOW(), @accountB, 3, TRUE);
                INSERT INTO ssf.plots ("Id", farm_id, name, area_in_acres, created_at_utc, modified_at_utc)
                VALUES (@plotA, @farmA, 'Plot A', 1.0, NOW(), NOW()), (@plotB, @farmB, 'Plot B', 1.0, NOW(), NOW());
                INSERT INTO ssf.crop_cycles ("Id", farm_id, plot_id, crop_name, stage, start_date, created_at_utc, modified_at_utc)
                VALUES (@cycleA, @farmA, @plotA, 'Grapes', 'Vegetative', DATE '2026-01-01', NOW(), NOW()),
                       (@cycleB, @farmB, @plotB, 'Grapes', 'Vegetative', DATE '2026-01-01', NOW(), NOW());
                """,
                ("farmA", FarmA), ("ownerA", OwnerA), ("accountA", AccountA), ("workerA", WorkerA), ("mukadamA", MukadamA),
                ("plotA", PlotA), ("cycleA", CycleA),
                ("farmB", FarmB), ("ownerB", OwnerB), ("accountB", AccountB), ("plotB", PlotB), ("cycleB", CycleB));
            await UpgradedSeats.CarryAsync(raw, FarmA);
            await UpgradedSeats.CarryAsync(raw, FarmB);
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
            output.WriteLine($"[TEARDOWN] scratch database {_scratchDbName} was not dropped: {ex.GetType().Name}");
        }
    }

    [Fact]
    public async Task A_queued_count_correction_is_applied_once_even_when_replayed()
    {
        await AssertRunsAsNonSuperuserAsync();
        var (logId, assignmentId) = await PlantEngagementAsync(FarmA, PlotA, CycleA, workerCount: 8);

        var payload = CorrectionPayload(assignmentId, logId, FarmA, newCount: 6, seenCount: 8);
        var first = await PushAsync(MukadamA, "req-ofs-labour-1", payload);
        first.Status.Should().Be("applied", "{0}: {1}", first.ErrorCode, first.ErrorMessage);
        var again = await PushAsync(MukadamA, "req-ofs-labour-1", payload);
        output.WriteLine($"[EVIDENCE] replay of the same request -> {again.Status}");
        again.Status.Should().Be("duplicate");

        (await ScalarAsync("SELECT worker_count FROM ssf.labour_assignments WHERE \"Id\" = @id", assignmentId)).Should().Be(6);
        var history = await ReadHistoryAsync(assignmentId);
        output.WriteLine($"[EVIDENCE] history rows: {string.Join(" | ", history)}");
        history.Should().Equal("WorkerCount:8->6");
        (await ScalarAsync("SELECT content_version FROM ssf.daily_logs WHERE \"Id\" = @id", logId)).Should().Be(2,
            "a headcount that moved is a material change, exactly as on the online route");
    }

    [Fact]
    public async Task A_stale_queued_correction_is_refused_plainly_and_the_newer_count_stands()
    {
        await AssertRunsAsNonSuperuserAsync();
        var (logId, assignmentId) = await PlantEngagementAsync(FarmA, PlotA, CycleA, workerCount: 8);

        // Someone corrected 8 -> 7 meanwhile (online). His phone still shows 8 and asks for 6.
        var online = await RunOnlineAsync(MukadamA, new CorrectLabourCommand(
            new FarmId(FarmA), assignmentId, new UserId(MukadamA), "device-online", "req-ofs-online-7",
            Reason: null, Quantity: new LabourQuantityCorrection(7, null, null), DurationHours: null,
            AttributionAdds: null, AttributionRemovals: null));
        online.IsSuccess.Should().BeTrue();

        var refused = await PushAsync(MukadamA, "req-ofs-labour-stale", CorrectionPayload(assignmentId, logId, FarmA, newCount: 6, seenCount: 8));
        output.WriteLine($"[EVIDENCE] stale queued correction -> {refused.Status} {refused.ErrorCode}");
        refused.Status.Should().Be("failed");
        refused.ErrorCode.Should().Be("ShramSafal.LabourCorrection.Conflict");
        (await ScalarAsync("SELECT worker_count FROM ssf.labour_assignments WHERE \"Id\" = @id", assignmentId)).Should().Be(7,
            "a stale correction never overwrites a newer one");
        (await ReadHistoryAsync(assignmentId)).Should().Equal("WorkerCount:8->7");

        // The online route takes the same "what he saw" rule when it is sent.
        var onlineStale = await RunOnlineAsync(MukadamA, new CorrectLabourCommand(
            new FarmId(FarmA), assignmentId, new UserId(MukadamA), "device-online", "req-ofs-online-stale",
            Reason: null, Quantity: new LabourQuantityCorrection(5, null, null), DurationHours: null,
            AttributionAdds: null, AttributionRemovals: null)
        { Seen = new LabourCorrectionSeen(8, null, null, null) });
        onlineStale.Error.Code.Should().Be("ShramSafal.LabourCorrection.Conflict");
    }

    [Fact]
    public async Task The_queued_path_and_the_online_route_leave_the_same_record_and_the_same_stated_wages()
    {
        await AssertRunsAsNonSuperuserAsync();
        var (_, onlineAssignment) = await PlantEngagementAsync(FarmA, PlotA, CycleA, workerCount: 8, wagePerPerson: 350m, totalCost: 2800m);
        var (queuedLog, queuedAssignment) = await PlantEngagementAsync(FarmA, PlotA, CycleA, workerCount: 8, wagePerPerson: 350m, totalCost: 2800m);

        var online = await RunOnlineAsync(MukadamA, new CorrectLabourCommand(
            new FarmId(FarmA), onlineAssignment, new UserId(MukadamA), "device-online", "req-ofs-online-same",
            Reason: "मोजले", Quantity: new LabourQuantityCorrection(6, 4, 2), DurationHours: 4.5m,
            AttributionAdds: null, AttributionRemovals: null));
        online.IsSuccess.Should().BeTrue();

        var queued = await PushAsync(MukadamA, "req-ofs-queued-same", CorrectionPayload(
            queuedAssignment, queuedLog, FarmA, newCount: 6, seenCount: 8, male: 4, female: 2, hours: 4.5m, seenHours: 8m, reason: "मोजले"));
        queued.Status.Should().Be("applied", "{0}: {1}", queued.ErrorCode, queued.ErrorMessage);

        var a = await ReadEngagementAsync(onlineAssignment);
        var b = await ReadEngagementAsync(queuedAssignment);
        output.WriteLine($"[EVIDENCE] online: {a}");
        output.WriteLine($"[EVIDENCE] queued: {b}");
        b.Should().Be(a, "the queued path reaches the SAME handler: the same counts, hours and basis, and the stated wage "
                         + "and total untouched on both (NO-MULTIPLY: a correction never derives money)");
        a.WagePerPerson.Should().Be(350m);
        a.TotalCost.Should().Be(2800m);
        (await ReadHistoryAsync(queuedAssignment)).Should().Equal(await ReadHistoryAsync(onlineAssignment));
    }

    [Fact]
    public async Task Another_farm_or_another_record_is_refused_and_nothing_changes()
    {
        await AssertRunsAsNonSuperuserAsync();
        var (logA, assignmentA) = await PlantEngagementAsync(FarmA, PlotA, CycleA, workerCount: 8);
        var (logB, assignmentB) = await PlantEngagementAsync(FarmB, PlotB, CycleB, workerCount: 5);

        // Foreign child: farm A named, farm B's engagement (the mukadam may manage BOTH farms).
        var foreignChild = await PushAsync(MukadamA, "req-ofs-foreign-child", CorrectionPayload(assignmentB, logB, FarmA, newCount: 4, seenCount: 5));
        foreignChild.ErrorCode.Should().Be("ShramSafal.Forbidden");
        // Foreign parent: farm B's owner names farm A.
        var foreignParent = await PushAsync(OwnerB, "req-ofs-foreign-parent", CorrectionPayload(assignmentA, logA, FarmA, newCount: 4, seenCount: 8));
        foreignParent.ErrorCode.Should().Be("ShramSafal.Forbidden");
        // The right farm, the wrong record.
        var (otherLog, _) = await PlantEngagementAsync(FarmA, PlotA, CycleA, workerCount: 3);
        var wrongLog = await PushAsync(MukadamA, "req-ofs-wrong-log", CorrectionPayload(assignmentA, otherLog, FarmA, newCount: 4, seenCount: 8));
        wrongLog.ErrorCode.Should().Be("ShramSafal.Forbidden");

        (await ScalarAsync("SELECT worker_count FROM ssf.labour_assignments WHERE \"Id\" = @id", assignmentA)).Should().Be(8);
        (await ScalarAsync("SELECT worker_count FROM ssf.labour_assignments WHERE \"Id\" = @id", assignmentB)).Should().Be(5);
        (await ReadHistoryAsync(assignmentA)).Should().BeEmpty();
        (await ReadHistoryAsync(assignmentB)).Should().BeEmpty();
    }

    [Fact]
    public async Task A_seat_without_labour_authority_is_refused()
    {
        await AssertRunsAsNonSuperuserAsync();
        var (logId, assignmentId) = await PlantEngagementAsync(FarmA, PlotA, CycleA, workerCount: 8);

        var refused = await PushAsync(WorkerA, "req-ofs-no-authority", CorrectionPayload(assignmentId, logId, FarmA, newCount: 6, seenCount: 8));
        output.WriteLine($"[EVIDENCE] worker without the labour switch -> {refused.Status} {refused.ErrorCode}");
        refused.ErrorCode.Should().Be("ShramSafal.Forbidden");
        (await ScalarAsync("SELECT worker_count FROM ssf.labour_assignments WHERE \"Id\" = @id", assignmentId)).Should().Be(8);
        (await ReadHistoryAsync(assignmentId)).Should().BeEmpty();
    }

    // ── Helpers ──────────────────────────────────────────────────────────────────────────────

    private sealed record Engagement(int? WorkerCount, int? MaleCount, int? FemaleCount, decimal DurationHours,
        string TimeBasis, decimal? WagePerPerson, decimal? TotalCost);

    private async Task<Engagement> ReadEngagementAsync(Guid assignmentId)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT worker_count, male_count, female_count, duration_hours, time_basis, wage_per_person, total_cost
            FROM ssf.labour_assignments WHERE "Id" = @id
            """;
        cmd.Parameters.AddWithValue("id", assignmentId);
        await using var r = await cmd.ExecuteReaderAsync();
        (await r.ReadAsync()).Should().BeTrue();
        return new Engagement(
            r.IsDBNull(0) ? null : r.GetInt32(0), r.IsDBNull(1) ? null : r.GetInt32(1), r.IsDBNull(2) ? null : r.GetInt32(2),
            r.GetDecimal(3), r.GetString(4), r.IsDBNull(5) ? null : r.GetDecimal(5), r.IsDBNull(6) ? null : r.GetDecimal(6));
    }

    private async Task<List<string>> ReadHistoryAsync(Guid assignmentId)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT changed_field, original_value, new_value FROM ssf.labour_corrections
            WHERE labour_assignment_id = @id ORDER BY changed_field
            """;
        cmd.Parameters.AddWithValue("id", assignmentId);
        await using var r = await cmd.ExecuteReaderAsync();
        var rows = new List<string>();
        while (await r.ReadAsync())
        {
            rows.Add($"{r.GetString(0)}:{(r.IsDBNull(1) ? "null" : r.GetString(1))}->{(r.IsDBNull(2) ? "null" : r.GetString(2))}");
        }

        return rows;
    }

    private async Task<(Guid LogId, Guid AssignmentId)> PlantEngagementAsync(
        Guid farmId, Guid plotId, Guid cycleId, int workerCount, decimal? wagePerPerson = null, decimal? totalCost = null)
    {
        var logId = Guid.NewGuid();
        var assignmentId = Guid.NewGuid();
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await ExecAsync(db, """
            INSERT INTO ssf.daily_logs ("Id", farm_id, plot_id, crop_cycle_id, plot_ids, scope, operator_user_id, log_date, created_at_utc, source, model_version, prompt_version)
            VALUES (@id, @fid, @pid, @cid, ARRAY[@pid], 'Plot', @uid, DATE '2026-10-29', NOW(), 'manual', 'unknown', 'unknown');
            INSERT INTO ssf.labour_assignments ("Id", daily_log_id, engagement_type, worker_count, worker_names_json, created_at_utc,
                                                duration_hours, time_basis, wage_per_person, total_cost)
            VALUES (@aid, @id, 'Hired', @count, '[]'::jsonb, NOW(), 8, 'Assumed', @wage, @total);
            """,
            ("id", logId), ("fid", farmId), ("pid", plotId), ("cid", cycleId), ("uid", farmId == FarmA ? OwnerA : OwnerB),
            ("aid", assignmentId), ("count", workerCount),
            ("wage", (object?)wagePerPerson ?? DBNull.Value), ("total", (object?)totalCost ?? DBNull.Value));
        return (logId, assignmentId);
    }

    private static Dictionary<string, object?> CorrectionPayload(
        Guid assignmentId, Guid logId, Guid farmId, int newCount, int seenCount,
        int? male = null, int? female = null, decimal? hours = null, decimal? seenHours = null, string? reason = null)
    {
        var quantity = new Dictionary<string, object?> { ["workerCount"] = newCount };
        if (male is not null) quantity["maleCount"] = male;
        if (female is not null) quantity["femaleCount"] = female;
        var seen = new Dictionary<string, object?> { ["workerCount"] = seenCount };
        if (seenHours is not null) seen["durationHours"] = seenHours;
        var payload = new Dictionary<string, object?>
        {
            ["labourAssignmentId"] = assignmentId,
            ["dailyLogId"] = logId,
            ["farmId"] = farmId,
            ["quantity"] = quantity,
            ["seen"] = seen,
            ["correctedAtUtc"] = DateTime.UtcNow.ToString("O"),
        };
        if (hours is not null) payload["durationHours"] = hours;
        if (reason is not null) payload["reason"] = reason;
        return payload;
    }

    private async Task<SyncMutationResultDto> PushAsync(Guid actor, string clientRequestId, Dictionary<string, object?> payload)
    {
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        sp.GetRequiredService<TenantContext>().ElevateToAdminCrossTenant();
        var command = new PushSyncBatchCommand(
            DeviceId: $"device-ofs-{actor:N}",
            AuthenticatedUserId: actor,
            ActorRole: "Mukadam",
            Mutations: new[]
            {
                new PushSyncMutationCommand(clientRequestId, "correct_labour_assignment", JsonSerializer.SerializeToElement(payload)),
            },
            AppVersion: "1.0.18");
        var push = await sp.GetRequiredService<PushSyncBatchHandler>().HandleAsync(command);
        push.IsSuccess.Should().BeTrue();
        return Assert.Single(push.Value!.Results);
    }

    /// <summary>The online route as the endpoint runs it: the caller's farm scope, then the pipeline-resolved handler.</summary>
    private async Task<Result<CorrectLabourResult>> RunOnlineAsync(Guid caller, CorrectLabourCommand command)
    {
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        var ctx = sp.GetRequiredService<ShramSafalDbContext>();
        sp.GetRequiredService<TenantContext>().ElevateToAdminCrossTenant();
        await using var tx = await ctx.Database.BeginTransactionAsync();
        await ctx.Database.ExecuteSqlInterpolatedAsync($"SELECT set_config('agrisync.user_id', {caller.ToString()}, true)");
        await ctx.Database.ExecuteSqlInterpolatedAsync($"SELECT set_config('agrisync.farm_id', {command.FarmId.Value.ToString()}, true)");
        var result = await sp.GetRequiredService<IHandler<CorrectLabourCommand, CorrectLabourResult>>().HandleAsync(command);
        await tx.CommitAsync();
        return result;
    }

    private async Task AssertRunsAsNonSuperuserAsync()
    {
        await using var app = new NpgsqlConnection(_appConn);
        await app.OpenAsync();
        await using var cmd = app.CreateCommand();
        cmd.CommandText = "SELECT current_user, (SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user)";
        await using var reader = await cmd.ExecuteReaderAsync();
        (await reader.ReadAsync()).Should().BeTrue();
        reader.GetString(0).Should().Be(AppRoleUser);
        reader.GetBoolean(1).Should().BeFalse("an RLS proof run as a superuser or BYPASSRLS role proves nothing (E3)");
        output.WriteLine($"[PROVISIONING] role={reader.GetString(0)} superuser_or_bypassrls={reader.GetBoolean(1)}");
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
