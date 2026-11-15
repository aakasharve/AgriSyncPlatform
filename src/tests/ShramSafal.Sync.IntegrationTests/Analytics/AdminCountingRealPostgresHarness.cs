// spec: company-mis-real-numbers-2026-11-15 (plan CR-2a, Tasks 3 and 4)
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Persistence;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShramSafal.Infrastructure;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Analytics;

/// <summary>
/// Shared set-up of the two CR-2a real-database classes, in the shape of
/// <c>Dfes/StreakCountsConfirmedRecordsRealPostgresTests</c> and the plan's
/// Task 3 file list: a scratch database per test (created, migrated, dropped),
/// rows seeded as the superuser, and the production connection shape —
/// <c>ShramSafalDb</c> = <c>UserDb</c> = the app role <c>agrisync_app</c>,
/// <c>ShramSafalDb_Migration</c> = the superuser, <c>AnalyticsDbContext</c>
/// on the app role, <see cref="TenantContext.ElevateToAdminCrossTenant"/> as
/// the admin skip-list does.
///
/// <para><b>Doctrine E3.</b> Every test calls <see cref="GuardAsync"/> first:
/// the app-role connection must be neither superuser nor BYPASSRLS.</para>
///
/// Made-up GUIDs, obviously fake names and phone numbers only.
/// </summary>
public abstract class AdminCountingRealPostgresHarness(Xunit.Abstractions.ITestOutputHelper output) : IAsyncLifetime
{
    private const string RoleVacuityGuardSql =
        "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user";

    protected static readonly TimeSpan IstOffset = TimeSpan.FromMinutes(330);

    protected readonly Xunit.Abstractions.ITestOutputHelper Output = output;

    protected string AdminConn { get; private set; } = string.Empty;
    protected string SuperuserConn { get; private set; } = string.Empty;
    protected string AppConn { get; private set; } = string.Empty;
    protected string ScratchDbName { get; private set; } = string.Empty;

    private bool _skip;
    private string _skipReason = string.Empty;
    private readonly List<ServiceProvider> _providers = new();

    protected abstract string ScratchPrefix { get; }

    /// <summary>Rows every test of the class starts from, written as the superuser.</summary>
    protected abstract Task SeedAsync(NpgsqlConnection superuser);

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

        AdminConn = baseConn;
        ScratchDbName = $"{ScratchPrefix}_{Guid.NewGuid():N}";
        await using (var admin = new NpgsqlConnection(baseConn))
        {
            await admin.OpenAsync();
            await using var create = admin.CreateCommand();
            create.CommandText = $"CREATE DATABASE \"{ScratchDbName}\"";
            await create.ExecuteNonQueryAsync();
        }

        SuperuserConn = new NpgsqlConnectionStringBuilder(baseConn) { Database = ScratchDbName }.ConnectionString;
        AppConn = new NpgsqlConnectionStringBuilder(SuperuserConn)
        {
            Username = IntegrationPostgres.AppRoleUser,
            Password = IntegrationPostgres.AppRolePassword,
        }.ConnectionString;

