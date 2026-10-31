// lane 2b (P11, E5, E8; fix 1 HIGH-1 / MEDIUM-3) — the 20261031021129_SplitFarmAuthorities migration
// rehearsed on a throwaway copy of the demo farm's seats. The governing rule (orchestrator, founder
// D-22 / D-26): the upgrade NEVER widens anything — for every seat and every checked action, "can
// after" implies "could before". What a seat loses is listed exactly (the D-26 primary-owner-only
// set and the money actions one go-live authority cannot carry finer). Down() never widens either —
// also over the rows the FIRST draft of this migration wrote (the PC test database ran it).
//
// "Before" is the PRE-2b rule set, written down here from the code it replaced (file:line in the 2b
// report) — that code no longer exists in this binary, so it cannot be called. "After" is measured
// with the engine's OWN function (FarmAuthorities.IsHeld) over the rows the migration wrote.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql;
using ShramSafal.Domain.Farms;
using ShramSafal.Infrastructure.Persistence;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Memberships;

[Trait("Category", "RequiresPostgres")]
public sealed class SplitFarmAuthoritiesMigrationRealPostgresTests(ITestOutputHelper output) : IAsyncLifetime
{
    private const string Before2b = "20261030102448_AddDailyLogContents";
    private const string Lane2b = "20261031021129_SplitFarmAuthorities";

    private static readonly Guid Farm = Guid.Parse("2b00000a-0000-0000-0000-0000000000f1");
    private static readonly Guid Account = Guid.Parse("2b00000a-0000-0000-0000-0000000000c1");
    private static readonly DateTime Now = DateTime.UtcNow;
    private static readonly DateTime Future = DateTime.UtcNow.AddDays(10);
    private static readonly DateTime Past = DateTime.UtcNow.AddDays(-1);

    /// <summary>The demo farm's people (PurveshDemoSeeder: purvesh / shankar / raju / santosh) and the
    /// relationship cases the upgrade must carry: family with and without the confirm switch, a
    /// stored money choice, an expert, a paused seat, a waiting request and an ended one.</summary>
    private static readonly Seat[] Seats =
    [
        new("purvesh", "PrimaryOwner", 3, null, false, null),
        new("shankar", "Mukadam", 3, null, false, null),
        new("raju", "Worker", 3, null, false, null),
        new("santosh", "Worker", 3, null, true, Future),
        new("family-plain", "SecondaryOwner", 3, null, false, null),
        new("family-confirms", "SecondaryOwner", 3, null, true, Future),
        new("family-money", "SecondaryOwner", 3, 4, false, null),
        new("mukadam-granted", "Mukadam", 3, null, true, null),
        new("worker-splits-bills", "Worker", 3, 4, false, null),
        new("worker-grant-ended", "Worker", 3, null, true, Past),
        new("agronomist", "Agronomist", 3, null, false, null),
        new("fpc", "FpcTechnicalManager", 3, null, false, null),
        new("mukadam-splits-bills", "Mukadam", 3, 4, false, null),
        new("worker-lab-bit", "Worker", 3, 32, false, null),
        new("consultant", "Consultant", 3, null, false, null),
        new("family-money-paused", "SecondaryOwner", 4, 4, false, null),
        new("family-paused", "SecondaryOwner", 4, null, true, null),
        new("waiting", "Worker", 2, null, false, null),
        new("removed", "Mukadam", 5, null, true, null),
    ];

    private sealed record Seat(string Key, string Role, int Status, int? Permissions, bool Grant, DateTime? GrantEnd)
    {
        public Guid UserId { get; } = new(System.Security.Cryptography.MD5.HashData(System.Text.Encoding.UTF8.GetBytes("2b-mig-" + Key)));
    }

    private sealed record Row(Guid UserId, string Role, int Status, int? Permissions, bool Grant, DateTime? GrantEnd, string? Json);

