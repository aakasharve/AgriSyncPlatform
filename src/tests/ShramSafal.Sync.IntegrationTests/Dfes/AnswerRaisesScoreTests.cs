// spec: dfes-farmer-facing-deploy-readiness-2026-08-14 (task-3)
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
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
using ShramSafal.Domain.Dfes;
using ShramSafal.Domain.Logs;
using ShramSafal.Infrastructure;
using ShramSafal.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Dfes;

/// <summary>
/// FOUNDER RULING A (2026-08-14) — <b>answering Sathi's question must raise the day's
/// score.</b>
///
/// <para><b>Why this must be an integration test.</b> The crediting rule itself is unit
/// tested in <c>DfesLensExtractorAnsweredGapTests</c>, but that proves only that the
/// extractor credits a gap it is HANDED. The farmer-facing promise spans four seams the
/// unit suite cannot see at once: the question event is really persisted; the repository
/// really finds it again for that farm and that local day (through RLS, off a UTC column
/// with no local_date of its own); <c>RecomputeAsync</c> really loads it; and the new
/// aggregate really lands in the row the read path serves. A fake repository can satisfy
/// every one of those in memory while the real one returns nothing — which would leave the
/// farmer answering, watching the number stay still, and stopping.</para>
///
/// <para><b>The scenario.</b> A day with one spraying task and nothing else. DOSE is OWED
/// by the operation (dfes-3) and sits at coverage 0 — the farmer sprayed but has not said
/// with how much. Sathi asks <c>gap.dose</c>; he answers "250 ml". The stored score must be
/// strictly higher afterwards, and the DOSE row of the stored roster must be the reason.</para>
///
/// <para><b>The honesty guard.</b> The second test answers the SAME question with an empty
/// response. Silence is not an answer (doctrine P4), so the number must not move. Without
/// this, "answering raises the score" could be satisfied by a rule that rewards the mere
/// act of dismissing a card.</para>
///
/// <para><b>Native :5433, opt-in, self-skipping.</b> Follows
/// <c>DailyRichnessAggregateTrackedWriteTests</c> verbatim — same <c>RequiresPostgres</c>
/// trait, same scratch-database lifecycle, same admin-elevate + manual-GUC write posture
/// that dodges the <c>TenantConnectionInterceptor</c> SET LOCAL rows-affected desync. It
/// creates its OWN scratch database and drops it on dispose; it never touches
/// <c>agrisync_dev</c> data. A skipped run is printed as <c>[SKIPPED]</c> and proves
/// nothing.</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class AnswerRaisesScoreTests(Xunit.Abstractions.ITestOutputHelper output)
    : IAsyncLifetime
{
    private const string AppRoleUser = IntegrationPostgres.AppRoleUser;
    private static string AppRolePassword => IntegrationPostgres.AppRolePassword;

    private static readonly Guid FarmId = Guid.Parse("dfe5a000-0000-0000-0000-000000000001");
    private static readonly Guid OwnerUserId = Guid.Parse("dfe5a000-0000-0000-0000-000000000002");
    private static readonly Guid OwnerAccountId = Guid.Parse("dfe5a000-0000-0000-0000-000000000003");
    private static readonly Guid PlotId = Guid.Parse("dfe5a000-0000-0000-0000-000000000004");
    private static readonly Guid CropCycleId = Guid.Parse("dfe5a000-0000-0000-0000-000000000005");

    // One date per test so the two proofs never contend on ux_daily_richness_farm_local_date.
    private static readonly DateOnly AnsweredDate = DateOnly.FromDateTime(DateTime.UtcNow.Date);
    private static readonly DateOnly SilentDate = AnsweredDate.AddDays(-1);

    // 09:00 UTC is 14:30 IST — the middle of the working day, so the instant sits
    // unambiguously inside its local date under ANY sane +05:30 conversion. The test
    // therefore does not have to borrow production's date rule to know which day it means.
    private static DateTime MiddayUtc(DateOnly localDate)
        => localDate.ToDateTime(new TimeOnly(9, 0), DateTimeKind.Utc);

    // CompareEngine.Categorize buckets this as "spray", which is what makes the day OWE
    // DOSE and CARRIER (dfes-3). A Marathi title such as "फवारणी" categorises as the
    // generic "activity" and would owe neither — the gap being answered would not exist.
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
        _scratchDbName = $"ssf_dfes_answer_{Guid.NewGuid():N}";
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

        // Seed parents as superuser (superuser bypasses RLS).
        await using (var raw = new NpgsqlConnection(_superuserConn))
        {
            await raw.OpenAsync();
            await SeedFarmAsync(raw);
            await SeedFarmMembershipAsync(raw);
            await SeedPlotAsync(raw);
            await SeedCropCycleAsync(raw);
        }

        // Real Infrastructure DI, connected as agrisync_app so FORCE-RLS genuinely applies.
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

    /// <summary>
    /// Self-skip gate. A silently-skipped integration test that reports "passed" is the
    /// exact false confidence this suite has produced before, so the reason is written to
    /// the test output: a ~1 ms duration plus a <c>[SKIPPED]</c> line is the tell that no
    /// database was touched.
    /// </summary>
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
    // PROOF 1 — answering a gap question raises the STORED day score.
    // ─────────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task Answering_a_gap_question_raises_the_stored_day_score()
    {
        if (SkippedForMissingPostgres())
        {
            return;
        }

        await SeedSprayingDayAsync(AnsweredDate);
        await RecomputeAndCommitAsync(AnsweredDate);

        var before = await ReadStoredDayAsync(AnsweredDate);
        before.Score.Should().NotBeNull("the day has scorable work, so the farmer is shown a number");
        Coverage(before.Roster, "DOSE").Should().Be(0.0,
            "he sprayed but has not said with how much — DOSE is owed by the operation and unfilled, which is the gap Sathi asks about");

        var result = await RecordQuestionEventAsync("gap.dose", response: "250 ml", AnsweredDate);
        result.IsSuccess.Should().BeTrue("the command is both-approved and the caller owns the farm");

        var after = await ReadStoredDayAsync(AnsweredDate);

        after.Score.Should().BeGreaterThan(before.Score!.Value,
            "founder ruling A — the farmer answered Sathi, so the number he is looking at must go UP before he looks away");
        Coverage(after.Roster, "DOSE").Should().Be(1.0,
            "the rise must come from the dimension he actually answered, not from anything else moving");

        output.WriteLine("[EVIDENCE] === answering gap.dose raises the stored score (real Npgsql :5433) ===");
        output.WriteLine($"[EVIDENCE] stored score  before = {before.Score}  after = {after.Score}");
        output.WriteLine($"[EVIDENCE] DOSE coverage before = {Coverage(before.Roster, "DOSE")}  after = {Coverage(after.Roster, "DOSE")}");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PROOF 2 — HONESTY GUARD. An empty answer is silence, and silence never
    // scores (doctrine P4). Dismissing the card must not buy a point.
    // ─────────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task An_empty_answer_is_silence_and_must_not_raise_the_stored_day_score()
    {
        if (SkippedForMissingPostgres())
        {
            return;
        }

        await SeedSprayingDayAsync(SilentDate);
        await RecomputeAndCommitAsync(SilentDate);

        var before = await ReadStoredDayAsync(SilentDate);

        var result = await RecordQuestionEventAsync("gap.dose", response: null, SilentDate);
        result.IsSuccess.Should().BeTrue("the event is still recorded — telemetry is kept, it just earns nothing");

        var after = await ReadStoredDayAsync(SilentDate);

        after.Score.Should().Be(before.Score,
            "the farmer told us nothing, so the number must not move — a score that rewards dismissing the card is a fabricated number (P4)");
        Coverage(after.Roster, "DOSE").Should().Be(0.0, "DOSE is still unanswered");

        output.WriteLine("[EVIDENCE] === an empty answer earns nothing (real Npgsql :5433) ===");
        output.WriteLine($"[EVIDENCE] stored score  before = {before.Score}  after = {after.Score} (must be equal)");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Exercise paths — same write posture as the sibling DFES fixture: admin-elevate
    // so TenantConnectionInterceptor no-ops (no SET LOCAL prepend → no EF
    // rows-affected desync), then set the GUCs manually so RLS USING/WITH CHECK pass.
    // ─────────────────────────────────────────────────────────────────────────

    /// <summary>The REAL handler, exactly as the endpoint calls it.</summary>
    private async Task<AgriSync.BuildingBlocks.Results.Result<Guid>> RecordQuestionEventAsync(
        string questionKey, string? response, DateOnly localDate)
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
            CallerUserId: OwnerUserId, FarmId: FarmId, PlotId: PlotId, DailyLogId: null,
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

    /// <summary>Establishes the day's aggregate before the question is ever asked.</summary>
    private async Task RecomputeAndCommitAsync(DateOnly localDate)
    {
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        var ctx = sp.GetRequiredService<ShramSafalDbContext>();
        var tenant = sp.GetRequiredService<TenantContext>();
        var repo = sp.GetRequiredService<IShramSafalRepository>();
        var derivation = sp.GetRequiredService<IDailyRichnessDerivationService>();

        tenant.ElevateToAdminCrossTenant();
        await using var tx = await ctx.Database.BeginTransactionAsync();
        await SetGucsAsync(ctx);

        await derivation.RecomputeAsync(FarmId, localDate);
        await repo.SaveChangesAsync();
        await tx.CommitAsync();
    }

    /// <summary>
    /// A real day of work with an OPEN dose gap: one DailyLog carrying a Completed
    /// spraying task and nothing else. No SourceAiJobId, so the score is built from the
    /// farmer's own persisted rows via PersistedDayRootBuilder — the manual-entry path.
    /// </summary>
    private async Task SeedSprayingDayAsync(DateOnly localDate)
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
            idempotencyKey: $"dfes-answer-{localDate:yyyyMMdd}",
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
    // Read back from a FRESH raw connection — never the write context's identity
    // map — and roll the stored breakdown up EXACTLY as GetDayUnderstandingHandler
    // does, so "the stored score" here is the number the farmer is actually shown.
    // ─────────────────────────────────────────────────────────────────────────
    private sealed record StoredDay(int? Score, IReadOnlyList<ScoredDimension> Roster);

    private async Task<StoredDay> ReadStoredDayAsync(DateOnly localDate)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT components_json
            FROM ssf.daily_richness_aggregates
            WHERE farm_id = @farm AND local_date = @d
            """;
        cmd.Parameters.AddWithValue("farm", FarmId);
        cmd.Parameters.AddWithValue("d", localDate);
        await using var reader = await cmd.ExecuteReaderAsync();
        (await reader.ReadAsync()).Should().BeTrue("the aggregate row must exist for {0}", localDate);
        var json = reader.GetFieldValue<string>(0);

        var input = JsonSerializer.Deserialize<LensInput>(json);
        input.Should().NotBeNull("components_json must deserialize into the breakdown the read path rolls up");
        return new StoredDay(DayUnderstandingScore.From(input!), input!.Possible ?? []);
    }

    private static double Coverage(IReadOnlyList<ScoredDimension> roster, string name)
    {
        var dim = roster.SingleOrDefault(d => d.Name == name);
        dim.Should().NotBeNull("the stored roster must carry a {0} row for a spraying day", name);
        return dim!.Coverage;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Fixture helpers (seed as superuser — bypasses RLS).
    // ─────────────────────────────────────────────────────────────────────────
    private static async Task SeedFarmAsync(NpgsqlConnection db)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status)
            VALUES (@id, 'DFES Answer-Raises-Score Farm', @owner, @account, NOW(), NOW(), 3.0, 'Unchecked');
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
