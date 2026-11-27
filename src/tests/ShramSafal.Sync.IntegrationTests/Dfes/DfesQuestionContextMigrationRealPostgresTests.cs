// spec: plr-d10-redesign-real-integration-2026-10-25 (lane DFES-Q, task 3) - the migration's own Down() and Up() on real Postgres.
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
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Dfes;

/// <summary>
/// <c>20261121032701_AddDfesQuestionContext</c>, driven by its own <c>Down()</c> and <c>Up()</c> on a real database.
///
/// <para><b>What it proves.</b> Up adds only nullable columns to <c>ssf.question_events</c> (so a row an old phone wrote keeps
/// working and reads back with the new fields empty), keeps that ledger append-only, and creates
/// <c>ssf.question_photo_checks</c> append-only by privilege under FORCE RLS. Down removes exactly what Up added and nothing
/// else: the old row survives both directions. Up runs a second time cleanly after Down.</para>
///
/// <para><b>Posture.</b> <c>RequiresPostgres</c>, fail-loud; its own scratch database from the full chain, dropped after.
/// Catalog checks ask <c>has_table_privilege</c> for the real app role, not the ACL text.</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class DfesQuestionContextMigrationRealPostgresTests(Xunit.Abstractions.ITestOutputHelper output)
    : IAsyncLifetime
{
    private const string ThisMigration = "20261121032701_AddDfesQuestionContext";
    private const string MigrationBefore = "20261120111737_AddPlotGroupName";

    /// <summary>
    /// The migrations after this one whose Down() was read in full and leaves everything asserted here alone.
    /// 20261123020241_AddScheduleTaskFormat (plr-d10 schedule slice 2): two new tables and two nullable columns on schedule_template_stages; Down() refuses while any row
    /// of them exists (none does in this proof) and otherwise drops exactly what Up() added. It touches no question table.
    /// 20261123040137_AddOwnScheduleItems (plr-d10 schedule slice 3): two new tables (own works and their revisions) and their trigger function; Down() refuses while any
    /// row of them exists (none does in this proof) and otherwise drops exactly what Up() added. It touches no question table.
    /// 20261123071136_AddScheduleFeed (plr-d10 schedule slice 5): nullable link columns, partial indexes, CHECKs and a trigger on planned_work, and the new
    /// schedule_task_events table; Down() refuses while any linked plan or answer exists (none does in this proof) and otherwise drops exactly what Up() added. It
    /// touches no question table.
    /// </summary>
    /// 20261123113122_AddScheduleReferenceFormat (plr-d10 schedule slice 7): four nullable columns (a chain on schedule_templates; ticked keys and a content hash on schedule_checks) and one index;
    /// Down() refuses while any of them holds a value (none does in this proof) and otherwise drops exactly what Up() added. It touches no question table.
    // 20261124090000_SetVoiceProvidersToSarvam (voice-instant-phase-a-2026-11-23): one data-only UPDATE of ssf.ai_provider_configs each way; it touches no question table.
    // 20261124124837_AddOwnScheduleItemOrigins (plr-d10 schedule slice 9): one new table (where a taken own work came from); Down() refuses while any row exists (none does in this proof) and otherwise drops exactly what Up() added. It touches no question table.
    // 20261124220806_AddOwnScheduleSeasonCarries (plr-d10 schedule slice 11): one new table (the season-end review answers); Down() refuses while any row exists (none does in this proof) and otherwise drops exactly what Up() added. It touches no question table.
    // 20261125030530_AddScheduleOwnerVoice (plr-d10 schedule slice 12b): three new tables (the owner's clips, messages and the farms' state of each) and one nullable column on own_schedule_item_revisions; Down() refuses while any row exists (none does in this proof) and otherwise drops exactly what Up() added. It touches no question table.
    // 20261125120000_AddScheduleTotals (plr-d10 schedule slice 13): one new table (the totals exclusion list), one SECURITY DEFINER function and one owner-only SELECT policy per schedule table; Down() refuses while the list has any row (none does in this proof) and otherwise drops exactly what Up() added. It touches no question table.
    // 20261127020000_AddFarmSetup (plr-d10 repair D-9): six new tables (a farm's water sources, motors, power times, machines and plot water); Down() refuses while any row exists (none does in this proof) and otherwise drops exactly what Up() added. It touches no question table.
    // 20261127021000_AddFarmOwnBillApprovalSwitch (plr-d10 repair D-177): one boolean column on ssf.farms (default false); Down() refuses while any farm has it on (none does in this proof) and otherwise drops the column. It touches no question table.
    // 20261127040000_AddLgdPlaceList (plr-d10 pilot lane IDENT, S2): a User-context migration (public schema; the ShramSafal migrator never reverts or re-applies it): four new reference tables (the government village list); Down() drops exactly those four tables. It touches no question table.
    private static readonly string[] ReviewedLaterMigrations = ["20261123020241_AddScheduleTaskFormat", "20261123040137_AddOwnScheduleItems", "20261123071136_AddScheduleFeed", "20261123113122_AddScheduleReferenceFormat", "20261124090000_SetVoiceProvidersToSarvam", "20261124124837_AddOwnScheduleItemOrigins", "20261124220806_AddOwnScheduleSeasonCarries", "20261125030530_AddScheduleOwnerVoice", "20261125120000_AddScheduleTotals", "20261127020000_AddFarmSetup", "20261127021000_AddFarmOwnBillApprovalSwitch", "20261127040000_AddLgdPlaceList"];
    private const string AppRole = "agrisync_app";

    private static readonly string[] NewColumns =
    [
        "asked_user_id", "prompt_text", "prompt_origin", "question_kind", "source_refs",
        "schedule_card_ref", "deviation_reason_code", "deviation_challenge", "photo_attachment_id",
    ];

    private static readonly Guid Farm = Guid.Parse("d0d00000-1111-4111-8111-000000000001");
    private static readonly Guid OldPhoneRow = Guid.Parse("d0d00000-2222-4222-8222-000000000001");

    private string _adminConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private string _superuserConn = string.Empty;

    public async Task InitializeAsync()
    {
        _adminConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();
        _scratchDbName = $"ssf_dfes_ctx_mig_{Guid.NewGuid():N}";
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
            await using var drop = admin.CreateCommand();
            drop.CommandText = $"DROP DATABASE IF EXISTS \"{_scratchDbName}\" WITH (FORCE)";
            await drop.ExecuteNonQueryAsync();
        }
        catch
        {
            // Best-effort teardown; a leaked scratch database is harmless.
        }
    }

    [Fact]
    public async Task Down_removes_only_what_Up_added_and_an_old_phone_row_survives_both_ways()
    {
        var applied = await AppliedShramSafalMigrationsAsync();
        // Down to MigrationBefore reverts this migration AND every later one, so every later one must be a migration whose Down() is reviewed to leave what
        // this proof asserts alone (it used to be the head of the chain: applied.Last() == ThisMigration).
        applied.Should().Contain(ThisMigration);
        applied.Where(m => string.CompareOrdinal(m, ThisMigration) > 0).Should().BeSubsetOf(ReviewedLaterMigrations,
            "a later migration is reverted and re-applied with this one inside the proof: review its Down() and add it to ReviewedLaterMigrations");

        // ═════ Down(): the shape an old server and an old phone know. ═════
        await MigrateShramSafalToAsync(MigrationBefore);
        (await QuestionEventColumnsAsync()).Keys.Should().NotContain(NewColumns);
        (await RelationExistsAsync("ssf.question_photo_checks")).Should().BeFalse();
        (await IndexExistsAsync("ix_question_events_farm_asked_user")).Should().BeFalse();
        output.WriteLine("[EVIDENCE] after Down(): none of the nine columns, no question_photo_checks, no index");

        await InsertOldShapeQuestionEventAsync();

        // ═════ Up(): additive only. ═════
        await MigrateShramSafalToAsync(null);
        var columns = await QuestionEventColumnsAsync();
        foreach (var column in NewColumns)
        {
            columns.Should().ContainKey(column);
            columns[column].Should().Be("YES", $"{column} must be nullable so a row without it stays valid");
        }

        (await CountNonNullNewColumnsOnOldRowAsync()).Should().Be(0,
            "the row written in the old shape reads back with every new field empty, nothing invented");
        (await CountOldRowAsync()).Should().Be(1);

        (await ForceRlsAsync("ssf.question_photo_checks")).Should().Be((true, true));
        (await PolicyExistsAsync("question_photo_checks", "p_tenant_question_photo_checks")).Should().BeTrue();
        foreach (var privilege in new[] { "SELECT", "INSERT" })
        {
            (await AppRoleHasAsync("ssf.question_photo_checks", privilege)).Should().BeTrue($"{privilege} is what the table is for");
        }

        foreach (var privilege in new[] { "UPDATE", "DELETE", "TRUNCATE" })
        {
            (await AppRoleHasAsync("ssf.question_photo_checks", privilege)).Should().BeFalse($"a photo check is never rewritten: {privilege}");
        }

        foreach (var privilege in new[] { "UPDATE", "DELETE" })
        {
            (await AppRoleHasAsync("ssf.question_events", privilege)).Should().BeFalse(
                $"the new columns must not reopen the question ledger to {privilege}");
        }

        output.WriteLine("[EVIDENCE] after Up(): nine nullable columns, old row intact with them empty, photo checks FORCE RLS + policy, "
            + "agrisync_app SELECT/INSERT only, question_events still append-only");

        // ═════ Down() again, with the old row present; then Up() re-runs cleanly. ═════
        await MigrateShramSafalToAsync(MigrationBefore);
        (await CountOldRowAsync()).Should().Be(1, "Down drops the new columns, never a row");
        (await QuestionEventColumnsAsync()).Keys.Should().NotContain(NewColumns);

        await MigrateShramSafalToAsync(null);
        (await QuestionEventColumnsAsync()).Keys.Should().Contain(NewColumns);
        (await RelationExistsAsync("ssf.question_photo_checks")).Should().BeTrue();
        output.WriteLine("[EVIDENCE] Down() kept the old row; Up() re-applied cleanly");
    }

    private async Task MigrateShramSafalToAsync(string? target)
    {
        var options = new DbContextOptionsBuilder<ShramSafalDbContext>().UseNpgsql(_superuserConn).Options;
        await using var db = new ShramSafalDbContext(options);
        if (target is null)
        {
            await db.Database.MigrateAsync();
        }
        else
        {
            await db.Database.GetService<IMigrator>().MigrateAsync(target);
        }
    }

    private async Task<List<string>> AppliedShramSafalMigrationsAsync()
    {
        var options = new DbContextOptionsBuilder<ShramSafalDbContext>().UseNpgsql(_superuserConn).Options;
        await using var db = new ShramSafalDbContext(options);
        return (await db.Database.GetAppliedMigrationsAsync()).ToList();
    }

    private async Task InsertOldShapeQuestionEventAsync()
    {
        await using var conn = new NpgsqlConnection(_superuserConn);
        await conn.OpenAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.question_events
                ("Id", farm_id, question_key, crop, anchor_date_type, trigger_type, question_type, lens, depth_level,
                 priority, cooldown, answer_modes, safety_class, agronomist_approved, marathi_approved, bank_version,
                 question_engine_version, response, created_at_utc)
            VALUES (@id, @farm, 'learning.what_worked', 'grape', 'pruning', 'learning', 'open', 'learning', 1,
                    8, 7, 'voice', 'none', false, true, 'v1', 'v1', 'बरं झालं', NOW());
            """;
        cmd.Parameters.AddWithValue("id", OldPhoneRow);
        cmd.Parameters.AddWithValue("farm", Farm);
        await cmd.ExecuteNonQueryAsync();
    }

    private async Task<long> CountOldRowAsync() =>
        (long)(await ScalarAsync("SELECT count(*) FROM ssf.question_events WHERE \"Id\" = @id", ("id", OldPhoneRow)))!;

    private async Task<long> CountNonNullNewColumnsOnOldRowAsync()
    {
        var sum = string.Join(" + ", NewColumns.Select(c => $"(CASE WHEN {c} IS NULL THEN 0 ELSE 1 END)"));
        return Convert.ToInt64(await ScalarAsync($"SELECT {sum} FROM ssf.question_events WHERE \"Id\" = @id", ("id", OldPhoneRow)));
    }

    private async Task<Dictionary<string, string>> QuestionEventColumnsAsync()
    {
        await using var conn = new NpgsqlConnection(_superuserConn);
        await conn.OpenAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT column_name, is_nullable FROM information_schema.columns "
            + "WHERE table_schema = 'ssf' AND table_name = 'question_events'";
        var result = new Dictionary<string, string>();
        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            result[reader.GetString(0)] = reader.GetString(1);
        }

        return result;
    }

    private async Task<bool> RelationExistsAsync(string relation) =>
        (bool)(await ScalarAsync("SELECT to_regclass(@r) IS NOT NULL", ("r", relation)))!;

    private async Task<bool> IndexExistsAsync(string index) =>
        (bool)(await ScalarAsync("SELECT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'ssf' AND indexname = @i)", ("i", index)))!;

    private async Task<bool> PolicyExistsAsync(string table, string policy) =>
        (bool)(await ScalarAsync(
            "SELECT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'ssf' AND tablename = @t AND policyname = @p)",
            ("t", table), ("p", policy)))!;

    private async Task<bool> AppRoleHasAsync(string relation, string privilege) =>
        (bool)(await ScalarAsync("SELECT has_table_privilege(@role, @r, @p)", ("role", AppRole), ("r", relation), ("p", privilege)))!;

    private async Task<(bool Enabled, bool Forced)> ForceRlsAsync(string relation)
    {
        await using var conn = new NpgsqlConnection(_superuserConn);
        await conn.OpenAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = @r::regclass";
        cmd.Parameters.AddWithValue("r", relation);
        await using var reader = await cmd.ExecuteReaderAsync();
        (await reader.ReadAsync()).Should().BeTrue();
        return (reader.GetBoolean(0), reader.GetBoolean(1));
    }

    private async Task<object?> ScalarAsync(string sql, params (string Name, object Value)[] parameters)
    {
        await using var conn = new NpgsqlConnection(_superuserConn);
        await conn.OpenAsync();
        await using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in parameters)
        {
            cmd.Parameters.AddWithValue(name, value);
        }

        return await cmd.ExecuteScalarAsync();
    }
}
