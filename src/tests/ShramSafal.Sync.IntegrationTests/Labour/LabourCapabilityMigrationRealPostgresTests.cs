// spec: 2026-08-12-labour-phase2-server-truth-farm-context
using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;
using ShramSafal.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Labour;

/// <summary>
/// LABOUR_PHASE2 migration ② — <b>rehearsed on a throwaway database, with
/// <c>Down()</c> EXECUTED rather than merely written.</b>
///
/// <para><b>Why the <c>Down()</c> here DROPS the column while migrations ① and ③
/// REFUSE.</b> ① refuses because restoring <c>plot_id NOT NULL</c> could only
/// succeed by INVENTING a plot; ③ refuses because dropping the column would
/// DESTROY the farmer's own words with no second copy. Neither applies to an
/// administrative access flag: the rollback direction is strictly MORE
/// restrictive (capability narrows to owner-tier + Mukadam, nobody silently
/// gains access), nothing farmer-asserted is lost, and every grant/revoke has
/// already written an <c>ssf.audit_events</c> row that the rollback does not
/// touch — so history can still explain who was trusted and when. This suite
/// asserts that last claim rather than asserting the drop alone, because the
/// drop is only honest BECAUSE the audit row survives it.</para>
///
/// <para><b>What "no new RLS" is worth without a check.</b> Nothing. The plan
/// states that <c>ssf.farm_memberships</c> already carries a <c>FOR ALL</c>
/// tenant policy with a <c>WITH CHECK</c>, so an additive column needs no policy
/// work. That is asserted here from <c>pg_policies</c> — a policy that had
/// turned out to be <c>FOR SELECT</c>, or to have lost its <c>WITH CHECK</c>,
/// would have left the new column writable across farms with nobody
/// looking.</para>
///
/// <para><b>Posture (doctrine E5 / F3).</b> A fresh scratch database per [Fact]
/// via <see cref="IntegrationMigrationChain"/>, dropped on dispose. Never
/// <c>agrisync_dev</c>, never <c>agrisync_dev_v2</c>, never
/// <c>dotnet ef database update</c>, never <c>make boot</c>.</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class LabourCapabilityMigrationRealPostgresTests(Xunit.Abstractions.ITestOutputHelper output)
    : IAsyncLifetime
{
    /// <summary>The migration immediately BEFORE ②; rolling back to it executes ②'s Down().</summary>
    private const string TargetBeforeCapabilityMigration = "20260813053429_AddLabourAssignmentNotes";

    private const string ColumnName = "can_manage_labour_records";
    private const string TenantPolicy = "p_tenant_farm_memberships";

    private static readonly Guid FarmA = Guid.Parse("ca000000-0000-0000-0000-0000000000a1");
    private static readonly Guid AccountA = Guid.Parse("ca000000-0000-0000-0000-0000000000a2");
    private static readonly Guid OwnerA = Guid.Parse("ca000000-0000-0000-0000-0000000000a3");
    private static readonly Guid WorkerA = Guid.Parse("ca000000-0000-0000-0000-0000000000a4");

    private string _adminConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private string _superuserConn = string.Empty;

    public async Task InitializeAsync()
    {
        _adminConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();

        _scratchDbName = $"ssf_capmigration_{Guid.NewGuid():N}";
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
    public async Task Up_adds_one_NOT_NULL_false_defaulted_column_and_nothing_else()
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();

        var column = await ReadColumnAsync(db, ColumnName);
        column.Should().NotBeNull($"migration ② must have added ssf.farm_memberships.{ColumnName}");
        column!.DataType.Should().Be("boolean");
        column.IsNullable.Should().Be("NO",
            "an unknown capability is not a thing this product can express — every row means 'not granted'");
        column.Default.Should().Be("false",
            "existing rows read false because no grant has ever been issued anywhere in this product; "
            + "that is literal history, not a placeholder for missing knowledge (doctrine P4)");

        // Pre-existing rows really do read false, on a row planted BEFORE any
        // Phase 5 code touches it.
        await SeedFarmAsync(db, FarmA, OwnerA, AccountA, "Capability migration farm");
        await SeedMembershipAsync(db, FarmA, WorkerA, AccountA, "Worker");
        var granted = await ScalarAsync(db,
            $"SELECT {ColumnName} FROM ssf.farm_memberships WHERE user_id = @u", ("u", WorkerA));
        Convert.ToBoolean(granted).Should().BeFalse();

        var indexes = await ReadIndexNamesMentioningColumnAsync(db);
        indexes.Should().BeEmpty(
            "the column is only ever read alongside (farm_id, user_id), which "
            + "ix_farm_memberships_farm_user_nonterminal already covers; an index here would cost every "
            + "membership write and buy nothing");

        output.WriteLine($"[EVIDENCE] === migration ② Up() ===");
        output.WriteLine($"[EVIDENCE] column      = {column.DataType} nullable={column.IsNullable} default={column.Default}");
        output.WriteLine($"[EVIDENCE] pre-existing row reads = {Convert.ToBoolean(granted)} (expect False)");
        output.WriteLine($"[EVIDENCE] indexes naming the column = {indexes.Count} (expect 0)");
    }

    /// <summary>
    /// The plan's "no new RLS" claim, verified rather than trusted. If
    /// <see cref="TenantPolicy"/> were <c>FOR SELECT</c>, or had a null
    /// <c>WITH CHECK</c>, the new column would be writable outside the farm's
    /// scope and the whole "farm-scoped grant" guarantee would rest on
    /// application code alone.
    /// </summary>
    [Fact]
    public async Task The_existing_farm_memberships_tenant_policy_already_covers_the_new_column()
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();

        var policies = await ReadPoliciesAsync(db, "farm_memberships");

        policies.Should().ContainKey(TenantPolicy);
        policies[TenantPolicy].Command.Should().Be("ALL",
            "FOR ALL is what makes the policy govern the UPDATE the grant endpoint performs, not just reads");
        policies[TenantPolicy].Qual.Should().Contain("farm_id");
        policies[TenantPolicy].WithCheck.Should().NotBeNullOrWhiteSpace(
            "without a WITH CHECK an UPDATE could move a row to another farm's scope");
        policies[TenantPolicy].WithCheck.Should().Contain("farm_id");

        // A policy filters on the columns it NAMES. This one names farm_id and
        // nothing else, which is precisely why an additive column needs no
        // policy work — it is inside the existing fence the moment it exists.
        policies[TenantPolicy].Qual.Should().NotContain(ColumnName);
        policies[TenantPolicy].WithCheck.Should().NotContain(ColumnName);

        policies.Should().NotContainKey("p_tenant_farm_member_capabilities",
            "migration ② adds NO new table and NO new policy — the rejected alternative was a "
            + "farm_member_capabilities grant table");

        var (enabled, forced) = await ReadRlsFlagsAsync(db, "ssf.farm_memberships");
        enabled.Should().BeTrue();
        forced.Should().BeTrue("plain ENABLE exempts the table OWNER, and migrations run as the owner");

        output.WriteLine("[EVIDENCE] === no new RLS, existing policy verified ===");
        foreach (var (name, policy) in policies)
        {
            output.WriteLine($"[EVIDENCE] {name}: cmd={policy.Command} using={policy.Qual} check={policy.WithCheck ?? "<null>"}");
        }

        output.WriteLine($"[EVIDENCE] ssf.farm_memberships relrowsecurity={enabled} relforcerowsecurity={forced}");
    }

    /// <summary>
    /// <c>Down()</c> EXECUTED — and the three claims that make dropping honest
    /// here, unlike migrations ① and ③.
    /// </summary>
    [Fact]
    public async Task Down_executes_cleanly_and_the_audit_trail_of_every_grant_survives_it()
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();

        await SeedFarmAsync(db, FarmA, OwnerA, AccountA, "Rollback farm");
        await SeedMembershipAsync(db, FarmA, OwnerA, AccountA, "PrimaryOwner");
        await SeedMembershipAsync(db, FarmA, WorkerA, AccountA, "Worker");

        // A real grant, plus the audit row a real grant writes.
        await using (var grant = db.CreateCommand())
        {
            grant.CommandText =
                $"UPDATE ssf.farm_memberships SET {ColumnName} = TRUE WHERE user_id = @u";
            grant.Parameters.AddWithValue("u", WorkerA);
            (await grant.ExecuteNonQueryAsync()).Should().Be(1);
        }

        var auditId = Guid.NewGuid();
        await SeedAuditEventAsync(db, auditId, FarmA, OwnerA, "LabourManagementGranted");

        var beforeDown = Convert.ToInt64(await ScalarAsync(db,
            $"SELECT COUNT(*) FROM ssf.farm_memberships WHERE {ColumnName}"));
        beforeDown.Should().Be(1, "the precondition: a real grant exists when the rollback runs");

        // ── The rollback, EXECUTED. ──────────────────────────────────────────
        var failure = await AttemptRollbackAsync();
        failure.Should().BeNull(
            "unlike migrations ① and ③ this Down() proceeds: it fabricates nothing (the capability "
            + "simply narrows to owner-tier + Mukadam, so nobody silently GAINS access), it destroys no "
            + "farmer-asserted fact (this is an administrative decision, re-assertable in one tap), and "
            + "the decision itself stays explainable through ssf.audit_events");

        (await ReadColumnAsync(db, ColumnName)).Should().BeNull("the rollback removed the column");

        // Claim 3 — the reason the drop is honest at all.
        var auditSurvives = Convert.ToInt64(await ScalarAsync(db,
            "SELECT COUNT(*) FROM ssf.audit_events WHERE \"Id\" = @id", ("id", auditId)));
        auditSurvives.Should().Be(1,
            "doctrine P3 is satisfied by the audit trail, not by the column: after the rollback the "
            + "system must still be able to say who was trusted and when. If a future change stops "
            + "auditing grants, this Down() must be revisited BEFORE that change ships");

        var membershipsSurvive = Convert.ToInt64(await ScalarAsync(db,
            "SELECT COUNT(*) FROM ssf.farm_memberships"));
        membershipsSurvive.Should().Be(2, "no membership row is harmed by the rollback");

        output.WriteLine("[EVIDENCE] === migration ② Down() EXECUTED ===");
        output.WriteLine($"[EVIDENCE] grants before rollback   = {beforeDown}");
        output.WriteLine($"[EVIDENCE] column after Down()      = <absent>");
        output.WriteLine($"[EVIDENCE] audit_events surviving   = {auditSurvives} (expect 1)");
        output.WriteLine($"[EVIDENCE] farm_memberships surviving = {membershipsSurvive} (expect 2)");

        // ── Re-apply. Every row comes back as "not granted", which is honest:
        //    the rollback threw the grants away, so the system genuinely does
        //    not know them any more and must not pretend otherwise.
        await using (var ssf = NewDbContext())
        {
            await ssf.Database.MigrateAsync();
        }

        (await ReadColumnAsync(db, ColumnName)).Should().NotBeNull("Up() re-applies cleanly");
        Convert.ToInt64(await ScalarAsync(db,
            $"SELECT COUNT(*) FROM ssf.farm_memberships WHERE {ColumnName}"))
            .Should().Be(0,
                "re-applying must NOT resurrect a grant from the audit trail — inventing a live "
                + "permission out of a history row is exactly the fabrication doctrine P4 forbids. The "
                + "owner re-grants deliberately, in one tap");

        output.WriteLine("[EVIDENCE] Up() re-applied — grants restored = 0 (expect 0; nothing is resurrected)");
    }

    // ─────────────────────────────────────────────────────────────────────────

    private ShramSafalDbContext NewDbContext()
        => new(new DbContextOptionsBuilder<ShramSafalDbContext>().UseNpgsql(_superuserConn).Options);

    private async Task<PostgresException?> AttemptRollbackAsync()
    {
        try
        {
            await using var ssf = NewDbContext();
            await ssf.Database.GetService<IMigrator>().MigrateAsync(TargetBeforeCapabilityMigration);
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

    private sealed record ColumnShape(string DataType, string IsNullable, string? Default);

    private static async Task<ColumnShape?> ReadColumnAsync(NpgsqlConnection db, string column)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT data_type, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_schema = 'ssf' AND table_name = 'farm_memberships' AND column_name = @c
            """;
        cmd.Parameters.AddWithValue("c", column);
        await using var reader = await cmd.ExecuteReaderAsync();
        if (!await reader.ReadAsync())
        {
            return null;
        }

        return new ColumnShape(
            reader.GetString(0),
            reader.GetString(1),
            reader.IsDBNull(2) ? null : reader.GetString(2));
    }

    private static async Task<List<string>> ReadIndexNamesMentioningColumnAsync(NpgsqlConnection db)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT indexname FROM pg_indexes
            WHERE schemaname = 'ssf' AND tablename = 'farm_memberships'
              AND indexdef LIKE '%can_manage_labour_records%'
            """;
        var names = new List<string>();
        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            names.Add(reader.GetString(0));
        }

        return names;
    }

    private sealed record PolicyShape(string Command, string Qual, string? WithCheck);

    private static async Task<Dictionary<string, PolicyShape>> ReadPoliciesAsync(
        NpgsqlConnection db, string table)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT policyname, cmd, COALESCE(qual, ''), with_check
            FROM pg_policies WHERE schemaname = 'ssf' AND tablename = @t
            """;
        cmd.Parameters.AddWithValue("t", table);

        var result = new Dictionary<string, PolicyShape>(StringComparer.Ordinal);
        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            result[reader.GetString(0)] = new PolicyShape(
                reader.GetString(1),
                reader.GetString(2),
                reader.IsDBNull(3) ? null : reader.GetString(3));
        }

        return result;
    }

    private static async Task<(bool Enabled, bool Forced)> ReadRlsFlagsAsync(
        NpgsqlConnection db, string qualifiedTable)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = @t::regclass";
        cmd.Parameters.AddWithValue("t", qualifiedTable);
        await using var reader = await cmd.ExecuteReaderAsync();
        (await reader.ReadAsync()).Should().BeTrue($"{qualifiedTable} must exist");
        return (reader.GetBoolean(0), reader.GetBoolean(1));
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

    private static async Task SeedMembershipAsync(
        NpgsqlConnection db, Guid farmId, Guid userId, Guid ownerAccountId, string role)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.farm_memberships
                ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status)
            VALUES (@id, @farm, @user, @role, NOW(), NOW(), @account, 3);
            """;
        cmd.Parameters.AddWithValue("id", Guid.NewGuid());
        cmd.Parameters.AddWithValue("farm", farmId);
        cmd.Parameters.AddWithValue("user", userId);
        cmd.Parameters.AddWithValue("role", role);
        cmd.Parameters.AddWithValue("account", ownerAccountId);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task SeedAuditEventAsync(
        NpgsqlConnection db, Guid auditId, Guid farmId, Guid actorUserId, string action)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.audit_events
                ("Id", entity_type, entity_id, action, actor_user_id, actor_role, payload,
                 farm_id, occurred_at_utc, app_version, device_id, ip_hash)
            VALUES (@id, 'FarmMembership', @entity, @action, @actor, 'primaryowner', '{}',
                 @farm, NOW(), 'test', 'device-test', 'sha256:test');
            """;
        cmd.Parameters.AddWithValue("id", auditId);
        cmd.Parameters.AddWithValue("entity", Guid.NewGuid());
        cmd.Parameters.AddWithValue("action", action);
        cmd.Parameters.AddWithValue("actor", actorUserId);
        cmd.Parameters.AddWithValue("farm", farmId);
        await cmd.ExecuteNonQueryAsync();
    }
}
