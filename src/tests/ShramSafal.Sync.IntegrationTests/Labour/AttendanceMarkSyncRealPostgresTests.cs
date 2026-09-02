// spec: 2026-08-28-labour-v2-release-1 (Labour V2 R1 Task 3.5d)
using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading;
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
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Labour;

/// <summary>
/// Labour V2 R1 Task 3.5d — <b>the P10 acceptance, server half, against REAL
/// Postgres.</b> "Acknowledged = reconstructable without the originating
/// device." A 200 from /sync/push is NOT evidence; the proof is the row in
/// <c>ssf.attendance_marks</c> under FORCE-RLS as the non-superuser
/// <c>agrisync_app</c> role, and the same fact coming back down
/// <c>/sync/pull</c> on a fresh context carrying ONLY the user GUC.
///
/// <para><b>Why real Postgres and not the InMemory harness.</b>
/// <c>EstablishFarmScopeForDerivationAsync</c> short-circuits on a
/// non-relational provider, so only this suite proves C5 closed: /sync/ is on
/// TenantTransactionMiddleware's skip list, no GUC is set until the handler
/// sets one, and <c>p_tenant_attendance_marks</c>' WITH CHECK would refuse the
/// INSERT with a NULL comparison. Scaffold mirrors
/// <c>SyncPushTenantScopeRealPostgresTests</c> exactly (own scratch DB, full
/// migration chain, production DI graph as <c>agrisync_app</c>).</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class AttendanceMarkSyncRealPostgresTests(Xunit.Abstractions.ITestOutputHelper output) : IAsyncLifetime
{
    private const string AppRoleUser = "agrisync_app";
    private static string AppRolePassword => TestRoleCredentials.AppRolePassword;

    // Farm A — the genuine-member farm; Ganesh is its FieldOperator.
    private static readonly Guid FarmA = Guid.Parse("aaaa1111-1111-1111-1111-111111111111");
    private static readonly Guid OwnerAccountA = Guid.Parse("aaaa1112-1111-1111-1111-111111111111");
    private static readonly Guid OwnerA = Guid.Parse("aaaa1113-1111-1111-1111-111111111111");
    private static readonly Guid Ganesh = Guid.Parse("aaaa1115-1111-1111-1111-111111111111");

    // Farm B — OwnerB is a genuine owner of a DIFFERENT farm: the attacker in
    // the fail-closed proof (proves the isolation gate, not just
    // presence-of-any-membership).
    private static readonly Guid FarmB = Guid.Parse("bbbb2221-2222-2222-2222-222222222222");
    private static readonly Guid OwnerAccountB = Guid.Parse("bbbb2222-2222-2222-2222-222222222222");
    private static readonly Guid OwnerB = Guid.Parse("bbbb2223-2222-2222-2222-222222222222");

    private const string WorkDate = "2026-09-02";

    private string _superuserConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private string _appConn = string.Empty;
    private string _adminConn = string.Empty;
    private ServiceProvider? _rootProvider;

    public async Task InitializeAsync()
    {
        var baseConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();

        _scratchDbName = $"ssf_attendance_mark_proof_{Guid.NewGuid():N}";
        await using (var admin = new NpgsqlConnection(baseConn))
        {
            await admin.OpenAsync();
            await using var create = admin.CreateCommand();
            create.CommandText = $"CREATE DATABASE \"{_scratchDbName}\"";
            await create.ExecuteNonQueryAsync();
        }

        _superuserConn = new NpgsqlConnectionStringBuilder(baseConn) { Database = _scratchDbName }.ConnectionString;
        _appConn = new NpgsqlConnectionStringBuilder(_superuserConn)
        {
            Username = AppRoleUser,
            Password = AppRolePassword,
        }.ConnectionString;
        _adminConn = baseConn;

        await IntegrationMigrationChain.ApplyAsync(_superuserConn);

        // Seed as superuser (bypasses RLS): Farm A with its owner and the
        // FieldOperator the marks are about; Farm B with only its owner.
        await using (var raw = new NpgsqlConnection(_superuserConn))
        {
            await raw.OpenAsync();

            // The pull path also reads public.users (operator names) — see the
            // identical note on DayOutcomeSurvivesSyncRoundTripRealPostgresTests:
            // a scratch DB built purely from the migration chain 42501s there.
            await GrantNonSsfSchemasToAppRoleAsync(raw);

            await SeedFarmAsync(raw, FarmA, OwnerA, OwnerAccountA, "Attendance Proof Farm A");
            await SeedFarmMembershipAsync(raw, Guid.NewGuid(), FarmA, OwnerA, OwnerAccountA, "PrimaryOwner", status: 3);
            await SeedFieldOperatorAsync(raw, Ganesh, FarmA, OwnerA, "गणेश");

            await SeedFarmAsync(raw, FarmB, OwnerB, OwnerAccountB, "Attendance Proof Farm B");
            await SeedFarmMembershipAsync(raw, Guid.NewGuid(), FarmB, OwnerB, OwnerAccountB, "PrimaryOwner", status: 3);
        }

        var services = new ServiceCollection();
        services.AddLogging();
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:ShramSafalDb"] = _appConn,
                ["ConnectionStrings:UserDb"] = _appConn,
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

        if (!string.IsNullOrEmpty(_scratchDbName) && !string.IsNullOrEmpty(_adminConn))
        {
            try
            {
                await using var admin = new NpgsqlConnection(_adminConn);
                await admin.OpenAsync();
                await using var terminate = admin.CreateCommand();
                terminate.CommandText =
                    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = @db AND pid <> pg_backend_pid()";
                terminate.Parameters.AddWithValue("db", _scratchDbName);
                await terminate.ExecuteNonQueryAsync();
                await using var drop = admin.CreateCommand();
                drop.CommandText = $"DROP DATABASE IF EXISTS \"{_scratchDbName}\"";
                await drop.ExecuteNonQueryAsync();
            }
            catch
            {
                // Best-effort teardown; a leaked scratch DB is harmless.
            }
        }
    }

    /// <summary>
    /// Steps 1–4 of the 3.5d.1 journey, in dependency order on one scratch DB
    /// (the POSITIVE PROOF 1 idiom): push → row under RLS; identical
    /// clientRequestId → duplicate, still one row; changed ruling (new
    /// value-key) → amend + append-only correction in the same commit; pull on
    /// a fresh user-scoped context → the same fact, reconstructable without
    /// the originating device.
    /// </summary>
    [Fact]
    public async Task AttendanceMark_journey_push_dedupe_amend_and_userscoped_pull()
    {
        AssertNonSuperuserAppRole();

        var markId = Guid.NewGuid();
        var fullKey = $"attendance.mark:{FarmA}:{Ganesh}:{WorkDate}:Full:-:-:-";
        var halfKey = $"attendance.mark:{FarmA}:{Ganesh}:{WorkDate}:Half:-:-:-";

        // ── 1. A member's mark lands as a ROW, not just a 200 (C5 closed). ──
        var first = await RunSyncPushAsync(OwnerA, "owner", "d-A", fullKey, new()
        {
            ["attendanceMarkId"] = markId,
            ["farmId"] = FarmA,
            ["fieldOperatorId"] = Ganesh,
            ["workDate"] = WorkDate,
            ["dayMark"] = "Full",
        });
        output.WriteLine($"[EVIDENCE] push 1: status='{first.Status}' errorCode='{first.ErrorCode}' errorMessage='{first.ErrorMessage}'");
        first.Status.Should().Be("applied",
            "a genuine member's mark must survive FORCE-RLS via EstablishFarmScopeForDerivationAsync (C5)");

        (await CountMarksAsync()).Should().Be(1, "the acknowledgement must be a row, not a status code");
        (await ReadDayMarkAsync(markId)).Should().Be(1, "DayMark.Full is stored as its enum value 1");

        // ── 2. The SAME fact re-pushed (retry) is a duplicate — still one row. ──
        var retry = await RunSyncPushAsync(OwnerA, "owner", "d-A", fullKey, new()
        {
            ["attendanceMarkId"] = markId,
            ["farmId"] = FarmA,
            ["fieldOperatorId"] = Ganesh,
            ["workDate"] = WorkDate,
            ["dayMark"] = "Full",
        });
        output.WriteLine($"[EVIDENCE] push 2 (same clientRequestId): status='{retry.Status}'");
        retry.Status.Should().Be("duplicate", "the value-keyed clientRequestId makes a retry idempotent");
        (await CountMarksAsync()).Should().Be(1);

        // ── 3. A CHANGED ruling (new value-key, new client-minted id) AMENDS
        //       the existing row and the append-only correction rides the
        //       same commit — never a blind insert, so no 23505. ──
        var amend = await RunSyncPushAsync(OwnerA, "owner", "d-A", halfKey, new()
        {
            ["attendanceMarkId"] = Guid.NewGuid(),
            ["farmId"] = FarmA,
            ["fieldOperatorId"] = Ganesh,
            ["workDate"] = WorkDate,
            ["dayMark"] = "Half",
        });
        output.WriteLine($"[EVIDENCE] push 3 (changed ruling): status='{amend.Status}' errorCode='{amend.ErrorCode}'");
        amend.Status.Should().Be("applied");
        (await CountMarksAsync()).Should().Be(1, "a changed ruling amends THROUGH the entity, never inserts a second row");
        (await ReadDayMarkAsync(markId)).Should().Be(2, "DayMark.Half is stored as its enum value 2");

        var (correctionCount, changedField, originalValue, newValue) = await ReadCorrectionAsync(markId);
        output.WriteLine($"[EVIDENCE] correction rows={correctionCount} field='{changedField}' '{originalValue}'→'{newValue}'");
        correctionCount.Should().Be(1, "the amendment must commit WITH its append-only correction row");
        changedField.Should().Be("day_mark");
        originalValue.Should().Be("Full");
        newValue.Should().Be("Half");

        // ── 4. P10: a FRESH context with only the user GUC pulls the fact —
        //       reconstructable without the originating device. ──
        var pulled = await PullAttendanceMarksAsync(OwnerA);
        var mark = pulled.Should().ContainSingle(m => m.Id == markId,
            "the acknowledged mark must come back down /sync/pull").Subject;
        output.WriteLine($"[EVIDENCE] pulled: day='{mark.DayMark}' night='{mark.NightMark ?? "NULL"}' date='{mark.WorkDate}'");
        mark.DayMark.Should().Be("Half", "the pull carries the AMENDED truth");
        mark.NightMark.Should().BeNull("Unmarked survives the wire as null — a silence, never a zero");
        mark.WorkDate.Should().Be(WorkDate);
        mark.FieldOperatorId.Should().Be(Ganesh);
        mark.FarmId.Should().Be(FarmA);
    }

    /// <summary>
    /// Step 5 — a genuine owner of a DIFFERENT farm pushing a mark at Farm A
    /// is refused at BOTH layers (the handler's membership gate and, beneath
    /// it, FORCE-RLS — not just the InMemory-no-op gate,
    /// CallerFarmTenantScope.cs:59-62), and nothing lands.
    /// </summary>
    [Fact]
    public async Task AttendanceMark_push_from_a_non_member_fails_closed_with_zero_rows()
    {
        AssertNonSuperuserAppRole();

        var result = await RunSyncPushAsync(OwnerB, "owner", "d-B",
            $"attendance.mark:{FarmA}:{Ganesh}:{WorkDate}:Full:-:-:-", new()
            {
                ["attendanceMarkId"] = Guid.NewGuid(),
                ["farmId"] = FarmA,
                ["fieldOperatorId"] = Ganesh,
                ["workDate"] = WorkDate,
                ["dayMark"] = "Full",
            });

        output.WriteLine($"[EVIDENCE] non-member push: status='{result.Status}' errorCode='{result.ErrorCode}'");
        result.Status.Should().Be("failed");
        result.ErrorCode.Should().Be("ShramSafal.Forbidden");
        (await CountMarksAsync()).Should().Be(0, "a refused mark must stage NOTHING");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Harness — /sync/push admin-elevated, /sync/pull user-scoped (ADR 0019),
    // mirroring SyncPushTenantScopeRealPostgresTests /
    // DayOutcomeSurvivesSyncRoundTripRealPostgresTests exactly.
    // ─────────────────────────────────────────────────────────────────────────

    private async Task<SyncMutationResultDto> RunSyncPushAsync(
        Guid actorUserId,
        string actorRole,
        string deviceId,
        string clientRequestId,
        Dictionary<string, object?> payload)
    {
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;

        sp.GetRequiredService<TenantContext>().ElevateToAdminCrossTenant();

        var handler = sp.GetRequiredService<PushSyncBatchHandler>();
        var command = new PushSyncBatchCommand(
            DeviceId: deviceId,
            AuthenticatedUserId: actorUserId,
            ActorRole: actorRole,
            Mutations: new[]
            {
                new PushSyncMutationCommand(clientRequestId, "attendance.mark", JsonSerializer.SerializeToElement(payload)),
            },
            AppVersion: "1.2.3");

        var response = await handler.HandleAsync(command);
        response.IsSuccess.Should().BeTrue("the /sync/push batch call itself must succeed");
        return Assert.Single(response.Value!.Results);
    }

    private async Task<IReadOnlyList<AttendanceMarkDto>> PullAttendanceMarksAsync(Guid userId)
    {
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;

        // ADR 0019 — GET /sync/pull runs user-scoped, exactly as the endpoint
        // does: ONLY agrisync.user_id, never a farm GUC. This is what makes
        // the pull a proof of reconstructability rather than of the push
        // transaction's own leftovers.
        sp.GetRequiredService<TenantContext>().SetUserScoped(userId);

        var result = await sp.GetRequiredService<PullSyncChangesHandler>()
            .HandleAsync(new PullSyncChangesQuery(DateTime.UnixEpoch, userId));

        result.IsSuccess.Should().BeTrue("the pull must succeed: {0}", result.Error?.ToString() ?? "-");
        return result.Value!.AttendanceMarks;
    }

    // ── Ground-truth reads, as superuser (RLS-bypassing on purpose:
    //    these assert what is STORED, not what a policy shows). ──

    private async Task<long> CountMarksAsync()
    {
        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();
        return Convert.ToInt64(await ScalarAsync(read, "SELECT COUNT(*) FROM ssf.attendance_marks"));
    }

    private async Task<int> ReadDayMarkAsync(Guid markId)
    {
        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();
        return Convert.ToInt32(await ScalarAsync(read,
            "SELECT day_mark FROM ssf.attendance_marks WHERE \"Id\" = @id", ("id", markId)));
    }

    private async Task<(long Count, string? ChangedField, string? OriginalValue, string? NewValue)> ReadCorrectionAsync(Guid markId)
    {
        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();
        var count = Convert.ToInt64(await ScalarAsync(read,
            "SELECT COUNT(*) FROM ssf.attendance_mark_corrections WHERE attendance_mark_id = @id", ("id", markId)));
        if (count == 0)
        {
            return (0, null, null, null);
        }

        await using var cmd = read.CreateCommand();
        cmd.CommandText = """
            SELECT changed_field, original_value, new_value
            FROM ssf.attendance_mark_corrections
            WHERE attendance_mark_id = @id
            ORDER BY corrected_at_utc DESC
            LIMIT 1
            """;
        cmd.Parameters.AddWithValue("id", markId);
        await using var reader = await cmd.ExecuteReaderAsync();
        await reader.ReadAsync();
        return (count, reader.GetString(0), reader.IsDBNull(1) ? null : reader.GetString(1),
            reader.IsDBNull(2) ? null : reader.GetString(2));
    }

    private void AssertNonSuperuserAppRole()
    {
        using var appCheck = new NpgsqlConnection(_appConn);
        appCheck.Open();
        using var cmd = appCheck.CreateCommand();
        cmd.CommandText = "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user";
        var isSuper = Convert.ToBoolean(cmd.ExecuteScalar());
        isSuper.Should().BeFalse(
            "the app connection must be a NON-superuser, no-BYPASSRLS role so FORCE-RLS is real");
    }

    private static async Task<object?> ScalarAsync(
        NpgsqlConnection db, string sql, params (string Name, object Value)[] args)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in args)
        {
            cmd.Parameters.AddWithValue(name, value);
        }
        return await cmd.ExecuteScalarAsync();
    }

    private static async Task GrantNonSsfSchemasToAppRoleAsync(NpgsqlConnection db)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = $"""
            GRANT USAGE ON SCHEMA public, analytics TO {AppRoleUser};
            GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public, analytics TO {AppRoleUser};
            GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public, analytics TO {AppRoleUser};
            """;
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task SeedFarmAsync(
        NpgsqlConnection db, Guid farmId, Guid ownerUserId, Guid ownerAccountId, string name)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status)
            VALUES (@id, @name, @owner, @account, NOW(), NOW(), 3.0, 'Unchecked');
            """;
        cmd.Parameters.AddWithValue("id", farmId);
        cmd.Parameters.AddWithValue("name", name);
        cmd.Parameters.AddWithValue("owner", ownerUserId);
        cmd.Parameters.AddWithValue("account", ownerAccountId);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task SeedFarmMembershipAsync(
        NpgsqlConnection db, Guid id, Guid farmId, Guid userId, Guid ownerAccountId, string role, int status)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.farm_memberships
                ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status)
            VALUES (@id, @farm, @user, @role, NOW(), NOW(), @account, @status);
            """;
        cmd.Parameters.AddWithValue("id", id);
        cmd.Parameters.AddWithValue("farm", farmId);
        cmd.Parameters.AddWithValue("user", userId);
        cmd.Parameters.AddWithValue("role", role);
        cmd.Parameters.AddWithValue("account", ownerAccountId);
        cmd.Parameters.AddWithValue("status", status);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task SeedFieldOperatorAsync(
        NpgsqlConnection db, Guid id, Guid farmId, Guid createdBy, string displayName)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.field_operators
                ("Id", display_name, display_name_normalized, full_name, originating_farm_id, created_by_user_id, created_at_utc, is_active)
            VALUES (@id, @name, @normalized, NULL, @farm, @by, NOW(), TRUE);
            """;
        cmd.Parameters.AddWithValue("id", id);
        cmd.Parameters.AddWithValue("name", displayName);
        cmd.Parameters.AddWithValue("normalized", displayName.ToLowerInvariant());
        cmd.Parameters.AddWithValue("farm", farmId);
        cmd.Parameters.AddWithValue("by", createdBy);
        await cmd.ExecuteNonQueryAsync();
    }

    private sealed class AllowAllEntitlementPolicy : IEntitlementPolicy
    {
        public Task<EntitlementDecision> EvaluateAsync(
            UserId userId, FarmId farmId, PaidFeature feature, CancellationToken ct = default)
            => Task.FromResult(new EntitlementDecision(true, EntitlementReason.Allowed, null));
    }

    private sealed class NoopAnalyticsWriter : IAnalyticsWriter
    {
        public Task EmitAsync(AnalyticsEvent e, CancellationToken ct = default) => Task.CompletedTask;
        public Task EmitManyAsync(IEnumerable<AnalyticsEvent> events, CancellationToken ct = default) => Task.CompletedTask;
    }
}
