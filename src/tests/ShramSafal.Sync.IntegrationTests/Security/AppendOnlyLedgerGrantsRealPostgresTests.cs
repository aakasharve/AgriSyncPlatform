// spec: 2026-08-25-prod-cutover-waves
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;
using ShramSafal.Infrastructure.Persistence;
using ShramSafal.Infrastructure.Persistence.Migrations;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Security;

/// <summary>
/// The append-only ledgers, proven append-only by the EFFECTIVE privilege of the
/// real application role — not by the text of a GRANT.
///
/// <para><b>Why the earlier guard missed it.</b> <c>AttendanceAttachabilityRules</c>
/// pinned the creating migration's <c>GRANT SELECT, INSERT</c> text and that no GRANT
/// widened it. Both were true and the table was still writable:
/// <c>20260515090000_BootstrapDbRoles</c>' default privileges hand every new <c>ssf</c>
/// table <c>SELECT, INSERT, UPDATE, DELETE</c> for the app role, and a GRANT never
/// removes anything. Only asking the database (<c>has_table_privilege</c>) and issuing
/// the statement show what the role can do, so that is all this class trusts.</para>
///
/// <para><b>Three database shapes, because one migration meets all three.</b></para>
/// <list type="bullet">
/// <item><b>Fresh</b> — the chain runs as a superuser (this harness, CI): the table is
/// superuser-owned and the app role's UPDATE/DELETE come from default privileges.</item>
/// <item><b>App-owned</b> — the chain runs as the application role: the table is OWNED
/// by it and the owner's default ACL adds TRUNCATE. Reproduced here by transferring
/// ownership inside the scratch database, and the migration's SQL is executed AS the
/// app role, as that runner would.</item>
/// <item><b>Inherited</b> — the app role is a MEMBER of the role that owns the table.
/// A REVOKE on the app role cannot touch what it inherits, so the migration must stop
/// rather than record success. Reproduced with a test-unique owner role that is
/// removed again in a <c>finally</c>.</item>
/// </list>
///
/// <para><b>Doctrine E3.</b> Every privilege and statement proof runs on the
/// <c>agrisync_app</c> connection, and each fact first asserts that role is neither
/// superuser nor BYPASSRLS. Seeding and catalog reads use the superuser connection.</para>
///
/// <para><b>Native :5433, fail-loud.</b> <c>RequiresPostgres</c>; each fact builds its
/// own scratch database from the full migration chain and drops it afterwards.</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class AppendOnlyLedgerGrantsRealPostgresTests(Xunit.Abstractions.ITestOutputHelper output)
    : IAsyncLifetime
{
    private const string RoleVacuityGuardSql =
        "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user";

    private const string AppRoleUser = TestRoleCredentials.AppRoleUser;
    private static string AppRolePassword => TestRoleCredentials.AppRolePassword;

    private const string ThisMigration = "20261017080742_EnforceAppendOnlyLedgerGrants";
    private const string MigrationBefore = "20261015060121_WidenVoiceClipRetainedDekId";

    private const string Corrections = "ssf.attendance_mark_corrections";

    /// <summary>
    /// Every ssf ledger whose own migration declares it append-only BY PRIVILEGE. Stated
    /// here independently of the migration's SQL on purpose: this list is the
    /// expectation, the migration is the implementation.
    /// </summary>
    private static readonly string[] AppendOnlyLedgers =
    [
        "ssf.attendance_mark_corrections",
        "ssf.audit_events",
        "ssf.correction_events",
        "ssf.ai_job_attempts",
        "ssf.cross_border_transfers",
        "ssf.consent_audit",
        "ssf.question_events",
        "ssf.terms_acceptance_events",
        "ssf.consent_grant_events",
    ];

    private static readonly string[] ForbiddenPrivileges = ["UPDATE", "DELETE", "TRUNCATE"];

    /// <summary>
    /// ShramSafal migrations applied AFTER this one, reviewed as safe to revert and
    /// re-apply inside a per-fact scratch database. The facts below drive the migrator
    /// back to <see cref="MigrationBefore"/>, which reverts everything after it.
    /// Add an entry only after reading its Down(); never delete the guard.
    /// </summary>
    private static readonly string[] ReviewedMigrationsAfterThisOne = [];

    private static readonly Guid Farm = Guid.Parse("a0a00000-1111-4111-8111-000000000001");
    private static readonly Guid Mark = Guid.Parse("a0a00000-2222-4222-8222-000000000001");
    private static readonly Guid Farmer = Guid.Parse("a0a00000-3333-4333-8333-000000000001");
    private static readonly Guid PlantedCorrection = Guid.Parse("a0a00000-4444-4444-8444-000000000001");

    private string _adminConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private string _superuserConn = string.Empty;
    private string _appConn = string.Empty;

    public async Task InitializeAsync()
    {
        _adminConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();

        _scratchDbName = $"ssf_ledger_grants_{Guid.NewGuid():N}";
        await using (var admin = new NpgsqlConnection(_adminConn))
        {
            await admin.OpenAsync();
            await using var create = admin.CreateCommand();
            create.CommandText = $"CREATE DATABASE \"{_scratchDbName}\"";
            await create.ExecuteNonQueryAsync();
        }

        _superuserConn = new NpgsqlConnectionStringBuilder(_adminConn) { Database = _scratchDbName }.ConnectionString;
        _appConn = new NpgsqlConnectionStringBuilder(_superuserConn)
        {
            Username = AppRoleUser,
            Password = AppRolePassword,
        }.ConnectionString;

        await IntegrationMigrationChain.ApplyAsync(_superuserConn);
        await AssertAppRoleIsNotVacuousAsync(quiet: true);

        // One real correction row, planted as superuser (RLS bypassed), so every
        // UPDATE/DELETE/TRUNCATE below has something to change or destroy.
        await ExecuteAsSuperuserAsync($"""
            INSERT INTO {Corrections}
                ("Id", attendance_mark_id, farm_id, changed_field, original_value, new_value,
                 corrected_by_user_id, corrected_at_utc)
            VALUES (@id, @mark, @farm, 'day_mark', 'Full', 'Half', @farmer, NOW());
            """, ("id", PlantedCorrection), ("mark", Mark), ("farm", Farm), ("farmer", Farmer));
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
            await using var drop = admin.CreateCommand();
            drop.CommandText = $"DROP DATABASE IF EXISTS \"{_scratchDbName}\" WITH (FORCE)";
            await drop.ExecuteNonQueryAsync();
        }
        catch
        {
            // Best-effort teardown; a leaked scratch database is harmless.
        }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // 1. The whole privilege-append-only family, as the app role sees it.
    // ═════════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task No_append_only_ledger_lets_the_app_role_update_delete_or_truncate_but_every_one_still_appends_and_reads()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var held = new List<string>();
        var missing = new List<string>();
        output.WriteLine("[EVIDENCE] === effective privileges of agrisync_app, asked on its own connection ===");
        foreach (var ledger in AppendOnlyLedgers)
        {
            var row = new List<string>();
            foreach (var privilege in new[] { "SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE" })
            {
                var has = await AppHasPrivilegeAsync(ledger, privilege);
                row.Add($"{privilege}={has}");
                if (ForbiddenPrivileges.Contains(privilege) && has)
                {
                    held.Add($"{ledger} {privilege}");
                }

                if (privilege is "SELECT" or "INSERT" && !has)
                {
                    missing.Add($"{ledger} {privilege}");
                }
            }

            var (owner, acl) = await ReadOwnerAndAclAsync(ledger);
            output.WriteLine($"[EVIDENCE] {ledger,-34} {string.Join(" ", row)}  owner={owner} acl={acl}");
        }

        held.Should().BeEmpty(
            "a ledger that answers 'what did it say before' cannot be rewritable by the role every "
            + "request runs as. Before 20261017080742 ssf.attendance_mark_corrections failed this: its "
            + "migration granted only SELECT, INSERT, but BootstrapDbRoles' default privileges had "
            + "already handed the app role UPDATE and DELETE");
        missing.Should().BeEmpty(
            "and the fix must not over-reach: appending and reading are what these ledgers are for, "
            + "and a revoke that took INSERT would silently stop the history being recorded at all");

        // Recorded, not asserted: the one documented append-only table deliberately left
        // out of the migration, because creator erasure UPDATEs it by design.
        output.WriteLine(
            $"[EVIDENCE] NOT IN SCOPE ssf.labour_corrections UPDATE={await AppHasPrivilegeAsync("ssf.labour_corrections", "UPDATE")} "
            + "(ErasureWorker.AnonymizeLabourCorrectionsAsync relies on it; founder ruling 2026-08-27)");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // 2. The defect and the fix, executed — produced by the migration's own
    //    Down() and Up(), so this cannot pass with an empty Up().
    // ═════════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task The_attendance_correction_ledger_could_be_rewritten_before_the_migration_and_is_refused_after_it()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await AssertNoUnreviewedMigrationAfterThisOneAsync();

        var rowsBefore = await CountCorrectionsAsSuperuserAsync();
        rowsBefore.Should().Be(1, "the planted row must exist, or a refused DELETE proves nothing");

        // ═════ BEFORE: the migration's own Down() reproduces the shipped state. ═════
        await MigrateShramSafalToAsync(MigrationBefore);

        (await AppHasPrivilegeAsync(Corrections, "UPDATE")).Should().BeTrue(
            "LOADABILITY of the defect: on a freshly migrated database the app role holds UPDATE "
            + "through BootstrapDbRoles' default privileges");
        (await AppHasPrivilegeAsync(Corrections, "DELETE")).Should().BeTrue("and DELETE the same way");

        var updatedBefore = await TryAsAppAsync(
            $"UPDATE {Corrections} SET new_value = 'Absent' WHERE \"Id\" = @id");
        var deletedBefore = await TryAsAppAsync(
            $"DELETE FROM {Corrections} WHERE \"Id\" = @id");
        updatedBefore.Error.Should().BeNull("the defect, executed: the app role could rewrite history");
        updatedBefore.Affected.Should().Be(1);
        deletedBefore.Error.Should().BeNull("and could erase it");
        deletedBefore.Affected.Should().Be(1);
        (await CountCorrectionsAsSuperuserAsync()).Should().Be(rowsBefore,
            "both probes ran in transactions that were rolled back");

        // ═════ AFTER: the migration's own Up(). ═════════════════════════════════════
        await MigrateShramSafalToAsync(null);

        foreach (var privilege in ForbiddenPrivileges)
        {
            (await AppHasPrivilegeAsync(Corrections, privilege)).Should().BeFalse(
                $"{privilege} must be gone at the catalog after Up()");
        }

        // A catalog bit is not an enforcement proof. Issue the statements.
        var update = await TryAsAppAsync(
            $"UPDATE {Corrections} SET new_value = 'Absent' WHERE \"Id\" = @id");
        var delete = await TryAsAppAsync($"DELETE FROM {Corrections} WHERE \"Id\" = @id");
        var truncate = await TryAsAppAsync($"TRUNCATE {Corrections}");

        foreach (var (verb, attempt) in new[] { ("UPDATE", update), ("DELETE", delete), ("TRUNCATE", truncate) })
        {
            attempt.Error.Should().NotBeNull($"{verb} as agrisync_app must be REFUSED, not merely un-granted on paper");
            attempt.Error!.SqlState.Should().Be("42501",
                $"{verb} must be refused by the privilege system (insufficient_privilege), not fail for an "
                + "incidental reason another cluster might not have");
        }

        (await CountCorrectionsAsSuperuserAsync()).Should().Be(rowsBefore, "the refused statements destroyed nothing");

        // ── The other half: the real write still lands, and reads back. ──────────
        var appended = await AppendCorrectionAsAppAsync();
        appended.Should().Be(1, "INSERT is the ledger's purpose; a fix that took it would silence corrections");
        var readBack = await CountVisibleCorrectionsAsAppAsync();
        readBack.Should().Be(2, "SELECT still returns the planted row and the one just appended");

        output.WriteLine("[EVIDENCE] === attendance_mark_corrections, fresh shape (owner = migration superuser) ===");
        output.WriteLine($"[EVIDENCE] after Down(): UPDATE affected={updatedBefore.Affected} DELETE affected={deletedBefore.Affected} (both rolled back)");
        output.WriteLine($"[EVIDENCE] after Up():   UPDATE->{update.Error!.SqlState} DELETE->{delete.Error!.SqlState} TRUNCATE->{truncate.Error!.SqlState} (expect 42501 x3)");
        output.WriteLine($"[EVIDENCE] after Up():   INSERT affected={appended} rows visible to app={readBack} rows stored={await CountCorrectionsAsSuperuserAsync()}");
        output.WriteLine($"[EVIDENCE] acl after Up(): {(await ReadOwnerAndAclAsync(Corrections)).Acl}");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // 3. App-owned: the shape where the application role runs the migrations.
    // ═════════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task Where_the_app_role_owns_the_ledger_the_revoke_binds_its_statements_and_the_owner_regrant_limit_is_recorded()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await AssertNoUnreviewedMigrationAfterThisOneAsync();

        await MigrateShramSafalToAsync(MigrationBefore);
        await ExecuteAsSuperuserAsync($"ALTER TABLE {Corrections} OWNER TO {AppRoleUser}");

        var (ownerBefore, aclBefore) = await ReadOwnerAndAclAsync(Corrections);
        ownerBefore.Should().Be(AppRoleUser);
        foreach (var privilege in ForbiddenPrivileges)
        {
            (await AppHasPrivilegeAsync(Corrections, privilege)).Should().BeTrue(
                $"LOADABILITY: as owner the app role holds {privilege}, TRUNCATE included — TRUNCATE is "
                + "not a row operation, so row level security never sees it");
        }

        // The migration's Up() SQL, executed BY the app role, as an app-role runner would.
        var notices = await RunMigrationSqlAsync(_appConn, EnforceAppendOnlyLedgerGrants.UpSql);

        foreach (var privilege in ForbiddenPrivileges)
        {
            (await AppHasPrivilegeAsync(Corrections, privilege)).Should().BeFalse(
                $"revoking from the owner's own ACL entry removes {privilege} from its statements");
        }

        var update = await TryAsAppAsync($"UPDATE {Corrections} SET new_value = 'Absent' WHERE \"Id\" = @id");
        var truncate = await TryAsAppAsync($"TRUNCATE {Corrections}");
        update.Error.Should().NotBeNull("the owner's UPDATE must now be refused");
        update.Error!.SqlState.Should().Be("42501");
        truncate.Error.Should().NotBeNull("and its TRUNCATE");
        truncate.Error!.SqlState.Should().Be("42501");
        (await AppendCorrectionAsAppAsync()).Should().Be(1, "while the append still lands");

        notices.Should().Contain(n => n.Severity == "WARNING"
                && n.Text.Contains($"{Corrections} is owned by {AppRoleUser}", StringComparison.Ordinal),
            "the migration must SAY that containment holds against the app role's statements but not "
            + "against an owner, rather than let a green run imply more than it proved");

        // ── The known limit, recorded so nobody reads this ledger as owner-proof. ──
        var regrant = await TryAsAppAsync(
            $"GRANT UPDATE ON {Corrections} TO {AppRoleUser}; "
            + $"UPDATE {Corrections} SET new_value = 'Absent' WHERE \"Id\" = @id");
        regrant.Error.Should().BeNull(
            "RECORDED, NOT FIXED: an owner can always re-grant to itself. If this ever fails, ledger "
            + "ownership was moved off the app role — update the role-model decision record");
        regrant.Affected.Should().Be(1);
        (await AppHasPrivilegeAsync(Corrections, "UPDATE")).Should().BeFalse("the re-grant was rolled back");

        // ── Down() restores exactly the owner-default state, and Up() closes it again. ──
        await RunMigrationSqlAsync(_appConn, EnforceAppendOnlyLedgerGrants.DownSql);
        var restored = new Dictionary<string, bool>();
        foreach (var privilege in ForbiddenPrivileges)
        {
            restored[privilege] = await AppHasPrivilegeAsync(Corrections, privilege);
            restored[privilege].Should().BeTrue(
                $"where the app role owns the table, Down() gives back {privilege} — exactly what ownership "
                + "gave before Up()");
        }

        await RunMigrationSqlAsync(_appConn, EnforceAppendOnlyLedgerGrants.UpSql);
        (await AppHasPrivilegeAsync(Corrections, "TRUNCATE")).Should().BeFalse("and Up() is repeatable");

        output.WriteLine("[EVIDENCE] === attendance_mark_corrections, app-owned shape (Up SQL run AS agrisync_app) ===");
        output.WriteLine($"[EVIDENCE] before: owner={ownerBefore} acl={aclBefore}");
        output.WriteLine($"[EVIDENCE] after:  acl={(await ReadOwnerAndAclAsync(Corrections)).Acl}");
        output.WriteLine($"[EVIDENCE] UPDATE->{update.Error?.SqlState} TRUNCATE->{truncate.Error?.SqlState} (expect 42501)");
        output.WriteLine($"[EVIDENCE] owner self-regrant then UPDATE: affected={regrant.Affected} (RECORDED LIMIT, rolled back)");
        output.WriteLine($"[EVIDENCE] Down() restored: {string.Join(" ", restored.Select(kv => $"{kv.Key}={kv.Value}"))}");
        foreach (var notice in notices.Where(n => n.Severity == "WARNING"))
        {
            output.WriteLine($"[EVIDENCE] migration WARNING: {notice.Text}");
        }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // 4. Inherited: the app role is a member of the role that owns the ledger.
    // ═════════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task When_the_app_role_inherits_the_privilege_through_membership_the_migration_refuses_instead_of_recording_success()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await AssertNoUnreviewedMigrationAfterThisOneAsync();

        // Roles are CLUSTER-wide: a unique name, owning objects only in this scratch
        // database, removed in the finally below.
        var ownerRole = $"ssf_test_ledger_owner_{Guid.NewGuid():N}";
        try
        {
            await MigrateShramSafalToAsync(MigrationBefore);
            await ExecuteAsSuperuserAsync($"""
                CREATE ROLE {ownerRole} NOLOGIN;
                GRANT {ownerRole} TO {AppRoleUser};
                ALTER TABLE {Corrections} OWNER TO {ownerRole};
                """);

            PostgresException? refusal = null;
            try
            {
                await RunMigrationSqlAsync(_superuserConn, EnforceAppendOnlyLedgerGrants.UpSql);
            }
            catch (PostgresException ex)
            {
                refusal = ex;
            }

            refusal.Should().NotBeNull(
                "a REVOKE on agrisync_app cannot remove what it inherits from the owner role, so the "
                + "migration must stop rather than enter the history claiming an append-only ledger");
            refusal!.SqlState.Should().Be("P0001", "the refusal is the guard's own RAISE EXCEPTION");
            refusal.MessageText.Should().Contain(
                $"{Corrections} UPDATE via {ownerRole} (inherited by membership, table owner)",
                "the refusal must name the table, the privilege and the role it still flows through");
            refusal.MessageText.Should().Contain($"{Corrections} DELETE via {ownerRole}");
            refusal.MessageText.Should().Contain($"{Corrections} TRUNCATE via {ownerRole}");

            // The refusal reflects reality: the privilege really is still exercisable.
            var update = await TryAsAppAsync(
                $"UPDATE {Corrections} SET new_value = 'Absent' WHERE \"Id\" = @id");
            update.Error.Should().BeNull(
                "the app role can genuinely still rewrite the row through the membership — which is "
                + "exactly why the migration refused to report success");
            update.Affected.Should().Be(1);

            output.WriteLine("[EVIDENCE] === attendance_mark_corrections, inherited shape (app role is a member of the owner) ===");
            output.WriteLine($"[EVIDENCE] migration refused: SQLSTATE={refusal.SqlState}");
            output.WriteLine($"[EVIDENCE] message: {refusal.MessageText.Replace(ownerRole, "<test-owner-role>")}");
            output.WriteLine($"[EVIDENCE] hint: {refusal.Hint}");
            output.WriteLine($"[EVIDENCE] UPDATE as agrisync_app through the membership: affected={update.Affected} (rolled back)");
        }
        finally
        {
            await DropTestRoleAsync(ownerRole);
        }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Harness
    // ═════════════════════════════════════════════════════════════════════════

    private async Task AssertNoUnreviewedMigrationAfterThisOneAsync()
    {
        var opts = new DbContextOptionsBuilder<ShramSafalDbContext>().UseNpgsql(_superuserConn).Options;
        await using var ctx = new ShramSafalDbContext(opts);
        var applied = await ctx.Database.GetAppliedMigrationsAsync();
        applied.Should().Contain(ThisMigration, "the migration under test must be part of the chain");

        var after = applied.Where(m => string.CompareOrdinal(m, ThisMigration) > 0).ToList();
        after.Should().BeSubsetOf(ReviewedMigrationsAfterThisOne,
            "these facts drive the migrator back past this migration and forward again, so every later "
            + "migration is reverted and re-applied inside the proof. Review its Down() and add it to "
            + "ReviewedMigrationsAfterThisOne — do not delete this guard. Unreviewed: "
            + string.Join(", ", after.Except(ReviewedMigrationsAfterThisOne)));
    }

    private async Task MigrateShramSafalToAsync(string? targetMigration)
    {
        var opts = new DbContextOptionsBuilder<ShramSafalDbContext>().UseNpgsql(_superuserConn).Options;
        await using var ctx = new ShramSafalDbContext(opts);
        if (targetMigration is null)
        {
            await ctx.Database.MigrateAsync();
        }
        else
        {
            await ctx.Database.GetService<IMigrator>().MigrateAsync(targetMigration);
        }
    }

    /// <summary>
    /// Runs migration SQL in one transaction, as a migrator would, and returns every
    /// notice and warning it raised.
    /// </summary>
    private static async Task<List<(string Severity, string Text)>> RunMigrationSqlAsync(string connection, string sql)
    {
        var notices = new List<(string Severity, string Text)>();
        await using var db = new NpgsqlConnection(connection);
        db.Notice += (_, e) => notices.Add((e.Notice.InvariantSeverity, e.Notice.MessageText));
        await db.OpenAsync();
        await using var tx = await db.BeginTransactionAsync();
        await using (var cmd = db.CreateCommand())
        {
            cmd.CommandText = sql;
            await cmd.ExecuteNonQueryAsync();
        }

        await tx.CommitAsync();
        return notices;
    }

    /// <summary>
    /// Runs <paramref name="sql"/> as agrisync_app inside a transaction scoped to the
    /// planted row's farm (FORCE RLS would otherwise hide it) and ALWAYS rolls it back,
    /// so a probe that succeeds destroys nothing. <c>@id</c> is the planted row.
    /// Returns rows affected, or the refusal.
    /// </summary>
    private async Task<(int Affected, PostgresException? Error)> TryAsAppAsync(string sql)
    {
        await using var db = new NpgsqlConnection(_appConn);
        await db.OpenAsync();
        await using var tx = await db.BeginTransactionAsync();
        try
        {
            await SetFarmGucAsync(db);
            await using var cmd = db.CreateCommand();
            cmd.CommandText = sql;
            if (sql.Contains("@id", StringComparison.Ordinal))
            {
                cmd.Parameters.AddWithValue("id", PlantedCorrection);
            }

            var affected = await cmd.ExecuteNonQueryAsync();
            return (affected, null);
        }
        catch (PostgresException ex)
        {
            return (0, ex);
        }
        finally
        {
            await tx.RollbackAsync();
        }
    }

    /// <summary>The ledger's real write: one correction row, as agrisync_app, committed.</summary>
    private async Task<int> AppendCorrectionAsAppAsync()
    {
        await using var db = new NpgsqlConnection(_appConn);
        await db.OpenAsync();
        await using var tx = await db.BeginTransactionAsync();
        await SetFarmGucAsync(db);
        await using var cmd = db.CreateCommand();
        cmd.CommandText = $"""
            INSERT INTO {Corrections}
                ("Id", attendance_mark_id, farm_id, changed_field, original_value, new_value,
                 corrected_by_user_id, corrected_at_utc)
            VALUES (@id, @mark, @farm, 'night_mark', 'Unmarked', 'Worked', @farmer, NOW());
            """;
        cmd.Parameters.AddWithValue("id", Guid.NewGuid());
        cmd.Parameters.AddWithValue("mark", Mark);
        cmd.Parameters.AddWithValue("farm", Farm);
        cmd.Parameters.AddWithValue("farmer", Farmer);
        var affected = await cmd.ExecuteNonQueryAsync();
        await tx.CommitAsync();
        return affected;
    }

    private async Task<long> CountVisibleCorrectionsAsAppAsync()
    {
        await using var db = new NpgsqlConnection(_appConn);
        await db.OpenAsync();
        await using var tx = await db.BeginTransactionAsync();
        await SetFarmGucAsync(db);
        await using var cmd = db.CreateCommand();
        cmd.CommandText = $"SELECT COUNT(*) FROM {Corrections} WHERE farm_id = @farm";
        cmd.Parameters.AddWithValue("farm", Farm);
        var count = Convert.ToInt64(await cmd.ExecuteScalarAsync());
        await tx.RollbackAsync();
        return count;
    }

    private static async Task SetFarmGucAsync(NpgsqlConnection db)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT set_config('agrisync.farm_id', @farm, true)";
        cmd.Parameters.AddWithValue("farm", Farm.ToString());
        await cmd.ExecuteScalarAsync();
    }

    private async Task<long> CountCorrectionsAsSuperuserAsync()
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = $"SELECT COUNT(*) FROM {Corrections}";
        return Convert.ToInt64(await cmd.ExecuteScalarAsync());
    }

    /// <summary>Asked on the app connection about itself, so it cannot be a superuser's view.</summary>
    private async Task<bool> AppHasPrivilegeAsync(string table, string privilege)
    {
        await using var db = new NpgsqlConnection(_appConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT has_table_privilege(current_user, @t, @p)";
        cmd.Parameters.AddWithValue("t", table);
        cmd.Parameters.AddWithValue("p", privilege);
        return Convert.ToBoolean(await cmd.ExecuteScalarAsync());
    }

    private async Task<(string Owner, string Acl)> ReadOwnerAndAclAsync(string table)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText =
            "SELECT pg_get_userbyid(relowner), COALESCE(relacl::text, '(owner default)') "
            + "FROM pg_class WHERE oid = @t::regclass";
        cmd.Parameters.AddWithValue("t", table);
        await using var reader = await cmd.ExecuteReaderAsync();
        await reader.ReadAsync();
        return (reader.GetString(0), reader.GetString(1));
    }

    private async Task ExecuteAsSuperuserAsync(string sql, params (string Name, object Value)[] args)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in args)
        {
            cmd.Parameters.AddWithValue(name, value);
        }

        await cmd.ExecuteNonQueryAsync();
    }

    /// <summary>
    /// Removes the test-unique owner role: hand anything it owns in the scratch database
    /// back to the superuser, drop its privileges there, then drop the role (which also
    /// removes the membership edge). Asserts it is gone, so a leak fails loudly.
    /// </summary>
    private async Task DropTestRoleAsync(string role)
    {
        await using (var scratch = new NpgsqlConnection(_superuserConn))
        {
            await scratch.OpenAsync();
            await using var cmd = scratch.CreateCommand();
            cmd.CommandText = $"""
                DO $$
                BEGIN
                    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '{role}') THEN
                        EXECUTE 'REASSIGN OWNED BY {role} TO ' || quote_ident(current_user);
                        EXECUTE 'DROP OWNED BY {role}';
                        EXECUTE 'DROP ROLE {role}';
                    END IF;
                END $$;
                """;
            await cmd.ExecuteNonQueryAsync();
        }

        await using var check = new NpgsqlConnection(_superuserConn);
        await check.OpenAsync();
        await using var count = check.CreateCommand();
        count.CommandText = "SELECT COUNT(*) FROM pg_roles WHERE rolname = @r";
        count.Parameters.AddWithValue("r", role);
        Convert.ToInt64(await count.ExecuteScalarAsync()).Should().Be(0,
            "the cluster-wide test role must not outlive the fact");
    }

    private async Task AssertAppRoleIsNotVacuousAsync(bool quiet = false)
    {
        await using var db = new NpgsqlConnection(_appConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT current_user";
        var role = Convert.ToString(await cmd.ExecuteScalarAsync());
        cmd.CommandText = RoleVacuityGuardSql;
        var superOrBypass = Convert.ToBoolean(await cmd.ExecuteScalarAsync());

        role.Should().Be(AppRoleUser, "the proofs must run as the role the API actually connects as");
        superOrBypass.Should().BeFalse(
            "doctrine E3 — a privilege proof taken as a superuser or BYPASSRLS role passes for the wrong reason");
        if (!quiet)
        {
            output.WriteLine($"[EVIDENCE] role guard: current_user='{role}' rolsuper OR rolbypassrls={superOrBypass} (required False)");
        }
    }
}
