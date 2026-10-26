// spec: 2026-08-28-labour-v2-release-1
using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Labour.GetLabourData;
using ShramSafal.Infrastructure;
using ShramSafal.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Labour;

/// <summary>
/// R1 closure, then spec: plr-d7-m1-multiuser-2026-10-26 (step 1, BN-1) — what each of the six
/// <c>MembershipStatus</c> values gets from the Labour/हजेरी read, proven end to end against
/// real Postgres as <c>agrisync_app</c>.
///
/// <para><b>Read this before touching a single assertion.</b> The founder's
/// stated expectation is:
/// <code>
/// Active                                       -> normal role/view rules
/// PendingOtpClaim / PendingApproval / Suspended -> NO operational access
/// Revoked / Exited                              -> NO operational access
/// </code>
/// Until step 1 the code did NOT do that: four statuses passed, because every layer filtered on
/// <i>non-terminal</i> (<c>status NOT IN (5, 6)</c>). This suite was the tripwire for exactly
/// that, worded "currently". Step 1 made the gap reachable from the internet (typing a farm
/// code stores a PendingApproval seat), so the Active-only predicate landed with it, and the
/// assertions were flipped DELIBERATELY to the founder's expectation (plan step 2 named these
/// three facts). Each layer is now asserted to refuse on its own:
/// <list type="number">
/// <item>the endpoint gate — <c>CallerFarmTenantScope.EstablishForCallerAsync</c> via
/// <c>ShramSafalRepository.GetFarmMembershipForTenantAsync</c> (<c>status = 3</c>)</item>
/// <item>the handler gate — <c>GetLabourDataHandler</c> via
/// <c>ShramSafalRepository.GetUserRoleForFarmAsync</c> (Active seats only)</item>
/// <item>the RLS layer — every <c>p_user_select_*</c> DATA policy tests <c>m.status = 3</c>
/// (migration <c>RequireActiveMembershipForUserScopedDataReads</c>); <c>p_user_select_farms</c>
/// deliberately keeps "not ended" so a pending / paused person can see THAT he is</item>
/// </list>
/// </para>
///
/// <para><b>Never delete this suite, and never weaken it back into "any non-terminal status may
/// read".</b> The registrant shortcut (last fact) is unchanged on purpose and still recorded
/// here, so its own fix decides it deliberately.</para>
///
/// <para><b>Doctrine E3 — vacuity guard.</b> Every [Fact] opens with the
/// <c>rolsuper OR rolbypassrls</c> check on the SAME role the code under test
/// uses. An RLS proof run as a superuser proves nothing.</para>
///
/// <para><b>Posture.</b> Fresh scratch database per class
/// (<c>ssf_memberstatus_{Guid:N}</c>) via <see cref="IntegrationMigrationChain"/>,
/// dropped on dispose. Never <c>agrisync_dev</c>, never
/// <c>agrisync_dev_v2</c>.</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class LabourReadMembershipStatusRealPostgresTests(Xunit.Abstractions.ITestOutputHelper output)
    : IAsyncLifetime
{
    private const string RoleVacuityGuardSql =
        "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user";

    private const string AppRoleUser = TestRoleCredentials.AppRoleUser;
    private static string AppRolePassword => TestRoleCredentials.AppRolePassword;

    private static readonly DateTime Now = new(2026, 9, 3, 6, 0, 0, DateTimeKind.Utc);

    // ── The farm under test, and its DECLARED owner (ssf.farms.owner_user_id). ──
    private static readonly Guid Farm = Guid.Parse("5a000000-0000-0000-0000-0000000000f1");
    private static readonly Guid Account = Guid.Parse("5a000000-0000-0000-0000-0000000000a1");
    private static readonly Guid Owner = Guid.Parse("5a000000-0000-0000-0000-0000000000e1");

    /// <summary>
    /// Six Mukadams, one per status. The ROLE is held constant on purpose:
    /// status is the only variable, so a difference in outcome can only be the
    /// status. Mukadam because his view (<c>CrewAttendance</c>) IS the हजेरी
    /// register — the surface the founder asked about.
    /// </summary>
    private static readonly (int Status, string Name, Guid User)[] Cases =
    [
        (1, "PendingOtpClaim", Guid.Parse("5a000000-0000-0000-0000-000000000001")),
        (2, "PendingApproval", Guid.Parse("5a000000-0000-0000-0000-000000000002")),
        (3, "Active", Guid.Parse("5a000000-0000-0000-0000-000000000003")),
        (4, "Suspended", Guid.Parse("5a000000-0000-0000-0000-000000000004")),
        (5, "Revoked", Guid.Parse("5a000000-0000-0000-0000-000000000005")),
        (6, "Exited", Guid.Parse("5a000000-0000-0000-0000-000000000006")),
    ];

    /// <summary>A SUSPENDED SecondaryOwner — the sharpest form of the same defect.</summary>
    private static readonly Guid SuspendedSecondaryOwner =
        Guid.Parse("5a000000-0000-0000-0000-0000000000c4");

    // ── A second farm whose DECLARED owner's membership row was revoked. ──
    private static readonly Guid GhostFarm = Guid.Parse("5b000000-0000-0000-0000-0000000000f2");
    private static readonly Guid GhostAccount = Guid.Parse("5b000000-0000-0000-0000-0000000000a2");
    private static readonly Guid GhostOwner = Guid.Parse("5b000000-0000-0000-0000-0000000000e2");

    private string _adminConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private string _superuserConn = string.Empty;
    private string _appConn = string.Empty;
    private ServiceProvider? _rootProvider;

    public async Task InitializeAsync()
    {
        _adminConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();

        _scratchDbName = $"ssf_memberstatus_{Guid.NewGuid():N}";
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

        // Planted as SUPERUSER: the plant must never depend on the code under
        // test, and superuser bypasses RLS so the seed cannot itself be a proof.
        await using (var raw = new NpgsqlConnection(_superuserConn))
        {
            await raw.OpenAsync();

            // HARNESS PARITY, not a product change. 20260515090000_BootstrapDbRoles
            // grants agrisync_app only on schema ssf; the labour read also reaches
            // public.users (GetOperatorsByIdsAsync, ShramSafalRepository.cs:1103)
            // for the operator directory, and that grant is provisioned outside
            // the migration chain on real environments. Without it a scratch DB
            // fails 42501 on a code path that works in production, which would
            // make this suite prove the wrong thing.
            await using (var grant = raw.CreateCommand())
            {
                grant.CommandText =
                    "GRANT USAGE ON SCHEMA public TO agrisync_app;"
                    + "GRANT SELECT ON ALL TABLES IN SCHEMA public TO agrisync_app;";
                await grant.ExecuteNonQueryAsync();
            }

            await SeedFarmAsync(raw, Farm, Owner, Account, "Membership-Status Boundary Farm");
            await SeedMembershipAsync(raw, Farm, Owner, Account, "PrimaryOwner", status: 3);

            foreach (var (status, _, user) in Cases)
            {
                await SeedMembershipAsync(raw, Farm, user, Account, "Mukadam", status);
            }

            await SeedMembershipAsync(raw, Farm, SuspendedSecondaryOwner, Account, "SecondaryOwner", status: 4);

            // One DATA row, so the RLS fact can tell "sees the farm row" (relationship) from
            // "sees the farm's data" (access).
            await using (var plot = raw.CreateCommand())
            {
                plot.CommandText = """
                    INSERT INTO ssf.plots ("Id", farm_id, name, area_in_acres, created_at_utc, modified_at_utc)
                    VALUES (@id, @farm, 'Status Boundary Plot', 1.0, NOW(), NOW());
                    """;
                plot.Parameters.AddWithValue("id", Guid.NewGuid());
                plot.Parameters.AddWithValue("farm", Farm);
                await plot.ExecuteNonQueryAsync();
            }

            await SeedFarmAsync(raw, GhostFarm, GhostOwner, GhostAccount, "Revoked-Declared-Owner Farm");
            await SeedMembershipAsync(raw, GhostFarm, GhostOwner, GhostAccount, "PrimaryOwner", status: 5);
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
        services.AddScoped<IClock, SystemClock>();

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
        var (role, superOrBypass) = await ReadAppRolePostureAsync();

        superOrBypass.Should().BeFalse(
            "doctrine E3 — a security proof run as a superuser or BYPASSRLS role proves NOTHING and is "
            + "worse than no suite at all, because it manufactures false confidence");
        role.Should().Be(AppRoleUser);

        output.WriteLine("[EVIDENCE] === vacuity guard (doctrine E3) ===");
        output.WriteLine($"[EVIDENCE] SQL: {RoleVacuityGuardSql}");
        output.WriteLine($"[EVIDENCE] current_user = '{role}'  rolsuper OR rolbypassrls = {superOrBypass} (REQUIRED False)");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // THE claim: what each of the six statuses gets from the labour read.
    // ═════════════════════════════════════════════════════════════════════════

    /// <summary>
    /// Every status, every layer, one table. Deliberately ONE [Fact]: the
    /// finding is the SHAPE of the six answers together — one in, five out —
    /// and six independent facts would let five stay green while the sixth
    /// changed, which is exactly how a boundary drifts unnoticed. Each layer
    /// (endpoint gate, role read, handler) is probed on its OWN, so a fix in
    /// one layer cannot hide a hole in another.
    /// </summary>
    [Fact]
    public async Task Only_Active_of_the_six_membership_statuses_passes_the_labour_read_gate()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var probes = new Dictionary<string, StatusProbe>();
        foreach (var (status, name, user) in Cases)
        {
            var probe = await ProbeAsync(user);
            probes[name] = probe;
            output.WriteLine(
                $"[EVIDENCE] status {status} {name,-16} endpointGate={probe.GateAdmits,-5} "
                + $"role={probe.Role ?? "<null>",-14} read={probe.HandlerSucceeded,-5} "
                + $"view={probe.View ?? probe.HandlerError}");
        }

        // ── Active: the only status the founder's model admits. ──
        probes["Active"].GateAdmits.Should().BeTrue();
        probes["Active"].Role.Should().Be("Mukadam");
        probes["Active"].HandlerSucceeded.Should().BeTrue();
        probes["Active"].View.Should().Be("crew", "an Active Mukadam gets the हजेरी register — D-H8");

        // ── Everyone else: refused at EVERY layer. PendingOtpClaim / PendingApproval /
        //    Suspended are no longer admitted with an Active member's access (spec
        //    plr-d7-m1-multiuser-2026-10-26 step 1, BN-1 — the founder's expectation above).
        foreach (var refused in new[] { "PendingOtpClaim", "PendingApproval", "Suspended", "Revoked", "Exited" })
        {
            probes[refused].GateAdmits.Should().BeFalse(
                $"{refused} is not Active — CallerFarmTenantScope must refuse before any farm_id GUC is set");
            probes[refused].GateError.Should().Be("ShramSafal.Forbidden",
                "Forbidden, never NotFound — a distinct NotFound would turn the endpoint into an "
                + "existence oracle");
            probes[refused].Role.Should().BeNull(
                $"GetUserRoleForFarmAsync must not hand {refused} a role to act as");
            probes[refused].HandlerSucceeded.Should().BeFalse(
                $"GetLabourDataHandler must not serve {refused} the labour read even if a gate above it were skipped");
            probes[refused].View.Should().BeNull();
        }
    }

    /// <summary>
    /// The RLS half, below the application entirely: raw SQL as
    /// <c>agrisync_app</c> with only <c>agrisync.user_id</c> meaningful (the
    /// farm GUC held at the all-zeros sentinel, exactly as
    /// <c>CallerFarmTenantScope</c> step 3b leaves it before the gate decides).
    /// Proves the database agrees with the application about which statuses
    /// count — a fix applied in C# alone would leave the data column unchanged.
    /// </summary>
    [Fact]
    public async Task The_user_scoped_RLS_shows_the_farm_row_to_every_live_seat_but_its_data_to_Active_only()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var visible = new Dictionary<string, (long Farms, long Plots)>();
        foreach (var (status, name, user) in Cases)
        {
            visible[name] = await VisibleRowsAsync(user);
            output.WriteLine(
                $"[EVIDENCE] status {status} {name,-16} ssf.farms rows visible = {visible[name].Farms}  "
                + $"ssf.plots rows visible = {visible[name].Plots}");
        }

        visible["Active"].Should().Be((1L, 1L));
        visible["Revoked"].Should().Be((0L, 0L), "status 5 is terminal");
        visible["Exited"].Should().Be((0L, 0L), "status 6 is terminal");

        foreach (var live in new[] { "PendingOtpClaim", "PendingApproval", "Suspended" })
        {
            visible[live].Farms.Should().Be(1,
                "p_user_select_farms keeps 'not ended' on purpose: /farms/mine shows a pending or paused "
                + "person THAT he is pending or paused (name + status, no data)");
            visible[live].Plots.Should().Be(0,
                $"every p_user_select_* DATA policy counts Active seats only (m.status = 3), so {live} "
                + "reads none of the farm's rows");
        }
    }

    /// <summary>
    /// The sharpest form, before step 1: a SUSPENDED co-owner was let in to the OWNER BOOK,
    /// money included. Suspension now withholds the whole read.
    /// </summary>
    [Fact]
    public async Task A_suspended_secondary_owner_receives_nothing_of_the_wage_book()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var probe = await ProbeAsync(SuspendedSecondaryOwner);

        probe.GateAdmits.Should().BeFalse();
        probe.GateError.Should().Be("ShramSafal.Forbidden");
        probe.Role.Should().BeNull("a paused co-owner holds no role to act as");
        probe.HandlerSucceeded.Should().BeFalse();
        probe.View.Should().BeNull("no LabourRegisterView at all — never OwnerBook");

        output.WriteLine("[EVIDENCE] === suspended SecondaryOwner ===");
        output.WriteLine($"[EVIDENCE] gate={probe.GateAdmits} role={probe.Role ?? "<null>"} handler={probe.HandlerError}");
    }

    /// <summary>
    /// The declared-owner shortcut is status-BLIND at all three layers
    /// (<c>GetUserRoleForFarmAsync</c>:82-89,
    /// <c>GetFarmMembershipForTenantAsync</c>:1165-1173, and the
    /// <c>f.owner_user_id = …</c> arm of every user-scoped policy). It is a
    /// deliberate fallback for seeded farms whose membership row is absent —
    /// but it also means revoking the declared owner's membership row removes
    /// NOTHING. Named here so the fix, when it comes, decides this on purpose
    /// rather than by omission.
    /// </summary>
    [Fact]
    public async Task Revoking_the_declared_owners_membership_row_currently_removes_no_labour_access()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var probe = await ProbeAsync(GhostOwner, GhostFarm);

        probe.GateAdmits.Should().BeTrue(
            "CURRENT behaviour: the owner shortcut on ssf.farms.owner_user_id runs BEFORE the membership "
            + "read and is not conditioned on status");
        probe.Role.Should().Be("PrimaryOwner");
        probe.HandlerSucceeded.Should().BeTrue();
        probe.View.Should().Be("owner");

        output.WriteLine("[EVIDENCE] === declared owner with a Revoked(5) membership row ===");
        output.WriteLine($"[EVIDENCE] gate={probe.GateAdmits} role={probe.Role} view={probe.View}");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Harness
    // ═════════════════════════════════════════════════════════════════════════

    private sealed record StatusProbe(
        bool GateAdmits, string? GateError, string? Role, bool HandlerSucceeded, string? HandlerError, string? View);

    /// <summary>
    /// Mirrors the production request exactly: the ambient transaction
    /// <c>TenantTransactionMiddleware</c> opens, then the REAL
    /// <see cref="ICallerFarmTenantScope"/> (not a hand-rolled imitation of it),
    /// then the REAL handler on the REAL repository over the <c>agrisync_app</c>
    /// connection — so RLS is in the path, not bypassed.
    ///
    /// <para>The role read and the handler run whether or not the gate admitted the caller
    /// (production would stop at a refused gate): each layer is asserted to refuse ON ITS OWN,
    /// so a later change that skips one gate cannot pass unnoticed behind another.</para>
    /// </summary>
    private async Task<StatusProbe> ProbeAsync(Guid userId, Guid? farmId = null)
    {
        var farm = farmId ?? Farm;

        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        var ctx = sp.GetRequiredService<ShramSafalDbContext>();

        await using var tx = await ctx.Database.BeginTransactionAsync();

        var gate = await sp.GetRequiredService<ICallerFarmTenantScope>()
            .EstablishForCallerAsync(farm, userId);

        var repository = sp.GetRequiredService<IShramSafalRepository>();
        var role = await repository.GetUserRoleForFarmAsync(farm, userId);

        var result = await new GetLabourDataHandler(repository, new FixedClock(Now))
            .HandleAsync(new GetLabourDataQuery(new FarmId(farm), new UserId(userId)));

        await tx.RollbackAsync();

        return new StatusProbe(
            GateAdmits: gate.IsSuccess,
            GateError: gate.IsSuccess ? null : gate.Error.Code,
            Role: role?.ToString(),
            HandlerSucceeded: result.IsSuccess,
            HandlerError: result.IsSuccess ? null : result.Error.Code,
            View: result.IsSuccess ? result.Value!.View : null);
    }

    /// <summary>
    /// How many rows of <c>ssf.farms</c> (the relationship) and <c>ssf.plots</c> (the farm's
    /// data) this user can see with ONLY <c>agrisync.user_id</c> meaningful — the farm GUC held
    /// at the all-zeros sentinel so the tenant policies contribute nothing and the user-scoped
    /// policies are the sole answer.
    /// </summary>
    private async Task<(long Farms, long Plots)> VisibleRowsAsync(Guid userId)
    {
        await using var db = new NpgsqlConnection(_appConn);
        await db.OpenAsync();
        await using var tx = await db.BeginTransactionAsync();
        await SetGucAsync(db, "agrisync.user_id", userId);
        await SetGucAsync(db, "agrisync.farm_id", Guid.Empty);

        var farms = Convert.ToInt64(await ScalarAsync(db,
            "SELECT count(*) FROM ssf.farms WHERE \"Id\" = @f", ("f", Farm)));
        var plots = Convert.ToInt64(await ScalarAsync(db,
            "SELECT count(*) FROM ssf.plots WHERE farm_id = @f", ("f", Farm)));
        await tx.RollbackAsync();
        return (farms, plots);
    }

    private async Task<(string Role, bool SuperOrBypass)> ReadAppRolePostureAsync()
    {
        await using var appCheck = new NpgsqlConnection(_appConn);
        await appCheck.OpenAsync();
        var role = Convert.ToString(await ScalarAsync(appCheck, "SELECT current_user")) ?? string.Empty;
        var superOrBypass = Convert.ToBoolean(await ScalarAsync(appCheck, RoleVacuityGuardSql));
        return (role, superOrBypass);
    }

    private async Task AssertAppRoleIsNotVacuousAsync()
    {
        var (role, superOrBypass) = await ReadAppRolePostureAsync();
        superOrBypass.Should().BeFalse(
            "doctrine E3 — a proof executed as a superuser or any BYPASSRLS role proves nothing; "
            + $"current_user='{role}'");
    }

    private static async Task SetGucAsync(NpgsqlConnection db, string key, Guid value)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT set_config(@k, @v, true)";
        cmd.Parameters.AddWithValue("k", key);
        cmd.Parameters.AddWithValue("v", value.ToString());
        await cmd.ExecuteNonQueryAsync();
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

    /// <summary>
    /// <paramref name="status"/> is the RAW <c>MembershipStatus</c> ordinal —
    /// 1 PendingOtpClaim, 2 PendingApproval, 3 Active, 4 Suspended, 5 Revoked,
    /// 6 Exited. Planted as raw SQL because the aggregate's state machine has
    /// no on-demand path to some of these, and because the plant must not
    /// depend on the code under test.
    /// </summary>
    private static async Task SeedMembershipAsync(
        NpgsqlConnection db, Guid farmId, Guid userId, Guid ownerAccountId, string role, int status)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.farm_memberships
                ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status)
            VALUES (@id, @farm, @user, @role, NOW(), NOW(), @account, @status);
            """;
        cmd.Parameters.AddWithValue("id", Guid.NewGuid());
        cmd.Parameters.AddWithValue("farm", farmId);
        cmd.Parameters.AddWithValue("user", userId);
        cmd.Parameters.AddWithValue("role", role);
        cmd.Parameters.AddWithValue("account", ownerAccountId);
        cmd.Parameters.AddWithValue("status", status);
        await cmd.ExecuteNonQueryAsync();
    }

    private sealed class FixedClock(DateTime utcNow) : IClock
    {
        public DateTime UtcNow => utcNow;
    }
}
