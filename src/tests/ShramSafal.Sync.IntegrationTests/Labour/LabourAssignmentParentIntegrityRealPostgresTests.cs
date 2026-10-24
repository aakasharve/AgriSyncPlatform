// spec: 2026-07-13-labour-attendance-approval-design
using System;
using System.Threading.Tasks;
using FluentAssertions;
using Npgsql;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Labour;

/// <summary>
/// Task 1 (spec 2026-07-13-labour-attendance-approval-design) — parent
/// integrity on the anchor. Proves the new
/// <c>ssf.labour_assignments.daily_log_id</c> → <c>ssf.daily_logs."Id"</c>
/// foreign key (migration <c>AddLabourAssignmentDailyLogForeignKey</c>)
/// actually rejects an orphaned insert and accepts a valid one, against REAL
/// Postgres — not the EF-InMemory harness.
///
/// <para>
/// <b>This is an FK proof, not an RLS proof.</b> It connects as the
/// migration SUPERUSER (which bypasses RLS) purely to isolate the
/// database-level referential-integrity constraint from tenant-scoping
/// concerns. It does not exercise <c>p_tenant_labour_assignments</c> and must
/// never be cited as RLS coverage for that policy.
/// </para>
///
/// <para>
/// <b>Native :5433, fail-loud (2026-07-19 CI-truthfulness contract).</b>
/// Tagged <c>[Trait("Category","RequiresPostgres")]</c>. If native Postgres is
/// unreachable, <see cref="RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync"/>
/// THROWS out of <see cref="InitializeAsync"/> — the [Fact] reports FAILED,
/// never a silent skip. It creates its OWN scratch database, applies the full
/// migration chain to it, and drops it on dispose — it never touches
/// <c>agrisync_dev</c> data.
/// </para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class LabourAssignmentParentIntegrityRealPostgresTests : IAsyncLifetime
{
    private string _adminConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private string _superuserConn = string.Empty;

    public async Task InitializeAsync()
    {
        // Throws (does not skip) if Postgres is unconfigured/unreachable — see
        // RequiresPostgresConnection's doc comment for the 2026-07-19
        // CI-truthfulness fix this enforces.
        _adminConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();

        _scratchDbName = $"ssf_labourfk_proof_{Guid.NewGuid():N}";
        await using (var admin = new NpgsqlConnection(_adminConn))
        {
            await admin.OpenAsync();
            await using var create = admin.CreateCommand();
            create.CommandText = $"CREATE DATABASE \"{_scratchDbName}\"";
            await create.ExecuteNonQueryAsync();
        }

        _superuserConn = new NpgsqlConnectionStringBuilder(_adminConn) { Database = _scratchDbName }.ConnectionString;
        await IntegrationMigrationChain.ApplyAsync(_superuserConn);
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
    public async Task Orphan_daily_log_id_is_rejected_and_real_daily_log_id_succeeds()
    {
        var farmId = Guid.NewGuid();
        var ownerUserId = Guid.NewGuid();
        var dailyLogId = Guid.NewGuid();

        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();

        await using (var c = db.CreateCommand())
        {
            c.CommandText = """
                INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status)
                VALUES (@id, 'Labour FK Proof Farm', @uid, @uid, NOW(), NOW(), 3.0, 'Unchecked');
                """;
            c.Parameters.AddWithValue("id", farmId);
            c.Parameters.AddWithValue("uid", ownerUserId);
            await c.ExecuteNonQueryAsync();
        }

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
            c.Parameters.AddWithValue("uid", ownerUserId);
            await c.ExecuteNonQueryAsync();
        }

        // ── (1) A random, unseeded daily_log_id must be REJECTED — 23503 ───
        //        (foreign_key_violation), not silently accepted as an orphan.
        var orphanDailyLogId = Guid.NewGuid();
        var insertOrphan = async () =>
        {
            await using var c = db.CreateCommand();
            c.CommandText = """
                INSERT INTO ssf.labour_assignments
                    ("Id", daily_log_id, engagement_type, worker_count, wage_per_person, total_cost, worker_names_json, created_at_utc, duration_hours, time_basis)
                VALUES
                    (@id, @dlid, 'Hired', 4, 50, NULL, '[]'::jsonb, NOW(), 8, 'Assumed');
                """;
            c.Parameters.AddWithValue("id", Guid.NewGuid());
            c.Parameters.AddWithValue("dlid", orphanDailyLogId);
            await c.ExecuteNonQueryAsync();
        };

        var orphanAssertion = await insertOrphan.Should().ThrowAsync<PostgresException>(
            "an orphaned daily_log_id must be rejected by the new FK — no orphan labour row is possible");
        orphanAssertion.Which.SqlState.Should().Be("23503",
            "the rejection must be a foreign-key violation, not some other constraint");

        // ── (2) The real daily_log_id must be ACCEPTED. ─────────────────────
        var realAssignmentId = Guid.NewGuid();
        await using (var c = db.CreateCommand())
        {
            c.CommandText = """
                INSERT INTO ssf.labour_assignments
                    ("Id", daily_log_id, engagement_type, worker_count, wage_per_person, total_cost, worker_names_json, created_at_utc, duration_hours, time_basis)
                VALUES
                    (@id, @dlid, 'Hired', 4, 50, NULL, '[]'::jsonb, NOW(), 8, 'Assumed');
                """;
            c.Parameters.AddWithValue("id", realAssignmentId);
            c.Parameters.AddWithValue("dlid", dailyLogId);
            await c.ExecuteNonQueryAsync();
        }

        var count = await ScalarLongAsync(db,
            "SELECT COUNT(*) FROM ssf.labour_assignments WHERE \"Id\" = @id", ("id", realAssignmentId));
        count.Should().Be(1, "the labour_assignment with the real parent daily_log_id must persist");
    }

    /// <summary>
    /// Task 3.6 (spec: 2026-08-28-labour-v2-release-1) — the crew link's schema
    /// proof. Final direction §3: <c>engaged_through_field_operator_id</c> is
    /// the schema's FIRST nullable FK (NULL = "nobody said through whom", never
    /// "no mukadam"), and it must be a REAL constraint — NOT the
    /// <c>linked_activity_id</c> precedent (client uuid, no FK, no validation).
    /// After the migration chain (<c>AddEngagedThroughToLabourAssignments</c>):
    /// <c>information_schema.columns</c> shows <c>uuid | YES</c>, and an insert
    /// whose value names a non-existent operator is refused with SQLSTATE
    /// <c>23503</c>. The parent daily_log is seeded REAL so the only FK left to
    /// violate is the operator one — the 23503 cannot be the daily_log FK's.
    /// </summary>
    [Fact]
    public async Task Engaged_through_column_is_nullable_uuid_and_a_dangling_operator_is_rejected()
    {
        var farmId = Guid.NewGuid();
        var ownerUserId = Guid.NewGuid();
        var dailyLogId = Guid.NewGuid();

        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();

        // ── (1) The column exists, uuid, nullable — NULL must stay writable
        //        because "nobody said through whom" is the live default state.
        await using (var c = db.CreateCommand())
        {
            c.CommandText = """
                SELECT data_type, is_nullable
                FROM information_schema.columns
                WHERE table_schema = 'ssf'
                  AND table_name = 'labour_assignments'
                  AND column_name = 'engaged_through_field_operator_id'
                """;
            await using var reader = await c.ExecuteReaderAsync();
            var found = await reader.ReadAsync();
            found.Should().BeTrue("the AddEngagedThroughToLabourAssignments migration must have added the column");
            reader.GetString(0).Should().Be("uuid");
            reader.GetString(1).Should().Be("YES", "NULL means 'nobody said through whom' and must remain storable");
        }

        await using (var c = db.CreateCommand())
        {
            c.CommandText = """
                INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status)
                VALUES (@id, 'Crew Link FK Proof Farm', @uid, @uid, NOW(), NOW(), 3.0, 'Unchecked');
                """;
            c.Parameters.AddWithValue("id", farmId);
            c.Parameters.AddWithValue("uid", ownerUserId);
            await c.ExecuteNonQueryAsync();
        }

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
            c.Parameters.AddWithValue("uid", ownerUserId);
            await c.ExecuteNonQueryAsync();
        }

        // ── (2) A value naming a NON-EXISTENT operator is refused — 23503,
        //        and it is THIS FK (the daily_log parent above is real).
        var insertDangling = async () =>
        {
            await using var c = db.CreateCommand();
            c.CommandText = """
                INSERT INTO ssf.labour_assignments
                    ("Id", daily_log_id, engagement_type, worker_count, wage_per_person, total_cost, worker_names_json, created_at_utc, duration_hours, time_basis, engaged_through_field_operator_id)
                VALUES
                    (@id, @dlid, 'Hired', 8, NULL, NULL, '[]'::jsonb, NOW(), 8, 'Assumed', @through);
                """;
            c.Parameters.AddWithValue("id", Guid.NewGuid());
            c.Parameters.AddWithValue("dlid", dailyLogId);
            c.Parameters.AddWithValue("through", Guid.NewGuid());
            await c.ExecuteNonQueryAsync();
        };

        var assertion = await insertDangling.Should().ThrowAsync<PostgresException>(
            "the crew link must be a real FK — a dangling operator reference cannot be stored");
        assertion.Which.SqlState.Should().Be("23503",
            "the rejection must be a foreign-key violation, not some other constraint");
        assertion.Which.ConstraintName.Should().Contain("engaged_through",
            "the violated constraint must be the crew link's own FK, not the daily_log parent's");
    }

    private static async Task<long> ScalarLongAsync(
        NpgsqlConnection db, string sql, params (string Name, object Value)[] args)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in args)
        {
            cmd.Parameters.AddWithValue(name, value);
        }
        return Convert.ToInt64(await cmd.ExecuteScalarAsync());
    }
}
