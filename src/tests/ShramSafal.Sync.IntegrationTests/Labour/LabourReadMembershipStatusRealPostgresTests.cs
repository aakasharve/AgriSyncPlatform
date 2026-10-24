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
/// R1 closure — <b>CHARACTERIZATION, not a blessing.</b> What each of the six
/// <c>MembershipStatus</c> values actually gets from the Labour/हजेरी read
/// today, proven end to end against real Postgres as <c>agrisync_app</c>.
///
/// <para><b>Read this before touching a single assertion.</b> The founder's
/// stated expectation is:
/// <code>
/// Active                                       -> normal role/view rules
/// PendingOtpClaim / PendingApproval / Suspended -> NO operational access
/// Revoked / Exited                              -> NO operational access
/// </code>
/// The code does NOT do that today, and this suite exists to say so in a form
/// that cannot rot. Four statuses pass — Active AND the three non-terminal
/// non-Active ones — because every layer of the read filters on
/// <i>non-terminal</i> (<c>status NOT IN (5, 6)</c>) rather than on
/// <i>operationally active</i>:
/// <list type="number">
/// <item>the endpoint gate — <c>CallerFarmTenantScope.EstablishForCallerAsync</c>
/// (CallerFarmTenantScope.cs:99-108) via
/// <c>ShramSafalRepository.GetFarmMembershipForTenantAsync</c> (:1183-1195)</item>
/// <item>the RLS layer — <c>p_user_select_farms</c>,
/// <c>p_user_select_daily_logs</c>, <c>p_user_select_labour_assignments</c>,
/// each testing <c>m.status NOT IN (5, 6)</c></item>
/// <item>the handler gate — <c>GetLabourDataHandler</c>:173-178 via
/// <c>ShramSafalRepository.GetUserRoleForFarmAsync</c> (:91-95)</item>
/// </list>
/// </para>
///
/// <para><b>These assertions are a TRIPWIRE.</b> They are worded as "currently"
/// on purpose. The moment a central membership predicate is introduced and the
/// labour read is wired to it, this suite goes RED — which is the point. Update
/// it deliberately, alongside the founder's decision; never delete it, and never
/// weaken it into "any non-terminal status may read", which is the very claim
/// under review.</para>
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
    // THE claim: what each of the six statuses gets from the labour read TODAY.
    // ═════════════════════════════════════════════════════════════════════════

    /// <summary>
    /// Every status, every layer, one table. Deliberately ONE [Fact]: the
    /// finding is the SHAPE of the six answers together — four in, two out —
    /// and six independent facts would let five stay green while the sixth
    /// changed, which is exactly how a boundary drifts unnoticed.
    /// </summary>
    [Fact]
    public async Task Four_of_the_six_membership_statuses_currently_pass_the_labour_read_gate()
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
                + $"view={probe.View ?? probe.ErrorCode}");
        }

        // ── Active: the only status the founder's model admits. ──
        probes["Active"].GateAdmits.Should().BeTrue();
        probes["Active"].Role.Should().Be("Mukadam");
        probes["Active"].HandlerSucceeded.Should().BeTrue();
        probes["Active"].View.Should().Be("crew", "an Active Mukadam gets the हजेरी register — D-H8");

        // ── Revoked / Exited: refused, as they must be. ──
        foreach (var terminal in new[] { "Revoked", "Exited" })
        {
            probes[terminal].GateAdmits.Should().BeFalse(
                $"{terminal} is terminal — CallerFarmTenantScope must refuse before any farm_id GUC is set");
            probes[terminal].ErrorCode.Should().Be("ShramSafal.Forbidden",
                "Forbidden, never NotFound — a distinct NotFound would turn the endpoint into an "
                + "existence oracle");
            probes[terminal].HandlerSucceeded.Should().BeFalse();
        }

        // ── THE FINDING. Three statuses the founder expects to be shut out are
        //    admitted with the SAME access an Active member gets. Nothing in the
        //    response marks them as provisional or suspended.
        foreach (var admitted in new[] { "PendingOtpClaim", "PendingApproval", "Suspended" })
        {
            probes[admitted].GateAdmits.Should().BeTrue(
                "CURRENT behaviour, under review: the endpoint gate filters on NON-TERMINAL "
                + $"(status NOT IN (5,6)) and so admits {admitted}. The founder's expectation is that it "
                + "should NOT — read this class's summary before changing this line");
            probes[admitted].Role.Should().Be("Mukadam",
                $"CURRENT behaviour: GetUserRoleForFarmAsync returns the role for {admitted} too");
            probes[admitted].HandlerSucceeded.Should().BeTrue(
                $"CURRENT behaviour: GetLabourDataHandler serves {admitted} the labour read");
            probes[admitted].View.Should().Be("crew",
                $"CURRENT behaviour: {admitted} receives the SAME हजेरी register an Active Mukadam gets — "
                + "there is no provisional or suspended projection anywhere in the response");
        }
    }

    /// <summary>
    /// The RLS half, below the application entirely: raw SQL as
    /// <c>agrisync_app</c> with only <c>agrisync.user_id</c> meaningful (the
    /// farm GUC held at the all-zeros sentinel, exactly as
    /// <c>CallerFarmTenantScope</c> step 3b leaves it before the gate decides).
    /// Proves the database agrees with the application about which statuses
    /// count — so a fix applied in C# alone would leave this half unchanged.
    /// </summary>
    [Fact]
    public async Task The_user_scoped_RLS_policies_admit_the_same_four_statuses()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var visible = new Dictionary<string, long>();
        foreach (var (status, name, user) in Cases)
        {
            visible[name] = await VisibleFarmRowsAsync(user);
            output.WriteLine($"[EVIDENCE] status {status} {name,-16} ssf.farms rows visible = {visible[name]}");
        }

        visible["Active"].Should().Be(1);
        visible["Revoked"].Should().Be(0, "p_user_select_farms excludes status 5");
        visible["Exited"].Should().Be(0, "p_user_select_farms excludes status 6");

        foreach (var admitted in new[] { "PendingOtpClaim", "PendingApproval", "Suspended" })
        {
            visible[admitted].Should().Be(1,
                "CURRENT behaviour, under review: p_user_select_farms (and its siblings on daily_logs, "
                + $"labour_assignments, cost_entries, …) test 'status NOT IN (5, 6)', so {admitted} sees "
                + "the farm. A central predicate applied only in C# would NOT move this number");
        }
    }

    /// <summary>
    /// The sharpest form. A SUSPENDED co-owner is not merely let in — he is let
    /// in to the OWNER BOOK, money included. Suspension currently withholds
    /// nothing at all.
    /// </summary>
    [Fact]
    public async Task A_suspended_secondary_owner_currently_receives_the_whole_wage_book()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var probe = await ProbeAsync(SuspendedSecondaryOwner);

        probe.GateAdmits.Should().BeTrue();
        probe.Role.Should().Be("SecondaryOwner");
        probe.HandlerSucceeded.Should().BeTrue();
        probe.View.Should().Be("owner",
            "CURRENT behaviour, under review: ResolveRegisterView reads the role and never the status, "
            + "so a SUSPENDED co-owner gets LabourRegisterView.OwnerBook — the money roster, the ledger "
            + "and the review inbox. Suspension withholds nothing today");

        output.WriteLine("[EVIDENCE] === suspended SecondaryOwner ===");
        output.WriteLine($"[EVIDENCE] gate={probe.GateAdmits} role={probe.Role} view={probe.View} (expect owner — the defect)");
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
        bool GateAdmits, string? ErrorCode, string? Role, bool HandlerSucceeded, string? View);

    /// <summary>
    /// Mirrors the production request exactly: the ambient transaction
    /// <c>TenantTransactionMiddleware</c> opens, then the REAL
    /// <see cref="ICallerFarmTenantScope"/> (not a hand-rolled imitation of it),
    /// then the REAL handler on the REAL repository over the <c>agrisync_app</c>
    /// connection — so RLS is in the path, not bypassed.
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
        if (!gate.IsSuccess)
        {
            await tx.RollbackAsync();
            return new StatusProbe(false, gate.Error.Code, null, false, null);
        }

        var repository = sp.GetRequiredService<IShramSafalRepository>();
        var role = await repository.GetUserRoleForFarmAsync(farm, userId);

        var result = await new GetLabourDataHandler(repository, new FixedClock(Now))
            .HandleAsync(new GetLabourDataQuery(new FarmId(farm), new UserId(userId)));

        await tx.CommitAsync();

        return new StatusProbe(
            GateAdmits: true,
            ErrorCode: result.IsSuccess ? null : result.Error.Code,
            Role: role?.ToString(),
            HandlerSucceeded: result.IsSuccess,
            View: result.IsSuccess ? result.Value!.View : null);
    }

    /// <summary>
    /// How many rows of <c>ssf.farms</c> this user can see with ONLY
    /// <c>agrisync.user_id</c> meaningful — the farm GUC held at the all-zeros
    /// sentinel so the tenant policy contributes nothing and the user-scoped
    /// policy is the sole answer.
    /// </summary>
    private async Task<long> VisibleFarmRowsAsync(Guid userId)
    {
        await using var db = new NpgsqlConnection(_appConn);
        await db.OpenAsync();
        await using var tx = await db.BeginTransactionAsync();
        await SetGucAsync(db, "agrisync.user_id", userId);
        await SetGucAsync(db, "agrisync.farm_id", Guid.Empty);

        var count = Convert.ToInt64(await ScalarAsync(db,
            "SELECT count(*) FROM ssf.farms WHERE \"Id\" = @f", ("f", Farm)));
        await tx.RollbackAsync();
        return count;
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