    /// <summary>Every check that read the owner tier, the label or the labour grant before 2b, and
    /// the lane-2b authority (or primary-owner-only) it now asks. The MONEY checks are listed in
    /// <see cref="MoneyChecks"/> too. Plan / assign are not here: they are stored for nobody and their
    /// label rules still decide (L8), and see money / see wages are stored only (MU-3).</summary>
    private static readonly (string Check, Func<Row, bool> Before, Func<Row, bool> After)[] Checks =
    [
        ("labour edits / attendance / field operators (LabourManagementGate)",
            r => Active(r) && (Owner(r) || LiveGrant(r)), r => Holds(r, FarmAuthority.TakeAttendance)),
        ("the owner's confirmation (OwnerConfirmationAuthority.MayConfirm)",
            r => Active(r) && (r.Role == "PrimaryOwner" || LiveGrant(r)), r => Holds(r, FarmAuthority.ConfirmRecords)),
        ("add a plot / the boundary (owner tier)",
            r => Active(r) && Owner(r), r => Holds(r, FarmAuthority.EditFarmSetup)),
        (SplitBill,
            r => Active(r) && (r.Role == "PrimaryOwner" || Bit(r, 4)), r => Holds(r, FarmAuthority.ReviewMoney)),
        (CorrectCost,
            r => Active(r) && (r.Role == "PrimaryOwner" || (r.Role == "SecondaryOwner" && Bit(r, 4))), r => Holds(r, FarmAuthority.ReviewMoney)),
        (VerifyPayout,
            r => Active(r) && (Owner(r) || r.Role is "Agronomist" or "FpcTechnicalManager"), r => Holds(r, FarmAuthority.ReviewMoney)),
        (SettlePayout,
            r => Active(r) && Owner(r), r => Holds(r, FarmAuthority.ReviewMoney)),
        // Lab records and schedule templates were the account's sign-up role's, never a seat's: no
        // seat may gain them by the upgrade. The primary account holder holds every authority by
        // design (brief scope 1, D-26) — that is the code's rule, not the upgrade's, and is reported
        // on its own (he may now record his own farm's test collection / result).
        ("lab records on the seat (a step-2 bit was never enforced)",
            r => false, r => r.Role != "PrimaryOwner" && Holds(r, FarmAuthority.LabRecords)),
        ("schedule templates on the seat (the sign-up role decided)",
            r => false, r => r.Role != "PrimaryOwner" && Holds(r, FarmAuthority.ScheduleTemplates)),
        ("invite QR / rotate (owner tier) — PRIMARY OWNER ONLY now",
            r => Active(r) && Owner(r), r => Active(r) && r.Role == "PrimaryOwner"),
        ("team roster (owner tier) — PRIMARY OWNER ONLY now",
            r => Active(r) && Owner(r), r => Active(r) && r.Role == "PrimaryOwner"),
    ];

    private const string SplitBill = "split a whole-farm bill (AddCost)";
    private const string CorrectCost = "correct a cost (owner tier + AddCost)";
    private const string VerifyPayout = "job card: verify for payout (owner tier + Agronomist + FPC)";
    private const string SettlePayout = "job card: settle (owner tier)";
    private static readonly string[] MoneyChecks = [SplitBill, CorrectCost, VerifyPayout, SettlePayout];

    private static bool Active(Row r) => r.Status == 3;
    private static bool Owner(Row r) => r.Role is "PrimaryOwner" or "SecondaryOwner";
    private static bool LiveGrant(Row r) => r.Grant && (r.GrantEnd is null || Now < r.GrantEnd);
    private static bool Bit(Row r, int bit) => ((r.Permissions ?? 0) & bit) == bit;

    private static bool Holds(Row r, FarmAuthority authority) =>
        Active(r) && FarmAuthorities.IsHeld(
            Enum.Parse<AppRole>(r.Role), (FarmPermission?)r.Permissions, r.Grant, r.GrantEnd, r.Json, authority, Now);

    private string _rootConn = string.Empty;
    private string _db = string.Empty;
    private string _superConn = string.Empty;

