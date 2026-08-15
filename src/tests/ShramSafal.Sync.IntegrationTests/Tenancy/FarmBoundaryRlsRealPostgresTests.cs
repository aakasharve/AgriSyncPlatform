// spec: FINAL_SERVER_AUTHORITATIVE_EXECUTION_PLAN §P0.3
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.BuildingBlocks.Results;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Farms.UpdateFarmBoundary;
using ShramSafal.Infrastructure;
using ShramSafal.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Tenancy;

/// <summary>
/// §P0.3 — <b><c>ssf.farm_boundaries</c> row level security.</b> The table
/// carries a farmer's drawn field outline, the acreage every area-derived
/// number is computed from, and the owner account it belongs to. It shipped in
/// <c>20260424113438_AddFarmGeographyFoundation</c> with no policy and sat on
/// the RLS exemption allowlist until this ship.
///
/// <para><b>The route that writes it was DEAD before any of this.</b>
/// <c>PUT /shramsafal/farms/{farmId}/boundary</c> never established tenant
/// scope, so since FORCE-RLS landed on <c>ssf.farms</c> it died at
/// <c>TenantConnectionInterceptor</c>'s fail-closed throw on the FIRST
/// DbCommand of the authorization stage — a 500 with nothing written, for
/// every farmer. Wiring <c>ICallerFarmTenantScope</c> into that endpoint is
/// step one of §P0.3; this policy is the follow-on. Measured on the dev
/// cluster before/after: 500 + zero rows → 200 + one row at
/// <c>version = 1</c>.</para>
///
/// <para><b>Doctrine E3 — the assertion that makes or voids this class.</b> An
/// RLS proof executed as a superuser or any <c>BYPASSRLS</c> role proves
/// NOTHING. Every [Fact] opens with <see cref="AssertAppRoleIsNotVacuousAsync"/>
/// (<c>rolsuper OR rolbypassrls</c> asserted <b>false</b>, <c>current_user</c>
/// asserted) on the SAME connection string the code under test uses;
/// <see cref="InitializeAsync"/> runs it too, so the suite cannot reach a
/// [Fact] with a bypassing role. Catalog reads (<c>FORCE</c>/<c>ENABLE</c>,
/// policy names) legitimately use the superuser connection — they assert
/// catalog state, not enforcement.</para>
///
/// <para><b>Loadability before every rejection.</b> Each isolation fact first
/// PROVES the attacked row is genuinely visible to somebody under the app
/// role. A test that passes because the row was invisible — wrong seed, failed
/// insert, empty table — has proven nothing about authorization.</para>
///
/// <para><b>🛑 Why <c>FORCE</c> and not plain <c>ENABLE</c>: TABLE OWNERSHIP.</b>
/// On <c>agrisync_dev_v2</c> and production <c>agrisync_app</c> — the role the
/// API runs as — <b>owns</b> the <c>ssf</c> tables
/// (<c>pg_class.relowner</c>; measured <c>pg_get_userbyid(relowner) =
/// 'agrisync_app'</c> for <c>ssf.farm_boundaries</c>), and <b>a table owner
/// bypasses <c>ENABLE</c>-only RLS</b>. Neither role attribute is the reason
/// (<c>rolsuper = f</c>, <c>rolbypassrls = f</c>). <b>This scratch database
/// does NOT reproduce that</b> — the migration chain runs as the superuser, so
/// <c>postgres</c> owns the tables here and <c>agrisync_app</c> is an ordinary
/// grantee for whom <c>ENABLE</c> alone would already bite. The catalog
/// assertion in <see cref="The_app_role_is_not_vacuous_and_farm_boundaries_enables_and_forces_rls"/>
/// is therefore the ONLY thing in this file that can defend <c>FORCE</c>;
/// the enforcement facts cannot, and do not claim to. Same divergence, same
/// reason, as the TRUNCATE proof in
/// <c>AuditEventIsolationRealPostgresTests</c>.</para>
///
/// <para><b>Native :5433, fail-loud.</b> Tagged
/// <c>[Trait("Category","RequiresPostgres")]</c>. If native Postgres is
/// unreachable, <see cref="RequiresPostgresConnection"/> THROWS out of
/// <see cref="InitializeAsync"/> and the facts report FAILED, never a silent
/// skip. Each run creates its own scratch database and drops it on dispose; it
/// never touches <c>agrisync_dev_v2</c>.</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class FarmBoundaryRlsRealPostgresTests(Xunit.Abstractions.ITestOutputHelper output)
    : IAsyncLifetime
{
    /// <summary>Doctrine E3, verbatim. Must be <c>false</c> or this class is void.</summary>
    private const string RoleVacuityGuardSql =
        "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user";

    private const string AppRoleUser = TestRoleCredentials.AppRoleUser;
    private static string AppRolePassword => TestRoleCredentials.AppRolePassword;

    // ── Farm A — the farm the request establishes as its scope. ──────────────
    private static readonly Guid FarmA = Guid.Parse("fb0a1111-1111-1111-1111-111111111111");
    private static readonly Guid FarmAAccount = Guid.Parse("fb0a2222-2222-2222-2222-222222222222");
    private static readonly Guid OwnerA = Guid.Parse("fb0a3333-3333-3333-3333-333333333333");

    // ── Farm B — the victim farm. ────────────────────────────────────────────
    private static readonly Guid FarmB = Guid.Parse("fb0b1111-1111-1111-1111-111111111111");
    private static readonly Guid FarmBAccount = Guid.Parse("fb0b2222-2222-2222-2222-222222222222");
    private static readonly Guid OwnerB = Guid.Parse("fb0b3333-3333-3333-3333-333333333333");

    private const string PolygonOne =
        "{\"type\":\"Polygon\",\"coordinates\":[[[74.0,19.0],[74.001,19.0],[74.001,19.001],[74.0,19.001],[74.0,19.0]]]}";

    private const string PolygonTwo =
        "{\"type\":\"Polygon\",\"coordinates\":[[[74.0,19.0],[74.002,19.0],[74.002,19.002],[74.0,19.002],[74.0,19.0]]]}";

    private string _adminConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private string _superuserConn = string.Empty;
    private string _appConn = string.Empty;
    private ServiceProvider? _rootProvider;

    // ═════════════════════════════════════════════════════════════════════════
    // Harness
    // ═════════════════════════════════════════════════════════════════════════

    public async Task InitializeAsync()
    {
        _adminConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();

        _scratchDbName = $"ssf_fb_rls_{Guid.NewGuid():N}";
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

        // Doctrine E3 at the earliest possible moment.
        await AssertAppRoleIsNotVacuousAsync(quiet: true);

        // Parents are planted as the SUPERUSER on purpose — the plant must
        // never depend on the code under test, and superuser bypasses RLS so
        // the seed can never itself be the proof.
        await using (var raw = new NpgsqlConnection(_superuserConn))
        {
            await raw.OpenAsync();
            await SeedFarmAsync(raw, FarmA, OwnerA, FarmAAccount, "Boundary RLS Farm A");
            await SeedMembershipAsync(raw, FarmA, OwnerA, FarmAAccount, "PrimaryOwner");
            await SeedFarmAsync(raw, FarmB, OwnerB, FarmBAccount, "Boundary RLS Farm B");
            await SeedMembershipAsync(raw, FarmB, OwnerB, FarmBAccount, "PrimaryOwner");
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
    // P0.3-1 — THE VACUITY GUARD + catalog posture. Everything else is
    //          conditional on this.
    // ═════════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task The_app_role_is_not_vacuous_and_farm_boundaries_enables_and_forces_rls()
    {
        var (role, superOrBypass) = await ReadAppRolePostureAsync();

        superOrBypass.Should().BeFalse(
            "doctrine E3 — an RLS proof executed as a superuser or any BYPASSRLS role proves "
            + "NOTHING. If this is true every other assertion in this class passes vacuously and "
            + "silently, which is worse than having no suite at all because it manufactures false "
            + "confidence");
        role.Should().Be(AppRoleUser,
            "the connection under test must be the application role the API actually runs as");

        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();
        var (enabled, forced) = await ReadRlsFlagsAsync(read, "ssf.farm_boundaries");

        enabled.Should().BeTrue("ssf.farm_boundaries must have RLS ENABLED");
        forced.Should().BeTrue(
            "FORCE is load-bearing on TABLE OWNERSHIP alone. On agrisync_dev_v2 and production "
            + "pg_class.relowner for ssf.farm_boundaries is agrisync_app — the role the API runs as "
            + "— and a table OWNER bypasses ENABLE-only RLS. Neither role attribute is the reason "
            + "(rolsuper=f, rolbypassrls=f). This scratch database does not reproduce that ownership "
            + "(the migration chain runs as the superuser here), so this catalog bit is the only "
            + "assertion in this file that can defend FORCE — the enforcement facts below cannot");

        var policies = await ReadPolicyNamesAsync(read, "farm_boundaries");
        policies.Should().BeEquivalentTo(["p_tenant_farm_boundaries"],
            "exactly ONE policy on this table. Postgres OR-s permissive policies, so a permissive "
            + "user-scoped SELECT policy added later would silently re-open everything the tenant "
            + "policy closes — §P0.3 forbids adding one until geometry read-back actually exists "
            + "(E4: visible is not the same as authorised)");

        output.WriteLine("[EVIDENCE] === P0.3-1 vacuity guard (doctrine E3) + catalog posture ===");
        output.WriteLine($"[EVIDENCE] SQL: {RoleVacuityGuardSql}");
        output.WriteLine($"[EVIDENCE] current_user             = '{role}'");
        output.WriteLine($"[EVIDENCE] rolsuper OR rolbypassrls = {superOrBypass} (REQUIRED: False)");
        output.WriteLine($"[EVIDENCE] ssf.farm_boundaries      enabled={enabled} forced={forced}");
        output.WriteLine($"[EVIDENCE]   policies: [{string.Join(", ", policies)}]");
        output.WriteLine($"[EVIDENCE]   USING:  {await ReadPolicyExprAsync(read, "using")}");
        output.WriteLine($"[EVIDENCE]   CHECK:  {await ReadPolicyExprAsync(read, "check")}");
        output.WriteLine($"[EVIDENCE]   scratch-db owner of ssf.farm_boundaries = {await ReadTableOwnerAsync(read)}");
        output.WriteLine("[EVIDENCE]   (real clusters: owner=agrisync_app — which is why FORCE is required)");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // P0.3-2 — READ ISOLATION. Raw SQL as agrisync_app, below every handler.
    // ═════════════════════════════════════════════════════════════════════════

    /// <summary>
    /// A farm's drawn outline, its acreage and its owner account belong to that
    /// farm and to nobody else. Loadability first, so a zero is an
    /// authorization decision and not an empty table.
    /// </summary>
    [Fact]
    public async Task A_farm_boundary_is_readable_within_its_own_farm_scope_and_nowhere_else()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var boundaryA = await PlantBoundaryAsync(FarmA, FarmAAccount, PolygonOne, version: 1, isActive: true);
        var boundaryB = await PlantBoundaryAsync(FarmB, FarmBAccount, PolygonTwo, version: 1, isActive: true);

        // ── LOADABILITY. Both rows are genuinely readable to their own farm.
        var aSeesOwn = await CountAsAppRoleAsync(FarmA, OwnerA,
            "SELECT COUNT(*) FROM ssf.farm_boundaries WHERE id = @id", ("id", boundaryA));
        var bSeesOwn = await CountAsAppRoleAsync(FarmB, OwnerB,
            "SELECT COUNT(*) FROM ssf.farm_boundaries WHERE id = @id", ("id", boundaryB));

        aSeesOwn.Should().Be(1,
            "the row must be READABLE inside its own farm scope first — otherwise the zeroes below "
            + "prove invisibility, not authorization");
        bSeesOwn.Should().Be(1, "the same, for the victim farm");

        // ── THE CLAIM, both directions. ──────────────────────────────────────
        var aSeesB = await CountAsAppRoleAsync(FarmA, OwnerA,
            "SELECT COUNT(*) FROM ssf.farm_boundaries WHERE id = @id", ("id", boundaryB));
        var bSeesA = await CountAsAppRoleAsync(FarmB, OwnerB,
            "SELECT COUNT(*) FROM ssf.farm_boundaries WHERE id = @id", ("id", boundaryA));

        aSeesB.Should().Be(0,
            "a farm boundary is a farmer's field outline, its mapped acreage and its owner account "
            + "id. Before this policy any established tenant scope could SELECT every farm's "
            + "geometry — ShramSafalRepository.GetActiveFarmBoundaryAsync is a DIRECT select path "
            + "and has been since the table shipped");
        bSeesA.Should().Be(0, "the same, in the other direction");

        output.WriteLine("[EVIDENCE] === P0.3-2 read isolation (raw SQL as agrisync_app) ===");
        output.WriteLine($"[EVIDENCE] LOADABILITY: FarmA scope sees FarmA boundary = {aSeesOwn} (expect 1)");
        output.WriteLine($"[EVIDENCE] LOADABILITY: FarmB scope sees FarmB boundary = {bSeesOwn} (expect 1)");
        output.WriteLine($"[EVIDENCE] FarmA scope sees FarmB boundary              = {aSeesB} (expect 0)");
        output.WriteLine($"[EVIDENCE] FarmB scope sees FarmA boundary              = {bSeesA} (expect 0)");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // P0.3-3 — E4, BOTH DIRECTIONS. Foreign parent and forged tenant column.
    // ═════════════════════════════════════════════════════════════════════════

    /// <summary>
    /// <b>E4 — visible is not the same as authorised, and a satisfied foreign
    /// key is not an authorization result.</b> Postgres FK checks bypass RLS
    /// entirely, so <c>FK_farm_boundaries_farms_farm_id</c> is perfectly happy
    /// to accept a boundary pointed at another farmer's farm; only
    /// <c>WITH CHECK</c> stops it. Both directions are attacked:
    /// <list type="number">
    /// <item><b>Foreign parent</b> — INSERT a boundary whose <c>farm_id</c> is
    /// Farm B while the request is scoped to Farm A.</item>
    /// <item><b>Forged tenant column</b> — UPDATE Farm A's own boundary to
    /// carry Farm B's <c>farm_id</c>, i.e. hand the row away.</item>
    /// </list>
    /// A same-shape CONTROL insert (correct farm) must succeed, or the
    /// refusals above would be indistinguishable from a broken write path. A
    /// superuser recount then proves nothing landed.
    /// </summary>
    [Fact]
    public async Task A_forged_farm_boundary_write_is_refused_with_42501_and_lands_nothing()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var boundaryA = await PlantBoundaryAsync(FarmA, FarmAAccount, PolygonOne, version: 1, isActive: true);

        // ── LOADABILITY of the attack surface itself: Farm B genuinely exists
        //    (the FK will be satisfied) and Farm A's row is genuinely writable
        //    from inside Farm A's scope. Without this the refusals below could
        //    be a missing parent or a broken grant.
        await using (var read = new NpgsqlConnection(_superuserConn))
        {
            await read.OpenAsync();
            var victimFarmExists = await ScalarLongAsync(read,
                "SELECT COUNT(*) FROM ssf.farms WHERE \"Id\" = @id", ("id", FarmB));
            victimFarmExists.Should().Be(1,
                "the forged writes below must satisfy the foreign key — a 23503 would prove the FK "
                + "worked, not the policy");
        }

        var control = await ExecuteAsAppRoleAsync(FarmA, OwnerA, """
            INSERT INTO ssf.farm_boundaries
                (id, farm_id, owner_account_id, polygon_geo_json, calculated_area_acres,
                 source, version, is_active, created_at_utc)
            VALUES (@id, @fid, @acct, @poly::jsonb, 2.5, 'UserDrawn', 9, FALSE, NOW());
            """,
            ("id", Guid.NewGuid()), ("fid", FarmA), ("acct", FarmAAccount), ("poly", PolygonTwo));

        control.Error.Should().BeNull(
            "the SAME-SHAPE control must SUCCEED — otherwise the two refusals below would be "
            + "consistent with 'the app role cannot write this table at all', which proves nothing "
            + $"about tenancy. Error was: {control.Error?.SqlState} {control.Error?.MessageText}");
        control.Affected.Should().Be(1);

        // ── (i) FOREIGN PARENT. A boundary aimed at Farm B from Farm A's scope.
        var forgedInsertId = Guid.NewGuid();
        var forgedInsert = await ExecuteAsAppRoleAsync(FarmA, OwnerA, """
            INSERT INTO ssf.farm_boundaries
                (id, farm_id, owner_account_id, polygon_geo_json, calculated_area_acres,
                 source, version, is_active, created_at_utc)
            VALUES (@id, @fid, @acct, @poly::jsonb, 99.0, 'UserDrawn', 1, FALSE, NOW());
            """,
            ("id", forgedInsertId), ("fid", FarmB), ("acct", FarmBAccount), ("poly", PolygonTwo));

        forgedInsert.Error.Should().NotBeNull(
            "WITH CHECK must reject a boundary written onto another farmer's farm. The foreign key "
            + "cannot: Postgres FK checks bypass row level security, so a satisfied FK proves the "
            + "parent EXISTS and never that the caller may touch it");
        forgedInsert.Error!.SqlState.Should().Be("42501",
            "insufficient_privilege — the refusal must come from the policy system. Any other "
            + "SQLSTATE (23503 foreign key, 23505 unique) would mean the write was ALLOWED past the "
            + "policy and failed for an incidental reason another cluster might not have");

        // ── (ii) FORGED TENANT COLUMN. Hand Farm A's own row to Farm B.
        var forgedUpdate = await ExecuteAsAppRoleAsync(FarmA, OwnerA, """
            UPDATE ssf.farm_boundaries SET farm_id = @victim, owner_account_id = @victimAcct
            WHERE id = @id;
            """,
            ("victim", FarmB), ("victimAcct", FarmBAccount), ("id", boundaryA));

        forgedUpdate.Error.Should().NotBeNull(
            "WITH CHECK is evaluated against the POST-image of an UPDATE, so rewriting the tenant "
            + "column to another farm must be refused. USING alone would let this through — the row "
            + "is visible before the update and the check is what stops it leaving");
        forgedUpdate.Error!.SqlState.Should().Be("42501", "insufficient_privilege");

        // ── NOTHING LANDED. Counted as the superuser so the recount cannot be
        //    voided by the very policy under test.
        await using (var read = new NpgsqlConnection(_superuserConn))
        {
            await read.OpenAsync();
            var forgedInsertLanded = await ScalarLongAsync(read,
                "SELECT COUNT(*) FROM ssf.farm_boundaries WHERE id = @id", ("id", forgedInsertId));
            var stolenRows = await ScalarLongAsync(read,
                "SELECT COUNT(*) FROM ssf.farm_boundaries WHERE id = @id AND farm_id = @victim",
                ("id", boundaryA), ("victim", FarmB));
            var rowStillOwnedByA = await ScalarLongAsync(read,
                "SELECT COUNT(*) FROM ssf.farm_boundaries WHERE id = @id AND farm_id = @a",
                ("id", boundaryA), ("a", FarmA));

            forgedInsertLanded.Should().Be(0, "a refused INSERT must have written nothing");
            stolenRows.Should().Be(0, "a refused UPDATE must not have moved the row");
            rowStillOwnedByA.Should().Be(1, "and the original row must be untouched, not deleted");

            output.WriteLine("[EVIDENCE] === P0.3-3 E4 both directions (as agrisync_app) ===");
            output.WriteLine($"[EVIDENCE] CONTROL insert (own farm)     -> affected={control.Affected} error={control.Error?.SqlState ?? "none"} (expect 1 / none)");
            output.WriteLine($"[EVIDENCE] forged INSERT (foreign parent)-> SQLSTATE {forgedInsert.Error!.SqlState} : {forgedInsert.Error!.MessageText}");
            output.WriteLine($"[EVIDENCE] forged UPDATE (tenant column) -> SQLSTATE {forgedUpdate.Error!.SqlState} : {forgedUpdate.Error!.MessageText}");
            output.WriteLine($"[EVIDENCE] forged insert rows landed     = {forgedInsertLanded} (expect 0)");
            output.WriteLine($"[EVIDENCE] rows moved to the victim farm = {stolenRows} (expect 0)");
            output.WriteLine($"[EVIDENCE] original row still on Farm A  = {rowStillOwnedByA} (expect 1)");
        }
    }

    // ═════════════════════════════════════════════════════════════════════════
    // P0.3-4 — THE SECOND WRITE. The assertion that actually matters.
    // ═════════════════════════════════════════════════════════════════════════

    /// <summary>
    /// <b>Versioning must survive the policy, and only the SECOND write can
    /// show it.</b> <c>UpdateFarmBoundaryHandler</c> lines 77-79 derive BOTH
    /// <c>nextVersion</c> and <c>activeBoundary?.Archive(...)</c> from ONE
    /// RLS-filtered read, and both degrade <b>silently</b>: <c>?? 0</c> gives
    /// version 1 again and <c>?.</c> archives nothing. Neither raises. A
    /// single-write test passes trivially and proves nothing — the failure mode
    /// only exists once there is a prior row to lose.
    ///
    /// <para>Runs the REAL handler, twice, as <c>agrisync_app</c>, under the
    /// exact posture <c>ICallerFarmTenantScope</c> establishes (admin-elevate so
    /// the interceptor no-ops, then set the GUCs inside the ambient
    /// transaction). Re-implementing the version arithmetic in the test would
    /// prove only that the test agrees with itself.</para>
    /// </summary>
    [Fact]
    public async Task A_second_boundary_write_reaches_version_two_and_archives_the_prior_row()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var first = await UpdateBoundaryAsync(FarmA, OwnerA, PolygonOne, areaAcres: 2.75m);
        first.IsSuccess.Should().BeTrue(
            $"the first write must land or there is no prior row to lose; error = {first.Error?.Code}");

        var afterFirst = await ReadBoundariesAsSuperuserAsync(FarmA);
        afterFirst.Should().HaveCount(1, "the first write lands exactly one row");
        afterFirst[0].Version.Should().Be(1);
        afterFirst[0].IsActive.Should().BeTrue();
        afterFirst[0].ArchivedAtUtc.Should().BeNull();

        // ── THE ASSERTION THAT MATTERS. ──────────────────────────────────────
        var second = await UpdateBoundaryAsync(FarmA, OwnerA, PolygonTwo, areaAcres: 3.5m);
        second.IsSuccess.Should().BeTrue(
            "the second write is where the policy could break the handler. If the prior-boundary "
            + "read filtered to nothing, `?? 0` would recompute version 1 and `?.Archive` would "
            + "no-op, leaving two active rows — which the partial unique index "
            + "ux_farm_boundaries_active_farm_id then rejects with 23505. Either way the farmer's "
            + $"boundary history is lost. Error = {second.Error?.Code}");

        var afterSecond = await ReadBoundariesAsSuperuserAsync(FarmA);
        afterSecond.Should().HaveCount(2, "the ledger is versioned, not overwritten");

        var archived = afterSecond.Single(b => b.Version == 1);
        var live = afterSecond.Single(b => b.Version == 2);

        live.IsActive.Should().BeTrue("the newest boundary is the active one");
        live.ArchivedAtUtc.Should().BeNull();
        live.Version.Should().Be(2,
            "version must ADVANCE. A silent reset to 1 is the exact failure `?? 0` produces when the "
            + "prior-boundary read is filtered out by the policy");

        archived.IsActive.Should().BeFalse(
            "the prior boundary must be ARCHIVED, not left active. `activeBoundary?.Archive(...)` "
            + "is a null-conditional call — if the read returned nothing it does nothing, with no "
            + "error anywhere");
        archived.ArchivedAtUtc.Should().NotBeNull("and it must carry the archival timestamp");

        output.WriteLine("[EVIDENCE] === P0.3-4 versioning survives the policy (real handler, x2) ===");
        output.WriteLine($"[EVIDENCE] first  write  IsSuccess = {first.IsSuccess}");
        output.WriteLine($"[EVIDENCE] after first: rows={afterFirst.Count} version={afterFirst[0].Version} is_active={afterFirst[0].IsActive}");
        output.WriteLine($"[EVIDENCE] second write  IsSuccess = {second.IsSuccess}");
        output.WriteLine($"[EVIDENCE] after second: rows={afterSecond.Count} (expect 2)");
        output.WriteLine($"[EVIDENCE]   live     version={live.Version} is_active={live.IsActive} archived_at={live.ArchivedAtUtc?.ToString("O") ?? "null"} (expect 2 / True / null)");
        output.WriteLine($"[EVIDENCE]   archived version={archived.Version} is_active={archived.IsActive} archived_at={archived.ArchivedAtUtc?.ToString("O") ?? "null"} (expect 1 / False / set)");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // P0.3-5 — WHY THE SKIP-LIST IS THE TRAP, stated as a measurement.
    // ═════════════════════════════════════════════════════════════════════════

    /// <summary>
    /// <b>The tempting one-line "fix" for the dead PUT was to add
    /// <c>/shramsafal/farms</c> to <c>TenantTransactionMiddleware</c>'s
    /// <c>SkipPathPrefixes</c>.</b> That admin-elevates the request, which makes
    /// the interceptor a no-op that sets <b>no GUC at all</b> — and this fact
    /// measures what the boundary read then returns.
    ///
    /// <para>Stated precisely, because the honest claim is narrower than the
    /// dramatic one: with no <c>agrisync.farm_id</c> set, the active-boundary
    /// read returns <c>null</c> for a farm that demonstrably HAS an active
    /// boundary. That null is what feeds <c>?? 0</c> and <c>?.</c>. The write
    /// that follows is then caught by the partial unique index rather than
    /// silently duplicating — a backstop, not a defence, and it turns a lost
    /// boundary into a 500 instead of a wrong number.</para>
    /// </summary>
    [Fact]
    public async Task Without_a_farm_scope_the_active_boundary_read_returns_nothing_which_is_the_trap()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var planted = await PlantBoundaryAsync(FarmA, FarmAAccount, PolygonOne, version: 1, isActive: true);

        // ── LOADABILITY. Under the scope ICallerFarmTenantScope establishes,
        //    the repository genuinely finds the row.
        var scoped = await RunUnderScopeAsync(FarmA, OwnerA, sp =>
            sp.GetRequiredService<IShramSafalRepository>().GetActiveFarmBoundaryAsync(FarmA));
        scoped.Should().NotBeNull(
            "the active boundary must be findable under a correctly established scope — otherwise "
            + "the null below is a broken read, not a filtered one");
        scoped!.Id.Should().Be(planted);
        scoped.Version.Should().Be(1);

        // ── The skip-list posture: admin-elevated, NO GUCs set. ──────────────
        var unscoped = await RunUnscopedAdminAsync(sp =>
            sp.GetRequiredService<IShramSafalRepository>().GetActiveFarmBoundaryAsync(FarmA));

        unscoped.Should().BeNull(
            "this is the trap. Admin elevation makes TenantConnectionInterceptor a no-op that sets "
            + "NO tenant GUC, so p_tenant_farm_boundaries matches nothing and the handler's "
            + "`activeBoundary?.Version ?? 0` recomputes version 1 while `activeBoundary?.Archive` "
            + "does nothing at all — neither raises. Wire the scope with ICallerFarmTenantScope, "
            + "never by adding the route to SkipPathPrefixes");

        output.WriteLine("[EVIDENCE] === P0.3-5 the skip-list trap, measured ===");
        output.WriteLine($"[EVIDENCE] planted active boundary id            = {planted}");
        output.WriteLine($"[EVIDENCE] scoped   GetActiveFarmBoundaryAsync   = {(scoped is null ? "null" : $"v{scoped.Version}")} (expect v1)");
        output.WriteLine($"[EVIDENCE] unscoped GetActiveFarmBoundaryAsync   = {(unscoped is null ? "null" : $"v{unscoped.Version}")} (expect null)");
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
    // Real application code as agrisync_app, under the exact posture
    // CallerFarmTenantScope + TenantTransactionMiddleware establish.
    // ═════════════════════════════════════════════════════════════════════════

    private async Task<T> RunUnderScopeAsync<T>(
        Guid farmScopeId, Guid callerUserId, Func<IServiceProvider, Task<T>> body)
    {
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        var ctx = sp.GetRequiredService<ShramSafalDbContext>();
        var tenant = sp.GetRequiredService<TenantContext>();

        // Admin-elevate so the interceptor no-ops (no per-command SET LOCAL
        // prepend -> no EF write-rows-affected desync), then set the GUCs
        // ourselves — exactly what CallerFarmTenantScope does after its
        // membership gate passes.
        tenant.ElevateToAdminCrossTenant();

        await using var tx = await ctx.Database.BeginTransactionAsync();
        await ctx.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('agrisync.user_id', {callerUserId.ToString()}, true)");
        await ctx.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('agrisync.farm_id', {farmScopeId.ToString()}, true)");
        await ctx.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('agrisync.owner_account_id', {OwnerAccountFor(farmScopeId)}, true)");

        var result = await body(sp);
        await tx.CommitAsync();
        return result;
    }

    /// <summary>
    /// The SkipPathPrefixes posture: admin-elevated with NO tenant GUC set at
    /// all. Deliberately not a variant of <see cref="RunUnderScopeAsync"/> — the
    /// absence of the set_config calls IS the thing under measurement.
    /// </summary>
    private async Task<T> RunUnscopedAdminAsync<T>(Func<IServiceProvider, Task<T>> body)
    {
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        var ctx = sp.GetRequiredService<ShramSafalDbContext>();
        sp.GetRequiredService<TenantContext>().ElevateToAdminCrossTenant();

        await using var tx = await ctx.Database.BeginTransactionAsync();
        var result = await body(sp);
        await tx.CommitAsync();
        return result;
    }

    private Task<Result<FarmDto>> UpdateBoundaryAsync(
        Guid farmId, Guid actorUserId, string polygonGeoJson, decimal areaAcres)
        => RunUnderScopeAsync(farmId, actorUserId, sp => new UpdateFarmBoundaryHandler(
                sp.GetRequiredService<IShramSafalRepository>(),
                sp.GetRequiredService<IIdGenerator>(),
                sp.GetRequiredService<IClock>())
            .HandleAsync(new UpdateFarmBoundaryCommand(
                farmId,
                actorUserId,
                polygonGeoJson,
                CentreLat: 19.0005,
                CentreLng: 74.0005,
                CalculatedAreaAcres: areaAcres,
                ActorRole: "PrimaryOwner")));

    private static string OwnerAccountFor(Guid farmId) =>
        farmId == FarmA ? FarmAAccount.ToString() : FarmBAccount.ToString();

    // ═════════════════════════════════════════════════════════════════════════
    // Raw SQL as agrisync_app. set_config(..., true) is transaction-local, so
    // every one of these opens an explicit transaction.
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

    private async Task<long> CountAsAppRoleAsync(
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
    // Catalog reads (superuser — catalog assertions, not enforcement tests).
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
        cmd.CommandText =
            "SELECT policyname FROM pg_policies WHERE schemaname = 'ssf' AND tablename = @t ORDER BY policyname";
        cmd.Parameters.AddWithValue("t", table);
        var names = new List<string>();
        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            names.Add(reader.GetString(0));
        }

        return names;
    }

    private static async Task<string> ReadPolicyExprAsync(NpgsqlConnection db, string which)
    {
        var column = which == "using" ? "qual" : "with_check";
        return Convert.ToString(await ScalarAsync(db,
            $"SELECT {column} FROM pg_policies WHERE schemaname='ssf' AND tablename='farm_boundaries' "
            + "AND policyname='p_tenant_farm_boundaries'")) ?? "(null)";
    }

    private static async Task<string> ReadTableOwnerAsync(NpgsqlConnection db) =>
        Convert.ToString(await ScalarAsync(db,
            "SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = 'ssf.farm_boundaries'::regclass")) ?? "?";

    // ═════════════════════════════════════════════════════════════════════════
    // Plant + read helpers — always SUPERUSER, so the plant can never be the
    // proof and the recount can never be voided by the policy under test.
    // ═════════════════════════════════════════════════════════════════════════

    private sealed record BoundaryRow(Guid Id, Guid FarmId, int Version, bool IsActive, DateTime? ArchivedAtUtc);

    private async Task<Guid> PlantBoundaryAsync(
        Guid farmId, Guid ownerAccountId, string polygonGeoJson, int version, bool isActive)
    {
        var id = Guid.NewGuid();
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.farm_boundaries
                (id, farm_id, owner_account_id, polygon_geo_json, calculated_area_acres,
                 source, version, is_active, created_at_utc)
            VALUES (@id, @fid, @acct, @poly::jsonb, 2.0, 'UserDrawn', @ver, @active, NOW());
            """;
        cmd.Parameters.AddWithValue("id", id);
        cmd.Parameters.AddWithValue("fid", farmId);
        cmd.Parameters.AddWithValue("acct", ownerAccountId);
        cmd.Parameters.AddWithValue("poly", polygonGeoJson);
        cmd.Parameters.AddWithValue("ver", version);
        cmd.Parameters.AddWithValue("active", isActive);
        await cmd.ExecuteNonQueryAsync();
        return id;
    }

    private async Task<List<BoundaryRow>> ReadBoundariesAsSuperuserAsync(Guid farmId)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText =
            "SELECT id, farm_id, version, is_active, archived_at_utc FROM ssf.farm_boundaries "
            + "WHERE farm_id = @fid ORDER BY version";
        cmd.Parameters.AddWithValue("fid", farmId);
        var rows = new List<BoundaryRow>();
        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            rows.Add(new BoundaryRow(
                reader.GetGuid(0),
                reader.GetGuid(1),
                reader.GetInt32(2),
                reader.GetBoolean(3),
                await reader.IsDBNullAsync(4) ? null : reader.GetDateTime(4)));
        }

        return rows;
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
