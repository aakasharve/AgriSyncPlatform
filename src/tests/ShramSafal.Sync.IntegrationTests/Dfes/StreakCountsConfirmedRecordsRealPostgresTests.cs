// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT3a fix pass 1, B002; founder D-46)
using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Persistence; // TenantContext
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Domain.Logs;
using ShramSafal.Infrastructure;
using ShramSafal.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Dfes;

/// <summary>
/// spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT3a fix pass 1, B002) — the streak counts confirmed records
/// only, PINNED THROUGH THE REAL REPOSITORY AND DbContext. The in-memory double hands the recompute the live
/// <see cref="DailyLog"/> object, events and all, so it could not see that
/// <c>GetDailyLogsForFarmDateAsync</c> (an <c>AsNoTracking</c> read) never loaded <c>VerificationEvents</c>: every
/// record then folded to Draft and, on Postgres, no day ever advanced (review B001). Here the record is written in
/// one unit of work and the day is rebuilt in ANOTHER, so the confirmation can only be seen if the read loads it.
///
/// <para><b>Fixture.</b> Follows <see cref="DailyRichnessAggregateTrackedWriteTests"/> exactly: the
/// <c>RequiresPostgres</c> trait, its own scratch database (created, migrated, dropped), parents seeded as the
/// migration superuser, every write and the recompute run as <c>agrisync_app</c> under admin-elevate plus the manual
/// GUCs, the row re-read on a fresh raw connection. No phone number is needed or written.</para>
///
/// <para><b>Doctrine E3.</b> Every fact first asserts the code's connection role is neither superuser nor BYPASSRLS
/// (<c>rolsuper OR rolbypassrls = false</c>); a proof run as a bypassing role proves nothing.</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class StreakCountsConfirmedRecordsRealPostgresTests(Xunit.Abstractions.ITestOutputHelper output)
    : IAsyncLifetime
{
    private const string RoleVacuityGuardSql =
        "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user";

    private const string AppRoleUser = IntegrationPostgres.AppRoleUser;
    private static string AppRolePassword => IntegrationPostgres.AppRolePassword;

    private static readonly Guid FarmId = Guid.Parse("3a300000-0000-0000-0000-000000000001");
    private static readonly Guid OwnerUserId = Guid.Parse("3a300000-0000-0000-0000-000000000002");
    private static readonly Guid OwnerAccountId = Guid.Parse("3a300000-0000-0000-0000-000000000003");
    private static readonly Guid PlotId = Guid.Parse("3a300000-0000-0000-0000-000000000004");
    private static readonly Guid CropCycleId = Guid.Parse("3a300000-0000-0000-0000-000000000005");

    // One work day per fact, so the facts never share a day row. Past days (as the sibling fixture's), so the
    // client-date sanity check holds on any runner clock from then on.
    private static readonly DateOnly ConfirmedDay = new(2026, 7, 21);
    private static readonly DateOnly UnconfirmedDay = new(2026, 7, 22);
    private static readonly DateOnly DisputedDay = new(2026, 7, 23);
    private static readonly DateOnly ConfirmedLaterDay = new(2026, 7, 24);

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
        _scratchDbName = $"ssf_dfes_streak_{Guid.NewGuid():N}";
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

    private async Task GuardAsync()
    {
        if (_skip)
        {
            output.WriteLine($"[SKIPPED] {_skipReason} — NO DATABASE WAS EXERCISED; this run proves nothing.");
        }

        Skip.If(_skip, _skipReason);

        await using var db = new NpgsqlConnection(_appConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = RoleVacuityGuardSql;
        var superOrBypass = (bool)(await cmd.ExecuteScalarAsync())!;
        output.WriteLine($"[EVIDENCE] current_user='{AppRoleUser}' rolsuper OR rolbypassrls={superOrBypass} (REQUIRED: False)");
        superOrBypass.Should().BeFalse("doctrine E3: a proof run as a superuser or BYPASSRLS role proves nothing");
    }

    [SkippableFact]
    public async Task Confirmed_record_advances_its_day_through_the_real_repository()
    {
        await GuardAsync();

        await SeedWorkLogAsync(ConfirmedDay, log => Confirm(log));
        await RecomputeAsync(ConfirmedDay);

        (await ReadAdvancesStreakAsync(ConfirmedDay)).Should().BeTrue(
            "the record is मंजूर (Verified); the recompute must read its confirmation back from ssf.verification_events");
    }

    [SkippableFact]
    public async Task Unconfirmed_record_leaves_its_day_unadvanced()
    {
        await GuardAsync();

        await SeedWorkLogAsync(UnconfirmedDay, _ => { });
        await RecomputeAsync(UnconfirmedDay);

        var row = await ReadRowAsync(UnconfirmedDay);
        row.HasWork.Should().BeTrue("it is a real day of work: only the confirmation is missing");
        row.AdvancesStreak.Should().BeFalse("D-46: a day advances only on a confirmed record");
    }

    [SkippableFact]
    public async Task Disputed_record_leaves_its_day_unadvanced()
    {
        await GuardAsync();

        await SeedWorkLogAsync(DisputedDay, log =>
        {
            Confirm(log);
            log.Verify(Guid.NewGuid(), VerificationStatus.Disputed, "आकडा चुकीचा", AppRole.PrimaryOwner,
                new UserId(OwnerUserId), DateTime.UtcNow.AddSeconds(5));
        });
        await RecomputeAsync(DisputedDay);

        (await ReadAdvancesStreakAsync(DisputedDay)).Should().BeFalse("a शंका takes the record off its confirmation");
    }

    [SkippableFact]
    public async Task Confirmation_written_in_a_later_unit_of_work_advances_the_work_day()
    {
        await GuardAsync();

        var logId = await SeedWorkLogAsync(ConfirmedLaterDay, _ => { });
        await RecomputeAsync(ConfirmedLaterDay);
        (await ReadAdvancesStreakAsync(ConfirmedLaterDay)).Should().BeFalse();

        // The handler's own sequence: hold the record, decide, flush, rebuild the work day, flush, commit.
        await InTenantTransactionAsync(async sp =>
        {
            var repo = sp.GetRequiredService<IShramSafalRepository>();
            var log = await repo.GetDailyLogForChangeAsync(logId);
            log.Should().NotBeNull();
            Confirm(log!);
            await repo.SaveChangesAsync();

            await sp.GetRequiredService<IDailyRichnessDerivationService>().RecomputeAsync(FarmId, ConfirmedLaterDay);
            await repo.SaveChangesAsync();
        });

        (await ReadAdvancesStreakAsync(ConfirmedLaterDay)).Should().BeTrue();
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static void Confirm(DailyLog log) =>
        log.VerifyReachingTarget(VerificationStatus.Verified, null, AppRole.PrimaryOwner, new UserId(OwnerUserId),
            DateTime.UtcNow, targetEventId: Guid.NewGuid(), enRouteEventId: Guid.NewGuid());

    private async Task<Guid> SeedWorkLogAsync(DateOnly day, Action<DailyLog> decide)
    {
        var id = Guid.NewGuid();
        await InTenantTransactionAsync(async sp =>
        {
            var repo = sp.GetRequiredService<IShramSafalRepository>();
            var created = DateTime.UtcNow.AddMinutes(-5);
            var log = DailyLog.Create(
                id: id,
                farmId: new FarmId(FarmId),
                plotId: PlotId,
                cropCycleId: CropCycleId,
                operatorUserId: new UserId(OwnerUserId),
                logDate: day,
                idempotencyKey: $"it3a-streak-{day:yyyyMMdd}",
                location: null,
                createdAtUtc: created);
            log.AddTask(
                taskId: Guid.NewGuid(),
                activityType: "फवारणी",
                notes: null,
                occurredAtUtc: created,
                executionStatus: ExecutionStatus.Completed);
            decide(log);

            await repo.AddDailyLogAsync(log);
            await repo.SaveChangesAsync();
        });
        return id;
    }

    private Task RecomputeAsync(DateOnly day) => InTenantTransactionAsync(async sp =>
    {
        await sp.GetRequiredService<IDailyRichnessDerivationService>().RecomputeAsync(FarmId, day);
        await sp.GetRequiredService<IShramSafalRepository>().SaveChangesAsync();
    });

    // Write posture of DailyRichnessAggregateTrackedWriteTests: admin-elevate so TenantConnectionInterceptor no-ops,
    // then the GUCs set by hand so the RLS USING / WITH CHECK gates pass for agrisync_app.
    private async Task InTenantTransactionAsync(Func<IServiceProvider, Task> work)
    {
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        var ctx = sp.GetRequiredService<ShramSafalDbContext>();
        sp.GetRequiredService<TenantContext>().ElevateToAdminCrossTenant();
        await using var tx = await ctx.Database.BeginTransactionAsync();
        await ctx.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('agrisync.user_id', {OwnerUserId.ToString()}, true)");
        await ctx.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('agrisync.farm_id', {FarmId.ToString()}, true)");
        await ctx.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('agrisync.owner_account_id', {OwnerAccountId.ToString()}, true)");
        await work(sp);
        await tx.CommitAsync();
    }

    private sealed record DayRow(bool HasWork, bool AdvancesStreak, string DayClassification);

    private async Task<bool> ReadAdvancesStreakAsync(DateOnly day) => (await ReadRowAsync(day)).AdvancesStreak;

    // A FRESH raw connection, never the write context's identity map.
    private async Task<DayRow> ReadRowAsync(DateOnly day)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT has_work, advances_streak, day_classification
            FROM ssf.daily_richness_aggregates
            WHERE farm_id = @farm AND local_date = @d
            """;
        cmd.Parameters.AddWithValue("farm", FarmId);
        cmd.Parameters.AddWithValue("d", day);
        await using var reader = await cmd.ExecuteReaderAsync();
        (await reader.ReadAsync()).Should().BeTrue("the recompute must have written the row for {0}", day);
        var row = new DayRow(reader.GetBoolean(0), reader.GetBoolean(1), reader.GetString(2));
        output.WriteLine($"[EVIDENCE] {day:yyyy-MM-dd}: has_work={row.HasWork} advances_streak={row.AdvancesStreak} day_classification='{row.DayClassification}'");
        return row;
    }

    // ── parents, seeded as the migration superuser (the shapes of DailyRichnessAggregateTrackedWriteTests) ──

    private static async Task SeedFarmAsync(NpgsqlConnection db)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status)
            VALUES (@id, 'IT3a Streak Farm', @owner, @account, NOW(), NOW(), 3.0, 'Unchecked');
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
