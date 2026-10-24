// spec: 2026-09-01-labour-v2-r1 (Phase 4, brief Task 4.3)
using System;
using System.Threading.Tasks;
using FluentAssertions;
using Npgsql;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Labour;

/// <summary>
/// Brief Task 4.3, safety-net half — final direction §8, verbatim rule: the
/// unique index is a LAST-RESORT SAFETY NET that prevents an impossible
/// duplicate canonical mark if application logic fails. It is NOT the product
/// mechanism that discovers ambiguity, and a database error must never be the
/// thing that decides to ask the farmer a question — the semantic check lives
/// in RecordAttendanceMarkHandler, BEFORE persistence (Phase 3). This suite
/// proves the net exists and holds; nothing more.
///
/// <para><b>Native :5433, fail-loud (2026-07-19 CI-truthfulness contract).</b>
/// Tagged RequiresPostgres; unreachable Postgres THROWS out of InitializeAsync
/// — FAILED, never a silent skip. Own scratch database, full
/// IntegrationMigrationChain, dropped on dispose. Superuser connection is fine
/// here: this is a CONSTRAINT proof, not an RLS proof, and must never be cited
/// as RLS coverage.</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class AttendanceMarkUniqueIndexRealPostgresTests : IAsyncLifetime
{
    private string _adminConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private string _superuserConn = string.Empty;

    public async Task InitializeAsync()
    {
        _adminConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();
        _scratchDbName = $"ssf_attmark_uq_{Guid.NewGuid():N}";
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
    public async Task A_second_canonical_mark_for_the_same_person_day_is_refused_with_23505()
    {
        var farmId = Guid.NewGuid();
        var operatorId = Guid.NewGuid();
        var recordedBy = Guid.NewGuid();

        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();

        static NpgsqlCommand InsertMark(NpgsqlConnection db, Guid farmId, Guid operatorId, Guid recordedBy, int dayMark)
        {
            var c = db.CreateCommand();
            c.CommandText = """
                INSERT INTO ssf.attendance_marks
                    ("Id", farm_id, field_operator_id, work_date, day_mark, night_mark,
                     recorded_by_user_id, recorded_at_utc, modified_at_utc)
                VALUES (@id, @fid, @oid, DATE '2026-09-01', @day, 0, @uid, NOW(), NOW());
                """;
            c.Parameters.AddWithValue("id", Guid.NewGuid());
            c.Parameters.AddWithValue("fid", farmId);
            c.Parameters.AddWithValue("oid", operatorId);
            c.Parameters.AddWithValue("day", dayMark);
            c.Parameters.AddWithValue("uid", recordedBy);
            return c;
        }

        // First ruling lands.
        await using (var first = InsertMark(db, farmId, operatorId, recordedBy, dayMark: 1))
        {
            (await first.ExecuteNonQueryAsync()).Should().Be(1);
        }

        // A second canonical ruling for the SAME (farm, person, day) — even a
        // different value — hits the net: 23505, never a silent second truth.
        await using var second = InsertMark(db, farmId, operatorId, recordedBy, dayMark: 2);
        var act = async () => await second.ExecuteNonQueryAsync();
        (await act.Should().ThrowAsync<PostgresException>())
            .Which.SqlState.Should().Be("23505");

        // A different DAY for the same person is not a duplicate — the net
        // catches the impossible, never the ordinary.
        await using var otherDay = db.CreateCommand();
        otherDay.CommandText = """
            INSERT INTO ssf.attendance_marks
                ("Id", farm_id, field_operator_id, work_date, day_mark, night_mark,
                 recorded_by_user_id, recorded_at_utc, modified_at_utc)
            VALUES (@id, @fid, @oid, DATE '2026-09-02', 1, 0, @uid, NOW(), NOW());
            """;
        otherDay.Parameters.AddWithValue("id", Guid.NewGuid());
        otherDay.Parameters.AddWithValue("fid", farmId);
        otherDay.Parameters.AddWithValue("oid", operatorId);
        otherDay.Parameters.AddWithValue("uid", recordedBy);
        (await otherDay.ExecuteNonQueryAsync()).Should().Be(1);
    }
}