    public async Task InitializeAsync()
    {
        _rootConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();
        _db = $"ssf_lane2b_mig_{Guid.NewGuid():N}";
        await using (var admin = new NpgsqlConnection(_rootConn))
        {
            await admin.OpenAsync();
            await using var create = admin.CreateCommand();
            create.CommandText = $"CREATE DATABASE \"{_db}\"";
            await create.ExecuteNonQueryAsync();
        }

        _superConn = new NpgsqlConnectionStringBuilder(_rootConn) { Database = _db }.ConnectionString;
        await IntegrationMigrationChain.ApplyAsync(_superConn);
        await MigrateSsfToAsync(Before2b);
        await SeedDemoSeatsAsync();
    }

    public async Task DisposeAsync()
    {
        try
        {
            await using var admin = new NpgsqlConnection(_rootConn);
            await admin.OpenAsync();
            await using var cmd = admin.CreateCommand();
            cmd.CommandText = $"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '{_db}' AND pid <> pg_backend_pid(); DROP DATABASE IF EXISTS \"{_db}\"";
            await cmd.ExecuteNonQueryAsync();
        }
        catch (NpgsqlException ex)
        {
            output.WriteLine($"[teardown] scratch DB not dropped: {ex.GetType().Name}");
        }
    }

    [Fact]
    public async Task The_upgrade_never_widens_anything_and_every_loss_is_the_listed_one()
    {
        var before = await RowsAsync();
        await MigrateSsfToAsync(Lane2b);
        var after = await RowsAsync();

        var losses = new List<string>();
        var gains = new List<string>();
        foreach (var seat in Seats)
        {
            var b = before.Single(r => r.UserId == seat.UserId);
            var a = after.Single(r => r.UserId == seat.UserId);
            foreach (var (check, oldRule, newRule) in Checks)
            {
                var was = oldRule(b);
                var now = newRule(a);
                output.WriteLine($"[EVIDENCE] {seat.Key,-22} {(was ? "Y" : "-")} -> {(now ? "Y" : "-")}  {check}");
                if (was && !now) losses.Add($"{seat.Key}: {check}");
                if (!was && now) gains.Add($"{seat.Key}: {check}");
            }

            // The money outcome, per seat type: the set of money actions after ⊆ the set before.
            var moneyBefore = Checks.Where(c => MoneyChecks.Contains(c.Check) && c.Before(b)).Select(c => c.Check).ToHashSet();
            var moneyAfter = Checks.Where(c => MoneyChecks.Contains(c.Check) && c.After(a)).Select(c => c.Check).ToHashSet();
            moneyAfter.Should().BeSubsetOf(moneyBefore, $"{seat.Key}: the upgrade never widens money (D-22)");

            // Plan / assign are stored for nobody (L8 sets them); a step-2 lab-records bit is cleared.
            ((a.Permissions ?? 0) & (8 | 64)).Should().Be((b.Permissions ?? 0) & 8, $"{seat.Key}: no plan / assign stored by the upgrade");
            Bit(a, 32).Should().BeFalse($"{seat.Key}: a never-enforced lab-records bit is not carried");
            Bit(a, 4).Should().BeFalse($"{seat.Key}: the retired AddCost bit is cleared");
        }

        gains.Should().BeEmpty("the upgrade never widens anything (fix 1, D-22 / D-26)");

        losses.Should().BeEquivalentTo(new[]
        {
            // D-26: people and permissions are the primary account holder's.
            "family-plain: invite QR / rotate (owner tier) — PRIMARY OWNER ONLY now",
            "family-plain: team roster (owner tier) — PRIMARY OWNER ONLY now",
            "family-confirms: invite QR / rotate (owner tier) — PRIMARY OWNER ONLY now",
            "family-confirms: team roster (owner tier) — PRIMARY OWNER ONLY now",
            "family-money: invite QR / rotate (owner tier) — PRIMARY OWNER ONLY now",
            "family-money: team roster (owner tier) — PRIMARY OWNER ONLY now",
            // Fix 1 (HIGH-1): one review-money authority cannot carry a part of it — the seat gets less.
            $"family-plain: {VerifyPayout}",
            $"family-plain: {SettlePayout}",
            $"family-confirms: {VerifyPayout}",
            $"family-confirms: {SettlePayout}",
            $"agronomist: {VerifyPayout}",
            $"fpc: {VerifyPayout}",
            $"worker-splits-bills: {SplitBill}",
            $"mukadam-splits-bills: {SplitBill}",
        });
        foreach (var loss in losses)
        {
            output.WriteLine($"[EVIDENCE] lost: {loss}");
        }

        // Exactly the seat that could do ALL of review money keeps it (with see money).
        var familyMoney = after.Single(r => r.UserId == Seats.Single(s => s.Key == "family-money").UserId);
        Holds(familyMoney, FarmAuthority.ReviewMoney).Should().BeTrue();
        Bit(familyMoney, 1024).Should().BeTrue();
        var familyMoneyPaused = after.Single(r => r.UserId == Seats.Single(s => s.Key == "family-money-paused").UserId);
        Holds(familyMoneyPaused with { Status = 3 }, FarmAuthority.ReviewMoney).Should().BeTrue("restored, he has what he had");

        // Waiting and ended seats are untouched; a paused seat keeps what returns on restore.
        var waiting = after.Single(r => r.UserId == Seats.Single(s => s.Key == "waiting").UserId);
        waiting.Permissions.Should().BeNull();
        waiting.Json.Should().BeNull();
        var removed = after.Single(r => r.UserId == Seats.Single(s => s.Key == "removed").UserId);
        removed.Permissions.Should().BeNull();
        var paused = after.Single(r => r.UserId == Seats.Single(s => s.Key == "family-paused").UserId);
        Holds(paused with { Status = 3 }, FarmAuthority.TakeAttendance).Should().BeTrue("restored, he has what he had");
        Holds(paused with { Status = 3 }, FarmAuthority.ConfirmRecords).Should().BeTrue();

        // The end of a stored grant moved to confirm records with the same instant.
        var santosh = after.Single(r => r.UserId == Seats.Single(s => s.Key == "santosh").UserId);
        FarmAuthorities.ParseExpiries(santosh.Json)[FarmPermission.ConfirmRecords]
            .Should().BeCloseTo(Future, TimeSpan.FromMilliseconds(1));
        santosh.GrantEnd.Should().BeCloseTo(Future, TimeSpan.FromMilliseconds(1));
        var familyConfirms = after.Single(r => r.UserId == Seats.Single(s => s.Key == "family-confirms").UserId);
        familyConfirms.GrantEnd.Should().BeNull("a सहमालक's हजेरी came with his label: permanent");
        FarmAuthorities.ParseExpiries(familyConfirms.Json)[FarmPermission.ConfirmRecords]
            .Should().BeCloseTo(Future, TimeSpan.FromMilliseconds(1), "his stored switch meant confirming");
    }

