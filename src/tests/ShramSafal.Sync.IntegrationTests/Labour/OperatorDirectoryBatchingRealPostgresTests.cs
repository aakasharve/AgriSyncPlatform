// spec: 2026-08-28-labour-v2-release-1 (Task 24)
using System;
using System.Collections.Generic;
using System.Data.Common;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Npgsql;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Infrastructure.Persistence;
using ShramSafal.Infrastructure.Persistence.Repositories;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Labour;

/// <summary>
/// Task 24 (spec: 2026-08-28-labour-v2-release-1) — proof for the
/// per-worker round-trip audit finding. The defect was NOT a loop inside
/// <c>GetLabourDataHandler</c> (its own person-assembly loop makes zero
/// repository calls — every per-person figure is a dictionary lookup, see
/// the handler's §5). It was hidden one layer down, inside
/// <c>ShramSafalRepository.GetOperatorsByIdsAsync</c> — a method whose
/// SIGNATURE already looks batched (<c>IEnumerable&lt;Guid&gt; userIds</c> in,
/// one list out) but whose BODY issued one <c>SqlQueryRaw</c> round trip per
/// id in a <c>foreach</c>. <c>GetLabourDataHandler</c> (dashboard, every open)
/// and <c>PullSyncChangesHandler</c> (sync pull, every app open) both call
/// this SAME repository method, so both surfaces carried the SAME N-round-trip
/// cost for N distinct operators — genuinely the same code, not merely
/// similar.
///
/// <para>
/// <b>Two proofs, per the founder's ask.</b>
/// <see cref="Batched_query_resolves_names_and_skips_ids_with_no_matching_user"/>
/// pins the OUTPUT (a worker whose id has no <c>public.users</c> row is
/// SKIPPED, never a fabricated placeholder — matches the per-id loop's own
/// <c>if (row is null) continue;</c>). <see
/// cref="GetOperatorsByIdsAsync_issues_exactly_one_round_trip_regardless_of_worker_count"/>
/// pins the COUNT via a <see cref="DbCommandInterceptor"/> that counts actual
/// <c>ReaderExecuting(Async)</c> calls reaching Postgres — the only proof that
/// cannot be faked by a batched-looking signature hiding a per-id loop.
/// </para>
///
/// <para>
/// <b>RLS is unaffected by this change.</b> <c>public.users</c> carries no
/// RLS policy (global directory, per
/// <c>20260516150000_EnableUserDbRowLevelSecurity</c>'s own remarks);
/// <c>public.memberships</c> is RLS-scoped to
/// <c>user_id = current_setting('agrisync.user_id')</c>
/// (<c>p_user_memberships</c>). That policy is evaluated PER ROW by Postgres
/// regardless of whether the join's driving id list has one id or N — a
/// single <c>WHERE u."Id" = ANY(@ids)</c> query triggers the identical
/// per-row USING-clause check as N separate <c>WHERE u."Id" = @id</c>
/// queries. Batching the id list does not change which rows the JOIN — or
/// the RLS policy guarding it — can see. This suite runs as the migration
/// superuser (same convention as <see cref="LabourMoneyInvariantsRealPostgresTests"/>
/// — not an RLS boundary test, that is <c>Security/RowLevelSecurityTests</c>'s
/// job), so it proves the SHAPE of the query, not the RLS boundary itself.
/// </para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class OperatorDirectoryBatchingRealPostgresTests : IAsyncLifetime
{
    private string _superuserConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private string _adminConn = string.Empty;

    public async Task InitializeAsync()
    {
        var baseConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();
        _adminConn = baseConn;

        _scratchDbName = $"ssf_operatorbatch_proof_{Guid.NewGuid():N}";
        await using (var admin = new NpgsqlConnection(baseConn))
        {
            await admin.OpenAsync();
            await using var create = admin.CreateCommand();
            create.CommandText = $"CREATE DATABASE \"{_scratchDbName}\"";
            await create.ExecuteNonQueryAsync();
        }

        _superuserConn = new NpgsqlConnectionStringBuilder(baseConn) { Database = _scratchDbName }.ConnectionString;

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

    private ShramSafalDbContext NewDbContext(params IInterceptor[] interceptors)
    {
        var builder = new DbContextOptionsBuilder<ShramSafalDbContext>()
            .UseNpgsql(_superuserConn, npgsql => npgsql.MigrationsHistoryTable("__ef_migrations", "ssf"));
        if (interceptors.Length > 0)
        {
            builder = builder.AddInterceptors(interceptors);
        }

        return new ShramSafalDbContext(builder.Options);
    }

    private static async Task SeedUserAsync(NpgsqlConnection db, Guid userId, string phone, string displayName)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO public.users
                ("Id", phone, display_name, password_hash, credential_created_at_utc,
                 created_at_utc, is_active, auth_mode, preferred_language)
            VALUES (@id, @phone, @name, 'x', NOW(), NOW(), TRUE, 0, 'mr');
            """;
        cmd.Parameters.AddWithValue("id", userId);
        cmd.Parameters.AddWithValue("phone", phone);
        cmd.Parameters.AddWithValue("name", displayName);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task SeedMembershipAsync(NpgsqlConnection db, Guid userId, string role)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO public.memberships
                ("Id", user_id, app_id, role, granted_at_utc, is_revoked)
            VALUES (@id, @userId, 'shramsafal', @role, NOW(), FALSE);
            """;
        cmd.Parameters.AddWithValue("id", Guid.NewGuid());
        cmd.Parameters.AddWithValue("userId", userId);
        cmd.Parameters.AddWithValue("role", role);
        await cmd.ExecuteNonQueryAsync();
    }

    /// <summary>
    /// PROOF 1 — CORRECTNESS (pin, per the founder's ask: since behaviour must
    /// not change, this pins the exact output rather than red/green on
    /// behaviour). Three real users (one with a `shramsafal` membership, two
    /// without) plus a FOURTH id that has no <c>public.users</c> row at all —
    /// the "worker whose name is missing" case. The missing id must be
    /// SKIPPED, never returned with a fabricated placeholder name: that is
    /// what the original per-id loop's own <c>if (row is null) continue;</c>
    /// did, and the batched replacement must do the exact same thing.
    /// </summary>
    [Fact]
    public async Task Batched_query_resolves_names_and_skips_ids_with_no_matching_user()
    {
        var mukadamId = Guid.NewGuid();
        var workerId = Guid.NewGuid();
        var noMembershipWorkerId = Guid.NewGuid();
        var missingUserId = Guid.NewGuid(); // no public.users row — a name that cannot be resolved.

        await using (var conn = new NpgsqlConnection(_superuserConn))
        {
            await conn.OpenAsync();
            await SeedUserAsync(conn, mukadamId, "9000000001", "Ramesh Patil");
            await SeedUserAsync(conn, workerId, "9000000002", "Anita Koli");
            await SeedUserAsync(conn, noMembershipWorkerId, "9000000003", "Suresh More");
            await SeedMembershipAsync(conn, mukadamId, "mukadam");
            await SeedMembershipAsync(conn, workerId, "worker");
            // noMembershipWorkerId deliberately gets no public.memberships row —
            // the LEFT JOIN must still surface the user via public.users alone.
        }

        await using var db = NewDbContext();
        IShramSafalRepository repository = new ShramSafalRepository(db);

        var result = await repository.GetOperatorsByIdsAsync(
            [mukadamId, workerId, noMembershipWorkerId, missingUserId], CancellationToken.None);

        result.Should().HaveCount(3,
            "the id with no public.users row must be SKIPPED, never returned as a fabricated placeholder");
        result.Should().NotContain(o => o.UserId == missingUserId,
            "absence of a resolvable name must stay an absence, not a synthesized entry");

        result.Select(o => o.UserId).Should().BeEquivalentTo([mukadamId, workerId, noMembershipWorkerId]);

        result.Single(o => o.UserId == mukadamId).DisplayName.Should().Be("Ramesh Patil");
        result.Single(o => o.UserId == mukadamId).Role.Should().Be("MUKADAM");

        result.Single(o => o.UserId == workerId).DisplayName.Should().Be("Anita Koli");
        result.Single(o => o.UserId == workerId).Role.Should().Be("WORKER");

        result.Single(o => o.UserId == noMembershipWorkerId).DisplayName.Should().Be("Suresh More");
        result.Single(o => o.UserId == noMembershipWorkerId).Role.Should().Be("WORKER",
            "no shramsafal membership row -> coalesce(m.role, 'worker') default, same as the original per-id loop");

        // Final ordering contract: DisplayName, case-insensitive — unchanged by batching.
        result.Select(o => o.DisplayName).Should().BeInAscendingOrder(StringComparer.OrdinalIgnoreCase);
    }

    /// <summary>
    /// PROOF 2 — THE COUNT ITSELF. A <see cref="DbCommandInterceptor"/>
    /// attached directly to the <see cref="ShramSafalDbContext"/> counts every
    /// actual <c>ReaderExecuting(Async)</c> call that reaches Postgres for
    /// this ONE <c>GetOperatorsByIdsAsync</c> call. This is the proof a
    /// batched-looking method signature cannot fake: if a per-id loop is ever
    /// reintroduced, this count reverts to <c>ids.Count</c> and the assertion
    /// below fails.
    ///
    /// <para>
    /// Seeded with SEVEN distinct workers — small enough to run fast, large
    /// enough that "one query" and "one query per worker" are unmistakably
    /// different assertions (1 vs 7), which is what the audit's "40-80
    /// workers" claim is actually about: the round-trip count scaling with
    /// crew size, not its absolute size here.
    /// </para>
    /// </summary>
    [Fact]
    public async Task GetOperatorsByIdsAsync_issues_exactly_one_round_trip_regardless_of_worker_count()
    {
        var workerIds = Enumerable.Range(0, 7).Select(_ => Guid.NewGuid()).ToList();

        await using (var conn = new NpgsqlConnection(_superuserConn))
        {
            await conn.OpenAsync();
            for (var i = 0; i < workerIds.Count; i++)
            {
                await SeedUserAsync(conn, workerIds[i], $"90000001{i:D2}", $"Worker {i}");
                await SeedMembershipAsync(conn, workerIds[i], "worker");
            }
        }

        var counter = new ReaderExecutionCounter();
        await using var db = NewDbContext(counter);
        IShramSafalRepository repository = new ShramSafalRepository(db);

        var result = await repository.GetOperatorsByIdsAsync(workerIds, CancellationToken.None);

        result.Should().HaveCount(workerIds.Count, "every seeded worker must still resolve a name");
        counter.ReaderExecutions.Should().Be(1,
            $"GetOperatorsByIdsAsync must resolve all {workerIds.Count} names in ONE batched round trip — " +
            $"a per-id loop would need {workerIds.Count} round trips here, which is exactly the defect Task 24 fixes. " +
            "Production capacity is ~32 simultaneous requests; a 40-80 worker crew must not multiply this one " +
            "dashboard/sync call by 40-80x.");
    }

    private sealed class ReaderExecutionCounter : DbCommandInterceptor
    {
        private int _readerExecutions;

        public int ReaderExecutions => _readerExecutions;

        public override InterceptionResult<DbDataReader> ReaderExecuting(
            DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result)
        {
            Interlocked.Increment(ref _readerExecutions);
            return base.ReaderExecuting(command, eventData, result);
        }

        public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(
            DbCommand command,
            CommandEventData eventData,
            InterceptionResult<DbDataReader> result,
            CancellationToken cancellationToken = default)
        {
            Interlocked.Increment(ref _readerExecutions);
            return base.ReaderExecutingAsync(command, eventData, result, cancellationToken);
        }
    }
}
