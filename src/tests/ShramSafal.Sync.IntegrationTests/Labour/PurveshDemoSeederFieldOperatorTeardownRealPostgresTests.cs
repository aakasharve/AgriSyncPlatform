// spec: 2026-07-13-labour-attendance-approval-design
using System;
using System.Threading;
using System.Threading.Tasks;
using Accounts.Infrastructure.Persistence;
using AgriSync.Bootstrapper.Infrastructure;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using ShramSafal.Infrastructure.Persistence;
using User.Application.Ports;
using User.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Labour;

/// <summary>
/// Labour V1 Task 10.4b (spec: 2026-07-13-labour-attendance-approval-design) —
/// the demo-seeder teardown guard, which the plan's risk register names the
/// highest-likelihood regression in the project.
/// </summary>
/// <remarks>
/// <para>
/// <b>What is provable here, and what is not.</b> The seeder creates ZERO field
/// operators and ZERO work rows — both seed-key lists are deliberately empty
/// (founder-gated). So the teardown's identification set is empty, and on these
/// two tables it can only ever <i>throw or no-op</i>: there is no id it will
/// ever delete. That is zero deletion risk BY CONSTRUCTION, and it is the point
/// rather than a gap.
/// </para>
/// <para>
/// The consequence for coverage is stated plainly rather than papered over:
/// <b>the deletion/identification path is NOT proven here, because it is not
/// reachable.</b> No test in this class asserts that a seeded operator is
/// removed — writing one would require inventing a seeded row the production
/// code can never produce, which would prove the test's fiction and not the
/// seeder. If the founder later approves demo operators, that test becomes both
/// possible and mandatory. What IS proven:
/// <list type="number">
/// <item>a field operator on the demo farm aborts the teardown and is not
/// deleted;</item>
/// <item>a work row on the demo farm does the same, and is checked BEFORE
/// operators so real attribution can never be collateral;</item>
/// <item>FARM SCOPING — identity data on a farm the seeder does not own is
/// neither guarded against nor touched, so an unrelated farm's workers never
/// block or get caught up in the demo teardown.</item>
/// </list>
/// </para>
/// <para>
/// <b>The demo farm id is re-derived independently, on purpose</b> — not read
/// back from the seeder's private tables. If anyone changes the id-minting
/// expression, these tests fail, which is exactly the alarm you want on a code
/// path that runs against the founder's only real farm whenever
/// <c>CLEAR_PURVESH_DEMO=true</c>.
/// </para>
/// </remarks>
[Trait("Category", "RequiresPostgres")]
public sealed class PurveshDemoSeederFieldOperatorTeardownRealPostgresTests : IAsyncLifetime
{
    private const string SeedVersion = "purvesh-demo-v2";

    /// <summary>The demo farm the seeder owns — same expression as the seeder's.</summary>
    private static readonly Guid DemoFarmId =
        PurveshDemoSeeder.CreateDeterministicGuid($"{SeedVersion}:farm:khardi");

    private string _adminConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private string _superuserConn = string.Empty;

    private Guid _otherFarmId;
    private Guid _ownerUserId;