    [Fact]
    public async Task Down_destroys_the_ends_and_the_split_and_never_widens_the_older_binary()
    {
        var before = await RowsAsync();
        await MigrateSsfToAsync(Lane2b);
        await MigrateSsfToAsync(Before2b);
        var after = await RowsAsync();

        (await ColumnExistsAsync("authority_expires_at")).Should().BeFalse("Down drops the per-authority ends");

        foreach (var seat in Seats)
        {
            var b = before.Single(r => r.UserId == seat.UserId);
            var a = after.Single(r => r.UserId == seat.UserId);
            output.WriteLine($"[EVIDENCE] down {seat.Key,-20} grant {b.Grant}->{a.Grant} perms {b.Permissions?.ToString() ?? "null"}->{a.Permissions?.ToString() ?? "null"}");

            // Under the older binary: the labour grant and AddCost are the only stored powers it
            // enforces. A rollback never hands either to anyone who did not hold it before Up.
            if (!b.Grant)
            {
                a.Grant.Should().BeFalse($"{seat.Key}: rollback must not widen the old switch");
            }

            if (!Bit(b, 4))
            {
                Bit(a, 4).Should().BeFalse($"{seat.Key}: rollback must not hand out AddCost");
            }
        }

        // The co-owner's old switch meant confirming: it comes back from confirm records.
        var familyConfirms = after.Single(r => r.UserId == Seats.Single(s => s.Key == "family-confirms").UserId);
        familyConfirms.Grant.Should().BeTrue();
        familyConfirms.GrantEnd.Should().BeCloseTo(Future, TimeSpan.FromMilliseconds(1));

        // The one seat Up gave review money gets its AddCost back exactly.
        Bit(after.Single(r => r.UserId == Seats.Single(s => s.Key == "family-money").UserId), 4).Should().BeTrue();
    }

