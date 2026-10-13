// spec: 2026-08-25-prod-cutover-waves
using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Labour.CreateFieldOperator;
using ShramSafal.Application.UseCases.Labour.DeactivateFieldOperator;
using ShramSafal.Application.UseCases.Labour.GetFieldOperators;
using ShramSafal.Application.UseCases.Labour.GetLabourData;
using ShramSafal.Infrastructure;
using ShramSafal.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Labour;

/// <summary>
/// Team page "Add worker" / "Remove worker" — the server side, proven end to end against
/// real Postgres as <c>agrisync_app</c> (NOT superuser, NOT BYPASSRLS — vacuity guard).
///
/// <para>A NAMED WORKER is a <c>FieldOperator</c> (a work identity, no login). Adding one
/// must create exactly one <c>ssf.field_operators</c> row and NOTHING else: no
/// membership, no user, no subscription, no ownership. Removing one DEACTIVATES it
/// (<c>is_active = false</c>): the row, its attendance marks and its name in history stay.</para>
///
/// <para>Authority is the shared write rule (<c>LabourManagementGate</c>) — the same one
/// <c>CreateFieldOperatorHandler</c>/<c>RenameFieldOperatorHandler</c> already enforce and the
/// same one <c>canManageLabour</c> reports to the client.</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class TeamWorkerActionsRealPostgresTests(Xunit.Abstractions.ITestOutputHelper output)
    : IAsyncLifetime
{
    private const string RoleVacuityGuardSql =
        "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user";

    private const string AppRoleUser = TestRoleCredentials.AppRoleUser;
    private static string AppRolePassword => TestRoleCredentials.AppRolePassword;

    private static readonly DateTime Now = new(2026, 10, 13, 6, 0, 0, DateTimeKind.Utc);

    private static readonly Guid FarmA = Guid.Parse("7a000000-0000-0000-0000-0000000000f1");
    private static readonly Guid FarmB = Guid.Parse("7a000000-0000-0000-0000-0000000000f2");
    private static readonly Guid AccountA = Guid.Parse("7a000000-0000-0000-0000-0000000000a1");
    private static readonly Guid AccountB = Guid.Parse("7a000000-0000-0000-0000-0000000000a2");
    private static readonly Guid OwnerA = Guid.Parse("7a000000-0000-0000-0000-0000000000e1");
    private static readonly Guid CoOwnerA = Guid.Parse("7a000000-0000-0000-0000-0000000000e2");
    private static readonly Guid MukadamA = Guid.Parse("7a000000-0000-0000-0000-0000000000b1");
    private static readonly Guid WorkerA = Guid.Parse("7a000000-0000-0000-0000-0000000000c1");
    private static readonly Guid GrantedWorkerA = Guid.Parse("7a000000-0000-0000-0000-0000000000c3");
    private static readonly Guid OwnerB = Guid.Parse("7a000000-0000-0000-0000-0000000000d1");

    private static readonly Guid HistoricOperator = Guid.Parse("7a000000-0000-0000-0000-00000000a001");
    private static readonly Guid FarmBOperator = Guid.Parse("7a000000-0000-0000-0000-00000000b001");

    private string _adminConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private string _superuserConn = string.Empty;
    private string _appConn = string.Empty;
    private ServiceProvider? _rootProvider;

    public async Task InitializeAsync()
    {
        _adminConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();

        _scratchDbName = $"ssf_teamwk_{Guid.NewGuid():N}";
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

        await using (var raw = new NpgsqlConnection(_superuserConn))
        {
            await raw.OpenAsync();
            await ExecAsync(raw,
                "GRANT USAGE ON SCHEMA public TO agrisync_app;"
                + "GRANT SELECT ON ALL TABLES IN SCHEMA public TO agrisync_app;");

            await SeedFarmAsync(raw, FarmA, OwnerA, AccountA, "Team Actions Farm A");
            await SeedFarmAsync(raw, FarmB, OwnerB, AccountB, "Team Actions Farm B");
            await SeedMembershipAsync(raw, FarmA, AccountA, OwnerA, "PrimaryOwner", grant: false);
            await SeedMembershipAsync(raw, FarmA, AccountA, CoOwnerA, "SecondaryOwner", grant: false);
            await SeedMembershipAsync(raw, FarmA, AccountA, MukadamA, "Mukadam", grant: false);
            await SeedMembershipAsync(raw, FarmA, AccountA, WorkerA, "Worker", grant: false);
            await SeedMembershipAsync(raw, FarmA, AccountA, GrantedWorkerA, "Worker", grant: true);
            await SeedMembershipAsync(raw, FarmB, AccountB, OwnerB, "PrimaryOwner", grant: false);

            await SeedOperatorAsync(raw, HistoricOperator, "Ganesh-History", FarmA, OwnerA);
            await SeedOperatorAsync(raw, FarmBOperator, "Farm-B-Person", FarmB, OwnerB);
            // History for the person who will later be removed: marks on two days.
            await SeedMarkAsync(raw, FarmA, HistoricOperator, new DateOnly(2026, 10, 12), day: 1, night: 0, OwnerA);
            await SeedMarkAsync(raw, FarmA, HistoricOperator, new DateOnly(2026, 10, 13), day: 2, night: 0, OwnerA);
        }

        var services = new ServiceCollection();
        services.AddLogging();
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:ShramSafalDb"] = _appConn,
                ["ConnectionStrings:UserDb"] = _appConn,
            }!)
            .Build();
        services.AddSingleton<IConfiguration>(config);
        services.AddShramSafalInfrastructure(config);
        services.AddScoped<IIdGenerator, GuidIdGenerator>();
        services.AddScoped<IClock>(_ => new FixedClock(Now));

        _rootProvider = services.BuildServiceProvider();
    }

    public async Task DisposeAsync()
    {
        if (_rootProvider is not null)
        {
            await _rootProvider.DisposeAsync();
        }

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
    public async Task The_app_role_is_neither_superuser_nor_bypassrls_so_this_suite_is_not_vacuous()
    {
        await AssertAppRoleIsNotVacuousAsync();
    }

    // ── ADD a named worker: who may ───────────────────────────────────────────

    [Fact]
    public async Task Adding_a_worker_name_is_allowed_for_owner_coowner_and_a_granted_member_and_refused_to_the_rest()
    {
        await AssertAppRoleIsNotVacuousAsync();

        async Task Expect(string label, Guid callerId, bool expectedOk, Guid? farm = null)
        {
            var r = await CreateAsync(callerId, $"Name-{label}", Guid.NewGuid(), farm ?? FarmA);
            output.WriteLine($"[ADD-AUTH] {label}: ok={r.Ok} err={r.Error}");
            r.Ok.Should().Be(expectedOk, label);
        }

        await Expect("owner", OwnerA, true);
        await Expect("co-owner", CoOwnerA, true);
        await Expect("granted worker", GrantedWorkerA, true);
        await Expect("un-granted mukadam", MukadamA, false);
        await Expect("un-granted worker", WorkerA, false);
        await Expect("cross-farm (farm B owner on farm A)", OwnerB, false);

        await SetGrantAsync(MukadamA, true);
        await Expect("mukadam with live grant", MukadamA, true);
        await SetGrantAsync(MukadamA, true, TimeSpan.FromMinutes(-1));
        await Expect("mukadam with EXPIRED grant", MukadamA, false);

        (await CountAsync("ssf.field_operators WHERE originating_farm_id = '" + FarmA + "' AND display_name LIKE 'Name-%'"))
            .Should().Be(4, "owner, co-owner, granted worker, live-granted mukadam — no refused attempt left a row");
    }

    [Fact]
    public async Task Adding_a_worker_name_with_the_same_client_id_is_idempotent_and_never_crosses_farms()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var id = Guid.NewGuid();
        var first = await CreateAsync(OwnerA, "Ramesh", id);
        var retry = await CreateAsync(OwnerA, "Ramesh", id);
        var retryByCoOwner = await CreateAsync(CoOwnerA, "Ramesh", id);

        first.Ok.Should().BeTrue();
        first.Dto!.Id.Should().Be(id, "the client-chosen id IS the operator id — that is what makes a retry safe");
        retry.Ok.Should().BeTrue("a retry after a lost response must succeed, not duplicate");
        retry.Dto!.Id.Should().Be(id);
        retryByCoOwner.Ok.Should().BeTrue();
        (await CountAsync($"ssf.field_operators WHERE \"Id\" = '{id}'")).Should().Be(1);

        // Two DIFFERENT people may share a name (B2): different ids make two rows.
        var twin = await CreateAsync(OwnerA, "Ramesh", Guid.NewGuid());
        twin.Ok.Should().BeTrue();
        (await CountAsync("ssf.field_operators WHERE display_name = 'Ramesh'")).Should().Be(2);

        // The same id replayed against ANOTHER farm is refused and touches nothing.
        var cross = await CreateAsync(OwnerB, "Ramesh", id, FarmB);
        cross.Ok.Should().BeFalse("an id that already names a person on farm A is not farm B's to re-use");
        (await CountAsync($"ssf.field_operators WHERE \"Id\" = '{id}' AND originating_farm_id = '{FarmA}'")).Should().Be(1);
        (await CountAsync($"ssf.field_operators WHERE originating_farm_id = '{FarmB}' AND display_name = 'Ramesh'")).Should().Be(0);
    }

    [Fact]
    public async Task Adding_a_worker_name_creates_exactly_one_operator_row_and_no_membership_user_subscription_or_ownership()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var before = await SnapshotRowCountsAsync();
        var ownerBefore = await ReadScalarAsync($"SELECT owner_user_id::text || owner_account_id::text FROM ssf.farms WHERE \"Id\" = '{FarmA}'");

        var r = await CreateAsync(OwnerA, "Sakharam", Guid.NewGuid());
        r.Ok.Should().BeTrue();

        var after = await SnapshotRowCountsAsync();
        var changed = after.Where(kv => !before.TryGetValue(kv.Key, out var b) || b != kv.Value)
            .Select(kv => $"{kv.Key}: {before.GetValueOrDefault(kv.Key)} -> {kv.Value}").ToList();
        output.WriteLine("[ADD-DIFF] tables whose row count changed: " + string.Join(" | ", changed));

        changed.Should().ContainSingle("only ssf.field_operators may change").Which.Should().StartWith("ssf.field_operators:");
        after["ssf.farm_memberships"].Should().Be(before["ssf.farm_memberships"]);
        after.Keys.Where(k => k.EndsWith(".users") || k.EndsWith("memberships") || k.Contains("subscription"))
            .Should().OnlyContain(k => after[k] == before[k], "no login, membership or subscription is created by a name");
        (await ReadScalarAsync($"SELECT owner_user_id::text || owner_account_id::text FROM ssf.farms WHERE \"Id\" = '{FarmA}'"))
            .Should().Be(ownerBefore, "ownership is untouched");
    }

    // ── REMOVE (deactivate) a named worker ────────────────────────────────────

    [Fact]
    public async Task Removing_a_worker_is_allowed_for_owner_coowner_and_a_granted_member_and_refused_to_the_rest()
    {
        await AssertAppRoleIsNotVacuousAsync();

        async Task Expect(string label, Guid callerId, bool expectedOk, Guid? farm = null, Guid? target = null)
        {
            // A fresh person per attempt so one success cannot mask a later refusal.
            var op = target ?? Guid.NewGuid();
            if (target is null) await SeedOperatorViaSuperuserAsync(op, $"Remove-{label}", FarmA, OwnerA);
            var r = await DeactivateAsync(callerId, op, farm ?? FarmA);
            output.WriteLine($"[REMOVE-AUTH] {label}: ok={r.Ok} err={r.Error}");
            r.Ok.Should().Be(expectedOk, label);
            (await ReadScalarAsync($"SELECT is_active::text FROM ssf.field_operators WHERE \"Id\" = '{op}'"))
                .Should().Be(expectedOk ? "false" : "true", $"{label}: the row's state follows the decision");
        }

        await Expect("owner", OwnerA, true);
        await Expect("co-owner", CoOwnerA, true);
        await Expect("granted worker", GrantedWorkerA, true);
        await Expect("un-granted mukadam", MukadamA, false);
        await Expect("un-granted worker", WorkerA, false);
        await Expect("cross-farm caller (farm B owner on farm A)", OwnerB, false);

        // Farm A's owner naming a FARM B person on FARM A's route: refused, farm B untouched.
        var crossTarget = await DeactivateAsync(OwnerA, FarmBOperator, FarmA);
        crossTarget.Ok.Should().BeFalse("the person did not originate on this farm");
        (await ReadScalarAsync($"SELECT is_active::text FROM ssf.field_operators WHERE \"Id\" = '{FarmBOperator}'"))
            .Should().Be("true");

        await SetGrantAsync(MukadamA, true);
        await Expect("mukadam with live grant", MukadamA, true);
        await SetGrantAsync(MukadamA, true, TimeSpan.FromMinutes(-1));
        await Expect("mukadam with EXPIRED grant", MukadamA, false);
    }

    [Fact]
    public async Task Removing_a_worker_twice_is_a_success_and_a_missing_person_is_refused_without_leaking_existence()
    {
        await AssertAppRoleIsNotVacuousAsync();

        (await DeactivateAsync(OwnerA, HistoricOperator)).Ok.Should().BeTrue();
        (await DeactivateAsync(OwnerA, HistoricOperator)).Ok.Should().BeTrue("a repeated tap/retry converges");

        var missing = await DeactivateAsync(OwnerA, Guid.NewGuid());
        var otherFarm = await DeactivateAsync(OwnerA, FarmBOperator);
        missing.Ok.Should().BeFalse();
        missing.Error.Should().Be(otherFarm.Error, "unknown id and another farm's id are indistinguishable (no existence probe)");
    }

    [Fact]
    public async Task Removing_a_worker_keeps_his_row_his_marks_his_name_and_every_reported_figure()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var beforeCounts = await SnapshotRowCountsAsync();
        var beforeMarks = await ReadScalarAsync(
            $"SELECT string_agg(\"Id\"::text || work_date::text || day_mark::text || night_mark::text || recorded_by_user_id::text, ',' ORDER BY work_date) FROM ssf.attendance_marks WHERE field_operator_id = '{HistoricOperator}'");
        var beforeLabour = JsonSerializer.Serialize(await ReadLabourAsync(OwnerA));
        var beforeLedger = (await ReadLabourAsync(OwnerA)).Ledger;
        beforeLedger.Rows.Should().ContainSingle(r => r.FieldOperatorId == HistoricOperator && r.Name == "Ganesh-History",
            "precondition: he is in the register with his name");

        (await DeactivateAsync(OwnerA, HistoricOperator)).Ok.Should().BeTrue();

        var afterCounts = await SnapshotRowCountsAsync();
        afterCounts.Should().BeEquivalentTo(beforeCounts, "no row anywhere is deleted, added or duplicated");
        (await ReadScalarAsync($"SELECT is_active::text FROM ssf.field_operators WHERE \"Id\" = '{HistoricOperator}'"))
            .Should().Be("false");
        (await ReadScalarAsync(
            $"SELECT string_agg(\"Id\"::text || work_date::text || day_mark::text || night_mark::text || recorded_by_user_id::text, ',' ORDER BY work_date) FROM ssf.attendance_marks WHERE field_operator_id = '{HistoricOperator}'"))
            .Should().Be(beforeMarks, "marks and their attribution are byte-identical");

        var afterLabour = JsonSerializer.Serialize(await ReadLabourAsync(OwnerA));
        afterLabour.Should().Be(beforeLabour,
            "the owner's register — names, cells, headcounts, money — does not change when a person is retired");

        // The roster still lists him (history needs the name) but flags him inactive,
        // which is what the pickers filter on so he is not offered for NEW marks.
        var roster = await ReadRosterAsync(OwnerA);
        roster.Should().ContainSingle(o => o.Id == HistoricOperator && !o.IsActive && o.DisplayName == "Ganesh-History");
        output.WriteLine($"[REMOVE-HISTORY] marks={beforeMarks!.Split(',').Length} rowCounts equal, register JSON equal ({beforeLabour.Length} chars)");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Harness
    // ═════════════════════════════════════════════════════════════════════════

    private sealed record Outcome(bool Ok, string? Error, FieldOperatorDto? Dto);

    private async Task<Outcome> CreateAsync(Guid callerId, string name, Guid clientId, Guid? farm = null)
    {
        var farmId = farm ?? FarmA;
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        var ctx = sp.GetRequiredService<ShramSafalDbContext>();
        await using var tx = await ctx.Database.BeginTransactionAsync();

        var gate = await sp.GetRequiredService<ICallerFarmTenantScope>().EstablishForCallerAsync(farmId, callerId);
        if (!gate.IsSuccess)
        {
            await tx.RollbackAsync();
            return new Outcome(false, gate.Error.Code, null);
        }

        var result = await new CreateFieldOperatorHandler(
                sp.GetRequiredService<IShramSafalRepository>(), new GuidIdGenerator(), new FixedClock(Now))
            .HandleAsync(new CreateFieldOperatorCommand(
                new FarmId(farmId), name, null, new UserId(callerId), clientId));
        if (result.IsSuccess) await tx.CommitAsync(); else await tx.RollbackAsync();
        return new Outcome(result.IsSuccess, result.IsSuccess ? null : result.Error.Code, result.IsSuccess ? result.Value : null);
    }

    private async Task<Outcome> DeactivateAsync(Guid callerId, Guid operatorId, Guid? farm = null)
    {
        var farmId = farm ?? FarmA;
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        var ctx = sp.GetRequiredService<ShramSafalDbContext>();
        await using var tx = await ctx.Database.BeginTransactionAsync();

        var gate = await sp.GetRequiredService<ICallerFarmTenantScope>().EstablishForCallerAsync(farmId, callerId);
        if (!gate.IsSuccess)
        {
            await tx.RollbackAsync();
            return new Outcome(false, gate.Error.Code, null);
        }

        var result = await new DeactivateFieldOperatorHandler(
                sp.GetRequiredService<IShramSafalRepository>(), new FixedClock(Now))
            .HandleAsync(new DeactivateFieldOperatorCommand(new FarmId(farmId), operatorId, new UserId(callerId)));
        if (result.IsSuccess) await tx.CommitAsync(); else await tx.RollbackAsync();
        return new Outcome(result.IsSuccess, result.IsSuccess ? null : result.Error.Code, result.IsSuccess ? result.Value : null);
    }

    private async Task<LabourDataDto> ReadLabourAsync(Guid userId)
    {
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        var ctx = sp.GetRequiredService<ShramSafalDbContext>();
        await using var tx = await ctx.Database.BeginTransactionAsync();
        (await sp.GetRequiredService<ICallerFarmTenantScope>().EstablishForCallerAsync(FarmA, userId))
            .IsSuccess.Should().BeTrue();
        var result = await new GetLabourDataHandler(
                sp.GetRequiredService<IShramSafalRepository>(), new FixedClock(Now))
            .HandleAsync(new GetLabourDataQuery(new FarmId(FarmA), new UserId(userId), "alltime"));
        await tx.CommitAsync();
        result.IsSuccess.Should().BeTrue();
        return result.Value!;
    }

    private async Task<IReadOnlyList<FieldOperatorSummaryDto>> ReadRosterAsync(Guid userId)
    {
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        var ctx = sp.GetRequiredService<ShramSafalDbContext>();
        await using var tx = await ctx.Database.BeginTransactionAsync();
        (await sp.GetRequiredService<ICallerFarmTenantScope>().EstablishForCallerAsync(FarmA, userId))
            .IsSuccess.Should().BeTrue();
        var result = await new GetFieldOperatorsHandler(
                sp.GetRequiredService<IShramSafalRepository>(), new FixedClock(Now))
            .HandleAsync(new GetFieldOperatorsQuery(new FarmId(FarmA), new UserId(userId)));
        await tx.CommitAsync();
        result.IsSuccess.Should().BeTrue();
        return result.Value!;
    }

    private async Task AssertAppRoleIsNotVacuousAsync()
    {
        await using var appCheck = new NpgsqlConnection(_appConn);
        await appCheck.OpenAsync();
        await using var cmd = appCheck.CreateCommand();
        cmd.CommandText = RoleVacuityGuardSql;
        Convert.ToBoolean(await cmd.ExecuteScalarAsync()).Should().BeFalse(
            "doctrine E3 — a proof executed as a superuser or any BYPASSRLS role proves nothing");
    }

    /// <summary>Row count of every base table in ssf/public/accounts, read as the superuser.</summary>
    private async Task<Dictionary<string, long>> SnapshotRowCountsAsync()
    {
        await using var raw = new NpgsqlConnection(_superuserConn);
        await raw.OpenAsync();
        var tables = new List<string>();
        await using (var list = raw.CreateCommand())
        {
            list.CommandText = """
                SELECT table_schema || '.' || table_name FROM information_schema.tables
                WHERE table_type = 'BASE TABLE' AND table_schema IN ('ssf', 'public', 'accounts')
                  AND lower(table_name) NOT LIKE '%migrations%history%'
                ORDER BY 1;
                """;
            await using var rd = await list.ExecuteReaderAsync();
            while (await rd.ReadAsync()) tables.Add(rd.GetString(0));
        }

        var counts = new Dictionary<string, long>();
        foreach (var t in tables)
        {
            await using var c = raw.CreateCommand();
            var parts = t.Split('.', 2);
            c.CommandText = $"SELECT count(*) FROM \"{parts[0]}\".\"{parts[1]}\"";
            counts[t] = Convert.ToInt64(await c.ExecuteScalarAsync());
        }

        return counts;
    }

    private async Task<long> CountAsync(string fromWhere)
    {
        await using var raw = new NpgsqlConnection(_superuserConn);
        await raw.OpenAsync();
        await using var c = raw.CreateCommand();
        c.CommandText = $"SELECT count(*) FROM {fromWhere}";
        return Convert.ToInt64(await c.ExecuteScalarAsync());
    }

    private async Task<string?> ReadScalarAsync(string sql)
    {
        await using var raw = new NpgsqlConnection(_superuserConn);
        await raw.OpenAsync();
        await using var c = raw.CreateCommand();
        c.CommandText = sql;
        var v = await c.ExecuteScalarAsync();
        return v is null or DBNull ? null : v.ToString();
    }

    private async Task SeedOperatorViaSuperuserAsync(Guid id, string name, Guid farm, Guid createdBy)
    {
        await using var raw = new NpgsqlConnection(_superuserConn);
        await raw.OpenAsync();
        await SeedOperatorAsync(raw, id, name, farm, createdBy);
    }

    private async Task SetGrantAsync(Guid userId, bool granted, TimeSpan? expiresIn = null)
    {
        await using var raw = new NpgsqlConnection(_superuserConn);
        await raw.OpenAsync();
        await using var cmd = raw.CreateCommand();
        cmd.CommandText = """
            UPDATE ssf.farm_memberships
            SET can_manage_labour_records = @g, labour_grant_expires_at_utc = @exp
            WHERE farm_id = @farm AND user_id = @user;
            """;
        cmd.Parameters.AddWithValue("g", granted);
        cmd.Parameters.AddWithValue("exp", expiresIn is null ? DBNull.Value : Now.Add(expiresIn.Value));
        cmd.Parameters.AddWithValue("farm", FarmA);
        cmd.Parameters.AddWithValue("user", userId);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task ExecAsync(NpgsqlConnection db, string sql)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task SeedFarmAsync(NpgsqlConnection db, Guid farm, Guid owner, Guid account, string name)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status)
            VALUES (@id, @name, @owner, @account, NOW(), NOW(), 3.0, 'Unchecked');
            """;
        cmd.Parameters.AddWithValue("id", farm);
        cmd.Parameters.AddWithValue("name", name);
        cmd.Parameters.AddWithValue("owner", owner);
        cmd.Parameters.AddWithValue("account", account);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task SeedMembershipAsync(
        NpgsqlConnection db, Guid farm, Guid account, Guid userId, string role, bool grant)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.farm_memberships
                ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status, can_manage_labour_records)
            VALUES (@id, @farm, @user, @role, NOW(), NOW(), @account, 3, @grant);
            """;
        cmd.Parameters.AddWithValue("id", Guid.NewGuid());
        cmd.Parameters.AddWithValue("farm", farm);
        cmd.Parameters.AddWithValue("user", userId);
        cmd.Parameters.AddWithValue("role", role);
        cmd.Parameters.AddWithValue("account", account);
        cmd.Parameters.AddWithValue("grant", grant);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task SeedOperatorAsync(NpgsqlConnection db, Guid id, string name, Guid farm, Guid createdBy)
    {
        await using var op = db.CreateCommand();
        op.CommandText = """
            INSERT INTO ssf.field_operators
                ("Id", display_name, display_name_normalized, full_name,
                 originating_farm_id, created_by_user_id, created_at_utc, is_active)
            VALUES (@id, @name, lower(@name), NULL, @fid, @uid, NOW(), TRUE);
            """;
        op.Parameters.AddWithValue("id", id);
        op.Parameters.AddWithValue("name", name);
        op.Parameters.AddWithValue("fid", farm);
        op.Parameters.AddWithValue("uid", createdBy);
        await op.ExecuteNonQueryAsync();
    }

    private static async Task SeedMarkAsync(
        NpgsqlConnection db, Guid farm, Guid op, DateOnly date, int day, int night, Guid by)
    {
        await using var c = db.CreateCommand();
        c.CommandText = """
            INSERT INTO ssf.attendance_marks
                ("Id", farm_id, field_operator_id, work_date, day_mark, night_mark,
                 recorded_by_user_id, recorded_at_utc, modified_at_utc)
            VALUES (@id, @fid, @oid, @d, @day, @night, @uid, NOW(), NOW());
            """;
        c.Parameters.AddWithValue("id", Guid.NewGuid());
        c.Parameters.AddWithValue("fid", farm);
        c.Parameters.AddWithValue("oid", op);
        c.Parameters.AddWithValue("d", date);
        c.Parameters.AddWithValue("day", day);
        c.Parameters.AddWithValue("night", night);
        c.Parameters.AddWithValue("uid", by);
        await c.ExecuteNonQueryAsync();
    }

    private sealed class FixedClock(DateTime utcNow) : IClock
    {
        public DateTime UtcNow => utcNow;
    }
}
