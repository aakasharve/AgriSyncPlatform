// spec: docs/superpowers/plans/2026-08-30-shared-farm-foundation-STAGE-A-PLAN.md (A4)
using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using FluentAssertions;
using Npgsql;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Concurrency;

/// <summary>
/// Builds ONE scratch database with the full migration chain and shares it across
/// every fact in the class. <c>IntegrationMigrationChain.ApplyAsync</c> runs four
/// DbContexts and ~101 migrations including materialized views, so per-fact setup
/// would cost minutes rather than seconds.
/// </summary>
public sealed class MigratedScratchDbFixture : IAsyncLifetime
{
    public string SuperuserConnectionString { get; private set; } = string.Empty;
    private string _adminConn = string.Empty;
    private string _scratchDbName = string.Empty;

    public async Task InitializeAsync()
    {
        _adminConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();
        _scratchDbName = $"ssf_concurrency_proof_{Guid.NewGuid():N}";

        await using (var admin = new NpgsqlConnection(_adminConn))
        {
            await admin.OpenAsync();
            await using var create = admin.CreateCommand();
            create.CommandText = $"CREATE DATABASE \"{_scratchDbName}\"";
            await create.ExecuteNonQueryAsync();
        }

        SuperuserConnectionString =
            new NpgsqlConnectionStringBuilder(_adminConn) { Database = _scratchDbName }.ConnectionString;
        await IntegrationMigrationChain.ApplyAsync(SuperuserConnectionString);
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
}

/// <summary>
/// Stage A0 / A4 — the multi-actor concurrency invariant, pinned at the schema.
///
/// <para>A real farm is concurrent. The father logs fertilizer on Plot A while the
/// son logs spraying on Plot B and the mukadam closes attendance. Two legitimate
/// humans on the same farm, the same day, even the same plot, must produce TWO
/// records.</para>
///
/// <para><b>What this defends against.</b> Not a race — a future migration. The
/// realistic way this invariant dies is someone "fixing duplicate logs" with a
/// unique constraint on (farm_id, log_date). Duplicate protection belongs to
/// idempotency, never to a uniqueness rule over farm-day business coordinates.</para>
///
/// <para><b>What it does NOT prove.</b> It does not prove the sync envelope maps
/// ClientRequestId onto IdempotencyKey — that path is exercised by
/// <c>SyncEndpointsTests.Push_WithDuplicateClientRequestId_PerDevice_IsIdempotent</c>
/// (for create_farm). This asserts only the schema-level guarantee.</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class MultiActorLogConcurrencyRealPostgresTests
    : IClassFixture<MigratedScratchDbFixture>
{
    private readonly MigratedScratchDbFixture _db;

    public MultiActorLogConcurrencyRealPostgresTests(MigratedScratchDbFixture db) => _db = db;

    /// <summary>
    /// The row-identity column of ssf.daily_logs. DailyLogConfiguration declares
    /// HasKey(x =&gt; x.Id) with NO HasColumnName, unlike every business column on
    /// that table, so it keeps the PascalCase property name.
    /// </summary>
    private const string RowIdentityColumn = "Id";

    private sealed record UniqueIndex(string Name, bool IsPrimary, List<string> Columns);

    /// <summary>
    /// Reads ACTUAL key columns from the catalog rather than parsing indexdef text.
    /// A partial unique index whose WHERE clause mentions farm_id would fool a string
    /// match, and INCLUDE columns are not part of the uniqueness key at all — hence
    /// the indnkeyatts bound.
    /// </summary>
    private async Task<List<UniqueIndex>> ReadUniqueIndexesAsync()
    {
        var result = new List<UniqueIndex>();
        await using var conn = new NpgsqlConnection(_db.SuperuserConnectionString);
        await conn.OpenAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            SELECT i.relname                             AS index_name,
                   ix.indisprimary                       AS is_primary,
                   array_agg(a.attname ORDER BY k.ord)   AS key_columns
            FROM pg_class t
            JOIN pg_namespace n ON n.oid = t.relnamespace
            JOIN pg_index ix    ON ix.indrelid = t.oid
            JOIN pg_class i     ON i.oid = ix.indexrelid
            JOIN LATERAL unnest(ix.indkey) WITH ORDINALITY AS k(attnum, ord) ON TRUE
            JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
            WHERE n.nspname = 'ssf'
              AND t.relname = 'daily_logs'
              AND ix.indisunique
              AND k.attnum > 0
              AND k.ord <= ix.indnkeyatts
            GROUP BY i.relname, ix.indisprimary
            """;
        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            result.Add(new UniqueIndex(
                reader.GetString(0),
                reader.GetBoolean(1),
                new List<string>((string[])reader.GetValue(2))));
        }
        return result;
    }

    [Fact]
    public async Task Every_unique_index_on_daily_logs_is_identity_or_idempotency_and_nothing_else()
    {
        var uniqueIndexes = await ReadUniqueIndexesAsync();

        uniqueIndexes.Should().NotBeEmpty(
            "the primary key alone yields a unique index; an empty result means the query is wrong, not that the invariant holds");

        foreach (var ix in uniqueIndexes)
        {
            var isRowIdentity = ix.IsPrimary && ix.Columns.Count == 1
                                && ix.Columns[0] == RowIdentityColumn;
            var isIdempotency = ix.Columns.Count == 1 && ix.Columns[0] == "idempotency_key";

            (isRowIdentity || isIdempotency).Should().BeTrue(
                $"unique indexes on ssf.daily_logs may only enforce row identity or idempotency. "
                + $"Index '{ix.Name}' covers [{string.Join(", ", ix.Columns)}]. If this is a new "
                + $"business-coordinate uniqueness rule (farm/day/plot/actor), it converts a second "
                + $"person's real work into a constraint violation and must be reverted. Duplicate "
                + $"protection belongs to idempotency.");
        }
    }

    [Fact]
    public async Task Idempotency_key_uniqueness_still_exists()
    {
        var uniqueIndexes = await ReadUniqueIndexesAsync();

        uniqueIndexes.Should().Contain(
            ix => ix.Columns.Count == 1 && ix.Columns[0] == "idempotency_key",
            "if this unique index is dropped, a flaky rural connection starts creating duplicate "
            + "farm history - and the fix must never be a farm-day uniqueness rule instead.");
    }
}

/// <summary>
/// Proves the allow-list predicate is actually discriminating, without a database and
/// without mutating the production assertion to watch it fail.
/// </summary>
public sealed class UniqueIndexAllowListLogicTests
{
    private static bool IsPermitted(bool isPrimary, params string[] columns) =>
        (isPrimary && columns.Length == 1 && columns[0] == "Id")
        || (columns.Length == 1 && columns[0] == "idempotency_key");

    [Theory]
    [InlineData(true, new[] { "Id" }, true)]
    [InlineData(false, new[] { "idempotency_key" }, true)]
    [InlineData(false, new[] { "farm_id", "log_date" }, false)]
    [InlineData(false, new[] { "farm_id", "plot_id", "log_date" }, false)]
    [InlineData(false, new[] { "farm_id", "operator_user_id", "log_date" }, false)]
    // A composite PK over business coordinates is still forbidden, primary or not.
    [InlineData(true, new[] { "farm_id", "log_date" }, false)]
    public void The_allow_list_admits_only_identity_and_idempotency(
        bool isPrimary, string[] columns, bool expected)
        => IsPermitted(isPrimary, columns).Should().Be(expected);
}
