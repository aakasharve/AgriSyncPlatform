// spec: FINAL_SERVER_AUTHORITATIVE_EXECUTION_PLAN §P0.2
using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Claims;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Auditing;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Http.HttpResults;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShramSafal.Api;
using ShramSafal.Api.Endpoints;
using ShramSafal.Application.Admin.Ports;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Sync.PullSyncChanges;
using ShramSafal.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Audit;

/// <summary>
/// §P0.2 — <b>audit authorization isolation.</b> The first real proof that
/// <c>ssf.audit_events</c> is isolated at all: before this file every audit
/// query in the test suite ran as <b>superuser</b> and therefore proved nothing
/// about RLS, and no suite covered this table's policy.
///
/// <para><b>The objective under test.</b> <i>A farmer or device may receive only
/// audit information the authenticated user is actually authorized to see.</i>
/// The same hole was written in three places and all three are proven here:
/// the SQL predicate (<c>ShramSafalRepository</c>), the handler filter
/// (<c>PullSyncChangesHandler</c>), and the <c>p_tenant_audit_events</c>
/// <c>USING</c> clause.</para>
///
/// <para><b>What the NULL-farm rows actually are.</b> Not names, not phone
/// numbers — those audits are farm-scoped. What every device used to receive:
/// S3 object keys for other farmers' raw voice recordings, other users' GUIDs
/// including erasure subjects, unbounded PII-review staff free text, admin
/// elevation reasons, DEK handles. A cross-tenant privacy-incident ledger.</para>
///
/// <para><b>Doctrine E3 — the assertion that makes or voids this class.</b> An
/// RLS proof executed as a superuser or any <c>BYPASSRLS</c> role proves
/// NOTHING. Every [Fact] opens with <see cref="AssertAppRoleIsNotVacuousAsync"/>
/// (<c>rolsuper OR rolbypassrls</c> asserted <b>false</b>, <c>current_user</c>
/// asserted) on the SAME connection string the code under test uses;
/// <see cref="InitializeAsync"/> runs it too, so the suite cannot reach a [Fact]
/// with a bypassing role. Catalog reads (<c>FORCE</c>/<c>ENABLE</c>, policy
/// names) legitimately use the superuser connection — they assert catalog state,
/// not enforcement.</para>
///
/// <para><b>Loadability before rejection.</b> Every isolation fact first PROVES
/// the attacked row is genuinely visible to somebody under the app role. A test
/// that passes because the row was invisible — wrong seed, failed insert, empty
/// table — has proven nothing about authorization. The probes are the difference
/// between "the guard works" and "there was nothing there".</para>
///
/// <para><b>Native :5433, fail-loud.</b> Tagged
/// <c>[Trait("Category","RequiresPostgres")]</c>. If native Postgres is
/// unreachable, <see cref="RequiresPostgresConnection"/> THROWS out of
/// <see cref="InitializeAsync"/> and the facts report FAILED, never a silent
/// skip. Each run creates its own scratch database and drops it on dispose; it
/// never touches <c>agrisync_dev_v2</c>.</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class AuditEventIsolationRealPostgresTests(Xunit.Abstractions.ITestOutputHelper output)
    : IAsyncLifetime
{
    /// <summary>Doctrine E3, verbatim. Must be <c>false</c> or this class is void.</summary>
    private const string RoleVacuityGuardSql =
        "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user";

    private const string AppRoleUser = TestRoleCredentials.AppRoleUser;
    private static string AppRolePassword => TestRoleCredentials.AppRolePassword;

    // ── Alice: owns Farm A. The caller whose own rows must stay visible. ──────
    private static readonly Guid FarmA = Guid.Parse("aa011111-1111-1111-1111-111111111111");
    private static readonly Guid FarmAAccount = Guid.Parse("aa022222-2222-2222-2222-222222222222");
    private static readonly Guid Alice = Guid.Parse("aa033333-3333-3333-3333-333333333333");
    private static readonly Guid PlotA = Guid.Parse("aa044444-4444-4444-4444-444444444444");
    private static readonly Guid CycleA = Guid.Parse("aa055555-5555-5555-5555-555555555555");

    // ── Bob: owns Farm B. A different farmer on the same cluster. ────────────
    private static readonly Guid FarmB = Guid.Parse("bb011111-1111-1111-1111-111111111111");
    private static readonly Guid FarmBAccount = Guid.Parse("bb022222-2222-2222-2222-222222222222");
    private static readonly Guid Bob = Guid.Parse("bb033333-3333-3333-3333-333333333333");

    /// <summary>
    /// A platform staff member. Not a member of ANY farm — which is the point:
    /// the audit ledger is not farm data, so farm membership can never be the
    /// key that unlocks it.
    /// </summary>
    private static readonly Guid PlatformOwner = Guid.Parse("cc011111-1111-1111-1111-111111111111");
    private static readonly Guid PlatformOrg = Guid.Parse("cc022222-2222-2222-2222-222222222222");

    /// <summary>
    /// A Platform ANALYST. Deliberately present: the EntitlementMatrix has a
    /// blanket "Platform Analyst reads every module" branch, and the audit
    /// ledger is the one surface where that blanket is wrong.
    /// </summary>
    private static readonly Guid PlatformAnalyst = Guid.Parse("cc033333-3333-3333-3333-333333333333");
    private static readonly Guid AnalystOrg = Guid.Parse("cc044444-4444-4444-4444-444444444444");

    /// <summary>
    /// The shared <c>entity_id</c> the endpoint facts query. Real NULL-farm rows
    /// are keyed on entity ids a caller can learn or guess; the suite uses one
    /// id so the endpoint returns a MIXED stream and the filter has to do work.
    /// </summary>
    private static readonly Guid SharedEntityId = Guid.Parse("dd011111-1111-1111-1111-111111111111");

    private const string SharedEntityType = "voice_clip_retained";

    private string _adminConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private string _superuserConn = string.Empty;
    private string _appConn = string.Empty;
    private ServiceProvider? _rootProvider;

    /// <summary>
    /// A second container wired to the SUPERUSER connection, used by exactly one
    /// fact — the endpoint-filter proof, which must run where RLS admits every
    /// row so the endpoint's own rule is the only thing that can remove one.
    /// Nothing else in this class may use it, and the fact that does asserts the
    /// role IS bypassing so it cannot silently degrade into a second RLS test.
    /// </summary>
    private ServiceProvider? _superuserProvider;

    // ═════════════════════════════════════════════════════════════════════════
    // Harness
    // ═════════════════════════════════════════════════════════════════════════

    public async Task InitializeAsync()
    {
        _adminConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();

        _scratchDbName = $"ssf_audit_iso_{Guid.NewGuid():N}";
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

        // Every plant is SUPERUSER: the seed must never depend on the code under
        // test, and superuser bypasses RLS so the seed cannot itself be a proof.
        await using (var raw = new NpgsqlConnection(_superuserConn))
        {
            await raw.OpenAsync();

            // Reproduce the grant the real clusters carry. Measured on
            // agrisync_dev_v2: agrisync_app holds SELECT on public.users and
            // public.memberships (it owns them there). In a scratch database the
            // migration chain runs as the superuser, so postgres owns them and
            // no migration GRANTs them — without this, GetOperatorsByIdsAsync
            // dies with 42501 and the operator-hydration assertion below would
            // "pass" for the wrong reason. Neither table has row level security,
            // which is exactly why the leaked-ActorUserId amplifier was real.
            await using (var grant = raw.CreateCommand())
            {
                grant.CommandText =
                    "GRANT SELECT ON public.users, public.memberships TO agrisync_app;";
                await grant.ExecuteNonQueryAsync();
            }

            await SeedUserAsync(raw, Alice, "9000000001", "अलका");
            await SeedUserAsync(raw, Bob, "9000000002", "बाळू");
            await SeedUserAsync(raw, PlatformOwner, "9000000003", "Platform Owner");
            await SeedUserAsync(raw, PlatformAnalyst, "9000000004", "Platform Analyst");

            await SeedFarmAsync(raw, FarmA, Alice, FarmAAccount, "Audit Isolation Farm A");
            await SeedMembershipAsync(raw, FarmA, Alice, FarmAAccount, "PrimaryOwner");
            await SeedPlotAsync(raw, PlotA, FarmA, "Plot A");
            await SeedCropCycleAsync(raw, CycleA, FarmA, PlotA);

            await SeedFarmAsync(raw, FarmB, Bob, FarmBAccount, "Audit Isolation Farm B");
            await SeedMembershipAsync(raw, FarmB, Bob, FarmBAccount, "PrimaryOwner");

            await SeedOrganizationAsync(raw, PlatformOrg, "AgriSync Platform", type: 0);
            await SeedOrgMembershipAsync(raw, PlatformOrg, PlatformOwner, role: 0);
            await SeedOrganizationAsync(raw, AnalystOrg, "AgriSync Platform Analytics", type: 0);
            await SeedOrgMembershipAsync(raw, AnalystOrg, PlatformAnalyst, role: 1);
        }

        _rootProvider = BuildProvider(_appConn);
        _superuserProvider = BuildProvider(_superuserConn);
    }

    private static ServiceProvider BuildProvider(string connectionString)
    {
        var services = new ServiceCollection();
        services.AddLogging();
        var config = new ConfigurationBuilder()
            .AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:ShramSafalDb"] = connectionString,
                ["ConnectionStrings:UserDb"] = connectionString,
            }!)
            .Build();
        services.AddSingleton<IConfiguration>(config);
        services.AddShramSafalApi(config);
        services.AddScoped<IIdGenerator, GuidIdGenerator>();
        services.AddScoped<IClock, SystemClock>();
        services.AddSingleton<IEntitlementPolicy, AllowAllEntitlementPolicy>();
        services.AddSingleton<IAnalyticsWriter, NoopAnalyticsWriter>();
        return services.BuildServiceProvider();
    }

    public async Task DisposeAsync()
    {
        if (_superuserProvider is not null)
        {
            await _superuserProvider.DisposeAsync();
        }

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
    // P0.2-1 — THE VACUITY GUARD + catalog posture. Everything else is
    //          conditional on this.
    // ═════════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task The_app_role_is_neither_superuser_nor_bypassrls_so_this_suite_is_not_vacuous()
    {
        var (role, superOrBypass) = await ReadAppRolePostureAsync();

        superOrBypass.Should().BeFalse(
            "doctrine E3 — an RLS proof executed as a superuser or any BYPASSRLS role proves "
            + "NOTHING. If this is true, every other assertion in this class passes vacuously "
            + "and silently, and the suite is worse than useless because it manufactures false "
            + "confidence. No audit-isolation proof existed before this file precisely because "
            + "every earlier audit query in the suite ran as postgres.");
        role.Should().Be(AppRoleUser,
            "the connection under test must be the application role the API actually runs as");

        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();
        var (enabled, forced) = await ReadRlsFlagsAsync(read, "ssf.audit_events");

        enabled.Should().BeTrue("ssf.audit_events must have RLS ENABLED");
        forced.Should().BeTrue(
            "ssf.audit_events must FORCE RLS — plain ENABLE exempts the table OWNER, and "
            + "ssf.audit_events is owned by agrisync_app itself, so without FORCE the "
            + "application role would bypass every policy below");

        var policies = await ReadPolicyNamesAsync(read, "audit_events");
        policies.Should().BeEquivalentTo(["p_tenant_audit_events"],
            "exactly ONE policy on this table. Postgres OR-s permissive policies, so a second "
            + "permissive SELECT policy would silently re-open everything the USING clause "
            + "below closes — amending the one policy is only sufficient while it IS the one");

        output.WriteLine("[EVIDENCE] === P0.2-1 vacuity guard (doctrine E3) ===");
        output.WriteLine($"[EVIDENCE] SQL: {RoleVacuityGuardSql}");
        output.WriteLine($"[EVIDENCE] current_user             = '{role}'");
        output.WriteLine($"[EVIDENCE] rolsuper OR rolbypassrls = {superOrBypass} (REQUIRED: False)");
        output.WriteLine($"[EVIDENCE] ssf.audit_events         enabled={enabled} forced={forced}");
        output.WriteLine($"[EVIDENCE]   policies: [{string.Join(", ", policies)}]");
        output.WriteLine($"[EVIDENCE]   USING:  {await ReadPolicyExprAsync(read, "using")}");
        output.WriteLine($"[EVIDENCE]   CHECK:  {await ReadPolicyExprAsync(read, "check")}");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // P0.2-2 — THE POLICY. Raw SQL as agrisync_app, below every handler.
    // ═════════════════════════════════════════════════════════════════════════

    /// <summary>
    /// A NULL-farm audit row belongs to its actor and to nobody else. Both
    /// directions, plus the loadability probe that makes the rejection an
    /// authorization result rather than an empty table.
    /// </summary>
    [Fact]
    public async Task A_null_farm_audit_row_is_visible_to_its_own_actor_and_to_no_other_user()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var aliceRow = await PlantAuditEventAsync(farmId: null, actorUserId: Alice,
            payload: "{\"s3Key\":\"voice/alice/clip-1.wav\"}");
        var bobRow = await PlantAuditEventAsync(farmId: null, actorUserId: Bob,
            payload: "{\"s3Key\":\"voice/bob/clip-1.wav\",\"note\":\"reviewer free text\"}");
        var systemRow = await PlantAuditEventAsync(farmId: null, actorUserId: SystemWorkerActor,
            payload: "{\"reason\":\"retention sweep\"}");

        // ── LOADABILITY. Alice can genuinely read her own NULL-farm row under
        //    the exact user-scoped posture the interceptor establishes. Without
        //    this the zero-counts below would be indistinguishable from "the
        //    insert never landed".
        var aliceSeesOwn = await CountAsAppRoleAsync(Alice, null,
            "SELECT COUNT(*) FROM ssf.audit_events WHERE \"Id\" = @id", ("id", aliceRow));
        aliceSeesOwn.Should().Be(1,
            "the row must be READABLE by its own actor first — otherwise every assertion below "
            + "is proving invisibility, not authorization");

        // ── THE CLAIM, both directions. ──────────────────────────────────────
        var aliceSeesBob = await CountAsAppRoleAsync(Alice, null,
            "SELECT COUNT(*) FROM ssf.audit_events WHERE \"Id\" = @id", ("id", bobRow));
        var bobSeesAlice = await CountAsAppRoleAsync(Bob, null,
            "SELECT COUNT(*) FROM ssf.audit_events WHERE \"Id\" = @id", ("id", aliceRow));
        var aliceSeesSystem = await CountAsAppRoleAsync(Alice, null,
            "SELECT COUNT(*) FROM ssf.audit_events WHERE \"Id\" = @id", ("id", systemRow));

        aliceSeesBob.Should().Be(0,
            "the payload of Bob's NULL-farm row carries an S3 object key for another farmer's raw "
            + "voice recording and a reviewer's free text. Before §P0.2 the policy's "
            + "`farm_id IS NULL OR ...` disjunct handed it to every tenant, by design");
        bobSeesAlice.Should().Be(0, "the same, in the other direction");
        aliceSeesSystem.Should().Be(0,
            "essentially every NULL-farm row carries a SystemActor sentinel, so an actor rule "
            + "correctly hides almost the whole cross-farm set from every human caller — that is "
            + "the intended outcome, not a side effect");

        // ── A farm-scoped row still reaches its own farm, and only it. ────────
        var farmARow = await PlantAuditEventAsync(farmId: FarmA, actorUserId: Alice, payload: "{}");
        var aliceScopedSeesFarmA = await CountAsAppRoleAsync(Alice, FarmA,
            "SELECT COUNT(*) FROM ssf.audit_events WHERE \"Id\" = @id", ("id", farmARow));
        var bobScopedSeesFarmA = await CountAsAppRoleAsync(Bob, FarmB,
            "SELECT COUNT(*) FROM ssf.audit_events WHERE \"Id\" = @id", ("id", farmARow));

        aliceScopedSeesFarmA.Should().Be(1,
            "the farm branch of the policy is UNCHANGED and must keep working — tightening the "
            + "NULL-farm branch must not quietly break farm-scoped audit reads");
        bobScopedSeesFarmA.Should().Be(0, "and it must keep isolating farms");

        output.WriteLine("[EVIDENCE] === P0.2-2 NULL-farm isolation (raw SQL as agrisync_app) ===");
        output.WriteLine($"[EVIDENCE] LOADABILITY: Alice sees her own NULL-farm row = {aliceSeesOwn} (expect 1)");
        output.WriteLine($"[EVIDENCE] Alice sees Bob's NULL-farm row                = {aliceSeesBob} (expect 0)");
        output.WriteLine($"[EVIDENCE] Bob sees Alice's NULL-farm row                = {bobSeesAlice} (expect 0)");
        output.WriteLine($"[EVIDENCE] Alice sees the SystemActor NULL-farm row      = {aliceSeesSystem} (expect 0)");
        output.WriteLine($"[EVIDENCE] Alice@FarmA sees the FarmA row                = {aliceScopedSeesFarmA} (expect 1)");
        output.WriteLine($"[EVIDENCE] Bob@FarmB   sees the FarmA row                = {bobScopedSeesFarmA} (expect 0)");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // P0.2-3 — THE ENDPOINT. Executes AuditEndpoints' own code, as agrisync_app.
    // ═════════════════════════════════════════════════════════════════════════

    /// <summary>
    /// <b>The endpoint filter, isolated.</b> <c>GET /shramsafal/audit?entityType=…
    /// &amp;entityId=…</c> is the SECOND guard, and a second guard is only worth
    /// having if it holds when the first one does not. So this fact runs the
    /// endpoint's own code against the <b>RLS-bypassing superuser connection</b>
    /// — deliberately, and stated loudly: <i>this fact is not an RLS proof.</i>
    /// Every row is visible to the query, which is exactly the loadability
    /// precondition, and the only thing that can remove one is
    /// <c>GetEntityStreamAsync</c>'s own actor/platform-admin rule.
    ///
    /// <para>The RLS half of §P0.2 is proven separately, as
    /// <c>agrisync_app</c>, in
    /// <see cref="A_null_farm_audit_row_is_visible_to_its_own_actor_and_to_no_other_user"/>
    /// and <see cref="Under_the_app_role_the_policy_and_the_endpoint_compose"/>.
    /// Neither fact substitutes for the other: the policy is the tenancy floor
    /// and the endpoint is the per-request ceiling.</para>
    /// </summary>
    [Fact]
    public async Task The_audit_endpoint_filter_holds_even_where_rls_admits_every_row()
    {
        // Deliberately NOT AssertAppRoleIsNotVacuousAsync — this fact runs as the
        // superuser ON PURPOSE and would fail that guard. It claims nothing about
        // RLS; asserting E3 here would be theatre.
        var (role, superOrBypass) = await ReadSuperuserPostureAsync();
        superOrBypass.Should().BeTrue(
            "this fact REQUIRES a bypassing role: the endpoint filter can only be proven where "
            + "the rows are visible to the query. If this connection stopped bypassing, the "
            + "assertions below would silently degrade into re-proving RLS");

        var aliceRow = await PlantAuditEventAsync(null, Alice, "{\"s3Key\":\"voice/alice/x.wav\"}", SharedEntityId);
        var bobRow = await PlantAuditEventAsync(null, Bob, "{\"s3Key\":\"voice/bob/x.wav\"}", SharedEntityId);
        var systemRow = await PlantAuditEventAsync(null, SystemWorkerActor, "{\"note\":\"pii detected\"}", SharedEntityId);

        // ── LOADABILITY. The Platform+Owner stream proves all three rows reach
        //    this exact code. Every shorter list below is therefore a filter
        //    decision, never an empty table.
        var adminStream = await CallAuditEndpointAsync(_superuserProvider!, PlatformOwner);
        adminStream.Select(e => e.Id).Should().BeEquivalentTo([aliceRow, bobRow, systemRow],
            "the Platform+Owner scope resolves through IEntitlementResolver — no claim, no "
            + "config — and reads the whole entity stream");

        var aliceStream = await CallAuditEndpointAsync(_superuserProvider!, Alice);
        aliceStream.Select(e => e.Id).Should().BeEquivalentTo([aliceRow],
            "a farmer receives her OWN NULL-farm rows and nothing else. Before §P0.2 the "
            + "membership loop skipped every row whose farm_id IS NULL, so any authenticated "
            + "caller who could name an entityType+entityId got the whole stream, payload verbatim "
            + "— including another farmer's S3 voice-recording keys");

        var bobStream = await CallAuditEndpointAsync(_superuserProvider!, Bob);
        bobStream.Select(e => e.Id).Should().BeEquivalentTo([bobRow], "the same, in the other direction");

        // ── The Platform ANALYST is NOT an audit reader. ─────────────────────
        var analystStream = await CallAuditEndpointAsync(_superuserProvider!, PlatformAnalyst);
        analystStream.Should().BeEmpty(
            "IsPlatformAdmin is Platform+Owner only, and EntitlementMatrix.Lookup denies "
            + "audit.ledger AHEAD of the blanket Platform-Analyst branch that otherwise grants "
            + "read on every module key it is asked about. The analyst authored none of these "
            + "rows, so the actor rule leaves nothing");

        output.WriteLine("[EVIDENCE] === P0.2-3 endpoint filter (RLS bypassed ON PURPOSE) ===");
        output.WriteLine($"[EVIDENCE] connection role = '{role}' rolsuper OR rolbypassrls={superOrBypass} (REQUIRED True here)");
        output.WriteLine($"[EVIDENCE] LOADABILITY: Platform+Owner stream = {adminStream.Count} rows (expect 3)");
        output.WriteLine($"[EVIDENCE] Alice   stream = {aliceStream.Count} rows (expect 1 — her own)");
        output.WriteLine($"[EVIDENCE] Bob     stream = {bobStream.Count} rows (expect 1 — his own)");
        output.WriteLine($"[EVIDENCE] Analyst stream = {analystStream.Count} rows (expect 0)");
    }

    /// <summary>
    /// <b>The two guards composed, as <c>agrisync_app</c>.</b> This is what a
    /// real farmer's request meets. It also RECORDS a consequence of the
    /// tightening that is not a defect and must not be "fixed" by reflex: a
    /// Platform+Owner reading through the ordinary application connection now
    /// sees NOTHING, because <c>p_tenant_audit_events</c> has no platform-admin
    /// escape and none was added — adding one is a WIDENING that needs its own
    /// justification, not a side effect of a containment fix. The admin ledger
    /// surface therefore requires a privileged connection, and today no product
    /// screen consumes it (<c>GET /audit</c> has zero callers in src/clients).
    /// </summary>
    [Fact]
    public async Task Under_the_app_role_the_policy_and_the_endpoint_compose()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var aliceRow = await PlantAuditEventAsync(null, Alice, "{\"s3Key\":\"voice/alice/y.wav\"}", SharedEntityId);
        var bobRow = await PlantAuditEventAsync(null, Bob, "{\"s3Key\":\"voice/bob/y.wav\"}", SharedEntityId);

        // ── LOADABILITY, from the side the policy cannot void: both rows are in
        //    the table. Read as superuser so the probe is not itself subject to
        //    the policy under test.
        await using (var read = new NpgsqlConnection(_superuserConn))
        {
            await read.OpenAsync();
            var landed = await ScalarLongAsync(read,
                "SELECT COUNT(*) FROM ssf.audit_events WHERE \"Id\" IN (@a, @b)",
                ("a", aliceRow), ("b", bobRow));
            landed.Should().Be(2, "both rows exist — so a short stream below is a decision, not an empty table");
        }

        var aliceStream = await CallAuditEndpointAsync(_rootProvider!, Alice);
        aliceStream.Select(e => e.Id).Should().BeEquivalentTo([aliceRow],
            "her own row survives BOTH guards, and Bob's survives neither");

        var bobStream = await CallAuditEndpointAsync(_rootProvider!, Bob);
        bobStream.Select(e => e.Id).Should().BeEquivalentTo([bobRow]);

        // ── The recorded consequence, asserted so it cannot drift silently. ──
        var adminStream = await CallAuditEndpointAsync(_rootProvider!, PlatformOwner);
        adminStream.Should().BeEmpty(
            "NOT a bug and NOT to be fixed here: the tightened p_tenant_audit_events has no "
            + "platform-admin escape, so on the ordinary agrisync_app connection even a "
            + "Platform+Owner reads nothing. Adding an admin SELECT policy is a WIDENING with "
            + "its own justification, and permissive policies OR together — a careless one would "
            + "re-open everything §P0.2 just closed. If this assertion ever fails, someone added "
            + "that policy; make sure it was deliberate");

        output.WriteLine("[EVIDENCE] === P0.2-3b policy + endpoint composed (as agrisync_app) ===");
        output.WriteLine($"[EVIDENCE] Alice stream          = {aliceStream.Count} rows (expect 1 — her own)");
        output.WriteLine($"[EVIDENCE] Bob   stream          = {bobStream.Count} rows (expect 1 — his own)");
        output.WriteLine($"[EVIDENCE] Platform+Owner stream = {adminStream.Count} rows (expect 0 — RLS has no admin escape; recorded, not fixed)");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // P0.2-3c — THE SQL PREDICATE. The third place the same hole was written.
    // ═════════════════════════════════════════════════════════════════════════

    /// <summary>
    /// <c>ShramSafalRepository.GetAuditEventsChangedSinceAsync(farmIds, …)</c> led
    /// with <c>!a.FarmId.HasValue ||</c>, so it returned every NULL-farm row for
    /// any farm scope the caller asked about. Nothing in production calls it
    /// today — the pull no longer reads the ledger — but it is kept, and it must
    /// be kept TIGHT for the next caller that reaches for a farm-scoped slice.
    ///
    /// <para>Runs on the RLS-bypassing connection ON PURPOSE, for the same reason
    /// as the endpoint-filter fact: the C# predicate is the guard under test, and
    /// it can only be tested where the policy is not silently doing the work.</para>
    /// </summary>
    [Fact]
    public async Task The_farm_scoped_changed_since_query_returns_no_null_farm_rows()
    {
        var (_, superOrBypass) = await ReadSuperuserPostureAsync();
        superOrBypass.Should().BeTrue(
            "this fact isolates the SQL predicate, so the rows must be visible to the query");

        var sinceUtc = DateTime.UtcNow.AddDays(-1);
        var farmARow = await PlantAuditEventAsync(FarmA, Alice, "{}");
        var nullFarmRow = await PlantAuditEventAsync(null, Bob, "{\"s3Key\":\"voice/bob/z.wav\"}");

        var rows = await RunUnderScopeAsync(_superuserProvider!, Alice, FarmA, sp =>
            sp.GetRequiredService<IShramSafalRepository>()
                .GetAuditEventsChangedSinceAsync(new[] { FarmA }, sinceUtc));

        var ids = rows.Select(r => r.Id).ToList();
        ids.Should().Contain(farmARow,
            "the LOADABILITY half: the query really does return this farm's rows, so the absence "
            + "below is the predicate and not an empty window");
        ids.Should().NotContain(nullFarmRow,
            "a farm-scoped audit request must answer with FARM rows. The `!a.FarmId.HasValue ||` "
            + "disjunct that used to lead this predicate handed every cross-farm row to every "
            + "caller regardless of which farms they named");

        output.WriteLine("[EVIDENCE] === P0.2-3c SQL predicate (RLS bypassed ON PURPOSE) ===");
        output.WriteLine($"[EVIDENCE] rows returned for farmIds=[FarmA] = {rows.Count}");
        output.WriteLine($"[EVIDENCE]   contains the FarmA row          = {ids.Contains(farmARow)} (expect True)");
        output.WriteLine($"[EVIDENCE]   contains the NULL-farm row      = {ids.Contains(nullFarmRow)} (expect False)");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // P0.2-4 — THE SYNC PULL. The surface every device hits.
    // ═════════════════════════════════════════════════════════════════════════

    /// <summary>
    /// The pull carries an EMPTY audit array — the wire field survives for old
    /// APKs whose bundled schema has it non-optional — and the operator-directory
    /// amplifier shrinks with it: a leaked <c>ActorUserId</c> used to hydrate a
    /// stranger's <c>display_name</c> out of <c>public.users</c>, which carries
    /// no RLS at all.
    /// </summary>
    [Fact]
    public async Task A_sync_pull_carries_an_empty_audit_array_and_hydrates_no_stranger_from_it()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var sinceUtc = DateTime.UtcNow.AddDays(-1);
        await PlantDailyLogAsync(FarmA, Alice);

        // Bob authors a NULL-farm audit row. Under the old policy this row —
        // and Bob's user id with it — reached Alice's device.
        var bobRow = await PlantAuditEventAsync(null, Bob, "{\"s3Key\":\"voice/bob/x.wav\"}");

        // Alice's OWN farm-scoped audit row. This one passes the RLS farm branch
        // AND the repository's farm-scoped predicate, so the ONLY thing keeping
        // it off the wire is the handler's decision not to read the ledger at
        // all. Without it this fact would be over-determined by three layers and
        // reverting the handler alone would not fail anything.
        var aliceFarmRow = await PlantAuditEventAsync(FarmA, Alice, "{}");

        // ── LOADABILITY, stated honestly. Bob's row IS in the table, and the
        //    user-scoped posture the pull runs under is the posture that used to
        //    surface it. Proven from the superuser side so the probe cannot be
        //    voided by the very policy under test.
        await using (var read = new NpgsqlConnection(_superuserConn))
        {
            await read.OpenAsync();
            var landed = await ScalarLongAsync(read,
                "SELECT COUNT(*) FROM ssf.audit_events WHERE \"Id\" IN (@a, @b)",
                ("a", bobRow), ("b", aliceFarmRow));
            landed.Should().Be(2, "both rows exist — so an empty array below is a decision, not an empty table");
        }

        // And Alice's farm row is genuinely reachable under her pull posture is
        // asserted from the query side too: the repository's farm-scoped audit
        // read returns it when asked directly.
        var reachableToRepository = await RunUnderScopeAsync(_rootProvider!, Alice, FarmA, sp =>
            sp.GetRequiredService<IShramSafalRepository>()
                .GetAuditEventsChangedSinceAsync(new[] { FarmA }, sinceUtc));
        reachableToRepository.Select(r => r.Id).Should().Contain(aliceFarmRow,
            "the farm-scoped audit read CAN still see Alice's own farm row — so its absence from "
            + "the pull response below is the handler's decision, not RLS and not the predicate");

        var response = await PullAsync(Alice, sinceUtc);

        response.AuditEvents.Should().NotBeNull(
            "the wire field must SURVIVE. APKs in farmers' hands have auditEvents non-optional in "
            + "their bundled schema; removing it risks a parse failure that breaks sync entirely");
        response.AuditEvents.Should().BeEmpty(
            "every audit row this path could ever have returned was a NULL-farm cross-tenant row: "
            + "TenantConnectionInterceptor returns in user-scoped mode BEFORE setting "
            + "agrisync.farm_id, so the policy's equality disjunct was always NULL and only the "
            + "farm_id IS NULL branch could match. There is no p_user_select_audit_events, so "
            + "farmers never received their own farm's audit rows here either");

        // ── THE AMPLIFIER. Assert it shrank; do not assume it. ───────────────
        var operatorIds = response.Operators.Select(o => o.UserId).ToList();
        operatorIds.Should().NotContain(Bob,
            "CollectOperatorIds fed leaked ActorUserIds into GetOperatorsByIdsAsync, which reads "
            + "public.users — a table with NO row level security — and returned the stranger's "
            + "display_name to the device. Emptying the audit list is what shrinks this");
        operatorIds.Should().Contain(Alice,
            "and the probe is not vacuous: operator hydration still works for the caller's own "
            + "farm, so Bob's absence is the audit fix and not a broken directory");

        // ── CS8602, and why the two reads below are in this order ─────────────
        //    `response.AuditEvents is null` is a null TEST against a member the
        //    contract declares NON-nullable (SyncPullResponseDto.AuditEvents is
        //    IReadOnlyList<AuditEventDto>). C#'s flow analysis learns from a null
        //    test, so from that expression onward the compiler treats the member
        //    as maybe-null — which made the `.Count` on the NEXT line CS8602, and
        //    ci-gate.yml's Release build runs /warnaserror, so it was an error.
        //    Read Count FIRST, while the state is still not-null, and keep the
        //    null probe afterwards. Both evidence lines print exactly what they
        //    printed before and no assertion changed. Not suppressed with `!` —
        //    the runtime null probe is deliberate (the wire field must SURVIVE,
        //    asserted above) and `!` would have asserted the opposite of what
        //    this evidence line exists to measure. DO NOT reorder these two.
        var auditEventsCount = response.AuditEvents.Count;
        var auditEventsWereNull = response.AuditEvents is null;

        output.WriteLine("[EVIDENCE] === P0.2-4 sync pull ===");
        output.WriteLine($"[EVIDENCE] response.AuditEvents is null = {auditEventsWereNull} (expect False — field kept)");
        output.WriteLine($"[EVIDENCE] response.AuditEvents count   = {auditEventsCount} (expect 0)");
        output.WriteLine($"[EVIDENCE] operators hydrated           = [{string.Join(", ", response.Operators.Select(o => o.DisplayName))}]");
        output.WriteLine($"[EVIDENCE]   contains stranger Bob      = {operatorIds.Contains(Bob)} (expect False)");
        output.WriteLine($"[EVIDENCE]   contains caller Alice      = {operatorIds.Contains(Alice)} (expect True)");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // P0.2-5 — THE WATERMARK. Removing rows changes the cursor; prove the
    //          change cannot skip data.
    // ═════════════════════════════════════════════════════════════════════════

    /// <summary>
    /// <c>ComputeNextCursor</c> used to fold <c>auditEvents.Max(OccurredAtUtc)</c>
    /// into the watermark. Dropping a term from a <c>Max</c> can only make the
    /// result SMALLER or equal, and the result is floored at the caller's
    /// <c>SinceUtc</c> — so the new cursor is never LATER than the old one and a
    /// row can only be re-delivered, never skipped. This fact pins that
    /// direction with a real audit row timestamped after every other row.
    /// </summary>
    [Fact]
    public async Task Dropping_audit_rows_moves_the_pull_cursor_earlier_and_so_can_never_skip_data()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var sinceUtc = DateTime.UtcNow.AddDays(-1);
        var logModifiedAtUtc = DateTime.UtcNow.AddMinutes(-30);
        await PlantDailyLogAsync(FarmA, Alice, modifiedAtUtc: logModifiedAtUtc);

        // An audit row an HOUR AHEAD of everything else. Under the old code this
        // single row dragged the watermark past the daily log — the failure mode
        // that makes a cursor skip data.
        //
        // NULL-farm, authored by the CALLER, on purpose. That is the exact shape
        // that used to reach a device under the old policy — and therefore the
        // exact shape that used to drag the watermark. A farm-scoped row here
        // would be invisible under BOTH the old and the new policy in
        // user-scoped mode (the interceptor sets no agrisync.farm_id), so the
        // fact could never fail and would prove nothing.
        var futureAuditAtUtc = DateTime.UtcNow.AddHours(1);
        await PlantAuditEventAsync(null, Alice, "{}", occurredAtUtc: futureAuditAtUtc);

        var response = await PullAsync(Alice, sinceUtc);

        response.NextCursorUtc.Should().BeBefore(futureAuditAtUtc,
            "the cursor must never advance past a row the response did NOT deliver. An audit row "
            + "the client never received must not move the client's watermark");
        response.NextCursorUtc.Should().BeOnOrAfter(logModifiedAtUtc,
            "and it must still advance off the rows that WERE delivered — otherwise the pull "
            + "would loop on the same window forever");
        response.NextCursorUtc.Should().BeOnOrAfter(sinceUtc,
            "the watermark is floored at the caller's own cursor, so it can never rewind below it");

        // The direction of the change, stated as the safety argument itself.
        var oldCursorWouldHaveBeen = futureAuditAtUtc;
        response.NextCursorUtc.Should().BeBefore(oldCursorWouldHaveBeen,
            "removing a term from a Max() moves the result EARLIER or leaves it equal — never "
            + "later. An earlier cursor re-reads a wider window on the next pull (at worst a "
            + "duplicate), so this change cannot skip a row");

        output.WriteLine("[EVIDENCE] === P0.2-5 watermark direction ===");
        output.WriteLine($"[EVIDENCE] caller SinceUtc               = {sinceUtc:O}");
        output.WriteLine($"[EVIDENCE] delivered daily_log modified  = {logModifiedAtUtc:O}");
        output.WriteLine($"[EVIDENCE] UNDELIVERED audit occurred_at = {futureAuditAtUtc:O}");
        output.WriteLine($"[EVIDENCE] NextCursorUtc                 = {response.NextCursorUtc:O}");
        output.WriteLine("[EVIDENCE] required: SinceUtc <= NextCursorUtc < audit occurred_at");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // TRUNCATE — the hole in the append-only guarantee.
    // ═════════════════════════════════════════════════════════════════════════

    /// <summary>
    /// <c>20260517000000_HardenAuditIntegrity</c> §169 revoked <c>UPDATE</c> and
    /// <c>DELETE</c> to make the ledger append-only and <b>never revoked
    /// <c>TRUNCATE</c></b>. One statement from the ordinary application role
    /// erased the whole ledger — and <c>TRUNCATE</c> is not a row operation, so
    /// every RLS policy on this table, including the one the rest of this class
    /// proves, was bypassed completely.
    ///
    /// <para><b>🛑 Why this fact rolls the migration back and forward instead of
    /// just asserting the end state.</b> Written the obvious way — plant a row,
    /// assert the app role cannot TRUNCATE — this fact <b>passed with the
    /// migration's <c>Up()</c> body deleted</b>. Measured, not guessed. The
    /// reason is a divergence between this scratch database and every real
    /// cluster: here the migration chain runs as the SUPERUSER, so <c>postgres</c>
    /// owns <c>ssf.audit_events</c> and <c>agrisync_app</c> receives only what
    /// <c>20260515090000_BootstrapDbRoles</c> grants — <c>SELECT, INSERT, UPDATE,
    /// DELETE</c>, and <b>never <c>TRUNCATE</c></b>. On <c>agrisync_dev_v2</c> and
    /// production the app role <i>owns</i> the table, so its ACL reads
    /// <c>agrisync_app=arDxt/agrisync_app</c> and the <c>D</c> bit is there by
    /// OWNERSHIP, not by any grant. <b>The defect does not exist in this database,
    /// so no end-state assertion here can prove it was fixed.</b>
    /// </para>
    ///
    /// <para><b>What is proven instead.</b> The fact drives EF's own migrator
    /// backward to the migration before this one — running the real
    /// <c>Down()</c>, whose <c>GRANT TRUNCATE</c> reproduces the production
    /// privilege exactly — establishes that the app role can then genuinely erase
    /// the ledger, drives the migrator forward again, and shows the same
    /// statement now raises <c>42501</c>. The before/after is produced by the
    /// migration's own SQL, so this cannot pass with <c>Up()</c> empty.</para>
    ///
    /// <para><b>Both halves are asserted, because a revoke that over-reaches is
    /// its own outage.</b> The ledger must stay writable and readable by the app
    /// role: if <c>INSERT</c> or <c>SELECT</c> broke, audit would stop recording
    /// and this fact would be the only thing that noticed.</para>
    ///
    /// <para><b>The capability is moved, not deleted</b> (founder ruling
    /// 2026-08-15). The surviving privileged path is the superuser migration role
    /// — asserted positively below, so a change that locks everyone out of lawful
    /// ledger maintenance fails here rather than at 3am. <c>agrisync_owner</c> is
    /// NOT that path and is asserted to hold nothing, because
    /// <c>HardenAuditIntegrity</c>'s docstring claims otherwise and a future
    /// reader will believe it.</para>
    ///
    /// <para><b>Safety.</b> Every [Fact] in this class gets its own scratch
    /// database (xUnit builds one instance per fact and
    /// <see cref="InitializeAsync"/> creates a fresh database), so migrating this
    /// one backward and forward touches nothing else. The loadability TRUNCATE
    /// runs inside a transaction that is always ROLLED BACK, so the planted rows
    /// survive it and the "the ledger is intact" assertion afterwards is real.</para>
    /// </summary>
    [Fact]
    public async Task The_app_role_cannot_truncate_the_audit_ledger_but_can_still_append_and_read()
    {
        await AssertAppRoleIsNotVacuousAsync();

        // ── RETARGETED, not deleted (§P0.3). The guard originally required the
        //    TRUNCATE revoke to be the LAST ShramSafal migration, because the
        //    roll-back below reverts everything after its target. A later
        //    migration has now landed (20260815061537_AddFarmBoundariesRls), so
        //    the rollback sweeps that one too and re-applies it immediately.
        //    That is reviewed and safe — AddFarmBoundariesRls is pure DDL on
        //    ssf.farm_boundaries with a symmetric Down(), touches nothing this
        //    fact asserts about ssf.audit_events, and this scratch database is
        //    created and dropped per [Fact]. The guard's job is unchanged: any
        //    UNREVIEWED migration landing after the revoke must fail here
        //    loudly rather than be silently reverted inside a security proof.
        //    Add it to the list below only after checking its Down() is safe to
        //    run mid-proof. Do not delete this guard.
        var appliedAfterRevoke = await ReadSsfMigrationsAppliedAfterAsync(RevokeTruncateMigrationId);
        appliedAfterRevoke.Should().BeSubsetOf(ReviewedMigrationsAfterRevokeTruncate,
            "this fact drives the migrator back PAST the TRUNCATE revoke and forward again, so every "
            + "migration applied after it is reverted and re-applied inside this proof. Each one must "
            + "have been reviewed for a safe Down(); retarget or extend the reviewed list — do not "
            + "delete this guard. Unreviewed: "
            + string.Join(", ", appliedAfterRevoke.Except(ReviewedMigrationsAfterRevokeTruncate)));
        var lastApplied = await ReadLastAppliedSsfMigrationAsync();

        // ── The scratch/production divergence, recorded as data so it cannot be
        //    forgotten by the next reader (see the docstring).
        var (tableOwner, tableAcl) = await ReadAuditEventsOwnerAndAclAsync();

        // ── A real row, so anything that erases the table has something to
        //    destroy and the counts below are not counts of nothing.
        var plantedRow = await PlantAuditEventAsync(farmId: FarmA, actorUserId: Alice, payload: "{}");
        var rowsBefore = await CountLedgerRowsAsSuperuserAsync();
        rowsBefore.Should().BeGreaterThan(0,
            "the ledger must hold rows for a TRUNCATE refusal to mean anything — refusing to erase "
            + "an empty table proves nothing");

        // ═════ BEFORE. Run the migration's own Down() to reproduce the shipped
        //       state: TRUNCATE granted to the ordinary application role. ═══════
        await MigrateShramSafalToAsync(MigrationBeforeRevokeTruncate);

        var appHeldTruncateBefore = await AppRoleHasPrivilegeAsync("TRUNCATE");
        appHeldTruncateBefore.Should().BeTrue(
            "LOADABILITY of the privilege itself. Down() grants TRUNCATE back, reproducing the ACL "
            + "every real cluster carries (agrisync_app=arDxt — the D bit). Without this step the "
            + "assertions after the roll-forward pass in a database where the hole never existed");

        var beforeRefusal = await TryTruncateAsAppRoleAsync();
        beforeRefusal.Should().BeNull(
            "and the privilege must be genuinely EXERCISABLE — the app role really could erase the "
            + "whole ledger in one statement, with row level security never consulted, because "
            + "TRUNCATE is not a row operation. This is the defect, executed");

        var rowsAfterRolledBackTruncate = await CountLedgerRowsAsSuperuserAsync();
        rowsAfterRolledBackTruncate.Should().Be(rowsBefore,
            "the loadability TRUNCATE ran inside a transaction that was rolled back, so the ledger "
            + "must be intact before the real assertions start");

        // ═════ AFTER. Run the migration's own Up(). ═══════════════════════════
        await MigrateShramSafalToAsync(null);

        var appHoldsTruncate = await AppRoleHasPrivilegeAsync("TRUNCATE");
        appHoldsTruncate.Should().BeFalse(
            "the revoke must take at the catalog. Revoking UPDATE/DELETE while leaving TRUNCATE is "
            + "an append-only guarantee with a hole the size of the table");

        // A catalog bit is not an enforcement proof. Issue the statement.
        var refusal = await TryTruncateAsAppRoleAsync();
        refusal.Should().NotBeNull(
            "the application role must be REFUSED, not merely un-granted on paper");
        refusal!.SqlState.Should().Be("42501",
            "insufficient_privilege — the refusal must come from the privilege system. Any other "
            + "SQLSTATE (a foreign-key complaint, a lock timeout) would mean the statement was "
            + "ALLOWED and failed for an incidental reason another cluster might not have");

        var rowsAfter = await CountLedgerRowsAsSuperuserAsync();
        rowsAfter.Should().Be(rowsBefore, "the refused TRUNCATE must have destroyed nothing");

        // ── THE OTHER HALF. Ordinary append + read still work, or the fix is
        //    an outage wearing a security fix's clothes.
        var appendedId = Guid.NewGuid();
        var appended = await ExecuteAsAppRoleAsync(Alice, FarmA, """
            INSERT INTO ssf.audit_events
                ("Id", farm_id, entity_type, entity_id, action, actor_user_id, actor_role,
                 payload, occurred_at_utc, client_command_id, app_version, device_id, ip_hash)
            VALUES (@id, @farm, @etype, @eid, 'Retained', @actor, 'worker',
                    '{}', NOW(), NULL, 'test', 'test-device', 'sha256:test');
            """,
            ("id", appendedId), ("farm", FarmA), ("etype", SharedEntityType), ("eid", Guid.NewGuid()),
            ("actor", Alice));

        appended.Should().Be(1,
            "INSERT is the ledger's whole purpose — a revoke that also took the append is a silent "
            + "stop to audit recording, which is worse than the hole it closed");

        var readBack = await CountAsAppRoleAsync(Alice, FarmA,
            "SELECT COUNT(*) FROM ssf.audit_events WHERE \"Id\" = @id", ("id", appendedId));
        readBack.Should().Be(1, "and SELECT must still return the row the app role just wrote");

        // ── The capability is MOVED, not deleted. ────────────────────────────
        var (privilegedRole, privilegedIsSuper, privilegedHoldsTruncate) =
            await ReadPrivilegedMaintenancePathAsync();

        privilegedIsSuper.Should().BeTrue(
            "the deliberate privileged maintenance path is the SUPERUSER migration role — the role "
            + "migrations run as. No new role was invented for this and none should be");
        privilegedHoldsTruncate.Should().BeTrue(
            "the ruling was 'revoke from the normal application role while PRESERVING deliberate "
            + "privileged maintenance access'. A superuser bypasses every privilege check, so it "
            + "needs no grant — but assert it anyway, so a cluster whose migration role stops being "
            + "privileged fails here instead of leaving no lawful maintenance path at all");

        // agrisync_owner is NOT that path, despite HardenAuditIntegrity saying so.
        var ownerHoldsTruncate = await RoleHasPrivilegeAsync("agrisync_owner", "TRUNCATE");
        var ownerHoldsDelete = await RoleHasPrivilegeAsync("agrisync_owner", "DELETE");
        ownerHoldsTruncate.Should().BeFalse(
            "recorded, not fixed: 20260517000000_HardenAuditIntegrity's docstring claims 'the owner "
            + "role (agrisync_owner) retains UPDATE/DELETE'. It does not — on agrisync_dev_v2 "
            + "ssf.audit_events is owned by agrisync_app; only the SCHEMA was reassigned to "
            + "agrisync_owner, which holds nothing on this table anywhere");
        ownerHoldsDelete.Should().BeFalse("the same claim, on the privilege it was actually made about");

        output.WriteLine("[EVIDENCE] === TRUNCATE revoke on ssf.audit_events ===");
        output.WriteLine($"[EVIDENCE] last applied SSF migration                   = {lastApplied}");
        output.WriteLine($"[EVIDENCE] scratch-db ssf.audit_events owner            = {tableOwner}");
        output.WriteLine($"[EVIDENCE] scratch-db ssf.audit_events acl              = {tableAcl}");
        output.WriteLine("[EVIDENCE]   (real clusters: owner=agrisync_app, acl=agrisync_app=arDxt/agrisync_app)");
        output.WriteLine($"[EVIDENCE] planted row                                  = {plantedRow}");
        output.WriteLine($"[EVIDENCE] rows before                                  = {rowsBefore} (must be > 0)");
        output.WriteLine("[EVIDENCE] --- after Down(): the shipped, holed state ---");
        output.WriteLine($"[EVIDENCE] has_table_privilege(agrisync_app, TRUNCATE)  = {appHeldTruncateBefore} (expect True)");
        output.WriteLine($"[EVIDENCE] TRUNCATE as agrisync_app                     = {(beforeRefusal is null ? "SUCCEEDED (rolled back)" : beforeRefusal.SqlState)} (expect SUCCEEDED)");
        output.WriteLine($"[EVIDENCE] rows still present after rollback            = {rowsAfterRolledBackTruncate} (expect {rowsBefore})");
        output.WriteLine("[EVIDENCE] --- after Up(): the fix ---");
        output.WriteLine($"[EVIDENCE] has_table_privilege(agrisync_app, TRUNCATE)  = {appHoldsTruncate} (expect False)");
        output.WriteLine($"[EVIDENCE] TRUNCATE as agrisync_app -> SQLSTATE         = {refusal.SqlState} (expect 42501)");
        output.WriteLine($"[EVIDENCE] rows after refused TRUNCATE                  = {rowsAfter} (expect {rowsBefore})");
        output.WriteLine($"[EVIDENCE] INSERT as agrisync_app -> rows affected      = {appended} (expect 1)");
        output.WriteLine($"[EVIDENCE] SELECT as agrisync_app -> rows read back     = {readBack} (expect 1)");
        output.WriteLine($"[EVIDENCE] privileged path: role='{privilegedRole}' rolsuper={privilegedIsSuper} TRUNCATE={privilegedHoldsTruncate}");
        output.WriteLine($"[EVIDENCE] agrisync_owner TRUNCATE={ownerHoldsTruncate} DELETE={ownerHoldsDelete} (both expect False)");
    }

    private const string RevokeTruncateMigrationId = "20260815052139_RevokeTruncateOnAuditEvents";
    private const string MigrationBeforeRevokeTruncate = "20260814214715_TightenAuditEventsTenantPolicyUsing";

    /// <summary>
    /// ShramSafal migrations that land AFTER the TRUNCATE revoke and have been
    /// reviewed as safe to revert and re-apply inside this proof (symmetric
    /// <c>Down()</c>, no dependency on <c>ssf.audit_events</c> state).
    ///
    /// <para>
    /// <b>What "safe" means here, and what it does NOT mean.</b> Every entry
    /// below is a claim about ONE situation: reverting and immediately
    /// re-applying this migration inside a per-<c>[Fact]</c> scratch database
    /// that is created in <see cref="InitializeAsync"/> and dropped in
    /// <see cref="DisposeAsync"/>, seeded only with the handful of rows this
    /// class plants. It is <b>not</b> a claim that the <c>Down()</c> is safe to
    /// run anywhere else, and specifically not on production.
    /// <b>ALL FOUR <c>Down()</c>s below are unsafe on a populated production
    /// database</b>, in three different ways:
    /// <list type="bullet">
    /// <item><c>AddFarmBoundariesRls</c> — <b>security regression, not data
    /// loss.</b> Its <c>Down()</c> drops the tenant policy and DISABLES row
    /// level security on <c>ssf.farm_boundaries</c>, leaving the table
    /// cross-tenant readable. It destroys no rows, which is exactly why it is
    /// the easiest of the four to wave through.</item>
    /// <item><c>StripTranscriptFromCorrectionEvents</c> — lossy, and under a
    /// non-superuser runner it aborts partway instead. See its entry.</item>
    /// <item><c>AddCostEntryDirectionAndLineDetail</c> — drops seven columns of
    /// real data (<c>direction</c>, <c>quantity</c>, <c>unit_price</c>,
    /// <c>vendor_name</c> and three more). Symmetric in SCHEMA only.</item>
    /// <item><c>AddRawBlobSubjects</c> — drops the table, one-way. See its
    /// entry.</item>
    /// </list>
    /// Do not lift a line out of this list and read it as a rollback approval.
    /// </para>
    ///
    /// <para>
    /// <b>Why the list keeps needing extension.</b> EF's migrator is linear, so
    /// driving back to <see cref="MigrationBeforeRevokeTruncate"/> necessarily
    /// reverts everything applied after it. There is no way to exempt a
    /// migration from the sweep, so retargeting the proof cannot remove this
    /// tax — the review is the mechanism, and the guard exists to force it.
    /// If a future <c>Down()</c> is genuinely NOT safe to run mid-proof, the
    /// answer is to change that migration or move the proof, never to widen
    /// this list.
    /// </para>
    /// </summary>
    private static readonly string[] ReviewedMigrationsAfterRevokeTruncate =
    [
        // §P0.3 — ENABLE + FORCE RLS and one tenant policy on
        // ssf.farm_boundaries. Down() drops the policy and disables RLS. Safe
        // mid-proof (nothing here reads farm_boundaries); a SECURITY REGRESSION
        // on production — see the list in this field's docstring.
        "20260815061537_AddFarmBoundariesRls",

        // ── Reviewed 2026-08-15 (spec: FINAL_SERVER_AUTHORITATIVE_EXECUTION_PLAN,
        //    audit-guard-review). Each Down() below was read in full, not
        //    name-matched. The common ground for all three: the SQL this class
        //    executes touches ssf.audit_events, ssf.farms, public.users and
        //    ssf.daily_logs and NOTHING else, so every table these three
        //    migrations write is EMPTY here.
        //    TO RE-VERIFY THAT: search this file for correction_events,
        //    cost_entries, ai_jobs, raw_blob_index or raw_blob_subjects
        //    EXCLUDING comment lines — e.g.
        //      grep -nE "correction_events|cost_entries|ai_jobs|raw_blob" \
        //        AuditEventIsolationRealPostgresTests.cs | grep -v "^[0-9]*: *//"
        //    — and expect zero hits. A plain grep now returns the prose in this
        //    very block, which is why the filter is part of the recipe.
        //    Each Up() also already ran once against this same database as this
        //    same role during InitializeAsync, so the roll-forward is a replay of
        //    statements known to succeed in this exact environment.

        // §P0.4 — Down() UPDATEs ssf.correction_events.original_parse_id to the
        // all-zero uuid WHERE NULL, restores NOT NULL, drops prompt_content_hash.
        // SAFE MID-PROOF: the table is empty, so the UPDATE matches no rows, the
        // SET NOT NULL cannot fail on a leftover NULL, and the dropped column
        // carries no data. Roll-forward re-creates the stripper function, re-runs
        // the redaction UPDATE and its refuse-if-any-leftovers EXCEPTION check
        // against the same empty table — a no-op both times — then drops the
        // function again. Its FORCE-RLS lift on correction_events is symmetric
        // (lifted and restored in the same statement). Touches no audit_events.
        // ⚠️ NOT SAFE ON A POPULATED DATABASE — and it fails DIFFERENTLY
        // depending on who runs it. A deploy engineer needs both mechanisms.
        //   • SUPERUSER runner: RLS is bypassed, so the UPDATE matches and the
        //     rollback COMPLETES LOSSILY. It stamps '00000000-…' over genuine
        //     NULLs, and Up() only does DROP NOT NULL (Up():71) — it never
        //     restores them. A Down()→Up() cycle therefore PERMANENTLY converts
        //     an honest "no originating AiJob" into a value that reads like a
        //     real link. That is the more dangerous of the two outcomes,
        //     because it succeeds.
        //   • NON-SUPERUSER owner-role runner: ssf.correction_events is FORCE
        //     ROW LEVEL SECURITY and Down(), UNLIKE Up(), never lifts FORCE.
        //     With agrisync.user_id unset the policy matches no rows, so the
        //     UPDATE clears nothing and the following SET NOT NULL ABORTS — DDL
        //     validation scans are not RLS-filtered, so it sees the NULLs the
        //     UPDATE could not reach. The rollback HARD-FAILS PART-WAY.
        //     This is not the unlikely path: the AddRawBlobSubjects entry below
        //     records that startup migrates ssfContext on the RUNTIME
        //     connection, so a non-superuser runner is at least as likely.
        // Neither outcome is a reason to change this migration for the sake of
        // this proof; both are reasons not to run its Down() on production.
        "20260815080242_StripTranscriptFromCorrectionEvents",

        // §P0.5 — the genuinely boring one. Up() adds seven NULLABLE columns to
        // ssf.cost_entries (client_attachment_ids_json, direction, payment_mode,
        // quantity, unit, unit_price, vendor_name); Down() drops exactly those
        // seven. No backfill, no constraint, no default, no policy, no grant, no
        // function. SAFE MID-PROOF: the table is empty so the drop discards
        // nothing, and every column being nullable means the roll-forward needs
        // no default and forces no table rewrite. Touches no audit_events.
        // On a populated database this Down() would drop real column data — but
        // it is symmetric in SCHEMA, which is all this proof replays.
        "20260815081057_AddCostEntryDirectionAndLineDetail",

        // §P0.9 — THE ONE THAT DROPS A TABLE. Down() is
        //   DROP POLICY IF EXISTS p_user_raw_blob_subjects ON ssf.raw_blob_subjects;
        //   DROP TABLE ssf.raw_blob_subjects;
        // so it gets the longest note, not the shortest.
        //
        // WHY THE DESTRUCTIVE Down() IS IRRELEVANT HERE — stated, not assumed.
        // The production hazard is real and was flagged when this migration was
        // reviewed: ssf.raw_blob_subjects is the (sha256 -> user_id) linkage, and
        // for any blob whose ssf.ai_jobs row has already been deleted, its
        // linkage row is the LAST REMAINING POINTER to whose voice recording
        // those bytes are. Dropping the table destroys that pointer, and Up()'s
        // backfill provably cannot rebuild it — the backfill reads ai_jobs, and
        // the ai_jobs row is precisely what is already gone. On production that
        // Down() is one-way.
        // None of that can happen in this database. The table is EMPTY: this
        // class never writes it, and the Up() backfill that would have populated
        // it read zero rows because ssf.ai_jobs and ssf.raw_blob_index are empty
        // here too. Zero linkage rows, zero blobs, zero data subjects — the DROP
        // destroys nothing and there is no person whose ownership record is lost.
        // The scratch database is dropped wholesale minutes later regardless.
        // DEPENDENCIES: nothing depends on this table. Its only FK
        // (fk_raw_blob_subjects_sha256) points OUTWARD — raw_blob_subjects is the
        // referencing child of ssf.raw_blob_index — so DropTable needs no CASCADE
        // and leaves raw_blob_index untouched. It is also the newest ShramSafal
        // migration, so nothing later references it.
        // ROLL-FORWARD: Up() re-creates the table + index, re-runs its
        // role-guarded GRANT block, re-runs the backfill (0 in, 0 out; its RAISE
        // NOTICE reports 0 of 0 and it raises no EXCEPTION), and re-establishes
        // ENABLE + FORCE RLS and the policy Down() dropped.
        // ⚠️ WHICH BACKFILL BRANCH THIS PROOF HAS ACTUALLY RUN — read before
        // citing this fact as evidence for a P0.9 deploy.
        // Up()'s backfill lifts FORCE RLS on ssf.ai_jobs and ssf.raw_blob_index
        // ONLY when the migration runner cannot bypass RLS, taking an ACCESS
        // EXCLUSIVE lock on both, held to COMMIT, while it does.
        // THIS SUITE ONLY EVER RUNS THE BYPASS BRANCH — the cheap one that takes
        // no lock — and it cannot run the other, because this [Fact] requires a
        // superuser migrator: ReadPrivilegedMaintenancePathAsync reads
        // _superuserConn and the assertion above demands rolsuper = true, while
        // AssertAppRoleIsNotVacuousAsync demands rolsuper OR rolbypassrls = false
        // for agrisync_app. Both cannot hold of one role, so a run whose migrator
        // is agrisync_app fails this fact rather than exercising the lock path.
        // (Measured: with REQUIRES_POSTGRES_ROOT_CONN unset the resolver falls
        // back to appsettings.Development.json's agrisync_app and this fact does
        // not even reach that assertion — it fails in InitializeAsync with 28P01.)
        // So: the locking branch is UNEXERCISED here, by anyone, in any
        // environment. Nothing in this repository has observed it run. The
        // migration's own comment — "WHICH BRANCH PRODUCTION TAKES IS UNKNOWN.
        // Do not assume the cheap one." — stands undiminished by this test, and
        // must not be read as softened by it.
        // The lift itself is symmetric (FORCE restored inside the same DO block),
        // and on the single-session scratch database the bypass branch that does
        // run is harmless.
        "20260815102440_AddRawBlobSubjects",
    ];

    /// <summary>
    /// Every applied ShramSafal migration that sorts after <paramref name="migrationId"/>,
    /// asked through EF so the history-table location is not hardcoded.
    /// </summary>
    private async Task<List<string>> ReadSsfMigrationsAppliedAfterAsync(string migrationId)
    {
        var opts = new DbContextOptionsBuilder<ShramSafalDbContext>().UseNpgsql(_superuserConn).Options;
        await using var ctx = new ShramSafalDbContext(opts);
        var applied = await ctx.Database.GetAppliedMigrationsAsync();
        return applied
            .Where(m => string.CompareOrdinal(m, migrationId) > 0)
            .OrderBy(m => m, StringComparer.Ordinal)
            .ToList();
    }

    /// <summary>
    /// Drives EF's own migrator on the ShramSafal context. <c>null</c> means
    /// "forward to latest". Runs on the superuser connection — the same role the
    /// real migration runner uses.
    /// </summary>
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
    /// Asked through EF, not through a hardcoded history table: the scratch
    /// database uses the DEFAULT <c>public."__EFMigrationsHistory"</c> (
    /// <see cref="IntegrationMigrationChain"/> sets no
    /// <c>MigrationsHistoryTable</c> for the ShramSafal context), while
    /// <c>agrisync_dev_v2</c> carries the custom <c>ssf.__ef_migrations</c>.
    /// </summary>
    private async Task<string> ReadLastAppliedSsfMigrationAsync()
    {
        var opts = new DbContextOptionsBuilder<ShramSafalDbContext>().UseNpgsql(_superuserConn).Options;
        await using var ctx = new ShramSafalDbContext(opts);
        var applied = await ctx.Database.GetAppliedMigrationsAsync();
        return applied.LastOrDefault() ?? string.Empty;
    }

    private async Task<(string Owner, string Acl)> ReadAuditEventsOwnerAndAclAsync()
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        var owner = Convert.ToString(await ScalarAsync(db,
            "SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid = 'ssf.audit_events'::regclass")) ?? "?";
        var acl = Convert.ToString(await ScalarAsync(db,
            "SELECT COALESCE(relacl::text, '(default — owner only)') FROM pg_class "
            + "WHERE oid = 'ssf.audit_events'::regclass")) ?? "?";
        return (owner, acl);
    }

    private async Task<long> CountLedgerRowsAsSuperuserAsync()
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        return await ScalarLongAsync(db, "SELECT COUNT(*) FROM ssf.audit_events");
    }

    /// <summary>
    /// Issues <c>TRUNCATE ssf.audit_events</c> as <c>agrisync_app</c> inside a
    /// transaction that is ALWAYS rolled back. Returns the refusal, or
    /// <c>null</c> when the statement was allowed — which is the answer the
    /// loadability half needs, and the one the fixed state must never give.
    /// </summary>
    private async Task<PostgresException?> TryTruncateAsAppRoleAsync()
    {
        await using var db = new NpgsqlConnection(_appConn);
        await db.OpenAsync();
        await using var tx = await db.BeginTransactionAsync();
        try
        {
            await using var cmd = db.CreateCommand();
            cmd.CommandText = "TRUNCATE TABLE ssf.audit_events";
            await cmd.ExecuteNonQueryAsync();
            return null;
        }
        catch (PostgresException ex)
        {
            return ex;
        }
        finally
        {
            await tx.RollbackAsync();
        }
    }

    /// <summary>
    /// Reads the surviving privileged maintenance path: the role migrations run
    /// as. Returns its name, whether it is a superuser, and whether it can
    /// TRUNCATE the ledger.
    /// </summary>
    private async Task<(string Role, bool IsSuperuser, bool HoldsTruncate)>
        ReadPrivilegedMaintenancePathAsync()
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        var role = Convert.ToString(await ScalarAsync(db, "SELECT current_user")) ?? string.Empty;
        var isSuper = Convert.ToBoolean(await ScalarAsync(db,
            "SELECT rolsuper FROM pg_roles WHERE rolname = current_user"));
        var holdsTruncate = Convert.ToBoolean(await ScalarAsync(db,
            "SELECT has_table_privilege(current_user, 'ssf.audit_events', 'TRUNCATE')"));
        return (role, isSuper, holdsTruncate);
    }

    /// <summary>
    /// Asks the app role about its OWN privilege, on the app connection — so the
    /// answer cannot be a superuser's view of somebody else's catalog row.
    /// </summary>
    private async Task<bool> AppRoleHasPrivilegeAsync(string privilege)
    {
        await using var db = new NpgsqlConnection(_appConn);
        await db.OpenAsync();
        return Convert.ToBoolean(await ScalarAsync(db,
            "SELECT has_table_privilege(current_user, 'ssf.audit_events', @p)", ("p", privilege)));
    }

    private async Task<bool> RoleHasPrivilegeAsync(string role, string privilege)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        return Convert.ToBoolean(await ScalarAsync(db,
            "SELECT has_table_privilege(@r, 'ssf.audit_events', @p)", ("r", role), ("p", privilege)));
    }

    /// <summary>
    /// Runs a statement as <c>agrisync_app</c> under the GUC posture the
    /// interceptor establishes, and returns rows affected. Mirrors
    /// <see cref="CountAsAppRoleAsync"/> for the write side.
    /// </summary>
    private async Task<int> ExecuteAsAppRoleAsync(
        Guid callerUserId, Guid? farmScopeId, string sql, params (string Name, object Value)[] args)
    {
        await using var db = new NpgsqlConnection(_appConn);
        await db.OpenAsync();
        await using var tx = await db.BeginTransactionAsync();
        await SetGucAsync(db, "agrisync.user_id", callerUserId);
        if (farmScopeId is { } farmId)
        {
            await SetGucAsync(db, "agrisync.farm_id", farmId);
        }

        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in args)
        {
            cmd.Parameters.AddWithValue(name, value);
        }

        var affected = await cmd.ExecuteNonQueryAsync();
        await tx.CommitAsync();
        return affected;
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
    /// The mirror image of the E3 guard, for the one fact that REQUIRES a
    /// bypassing role. Asserting it positively stops that fact quietly turning
    /// into a duplicate RLS test if the connection wiring ever changes.
    /// </summary>
    private async Task<(string Role, bool SuperOrBypass)> ReadSuperuserPostureAsync()
    {
        await using var check = new NpgsqlConnection(_superuserConn);
        await check.OpenAsync();
        var role = Convert.ToString(await ScalarAsync(check, "SELECT current_user")) ?? string.Empty;
        var superOrBypass = Convert.ToBoolean(await ScalarAsync(check, RoleVacuityGuardSql));
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
    // Running real application code as agrisync_app under the exact GUC posture
    // the interceptor establishes. `farmScopeId` is null for user-scoped mode —
    // TenantConnectionInterceptor's user-scoped branch sets ONLY agrisync.user_id
    // and returns before touching agrisync.farm_id, which is precisely why the
    // audit stream on /sync/pull was 100% NULL-farm.
    // ═════════════════════════════════════════════════════════════════════════

    private Task<T> RunUnderScopeAsync<T>(
        Guid callerUserId, Guid? farmScopeId, Func<IServiceProvider, Task<T>> body)
        => RunUnderScopeAsync(_rootProvider!, callerUserId, farmScopeId, body);

    private async Task<T> RunUnderScopeAsync<T>(
        ServiceProvider provider, Guid callerUserId, Guid? farmScopeId, Func<IServiceProvider, Task<T>> body)
    {
        await using var scope = provider.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        var ctx = sp.GetRequiredService<ShramSafalDbContext>();
        var tenant = sp.GetRequiredService<TenantContext>();

        // Admin-elevate so the interceptor no-ops (no per-command SET LOCAL
        // prepend), then set the GUCs ourselves inside the ambient transaction —
        // the prod-proven technique RlsIdentityScope encapsulates.
        tenant.ElevateToAdminCrossTenant();

        await using var tx = await ctx.Database.BeginTransactionAsync();
        await ctx.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('agrisync.user_id', {callerUserId.ToString()}, true)");
        if (farmScopeId is { } farmId)
        {
            await ctx.Database.ExecuteSqlInterpolatedAsync(
                $"SELECT set_config('agrisync.farm_id', {farmId.ToString()}, true)");
        }

        var result = await body(sp);
        await tx.CommitAsync();
        return result;
    }

    private Task<SyncPullResponseDto> PullAsync(Guid callerUserId, DateTime sinceUtc)
        => RunUnderScopeAsync(callerUserId, null, async sp =>
        {
            var handler = sp.GetRequiredService<PullSyncChangesHandler>();
            var result = await handler.HandleAsync(new PullSyncChangesQuery(sinceUtc, callerUserId));
            result.IsSuccess.Should().BeTrue(
                $"the pull must succeed for the proof to mean anything; error = {result.Error?.Code}");
            return result.Value!;
        });

    /// <summary>
    /// Calls the endpoint's OWN code path. A test that re-implements the filter
    /// would prove only that the test agrees with itself.
    /// </summary>
    private Task<List<AuditEventDto>> CallAuditEndpointAsync(ServiceProvider provider, Guid callerUserId)
        => RunUnderScopeAsync(provider, callerUserId, null, async sp =>
        {
            var http = new DefaultHttpContext
            {
                RequestServices = sp,
                User = new ClaimsPrincipal(new ClaimsIdentity(
                    [new Claim(ClaimTypes.NameIdentifier, callerUserId.ToString())], "test")),
            };

            var result = await AuditEndpoints.GetEntityStreamAsync(
                SharedEntityType,
                SharedEntityId,
                callerUserId,
                http,
                sp.GetRequiredService<IShramSafalRepository>(),
                sp.GetRequiredService<IEntitlementResolver>(),
                CancellationToken.None);

            result.Should().BeOfType<Ok<List<AuditEventDto>>>(
                "the entity branch answers 200 with the filtered stream — a non-admin gets a "
                + "FILTERED 200, never a 403 about admin membership they never asked for");
            return ((Ok<List<AuditEventDto>>)result).Value!;
        });

    // ═════════════════════════════════════════════════════════════════════════
    // Raw SQL as agrisync_app. set_config(..., true) is transaction-local, so
    // every one of these opens an explicit transaction.
    // ═════════════════════════════════════════════════════════════════════════

    private async Task<long> CountAsAppRoleAsync(
        Guid callerUserId, Guid? farmScopeId, string sql, params (string Name, object Value)[] args)
    {
        await using var db = new NpgsqlConnection(_appConn);
        await db.OpenAsync();
        await using var tx = await db.BeginTransactionAsync();
        await SetGucAsync(db, "agrisync.user_id", callerUserId);
        if (farmScopeId is { } farmId)
        {
            await SetGucAsync(db, "agrisync.farm_id", farmId);
        }

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

    private async Task<string> ReadPolicyExprAsync(NpgsqlConnection db, string which)
    {
        var column = which == "using" ? "qual" : "with_check";
        return Convert.ToString(await ScalarAsync(db,
            $"SELECT {column} FROM pg_policies WHERE schemaname='ssf' AND tablename='audit_events' "
            + "AND policyname='p_tenant_audit_events'")) ?? "(null)";
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Plant helpers — always SUPERUSER, so the plant can never be the proof.
    // ═════════════════════════════════════════════════════════════════════════

    /// <summary>
    /// The real <c>SystemActor.Worker</c> sentinel. Almost every NULL-farm row in
    /// production carries one of these, which is why an actor rule correctly
    /// hides essentially the whole cross-farm set from every human caller.
    /// </summary>
    private static readonly Guid SystemWorkerActor = SystemActor.Worker;

    private async Task<Guid> PlantAuditEventAsync(
        Guid? farmId,
        Guid actorUserId,
        string payload,
        Guid? entityId = null,
        DateTime? occurredAtUtc = null)
    {
        var id = Guid.NewGuid();
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.audit_events
                ("Id", farm_id, entity_type, entity_id, action, actor_user_id, actor_role,
                 payload, occurred_at_utc, client_command_id, app_version, device_id, ip_hash)
            VALUES (@id, @farm, @etype, @eid, 'Retained', @actor, 'worker',
                    @payload, @occurred, NULL, 'test', 'test-device', 'sha256:test');
            """;
        cmd.Parameters.AddWithValue("id", id);
        cmd.Parameters.AddWithValue("farm", (object?)farmId ?? DBNull.Value);
        cmd.Parameters.AddWithValue("etype", SharedEntityType);
        cmd.Parameters.AddWithValue("eid", entityId ?? Guid.NewGuid());
        cmd.Parameters.AddWithValue("actor", actorUserId);
        cmd.Parameters.AddWithValue("payload", payload);
        cmd.Parameters.AddWithValue("occurred", occurredAtUtc ?? DateTime.UtcNow);
        await cmd.ExecuteNonQueryAsync();
        return id;
    }

    private async Task<Guid> PlantDailyLogAsync(Guid farmId, Guid operatorUserId, DateTime? modifiedAtUtc = null)
    {
        var id = Guid.NewGuid();
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.daily_logs
                ("Id", farm_id, plot_id, crop_cycle_id, plot_ids, scope, operator_user_id,
                 log_date, created_at_utc, modified_at_utc, source, model_version, prompt_version)
            VALUES (@id, @fid, @pid, @cid, ARRAY[@pid], 'Plot', @uid,
                    @date, @modified, @modified, 'manual', 'unknown', 'unknown');
            """;
        cmd.Parameters.AddWithValue("id", id);
        cmd.Parameters.AddWithValue("fid", farmId);
        cmd.Parameters.AddWithValue("pid", PlotA);
        cmd.Parameters.AddWithValue("cid", CycleA);
        cmd.Parameters.AddWithValue("uid", operatorUserId);
        cmd.Parameters.AddWithValue("date", new DateOnly(2026, 8, 14));
        cmd.Parameters.AddWithValue("modified", modifiedAtUtc ?? DateTime.UtcNow.AddMinutes(-30));
        await cmd.ExecuteNonQueryAsync();
        return id;
    }

    private static async Task SeedUserAsync(NpgsqlConnection db, Guid userId, string phone, string displayName)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO public.users
                ("Id", phone, display_name, password_hash, credential_created_at_utc,
                 created_at_utc, is_active, auth_mode, preferred_language)
            VALUES (@id, @phone, @name, 'x', NOW(), NOW(), TRUE, 0, 'mr');
            """;
        cmd.Parameters.AddWithValue("id", userId);
        cmd.Parameters.AddWithValue("phone", phone);
        cmd.Parameters.AddWithValue("name", displayName);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task SeedOrganizationAsync(NpgsqlConnection db, Guid orgId, string name, int type)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.organizations (id, name, type, created_at_utc, is_active)
            VALUES (@id, @name, @type, NOW(), TRUE);
            """;
        cmd.Parameters.AddWithValue("id", orgId);
        cmd.Parameters.AddWithValue("name", name);
        cmd.Parameters.AddWithValue("type", type);
        await cmd.ExecuteNonQueryAsync();
    }

    private static async Task SeedOrgMembershipAsync(NpgsqlConnection db, Guid orgId, Guid userId, int role)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = """
            INSERT INTO ssf.organization_memberships
                (id, organization_id, user_id, role, added_by_user_id, joined_at_utc, is_active)
            VALUES (@id, @org, @user, @role, @user, NOW(), TRUE);
            """;
        cmd.Parameters.AddWithValue("id", Guid.NewGuid());
        cmd.Parameters.AddWithValue("org", orgId);
        cmd.Parameters.AddWithValue("user", userId);
        cmd.Parameters.AddWithValue("role", role);
        await cmd.ExecuteNonQueryAsync();
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

    private sealed class AllowAllEntitlementPolicy : IEntitlementPolicy
    {
        public Task<EntitlementDecision> EvaluateAsync(
            UserId userId, FarmId farmId, PaidFeature feature, CancellationToken ct = default)
            => Task.FromResult(new EntitlementDecision(true, EntitlementReason.Allowed, null));
    }

    private sealed class NoopAnalyticsWriter : IAnalyticsWriter
    {
        public Task EmitAsync(AnalyticsEvent analyticsEvent, CancellationToken cancellationToken = default)
            => Task.CompletedTask;

        public Task EmitManyAsync(IEnumerable<AnalyticsEvent> events, CancellationToken cancellationToken = default)
            => Task.CompletedTask;
    }
}
