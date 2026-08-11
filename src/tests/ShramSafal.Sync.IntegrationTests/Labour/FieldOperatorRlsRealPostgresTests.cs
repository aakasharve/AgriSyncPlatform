// spec: 2026-07-13-labour-attendance-approval-design
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
using ShramSafal.Application.UseCases.Labour.AttachFieldOperator;
using ShramSafal.Application.UseCases.Labour.GetFieldOperators;
using ShramSafal.Application.UseCases.Labour.RenameFieldOperator;
using ShramSafal.Infrastructure;
using ShramSafal.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Labour;

/// <summary>
/// Labour V1 <b>Task 14</b> (spec 2026-07-13-labour-attendance-approval-design)
/// — <b>adversarial verification as <c>agrisync_app</c></b>. This is a security
/// proof, not a feature test.
///
/// <para><b>Doctrine E3 — the assertion that makes or voids this whole class.</b>
/// <i>An RLS proof executed as a superuser or any <c>BYPASSRLS</c> role proves
/// nothing.</i> Every [Fact] here opens with
/// <see cref="AssertAppRoleIsNotVacuousAsync"/>, which runs
/// <c>SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user</c>
/// on the SAME connection string the code under test uses, and requires
/// <c>false</c>. <see cref="InitializeAsync"/> runs it too, so the suite cannot
/// even reach a [Fact] with a bypassing role. Without that guard every
/// assertion below would pass vacuously and SILENTLY — which is strictly worse
/// than having no suite at all, because it manufactures false confidence.
/// (Two suites in this repo look like RLS proofs and are not —
/// <c>ErasureWorkerWorkerNameScrubRealPostgresTests</c> and
/// <c>LabourMoneyInvariantsRealPostgresTests</c> both wire the SUPERUSER
/// connection. Neither is a precedent for this file.)</para>
///
/// <para><b>Why the attacks hit the HANDLER, not the HTTP route.</b> A reviewer
/// caught that <see cref="AttachFieldOperatorHandler"/> and
/// <see cref="RenameFieldOperatorHandler"/> were, until very recently, not
/// self-sufficient: they checked that the referenced rows matched
/// <c>command.FarmId</c> but never that the CALLER was entitled to that farm.
/// The gap was invisible over HTTP because <c>ICallerFarmTenantScope</c>
/// happened to cover it. Attacking through the endpoint would therefore have
/// proven the endpoint and not the handler. So every cross-farm [Fact] below
/// invokes the handler directly, and — just as important — first PROVES the
/// attacked rows are genuinely LOADABLE under the attacker's scope (see the
/// <c>Probe*</c> helpers). A test that passes because the row was invisible has
/// proven nothing about authorisation.</para>
///
/// <para><b>Why loadability is the honest starting position.</b>
/// <c>p_user_select_labour_assignments</c> / <c>p_user_select_field_operators</c>
/// are PERMISSIVE policies, and Postgres OR-s permissive policies — never
/// AND-s them. A multi-farm login therefore genuinely CAN read another farm's
/// row while scoped to this farm. And Postgres FK checks bypass RLS entirely,
/// so a satisfied foreign key proves the referenced row EXISTS, never that the
/// caller may touch it. Those two facts are why the handler's own
/// <c>FarmId</c> assertions are the real defence, and why this suite attacks
/// them from both directions.</para>
///
/// <para><b>Native :5433, fail-loud (2026-07-19 CI-truthfulness contract).</b>
/// Tagged <c>[Trait("Category","RequiresPostgres")]</c> — without that trait
/// the suite would silently not run and this task would report a false pass.
/// If native Postgres is unreachable,
/// <see cref="RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync"/>
/// THROWS out of <see cref="InitializeAsync"/>: the [Fact]s report FAILED,
/// never a silent skip. Each fact creates its OWN scratch database
/// (<c>ssf_fo_rls_{Guid:N}</c>), applies the full
/// <see cref="IntegrationMigrationChain"/>, and drops it on dispose. It never
/// touches <c>agrisync_dev</c> / <c>agrisync_dev_v2</c>, and — doctrine E5 —
/// the lifecycle facts delete only SCRATCH farms they created themselves;
/// no real farm is ever deleted to prove a foreign key.</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class FieldOperatorRlsRealPostgresTests(Xunit.Abstractions.ITestOutputHelper output)
    : IAsyncLifetime
{
    /// <summary>
    /// Doctrine E3, verbatim. Must evaluate to <c>false</c> on the connection
    /// the code under test uses, or this entire class is void.
    /// </summary>
    private const string RoleVacuityGuardSql =
        "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user";

    private const string AppRoleUser = TestRoleCredentials.AppRoleUser;
    private static string AppRolePassword => TestRoleCredentials.AppRolePassword;

    // ── Farm A — the farm the attacker establishes as request scope. ──────────
    private static readonly Guid FarmA = Guid.Parse("f0a11111-1111-1111-1111-111111111111");
    private static readonly Guid FarmAAccount = Guid.Parse("f0a22222-2222-2222-2222-222222222222");
    private static readonly Guid OwnerAUserId = Guid.Parse("f0a33333-3333-3333-3333-333333333333");
    private static readonly Guid PlotA = Guid.Parse("f0a55555-5555-5555-5555-555555555555");
    private static readonly Guid CycleA = Guid.Parse("f0a66666-6666-6666-6666-666666666666");

    /// <summary>
    /// A Mukadam who is an ACTIVE member of BOTH farms. That is deliberate and
    /// load-bearing: it is what makes Farm B's rows genuinely readable through
    /// the permissive, OR-ed user-select policies while the request is scoped
    /// to Farm A. Attacking with a single-farm login would prove only that RLS
    /// hides invisible rows, which is not the claim under test.
    /// </summary>
    private static readonly Guid MukadamUserId = Guid.Parse("f0a44444-4444-4444-4444-444444444444");

    // ── Farm B — the victim farm. ────────────────────────────────────────────
    private static readonly Guid FarmB = Guid.Parse("f0b11111-1111-1111-1111-111111111111");
    private static readonly Guid FarmBAccount = Guid.Parse("f0b22222-2222-2222-2222-222222222222");
    private static readonly Guid OwnerBUserId = Guid.Parse("f0b33333-3333-3333-3333-333333333333");
    private static readonly Guid PlotB = Guid.Parse("f0b55555-5555-5555-5555-555555555555");
    private static readonly Guid CycleB = Guid.Parse("f0b66666-6666-6666-6666-666666666666");

    private static readonly DateOnly WorkDate = new(2026, 8, 11);

    private string _adminConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private string _superuserConn = string.Empty;
    private string _appConn = string.Empty;
    private ServiceProvider? _rootProvider;

    // ─────────────────────────────────────────────────────────────────────────
    // Harness — scratch DB creation / app-role connection / teardown, copied
    // wholesale from LedgerDerivationSupersessionRealPostgresTests (A12).
    // ─────────────────────────────────────────────────────────────────────────

    public async Task InitializeAsync()
    {
        _adminConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();

        _scratchDbName = $"ssf_fo_rls_{Guid.NewGuid():N}";
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

        // Hand-rolling MigrateAsync here fails with 42P01 relation
        // "analytics.events" does not exist — the interleaved chain is required.
        await IntegrationMigrationChain.ApplyAsync(_superuserConn);

        // Doctrine E3 at the earliest possible moment: if the app connection
        // turns out to be a superuser / BYPASSRLS role, fail during setup
        // rather than let eleven facts pass vacuously.
        await AssertAppRoleIsNotVacuousAsync(quiet: true);

        // Parents are planted as the SUPERUSER on purpose — the plant must
        // never depend on the code under test, and superuser bypasses RLS so
        // the seed cannot itself be a proof.
        await using (var raw = new NpgsqlConnection(_superuserConn))
        {
            await raw.OpenAsync();

            await SeedFarmAsync(raw, FarmA, OwnerAUserId, FarmAAccount, "Task 14 Farm A");
            await SeedPlotAsync(raw, PlotA, FarmA, "Plot A");
            await SeedCropCycleAsync(raw, CycleA, FarmA, PlotA);
            await SeedMembershipAsync(raw, FarmA, OwnerAUserId, FarmAAccount, "PrimaryOwner");
            await SeedMembershipAsync(raw, FarmA, MukadamUserId, FarmAAccount, "Mukadam");

            await SeedFarmAsync(raw, FarmB, OwnerBUserId, FarmBAccount, "Task 14 Farm B");
            await SeedPlotAsync(raw, PlotB, FarmB, "Plot B");
            await SeedCropCycleAsync(raw, CycleB, FarmB, PlotB);
            await SeedMembershipAsync(raw, FarmB, OwnerBUserId, FarmBAccount, "PrimaryOwner");
            await SeedMembershipAsync(raw, FarmB, MukadamUserId, FarmBAccount, "Mukadam");
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
    // 14.1 — THE VACUITY GUARD. Everything else in this file is conditional on
    //        this being false.
    // ═════════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task The_app_role_is_neither_superuser_nor_bypassrls_so_this_suite_is_not_vacuous()
    {
        var (role, superOrBypass) = await ReadAppRolePostureAsync();

        superOrBypass.Should().BeFalse(
            "doctrine E3 — an RLS proof executed as a superuser or any BYPASSRLS role proves "
            + "NOTHING. If this is true, every other assertion in this class passes vacuously "
            + "and silently, and the suite is worse than useless because it manufactures false "
            + "confidence.");
        role.Should().Be(AppRoleUser,
            "the connection under test must be the application role the API actually runs as");

        // The FORCE-RLS catalog state is the other half of the same claim: a
        // non-superuser is only genuinely constrained if the tables FORCE RLS
        // (plain ENABLE exempts the table OWNER, and migrations run as owner).
        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();
        var (opsEnabled, opsForced) = await ReadRlsFlagsAsync(read, "ssf.field_operators");
        var (rowsEnabled, rowsForced) = await ReadRlsFlagsAsync(read, "ssf.field_operator_work_rows");

        output.WriteLine("[EVIDENCE] === 14.1 vacuity guard (doctrine E3) ===");
        output.WriteLine($"[EVIDENCE] SQL: {RoleVacuityGuardSql}");
        output.WriteLine($"[EVIDENCE] current_user                    = '{role}'");
        output.WriteLine($"[EVIDENCE] rolsuper OR rolbypassrls        = {superOrBypass} (REQUIRED: False)");
        output.WriteLine($"[EVIDENCE] ssf.field_operators             enabled={opsEnabled} forced={opsForced}");
        output.WriteLine($"[EVIDENCE] ssf.field_operator_work_rows    enabled={rowsEnabled} forced={rowsForced}");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // 14.2 — CROSS-FARM, BOTH DIRECTIONS.
    // ═════════════════════════════════════════════════════════════════════════

    /// <summary>
    /// 14.2(a) — Farm A scope + Farm B <c>LabourAssignmentId</c>. Attacks the
    /// HANDLER directly (not HTTP), and first proves the Farm B assignment AND
    /// its parent daily log are genuinely loadable under Farm A scope, so the
    /// rejection can only come from the handler's own
    /// <c>dailyLog.FarmId != command.FarmId</c> assertion — never from a
    /// repository filter or an invisible row.
    /// </summary>
    [Fact]
    public async Task Attaching_to_another_farms_labour_assignment_is_Forbidden_and_writes_zero_rows()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var (_, assignmentA) = await PlantEngagementAsync(FarmA, PlotA, CycleA, workerCount: 8);
        var (dailyLogB, assignmentB) = await PlantEngagementAsync(FarmB, PlotB, CycleB, workerCount: 8);
        var operatorA = await PlantFieldOperatorAsync(FarmA, "गणेश");

        // ── The row must be LOADABLE, or the test proves nothing. ─────────────
        var loadedAssignment = await ProbeLabourAssignmentAsync(FarmA, MukadamUserId, assignmentB);
        var loadedLog = await ProbeDailyLogAsync(FarmA, MukadamUserId, dailyLogB);
        loadedAssignment.Should().NotBeNull(
            "p_user_select_labour_assignments is PERMISSIVE and OR-ed with the tenant policy, so a "
            + "multi-farm login genuinely CAN read Farm B's engagement while scoped to Farm A — that "
            + "readability is the precondition that makes this an authorisation test rather than a "
            + "visibility test");
        loadedLog.Should().NotBeNull("same reasoning for p_user_select_daily_logs");
        loadedLog!.FarmId.Value.Should().Be(FarmB, "the loaded parent really does belong to the victim farm");

        var result = await AttachAsync(FarmA, MukadamUserId, new AttachFieldOperatorCommand(
            new FarmId(FarmA), operatorA, assignmentB, new UserId(MukadamUserId)));

        result.IsFailure.Should().BeTrue("a Farm A scope may not attach onto Farm B's engagement");
        result.Error.Code.Should().Be("ShramSafal.Forbidden");
        result.Error.Code.Should().NotContain("NotFound",
            "a distinct NotFound would let a forged id from another farm probe existence");

        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();
        var everything = await ScalarLongAsync(read, "SELECT COUNT(*) FROM ssf.field_operator_work_rows");
        everything.Should().Be(0,
            "ZERO rows — not 'zero rows on Farm A'. The rejected attach must leave the whole table "
            + "empty, and the ambient transaction COMMITS on a Forbidden (it is not an exception), so "
            + "this is a property of the handler validating before it stages anything");
        _ = assignmentA;

        output.WriteLine("[EVIDENCE] === 14.2(a) Farm A scope + Farm B LabourAssignmentId ===");
        output.WriteLine($"[EVIDENCE] Farm B assignment loadable under Farm A scope = {loadedAssignment is not null} (expect True)");
        output.WriteLine($"[EVIDENCE] Farm B daily_log loadable under Farm A scope  = {loadedLog is not null} (expect True)");
        output.WriteLine($"[EVIDENCE] handler result error                          = {result.Error.Code}");
        output.WriteLine($"[EVIDENCE] ssf.field_operator_work_rows total rows        = {everything} (expect 0)");
    }

    /// <summary>
    /// 14.2(b) — the OTHER direction, and the one a single-sided check would
    /// miss entirely: Farm A scope + Farm A assignment + Farm B
    /// <c>FieldOperatorId</c>. Everything about this call is legitimate except
    /// the operator's home farm.
    /// </summary>
    [Fact]
    public async Task Attaching_another_farms_field_operator_is_Forbidden_and_writes_zero_rows()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var (_, assignmentA) = await PlantEngagementAsync(FarmA, PlotA, CycleA, workerCount: 8);
        var operatorB = await PlantFieldOperatorAsync(FarmB, "बाळू");

        var loadedOperator = await ProbeFieldOperatorAsync(FarmA, MukadamUserId, operatorB);
        loadedOperator.Should().NotBeNull(
            "p_user_select_field_operators is PERMISSIVE and OR-ed with the tenant policy, so Farm B's "
            + "operator IS readable under Farm A scope for this multi-farm login — the handler's "
            + "OriginatingFarmId assertion is therefore the only thing standing between the attacker "
            + "and the write");
        loadedOperator!.OriginatingFarmId.Value.Should().Be(FarmB);

        var result = await AttachAsync(FarmA, MukadamUserId, new AttachFieldOperatorCommand(
            new FarmId(FarmA), operatorB, assignmentA, new UserId(MukadamUserId)));

        result.IsFailure.Should().BeTrue(
            "the assignment is legitimately Farm A's and the caller is legitimately on Farm A — only "
            + "the operator's originating farm is wrong, and that alone must reject the write");
        result.Error.Code.Should().Be("ShramSafal.Forbidden");

        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();
        var everything = await ScalarLongAsync(read, "SELECT COUNT(*) FROM ssf.field_operator_work_rows");
        everything.Should().Be(0, "zero rows written anywhere");

        output.WriteLine("[EVIDENCE] === 14.2(b) Farm A scope + Farm A assignment + Farm B FieldOperatorId ===");
        output.WriteLine($"[EVIDENCE] Farm B operator loadable under Farm A scope = {loadedOperator is not null} (expect True)");
        output.WriteLine($"[EVIDENCE] handler result error                        = {result.Error.Code}");
        output.WriteLine($"[EVIDENCE] ssf.field_operator_work_rows total rows      = {everything} (expect 0)");
    }

    /// <summary>
    /// 14.2 — <b>Farm B sees none of Farm A's operators.</b> Attacks BELOW the
    /// handler, in raw SQL as <c>agrisync_app</c>, because the claim is about
    /// RLS itself. It also records the honest converse: for a MULTI-farm login
    /// the OR-ed permissive policy does NOT confine reads to the scoped farm —
    /// which is precisely why 14.2(a)/(b) must exist.
    /// </summary>
    [Fact]
    public async Task A_farm_B_only_login_sees_none_of_farm_A_field_operators()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var operatorA1 = await PlantFieldOperatorAsync(FarmA, "गणेश");
        var operatorA2 = await PlantFieldOperatorAsync(FarmA, "सखाराम");
        var operatorB1 = await PlantFieldOperatorAsync(FarmB, "बाळू");

        // OwnerB is a member of Farm B ONLY — neither branch of
        // p_user_select_field_operators can reach Farm A for this login.
        var visibleToFarmBOnlyLogin = await ScalarLongAsAppRoleAsync(FarmB, OwnerBUserId,
            "SELECT COUNT(*) FROM ssf.field_operators");
        var farmARowsVisible = await ScalarLongAsAppRoleAsync(FarmB, OwnerBUserId,
            "SELECT COUNT(*) FROM ssf.field_operators WHERE \"Id\" = @a1 OR \"Id\" = @a2",
            ("a1", operatorA1), ("a2", operatorA2));

        visibleToFarmBOnlyLogin.Should().Be(1, "only Farm B's own operator is visible");
        farmARowsVisible.Should().Be(0,
            "a Farm B login must not see a single Farm A field operator — names ARE the product, and "
            + "leaking them across farms leaks who works for whom");

        // The honest converse, recorded so nobody later 'simplifies' the
        // handler checks away believing RLS already confines a request.
        var visibleToMultiFarmLogin = await ScalarLongAsAppRoleAsync(FarmB, MukadamUserId,
            "SELECT COUNT(*) FROM ssf.field_operators");
        visibleToMultiFarmLogin.Should().Be(3,
            "PERMISSIVE policies are OR-ed, never AND-ed: a login that is a member of BOTH farms reads "
            + "BOTH farms' operators regardless of the agrisync.farm_id scope. RLS is a tenancy floor, "
            + "not a per-request authorisation ceiling — the handler is");

        // The application read PATH is nonetheless farm-confined.
        var roster = await GetFieldOperatorsAsync(FarmB, MukadamUserId);
        roster.IsSuccess.Should().BeTrue();
        roster.Value!.Select(o => o.Id).Should().BeEquivalentTo([operatorB1],
            "GetFieldOperatorsHandler filters on OriginatingFarmId, so the read path returns only the "
            + "scoped farm's roster even for the multi-farm login RLS would have let through");

        output.WriteLine("[EVIDENCE] === 14.2 cross-farm READ isolation ===");
        output.WriteLine($"[EVIDENCE] field_operators visible to Farm-B-only login   = {visibleToFarmBOnlyLogin} (expect 1)");
        output.WriteLine($"[EVIDENCE]   ... of which Farm A rows                     = {farmARowsVisible} (expect 0)");
        output.WriteLine($"[EVIDENCE] field_operators visible to MULTI-farm login    = {visibleToMultiFarmLogin} (expect 3 — OR-ed permissive policy)");
        output.WriteLine($"[EVIDENCE] GetFieldOperatorsHandler roster for Farm B     = [{string.Join(", ", roster.Value!.Select(o => o.DisplayName))}]");
    }

    /// <summary>
    /// 14.2 — <b>a write cannot manufacture a row carrying another farm's
    /// <c>farm_id</c>.</b> Raw SQL as <c>agrisync_app</c>, below the handler
    /// entirely: this is the WITH CHECK backstop, and it must hold even if a
    /// future caller reaches the table without going through
    /// <see cref="AttachFieldOperatorHandler"/> at all. The FKs are all
    /// SATISFIABLE on purpose — Postgres FK checks bypass RLS, so a passing FK
    /// proves existence and never authorisation; the rejection has to come
    /// from the policy.
    /// </summary>
    [Fact]
    public async Task A_write_cannot_manufacture_a_row_carrying_another_farms_farm_id()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var (_, assignmentB) = await PlantEngagementAsync(FarmB, PlotB, CycleB, workerCount: 8);
        var operatorB = await PlantFieldOperatorAsync(FarmB, "बाळू");

        // (i) A work row forged onto Farm B while scoped to Farm A.
        var forgedWorkRow = await ExecuteAsAppRoleAsync(FarmA, MukadamUserId, """
            INSERT INTO ssf.field_operator_work_rows
                ("Id", field_operator_id, labour_assignment_id, farm_id, work_date,
                 display_name_at_attach, recorded_by_user_id, created_at_utc)
            VALUES (@id, @opid, @laid, @fid, DATE '2026-08-11', 'forged', @uid, NOW());
            """,
            ("id", Guid.NewGuid()), ("opid", operatorB), ("laid", assignmentB),
            ("fid", FarmB), ("uid", MukadamUserId));

        forgedWorkRow.Error.Should().NotBeNull("the WITH CHECK must reject the forged farm_id");
        forgedWorkRow.Error!.SqlState.Should().Be("42501",
            "insufficient_privilege — 'new row violates row-level security policy'");

        // (ii) A field operator forged onto Farm B while scoped to Farm A.
        var forgedOperator = await ExecuteAsAppRoleAsync(FarmA, MukadamUserId, """
            INSERT INTO ssf.field_operators
                ("Id", display_name, display_name_normalized, full_name,
                 originating_farm_id, created_by_user_id, created_at_utc, is_active)
            VALUES (@id, 'forged', 'forged', NULL, @fid, @uid, NOW(), TRUE);
            """,
            ("id", Guid.NewGuid()), ("fid", FarmB), ("uid", MukadamUserId));

        forgedOperator.Error.Should().NotBeNull();
        forgedOperator.Error!.SqlState.Should().Be("42501");

        // (iii) The control: the SAME insert shape onto the SCOPED farm is
        //       accepted, so (i)/(ii) failed on the farm_id and nothing else.
        var honestOperatorId = Guid.NewGuid();
        var honest = await ExecuteAsAppRoleAsync(FarmA, MukadamUserId, """
            INSERT INTO ssf.field_operators
                ("Id", display_name, display_name_normalized, full_name,
                 originating_farm_id, created_by_user_id, created_at_utc, is_active)
            VALUES (@id, 'honest', 'honest', NULL, @fid, @uid, NOW(), TRUE);
            """,
            ("id", honestOperatorId), ("fid", FarmA), ("uid", MukadamUserId));

        honest.Error.Should().BeNull("the identical write onto the SCOPED farm must succeed");
        honest.Affected.Should().Be(1);

        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();
        var forgedRowsLanded = await ScalarLongAsync(read,
            "SELECT COUNT(*) FROM ssf.field_operator_work_rows");
        var forgedOperatorsLanded = await ScalarLongAsync(read,
            "SELECT COUNT(*) FROM ssf.field_operators WHERE display_name = 'forged'");
        forgedRowsLanded.Should().Be(0);
        forgedOperatorsLanded.Should().Be(0);

        output.WriteLine("[EVIDENCE] === 14.2 WITH CHECK forgery (raw SQL as agrisync_app) ===");
        output.WriteLine($"[EVIDENCE] forged work row  -> SQLSTATE {forgedWorkRow.Error!.SqlState} : {forgedWorkRow.Error!.MessageText}");
        output.WriteLine($"[EVIDENCE] forged operator  -> SQLSTATE {forgedOperator.Error!.SqlState} : {forgedOperator.Error!.MessageText}");
        output.WriteLine($"[EVIDENCE] control (scoped farm) rows affected = {honest.Affected} (expect 1)");
        output.WriteLine($"[EVIDENCE] forged rows that landed             = {forgedRowsLanded} / {forgedOperatorsLanded} (expect 0 / 0)");
    }

    /// <summary>
    /// 14.2 — <b><c>FORCE ROW LEVEL SECURITY</c> is in effect on both new
    /// tables.</b> A pure catalog assertion, so reading it as the superuser is
    /// legitimate (nothing here is an RLS ENFORCEMENT test). It matters because
    /// plain <c>ENABLE</c> exempts the table OWNER, and migrations run as the
    /// owner — without <c>FORCE</c> a future owner-connected path would silently
    /// bypass every policy above.
    /// </summary>
    [Fact]
    public async Task Force_row_level_security_is_in_effect_on_both_new_tables()
    {
        await AssertAppRoleIsNotVacuousAsync();

        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();

        var (opsEnabled, opsForced) = await ReadRlsFlagsAsync(read, "ssf.field_operators");
        var (rowsEnabled, rowsForced) = await ReadRlsFlagsAsync(read, "ssf.field_operator_work_rows");

        opsEnabled.Should().BeTrue("ssf.field_operators must have RLS ENABLED");
        opsForced.Should().BeTrue("ssf.field_operators must FORCE RLS — ENABLE alone exempts the owner");
        rowsEnabled.Should().BeTrue("ssf.field_operator_work_rows must have RLS ENABLED");
        rowsForced.Should().BeTrue("ssf.field_operator_work_rows must FORCE RLS");

        var operatorPolicies = await ReadPolicyNamesAsync(read, "field_operators");
        var workRowPolicies = await ReadPolicyNamesAsync(read, "field_operator_work_rows");
        operatorPolicies.Should().Contain("p_tenant_field_operators");
        operatorPolicies.Should().Contain("p_user_select_field_operators");
        workRowPolicies.Should().Contain("p_tenant_field_operator_work_rows");
        workRowPolicies.Should().Contain("p_user_select_field_operator_work_rows");

        output.WriteLine("[EVIDENCE] === 14.2 FORCE ROW LEVEL SECURITY ===");
        output.WriteLine($"[EVIDENCE] ssf.field_operators          relrowsecurity={opsEnabled} relforcerowsecurity={opsForced}");
        output.WriteLine($"[EVIDENCE]   policies: [{string.Join(", ", operatorPolicies)}]");
        output.WriteLine($"[EVIDENCE] ssf.field_operator_work_rows relrowsecurity={rowsEnabled} relforcerowsecurity={rowsForced}");
        output.WriteLine($"[EVIDENCE]   policies: [{string.Join(", ", workRowPolicies)}]");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // 14.3 — THE ATTRIBUTION-OVERLAY REGRESSION. The single most important test
    //        in this plan.
    // ═════════════════════════════════════════════════════════════════════════

    /// <summary>
    /// 14.3 (Constraint 3 / doctrine P7, founder Scenario 5) — a
    /// <c>LabourAssignment</c> reported as <c>WorkerCount = 8</c> with THREE
    /// people attributed still reports <b>8</b>. Naming people must never
    /// shrink the number: the farmer said eight were there, and being helpful
    /// enough to name three of them must not silently rewrite that to three.
    ///
    /// <para><b>Headcount ONLY.</b> This deliberately asserts nothing about
    /// ManDays / labour-hours (Constraint 4): V1 does not redefine that unit,
    /// so pinning a value here would freeze a number the plan has explicitly
    /// left open and would turn a later honest change into a false regression.
    /// </para>
    ///
    /// <para>Attacks the HANDLER (the attribution path proper) and then
    /// re-reads the engagement from the DATABASE — a reload, not an in-memory
    /// entity, because the claim is about what every future reader sees.</para>
    /// </summary>
    [Fact]
    public async Task Attributing_three_people_leaves_an_eight_worker_engagement_reporting_eight()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var (_, assignmentA) = await PlantEngagementAsync(FarmA, PlotA, CycleA, workerCount: 8);
        var balu = await PlantFieldOperatorAsync(FarmA, "बाळू");
        var ganesh = await PlantFieldOperatorAsync(FarmA, "गणेश");
        var sakharam = await PlantFieldOperatorAsync(FarmA, "सखाराम");

        foreach (var operatorId in new[] { balu, ganesh, sakharam })
        {
            var attach = await AttachAsync(FarmA, MukadamUserId, new AttachFieldOperatorCommand(
                new FarmId(FarmA), operatorId, assignmentA, new UserId(MukadamUserId)));
            attach.IsSuccess.Should().BeTrue("attributing a known person to this farm's engagement is allowed");
            attach.Value!.AlreadyAttached.Should().BeFalse();
        }

        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();

        var reloadedWorkerCount = Convert.ToInt32(await ScalarAsync(read,
            "SELECT worker_count FROM ssf.labour_assignments WHERE \"Id\" = @id", ("id", assignmentA)));
        var attributedRows = await ScalarLongAsync(read,
            "SELECT COUNT(*) FROM ssf.field_operator_work_rows WHERE labour_assignment_id = @id",
            ("id", assignmentA));

        reloadedWorkerCount.Should().Be(8,
            "THE headcount invariant (Constraint 3 / P7): attribution is an OVERLAY. Three named "
            + "people on an eight-worker engagement is still eight — the engagement stays the single "
            + "source of truth for quantity and is never derived from, reduced by, or reconciled "
            + "against the number of work rows pointing at it");
        attributedRows.Should().Be(3, "all three attributions landed — the overlay is real, not a no-op");

        // The same claim through the application read path, so a future
        // projection cannot quietly start deriving the count from work rows.
        var viaRepository = await ProbeLabourAssignmentAsync(FarmA, MukadamUserId, assignmentA);
        viaRepository.Should().NotBeNull();
        viaRepository!.WorkerCount.Should().Be(8, "the read path reports the farmer's number, not the roster size");

        output.WriteLine("[EVIDENCE] === 14.3 attribution overlay (Scenario 5, doctrine P7) ===");
        output.WriteLine($"[EVIDENCE] field_operator_work_rows attached      = {attributedRows} (expect 3)");
        output.WriteLine($"[EVIDENCE] labour_assignments.worker_count RELOAD = {reloadedWorkerCount} (expect 8, UNCHANGED)");
        output.WriteLine($"[EVIDENCE] repository read path WorkerCount       = {viaRepository!.WorkerCount} (expect 8)");
        output.WriteLine("[EVIDENCE] ManDays deliberately NOT asserted — Constraint 4: V1 does not redefine that unit.");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // 14.4 — LIFECYCLE (Scenario 12). SCRATCH farms only (doctrine E5).
    // ═════════════════════════════════════════════════════════════════════════

    /// <summary>
    /// 14.4 — deleting the originating farm FAILS while a Field Operator
    /// exists. The delete is attempted as <c>agrisync_app</c> with the farm's
    /// own GUC scope, so RLS cannot silently turn it into a 0-row no-op that
    /// would fake this proof; and the control at the end shows the SAME delete
    /// succeeds the moment the operator is gone, so the FK really is the only
    /// thing that blocked it.
    /// </summary>
    [Fact]
    public async Task Deleting_the_originating_farm_fails_while_a_field_operator_exists()
    {
        await AssertAppRoleIsNotVacuousAsync();

        // Doctrine E5: a farm created by THIS test, for THIS test.
        var scratchFarm = Guid.NewGuid();
        var scratchOwner = Guid.NewGuid();
        await using (var seed = new NpgsqlConnection(_superuserConn))
        {
            await seed.OpenAsync();
            await SeedFarmAsync(seed, scratchFarm, scratchOwner, Guid.NewGuid(), "Task 14 scratch farm");
        }

        var operatorId = await PlantFieldOperatorAsync(scratchFarm, "बाळू");

        var blocked = await ExecuteAsAppRoleAsync(scratchFarm, scratchOwner,
            "DELETE FROM ssf.farms WHERE \"Id\" = @id", ("id", scratchFarm));

        blocked.Error.Should().NotBeNull(
            "a farm carrying Field Operators must not be deletable — the work identities it "
            + "originated would vanish with it, and lifecycle must never silently erase them");
        blocked.Error!.SqlState.Should().Be("23503", "foreign_key_violation");
        blocked.Error!.ConstraintName.Should().Be("FK_field_operators_farms_originating_farm_id",
            "naming the constraint is what proves the FIELD OPERATOR blocked it, not some other child");

        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();
        var farmStillThere = await ScalarLongAsync(read,
            "SELECT COUNT(*) FROM ssf.farms WHERE \"Id\" = @id", ("id", scratchFarm));
        farmStillThere.Should().Be(1);

        // ── Control: remove the operator, and the identical delete succeeds. ──
        await using (var cleanup = new NpgsqlConnection(_superuserConn))
        {
            await cleanup.OpenAsync();
            await using var del = cleanup.CreateCommand();
            del.CommandText = "DELETE FROM ssf.field_operators WHERE \"Id\" = @id";
            del.Parameters.AddWithValue("id", operatorId);
            await del.ExecuteNonQueryAsync();
        }

        var allowed = await ExecuteAsAppRoleAsync(scratchFarm, scratchOwner,
            "DELETE FROM ssf.farms WHERE \"Id\" = @id", ("id", scratchFarm));
        allowed.Error.Should().BeNull();
        allowed.Affected.Should().Be(1,
            "the control proves the earlier failure was the FK and NOT an RLS-invisible row silently "
            + "affecting zero rows");

        output.WriteLine("[EVIDENCE] === 14.4 farm lifecycle (scratch farm only) ===");
        output.WriteLine($"[EVIDENCE] DELETE farm w/ operator -> SQLSTATE {blocked.Error!.SqlState} constraint={blocked.Error!.ConstraintName}");
        output.WriteLine($"[EVIDENCE] farm rows after blocked delete = {farmStillThere} (expect 1)");
        output.WriteLine($"[EVIDENCE] control DELETE after operator removed, rows affected = {allowed.Affected} (expect 1)");
    }

    /// <summary>
    /// 14.4 — deleting a <c>daily_log</c> FAILS while a work row references its
    /// assignment. <c>labour_assignments -&gt; daily_logs</c> is ON DELETE
    /// CASCADE, so the delete propagates to the engagement and is then stopped
    /// by <c>field_operator_work_rows</c>'s RESTRICT. That is the chain that
    /// makes recorded attribution un-erasable by a log deletion.
    /// </summary>
    [Fact]
    public async Task Deleting_a_daily_log_fails_while_a_work_row_references_its_assignment()
    {
        await AssertAppRoleIsNotVacuousAsync();

        // Doctrine E5 again: a whole scratch farm, plot, cycle, log and
        // engagement created by THIS test.
        var scratchFarm = Guid.NewGuid();
        var scratchOwner = Guid.NewGuid();
        var scratchPlot = Guid.NewGuid();
        var scratchCycle = Guid.NewGuid();
        await using (var seed = new NpgsqlConnection(_superuserConn))
        {
            await seed.OpenAsync();
            await SeedFarmAsync(seed, scratchFarm, scratchOwner, Guid.NewGuid(), "Task 14 scratch farm 2");
            await SeedPlotAsync(seed, scratchPlot, scratchFarm, "Scratch plot");
            await SeedCropCycleAsync(seed, scratchCycle, scratchFarm, scratchPlot);
            await SeedMembershipAsync(seed, scratchFarm, scratchOwner, Guid.NewGuid(), "PrimaryOwner");
        }

        var (scratchLog, scratchAssignment) =
            await PlantEngagementAsync(scratchFarm, scratchPlot, scratchCycle, workerCount: 8, ownerUserId: scratchOwner);
        var operatorId = await PlantFieldOperatorAsync(scratchFarm, "बाळू");

        var attach = await AttachAsync(scratchFarm, scratchOwner, new AttachFieldOperatorCommand(
            new FarmId(scratchFarm), operatorId, scratchAssignment, new UserId(scratchOwner)));
        attach.IsSuccess.Should().BeTrue("the farm's own owner attaching its own operator must succeed");

        var blocked = await ExecuteAsAppRoleAsync(scratchFarm, scratchOwner,
            "DELETE FROM ssf.daily_logs WHERE \"Id\" = @id", ("id", scratchLog));

        blocked.Error.Should().NotBeNull(
            "the log's CASCADE reaches the engagement, and the attribution row's RESTRICT stops it "
            + "there — deleting a log must never silently erase who was recorded as working it");
        blocked.Error!.SqlState.Should().Be("23503", "foreign_key_violation");
        blocked.Error!.ConstraintName.Should().StartWith("FK_field_operator_work_rows_labour_assignments",
            "naming the constraint proves the ATTRIBUTION row blocked the cascade");

        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();
        var logStillThere = await ScalarLongAsync(read,
            "SELECT COUNT(*) FROM ssf.daily_logs WHERE \"Id\" = @id", ("id", scratchLog));
        var assignmentStillThere = await ScalarLongAsync(read,
            "SELECT COUNT(*) FROM ssf.labour_assignments WHERE \"Id\" = @id", ("id", scratchAssignment));
        logStillThere.Should().Be(1);
        assignmentStillThere.Should().Be(1, "the cascade rolled back whole — no half-deleted engagement");

        // ── Control: drop the attribution row and the identical delete lands. ──
        await using (var cleanup = new NpgsqlConnection(_superuserConn))
        {
            await cleanup.OpenAsync();
            await using var del = cleanup.CreateCommand();
            del.CommandText = "DELETE FROM ssf.field_operator_work_rows WHERE labour_assignment_id = @id";
            del.Parameters.AddWithValue("id", scratchAssignment);
            await del.ExecuteNonQueryAsync();
        }

        var allowed = await ExecuteAsAppRoleAsync(scratchFarm, scratchOwner,
            "DELETE FROM ssf.daily_logs WHERE \"Id\" = @id", ("id", scratchLog));
        allowed.Error.Should().BeNull();
        allowed.Affected.Should().Be(1, "the control proves the FK was the blocker, not RLS invisibility");

        output.WriteLine("[EVIDENCE] === 14.4 daily_log lifecycle (scratch farm only) ===");
        output.WriteLine($"[EVIDENCE] DELETE log w/ work row -> SQLSTATE {blocked.Error!.SqlState} constraint={blocked.Error!.ConstraintName}");
        output.WriteLine($"[EVIDENCE] daily_log / labour_assignment survive = {logStillThere} / {assignmentStillThere} (expect 1 / 1)");
        output.WriteLine($"[EVIDENCE] control DELETE after work row removed, rows affected = {allowed.Affected} (expect 1)");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // 14.5 — RENAME HISTORY (Scenario 7).
    // ═════════════════════════════════════════════════════════════════════════

    /// <summary>
    /// 14.5 — <c>FieldOperator.Rename</c> changes <c>DisplayName</c>; the
    /// existing work row's <c>DisplayNameAtAttach</c> is UNCHANGED. Renaming a
    /// person must not rewrite history: a payout approved for "बाळू" must still
    /// read "बाळू" afterwards. Attacks both handlers directly.
    /// </summary>
    [Fact]
    public async Task Renaming_a_field_operator_never_rewrites_the_work_rows_name_snapshot()
    {
        await AssertAppRoleIsNotVacuousAsync();

        const string nameAtAttach = "बाळू";
        const string renamedTo = "बाळासाहेब";

        var (_, assignmentA) = await PlantEngagementAsync(FarmA, PlotA, CycleA, workerCount: 8);
        var operatorId = await PlantFieldOperatorAsync(FarmA, nameAtAttach);

        var attach = await AttachAsync(FarmA, MukadamUserId, new AttachFieldOperatorCommand(
            new FarmId(FarmA), operatorId, assignmentA, new UserId(MukadamUserId)));
        attach.IsSuccess.Should().BeTrue();

        var rename = await RenameAsync(FarmA, MukadamUserId, new RenameFieldOperatorCommand(
            new FarmId(FarmA), operatorId, renamedTo, new UserId(MukadamUserId)));
        rename.IsSuccess.Should().BeTrue("renaming this farm's own operator is allowed");
        rename.Value!.DisplayName.Should().Be(renamedTo);

        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();

        var liveName = (string)(await ScalarAsync(read,
            "SELECT display_name FROM ssf.field_operators WHERE \"Id\" = @id", ("id", operatorId)))!;
        var snapshot = (string)(await ScalarAsync(read,
            "SELECT display_name_at_attach FROM ssf.field_operator_work_rows WHERE field_operator_id = @id",
            ("id", operatorId)))!;

        liveName.Should().Be(renamedTo, "the person is called something new going forward");
        snapshot.Should().Be(nameAtAttach,
            "the work row snapshots the name AT ATTACH TIME and is never updated — renaming a person "
            + "must leave recorded history EXPLAINABLE, not rewrite it (Scenario 7)");

        output.WriteLine("[EVIDENCE] === 14.5 rename history (Scenario 7) ===");
        output.WriteLine($"[EVIDENCE] field_operators.display_name                        = '{liveName}' (expect '{renamedTo}')");
        output.WriteLine($"[EVIDENCE] field_operator_work_rows.display_name_at_attach      = '{snapshot}' (expect '{nameAtAttach}', UNCHANGED)");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // 14.6 — RETRY (Scenario 11).
    // ═════════════════════════════════════════════════════════════════════════

    /// <summary>
    /// 14.6 — the same attach executed twice yields ONE row and a SUCCESS
    /// result BOTH times. Attach is idempotent by intent (Task 11.5): a farmer
    /// on a bad connection tapping "attach" again must not be told they did
    /// something wrong, and must not end up with the same person recorded
    /// twice. Attacks the handler directly.
    /// </summary>
    [Fact]
    public async Task The_same_attach_executed_twice_yields_one_row_and_success_both_times()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var (_, assignmentA) = await PlantEngagementAsync(FarmA, PlotA, CycleA, workerCount: 8);
        var operatorId = await PlantFieldOperatorAsync(FarmA, "बाळू");

        AttachFieldOperatorCommand Build() => new(
            new FarmId(FarmA), operatorId, assignmentA, new UserId(MukadamUserId));

        var first = await AttachAsync(FarmA, MukadamUserId, Build());
        var retry = await AttachAsync(FarmA, MukadamUserId, Build());

        first.IsSuccess.Should().BeTrue();
        first.Value!.AlreadyAttached.Should().BeFalse("the first attach genuinely inserted");
        retry.IsSuccess.Should().BeTrue(
            "a retry is a SUCCESS outcome, never an error — the caller asked for a state, and that "
            + "state holds");
        retry.Value!.AlreadyAttached.Should().BeTrue("the retry reports it was already attached");
        retry.Value!.FieldOperatorId.Should().Be(operatorId);
        retry.Value!.LabourAssignmentId.Should().Be(assignmentA);

        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();
        var rows = await ScalarLongAsync(read,
            "SELECT COUNT(*) FROM ssf.field_operator_work_rows WHERE field_operator_id = @op AND labour_assignment_id = @la",
            ("op", operatorId), ("la", assignmentA));
        rows.Should().Be(1,
            "one real attribution must leave ONE work row, however many times it is sent — the unique "
            + "index ux_field_operator_work_rows_operator_assignment is the mechanism");

        output.WriteLine("[EVIDENCE] === 14.6 retry idempotency (Scenario 11) ===");
        output.WriteLine($"[EVIDENCE] first.IsSuccess / AlreadyAttached = {first.IsSuccess} / {first.Value!.AlreadyAttached} (expect True / False)");
        output.WriteLine($"[EVIDENCE] retry.IsSuccess / AlreadyAttached = {retry.IsSuccess} / {retry.Value!.AlreadyAttached} (expect True / True)");
        output.WriteLine($"[EVIDENCE] field_operator_work_rows for pair  = {rows} (expect 1)");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Doctrine E3 guard.
    // ═════════════════════════════════════════════════════════════════════════

    private async Task<(string Role, bool SuperOrBypass)> ReadAppRolePostureAsync()
    {
        await using var appCheck = new NpgsqlConnection(_appConn);
        await appCheck.OpenAsync();
        var role = Convert.ToString(await ScalarAsync(appCheck, "SELECT current_user")) ?? string.Empty;
        var superOrBypass = Convert.ToBoolean(await ScalarAsync(appCheck, RoleVacuityGuardSql));
        return (role, superOrBypass);
    }

    /// <summary>
    /// Runs at the top of EVERY [Fact] and once in <see cref="InitializeAsync"/>.
    /// Cheap insurance against the one failure mode that would void this whole
    /// class silently.
    /// </summary>
    private async Task AssertAppRoleIsNotVacuousAsync(bool quiet = false)
    {
        var (role, superOrBypass) = await ReadAppRolePostureAsync();
        superOrBypass.Should().BeFalse(
            "doctrine E3 — an RLS proof executed as a superuser or any BYPASSRLS role proves nothing; "
            + $"current_user='{role}'");
        if (!quiet)
        {
            output.WriteLine(
                $"[EVIDENCE] role guard: current_user='{role}' rolsuper OR rolbypassrls={superOrBypass} (required False)");
        }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Real handler invocation, as agrisync_app, under the ambient-transaction +
    // explicit-GUC posture (mirrors CallerFarmTenantScope +
    // TenantTransactionMiddleware). `farmScopeId` is the farm the request
    // established — which is NOT necessarily the farm the targeted rows belong
    // to; that mismatch IS the attack.
    // ═════════════════════════════════════════════════════════════════════════

    private async Task<T> RunUnderScopeAsync<T>(
        Guid farmScopeId, Guid callerUserId, Func<IServiceProvider, Task<T>> body)
    {
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        var ctx = sp.GetRequiredService<ShramSafalDbContext>();
        var tenant = sp.GetRequiredService<TenantContext>();

        // Admin-elevate so TenantConnectionInterceptor no-ops (no per-command
        // SET LOCAL prepend -> no EF write-rows-affected desync), then set the
        // GUCs ourselves inside the ambient transaction.
        tenant.ElevateToAdminCrossTenant();

        await using var tx = await ctx.Database.BeginTransactionAsync();

        await ctx.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('agrisync.user_id', {callerUserId.ToString()}, true)");
        await ctx.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('agrisync.farm_id', {farmScopeId.ToString()}, true)");

        var result = await body(sp);

        // The middleware commits whenever the pipeline returns without throwing
        // — INCLUDING on a Forbidden, which is a result and not an exception.
        // Committing here too is what makes the zero-row assertions meaningful
        // rather than an artefact of a rollback.
        //
        // On the 14.6 retry path the duplicate INSERT raises 23505 inside this
        // ambient transaction, which leaves it aborted; Postgres accepts COMMIT
        // on an aborted transaction and treats it as ROLLBACK. That is exactly
        // what production does on a retried attach (the only staged write was
        // the duplicate), so it is reproduced rather than papered over.
        try
        {
            await tx.CommitAsync();
        }
        catch (PostgresException ex) when (ex.SqlState == "25P02")
        {
            await tx.RollbackAsync();
        }

        return result;
    }

    private Task<Result<AttachFieldOperatorResult>> AttachAsync(
        Guid farmScopeId, Guid callerUserId, AttachFieldOperatorCommand command)
        => RunUnderScopeAsync(farmScopeId, callerUserId, sp => new AttachFieldOperatorHandler(
                sp.GetRequiredService<IShramSafalRepository>(),
                sp.GetRequiredService<IIdGenerator>(),
                sp.GetRequiredService<IClock>())
            .HandleAsync(command));

    private Task<Result<FieldOperatorDto>> RenameAsync(
        Guid farmScopeId, Guid callerUserId, RenameFieldOperatorCommand command)
        => RunUnderScopeAsync(farmScopeId, callerUserId, sp => new RenameFieldOperatorHandler(
                sp.GetRequiredService<IShramSafalRepository>(),
                sp.GetRequiredService<IClock>())
            .HandleAsync(command));

    private Task<Result<IReadOnlyList<FieldOperatorSummaryDto>>> GetFieldOperatorsAsync(
        Guid farmScopeId, Guid callerUserId)
        => RunUnderScopeAsync(farmScopeId, callerUserId, sp =>
            new GetFieldOperatorsHandler(sp.GetRequiredService<IShramSafalRepository>())
                .HandleAsync(new GetFieldOperatorsQuery(new FarmId(farmScopeId), new UserId(callerUserId))));

    // ── Loadability probes. These exist so a Forbidden cannot be mistaken for
    //    proof when the real reason was "the row was invisible". ──────────────

    private Task<global::ShramSafal.Domain.Farms.LabourAssignment?> ProbeLabourAssignmentAsync(
        Guid farmScopeId, Guid callerUserId, Guid assignmentId)
        => RunUnderScopeAsync(farmScopeId, callerUserId, sp =>
            sp.GetRequiredService<IShramSafalRepository>().GetLabourAssignmentByIdAsync(assignmentId));

    private Task<global::ShramSafal.Domain.Logs.DailyLog?> ProbeDailyLogAsync(
        Guid farmScopeId, Guid callerUserId, Guid dailyLogId)
        => RunUnderScopeAsync(farmScopeId, callerUserId, sp =>
            sp.GetRequiredService<IShramSafalRepository>().GetDailyLogByIdAsync(dailyLogId));

    private Task<global::ShramSafal.Domain.Labour.FieldOperator?> ProbeFieldOperatorAsync(
        Guid farmScopeId, Guid callerUserId, Guid fieldOperatorId)
        => RunUnderScopeAsync(farmScopeId, callerUserId, sp =>
            sp.GetRequiredService<IShramSafalRepository>().GetFieldOperatorByIdAsync(fieldOperatorId));

    // ═════════════════════════════════════════════════════════════════════════
    // Raw SQL as agrisync_app — for the claims that live BELOW the handler
    // (RLS visibility and the WITH CHECK backstop). set_config(..., true) is
    // transaction-local, so every one of these opens an explicit transaction.
    // ═════════════════════════════════════════════════════════════════════════

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

    private async Task<long> ScalarLongAsAppRoleAsync(
        Guid farmScopeId, Guid callerUserId, string sql, params (string Name, object Value)[] args)
    {
        await using var db = new NpgsqlConnection(_appConn);
        await db.OpenAsync();
        await using var tx = await db.BeginTransactionAsync();
        await SetGucAsync(db, "agrisync.user_id", callerUserId);
        await SetGucAsync(db, "agrisync.farm_id", farmScopeId);

        var value = await ScalarLongAsync(db, sql, args);
        await tx.CommitAsync();
        return value;
    }

    private static async Task SetGucAsync(NpgsqlConnection db, string key, Guid value)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT set_config(@k, @v, true)";
        cmd.Parameters.AddWithValue("k", key);
        cmd.Parameters.AddWithValue("v", value.ToString());
        await cmd.ExecuteNonQueryAsync();
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Catalog reads (superuser — these are catalog assertions, NOT RLS
    // enforcement tests, so no vacuity concern applies to them).
    // ═════════════════════════════════════════════════════════════════════════

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

    private static async Task<List<string>> ReadPolicyNamesAsync(NpgsqlConnection db, string table)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT policyname FROM pg_policies WHERE schemaname = 'ssf' AND tablename = @t ORDER BY policyname";
        cmd.Parameters.AddWithValue("t", table);
        var names = new List<string>();
        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            names.Add(reader.GetString(0));
        }

        return names;
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Plant helpers — always SUPERUSER, so the plant can never itself be the
    // proof, and never depends on the code under test.
    // ═════════════════════════════════════════════════════════════════════════

    private async Task<(Guid LogId, Guid AssignmentId)> PlantEngagementAsync(
        Guid farmId, Guid plotId, Guid cycleId, int workerCount, Guid? ownerUserId = null)
    {
        var logId = Guid.NewGuid();
        var assignmentId = Guid.NewGuid();

        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();

        await using (var log = db.CreateCommand())
        {
            log.CommandText = """
                INSERT INTO ssf.daily_logs ("Id", farm_id, plot_id, crop_cycle_id, operator_user_id, log_date, created_at_utc, source, model_version, prompt_version)
                VALUES (@id, @fid, @pid, @cid, @uid, @date, NOW(), 'manual', 'unknown', 'unknown');
                """;
            log.Parameters.AddWithValue("id", logId);
            log.Parameters.AddWithValue("fid", farmId);
            log.Parameters.AddWithValue("pid", plotId);
            log.Parameters.AddWithValue("cid", cycleId);
            log.Parameters.AddWithValue("uid", ownerUserId ?? OwnerAUserId);
            log.Parameters.AddWithValue("date", WorkDate);
            await log.ExecuteNonQueryAsync();
        }

        await using (var assignment = db.CreateCommand())
        {
            assignment.CommandText = """
                INSERT INTO ssf.labour_assignments
                    ("Id", daily_log_id, engagement_type, worker_count, worker_names_json, created_at_utc, duration_hours, time_basis)
                VALUES (@id, @dlid, 'Hired', @count, '[]'::jsonb, NOW(), 8, 'Assumed');
                """;
            assignment.Parameters.AddWithValue("id", assignmentId);
            assignment.Parameters.AddWithValue("dlid", logId);
            assignment.Parameters.AddWithValue("count", workerCount);
            await assignment.ExecuteNonQueryAsync();
        }

        return (logId, assignmentId);
    }

    private async Task<Guid> PlantFieldOperatorAsync(Guid farmId, string displayName)
    {
        var id = Guid.NewGuid();
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.field_operators
                ("Id", display_name, display_name_normalized, full_name, originating_farm_id, created_by_user_id, created_at_utc, is_active)
            VALUES (@id, @name, lower(@name), NULL, @fid, @uid, NOW(), TRUE);
            """;
        cmd.Parameters.AddWithValue("id", id);
        cmd.Parameters.AddWithValue("name", displayName);
        cmd.Parameters.AddWithValue("fid", farmId);
        cmd.Parameters.AddWithValue("uid", OwnerAUserId);
        await cmd.ExecuteNonQueryAsync();
        return id;
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

    private static async Task SeedPlotAsync(NpgsqlConnection db, Guid plotId, Guid farmId, string name)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.plots ("Id", farm_id, name, area_in_acres, created_at_utc, modified_at_utc)
            VALUES (@id, @farm, @name, 1.0, NOW(), NOW());
            """;
        cmd.Parameters.AddWithValue("id", plotId);
        cmd.Parameters.AddWithValue("farm", farmId);
        cmd.Parameters.AddWithValue("name", name);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task SeedCropCycleAsync(NpgsqlConnection db, Guid cycleId, Guid farmId, Guid plotId)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.crop_cycles ("Id", farm_id, plot_id, crop_name, stage, start_date, created_at_utc, modified_at_utc)
            VALUES (@id, @farm, @plot, 'Grapes', 'Vegetative', @start, NOW(), NOW());
            """;
        cmd.Parameters.AddWithValue("id", cycleId);
        cmd.Parameters.AddWithValue("farm", farmId);
        cmd.Parameters.AddWithValue("plot", plotId);
        cmd.Parameters.AddWithValue("start", new DateTime(2026, 1, 1));
        await cmd.ExecuteNonQueryAsync();
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Tiny SQL helpers.
    // ═════════════════════════════════════════════════════════════════════════

    private static async Task<long> ScalarLongAsync(
        NpgsqlConnection db, string sql, params (string Name, object Value)[] args)
        => Convert.ToInt64(await ScalarAsync(db, sql, args));

    private static async Task<object?> ScalarAsync(
        NpgsqlConnection db, string sql, params (string Name, object Value)[] args)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in args)
        {
            cmd.Parameters.AddWithValue(name, value);
        }

        return await cmd.ExecuteScalarAsync();
    }
}