    /// <summary>
    /// fix 1 — the PC test database ran the FIRST draft of this migration, so its rows carry that
    /// draft's values (AddCost on every सहमालक / Agronomist / FPC seat, plan / assign bits). The edited
    /// Down() must collapse those rows without widening the older binary too.
    /// </summary>
    [Fact]
    public async Task Down_over_the_first_drafts_rows_never_widens_the_older_binary()
    {
        var before = await RowsAsync();
        await MigrateSsfToAsync(Lane2b);

        // Put the seats back as they were before the upgrade, then through the FIRST draft's carry.
        await using (var db = new NpgsqlConnection(_superConn))
        {
            await db.OpenAsync();
            await using (var wipe = db.CreateCommand())
            {
                wipe.CommandText = "DELETE FROM ssf.farm_memberships WHERE farm_id = @farm";
                wipe.Parameters.AddWithValue("farm", Farm);
                await wipe.ExecuteNonQueryAsync();
            }
        }

        await SeedSeatsAsync();
        await using (var db = new NpgsqlConnection(_superConn))
        {
            await db.OpenAsync();
            await using var draft = db.CreateCommand();
            draft.CommandText = FirstDraftCarry + " AND m.farm_id = @farm;";
            draft.Parameters.AddWithValue("farm", Farm);
            await draft.ExecuteNonQueryAsync();
        }

        await MigrateSsfToAsync(Before2b);
        var after = await RowsAsync();
        foreach (var seat in Seats)
        {
            var b = before.Single(r => r.UserId == seat.UserId);
            var a = after.Single(r => r.UserId == seat.UserId);
            output.WriteLine($"[EVIDENCE] down(first draft) {seat.Key,-22} grant {b.Grant}->{a.Grant} perms {b.Permissions?.ToString() ?? "null"}->{a.Permissions?.ToString() ?? "null"}");
            if (!b.Grant)
            {
                a.Grant.Should().BeFalse($"{seat.Key}: rollback must not widen the old switch");
            }

            if (!Bit(b, 4))
            {
                Bit(a, 4).Should().BeFalse($"{seat.Key}: rollback must not hand out AddCost the first draft added");
            }
        }
    }

    /// <summary>The carry the FIRST draft of this migration ran (cd35fc91) — what the PC test database holds.</summary>
    private const string FirstDraftCarry = """
        UPDATE ssf.farm_memberships AS m
        SET
            permissions =
                (COALESCE(m.permissions, 0) & ~16)
                | CASE WHEN (COALESCE(m.permissions, 0) & 4) <> 0 THEN 1 ELSE 0 END
                | CASE WHEN m.can_manage_labour_records THEN 128 ELSE 0 END
                | CASE m.role
                    WHEN 'SecondaryOwner'      THEN 1 | 2 | 4 | 8 | 64 | 256
                    WHEN 'Mukadam'             THEN 8 | 64
                    WHEN 'Agronomist'          THEN 1 | 4 | 8
                    WHEN 'FpcTechnicalManager' THEN 1 | 4 | 8
                    WHEN 'Consultant'          THEN 8
                    WHEN 'FieldScout'          THEN 8
                    WHEN 'LabOperator'         THEN 8
                    ELSE 0
                  END,
            authority_expires_at = CASE
                WHEN m.can_manage_labour_records AND m.labour_grant_expires_at_utc IS NOT NULL
                THEN jsonb_build_object(
                    '128',
                    to_char(m.labour_grant_expires_at_utc AT TIME ZONE 'UTC',
                            'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))
                ELSE NULL
            END,
            can_manage_labour_records = CASE
                WHEN m.role = 'SecondaryOwner' THEN true
                ELSE m.can_manage_labour_records
            END,
            labour_grant_expires_at_utc = CASE
                WHEN m.role = 'SecondaryOwner' THEN NULL
                ELSE m.labour_grant_expires_at_utc
            END
        WHERE m.status IN (3, 4)
          AND m.role <> 'PrimaryOwner'
        """;

