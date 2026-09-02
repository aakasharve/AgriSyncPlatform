// spec: 2026-08-12-labour-phase2-server-truth-farm-context
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Application.UseCases.Memberships.GetLabourPermissions;
using ShramSafal.Application.UseCases.Memberships.SetLabourPermission;
using ShramSafal.Infrastructure;
using ShramSafal.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Labour;

/// <summary>
/// LABOUR_PHASE2 Phase 5 — <b>a grant on Farm A does nothing on Farm B</b>,
/// proven as <c>agrisync_app</c> against real Postgres, in both directions
/// (founder decision O-4).
///
/// <para><b>Doctrine E3 — the assertion that makes or voids this class.</b> An
/// RLS proof executed as a superuser or any <c>BYPASSRLS</c> role proves
/// NOTHING. Every [Fact] opens with <see cref="AssertAppRoleIsNotVacuousAsync"/>
/// (<c>SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname =
/// current_user</c>, required <c>false</c>) on the SAME connection the code
/// under test uses, and <see cref="InitializeAsync"/> runs it too so the suite
/// cannot reach a [Fact] with a bypassing role.</para>
///
/// <para><b>Doctrine E4 — the database is not the whole defence, so both halves
/// are proven separately.</b> Postgres FK checks bypass RLS entirely, and
/// <c>p_user_select_memberships</c> is a PERMISSIVE <c>FOR SELECT</c> policy
/// OR-ed with the tenant policy. So this suite proves (a) the POLICY refuses a
/// forged cross-farm write below the handler, with a control showing the
/// identical write lands on the scoped farm — and (b) the HANDLER refuses a
/// cross-farm grant above it. Either alone would leave the other unproven; the
/// application-code half is additionally attacked with a leaking repository in
/// <c>LabourCapabilityGateTests</c>, where an invisible row cannot masquerade as
/// a rejection.</para>
///
/// <para><b>Posture.</b> Fresh scratch database per class
/// (<c>ssf_capgrant_{Guid:N}</c>) via <see cref="IntegrationMigrationChain"/>,
/// dropped on dispose. Never <c>agrisync_dev</c>, never
/// <c>agrisync_dev_v2</c>.</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class LabourCapabilityGrantRealPostgresTests(Xunit.Abstractions.ITestOutputHelper output)
    : IAsyncLifetime
{
    private const string RoleVacuityGuardSql =
        "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user";

    private const string AppRoleUser = TestRoleCredentials.AppRoleUser;
    private static string AppRolePassword => TestRoleCredentials.AppRolePassword;

    // ── Farm A ────────────────────────────────────────────────────────────────
    private static readonly Guid FarmA = Guid.Parse("c9a11111-1111-1111-1111-111111111111");
    private static readonly Guid AccountA = Guid.Parse("c9a22222-2222-2222-2222-222222222222");
    private static readonly Guid OwnerA = Guid.Parse("c9a33333-3333-3333-3333-333333333333");

    // ── Farm B ────────────────────────────────────────────────────────────────
    private static readonly Guid FarmB = Guid.Parse("c9b11111-1111-1111-1111-111111111111");
    private static readonly Guid AccountB = Guid.Parse("c9b22222-2222-2222-2222-222222222222");
    private static readonly Guid OwnerB = Guid.Parse("c9b33333-3333-3333-3333-333333333333");

    /// <summary>
    /// A Worker who is an ACTIVE member of BOTH farms. Load-bearing: it is what
    /// makes "a grant on Farm A does nothing on Farm B" a statement about the
    /// SAME PERSON rather than about two unrelated rows.
    /// </summary>
    private static readonly Guid WorkerBoth = Guid.Parse("c9c44444-4444-4444-4444-444444444444");

    private string _adminConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private string _superuserConn = string.Empty;
    private string _appConn = string.Empty;
    private ServiceProvider? _rootProvider;

    public async Task InitializeAsync()
    {
        _adminConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();

        _scratchDbName = $"ssf_capgrant_{Guid.NewGuid():N}";
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

        // Planted as SUPERUSER on purpose: the plant must never depend on the
        // code under test, and superuser bypasses RLS so the seed cannot itself
        // be a proof.
        await using (var raw = new NpgsqlConnection(_superuserConn))
        {
            await raw.OpenAsync();
            await SeedFarmAsync(raw, FarmA, OwnerA, AccountA, "Capability Farm A");
            await SeedMembershipAsync(raw, FarmA, OwnerA, AccountA, "PrimaryOwner");
            await SeedMembershipAsync(raw, FarmA, WorkerBoth, AccountA, "Worker");

            await SeedFarmAsync(raw, FarmB, OwnerB, AccountB, "Capability Farm B");
            await SeedMembershipAsync(raw, FarmB, OwnerB, AccountB, "PrimaryOwner");
            await SeedMembershipAsync(raw, FarmB, WorkerBoth, AccountB, "Worker");
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

    // ═════════════════════════════════════════════════════════════════════════
    // The vacuity guard — everything else is conditional on this.
    // ═════════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task The_app_role_is_neither_superuser_nor_bypassrls_so_this_suite_is_not_vacuous()
    {
        var (role, superOrBypass) = await ReadAppRolePostureAsync();

        superOrBypass.Should().BeFalse(
            "doctrine E3 — a security proof run as a superuser or BYPASSRLS role proves NOTHING and is "
            + "worse than no suite at all, because it manufactures false confidence");
        role.Should().Be(AppRoleUser);

        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();
        var (enabled, forced) = await ReadRlsFlagsAsync(read, "ssf.farm_memberships");
        enabled.Should().BeTrue();
        forced.Should().BeTrue("plain ENABLE exempts the table OWNER, and migrations run as the owner");

        output.WriteLine("[EVIDENCE] === vacuity guard (doctrine E3) ===");
        output.WriteLine($"[EVIDENCE] SQL: {RoleVacuityGuardSql}");
        output.WriteLine($"[EVIDENCE] current_user = '{role}'  rolsuper OR rolbypassrls = {superOrBypass} (REQUIRED False)");
        output.WriteLine($"[EVIDENCE] ssf.farm_memberships relrowsecurity={enabled} relforcerowsecurity={forced}");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // THE cross-farm claim, both directions.
    // ═════════════════════════════════════════════════════════════════════════

    /// <summary>
    /// Direction 1 — a legitimate grant on Farm A, then the SAME person checked
    /// on Farm B. The person, the capability and the code are identical; only
    /// the farm differs.
    /// </summary>
    [Fact]
    public async Task A_grant_on_Farm_A_leaves_the_same_person_denied_on_Farm_B()
    {
        await AssertAppRoleIsNotVacuousAsync();

        // Before: denied on both.
        (await IsAllowedAsync(FarmA, WorkerBoth)).Should().BeFalse();
        (await IsAllowedAsync(FarmB, WorkerBoth)).Should().BeFalse();

        var granted = await SetPermissionAsync(FarmA, OwnerA, WorkerBoth, allowed: true);
        granted.IsSuccess.Should().BeTrue("the owner of Farm A granting on Farm A is the happy path");
        granted.Value!.CanManageLabourRecords.Should().BeTrue();
        granted.Value!.Source.Should().Be("ExplicitGrant");

        // After: allowed on A, still denied on B.
        (await IsAllowedAsync(FarmA, WorkerBoth)).Should().BeTrue();
        (await IsAllowedAsync(FarmB, WorkerBoth)).Should().BeFalse(
            "the capability is keyed on (farm, user) — never on the user alone. A capability keyed on "
            + "the person would silently follow them onto every farm they belong to");

        // And the rows say the same thing, read below the application entirely.
        var (rowA, rowB) = await ReadGrantRowsAsync();
        rowA.Should().BeTrue();
        rowB.Should().BeFalse();

        output.WriteLine("[EVIDENCE] === direction 1: grant on A, check on B ===");
        output.WriteLine($"[EVIDENCE] gate under Farm A scope = True   gate under Farm B scope = False");
        output.WriteLine($"[EVIDENCE] ssf.farm_memberships.can_manage_labour_records: FarmA={rowA} FarmB={rowB}");
    }

    /// <summary>
    /// Direction 2 — the one a single-sided check misses. The caller genuinely
    /// IS a PrimaryOwner, of the OTHER farm, and the target genuinely IS a
    /// member of the farm named in the command. Everything is legitimate except
    /// the pairing.
    /// </summary>
    [Fact]
    public async Task An_owner_of_Farm_B_cannot_grant_on_Farm_A_and_writes_nothing()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var attempt = await SetPermissionAsync(FarmA, OwnerB, WorkerBoth, allowed: true);

        attempt.IsFailure.Should().BeTrue();
        attempt.Error.Code.Should().Be("ShramSafal.Forbidden");
        attempt.Error.Code.Should().NotContain("NotFound",
            "a distinct NotFound would turn this endpoint into an oracle for which people belong to "
            + "which farm");

        var (rowA, rowB) = await ReadGrantRowsAsync();
        rowA.Should().BeFalse("the refused grant must leave Farm A's row exactly as it was");
        rowB.Should().BeFalse();

        // And the mirror image: Farm A's owner cannot reach into Farm B either.
        var mirror = await SetPermissionAsync(FarmB, OwnerA, WorkerBoth, allowed: true);
        mirror.IsFailure.Should().BeTrue();
        mirror.Error.Code.Should().Be("ShramSafal.Forbidden");

        var (afterA, afterB) = await ReadGrantRowsAsync();
        afterA.Should().BeFalse();
        afterB.Should().BeFalse();

        output.WriteLine("[EVIDENCE] === direction 2: foreign owner, both ways ===");
        output.WriteLine($"[EVIDENCE] OwnerB -> Farm A : {attempt.Error.Code}");
        output.WriteLine($"[EVIDENCE] OwnerA -> Farm B : {mirror.Error.Code}");
        output.WriteLine($"[EVIDENCE] rows after both attempts: FarmA={afterA} FarmB={afterB} (expect False/False)");
    }

    /// <summary>
    /// The POLICY half, below the handler entirely: raw SQL as
    /// <c>agrisync_app</c>. A future caller that reaches the table without going
    /// through <see cref="SetLabourPermissionHandler"/> must still be unable to
    /// flip another farm's flag. The control at the end is what proves the
    /// rejection was the farm scope and not, say, a typo'd predicate.
    /// </summary>
    [Fact]
    public async Task A_raw_write_scoped_to_Farm_A_cannot_flip_Farm_Bs_capability()
    {
        await AssertAppRoleIsNotVacuousAsync();

        const string sql = """
            UPDATE ssf.farm_memberships
            SET can_manage_labour_records = TRUE
            WHERE farm_id = @farm AND user_id = @user
            """;

        var forged = await ExecuteAsAppRoleAsync(FarmA, OwnerA, sql, ("farm", FarmB), ("user", WorkerBoth));
        forged.Error.Should().BeNull("RLS hides the row rather than raising — the tell is the row count");
        forged.Affected.Should().Be(0,
            "the tenant policy's USING clause makes Farm B's membership invisible under Farm A's GUC, so "
            + "the UPDATE matches nothing. Zero rows, not an error — which is exactly why a handler that "
            + "trusted 'no exception' would report success on a write that never happened");

        var (_, rowB) = await ReadGrantRowsAsync();
        rowB.Should().BeFalse();

        // ── The control: the IDENTICAL statement, scoped to the right farm. ──
        var honest = await ExecuteAsAppRoleAsync(FarmB, OwnerB, sql, ("farm", FarmB), ("user", WorkerBoth));
        honest.Error.Should().BeNull();
        honest.Affected.Should().Be(1,
            "the control proves the earlier zero was the farm scope and not a broken predicate");

        output.WriteLine("[EVIDENCE] === policy half: raw UPDATE as agrisync_app ===");
        output.WriteLine($"[EVIDENCE] Farm A scope -> Farm B row : affected={forged.Affected} (expect 0)");
        output.WriteLine($"[EVIDENCE] Farm B scope -> Farm B row : affected={honest.Affected} (expect 1)");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Lifecycle + the two rules about who may grant, against real Postgres.
    // ═════════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task Denied_then_granted_then_allowed_then_revoked_then_denied_against_real_rows()
    {
        await AssertAppRoleIsNotVacuousAsync();

        (await IsAllowedAsync(FarmA, WorkerBoth)).Should().BeFalse();

        (await SetPermissionAsync(FarmA, OwnerA, WorkerBoth, true)).IsSuccess.Should().BeTrue();
        (await IsAllowedAsync(FarmA, WorkerBoth)).Should().BeTrue(
            "the grant must be readable by a DIFFERENT request — this is the claim a no-tracking "
            + "repository read would have silently broken, answering 200 while writing nothing");

        (await SetPermissionAsync(FarmA, OwnerA, WorkerBoth, false)).IsSuccess.Should().BeTrue();
        (await IsAllowedAsync(FarmA, WorkerBoth)).Should().BeFalse();

        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();
        var auditActions = await ReadAuditActionsAsync(read);
        auditActions.Should().Equal(["LabourManagementGranted", "LabourManagementRevoked"],
            "history explains who was trusted and when — and records exactly the two real changes");

        output.WriteLine("[EVIDENCE] === lifecycle against real rows ===");
        output.WriteLine($"[EVIDENCE] audit actions = [{string.Join(", ", auditActions)}]");
    }

    [Fact]
    public async Task Nobody_grants_themselves_and_a_Mukadam_cannot_pass_the_capability_on()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var mukadam = Guid.Parse("c9d55555-5555-5555-5555-555555555555");
        await using (var seed = new NpgsqlConnection(_superuserConn))
        {
            await seed.OpenAsync();
            await SeedMembershipAsync(seed, FarmA, mukadam, AccountA, "Mukadam");
        }

        var self = await SetPermissionAsync(FarmA, OwnerA, OwnerA, true);
        self.IsFailure.Should().BeTrue("nobody grants themselves");
        self.Error.Code.Should().Be("ShramSafal.Forbidden");

        var spread = await SetPermissionAsync(FarmA, mukadam, WorkerBoth, true);
        spread.IsFailure.Should().BeTrue(
            "granting is owner-tier only, whatever capability the caller holds — O-4: 'the owner "
            + "decides who is trusted'");
        spread.Error.Code.Should().Be("ShramSafal.Forbidden");

        var (rowA, _) = await ReadGrantRowsAsync();
        rowA.Should().BeFalse("neither refused request wrote anything");

        // 2026-09-02 (D5): the P5 refusal now protects owner-tier ONLY. A
        // Mukadam toggle is a real decision. Re-stating OFF on an already-OFF
        // row converges idempotently and writes no history.
        var mukadamOff = await SetPermissionAsync(FarmA, OwnerA, mukadam, false);
        mukadamOff.IsSuccess.Should().BeTrue();
        (await IsAllowedAsync(FarmA, mukadam)).Should().BeFalse(
            "an ungranted Mukadam is denied — existing Mukadams start OFF, no backfill (founder ruling)");

        output.WriteLine("[EVIDENCE] === who may grant ===");
        output.WriteLine($"[EVIDENCE] self-grant            : {self.Error.Code}");
        output.WriteLine($"[EVIDENCE] mukadam grants another: {spread.Error.Code}");
        output.WriteLine($"[EVIDENCE] mukadam OFF re-stated : success={mukadamOff.IsSuccess} (D5 — the switch is real, and it converges)");
    }

    [Fact]
    public async Task The_roster_read_is_owner_only_and_never_leaks_the_other_farms_members()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var asOwner = await GetPermissionsAsync(FarmA, OwnerA);
        asOwner.IsSuccess.Should().BeTrue();
        asOwner.Value!.Select(r => r.UserId).Should().BeEquivalentTo([OwnerA, WorkerBoth],
            "Farm A's roster is Farm A's members — WorkerBoth appears once, as Farm A's member");

        var asWorker = await GetPermissionsAsync(FarmA, WorkerBoth);
        asWorker.IsFailure.Should().BeTrue("who else may rewrite labour is access-control information");
        asWorker.Error.Code.Should().Be("ShramSafal.Forbidden");

        output.WriteLine("[EVIDENCE] === roster read ===");
        output.WriteLine($"[EVIDENCE] owner sees   : [{string.Join(", ", asOwner.Value!.Select(r => r.Role))}]");
        output.WriteLine($"[EVIDENCE] worker gets  : {asWorker.Error.Code}");
    }

    /// <summary>
    /// Task 2.5 — the edited-in-place CreateTable actually lands the three
    /// hours columns with the declared types. information_schema, superuser
    /// read: a data check, not an RLS proof.
    /// </summary>
    [Fact]
    public async Task The_attendance_hours_columns_exist_with_the_declared_types()
    {
        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();
        await using var cmd = read.CreateCommand();
        cmd.CommandText = """
            SELECT column_name, data_type,
                   COALESCE(numeric_precision::text, ''), COALESCE(numeric_scale::text, ''),
                   is_nullable
            FROM information_schema.columns
            WHERE table_schema = 'ssf' AND table_name = 'attendance_marks'
              AND column_name IN ('hours_worked', 'extra_hours', 'hours_basis')
            ORDER BY column_name
            """;
        var rows = new List<string>();
        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            rows.Add(string.Join("|", Enumerable.Range(0, 5).Select(reader.GetString)));
        }

        rows.Should().Equal(
            "extra_hours|numeric|4|1|YES",
            "hours_basis|integer|32|0|NO",
            "hours_worked|numeric|4|1|YES");
    }

    /// <summary>
    /// FOUNDER RULING (master review 2026-09-02, D5): existing Mukadams start
    /// OFF, NO backfill — the one-token delete IS the whole migration
    /// behaviour. Both halves pinned: the pre-existing row is untouched (read
    /// below the app), and the gate reads that untouched row as OFF.
    /// </summary>
    [Fact]
    public async Task An_existing_Mukadam_row_is_untouched_and_reads_as_OFF_no_backfill()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var mukadam = Guid.Parse("c9d66666-6666-6666-6666-666666666666");
        await using (var seed = new NpgsqlConnection(_superuserConn))
        {
            await seed.OpenAsync();
            await SeedMembershipAsync(seed, FarmA, mukadam, AccountA, "Mukadam");
        }

        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();
        var stored = Convert.ToBoolean(await ScalarAsync(read,
            "SELECT can_manage_labour_records FROM ssf.farm_memberships WHERE farm_id = @f AND user_id = @u",
            ("f", FarmA), ("u", mukadam)));
        stored.Should().BeFalse(
            "no backfill exists, by founder ruling — the row keeps its NOT NULL DEFAULT false");

        (await IsAllowedAsync(FarmA, mukadam)).Should().BeFalse(
            "the untouched row now MEANS off: an existing Mukadam starts OFF on deploy day");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Harness
    // ═════════════════════════════════════════════════════════════════════════

    private async Task<(string Role, bool SuperOrBypass)> ReadAppRolePostureAsync()
    {
        await using var appCheck = new NpgsqlConnection(_appConn);
        await appCheck.OpenAsync();
        var role = Convert.ToString(await ScalarAsync(appCheck, "SELECT current_user")) ?? string.Empty;
        var superOrBypass = Convert.ToBoolean(await ScalarAsync(appCheck, RoleVacuityGuardSql));
        return (role, superOrBypass);
    }

    private async Task AssertAppRoleIsNotVacuousAsync(bool quiet = false)
    {
        var (role, superOrBypass) = await ReadAppRolePostureAsync();
        superOrBypass.Should().BeFalse(
            "doctrine E3 — a proof executed as a superuser or any BYPASSRLS role proves nothing; "
            + $"current_user='{role}'");
        if (!quiet)
        {
            output.WriteLine(
                $"[EVIDENCE] role guard: current_user='{role}' rolsuper OR rolbypassrls={superOrBypass} (required False)");
        }
    }

    /// <summary>
    /// Mirrors production exactly: admin-elevate so
    /// <c>TenantConnectionInterceptor</c> no-ops (no per-command SET LOCAL
    /// prepend, hence no EF write-rows-affected desync), then set the GUCs
    /// inside the ambient transaction the middleware would have opened.
    /// <c>farmScopeId</c> is the farm the REQUEST established, which is not
    /// necessarily the farm the targeted row belongs to — that mismatch is the
    /// attack.
    /// </summary>
    private async Task<T> RunUnderScopeAsync<T>(
        Guid farmScopeId, Guid callerUserId, Func<IServiceProvider, Task<T>> body)
    {
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        var ctx = sp.GetRequiredService<ShramSafalDbContext>();
        var tenant = sp.GetRequiredService<TenantContext>();

        tenant.ElevateToAdminCrossTenant();

        await using var tx = await ctx.Database.BeginTransactionAsync();
        await ctx.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('agrisync.user_id', {callerUserId.ToString()}, true)");
        await ctx.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('agrisync.farm_id', {farmScopeId.ToString()}, true)");

        var result = await body(sp);

        // The middleware commits whenever the pipeline returns without throwing
        // — INCLUDING on a Forbidden, which is a result and not an exception.
        // Committing here too is what makes the "wrote nothing" assertions
        // meaningful rather than an artefact of a rollback.
        await tx.CommitAsync();
        return result;
    }

    private Task<Result<LabourPermissionDto>> SetPermissionAsync(
        Guid farmId, Guid caller, Guid target, bool allowed)
        => RunUnderScopeAsync(farmId, caller, sp => new SetLabourPermissionHandler(
                sp.GetRequiredService<IShramSafalRepository>(),
                sp.GetRequiredService<IClock>())
            .HandleAsync(new SetLabourPermissionCommand(
                new FarmId(farmId), new UserId(target), allowed, new UserId(caller),
                "test", "device-test", "sha256:test")));

    private Task<Result<IReadOnlyList<LabourPermissionDto>>> GetPermissionsAsync(Guid farmId, Guid caller)
        => RunUnderScopeAsync(farmId, caller, sp =>
            new GetLabourPermissionsHandler(sp.GetRequiredService<IShramSafalRepository>())
                .HandleAsync(new GetLabourPermissionsQuery(new FarmId(farmId), new UserId(caller))));

    private Task<bool> IsAllowedAsync(Guid farmId, Guid userId)
        => RunUnderScopeAsync(farmId, userId, sp => LabourManagementGate.IsAllowedAsync(
            sp.GetRequiredService<IShramSafalRepository>(), farmId, userId));

    /// <summary>Read below the application entirely, as the superuser — a data read, not a proof.</summary>
    private async Task<(bool FarmA, bool FarmB)> ReadGrantRowsAsync()
    {
        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();
        var a = Convert.ToBoolean(await ScalarAsync(read,
            "SELECT can_manage_labour_records FROM ssf.farm_memberships WHERE farm_id = @f AND user_id = @u",
            ("f", FarmA), ("u", WorkerBoth)));
        var b = Convert.ToBoolean(await ScalarAsync(read,
            "SELECT can_manage_labour_records FROM ssf.farm_memberships WHERE farm_id = @f AND user_id = @u",
            ("f", FarmB), ("u", WorkerBoth)));
        return (a, b);
    }

    private static async Task<List<string>> ReadAuditActionsAsync(NpgsqlConnection db)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            SELECT action FROM ssf.audit_events
            WHERE entity_type = 'FarmMembership' AND action LIKE 'LabourManagement%'
            ORDER BY occurred_at_utc, action DESC
            """;
        var actions = new List<string>();
        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            actions.Add(reader.GetString(0));
        }

        return actions;
    }

    private sealed record AppRoleWrite(PostgresException? Error, int Affected);

    private async Task<AppRoleWrite> ExecuteAsAppRoleAsync(
        Guid farmScopeId, Guid callerUserId, string sql, params (string Name, object Value)[] args)
    {
        await using var db = new NpgsqlConnection(_appConn);
        await db.OpenAsync();
        await using var tx = await db.BeginTransactionAsync();
        await SetGucAsync(db, "agrisync.user_id", callerUserId);
        await SetGucAsync(db, "agrisync.farm_id", farmScopeId);

        try
        {
            await using var cmd = db.CreateCommand();
            cmd.CommandText = sql;
            foreach (var (name, value) in args)
            {
                cmd.Parameters.AddWithValue(name, value);
            }

            var affected = await cmd.ExecuteNonQueryAsync();
            await tx.CommitAsync();
            return new AppRoleWrite(null, affected);
        }
        catch (PostgresException ex)
        {
            await tx.RollbackAsync();
            return new AppRoleWrite(ex, 0);
        }
    }

    private static async Task SetGucAsync(NpgsqlConnection db, string key, Guid value)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT set_config(@k, @v, true)";
        cmd.Parameters.AddWithValue("k", key);
        cmd.Parameters.AddWithValue("v", value.ToString());
        await cmd.ExecuteNonQueryAsync();
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
}
