// spec: plr-d10-redesign-real-integration-2026-10-25 (I13) — founder decision 2026-09-02
using System;
using System.Collections.Generic;
using System.Linq;
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
using ShramSafal.Infrastructure.Persistence;
using ShramSafal.Sync.IntegrationTests.Dfes;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Logs;

/// <summary>
/// <b>PLR-D10 I13 — an auto-saved voice log is not Verified by itself</b>, on the real
/// <c>/sync/push</c> → Postgres → <c>/sync/pull</c> path.
///
/// <para><b>The decision (founder, 2026-09-02).</b> A voice log is saved the moment the parse
/// succeeds, with no Save tap. "ShramSafal captured his statement" must never be confused with
/// "the farmer reviewed it". Until now the server walked every owner's own log to
/// <c>Verified</c> at creation, so an auto-saved log would have read as vouched-for — and
/// <c>Verified</c> is what releases a worker's pay.</para>
///
/// <para><b>What this suite pins, as the non-superuser <c>agrisync_app</c> role:</b></para>
/// <list type="bullet">
///   <item><c>create_daily_log</c> with <c>autoSavedFromVoice: true</c> stores ONE Draft
///   verification event, reason <c>auto-saved-from-voice</c>, and comes back on pull as Draft
///   with NO events — the marker never reaches a phone, which would read any event as a
///   confirmation (I13-V1-B1);</item>
///   <item>an owner's <c>add_log_task</c> on it and the one-time owner-attestation backfill
///   both leave it Draft;</item>
///   <item>the owner's own <c>verify_log</c> (and the phone's approve path,
///   <c>verify_log_v2</c>) takes it to Verified, credited to him;</item>
///   <item>a task he adds AFTER that confirm re-opens the day and is not re-attested by the
///   server, with the capture fact read back from Postgres (I13-BT-2);</item>
///   <item>without the flag, or with <c>false</c>, today's self-verification is unchanged (P11);</item>
///   <item>a non-boolean flag is refused before anything is written.</item>
/// </list>
///
/// <para>Each fact builds its OWN scratch database (full migration chain) on the cluster named by
/// <c>REQUIRES_POSTGRES_ROOT_CONN</c> and drops it on dispose. Fail-loud: no reachable Postgres
/// is a FAILURE, never a skip.</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class AutoSavedVoiceLogRealPostgresTests(Xunit.Abstractions.ITestOutputHelper output)
    : IAsyncLifetime
{
    private const string AppRoleUser = TestRoleCredentials.AppRoleUser;
    private static string AppRolePassword => TestRoleCredentials.AppRolePassword;

    private const string AutoSavedReason = "auto-saved-from-voice";
    private const string SelfAttestedReason = "self-attested-at-creation";

    private static readonly Guid FarmId = Guid.Parse("13b00000-0000-0000-0000-000000000001");
    private static readonly Guid OwnerUserId = Guid.Parse("13b00000-0000-0000-0000-000000000002");
    private static readonly Guid OwnerAccountId = Guid.Parse("13b00000-0000-0000-0000-000000000003");
    private static readonly Guid PlotId = Guid.Parse("13b00000-0000-0000-0000-000000000004");
    private static readonly Guid CropCycleId = Guid.Parse("13b00000-0000-0000-0000-000000000005");

    private string _adminConn = string.Empty;
    private string _superuserConn = string.Empty;
    private string _appConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private ServiceProvider? _rootProvider;

    public async Task InitializeAsync()
    {
        _adminConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();

        _scratchDbName = $"ssf_autosave_{Guid.NewGuid():N}";
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
            // The migration chain grants only the ssf schema; the pull also reads public.
            await ExecAsync(raw, $"""
                GRANT USAGE ON SCHEMA public, analytics TO {AppRoleUser};
                GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public, analytics TO {AppRoleUser};
                GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public, analytics TO {AppRoleUser};
                """);
            await ExecAsync(raw, """
                INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status)
                VALUES (@farm, 'Auto-save Farm', @owner, @account, NOW(), NOW(), 3.0, 'Unchecked');
                INSERT INTO ssf.farm_memberships ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status)
                VALUES (@membership, @farm, @owner, 'PrimaryOwner', NOW(), NOW(), @account, 3);
                INSERT INTO ssf.plots ("Id", farm_id, name, area_in_acres, created_at_utc, modified_at_utc)
                VALUES (@plot, @farm, 'Plot A', 1.0, NOW(), NOW());
                INSERT INTO ssf.crop_cycles ("Id", farm_id, plot_id, crop_name, stage, start_date, created_at_utc, modified_at_utc)
                VALUES (@cycle, @farm, @plot, 'Grapes', 'Vegetative', DATE '2026-01-01', NOW(), NOW());
                """,
                ("farm", FarmId), ("owner", OwnerUserId), ("account", OwnerAccountId),
                ("membership", Guid.NewGuid()), ("plot", PlotId), ("cycle", CropCycleId));
        }

        var services = new ServiceCollection();
        services.AddLogging();
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:ShramSafalDb"] = _appConn,
                ["ConnectionStrings:UserDb"] = _appConn,
                // The privileged connection the owner-attestation backfill opens its
                // cross-tenant context on, exactly as the startup hosted service does.
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
        catch
        {
            // Best-effort teardown; a leaked scratch DB is harmless.
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 1. THE FIX — captured is not reviewed; only his own act reaches Verified.
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task An_auto_saved_log_stays_Draft_through_add_task_and_backfill_until_the_owner_verifies_it()
    {
        await AssertRunsAsNonSuperuserOnOwnScratchDatabaseAsync();

        var logId = Guid.NewGuid();
        await PushAppliedAsync("create_daily_log", "req-autosave-create", CreatePayload(logId, autoSavedFromVoice: true));

        // (a) Stored: ONE Draft event with the marker, credited to the farmer.
        var stored = await ReadEventsAsync(logId);
        output.WriteLine($"[EVIDENCE] after create: {Describe(stored)}");
        stored.Should().ContainSingle();
        stored[0].Status.Should().Be("Draft");
        stored[0].Reason.Should().Be(AutoSavedReason);
        stored[0].By.Should().Be(OwnerUserId);

        var markerAudit = Convert.ToInt64(await ScalarOnSuperuserAsync(
            "SELECT COUNT(*) FROM ssf.audit_events WHERE entity_id = @id AND action = 'VerificationChanged' AND payload LIKE '%auto-saved-from-voice%'",
            ("id", logId)));
        markerAudit.Should().Be(1, "the marker is a verification event nobody pressed a button for; it leaves an audit row");

        // (b) On the wire: the phone is told Draft, never Verified — and is sent NO event.
        // I13-V1-B1: every phone build (installed APKs included) rebuilds "confirmed by X at
        // T" from the latest event of ANY status (logsReconciler.toDailyLog) and the day ring
        // credits that stamp (dayState.hasConfirmationOnRecord). The marker therefore stays on
        // the server: the log reads exactly like an unreviewed foreman's log does today.
        var pulled = await PullDailyLogAsync(logId);
        pulled.LastVerificationStatus.Should().Be("Draft");
        pulled.VerificationEvents.Should().BeEmpty(
            "a marker nobody pressed a button for must not reach a phone that reads any event as a confirmation");
        ClientRingContractMirror.TheRingCountsIt(
            ClientRingContractMirror.MapVerificationStatus(pulled.LastVerificationStatus)).Should().BeFalse();

        // (c) His own add_log_task does not re-attest a log that was only captured.
        await PushAppliedAsync("add_log_task", "req-autosave-task", new Dictionary<string, object?>
        {
            ["dailyLogId"] = logId,
            ["activityType"] = "irrigation",
        });
        (await ReadEventsAsync(logId)).Should().ContainSingle("adding a task to a Draft log moves nothing");
        (await PullDailyLogAsync(logId)).LastVerificationStatus.Should().Be("Draft");

        // (d) The one-time owner-attestation backfill does not reach it either. A pre-fix
        // owner log (events stripped) is the control that proves the pass had a live view.
        var preFixLogId = Guid.NewGuid();
        await PushAppliedAsync("create_daily_log", "req-prefix-control", CreatePayload(preFixLogId, autoSavedFromVoice: null));
        await ExecOnSuperuserAsync("DELETE FROM ssf.verification_events WHERE daily_log_id = @id", ("id", preFixLogId));

        await using (var scope = _rootProvider!.CreateAsyncScope())
        {
            var pass = await scope.ServiceProvider.GetRequiredService<OwnerAttestationBackfillRunner>()
                .RunPassAsync(batchSize: 500, CancellationToken.None);
            output.WriteLine($"[EVIDENCE] backfill: scanned={pass.Scanned} attested={pass.Attested} leftForReview={pass.LeftForReview}");
            pass.Attested.Should().Be(1, "the control log IS repaired, so the pass really looked");
        }

        (await PullDailyLogAsync(preFixLogId)).LastVerificationStatus.Should().Be("Verified");
        (await ReadEventsAsync(logId)).Should().ContainSingle("the backfill only ever sees logs with no history");

        // (e) The farmer's own confirm — the existing verify path — takes it to Verified.
        await PushAppliedAsync("verify_log", "req-autosave-pakka", new Dictionary<string, object?>
        {
            ["dailyLogId"] = logId,
            ["status"] = "Verified",
        });

        var after = await ReadEventsAsync(logId);
        output.WriteLine($"[EVIDENCE] after verify_log: {Describe(after)}");
        after.Select(e => e.Status).Should().Equal("Draft", "Confirmed", "Verified");
        after.Select(e => e.Reason).Should().Equal(AutoSavedReason, "confirmed-en-route", null);
        after.Should().OnlyContain(e => e.By == OwnerUserId);
        after.Should().NotContain(e => e.Reason == SelfAttestedReason);

        var verified = await PullDailyLogAsync(logId);
        verified.LastVerificationStatus.Should().Be("Verified");
        verified.VerificationEvents.Select(e => e.Status).Should().Equal(
            ["confirmed", "verified"], "the phone is sent his act, and still never the capture marker");
        verified.VerificationEvents.Should().OnlyContain(e => e.VerifiedByUserId == OwnerUserId);
        ClientRingContractMirror.TheRingCountsIt(
            ClientRingContractMirror.MapVerificationStatus(verified.LastVerificationStatus)).Should().BeTrue();

        // (f) I13-BT-2 — the order that reaches the add-task guard: auto-saved, CONFIRMED by
        // him, then a new task. AddLogTaskHandler re-opens a non-Draft log and then asks
        // TrySelfVerifyAsCreator to re-attest — which must refuse, reading the capture fact
        // from the events RELOADED out of Postgres in this fresh request scope.
        await PushAppliedAsync("add_log_task", "req-autosave-task-after-pakka", new Dictionary<string, object?>
        {
            ["dailyLogId"] = logId,
            ["activityType"] = "spraying",
        });

        var reopened = await ReadEventsAsync(logId);
        output.WriteLine($"[EVIDENCE] after confirm + add_log_task: {Describe(reopened)}");
        reopened.Select(e => e.Status).Should().Equal("Draft", "Confirmed", "Verified", "Draft");
        reopened[^1].Reason.Should().BeNull("a re-open is not an attestation");
        reopened[^1].By.Should().Be(OwnerUserId);
        reopened.Should().NotContain(e => e.Reason == SelfAttestedReason,
            "the server never re-vouches on his behalf for a day it only captured");

        var taskTrace = await ReadLastTaskAddedTraceAsync(logId);
        taskTrace.GetProperty("reAttestedByCreator").GetBoolean().Should().BeFalse();
        taskTrace.GetProperty("autoSavedFromVoice").GetBoolean().Should().BeTrue();

        var afterTask = await PullDailyLogAsync(logId);
        afterTask.LastVerificationStatus.Should().Be("Draft", "the new task waits for his confirm again");
        afterTask.VerificationEvents.Select(e => e.Status).Should().Equal("confirmed", "verified", "draft");
        ClientRingContractMirror.TheRingCountsIt(
            ClientRingContractMirror.MapVerificationStatus(afterTask.LastVerificationStatus)).Should().BeFalse();
    }

    [Fact]
    public async Task The_phone_approve_path_verify_log_v2_also_takes_an_auto_saved_log_to_Verified()
    {
        var logId = Guid.NewGuid();
        await PushAppliedAsync("create_daily_log", "req-autosave-v2", CreatePayload(logId, autoSavedFromVoice: true));
        (await PullDailyLogAsync(logId)).LastVerificationStatus.Should().Be("Draft");

        await PushAppliedAsync("verify_log_v2", "req-autosave-v2-verify", new Dictionary<string, object?>
        {
            ["logId"] = logId,
            ["verifierUserId"] = OwnerUserId,
            ["decision"] = "verify",
            ["decidedAt"] = DateTime.UtcNow.ToString("O"),
        });

        var pulled = await PullDailyLogAsync(logId);
        output.WriteLine($"[EVIDENCE] verify_log_v2 -> {pulled.LastVerificationStatus}");
        pulled.LastVerificationStatus.Should().Be("Verified");
        pulled.VerificationEvents.OrderBy(e => e.OccurredAtUtc).Last().VerifiedByUserId.Should().Be(OwnerUserId);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // 2. THE CONTROLS — old apps unchanged (P11); a malformed flag refused.
    // ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Without_the_flag_or_with_false_an_owners_create_is_self_verified_exactly_as_today()
    {
        foreach (var (label, flag) in new[] { ("absent", (bool?)null), ("false", false) })
        {
            var logId = Guid.NewGuid();
            await PushAppliedAsync("create_daily_log", $"req-old-app-{label}", CreatePayload(logId, flag));

            var stored = await ReadEventsAsync(logId);
            output.WriteLine($"[EVIDENCE] flag {label}: {Describe(stored)}");
            stored.Select(e => e.Status).Should().Equal("Confirmed", "Verified");
            stored.Should().OnlyContain(e => e.Reason == SelfAttestedReason && e.By == OwnerUserId);
            var pulled = await PullDailyLogAsync(logId);
            pulled.LastVerificationStatus.Should().Be("Verified");
            pulled.VerificationEvents.Should().HaveCount(2, "the wire filter removes nothing from an ordinary log");

            // The control for step (f) above: the same add_log_task on an ordinary owner log
            // IS re-attested (wave-1.3), so the refusal there is the marker, not the path.
            await PushAppliedAsync("add_log_task", $"req-old-app-task-{label}", new Dictionary<string, object?>
            {
                ["dailyLogId"] = logId,
                ["activityType"] = "spraying",
            });
            var afterTask = await ReadEventsAsync(logId);
            output.WriteLine($"[EVIDENCE] flag {label} + add_log_task: {Describe(afterTask)}");
            afterTask.Select(e => e.Status).Should().Equal("Confirmed", "Verified", "Draft", "Confirmed", "Verified");
            afterTask[^1].Reason.Should().Be(SelfAttestedReason);
            (await ReadLastTaskAddedTraceAsync(logId)).GetProperty("autoSavedFromVoice").GetBoolean().Should().BeFalse();
            (await PullDailyLogAsync(logId)).LastVerificationStatus.Should().Be("Verified");
        }
    }

    [Fact]
    public async Task A_non_boolean_autoSavedFromVoice_is_refused_before_anything_is_written()
    {
        foreach (var (label, bad) in new[] { ("string", (object)"true"), ("number", 1) })
        {
            var logId = Guid.NewGuid();
            var payload = CreatePayload(logId, autoSavedFromVoice: null);
            payload["autoSavedFromVoice"] = bad;

            var push = await PushAsync("create_daily_log", $"req-bad-flag-{label}", payload);
            push.IsSuccess.Should().BeTrue();
            var result = Assert.Single(push.Value!.Results);
            output.WriteLine($"[EVIDENCE] autoSavedFromVoice={label} -> {result.Status} {result.ErrorCode}");
            result.Status.Should().Be("failed");
            result.ErrorCode.Should().Be("ShramSafal.SyncInvalidPayload");

            var written = Convert.ToInt64(await ScalarOnSuperuserAsync(
                "SELECT COUNT(*) FROM ssf.daily_logs WHERE \"Id\" = @id", ("id", logId)));
            written.Should().Be(0);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Harness.
    // ─────────────────────────────────────────────────────────────────────────

    private sealed record StoredEvent(string Status, string? Reason, Guid By, DateTime At);

    private static string Describe(IEnumerable<StoredEvent> events) =>
        string.Join(" -> ", events.Select(e => $"{e.Status}({e.Reason ?? "-"})"));

    private static Dictionary<string, object?> CreatePayload(Guid dailyLogId, bool? autoSavedFromVoice)
    {
        var payload = new Dictionary<string, object?>
        {
            ["dailyLogId"] = dailyLogId,
            ["farmId"] = FarmId,
            ["plotId"] = PlotId,
            ["cropCycleId"] = CropCycleId,
            ["operatorUserId"] = OwnerUserId,
            ["logDate"] = "2026-10-26",
        };
        if (autoSavedFromVoice is { } flag)
        {
            payload["autoSavedFromVoice"] = flag;
        }

        return payload;
    }

    private async Task<List<StoredEvent>> ReadEventsAsync(Guid logId)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT status, reason, verified_by_user_id, occurred_at_utc
            FROM ssf.verification_events WHERE daily_log_id = @id ORDER BY occurred_at_utc
            """;
        cmd.Parameters.AddWithValue("id", logId);
        await using var reader = await cmd.ExecuteReaderAsync();
        var rows = new List<StoredEvent>();
        while (await reader.ReadAsync())
        {
            rows.Add(new StoredEvent(
                reader.GetString(0),
                reader.IsDBNull(1) ? null : reader.GetString(1),
                reader.GetGuid(2),
                reader.GetDateTime(3)));
        }

        return rows;
    }

    /// <summary>
    /// The payload of the newest <c>VerificationChanged</c> audit row an <c>add_log_task</c>
    /// wrote for this log (trigger <c>TaskAdded</c>), parsed — never string-matched.
    /// </summary>
    private async Task<JsonElement> ReadLastTaskAddedTraceAsync(Guid logId)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT payload FROM ssf.audit_events
            WHERE entity_id = @id AND action = 'VerificationChanged'
            ORDER BY occurred_at_utc
            """;
        cmd.Parameters.AddWithValue("id", logId);
        await using var reader = await cmd.ExecuteReaderAsync();
        JsonElement? last = null;
        while (await reader.ReadAsync())
        {
            var payload = JsonDocument.Parse(reader.GetString(0)).RootElement;
            if (payload.TryGetProperty("trigger", out var trigger) && trigger.GetString() == "TaskAdded")
            {
                last = payload.Clone();
            }
        }

        last.Should().NotBeNull("an add_log_task that moved the status leaves a VerificationChanged row");
        return last!.Value;
    }

    private async Task PushAppliedAsync(string mutationType, string clientRequestId, Dictionary<string, object?> payload)
    {
        var push = await PushAsync(mutationType, clientRequestId, payload);
        push.IsSuccess.Should().BeTrue("the push must succeed: {0}", push.Error?.ToString() ?? "-");
        var result = Assert.Single(push.Value!.Results);
        result.Status.Should().Be("applied", "{0} error='{1}: {2}'", mutationType, result.ErrorCode, result.ErrorMessage);
    }

    private async Task<AgriSync.BuildingBlocks.Results.Result<SyncPushResponseDto>> PushAsync(
        string mutationType, string clientRequestId, Dictionary<string, object?> payload)
    {
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        sp.GetRequiredService<TenantContext>().ElevateToAdminCrossTenant();

        var command = new PushSyncBatchCommand(
            DeviceId: "device-autosave",
            AuthenticatedUserId: OwnerUserId,
            ActorRole: "PrimaryOwner",
            Mutations: new[]
            {
                new PushSyncMutationCommand(clientRequestId, mutationType, JsonSerializer.SerializeToElement(payload)),
            },
            AppVersion: "1.0.18");

        return await sp.GetRequiredService<PushSyncBatchHandler>().HandleAsync(command);
    }

    private async Task<DailyLogDto> PullDailyLogAsync(Guid dailyLogId)
    {
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;

        // ADR 0019 — GET /sync/pull runs user-scoped, exactly as the endpoint does.
        sp.GetRequiredService<TenantContext>().SetUserScoped(OwnerUserId);

        var result = await sp.GetRequiredService<PullSyncChangesHandler>()
            .HandleAsync(new PullSyncChangesQuery(DateTime.UnixEpoch, OwnerUserId));

        result.IsSuccess.Should().BeTrue("the pull must succeed: {0}", result.Error?.ToString() ?? "-");
        return result.Value!.DailyLogs.Should().ContainSingle(l => l.Id == dailyLogId,
            "the log must come back down on the next pull").Subject;
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
        canBypass.Should().BeFalse();
        database.Should().Be(_scratchDbName);
        output.WriteLine($"[PROVISIONING] role={role} superuser_or_bypassrls={canBypass} database={database}");
    }

    private async Task ExecOnSuperuserAsync(string sql, params (string Name, object Value)[] args)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await ExecAsync(db, sql, args);
    }

    private async Task<object?> ScalarOnSuperuserAsync(string sql, params (string Name, object Value)[] args)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in args)
        {
            cmd.Parameters.AddWithValue(name, value);
        }

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
            UserId userId, FarmId farmId, PaidFeature feature, CancellationToken ct = default)
            => Task.FromResult(new EntitlementDecision(true, EntitlementReason.Allowed, null));
    }

    private sealed class NoopAnalyticsWriter : IAnalyticsWriter
    {
        public Task EmitAsync(AnalyticsEvent e, CancellationToken ct = default) => Task.CompletedTask;
        public Task EmitManyAsync(IEnumerable<AnalyticsEvent> events, CancellationToken ct = default) => Task.CompletedTask;
    }
}