    // ── Harness ────────────────────────────────────────────────────────────────────────────

    private async Task MigrateSsfToAsync(string target)
    {
        var options = new DbContextOptionsBuilder<ShramSafalDbContext>().UseNpgsql(_superConn).Options;
        await using var ssf = new ShramSafalDbContext(options);
        await ssf.Database.GetService<IMigrator>().MigrateAsync(target);
    }

    private async Task SeedDemoSeatsAsync()
    {
        await using var db = new NpgsqlConnection(_superConn);
        await db.OpenAsync();
        await using (var farm = db.CreateCommand())
        {
            farm.CommandText = """
                INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status, farm_code)
                VALUES (@farm, 'Purvesh demo copy (2b)', @owner, @account, NOW(), NOW(), 3.0, 'Unchecked', 'B2MIG1');
                """;
            farm.Parameters.AddWithValue("farm", Farm);
            farm.Parameters.AddWithValue("owner", Seats[0].UserId);
            farm.Parameters.AddWithValue("account", Account);
            await farm.ExecuteNonQueryAsync();
        }

        await SeedSeatsAsync();
    }

    private async Task SeedSeatsAsync()
    {
        await using var db = new NpgsqlConnection(_superConn);
        await db.OpenAsync();
        foreach (var seat in Seats)
        {
            await using var cmd = db.CreateCommand();
            cmd.CommandText = """
                INSERT INTO ssf.farm_memberships ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id,
                                                  status, joined_via, permissions, can_manage_labour_records, labour_grant_expires_at_utc)
                VALUES (@id, @farm, @user, @role, NOW(), NOW(), @account, @status, 2, @perms, @grant, @end);
                """;
            cmd.Parameters.AddWithValue("id", Guid.NewGuid());
            cmd.Parameters.AddWithValue("farm", Farm);
            cmd.Parameters.AddWithValue("user", seat.UserId);
            cmd.Parameters.AddWithValue("role", seat.Role);
            cmd.Parameters.AddWithValue("account", Account);
            cmd.Parameters.AddWithValue("status", seat.Status);
            cmd.Parameters.AddWithValue("perms", (object?)seat.Permissions ?? DBNull.Value);
            cmd.Parameters.AddWithValue("grant", seat.Grant);
            cmd.Parameters.AddWithValue("end", (object?)seat.GrantEnd ?? DBNull.Value);
            await cmd.ExecuteNonQueryAsync();
        }
    }

    private async Task<List<Row>> RowsAsync()
    {
        var hasJson = await ColumnExistsAsync("authority_expires_at");
        await using var db = new NpgsqlConnection(_superConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = $"""
            SELECT user_id, role, status, permissions, can_manage_labour_records, labour_grant_expires_at_utc,
                   {(hasJson ? "authority_expires_at::text" : "NULL::text")}
            FROM ssf.farm_memberships WHERE farm_id = @farm
            """;
        cmd.Parameters.AddWithValue("farm", Farm);
        var rows = new List<Row>();
        await using var r = await cmd.ExecuteReaderAsync();
        while (await r.ReadAsync())
        {
            rows.Add(new Row(
                r.GetGuid(0), r.GetString(1), r.GetInt32(2),
                r.IsDBNull(3) ? null : r.GetInt32(3),
                r.GetBoolean(4),
                r.IsDBNull(5) ? null : DateTime.SpecifyKind(r.GetDateTime(5), DateTimeKind.Utc),
                r.IsDBNull(6) ? null : r.GetString(6)));
        }

        return rows;
    }

    private async Task<bool> ColumnExistsAsync(string column)
    {
        await using var db = new NpgsqlConnection(_superConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'ssf' AND table_name = 'farm_memberships' AND column_name = @c";
        cmd.Parameters.AddWithValue("c", column);
        return Convert.ToInt64(await cmd.ExecuteScalarAsync()) > 0;
    }
}
