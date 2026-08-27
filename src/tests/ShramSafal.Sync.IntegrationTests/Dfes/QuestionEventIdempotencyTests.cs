// spec: dfes-companion-2026-07-11 (wave-3.3)
using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Persistence; // TenantContext
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Dfes.RecordQuestionEvent;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Domain.Logs;
using ShramSafal.Infrastructure;
using ShramSafal.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Dfes;

/// <summary>
/// SPEC RULING 1 (2026-08-15) — <b>a retry can never write the same question twice.</b>
///
/// <para><b>Why this must be an integration test.</b> Wave-3.2 stopped the client ENGINE
/// asking the same question about the same log twice; it cannot stop a WRITE happening
/// twice. <c>useDfesQuestion.ts:75</c> resets <c>recordedRef</c> on a failed POST, so a
/// request that reaches the server and then loses its response is retried against a row
/// that already landed. Nothing about that spans one layer: it needs the real handler, the
/// real repository read, real RLS, and a real Postgres unique index. A fake repository can
/// satisfy the handler half in memory while the database happily accepts the second row.</para>
///
/// <para><b>Why check-then-insert and not an upsert.</b> <c>ssf.question_events</c> is
/// append-only by privilege — <c>REVOKE UPDATE, DELETE ON ssf.question_events FROM
/// agrisync_app</c> (20260713052440_AddDfesDataSpine) — so <c>ON CONFLICT DO UPDATE</c> is
/// not available to the app role at all. The handler reads first; the partial unique index
/// <c>ux_question_events_log_question</c> is the backstop for the genuine concurrent race
/// that read cannot close. PROOF 3 exercises the index directly rather than trusting it,
/// because a handler that short-circuits would make an absent index invisible.</para>
///
/// <para><b>Why the index is PARTIAL.</b> Every row written before wave-3.1 carries
/// <c>daily_log_id IS NULL</c> — the client never sent the log id. PROOF 4 pins that those
/// rows are still unconstrained; an unfiltered unique index would have failed to build on
/// any real farm's history.</para>
///
/// <para><b>Native :5433, opt-in, self-skipping.</b> Follows <c>AnswerRaisesScoreTests</c>
/// verbatim — same <c>RequiresPostgres</c> trait, same scratch-database lifecycle, same
/// admin-elevate + manual-GUC write posture that dodges the
/// <c>TenantConnectionInterceptor</c> SET LOCAL rows-affected desync. It creates its OWN
/// scratch database and drops it on dispose. A skipped run prints <c>[SKIPPED]</c> and
/// proves nothing.</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class QuestionEventIdempotencyTests(Xunit.Abstractions.ITestOutputHelper output)
    : IAsyncLifetime
{
    private const string AppRoleUser = IntegrationPostgres.AppRoleUser;
    private static string AppRolePassword => IntegrationPostgres.AppRolePassword;

    private static readonly Guid FarmId = Guid.Parse("dfe53300-0000-0000-0000-000000000001");
    private static readonly Guid OwnerUserId = Guid.Parse("dfe53300-0000-0000-0000-000000000002");
    private static readonly Guid OwnerAccountId = Guid.Parse("dfe53300-0000-0000-0000-000000000003");
    private static readonly Guid PlotId = Guid.Parse("dfe53300-0000-0000-0000-000000000004");
    private static readonly Guid CropCycleId = Guid.Parse("dfe53300-0000-0000-0000-000000000005");

    // One date per proof so they never contend on ux_daily_richness_farm_local_date.
    private static readonly DateOnly RetryDate = DateOnly.FromDateTime(DateTime.UtcNow.Date);
    private static readonly DateOnly TwoLogsDate = RetryDate.AddDays(-1);
    private static readonly DateOnly RaceDate = RetryDate.AddDays(-2);
    private static readonly DateOnly LegacyDate = RetryDate.AddDays(-3);

    // 09:00 UTC is 14:30 IST — unambiguously inside its local date under +05:30.
    private static DateTime MiddayUtc(DateOnly localDate)
        => localDate.ToDateTime(new TimeOnly(9, 0), DateTimeKind.Utc);

    // CompareEngine.Categorize buckets this as "spray", so the day genuinely OWES DOSE —
    // the gap the question below is about actually exists.
    private const string SprayActivity = "Spraying";

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

        // A genuinely ABSENT server self-skips; a server that answers and refuses us
        // throws — a misconfigured credential must never masquerade as a clean skip.
        var probeSkip = await IntegrationPostgres.ProbeOrSkipReasonAsync(baseConn);
        if (probeSkip is not null)
        {
            _skip = true;
            _skipReason = probeSkip;
            return;
        }

        _adminConn = baseConn;
        _scratchDbName = $"ssf_dfes_idem_{Guid.NewGuid():N}";
        await using (var admin = new NpgsqlConnection(baseConn))
        {
            await admin.OpenAsync();
            await using var create = admin.CreateCommand();
            create.CommandText = $"CREATE DATABASE \"{_scratchDbName}\"";
            await create.ExecuteNonQueryAsync();
        }

        output.WriteLine($"[PROVISIONED] scratch database '{_scratchDbName}' created on the real :5433 cluster.");

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
            await SeedFarmAsync(raw);
            await SeedFarmMembershipAsync(raw);
            await SeedPlotAsync(raw);
            await SeedCropCycleAsync(raw);
        }

        var services = new ServiceCollection();
        services.AddLogging();
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:ShramSafalDb"] = _appConn,
                ["ConnectionStrings:ShramSafalDb_Migration"] = _superuserConn,
                ["ConnectionStrings:UserDb"] = _appConn,
            }!)
            .Build();
        services.AddSingleton<IConfiguration>(config);
        services.AddShramSafalInfrastructure(config);
        services.AddScoped<IIdGenerator, GuidIdGenerator>();
        services.AddScoped<IClock, SystemClock>();
        services.AddScoped<IDailyRichnessDerivationService, DailyRichnessDerivationService>();
        services.AddScoped<RecordQuestionEventHandler>();

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

    private void SkipIfPostgresUnavailable()
    {
        if (_skip)
        {
            output.WriteLine($"[SKIPPED] {_skipReason} — NO DATABASE WAS EXERCISED; this run proves nothing.");
        }

        Skip.If(_skip, _skipReason);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PROOF 1 — the retry. Two identical commands, one row, and the SAME id back
    // both times, so the client cannot tell the replay from the original.
    // ─────────────────────────────────────────────────────────────────────────
    [SkippableFact]
    public async Task Recording_the_same_question_for_the_same_log_twice_yields_one_row()
    {
        SkipIfPostgresUnavailable();

        var logId = await SeedSprayingDayAsync(RetryDate);

        var first = await RecordQuestionEventAsync("gap.dose", "250 ml", RetryDate, logId);
        var second = await RecordQuestionEventAsync("gap.dose", "250 ml", RetryDate, logId);

        first.IsSuccess.Should().BeTrue("the command is both-approved and the caller owns the farm");
        second.IsSuccess.Should().BeTrue(
            "a retry must be SILENT — an offline client that re-sends a landed write gets a success, never a 500");
        second.Value.Should().Be(first.Value,
            "the replay must return the row that already exists, so nothing downstream can tell the two calls apart");

        var count = await CountForLogAsync(logId, "gap.dose");
        count.Should().Be(1,
            "Ruling 1 — the same log must never receive the same question twice, across offline retries, "
            + "reopening the app, or syncing from another device");

        output.WriteLine("[EVIDENCE] === a retry writes no second row (real Npgsql :5433) ===");
        output.WriteLine($"[EVIDENCE] first call  -> event id {first.Value}");
        output.WriteLine($"[EVIDENCE] second call -> event id {second.Value} (must be identical)");
        output.WriteLine($"[EVIDENCE] ssf.question_events rows for (log={logId}, 'gap.dose') = {count}");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PROOF 2 — the guard is per LOG, not per question key. Ruling 1 is explicit
    // that Monday's and Wednesday's spray logs may BOTH be asked for a dose.
    // Without this, "one row per question" would be indistinguishable from
    // "the farmer is asked once and never again".
    // ─────────────────────────────────────────────────────────────────────────
    [SkippableFact]
    public async Task A_different_log_may_still_be_asked_the_same_question()
    {
        SkipIfPostgresUnavailable();

        var logA = await SeedSprayingDayAsync(TwoLogsDate, suffix: "a");
        var logB = await SeedSprayingDayAsync(TwoLogsDate, suffix: "b");
        logA.Should().NotBe(logB, "the fixture must really have created two distinct logs");

        var a = await RecordQuestionEventAsync("gap.dose", "250 ml", TwoLogsDate, logA);
        var b = await RecordQuestionEventAsync("gap.dose", "300 ml", TwoLogsDate, logB);

        a.IsSuccess.Should().BeTrue();
        b.IsSuccess.Should().BeTrue();
        b.Value.Should().NotBe(a.Value, "a different log is a different question occasion, not a replay");
        (await CountForLogAsync(logA, "gap.dose")).Should().Be(1);
        (await CountForLogAsync(logB, "gap.dose")).Should().Be(1);

        output.WriteLine("[EVIDENCE] === per-LOG, not per-question-key (real Npgsql :5433) ===");
        output.WriteLine($"[EVIDENCE] log A {logA} -> event {a.Value}");
        output.WriteLine($"[EVIDENCE] log B {logB} -> event {b.Value} (must differ)");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PROOF 3 — THE INDEX IS REAL. The handler's read short-circuits before the
    // INSERT, so PROOF 1 would pass identically against a database with no unique
    // index at all. This inserts the duplicate directly, bypassing the handler,
    // and requires Postgres itself to refuse it (SQLSTATE 23505). Without this
    // proof, the "backstop for a genuine race" claim is untested.
    // ─────────────────────────────────────────────────────────────────────────
    [SkippableFact]
    public async Task The_partial_unique_index_refuses_a_duplicate_that_bypasses_the_handler()
    {
        SkipIfPostgresUnavailable();

        var logId = await SeedSprayingDayAsync(RaceDate);
        var first = await RecordQuestionEventAsync("gap.carrier", "drip", RaceDate, logId);
        first.IsSuccess.Should().BeTrue();

        var act = () => InsertRawQuestionEventAsync(logId, "gap.carrier");

        (await act.Should().ThrowAsync<PostgresException>(
                "ux_question_events_log_question must exist and be UNIQUE, or a concurrent race writes two rows"))
            .Which.SqlState.Should().Be("23505");

        (await CountForLogAsync(logId, "gap.carrier")).Should().Be(1);

        output.WriteLine("[EVIDENCE] === the database itself refuses the second row (real Npgsql :5433) ===");
        output.WriteLine("[EVIDENCE] direct INSERT bypassing the handler -> SQLSTATE 23505 (unique_violation)");
        output.WriteLine($"[EVIDENCE] ssf.question_events rows for (log={logId}, 'gap.carrier') = 1");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PROOF 4 — legacy rows are NOT constrained. Every question_event written
    // before wave-3.1 has daily_log_id NULL; an unfiltered unique index would
    // have collapsed that history to one row per question key and failed to
    // build. The WHERE predicate on the index is what makes this true.
    // ─────────────────────────────────────────────────────────────────────────
    [SkippableFact]
    public async Task Legacy_rows_with_no_log_id_are_left_unconstrained()
    {
        SkipIfPostgresUnavailable();

        await InsertRawQuestionEventAsync(dailyLogId: null, "gap.dose");
        await InsertRawQuestionEventAsync(dailyLogId: null, "gap.dose");

        var count = await CountLegacyAsync("gap.dose");
        count.Should().Be(2,
            "the index carries WHERE daily_log_id IS NOT NULL — pre-3.1 history must stay writable and readable");

        output.WriteLine("[EVIDENCE] === NULL-log rows are outside the partial index (real Npgsql :5433) ===");
        output.WriteLine($"[EVIDENCE] ssf.question_events rows with daily_log_id IS NULL and key 'gap.dose' = {count}");
        _ = LegacyDate; // the legacy rows carry no local date; kept for symmetry with the other proofs
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Exercise paths — same write posture as the sibling DFES fixture.
    // ─────────────────────────────────────────────────────────────────────────

    /// <summary>The REAL handler, exactly as the endpoint calls it.</summary>
    private async Task<AgriSync.BuildingBlocks.Results.Result<Guid>> RecordQuestionEventAsync(
        string questionKey, string? response, DateOnly localDate, Guid? dailyLogId)
    {
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        var ctx = sp.GetRequiredService<ShramSafalDbContext>();
        var tenant = sp.GetRequiredService<TenantContext>();
        var handler = sp.GetRequiredService<RecordQuestionEventHandler>();

        tenant.ElevateToAdminCrossTenant();
        await using var tx = await ctx.Database.BeginTransactionAsync();
        await SetGucsAsync(ctx);

        var result = await handler.HandleAsync(new RecordQuestionEventCommand(
            CallerUserId: OwnerUserId, FarmId: FarmId, PlotId: PlotId, DailyLogId: dailyLogId,
            QuestionKey: questionKey, Crop: "grapes", ExpectedStage: "flowering",
            ActualStageApplicability: null, AnchorDateType: "log_date", TriggerType: "Gap",
            QuestionType: "gap_fill", Lens: "Execution", DepthLevel: 1, Priority: 4, Cooldown: 3,
            AnswerModes: "voice", SafetyClass: "informational",
            AgronomistApproved: true, MarathiApproved: true,
            BankVersion: "dfes-bank-1", QuestionEngineVersion: "dfes-qengine-1",
            AnswerObservationId: null, ShownAtUtc: MiddayUtc(localDate), TriggerReason: "gap DOSE",
            WeatherContext: null, Response: response, StageConfirmed: null,
            PhotoSubmitted: false, Skipped: response is null));

        await tx.CommitAsync();
        return result;
    }

    /// <summary>
    /// A real day of work with an OPEN dose gap: one DailyLog carrying a Completed
    /// spraying task. Returns the log id — which is the whole point here, since
    /// daily_log_id is what the dedupe keys on.
    /// </summary>
    private async Task<Guid> SeedSprayingDayAsync(DateOnly localDate, string suffix = "")
    {
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        var ctx = sp.GetRequiredService<ShramSafalDbContext>();
        var tenant = sp.GetRequiredService<TenantContext>();
        var repo = sp.GetRequiredService<IShramSafalRepository>();

        tenant.ElevateToAdminCrossTenant();
        await using var tx = await ctx.Database.BeginTransactionAsync();
        await SetGucsAsync(ctx);

        var log = DailyLog.Create(
            id: Guid.NewGuid(),
            farmId: new FarmId(FarmId),
            plotId: PlotId,
            cropCycleId: CropCycleId,
            operatorUserId: new UserId(OwnerUserId),
            logDate: localDate,
            idempotencyKey: $"dfes-idem-{localDate:yyyyMMdd}{suffix}",
            location: null,
            createdAtUtc: DateTime.UtcNow);
        log.AddTask(
            taskId: Guid.NewGuid(),
            activityType: SprayActivity,
            notes: null,
            occurredAtUtc: MiddayUtc(localDate),
            executionStatus: ExecutionStatus.Completed);

        await repo.AddDailyLogAsync(log);
        await repo.SaveChangesAsync();
        await tx.CommitAsync();
        return log.Id;
    }

    private static async Task SetGucsAsync(ShramSafalDbContext ctx)
    {
        await ctx.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('agrisync.user_id', {OwnerUserId.ToString()}, true)");
        await ctx.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('agrisync.farm_id', {FarmId.ToString()}, true)");
        await ctx.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('agrisync.owner_account_id', {OwnerAccountId.ToString()}, true)");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Ground truth — read and write as superuser (bypasses RLS), never through
    // the write context's identity map.
    // ─────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Inserts a question_event with raw SQL, deliberately bypassing the handler's
    /// idempotency read — the only way to make the DATABASE constraint the thing under
    /// test. Superuser, so RLS is not what refuses it.
    /// </summary>
    private async Task InsertRawQuestionEventAsync(Guid? dailyLogId, string questionKey)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.question_events
                ("Id", daily_log_id, farm_id, plot_id, question_key, crop, anchor_date_type,
                 trigger_type, question_type, lens, depth_level, priority, cooldown,
                 answer_modes, safety_class, agronomist_approved, marathi_approved,
                 bank_version, question_engine_version, created_at_utc)
            VALUES (@id, @log, @farm, @plot, @key, 'grapes', 'log_date',
                    'Gap', 'gap_fill', 'Execution', 1, 4, 3,
                    'voice', 'informational', true, true,
                    'dfes-bank-1', 'dfes-qengine-1', NOW());
            """;
        cmd.Parameters.AddWithValue("id", Guid.NewGuid());
        cmd.Parameters.AddWithValue("log", (object?)dailyLogId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("farm", FarmId);
        cmd.Parameters.AddWithValue("plot", PlotId);
        cmd.Parameters.AddWithValue("key", questionKey);
        await cmd.ExecuteNonQueryAsync();
    }

    private async Task<int> CountForLogAsync(Guid dailyLogId, string questionKey)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT COUNT(*) FROM ssf.question_events
            WHERE daily_log_id = @id AND question_key = @key
            """;
        cmd.Parameters.AddWithValue("id", dailyLogId);
        cmd.Parameters.AddWithValue("key", questionKey);
        return (int)(long)(await cmd.ExecuteScalarAsync())!;
    }

    private async Task<int> CountLegacyAsync(string questionKey)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT COUNT(*) FROM ssf.question_events
            WHERE daily_log_id IS NULL AND question_key = @key
            """;
        cmd.Parameters.AddWithValue("key", questionKey);
        return (int)(long)(await cmd.ExecuteScalarAsync())!;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Fixture helpers (seed as superuser — bypasses RLS).
    // ─────────────────────────────────────────────────────────────────────────
    private static async Task SeedFarmAsync(NpgsqlConnection db)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status)
            VALUES (@id, 'DFES Question-Idempotency Farm', @owner, @account, NOW(), NOW(), 3.0, 'Unchecked');
            """;
        cmd.Parameters.AddWithValue("id", FarmId);
        cmd.Parameters.AddWithValue("owner", OwnerUserId);
        cmd.Parameters.AddWithValue("account", OwnerAccountId);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task SeedFarmMembershipAsync(NpgsqlConnection db)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.farm_memberships
                ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status)
            VALUES (@id, @farm, @user, 'PrimaryOwner', NOW(), NOW(), @account, 3);
            """;
        cmd.Parameters.AddWithValue("id", Guid.NewGuid());
        cmd.Parameters.AddWithValue("farm", FarmId);
        cmd.Parameters.AddWithValue("user", OwnerUserId);
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
}