    public async Task InitializeAsync()
    {
        _adminConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();

        _scratchDbName = $"ssf_seeder_fo_teardown_{Guid.NewGuid():N}";
        await using (var admin = new NpgsqlConnection(_adminConn))
        {
            await admin.OpenAsync();
            await using var create = admin.CreateCommand();
            create.CommandText = $"CREATE DATABASE \"{_scratchDbName}\"";
            await create.ExecuteNonQueryAsync();
        }

        _superuserConn = new NpgsqlConnectionStringBuilder(_adminConn) { Database = _scratchDbName }.ConnectionString;
        await IntegrationMigrationChain.ApplyAsync(_superuserConn);

        _otherFarmId = Guid.NewGuid();
        _ownerUserId = Guid.NewGuid();

        await SeedFarmsAsync();
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

    /// <summary>
    /// THROW path. A real worker identity the seeder did not create is on the
    /// demo farm: the teardown must refuse, by name, and destroy nothing.
    /// </summary>
    [Fact]
    public async Task Clear_throws_and_deletes_nothing_when_a_non_seed_field_operator_is_on_the_demo_farm()
    {
        var realOperatorId = Guid.NewGuid();
        await InsertFieldOperatorAsync(realOperatorId, DemoFarmId, "रामू RealWorker");

        var seeder = CreateSeeder(out var disposables);
        try
        {
            var act = async () => await seeder.ClearPurveshDemoAsync(CancellationToken.None);

            (await act.Should().ThrowAsync<InvalidOperationException>(
                    "a field operator the seeder did not create is a real person's work identity"))
                .WithMessage($"*{PurveshDemoSeeder.NonSeedFieldOperatorDataMessage}*");

            (await CountFieldOperatorsAsync(realOperatorId)).Should().Be(1,
                "the guard must be the protection, not a prelude to deletion — the real operator survives");
            (await CountFarmsAsync(DemoFarmId)).Should().Be(1,
                "the throw happens before the first SaveChanges, so the demo farm itself is untouched too");
        }
        finally
        {
            await DisposeAllAsync(disposables);
        }
    }

    /// <summary>
    /// THROW path, work-row variant. The seeder creates ZERO work rows, so any
    /// work row on the demo farm is a real record of whose work it was.
    /// </summary>
    /// <remarks>
    /// This also pins the ORDER: work rows are checked before operators, so the
    /// teardown aborts while both are still intact. The production rule matches
    /// work rows on their OWN ids and never inherits "seeded" from the parent
    /// operator — with an empty seed list that distinction cannot be exercised
    /// end-to-end here, but the rule is what keeps a real attribution attached
    /// to a demo operator from being deleted as seed data if operators are ever
    /// seeded. Do not "simplify" it to a parent-id match.
    /// </remarks>
    [Fact]
    public async Task Clear_throws_on_a_work_row_and_leaves_both_it_and_its_operator_intact()
    {
        var operatorId = Guid.NewGuid();
        await InsertFieldOperatorAsync(operatorId, DemoFarmId, "बाळू RealWorker");
        var labourAssignmentId = await InsertDailyLogAndLabourAssignmentAsync(DemoFarmId);
        var workRowId = Guid.NewGuid();
        await InsertWorkRowAsync(workRowId, operatorId, labourAssignmentId, DemoFarmId);

        var seeder = CreateSeeder(out var disposables);
        try
        {
            var act = async () => await seeder.ClearPurveshDemoAsync(CancellationToken.None);

            (await act.Should().ThrowAsync<InvalidOperationException>(
                    "a work row records which real person did which real work"))
                .WithMessage($"*{PurveshDemoSeeder.NonSeedFieldOperatorDataMessage}*");

            (await CountWorkRowsAsync(workRowId)).Should().Be(1, "the real attribution survives");
            (await CountFieldOperatorsAsync(operatorId)).Should().Be(1,
                "and the parent identity is not deleted either — the whole teardown aborts "
                + "before the first flush");
        }
        finally
        {
            await DisposeAllAsync(disposables);
        }
    }

    /// <summary>
    /// FARM SCOPING. Identity data on a farm the seeder does not own must
    /// neither trip the guard nor be deleted: the demo teardown still completes
    /// and removes its own farm, while the stranger's operator and work row are
    /// untouched.
    /// </summary>
    /// <remarks>
    /// This is the half that keeps the guard from becoming a denial-of-service
    /// on the whole seeder: if the check were merely "does ANY field operator
    /// exist", one unrelated farm anywhere in the database would permanently
    /// block the demo teardown.
    /// </remarks>
    [Fact]
    public async Task Clear_completes_and_leaves_another_farms_identity_data_untouched()
    {
        var strangerId = Guid.NewGuid();
        await InsertFieldOperatorAsync(strangerId, _otherFarmId, "गणपत OtherFarm");

        var strangerAssignmentId = await InsertDailyLogAndLabourAssignmentAsync(_otherFarmId);
        var strangerWorkRowId = Guid.NewGuid();
        await InsertWorkRowAsync(strangerWorkRowId, strangerId, strangerAssignmentId, _otherFarmId);

        var seeder = CreateSeeder(out var disposables);
        try
        {
            await seeder.ClearPurveshDemoAsync(CancellationToken.None);

            (await CountFieldOperatorsAsync(strangerId)).Should().Be(1,
                "an operator on a farm the seeder does not own must never be touched");
            (await CountWorkRowsAsync(strangerWorkRowId)).Should().Be(1,
                "nor its attribution");

            (await CountFarmsAsync(DemoFarmId)).Should().Be(0,
                "with no identity data on the demo farm, the teardown runs to completion and the "
                + "demo farm deletes cleanly — another farm's workers must not block it");
            (await CountFarmsAsync(_otherFarmId)).Should().Be(1,
                "the unrelated farm survives");
        }
        finally
        {
            await DisposeAllAsync(disposables);
        }
    }

    // ── harness ──────────────────────────────────────────────────────────

    private PurveshDemoSeeder CreateSeeder(out IAsyncDisposable[] disposables)
    {
        var ssf = new ShramSafalDbContext(
            new DbContextOptionsBuilder<ShramSafalDbContext>().UseNpgsql(_superuserConn).Options);
        var user = new UserDbContext(
            new DbContextOptionsBuilder<UserDbContext>().UseNpgsql(_superuserConn).Options);
        var accounts = new AccountsDbContext(
            new DbContextOptionsBuilder<AccountsDbContext>().UseNpgsql(_superuserConn).Options);

        disposables = [ssf, user, accounts];
        return new PurveshDemoSeeder(ssf, user, accounts, new NoOpPasswordHasher());
    }

    private static async Task DisposeAllAsync(IAsyncDisposable[] disposables)
    {
        foreach (var d in disposables)
        {
            await d.DisposeAsync();
        }
    }

    /// <summary>ClearPurveshDemoAsync never hashes anything; this only satisfies the constructor.</summary>
    private sealed class NoOpPasswordHasher : IPasswordHasher
    {
        public string Hash(string plainText) => plainText;
        public bool Verify(string plainText, string hash) => plainText == hash;
    }

    private async Task SeedFarmsAsync()
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();

        foreach (var (farmId, name) in new[]
                 {
                     (DemoFarmId, "Purvesh Demo Farm"),
                     (_otherFarmId, "Someone Else's Farm"),
                 })
        {
            await using var c = db.CreateCommand();
            c.CommandText = """
                INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status)
                VALUES (@id, @name, @uid, @uid, NOW(), NOW(), 3.0, 'Unchecked');
                """;
            c.Parameters.AddWithValue("id", farmId);
            c.Parameters.AddWithValue("name", name);
            c.Parameters.AddWithValue("uid", _ownerUserId);
            await c.ExecuteNonQueryAsync();
        }
    }

