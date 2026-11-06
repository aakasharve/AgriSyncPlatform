// spec: plr-d10-redesign-real-integration-2026-10-25 (lane OPS-1, F99 leftover L-1)
using System;
using System.Threading.Tasks;
using Npgsql;
using ShramSafal.Infrastructure.Persistence.Migrations;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Privacy;

/// <summary>
/// L-1 on real PostgreSQL: the migration's own SQL (the exact constants Up() and Down() run) on a scratch database that
/// holds the six columns it touches. Proves: Up() cancels pre-existing duplicate waiting requests (keeping the oldest) so
/// the index can be built; afterwards a second waiting request for the same person is refused with 23505 on the named
/// index (whether filed by him or on his behalf); a different person, a cancelled request and a finished one are not
/// blocked; and Down() removes the index.
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class OneWaitingErasureRequestIndexRealPostgresTests : IAsyncLifetime
{
    private string _root = "";
    private string _db = "";
    private string _conn = "";

    public async Task InitializeAsync()
    {
        _root = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();
        _db = "ops1_erasure_" + Guid.NewGuid().ToString("N")[..12];
        await Exec(_root, $"CREATE DATABASE {_db}");
        _conn = new NpgsqlConnectionStringBuilder(_root) { Database = _db, Pooling = false }.ConnectionString;
        await Exec(_conn, @"
CREATE SCHEMA ssf;
CREATE TABLE ssf.erasure_requests (
    id uuid PRIMARY KEY,
    requested_by_user_id uuid NOT NULL,
    on_behalf_of_user_id uuid NULL,
    status integer NOT NULL,
    requested_at_utc timestamptz NOT NULL,
    completed_at_utc timestamptz NULL);
CREATE TABLE ssf.audit_events (
    ""Id"" uuid PRIMARY KEY, entity_type text NOT NULL, entity_id uuid NOT NULL, action text NOT NULL,
    actor_user_id uuid NOT NULL, actor_role text NOT NULL, payload text NOT NULL, occurred_at_utc timestamptz NOT NULL,
    farm_id uuid NULL, client_command_id text NULL, app_version varchar(32) NOT NULL, device_id varchar(64) NOT NULL,
    ip_hash varchar(80) NOT NULL, source_ai_job_id uuid NULL);
ALTER TABLE ssf.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ssf.audit_events FORCE ROW LEVEL SECURITY;");
    }

    public async Task DisposeAsync()
    {
        NpgsqlConnection.ClearAllPools();
        await Exec(_root, $"DROP DATABASE IF EXISTS {_db} WITH (FORCE)");
    }

    private static async Task Exec(string conn, string sql)
    {
        await using var c = new NpgsqlConnection(conn);
        await c.OpenAsync();
        await using var cmd = new NpgsqlCommand(sql, c);
        await cmd.ExecuteNonQueryAsync();
    }

    private async Task<long> Scalar(string sql)
    {
        await using var c = new NpgsqlConnection(_conn);
        await c.OpenAsync();
        await using var cmd = new NpgsqlCommand(sql, c);
        return Convert.ToInt64(await cmd.ExecuteScalarAsync());
    }

    private Task Insert(Guid id, Guid by, Guid? onBehalf, int status, string at) =>
        Exec(_conn, $"INSERT INTO ssf.erasure_requests (id, requested_by_user_id, on_behalf_of_user_id, status, requested_at_utc) " +
                    $"VALUES ('{id}', '{by}', {(onBehalf is null ? "NULL" : $"'{onBehalf}'")}, {status}, '{at}')");

    [Fact]
    public async Task Up_cleans_duplicates_then_the_index_allows_one_waiting_request_per_person_and_Down_removes_it()
    {
        var person = Guid.NewGuid();
        var other = Guid.NewGuid();
        var oldest = Guid.NewGuid();
        var duplicateSelf = Guid.NewGuid();
        var duplicateOnBehalf = Guid.NewGuid();

        // Pre-existing state the old code allowed: three waiting requests about the same person.
        await Insert(oldest, person, null, 0, "2026-10-01T00:00:00Z");
        await Insert(duplicateSelf, person, null, 0, "2026-10-02T00:00:00Z");
        await Insert(duplicateOnBehalf, Guid.NewGuid(), person, 0, "2026-10-03T00:00:00Z");

        await Exec(_conn, AddOneWaitingErasureRequestIndex.UpSql);

        Assert.Equal(1, await Scalar($"SELECT count(*) FROM ssf.erasure_requests WHERE status = 0 AND id = '{oldest}'"));
        Assert.Equal(2, await Scalar("SELECT count(*) FROM ssf.erasure_requests WHERE status = 5 AND completed_at_utc IS NOT NULL"));

        // M6: each cancelled duplicate left an audit row (actor system_migration; the kept request and this migration in the payload),
        // and FORCE row security on audit_events was put back exactly as found.
        Assert.Equal(2, await Scalar("SELECT count(*) FROM ssf.audit_events WHERE entity_type = 'ErasureRequest' AND actor_role = 'system_migration'"));
        foreach (var cancelled in new[] { duplicateSelf, duplicateOnBehalf })
        {
            Assert.Equal(1, await Scalar(
                $"SELECT count(*) FROM ssf.audit_events WHERE entity_id = '{cancelled}' AND action = 'CancelledDuplicateWaiting' " +
                $"AND payload::jsonb ->> 'keptRequestId' = '{oldest}' " +
                $"AND payload::jsonb ->> 'migrationId' = '{AddOneWaitingErasureRequestIndex.MigrationId}'"));
        }

        Assert.Equal(0, await Scalar($"SELECT count(*) FROM ssf.audit_events WHERE entity_id = '{oldest}'"));
        Assert.Equal(1, await Scalar("SELECT relforcerowsecurity::int FROM pg_class WHERE oid = 'ssf.audit_events'::regclass"));

        // A second waiting request about the same person: refused, on the named index, filed either way round.
        var self = await Assert.ThrowsAsync<PostgresException>(() => Insert(Guid.NewGuid(), person, null, 0, "2026-11-01T00:00:00Z"));
        Assert.Equal("23505", self.SqlState);
        Assert.Equal(AddOneWaitingErasureRequestIndex.IndexName, self.ConstraintName);
        var behalf = await Assert.ThrowsAsync<PostgresException>(() => Insert(Guid.NewGuid(), Guid.NewGuid(), person, 0, "2026-11-01T00:00:00Z"));
        Assert.Equal("23505", behalf.SqlState);

        // Not blocked: another person, and requests that are no longer waiting.
        await Insert(Guid.NewGuid(), other, null, 0, "2026-11-01T00:00:00Z");
        await Insert(Guid.NewGuid(), person, null, 5, "2026-11-01T00:00:00Z");
        await Insert(Guid.NewGuid(), person, null, 2, "2026-11-01T00:00:00Z");

        // After the waiting one is cancelled, he may ask again.
        await Exec(_conn, $"UPDATE ssf.erasure_requests SET status = 5 WHERE id = '{oldest}'");
        await Insert(Guid.NewGuid(), person, null, 0, "2026-11-02T00:00:00Z");

        // Down() drops the index and nothing else: two waiting rows for one person are possible again.
        await Exec(_conn, AddOneWaitingErasureRequestIndex.DownSql);
        Assert.Equal(0, await Scalar($"SELECT count(*) FROM pg_indexes WHERE indexname = '{AddOneWaitingErasureRequestIndex.IndexName}'"));
        await Insert(Guid.NewGuid(), person, null, 0, "2026-11-03T00:00:00Z");

        // And Up() again works on the cleaned-up table (re-apply after a rollback).
        await Exec(_conn, AddOneWaitingErasureRequestIndex.UpSql);
        Assert.Equal(1, await Scalar($"SELECT count(*) FROM pg_indexes WHERE indexname = '{AddOneWaitingErasureRequestIndex.IndexName}'"));
    }
}
