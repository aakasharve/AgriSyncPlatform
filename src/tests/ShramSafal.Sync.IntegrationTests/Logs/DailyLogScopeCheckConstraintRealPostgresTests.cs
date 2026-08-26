// spec: 2026-07-13-labour-attendance-approval-design
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using NpgsqlTypes;
using ShramSafal.Domain.Logs;
using ShramSafal.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Logs;

/// <summary>
/// LABOUR PHASE 2 — <b>the database refuses a dishonest row.</b>
///
/// <para><b>What is being guarded.</b> <c>ck_daily_logs_scope</c>, as specified
/// in the approved plan §C1-AMENDED (PATCHED 2026-08-12):</para>
/// <code>
/// (scope = 'Plot'      AND cardinality(plot_ids) = 1  AND plot_id IS NOT NULL
///                      AND crop_cycle_id IS NOT NULL  AND plot_ids[1] = plot_id)
/// OR (scope = 'MultiPlot' AND cardinality(plot_ids) &gt;= 2 AND plot_id IS NULL AND crop_cycle_id IS NULL)
/// OR (scope = 'Farm'      AND cardinality(plot_ids) = 0  AND plot_id IS NULL AND crop_cycle_id IS NULL)
/// </code>
///
/// <para><b>Why the rejections are asserted by SQLSTATE and constraint name.</b>
/// "The insert threw" is not the claim. A NOT NULL violation, a type error or a
/// typo in the fixture would all throw, and a test that only asserts failure
/// would keep passing after somebody deletes the CHECK. Each case below asserts
/// <c>23514</c> (<c>check_violation</c>) naming <c>ck_daily_logs_scope</c> — the
/// constraint doing the refusing, by name.</para>
///
/// <para><b>Why the valid shapes are asserted too.</b> Ten rejection tests can
/// all pass against a predicate that rejects EVERYTHING. The acceptance case is
/// what stops an over-tightening from looking like a success.</para>
///
/// <para><b>Two clauses have no other guard anywhere.</b>
/// <c>crop_cycle_id IS NOT NULL</c> and <c>plot_ids[1] = plot_id</c> on the Plot
/// branch are unreachable through EF — the entity writes both columns from one
/// consistent object — so ONLY raw SQL can prove them, and only a raw-SQL test
/// can stop a future "simplification" from dropping them silently.</para>
///
/// <para><b>Also load-bearing, per the plan:</b> <c>plot_ids</c>'s column-level
/// <c>NOT NULL</c> is what makes this CHECK work at all. <c>cardinality(NULL)</c>
/// is NULL, the branch evaluates to NULL, and a CHECK treats NULL as SATISFIED —
/// so a future <c>DROP NOT NULL</c> on <c>plot_ids</c> would silently disable the
/// whole constraint while looking harmless. That is asserted directly below.</para>
///
/// <para><b>Posture.</b> Fresh scratch database per [Fact] via
/// <see cref="IntegrationMigrationChain"/>; never <c>agrisync_dev_v2</c>, never
/// <c>dotnet ef database update</c>, never <c>make boot</c>. These are CHECK-constraint
/// proofs, not RLS proofs, so the fixture connects as the migration superuser
/// exactly as the sibling schema suites do — a CHECK binds the superuser too,
/// which is precisely why it is the right place for this guarantee. (No RLS claim
/// is made anywhere in this file, so doctrine E3's as-<c>agrisync_app</c> rule has
/// nothing to apply to; the write-path suite that DOES make such claims asserts
/// the vacuity guard first.)</para>
///
/// <para><b>Independence note.</b> Every expectation is derived from the plan's
/// predicate and the handoff §1 intent table, plus the P2.1 report §11.7 list of
/// behaviours owed a guard. No migration source was read to decide what the
/// expected outcome is.</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class DailyLogScopeCheckConstraintRealPostgresTests(Xunit.Abstractions.ITestOutputHelper output)
    : IAsyncLifetime
{
    private const string ConstraintName = "ck_daily_logs_scope";

    private static readonly Guid FarmA = Guid.Parse("aaaa1111-1111-1111-1111-111111111111");
    private static readonly Guid OwnerAccountA = Guid.Parse("aaaa1112-1111-1111-1111-111111111111");
    private static readonly Guid OwnerA = Guid.Parse("aaaa1113-1111-1111-1111-111111111111");
    private static readonly Guid PlotA = Guid.Parse("aaaa1114-1111-1111-1111-111111111111");
    private static readonly Guid PlotB = Guid.Parse("aaaa1115-1111-1111-1111-111111111111");
    private static readonly Guid CycleA = Guid.Parse("aaaa1116-1111-1111-1111-111111111111");

    private string _adminConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private string _superuserConn = string.Empty;

    public async Task InitializeAsync()
    {
        _adminConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();

        _scratchDbName = $"ssf_scopecheck_{Guid.NewGuid():N}";
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
        await SeedFarmAsync(raw, FarmA, OwnerA, OwnerAccountA, "Scope-Check Farm A");
        await SeedPlotAsync(raw, PlotA, FarmA, "Plot A");
        await SeedPlotAsync(raw, PlotB, FarmA, "Plot B");
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

    // ─────────────────────────────────────────────────────────────────────
    // THE REJECTIONS — all ten, each proved to be ck_daily_logs_scope's doing.
    // ─────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task Every_dishonest_scope_combination_is_rejected_by_the_named_check_constraint()
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();

        var cases = new (string Label, string Scope, Guid[] PlotIds, Guid? PlotId, Guid? CropCycleId)[]
        {
            // A Farm log must not carry a plot in EITHER column.
            ("Farm carrying a plot_id", "Farm", [], PlotA, null),
            ("Farm carrying a non-empty plot_ids", "Farm", [PlotA], null, null),

            // A Plot log must carry EXACTLY one plot, in both columns, with a cycle.
            ("Plot with an empty plot_ids", "Plot", [], PlotA, CycleA),
            ("Plot with plot_id NULL", "Plot", [PlotA], null, CycleA),
            ("Plot with crop_cycle_id NULL", "Plot", [PlotA], PlotA, null),
            ("Plot whose plot_ids[1] differs from plot_id", "Plot", [PlotB], PlotA, CycleA),
            ("Plot carrying two plots", "Plot", [PlotA, PlotB], PlotA, CycleA),

            // A MultiPlot log is several plots and NOTHING single-valued.
            ("MultiPlot carrying a crop_cycle_id", "MultiPlot", [PlotA, PlotB], null, CycleA),
            ("MultiPlot carrying a plot_id", "MultiPlot", [PlotA, PlotB], PlotA, null),
            ("MultiPlot with only one plot", "MultiPlot", [PlotA], null, null),

            // A scope nobody defined is not a farmer assertion at all.
            ("an unrecognised scope string", "Plotwise", [PlotA], PlotA, CycleA),
        };

        var observed = new List<string>();
        foreach (var (label, scope, plotIds, plotId, cropCycleId) in cases)
        {
            var thrown = await CaptureInsertFailureAsync(db, scope, plotIds, plotId, cropCycleId);

            thrown.Should().NotBeNull($"'{label}' asserts something the farmer never said and must not be storable");
            observed.Add($"{label,-46} SQLSTATE={thrown!.SqlState} constraint={thrown.ConstraintName}");

            thrown.SqlState.Should().Be(PostgresErrorCodes.CheckViolation,
                $"'{label}' must be refused by a CHECK (23514) — not incidentally by a NOT NULL or a type error, " +
                "which would keep passing after somebody deleted the constraint");
            thrown.ConstraintName.Should().Be(ConstraintName,
                $"'{label}' must be refused by {ConstraintName} BY NAME — that is the guarantee, not merely 'an error happened'");
        }

        output.WriteLine("[EVIDENCE] === ck_daily_logs_scope rejections (real Npgsql, scratch DB) ===");
        observed.ForEach(output.WriteLine);
        observed.Should().HaveCount(11, "every listed dishonest combination must have been exercised");
    }

    // ─────────────────────────────────────────────────────────────────────
    // THE ACCEPTANCE COUNTERPART — a predicate that rejects everything would
    // pass every test above while making the table unusable.
    // ─────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task The_three_honest_shapes_are_still_storable()
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();

        var plot = await CaptureInsertFailureAsync(db, "Plot", [PlotA], PlotA, CycleA);
        var multiPlot = await CaptureInsertFailureAsync(db, "MultiPlot", [PlotA, PlotB], null, null);
        var farm = await CaptureInsertFailureAsync(db, "Farm", [], null, null);

        plot.Should().BeNull("the farmer chose one plot — {A} / A / cycle set");
        multiPlot.Should().BeNull("the farmer chose several plots — {A,B} / NULL / NULL");
        farm.Should().BeNull("the farmer chose संपूर्ण शेत — {} / NULL / NULL, an empty set and never a sentinel");

        var stored = await ReadScopesAsync(db);
        stored.Should().BeEquivalentTo(new[] { "Farm", "MultiPlot", "Plot" },
            "all three assertions must survive as themselves");

        output.WriteLine("[EVIDENCE] stored scopes = " + string.Join(",", stored));
    }

    /// <summary>
    /// The plan records this as load-bearing so nobody "simplifies" it later:
    /// with <c>plot_ids</c> nullable, <c>cardinality(NULL)</c> is NULL, every
    /// branch evaluates to NULL, and a CHECK treats NULL as SATISFIED — the
    /// constraint would still be listed in <c>pg_constraint</c> while enforcing
    /// nothing.
    /// </summary>
    [Fact]
    public async Task The_plot_set_column_is_NOT_NULL_which_is_what_makes_the_check_enforceable()
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();

        var nullability = await ReadColumnNullabilityAsync(db);

        nullability["plot_ids"].Should().Be("NO",
            "a nullable plot_ids silently disables the ENTIRE constraint while looking harmless, " +
            "because a CHECK evaluating to NULL is treated as satisfied");
        nullability["scope"].Should().Be("NO", "the discriminator is the farmer's assertion; it is never absent");
        nullability["plot_id"].Should().Be("YES", "a plot-less log genuinely has no plot — that is the point of Phase 2");
        nullability["crop_cycle_id"].Should().Be("YES", "and no crop cycle");

        var constraintExists = await ScalarAsync(db,
            "SELECT COUNT(*) FROM pg_constraint WHERE conname = @name", ("name", ConstraintName));
        Convert.ToInt64(constraintExists).Should().Be(1, $"{ConstraintName} must exist on a freshly migrated database");
    }

    // ─────────────────────────────────────────────────────────────────────
    // §11.7 #19 — plot_ids is a uuid[] mapped as a PrimitiveCollection. That
    // is exactly the kind of mapping that works in memory and fails against a
    // real driver, so all three scopes round-trip through EF and real Npgsql.
    // ─────────────────────────────────────────────────────────────────────
    [Fact]
    public async Task All_three_scopes_round_trip_through_EF_and_real_Npgsql()
    {
        var plotLogId = Guid.Parse("cccc0001-0000-0000-0000-000000000001");
        var multiPlotLogId = Guid.Parse("cccc0002-0000-0000-0000-000000000002");
        var farmLogId = Guid.Parse("cccc0003-0000-0000-0000-000000000003");
        var createdAtUtc = new DateTime(2026, 8, 12, 6, 30, 0, DateTimeKind.Utc);
        var logDate = new DateOnly(2026, 8, 12);

        await using (var write = NewDbContext())
        {
            write.Set<DailyLog>().Add(DailyLog.Create(
                id: plotLogId, farmId: new FarmId(FarmA), plotId: PlotA, cropCycleId: CycleA,
                operatorUserId: new UserId(OwnerA), logDate: logDate,
                idempotencyKey: null, location: null, createdAtUtc: createdAtUtc));
            write.Set<DailyLog>().Add(DailyLog.CreateForMultiPlot(
                id: multiPlotLogId, farmId: new FarmId(FarmA), plotIds: new[] { PlotA, PlotB },
                operatorUserId: new UserId(OwnerA), logDate: logDate,
                idempotencyKey: null, location: null, createdAtUtc: createdAtUtc));
            write.Set<DailyLog>().Add(DailyLog.CreateForFarm(
                id: farmLogId, farmId: new FarmId(FarmA),
                operatorUserId: new UserId(OwnerA), logDate: logDate,
                idempotencyKey: null, location: null, createdAtUtc: createdAtUtc));

            await write.SaveChangesAsync();
        }

        await using (var read = NewDbContext())
        {
            var plotLog = await read.Set<DailyLog>().AsNoTracking().SingleAsync(l => l.Id == plotLogId);
            var multiPlotLog = await read.Set<DailyLog>().AsNoTracking().SingleAsync(l => l.Id == multiPlotLogId);
            var farmLog = await read.Set<DailyLog>().AsNoTracking().SingleAsync(l => l.Id == farmLogId);

            plotLog.Scope.Should().Be(DailyLogScope.Plot);
            plotLog.PlotIds.Should().BeEquivalentTo(new[] { PlotA });
            plotLog.PlotId.Should().Be(PlotA);
            plotLog.CropCycleId.Should().Be(CycleA);

            multiPlotLog.Scope.Should().Be(DailyLogScope.MultiPlot);
            multiPlotLog.PlotIds.Should().BeEquivalentTo(new[] { PlotA, PlotB },
                "the whole selection must survive the uuid[] mapping — an empty or truncated set would silently " +
                "turn a multi-plot engagement into something the farmer never said");
            multiPlotLog.PlotId.Should().BeNull();
            multiPlotLog.CropCycleId.Should().BeNull();

            farmLog.Scope.Should().Be(DailyLogScope.Farm);
            farmLog.PlotIds.Should().BeEmpty();
            farmLog.PlotId.Should().BeNull();
            farmLog.CropCycleId.Should().BeNull();
        }

        // And the same three facts as the SERVER stored them — an EF round trip
        // that never reaches the column would agree with itself perfectly.
        await using var raw = new NpgsqlConnection(_superuserConn);
        await raw.OpenAsync();
        var rows = await ReadScopeRowsAsync(raw);

        rows[plotLogId].Scope.Should().Be("Plot");
        rows[plotLogId].PlotIds.Should().BeEquivalentTo(new[] { PlotA });
        rows[multiPlotLogId].Scope.Should().Be("MultiPlot");
        rows[multiPlotLogId].PlotIds.Should().BeEquivalentTo(new[] { PlotA, PlotB });
        rows[multiPlotLogId].PlotId.Should().BeNull();
        rows[farmLogId].Scope.Should().Be("Farm");
        rows[farmLogId].PlotIds.Should().BeEmpty("संपूर्ण शेत is cardinality zero in the row itself");

        foreach (var (id, row) in rows)
        {
            output.WriteLine(
                $"[EVIDENCE] {id} scope={row.Scope,-9} plot_ids=[{string.Join(",", row.PlotIds)}] " +
                $"plot_id={row.PlotId?.ToString() ?? "NULL"} crop_cycle_id={row.CropCycleId?.ToString() ?? "NULL"}");
        }
    }

    // ─────────────────────────────────────────────────────────────────────
    // Helpers.
    // ─────────────────────────────────────────────────────────────────────

    private ShramSafalDbContext NewDbContext()
    {
        var options = new DbContextOptionsBuilder<ShramSafalDbContext>()
            .UseNpgsql(_superuserConn, npgsql => npgsql.MigrationsHistoryTable("__ef_migrations", "ssf"))
            .Options;
        return new ShramSafalDbContext(options);
    }

    /// <summary>Inserts one raw row and returns the PostgresException it raised, or null when it was accepted.</summary>
    private async Task<PostgresException?> CaptureInsertFailureAsync(
        NpgsqlConnection db, string scope, Guid[] plotIds, Guid? plotId, Guid? cropCycleId)
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
        cmd.Parameters.AddWithValue("id", Guid.NewGuid());
        cmd.Parameters.AddWithValue("fid", FarmA);
        cmd.Parameters.Add(new NpgsqlParameter("plot", NpgsqlDbType.Uuid) { Value = (object?)plotId ?? DBNull.Value });
        cmd.Parameters.Add(new NpgsqlParameter("cycle", NpgsqlDbType.Uuid) { Value = (object?)cropCycleId ?? DBNull.Value });
        cmd.Parameters.Add(new NpgsqlParameter("plotIds", NpgsqlDbType.Array | NpgsqlDbType.Uuid) { Value = plotIds });
        cmd.Parameters.AddWithValue("scope", scope);
        cmd.Parameters.AddWithValue("op", OwnerA);

        try
        {
            await cmd.ExecuteNonQueryAsync();
            return null;
        }
        catch (PostgresException ex)
        {
            return ex;
        }
    }

    private sealed record ScopeRow(string Scope, Guid[] PlotIds, Guid? PlotId, Guid? CropCycleId);

    private static async Task<Dictionary<Guid, ScopeRow>> ReadScopeRowsAsync(NpgsqlConnection db)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT "Id", scope, plot_ids, plot_id, crop_cycle_id
            FROM ssf.daily_logs
            ORDER BY "Id"
            """;

        var rows = new Dictionary<Guid, ScopeRow>();
        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            rows[reader.GetGuid(0)] = new ScopeRow(
                reader.GetString(1),
                reader.GetFieldValue<Guid[]>(2),
                reader.IsDBNull(3) ? null : reader.GetGuid(3),
                reader.IsDBNull(4) ? null : reader.GetGuid(4));
        }

        return rows;
    }

    private static async Task<string[]> ReadScopesAsync(NpgsqlConnection db)
    {
        var rows = await ReadScopeRowsAsync(db);
        return rows.Values.Select(r => r.Scope).OrderBy(s => s, StringComparer.Ordinal).ToArray();
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

        return await cmd.ExecuteScalarAsync();
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
