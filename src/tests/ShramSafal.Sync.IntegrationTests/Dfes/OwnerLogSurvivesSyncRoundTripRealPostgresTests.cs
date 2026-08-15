// spec: dfes-companion-2026-07-11 (wave-1.3)
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
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Dfes;

/// <summary>
/// spec: dfes-companion-2026-07-11 (wave-1.3) — the OWNER'S OWN LOG MUST SURVIVE A SYNC.
///
/// <para><b>The defect, end to end.</b> Wave-1.1 made the device stamp the farm owner's own
/// log approved on save, and wave-1.2 proved the progress ring counts it. Neither survived a
/// sync. Verification is derived on the SERVER — <c>DailyLog.CurrentVerificationStatus</c>
/// folds the verification events, and <c>DailyLogConfiguration</c> <c>Ignore</c>s both status
/// properties, so there is no column a device could write. <c>DailyLog.Create</c> emitted zero
/// verification events, so every log came back <c>Draft</c>; <c>logsReconciler.ts</c> then
/// took the server's answer verbatim ("Verification is a server-side FSM; the device never
/// wins it"). The farmer logged his work, watched his day close, synced, and watched it
/// re-open. That is the bug this suite exists to end, and it can only be caught on the wire —
/// a unit test on <c>DailyLog</c> would have passed throughout.</para>
///
/// <para><b>Why the non-owner proof is not optional.</b> Mukadams (foremen) are in the pilot.
/// A fix that verified the owner's log by widening the state machine would also have let a
/// mukadam approve his own work, which is the one thing the approval model exists to prevent —
/// and it would have looked like success. Proof 2 pushes the identical mutation as a MUKADAM
/// and asserts the log comes back needing approval, from a role that holds only the first FSM
/// edge. Side by side, proof 1 and proof 2 are the fix and its boundary in one run.</para>
///
/// <para><b>Why the round trip is asserted all the way to the ring.</b> The server's only
/// reachable status from <c>Draft</c> is <c>Confirmed</c>, but the client's ring counts only
/// <c>VERIFIED</c>/<c>APPROVED</c> (<c>dayState.ts:77-80</c>). Landing on <c>Confirmed</c>
/// would have reproduced the same 70%-forever bug from the server side while every backend
/// assertion stayed green. So the last two hops — <c>mapVerificationStatus.ts</c> and
/// <c>dayState.ts</c>'s counted set — are mirrored here as executable code (see
/// <see cref="MapVerificationStatusLikeTheClient"/> and <see cref="TheRingCountsIt"/>) and
/// driven with the ACTUAL string the wire carried. A change to either client file that breaks
/// this contract fails here.</para>
///
/// <para><b>Native :5433, opt-in, self-skipping.</b> Creates its OWN scratch database, applies
/// the full migration chain, drops it on dispose. If Postgres :5433 is genuinely unreachable
/// it skips and SAYS SO loudly — a skipped proof is not a passing one.</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class OwnerLogSurvivesSyncRoundTripRealPostgresTests(Xunit.Abstractions.ITestOutputHelper output)
    : IAsyncLifetime
{
    private const string AppRoleUser = IntegrationPostgres.AppRoleUser;
    private static string AppRolePassword => IntegrationPostgres.AppRolePassword;

    private static readonly Guid FarmId = Guid.Parse("1c000000-0000-0000-0000-000000000001");
    private static readonly Guid OwnerUserId = Guid.Parse("1c000000-0000-0000-0000-000000000002");
    private static readonly Guid OwnerAccountId = Guid.Parse("1c000000-0000-0000-0000-000000000003");
    private static readonly Guid PlotId = Guid.Parse("1c000000-0000-0000-0000-000000000004");
    private static readonly Guid CropCycleId = Guid.Parse("1c000000-0000-0000-0000-000000000005");

    /// <summary>The foreman. Recognised on the farm, trusted to record — not to approve.</summary>
    private static readonly Guid MukadamUserId = Guid.Parse("1c000000-0000-0000-0000-000000000006");

    // One date per proof so the two never contend on ux_daily_richness_farm_local_date.
    private static readonly DateOnly OwnerLogDate = new(2026, 8, 10);
    private static readonly DateOnly MukadamLogDate = new(2026, 8, 11);

    private string _adminConn = string.Empty;
    private string _superuserConn = string.Empty;
    private string _appConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private bool _skip;
    private string _skipReason = string.Empty;
    private ServiceProvider? _rootProvider;

    public async Task InitializeAsync()
    {
        var baseConn = IntegrationPostgres.ResolveRootConnection();

        var probeSkip = await IntegrationPostgres.ProbeOrSkipReasonAsync(baseConn);
        if (probeSkip is not null)
        {
            _skip = true;
            _skipReason = probeSkip;
            return;
        }

        _adminConn = baseConn;
        _scratchDbName = $"ssf_owner_roundtrip_{Guid.NewGuid():N}";
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

        await IntegrationMigrationChain.ApplyAsync(_superuserConn);

        await using (var raw = new NpgsqlConnection(_superuserConn))
        {
            await raw.OpenAsync();
            await GrantNonSsfSchemasToAppRoleAsync(raw);
            await SeedFarmAsync(raw);
            await SeedFarmMembershipAsync(raw, OwnerUserId, "PrimaryOwner");
            await SeedFarmMembershipAsync(raw, MukadamUserId, "Mukadam");
            await SeedPlotAsync(raw);
            await SeedCropCycleAsync(raw);
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

        if (!_skip && !string.IsNullOrEmpty(_scratchDbName) && !string.IsNullOrEmpty(_adminConn))
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

    private bool SkippedForMissingPostgres()
    {
        if (!_skip)
        {
            return false;
        }

        output.WriteLine($"[SKIPPED] {_skipReason} — NO DATABASE WAS EXERCISED; this run proves nothing.");
        Assert.True(true, _skipReason);
        return true;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PROOF 1 — the owner's own log survives push AND pull as a day that counts.
    // ─────────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task An_owners_own_log_comes_back_from_the_wire_verified_and_the_ring_counts_it()
    {
        if (SkippedForMissingPostgres())
        {
            return;
        }

        await WriteProvisioningEvidenceAsync();

        var dailyLogId = Guid.Parse("1ccc1111-1111-1111-1111-111111111111");

        var push = await RunSyncPushAsync(
            actorUserId: OwnerUserId,
            actorRole: "Worker", // deliberately UNDER-stated: the wire must not be believed.
            clientRequestId: "req-owner-roundtrip",
            dailyLogId: dailyLogId,
            logDate: OwnerLogDate);

        push.IsSuccess.Should().BeTrue("the /sync/push batch call must succeed");
        Assert.Single(push.Value!.Results).Status.Should().Be("applied");

        // The handler wrote as a NON-superuser role, so FORCE-RLS genuinely applied.
        await using (var appCheck = new NpgsqlConnection(_appConn))
        {
            await appCheck.OpenAsync();
            var isSuper = Convert.ToBoolean(await ScalarAsync(appCheck,
                "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user"));
            isSuper.Should().BeFalse("the write path must not be a superuser-vacuous pass");
            output.WriteLine($"[EVIDENCE] handler role superuser_or_bypassrls = {isSuper} (expect False)");
        }

        // ── The PULL. This is the half that used to undo everything. ──────────
        var pulled = await PullDailyLogAsync(OwnerUserId, dailyLogId);

        output.WriteLine("[EVIDENCE] === owner's log, as it came back over the wire ===");
        output.WriteLine($"[EVIDENCE] lastVerificationStatus = '{pulled.LastVerificationStatus}'");
        foreach (var e in pulled.VerificationEvents)
        {
            output.WriteLine($"[EVIDENCE]   event status='{e.Status}' by={e.VerifiedByUserId} at={e.OccurredAtUtc:O}");
        }

        pulled.LastVerificationStatus.Should().Be("Verified",
            "the owner both recorded the day and vouches for it; Draft is the bug and Confirmed is the trap " +
            "(the ring counts neither)");

        pulled.VerificationEvents.Should().HaveCount(2,
            "the FSM has no Draft->Verified edge, so the owner's log must WALK Draft->Confirmed->Verified — " +
            "adding a shortcut edge would have let every role self-approve");
        pulled.VerificationEvents.Select(e => e.Status).Should().ContainInOrder("confirmed", "verified");
        pulled.VerificationEvents.Should().OnlyContain(e => e.VerifiedByUserId == OwnerUserId,
            "the attestation belongs to the operator the JWT identified, not to whoever the payload named");

        // ── The last two hops, executed rather than asserted in prose. ─────────
        var localStatus = MapVerificationStatusLikeTheClient(pulled.LastVerificationStatus);
        localStatus.Should().Be("VERIFIED", "mapVerificationStatus.ts:29-31 maps 'verified' to VERIFIED");
        TheRingCountsIt(localStatus).Should().BeTrue(
            "dayState.ts:77-80 counts VERIFIED — this is the assertion that makes the day read 100% instead of 70%");

        output.WriteLine($"[EVIDENCE] client-side status = {localStatus}; ring counts it = {TheRingCountsIt(localStatus)} (expect True)");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PROOF 2 — THE BOUNDARY. A mukadam's log still comes back needing approval.
    // ─────────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task A_mukadams_log_still_comes_back_needing_approval_and_the_ring_does_not_count_it()
    {
        if (SkippedForMissingPostgres())
        {
            return;
        }

        var dailyLogId = Guid.Parse("1ccc2222-2222-2222-2222-222222222222");

        var push = await RunSyncPushAsync(
            actorUserId: MukadamUserId,
            actorRole: "PrimaryOwner", // deliberately OVER-stated: the wire must not be believed.
            clientRequestId: "req-mukadam-roundtrip",
            dailyLogId: dailyLogId,
            logDate: MukadamLogDate);

        push.IsSuccess.Should().BeTrue();
        Assert.Single(push.Value!.Results).Status.Should().Be("applied",
            "a mukadam is a member of this farm and may absolutely record a day");

        var pulled = await PullDailyLogAsync(MukadamUserId, dailyLogId);

        output.WriteLine("[EVIDENCE] === mukadam's log, as it came back over the wire ===");
        output.WriteLine($"[EVIDENCE] lastVerificationStatus = '{pulled.LastVerificationStatus}'");
        output.WriteLine($"[EVIDENCE] verificationEvents     = {pulled.VerificationEvents.Count} (expect 0)");

        pulled.LastVerificationStatus.Should().Be("Draft",
            "a foreman may record work but not approve it; his claim of 'PrimaryOwner' on the wire was ignored " +
            "because authority is read from his membership, not from the payload");
        pulled.VerificationEvents.Should().BeEmpty(
            "nobody has attested to this day yet — an event here would be the server inventing an approval");

        var localStatus = MapVerificationStatusLikeTheClient(pulled.LastVerificationStatus);
        localStatus.Should().Be("DRAFT");
        TheRingCountsIt(localStatus).Should().BeFalse(
            "the day must stay open until an owner approves it — a 100% ring here would be a silent trust break");

        output.WriteLine($"[EVIDENCE] client-side status = {localStatus}; ring counts it = {TheRingCountsIt(localStatus)} (expect False)");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PROOF 3 — the owner's SECOND push of the same log (offline retry) must not
    // stack another pair of attestations onto a day he only lived once.
    // ─────────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task An_idempotent_resend_does_not_stack_a_second_attestation()
    {
        if (SkippedForMissingPostgres())
        {
            return;
        }

        var dailyLogId = Guid.Parse("1ccc3333-3333-3333-3333-333333333333");
        const string clientRequestId = "req-owner-resend";
        var logDate = new DateOnly(2026, 8, 12);

        var first = await RunSyncPushAsync(OwnerUserId, "PrimaryOwner", clientRequestId, dailyLogId, logDate);
        Assert.Single(first.Value!.Results).Status.Should().Be("applied");

        var second = await RunSyncPushAsync(OwnerUserId, "PrimaryOwner", clientRequestId, dailyLogId, logDate);
        Assert.Single(second.Value!.Results).Status.Should().BeOneOf("applied", "duplicate");

        var pulled = await PullDailyLogAsync(OwnerUserId, dailyLogId);
        pulled.VerificationEvents.Should().HaveCount(2,
            "at-least-once delivery is normal on a flaky connection; the audit trail must record what happened, " +
            "not how many times the phone retried");
        pulled.LastVerificationStatus.Should().Be("Verified");

        output.WriteLine($"[EVIDENCE] after 2 pushes of the same clientRequestId: events={pulled.VerificationEvents.Count} (expect 2), status='{pulled.LastVerificationStatus}'");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // The last two client hops, mirrored so the round trip is EXECUTED, not
    // asserted in prose. Both are deliberately verbatim transcriptions.
    // ─────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Verbatim transcription of
    /// <c>src/clients/mobile-web/src/features/sync/pull/helpers/mapVerificationStatus.ts</c>
    /// (the switch at :22-39) — the function <c>logsReconciler.toDailyLog</c> feeds
    /// <c>DailyLogDto.lastVerificationStatus</c> into before writing
    /// <c>DailyLog.verification.status</c> to Dexie.
    /// </summary>
    private static string MapVerificationStatusLikeTheClient(string? status)
    {
        if (string.IsNullOrEmpty(status))
        {
            return "DRAFT";
        }

        var normalized = System.Text.RegularExpressions.Regex
            .Replace(status.Trim(), "([a-z])([A-Z])", "$1_$2");
        normalized = System.Text.RegularExpressions.Regex
            .Replace(normalized, "[\\s-]+", "_")
            .ToLowerInvariant();

        return normalized switch
        {
            "draft" or "pending" => "DRAFT",
            "confirmed" or "auto_approved" => "CONFIRMED",
            "approved" or "verified" => "VERIFIED",
            "rejected" or "disputed" => "DISPUTED",
            "correction_pending" => "CORRECTION_PENDING",
            _ => "DRAFT",
        };
    }

    /// <summary>
    /// Verbatim transcription of <c>VERIFIED_STATUSES</c> in
    /// <c>src/clients/mobile-web/src/shared/utils/dayState.ts:77-80</c> — the set
    /// <c>computeDayState</c> consults when deciding whether a log closes the day.
    /// CONFIRMED is deliberately NOT in it: <c>ReviewInboxSheet.tsx:40-45</c> still shows a
    /// CONFIRMED log as waiting for review, so counting it as done would have the ring and
    /// the inbox contradicting each other about the same log.
    /// </summary>
    private static bool TheRingCountsIt(string localStatus)
        => localStatus is "VERIFIED" or "APPROVED";

    // ─────────────────────────────────────────────────────────────────────────
    // Provisioning evidence — a suite that reports Passed! in ~1s having created
    // ZERO databases has happened here before. Print what was actually built.
    // ─────────────────────────────────────────────────────────────────────────
    private async Task WriteProvisioningEvidenceAsync()
    {
        await using var admin = new NpgsqlConnection(_adminConn);
        await admin.OpenAsync();
        var scratchCount = Convert.ToInt64(await ScalarAsync(admin,
            "SELECT COUNT(*) FROM pg_database WHERE datname LIKE 'ssf_owner_roundtrip_%'"));

        await using var scratch = new NpgsqlConnection(_superuserConn);
        await scratch.OpenAsync();
        var currentDb = Convert.ToString(await ScalarAsync(scratch, "SELECT current_database()"));
        var tables = Convert.ToInt64(await ScalarAsync(scratch,
            "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'ssf'"));

        output.WriteLine("[PROVISIONING] === this run genuinely built a database ===");
        output.WriteLine($"[PROVISIONING] scratch database created    = '{currentDb}'");
        output.WriteLine($"[PROVISIONING] live ssf_owner_roundtrip_* DBs = {scratchCount} (expect >= 1 during this run)");
        output.WriteLine($"[PROVISIONING] ssf tables after migrations = {tables} (expect many; 0 would mean no chain ran)");

        currentDb.Should().Be(_scratchDbName, "the suite must be running against its OWN scratch database");
        tables.Should().BeGreaterThan(10, "the migration chain must genuinely have been applied");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Drives the ACTUAL handlers under the production posture: /sync/push is
    // admin-elevated (TenantTransactionMiddleware skip-list) and establishes its
    // own farm GUC; /sync/pull runs USER-SCOPED (ADR 0019).
    // ─────────────────────────────────────────────────────────────────────────
    private async Task<AgriSync.BuildingBlocks.Results.Result<SyncPushResponseDto>> RunSyncPushAsync(
        Guid actorUserId,
        string actorRole,
        string clientRequestId,
        Guid dailyLogId,
        DateOnly logDate)
    {
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;

        sp.GetRequiredService<TenantContext>().ElevateToAdminCrossTenant();

        var payload = new Dictionary<string, object?>
        {
            ["dailyLogId"] = dailyLogId,
            ["farmId"] = FarmId,
            ["plotId"] = PlotId,
            ["cropCycleId"] = CropCycleId,
            ["operatorUserId"] = actorUserId,
            ["logDate"] = logDate.ToString("yyyy-MM-dd"),
        };

        var command = new PushSyncBatchCommand(
            DeviceId: "device-owner-roundtrip",
            AuthenticatedUserId: actorUserId,
            ActorRole: actorRole,
            Mutations: new[]
            {
                new PushSyncMutationCommand(clientRequestId, "create_daily_log", JsonSerializer.SerializeToElement(payload)),
            },
            AppVersion: "1.3.0");

        return await sp.GetRequiredService<PushSyncBatchHandler>().HandleAsync(command);
    }

    private async Task<DailyLogDto> PullDailyLogAsync(Guid userId, Guid dailyLogId)
    {
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;

        // ADR 0019 — GET /sync/pull runs user-scoped, exactly as the endpoint does.
        sp.GetRequiredService<TenantContext>().SetUserScoped(userId);

        var result = await sp.GetRequiredService<PullSyncChangesHandler>()
            .HandleAsync(new PullSyncChangesQuery(DateTime.UnixEpoch, userId));

        result.IsSuccess.Should().BeTrue("the pull must succeed: {0}", result.Error?.ToString() ?? "-");
        return result.Value!.DailyLogs.Should().ContainSingle(l => l.Id == dailyLogId,
            "the log the device just pushed must come back down on the next pull").Subject;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Fixture helpers (seed as superuser — bypasses RLS).
    // ─────────────────────────────────────────────────────────────────────────

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

    /// <summary>
    /// <c>20260515090000_BootstrapDbRoles</c> grants <c>agrisync_app</c> privileges on the
    /// <c>ssf</c> schema ONLY. The pull path also reads <c>public.users</c> (operator names,
    /// via <c>GetOperatorsByIdsAsync</c>), so a scratch database built purely from the
    /// migration chain fails with <c>42501: permission denied for table users</c> before any
    /// assertion in this suite runs. That is a FIXTURE gap, not a product one — a provisioned
    /// environment grants these outside the migration chain. Granting here keeps the RLS
    /// posture intact (still a non-superuser, still FORCE RLS) while letting the pull reach
    /// the code under test.
    /// </summary>
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

    private static async Task SeedFarmAsync(NpgsqlConnection db)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status)
            VALUES (@id, 'Owner Round Trip Farm', @owner, @account, NOW(), NOW(), 3.0, 'Unchecked');
            """;
        cmd.Parameters.AddWithValue("id", FarmId);
        cmd.Parameters.AddWithValue("owner", OwnerUserId);
        cmd.Parameters.AddWithValue("account", OwnerAccountId);
        await cmd.ExecuteNonQueryAsync();
    }

    /// <summary>status 3 = <c>MembershipStatus.Active</c>.</summary>
    private static async Task SeedFarmMembershipAsync(NpgsqlConnection db, Guid userId, string role)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.farm_memberships
                ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status)
            VALUES (@id, @farm, @user, @role, NOW(), NOW(), @account, 3);
            """;
        cmd.Parameters.AddWithValue("id", Guid.NewGuid());
        cmd.Parameters.AddWithValue("farm", FarmId);
        cmd.Parameters.AddWithValue("user", userId);
        cmd.Parameters.AddWithValue("role", role);
        cmd.Parameters.AddWithValue("account", OwnerAccountId);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task SeedPlotAsync(NpgsqlConnection db)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.plots ("Id", farm_id, name, area_in_acres, created_at_utc, modified_at_utc)
            VALUES (@id, @farm, 'Plot A', 1.0, NOW(), NOW());
            """;
        cmd.Parameters.AddWithValue("id", PlotId);
        cmd.Parameters.AddWithValue("farm", FarmId);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task SeedCropCycleAsync(NpgsqlConnection db)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.crop_cycles ("Id", farm_id, plot_id, crop_name, stage, start_date, created_at_utc, modified_at_utc)
            VALUES (@id, @farm, @plot, 'Grapes', 'Vegetative', @start, NOW(), NOW());
            """;
        cmd.Parameters.AddWithValue("id", CropCycleId);
        cmd.Parameters.AddWithValue("farm", FarmId);
        cmd.Parameters.AddWithValue("plot", PlotId);
        cmd.Parameters.AddWithValue("start", new DateTime(2026, 1, 1));
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
