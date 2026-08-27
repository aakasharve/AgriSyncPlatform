// spec: 2026-07-13-labour-attendance-approval-design
using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;
using NpgsqlTypes;
using ShramSafal.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Logs;

/// <summary>
/// LABOUR PHASE 2 — <b>the rollback refuses rather than fabricating.</b>
///
/// <para><b>The failure this prevents.</b> The scaffolded <c>Down()</c> for this
/// migration restores <c>NOT NULL</c> on <c>plot_id</c> and <c>crop_cycle_id</c>.
/// Applied to a database that already holds farm-wide or multi-plot rows, the
/// only way that statement can succeed is by writing SOME plot into those rows —
/// in practice <c>00000000-0000-0000-0000-000000000000</c>. It would land on
/// exactly the rows this migration exists to make honest, and it would look like
/// a successful rollback. Doctrine <c>P4</c>: a fabricated value that reaches a
/// farmer is worse than a refused operation. Plan §M states the rule in product
/// terms — rollback is "safe only while no plot-less rows exist; once they do,
/// rollback requires a documented decision about those rows".</para>
///
/// <para><b>Why "it threw" is not enough.</b> A <c>Down()</c> that raised its
/// refusal AFTER dropping the CHECK, or after dropping <c>scope</c>, would satisfy
/// a test that only asserts an exception — and would leave the database in a state
/// where the next dishonest row is accepted silently. So each refusal is followed
/// by an assertion that the schema is byte-for-byte still there: both columns still
/// nullable, <c>plot_ids</c>/<c>scope</c> still present, and
/// <c>ck_daily_logs_scope</c> still in <c>pg_constraint</c>.</para>
///
/// <para><b>Posture.</b> Fresh scratch database per [Fact] via
/// <see cref="IntegrationMigrationChain"/>. The rollback is executed against that
/// scratch database and nothing else — never <c>agrisync_dev_v2</c>, never
/// <c>dotnet ef database update</c>, never <c>make boot</c> (doctrine E5/F3).</para>
///
/// <para><b>Independence note.</b> Derived from plan §M / §I ("every
/// <c>Down()</c> EXECUTED, not merely written") and the P2.1 report's §11.7
/// #15/#16. The migration source was not read to decide the expected outcome;
/// <c>P0001</c> is the SQLSTATE a PL/pgSQL <c>RAISE EXCEPTION</c> produces, which
/// is what "refuses loudly" means in Postgres terms.</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class DailyLogScopeMigrationRollbackRealPostgresTests(Xunit.Abstractions.ITestOutputHelper output)
    : IAsyncLifetime
{
    /// <summary>The migration immediately BEFORE migration ①; rolling back to it executes ①'s Down().</summary>
    private const string TargetBeforeScopeMigration = "20260811112633_AddLabourCorrections";

    private const string ConstraintName = "ck_daily_logs_scope";

    private static readonly Guid FarmA = Guid.Parse("aaaa1111-1111-1111-1111-111111111111");
    private static readonly Guid OwnerAccountA = Guid.Parse("aaaa1112-1111-1111-1111-111111111111");
    private static readonly Guid OwnerA = Guid.Parse("aaaa1113-1111-1111-1111-111111111111");
    private static readonly Guid PlotA = Guid.Parse("aaaa1114-1111-1111-1111-111111111111");
    private static readonly Guid CycleA = Guid.Parse("aaaa1116-1111-1111-1111-111111111111");

    private string _adminConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private string _superuserConn = string.Empty;

    public async Task InitializeAsync()
    {
        _adminConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();

        _scratchDbName = $"ssf_scoperollback_{Guid.NewGuid():N}";
        await using (var admin = new NpgsqlConnection(_adminConn))
        {
            await admin.OpenAsync();
            await using var create = admin.CreateCommand();
            create.CommandText = $"CREATE DATABASE \"{_scratchDbName}\"";
            await create.ExecuteNonQueryAsync();
        }

        _superuserConn = new NpgsqlConnectionStringBuilder(_adminConn) { Database = _scratchDbName }.ConnectionString;
        await IntegrationMigrationChain.ApplyAsync(_superuserConn);

        await using var raw = new NpgsqlConnection(_superuserConn);
        await raw.OpenAsync();
        await SeedFarmAsync(raw, FarmA, OwnerA, OwnerAccountA, "Scope-Rollback Farm");
        await SeedPlotAsync(raw, PlotA, FarmA, "Plot A");
        await SeedCropCycleAsync(raw, CycleA, FarmA, PlotA, "Grapes", "Vegetative");
    }

    public async Task DisposeAsync()
    {
        if (string.IsNullOrEmpty(_scratchDbName) || string.IsNullOrEmpty(_adminConn))
        {
            return;
        }

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

    [Fact]
    public async Task Down_refuses_while_a_plot_less_row_exists_and_leaves_the_schema_untouched()
    {
        var farmLogId = Guid.Parse("bbbb0001-0000-0000-0000-000000000001");
        var plotLogId = Guid.Parse("bbbb0002-0000-0000-0000-000000000002");

        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await InsertLogAsync(db, farmLogId, "Farm", [], null, null);
        await InsertLogAsync(db, plotLogId, "Plot", [PlotA], PlotA, CycleA);

        var failure = await AttemptRollbackAsync();

        failure.Should().NotBeNull(
            "restoring NOT NULL over a farm-wide row can only succeed by inventing a plot the farmer never gave");
        failure!.SqlState.Should().Be("P0001",
            "the migration must refuse LOUDLY with its own raised exception — a rollback that quietly 'worked' " +
            "is how a fabricated 00000000-… plot reaches a farmer's record");
        output.WriteLine($"[EVIDENCE] refusal SQLSTATE={failure.SqlState} message={failure.MessageText}");

        // ── The refusal must be ATOMIC. A Down() that raised after dropping the
        //    CHECK would pass a test that only asserted "it threw", and would
        //    leave the next dishonest row storable with nobody looking.
        var nullability = await ReadColumnNullabilityAsync(db);
        nullability["plot_id"].Should().Be("YES", "the refused rollback must not have restored NOT NULL");
        nullability["crop_cycle_id"].Should().Be("YES");
        nullability.Should().ContainKey("plot_ids", "the refused rollback must not have dropped the canonical set");
        nullability.Should().ContainKey("scope", "nor the discriminator");

        var constraintCount = Convert.ToInt64(await ScalarAsync(db,
            "SELECT COUNT(*) FROM pg_constraint WHERE conname = @name", ("name", ConstraintName)));
        constraintCount.Should().Be(1,
            $"{ConstraintName} must SURVIVE a refused rollback — this is the assertion the earlier rehearsal did not make, " +
            "and without it a half-executed Down() disables the whole guarantee while reporting a failure");

        // ── And nothing was fabricated on the way out.
        var fabricated = Convert.ToInt64(await ScalarAsync(db, """
            SELECT COUNT(*) FROM ssf.daily_logs
            WHERE plot_id = '00000000-0000-0000-0000-000000000000'
               OR crop_cycle_id = '00000000-0000-0000-0000-000000000000'
               OR '00000000-0000-0000-0000-000000000000' = ANY(plot_ids)
            """));
        fabricated.Should().Be(0, "doctrine P4 — a sentinel plot is a fabricated number wearing a plot's costume");

        var surviving = Convert.ToInt64(await ScalarAsync(db, "SELECT COUNT(*) FROM ssf.daily_logs"));
        surviving.Should().Be(2, "both the farm-wide row and the plot row must still be there, unaltered");

        var stillFarmScoped = (string?)await ScalarAsync(db,
            "SELECT scope FROM ssf.daily_logs WHERE \"Id\" = @id", ("id", farmLogId));
        stillFarmScoped.Should().Be("Farm", "the farmer's assertion is untouched by a refused rollback");

        output.WriteLine($"[EVIDENCE] after refusal: plot_id nullable={nullability["plot_id"]} " +
                         $"{ConstraintName} present={constraintCount == 1} rows={surviving} fabricated={fabricated}");
    }

    [Fact]
    public async Task Down_succeeds_once_the_plot_less_rows_are_gone_and_Up_reclassifies_cleanly()
    {
        var farmLogId = Guid.Parse("bbbb0003-0000-0000-0000-000000000003");
        var plotLogId = Guid.Parse("bbbb0004-0000-0000-0000-000000000004");

        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await InsertLogAsync(db, farmLogId, "Farm", [], null, null);
        await InsertLogAsync(db, plotLogId, "Plot", [PlotA], PlotA, CycleA);

        (await AttemptRollbackAsync()).Should().NotBeNull("the refusal is the precondition of this test");

        // The documented decision the plan demands: somebody decides what happens
        // to the plot-less rows. Here, deleting them.
        await using (var delete = db.CreateCommand())
        {
            delete.CommandText = "DELETE FROM ssf.daily_logs WHERE plot_id IS NULL OR crop_cycle_id IS NULL";
            await delete.ExecuteNonQueryAsync();
        }

        var secondAttempt = await AttemptRollbackAsync();
        secondAttempt.Should().BeNull("with no plot-less row left, the rollback fabricates nothing and must proceed");

        var afterDown = await ReadColumnNullabilityAsync(db);
        afterDown["plot_id"].Should().Be("NO", "Down() restores the pre-Phase-2 shape");
        afterDown["crop_cycle_id"].Should().Be("NO");
        afterDown.Should().NotContainKey("plot_ids", "the canonical set column is removed by the rollback");
        afterDown.Should().NotContainKey("scope");
        Convert.ToInt64(await ScalarAsync(db,
            "SELECT COUNT(*) FROM pg_constraint WHERE conname = @name", ("name", ConstraintName)))
            .Should().Be(0, "the CHECK goes with the columns it constrains");

        output.WriteLine("[EVIDENCE] Down() executed — schema is back at " + TargetBeforeScopeMigration);

        // ── Re-apply. The classification of pre-existing rows must be
        //    deterministic, not inferred: plot_ids = ARRAY[plot_id], scope = 'Plot'.
        await using (var ssf = NewDbContext())
        {
            await ssf.Database.MigrateAsync();
        }

        Convert.ToInt64(await ScalarAsync(db,
            "SELECT COUNT(*) FROM pg_constraint WHERE conname = @name", ("name", ConstraintName)))
            .Should().Be(1, $"{ConstraintName} must come back with the columns");

        var misclassified = Convert.ToInt64(await ScalarAsync(db, """
            SELECT COUNT(*) FROM ssf.daily_logs
            WHERE scope <> 'Plot' OR plot_ids <> ARRAY[plot_id] OR plot_id IS NULL OR crop_cycle_id IS NULL
            """));
        misclassified.Should().Be(0,
            "the surviving legacy row's plot_id and crop_cycle_id already PROVE its meaning — classification is " +
            "deterministic, never a reconstruction of missing farmer intent");

        var survivingScope = (string?)await ScalarAsync(db,
            "SELECT scope FROM ssf.daily_logs WHERE \"Id\" = @id", ("id", plotLogId));
        survivingScope.Should().Be("Plot");

        output.WriteLine($"[EVIDENCE] Up() re-applied — misclassified rows = {misclassified} (expect 0)");
    }

    // ─────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Built EXACTLY as <see cref="IntegrationMigrationChain"/> builds it — plain
    /// <c>UseNpgsql(conn)</c>, no history-table override. A context that names a
    /// different migrations-history table sees ZERO applied migrations and
    /// silently tries to migrate UP from empty, which fails deep inside an
    /// unrelated 2026-02 migration and looks like a rollback defect.
    /// </summary>
    private ShramSafalDbContext NewDbContext()
        => new(new DbContextOptionsBuilder<ShramSafalDbContext>().UseNpgsql(_superuserConn).Options);

    /// <summary>Executes migration ①'s Down(); returns the PostgresException it raised, or null on success.</summary>
    private async Task<PostgresException?> AttemptRollbackAsync()
    {
        try
        {
            await using var ssf = NewDbContext();
            await ssf.Database.GetService<IMigrator>().MigrateAsync(TargetBeforeScopeMigration);
            return null;
        }
        catch (Exception ex)
        {
            for (Exception? current = ex; current is not null; current = current.InnerException)
            {
                if (current is PostgresException pg)
                {
                    return pg;
                }
            }

            throw;
        }
    }

    private static async Task InsertLogAsync(
        NpgsqlConnection db, Guid logId, string scope, Guid[] plotIds, Guid? plotId, Guid? cropCycleId)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.daily_logs
                ("Id", farm_id, plot_id, crop_cycle_id, plot_ids, scope, operator_user_id,
                 log_date, created_at_utc, source, model_version, prompt_version)
            VALUES
                (@id, @fid, @plot, @cycle, @plotIds, @scope, @op,
                 CURRENT_DATE, NOW(), 'pre_spine', 'unknown', 'unknown');
            """;
        cmd.Parameters.AddWithValue("id", logId);
        cmd.Parameters.AddWithValue("fid", FarmA);
        cmd.Parameters.Add(new NpgsqlParameter("plot", NpgsqlDbType.Uuid) { Value = (object?)plotId ?? DBNull.Value });
        cmd.Parameters.Add(new NpgsqlParameter("cycle", NpgsqlDbType.Uuid) { Value = (object?)cropCycleId ?? DBNull.Value });
        cmd.Parameters.Add(new NpgsqlParameter("plotIds", NpgsqlDbType.Array | NpgsqlDbType.Uuid) { Value = plotIds });
        cmd.Parameters.AddWithValue("scope", scope);
        cmd.Parameters.AddWithValue("op", OwnerA);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task<Dictionary<string, string>> ReadColumnNullabilityAsync(NpgsqlConnection db)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT column_name, is_nullable
            FROM information_schema.columns
            WHERE table_schema = 'ssf' AND table_name = 'daily_logs'
              AND column_name IN ('plot_id', 'crop_cycle_id', 'plot_ids', 'scope')
            """;

        var result = new Dictionary<string, string>(StringComparer.Ordinal);
        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            result[reader.GetString(0)] = reader.GetString(1);
        }

        return result;
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

        var scalar = await cmd.ExecuteScalarAsync();
        return scalar is DBNull ? null : scalar;
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

    private static async Task SeedPlotAsync(NpgsqlConnection db, Guid plotId, Guid farmId, string name)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.plots ("Id", farm_id, name, area_in_acres, created_at_utc, modified_at_utc)
            VALUES (@id, @farm, @name, 1.0, NOW(), NOW());
            """;
        cmd.Parameters.AddWithValue("id", plotId);
        cmd.Parameters.AddWithValue("farm", farmId);
        cmd.Parameters.AddWithValue("name", name);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task SeedCropCycleAsync(
        NpgsqlConnection db, Guid cycleId, Guid farmId, Guid plotId, string crop, string stage)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.crop_cycles ("Id", farm_id, plot_id, crop_name, stage, start_date, created_at_utc, modified_at_utc)
            VALUES (@id, @farm, @plot, @crop, @stage, @start, NOW(), NOW());
            """;
        cmd.Parameters.AddWithValue("id", cycleId);
        cmd.Parameters.AddWithValue("farm", farmId);
        cmd.Parameters.AddWithValue("plot", plotId);
        cmd.Parameters.AddWithValue("crop", crop);
        cmd.Parameters.AddWithValue("stage", stage);
        cmd.Parameters.AddWithValue("start", new DateTime(2026, 1, 1));
        await cmd.ExecuteNonQueryAsync();
    }
}