        try
        {
            await IntegrationMigrationChain.ApplyAsync(SuperuserConn);

            await using var raw = new NpgsqlConnection(SuperuserConn);
            await raw.OpenAsync();

            // 20260515090000_BootstrapDbRoles grants agrisync_app privileges on the ssf schema only; the
            // analytics connection reads public.users, public.refresh_tokens, analytics.events and
            // mis.wvfd_weekly. Fixture gap, not a product one (the same helper as
            // Dfes/OwnerCanApproveAMukadamsLogRealPostgresTests). Read-only: SELECT, nothing else.
            await ExecAsync(raw, $"""
                GRANT USAGE ON SCHEMA public, analytics, mis TO {IntegrationPostgres.AppRoleUser};
                GRANT SELECT ON ALL TABLES IN SCHEMA public, analytics, mis TO {IntegrationPostgres.AppRoleUser};
                """);

            await SeedAsync(raw);
        }
        catch
        {
            // xUnit does not call DisposeAsync when InitializeAsync throws: drop the scratch database here.
            await DisposeAsync();
            throw;
        }
    }

    public async Task DisposeAsync()
    {
        foreach (var provider in _providers)
        {
            await provider.DisposeAsync();
        }

        if (!_skip && !string.IsNullOrEmpty(ScratchDbName) && !string.IsNullOrEmpty(AdminConn))
        {
            try
            {
                NpgsqlConnection.ClearAllPools();
                await using var admin = new NpgsqlConnection(AdminConn);
                await admin.OpenAsync();
                await using var terminate = admin.CreateCommand();
                terminate.CommandText =
                    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = @db AND pid <> pg_backend_pid()";
                terminate.Parameters.AddWithValue("db", ScratchDbName);
                await terminate.ExecuteNonQueryAsync();
                await using var drop = admin.CreateCommand();
                drop.CommandText = $"DROP DATABASE IF EXISTS \"{ScratchDbName}\"";
                await drop.ExecuteNonQueryAsync();
            }
            catch
            {
                // Best-effort teardown; the run's report lists any database left behind.
            }
        }
    }

    /// <summary>Doctrine E3, first assertion of every test.</summary>
    protected async Task GuardAsync()
    {
        if (_skip)
        {
            Output.WriteLine($"[SKIPPED] {_skipReason} — NO DATABASE WAS EXERCISED; this run proves nothing.");
        }

        Skip.If(_skip, _skipReason);

        await using var db = new NpgsqlConnection(AppConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = RoleVacuityGuardSql;
        var superOrBypass = (bool)(await cmd.ExecuteScalarAsync())!;
        Output.WriteLine(
            $"[EVIDENCE] current_user='{IntegrationPostgres.AppRoleUser}' rolsuper OR rolbypassrls={superOrBypass} (REQUIRED: False)");
        superOrBypass.Should().BeFalse("doctrine E3: a proof run as a superuser or BYPASSRLS role proves nothing");
    }

    /// <summary>
    /// The production shape of the services. <paramref name="excludedUserIds"/>
    /// goes into <c>CompanyMis:ExcludedUserIds</c>, read once at registration.
    /// <paramref name="analyticsConn"/> overrides the analytics connection (to
    /// point it at a database that does not exist).
    /// </summary>
    protected ServiceProvider BuildProvider(
        IReadOnlyList<Guid>? excludedUserIds = null, string? analyticsConn = null, string? migrationConn = null)
    {
        var settings = new Dictionary<string, string?>
        {
            ["ConnectionStrings:ShramSafalDb"] = AppConn,
            ["ConnectionStrings:ShramSafalDb_Migration"] = migrationConn ?? SuperuserConn,
            ["ConnectionStrings:UserDb"] = AppConn,
        };
        if (excludedUserIds is not null)
        {
            for (var i = 0; i < excludedUserIds.Count; i++)
            {
                settings[$"CompanyMis:ExcludedUserIds:{i}"] = excludedUserIds[i].ToString("D");
            }
        }

        var config = new ConfigurationBuilder().AddInMemoryCollection(settings).Build();
        var services = new ServiceCollection();
        services.AddLogging();
        services.AddSingleton<IConfiguration>(config);
        services.AddShramSafalInfrastructure(config);
        services.AddDbContext<AnalyticsDbContext>(o => o.UseNpgsql(analyticsConn ?? AppConn));

        var provider = services.BuildServiceProvider();
        _providers.Add(provider);
        return provider;
    }

    /// <summary>A request scope as the admin skip-list makes it: tenant context elevated.</summary>
    protected static AsyncServiceScope AdminScope(ServiceProvider provider)
    {
        var scope = provider.CreateAsyncScope();
        scope.ServiceProvider.GetRequiredService<TenantContext>().ElevateToAdminCrossTenant();
        return scope;
    }

    // ── raw SQL helpers ──────────────────────────────────────────────────────

    protected async Task<long> ScalarAsSuperuserAsync(string sql, params (string Name, object Value)[] parameters)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in parameters)
        {
            cmd.Parameters.AddWithValue(name, value);
        }

        return Convert.ToInt64(await cmd.ExecuteScalarAsync());
    }

    protected async Task ExecAsSuperuserAsync(string sql, params (string Name, object? Value)[] parameters)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await ExecAsync(db, sql, parameters);
    }

    protected static async Task ExecAsync(NpgsqlConnection db, string sql, params (string Name, object? Value)[] parameters)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in parameters)
        {
            cmd.Parameters.AddWithValue(name, value ?? DBNull.Value);
        }

        await cmd.ExecuteNonQueryAsync();
    }

    protected Task<long> CrossFarmAuditRowsAsync(Guid actor) =>
        ScalarAsSuperuserAsync(
            "SELECT count(*) FROM ssf.audit_events WHERE entity_type = 'admin_cross_tenant' AND actor_user_id = @actor",
            ("actor", actor));

    protected Task<long> AllCrossFarmAuditRowsAsync() =>
        ScalarAsSuperuserAsync("SELECT count(*) FROM ssf.audit_events WHERE entity_type = 'admin_cross_tenant'");

    protected static Task SeedFarmAsync(
        NpgsqlConnection db, Guid farmId, string name, Guid ownerUserId, Guid ownerAccountId, DateTime createdAtUtc) =>
        ExecAsync(db, """
            INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status)
            VALUES (@id, @name, @owner, @account, @created, @created, 3.0, 'Unchecked');
            """,
            ("id", farmId), ("name", name), ("owner", ownerUserId), ("account", ownerAccountId), ("created", createdAtUtc));

    protected static Task SeedMembershipAsync(
        NpgsqlConnection db, Guid farmId, Guid userId, Guid ownerAccountId, string role, int status = 3) =>
        ExecAsync(db, """
            INSERT INTO ssf.farm_memberships
                ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status)
            VALUES (@id, @farm, @user, @role, NOW(), NOW(), @account, @status);
            """,
            ("id", Guid.NewGuid()), ("farm", farmId), ("user", userId), ("role", role), ("account", ownerAccountId),
            ("status", status));

    protected static Task SeedPlotAsync(NpgsqlConnection db, Guid farmId, decimal acres) =>
        ExecAsync(db, """
            INSERT INTO ssf.plots ("Id", farm_id, name, area_in_acres, created_at_utc, modified_at_utc)
            VALUES (@id, @farm, 'Fake Plot', @acres, NOW(), NOW());
            """,
            ("id", Guid.NewGuid()), ("farm", farmId), ("acres", acres));

    /// <summary>One ssf.daily_logs row (column set of the established raw-SQL fixtures).</summary>
    protected static Task SeedEntryAsync(
        NpgsqlConnection db, Guid farmId, Guid operatorUserId, DateTime createdAtUtc,
        bool voice = false, Guid? sourceAiJobId = null, int contentVersion = 1)
    {
        var plotId = Guid.NewGuid();
        return ExecAsync(db, """
            INSERT INTO ssf.daily_logs ("Id", farm_id, plot_id, crop_cycle_id, plot_ids, scope,
                                        operator_user_id, log_date, created_at_utc,
                                        source, model_version, prompt_version, source_ai_job_id, content_version)
            VALUES (@id, @fid, @plot, @cycle, ARRAY[@plot], 'Plot',
                    @op, @date, @created,
                    @source, 'unknown', 'unknown', @job, @version);
            """,
            ("id", Guid.NewGuid()), ("fid", farmId), ("plot", plotId), ("cycle", Guid.NewGuid()),
            ("op", operatorUserId), ("date", DateOnly.FromDateTime(createdAtUtc + IstOffset)),
            ("created", createdAtUtc), ("source", voice ? "voice" : "manual"),
            ("job", (object?)sourceAiJobId), ("version", contentVersion));
    }

    /// <summary>One VoiceToStructuredLog ai_jobs row and its successful attempts.</summary>
    protected static async Task SeedVoiceJobAsync(
        NpgsqlConnection db, Guid jobId, Guid farmId, Guid userId, DateTime createdAtUtc, string status,
        params int[] successfulLatenciesMs)
    {
        await ExecAsync(db, """
            INSERT INTO ssf.ai_jobs (
                id, idempotency_key, operation_type, user_id, farm_id, status,
                schema_version, created_at_utc, total_attempts, modified_at_utc,
                source, model_version, prompt_version, transcript_schema_version,
                normalized_result_json)
            VALUES (
                @id, @key, 'VoiceToStructuredLog', @uid, @fid, @status,
                '1.0.0', @created, @attempts, @created,
                'voice', 'gemini-2.5-flash', 'v3.2.0', '1.0.0',
                '{}'::jsonb);
            """,
            ("id", jobId), ("key", "cr2a-" + jobId.ToString("N")), ("uid", userId), ("fid", farmId),
            ("status", status), ("created", createdAtUtc), ("attempts", Math.Max(1, successfulLatenciesMs.Length + 1)));

        // A failed attempt first, which must not be a sample.
        await ExecAsync(db, """
            INSERT INTO ssf.ai_job_attempts (
                id, ai_job_id, attempt_number, provider, is_success, failure_class,
                latency_ms, attempted_at_utc, source, model_version, prompt_version)
            VALUES (@id, @job, 1, 'Gemini', false, 'TransientFailure', 99999, @at, 'voice', 'gemini-2.5-flash', 'v3.2.0');
            """,
            ("id", Guid.NewGuid()), ("job", jobId), ("at", createdAtUtc));

        for (var i = 0; i < successfulLatenciesMs.Length; i++)
        {
            await ExecAsync(db, """
                INSERT INTO ssf.ai_job_attempts (
                    id, ai_job_id, attempt_number, provider, is_success, failure_class,
                    latency_ms, attempted_at_utc, source, model_version, prompt_version)
                VALUES (@id, @job, @n, 'Gemini', true, 'None', @latency, @at, 'voice', 'gemini-2.5-flash', 'v3.2.0');
                """,
                ("id", Guid.NewGuid()), ("job", jobId), ("n", i + 2), ("latency", successfulLatenciesMs[i]),
                ("at", createdAtUtc));
        }
    }

    /// <summary>One public.users row; the phone is an obviously fake number.</summary>
    protected static Task SeedUserAsync(
        NpgsqlConnection db, Guid userId, string fakePhone, string displayName, DateTime createdAtUtc,
        DateTime? phoneVerifiedAtUtc) =>
        ExecAsync(db, """
            INSERT INTO public.users ("Id", phone, display_name, password_hash,
                                      credential_created_at_utc, created_at_utc, phone_verified_at_utc)
            VALUES (@id, @phone, @name, 'cr2a-fake-not-a-hash', @created, @created, @verified);
            """,
            ("id", userId), ("phone", fakePhone), ("name", displayName), ("created", createdAtUtc),
            ("verified", (object?)phoneVerifiedAtUtc));

    protected static Task SeedSignInAsync(
        NpgsqlConnection db, Guid userId, DateTime createdAtUtc, DateTime lastUsedAtUtc) =>
        ExecAsync(db, """
            INSERT INTO public.refresh_tokens ("Id", user_id, token_hash, device_id, platform,
                                               created_at_utc, expires_at_utc, last_used_at_utc)
            VALUES (@id, @user, @hash, 'cr2a-fake-device', 'android', @created, @expires, @used);
            """,
            ("id", Guid.NewGuid()), ("user", userId), ("hash", "cr2a-fake-" + Guid.NewGuid().ToString("N")),
            ("created", createdAtUtc), ("expires", createdAtUtc.AddDays(365)), ("used", lastUsedAtUtc));

    /// <summary>A UTC instant given as an India-time wall clock in 2026.</summary>
    protected static DateTime Ist(int month, int day, int hour = 10, int minute = 0) =>
        new DateTime(2026, month, day, hour, minute, 0, DateTimeKind.Utc) - IstOffset;

    protected static IReadOnlyList<Guid> None => Array.Empty<Guid>();

    protected static Guid G(string tail) => Guid.Parse("c2a3" + tail.PadLeft(28, '0'));
}