    private async Task<Guid> InsertFieldOperatorAsync(Guid id, Guid farmId, string displayName)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var c = db.CreateCommand();
        c.CommandText = """
            INSERT INTO ssf.field_operators
                ("Id", display_name, display_name_normalized, full_name, originating_farm_id, created_by_user_id, created_at_utc, is_active)
            VALUES (@id, @dn, @dn, NULL, @fid, @uid, NOW(), TRUE);
            """;
        c.Parameters.AddWithValue("id", id);
        c.Parameters.AddWithValue("dn", displayName);
        c.Parameters.AddWithValue("fid", farmId);
        c.Parameters.AddWithValue("uid", _ownerUserId);
        await c.ExecuteNonQueryAsync();
        return id;
    }

    private async Task<Guid> InsertDailyLogAndLabourAssignmentAsync(Guid farmId)
    {
        var dailyLogId = Guid.NewGuid();
        var labourAssignmentId = Guid.NewGuid();

        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();

        await using (var c = db.CreateCommand())
        {
            c.CommandText = """
                INSERT INTO ssf.daily_logs ("Id", farm_id, plot_id, crop_cycle_id, plot_ids, scope, operator_user_id, log_date, created_at_utc, source, model_version, prompt_version)
                VALUES (@id, @fid, @pid, @cid, ARRAY[@pid], 'Plot', @uid, CURRENT_DATE, NOW(), 'voice', 'unknown', 'unknown');
                """;
            c.Parameters.AddWithValue("id", dailyLogId);
            c.Parameters.AddWithValue("fid", farmId);
            c.Parameters.AddWithValue("pid", Guid.NewGuid());
            c.Parameters.AddWithValue("cid", Guid.NewGuid());
            c.Parameters.AddWithValue("uid", _ownerUserId);
            await c.ExecuteNonQueryAsync();
        }

        await using (var c = db.CreateCommand())
        {
            c.CommandText = """
                INSERT INTO ssf.labour_assignments
                    ("Id", daily_log_id, engagement_type, worker_count, wage_per_person, total_cost, worker_names_json, created_at_utc, duration_hours, time_basis)
                VALUES (@id, @dlid, 'Hired', 8, 50, NULL, '[]'::jsonb, NOW(), 8, 'Assumed');
                """;
            c.Parameters.AddWithValue("id", labourAssignmentId);
            c.Parameters.AddWithValue("dlid", dailyLogId);
            await c.ExecuteNonQueryAsync();
        }

        return labourAssignmentId;
    }

    private async Task InsertWorkRowAsync(Guid id, Guid fieldOperatorId, Guid labourAssignmentId, Guid farmId)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var c = db.CreateCommand();
        c.CommandText = """
            INSERT INTO ssf.field_operator_work_rows
                ("Id", field_operator_id, labour_assignment_id, farm_id, work_date, display_name_at_attach, recorded_by_user_id, created_at_utc)
            VALUES (@id, @foid, @laid, @fid, CURRENT_DATE, 'बाळू', @uid, NOW());
            """;
        c.Parameters.AddWithValue("id", id);
        c.Parameters.AddWithValue("foid", fieldOperatorId);
        c.Parameters.AddWithValue("laid", labourAssignmentId);
        c.Parameters.AddWithValue("fid", farmId);
        c.Parameters.AddWithValue("uid", _ownerUserId);
        await c.ExecuteNonQueryAsync();
    }

    private Task<int> CountFieldOperatorsAsync(Guid id) =>
        CountAsync("SELECT count(*) FROM ssf.field_operators WHERE \"Id\" = @id", id);

    private Task<int> CountWorkRowsAsync(Guid id) =>
        CountAsync("SELECT count(*) FROM ssf.field_operator_work_rows WHERE \"Id\" = @id", id);

    private Task<int> CountFarmsAsync(Guid id) =>
        CountAsync("SELECT count(*) FROM ssf.farms WHERE \"Id\" = @id", id);

    private async Task<int> CountAsync(string sql, Guid id)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var c = db.CreateCommand();
        c.CommandText = sql;
        c.Parameters.AddWithValue("id", id);
        return Convert.ToInt32(await c.ExecuteScalarAsync());
    }
}
