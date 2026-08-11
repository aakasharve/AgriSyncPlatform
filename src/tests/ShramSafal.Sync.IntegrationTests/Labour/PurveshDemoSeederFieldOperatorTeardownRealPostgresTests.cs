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
/// <b>Why both halves are mandatory.</b> A throw-only test proves only that
/// SOMETHING stops an unscoped delete; it says nothing about whether the
/// scoping RULE is right. A wrong identification rule — matching work rows by
/// their parent operator, say, or treating every row on the farm as
/// seeder-owned — deletes real people's identities while still passing a
/// throw-only test. So this class proves BOTH:
/// <list type="number">
/// <item>the THROW path — a non-seed operator on the demo farm makes
/// <c>ClearPurveshDemoAsync</c> fail loudly and delete NOTHING; and</item>
/// <item>the IDENTIFICATION path — a genuinely seeder-created operator IS
/// removed, while an operator the seeder did not create survives untouched.</item>
/// </list>
/// </para>
/// <para>
/// <b>The deterministic ids below are re-derived independently, on purpose.</b>
/// They are not read back from the seeder's private seed table. If anyone
/// changes the id-minting expression on either the creation or the teardown
/// side, these tests fail — which is exactly the alarm you want on a code path
/// that runs against the founder's only real farm whenever
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

    /// <summary>A field operator the seeder genuinely creates (seed key "balu").</summary>
    private static readonly Guid SeededFieldOperatorId =
        PurveshDemoSeeder.CreateDeterministicGuid($"{SeedVersion}:field-operator:balu");

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
    /// work row is a real record of whose work it was. Critically, this one is
    /// attached to a SEEDED operator — proving work rows are identified by
    /// their OWN ids and never inherited from their parent, which is the
    /// mistake that would delete real attribution.
    /// </summary>
    [Fact]
    public async Task Clear_throws_on_a_real_work_row_even_when_its_parent_operator_was_seeder_created()
    {
        await InsertFieldOperatorAsync(SeededFieldOperatorId, DemoFarmId, "बाळू");
        var labourAssignmentId = await InsertDailyLogAndLabourAssignmentAsync(DemoFarmId);
        var workRowId = Guid.NewGuid();
        await InsertWorkRowAsync(workRowId, SeededFieldOperatorId, labourAssignmentId, DemoFarmId);

        var seeder = CreateSeeder(out var disposables);
        try
        {
            var act = async () => await seeder.ClearPurveshDemoAsync(CancellationToken.None);

            (await act.Should().ThrowAsync<InvalidOperationException>(
                    "a work row records which real person did which real work, whoever its parent is"))
                .WithMessage($"*{PurveshDemoSeeder.NonSeedFieldOperatorDataMessage}*");

            (await CountWorkRowsAsync(workRowId)).Should().Be(1, "the real attribution survives");
            (await CountFieldOperatorsAsync(SeededFieldOperatorId)).Should().Be(1,
                "and the seeded parent is not deleted either — the whole teardown aborts");
        }
        finally
        {
            await DisposeAllAsync(disposables);
        }
    }

    /// <summary>
    /// IDENTIFICATION path. With the guard untripped, the operator the seeder
    /// genuinely created IS removed — and an operator on a different farm,
    /// which the seeder does not own, is left completely alone.
    /// </summary>
    [Fact]
    public async Task Clear_removes_the_seeded_operator_and_leaves_a_non_seed_operator_on_another_farm_untouched()
    {
        await InsertFieldOperatorAsync(SeededFieldOperatorId, DemoFarmId, "बाळू");

        var strangerId = Guid.NewGuid();
        await InsertFieldOperatorAsync(strangerId, _otherFarmId, "गणपत OtherFarm");

        // The sharpest farm-scoping case: an operator whose id IS in the
        // seeded set (seed key "ganpat") but which lives on a DIFFERENT farm.
        // Id-matching alone would delete it; the teardown must not, because the
        // seeder only ever owns rows on its own demo farm.
        var seedIdOnOtherFarm = await InsertFieldOperatorAsync(
            PurveshDemoSeeder.CreateDeterministicGuid($"{SeedVersion}:field-operator:ganpat"),
            _otherFarmId,
            "गणपत");

        var seeder = CreateSeeder(out var disposables);
        try
        {
            await seeder.ClearPurveshDemoAsync(CancellationToken.None);

            (await CountFieldOperatorsAsync(SeededFieldOperatorId)).Should().Be(0,
                "the seeder created this operator, so the seeder removes it — otherwise the RESTRICT "
                + "FK on originating_farm_id turns the next re-seed into an opaque 23503");

            (await CountFieldOperatorsAsync(strangerId)).Should().Be(1,
                "an operator on a farm the seeder does not own must never be touched");
            (await CountFieldOperatorsAsync(seedIdOnOtherFarm)).Should().Be(1,
                "a seed-derived id on someone else's farm must survive — the teardown is farm-scoped "
                + "AND id-scoped, never id-scoped alone");

            (await CountFarmsAsync(DemoFarmId)).Should().Be(0,
                "with no identities left blocking it, the demo farm deletes cleanly");
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
                INSERT INTO ssf.daily_logs ("Id", farm_id, plot_id, crop_cycle_id, operator_user_id, log_date, created_at_utc, source, model_version, prompt_version)
                VALUES (@id, @fid, @pid, @cid, @uid, CURRENT_DATE, NOW(), 'voice', 'unknown', 'unknown');
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
