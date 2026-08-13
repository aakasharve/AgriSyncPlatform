// spec: 2026-08-12-labour-phase2-server-truth-farm-context
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Application.UseCases.Memberships.ExitMembership;
using ShramSafal.Infrastructure;
using ShramSafal.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Memberships;

/// <summary>
/// <b>Leaving a farm actually removes you from it</b> — proven as
/// <c>agrisync_app</c> against real Postgres.
///
/// <para><b>The defect this suite exists to keep closed.</b>
/// <c>ExitMembershipHandler</c> read the membership through
/// <c>IShramSafalRepository.GetFarmMembershipAsync</c>, which is
/// <c>AsNoTracking()</c>. <c>Exit()</c> mutated a DETACHED object,
/// <c>SaveChangesAsync</c> wrote nothing — and the <c>MemberExited</c> audit row
/// and <c>MembershipRevoked</c> analytics event were written regardless. Two
/// harms, the second worse: the person kept their access, and history recorded a
/// departure that never happened. <c>P3</c> — "easy to correct, hard to falsify
/// history" — exactly inverted.</para>
///
/// <para><b>Why this cannot be a unit test.</b> Every in-memory
/// <c>IShramSafalRepository</c> double hands back the same object it was seeded
/// with, so the discarded mutation is "visible" to the next read and the handler
/// looks correct. Tracking is a property of the EF change tracker and only real
/// EF against a real database can answer it. The decisions around the write
/// (idempotency, the I3 refusal, refusing rather than falsifying) are tested
/// separately in <c>ShramSafal.Domain.Tests.Memberships.ExitMembershipHandlerTests</c>.</para>
///
/// <para><b>Doctrine E3.</b> Every [Fact] opens with
/// <see cref="AssertAppRoleIsNotVacuousAsync"/> — <c>SELECT rolsuper OR
/// rolbypassrls FROM pg_roles WHERE rolname = current_user</c>, required
/// <c>false</c> — on the same connection the code under test uses.
/// <see cref="InitializeAsync"/> runs it too, so no [Fact] can be reached with a
/// bypassing role.</para>
///
/// <para><b>Doctrine E4 — the database is not the whole defence, so both halves
/// are proven.</b> <c>p_user_select_memberships</c> is a PERMISSIVE
/// <c>FOR SELECT</c> policy OR-ed with the tenant policy, so a membership row a
/// caller may SEE is not a row they may WRITE. Below: the POLICY half (a raw
/// <c>UPDATE</c> as <c>agrisync_app</c> under one farm's scope cannot terminate
/// another farm's membership, with a control proving the zero was the scope) and
/// the APPLICATION half (the handler refuses a farm the caller does not belong
/// to, and the loss of access is read back through the real authorization
/// surfaces, each with a live control so a <c>false</c> cannot be vacuous).</para>
///
/// <para><b>Posture.</b> Fresh scratch database per class
/// (<c>ssf_exitmem_{Guid:N}</c>) via <see cref="IntegrationMigrationChain"/>,
/// dropped on dispose. Never <c>agrisync_dev</c>, never
/// <c>agrisync_dev_v2</c>.</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class ExitMembershipRealPostgresTests(Xunit.Abstractions.ITestOutputHelper output)
    : IAsyncLifetime
{
    private const string RoleVacuityGuardSql =
        "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user";

    private const string AppRoleUser = TestRoleCredentials.AppRoleUser;
    private static string AppRolePassword => TestRoleCredentials.AppRolePassword;

    private static readonly DateTime Now = new(2026, 8, 13, 9, 0, 0, DateTimeKind.Utc);

    // ── Farm A ────────────────────────────────────────────────────────────────
    private static readonly Guid FarmA = Guid.Parse("ea111111-1111-1111-1111-111111111111");
    private static readonly Guid AccountA = Guid.Parse("ea222222-2222-2222-2222-222222222222");
    private static readonly Guid OwnerA = Guid.Parse("ea333333-3333-3333-3333-333333333333");

    // ── Farm B ────────────────────────────────────────────────────────────────
    private static readonly Guid FarmB = Guid.Parse("eb111111-1111-1111-1111-111111111111");
    private static readonly Guid AccountB = Guid.Parse("eb222222-2222-2222-2222-222222222222");
    private static readonly Guid OwnerB = Guid.Parse("eb333333-3333-3333-3333-333333333333");

    /// <summary>
    /// A Worker who is an ACTIVE member of BOTH farms. Load-bearing twice over:
    /// it makes "loses access to A" a statement about one person rather than two
    /// unrelated rows, and it supplies the live control that stops every
    /// post-exit <c>false</c> from being vacuous.
    /// </summary>
    private static readonly Guid WorkerBoth = Guid.Parse("ec444444-4444-4444-4444-444444444444");

    private string _adminConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private string _superuserConn = string.Empty;
    private string _appConn = string.Empty;
    private ServiceProvider? _rootProvider;

    public async Task InitializeAsync()
    {
        _adminConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();

        _scratchDbName = $"ssf_exitmem_{Guid.NewGuid():N}";
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
            await SeedFarmAsync(raw, FarmA, OwnerA, AccountA, "Exit Farm A");
            await SeedMembershipAsync(raw, FarmA, OwnerA, AccountA, "PrimaryOwner");
            await SeedMembershipAsync(raw, FarmA, WorkerBoth, AccountA, "Worker");

            await SeedFarmAsync(raw, FarmB, OwnerB, AccountB, "Exit Farm B");
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
    // THE claim: the exit persists, and the person loses access.
    // ═════════════════════════════════════════════════════════════════════════

    /// <summary>
    /// The headline. Before the fix every assertion after the first would fail:
    /// the request answered success, the audit row appeared, and
    /// <c>status</c> stayed <c>Active</c>.
    /// </summary>
    [Fact]
    public async Task A_self_exit_persists_and_the_member_loses_access_to_that_farm_only()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var before = await ReadAccessAsync(WorkerBoth);
        before.MemberOfA.Should().BeTrue("the control: they genuinely have access before they leave");
        before.MemberOfB.Should().BeTrue();

        var result = await ExitAsync(FarmA, WorkerBoth);

        result.IsSuccess.Should().BeTrue();
        result.Value!.AlreadyExited.Should().BeFalse();

        // ── The row, read below the application entirely. ──
        var row = await ReadMembershipRowAsync(FarmA, WorkerBoth);
        row.Status.Should().Be(6, "6 = Exited; this is the assertion the AsNoTracking() read failed");
        row.ExitedAtUtc.Should().NotBeNull();

        // ── The real authorization surfaces, in a FRESH request scope (E4). ──
        var after = await ReadAccessAsync(WorkerBoth);
        after.MemberOfA.Should().BeFalse(
            "IsUserMemberOfFarmAsync is what ~30 handlers and endpoints ask before they read or write "
            + "a farm's records — logs, finance, attachments, audit, export, every AI entry point");
        after.RoleOnA.Should().BeNull();
        after.TenantOnA.Should().BeFalse(
            "GetFarmMembershipForTenantAsync is the gate that publishes the tenant claim; without it the "
            + "request cannot open a farm scope at all");
        after.ScopeOnA.Should().BeFalse(
            "ICallerFarmTenantScope is the SOLE authorization gate on the farm, labour, compliance and "
            + "voice endpoints");
        after.LabourGateOnA.Should().BeFalse();
        after.SyncFarmIds.Should().NotContain(FarmA, "a pull must not carry that farm's records any more");
        after.MyFarmIds.Should().NotContain(FarmA, "and the farm must leave their switcher");

        // ── The control: Farm B is untouched, so none of the above is vacuous. ──
        after.MemberOfB.Should().BeTrue();
        after.SyncFarmIds.Should().Contain(FarmB);
        after.MyFarmIds.Should().Contain(FarmB);
        (await ReadMembershipRowAsync(FarmB, WorkerBoth)).Status.Should().Be(3, "3 = Active");

        output.WriteLine("[EVIDENCE] === exit persists + access lost ===");
        output.WriteLine($"[EVIDENCE] ssf.farm_memberships(FarmA, WorkerBoth).status : 3 -> {row.Status} (6 = Exited)");
        output.WriteLine($"[EVIDENCE] exited_at_utc                                  : {row.ExitedAtUtc:O}");
        output.WriteLine($"[EVIDENCE] IsUserMemberOfFarmAsync   A/B : {after.MemberOfA} / {after.MemberOfB}");
        output.WriteLine($"[EVIDENCE] GetUserRoleForFarmAsync     A : {(object?)after.RoleOnA ?? "null"}");
        output.WriteLine($"[EVIDENCE] tenant claim resolvable     A : {after.TenantOnA}");
        output.WriteLine($"[EVIDENCE] ICallerFarmTenantScope      A : {after.ScopeOnA}");
        output.WriteLine($"[EVIDENCE] LabourManagementGate        A : {after.LabourGateOnA}");
        output.WriteLine($"[EVIDENCE] /sync/pull farm ids           : [{string.Join(", ", after.SyncFarmIds)}]");
        output.WriteLine($"[EVIDENCE] /farms/mine  farm ids         : [{string.Join(", ", after.MyFarmIds)}]");
    }

    /// <summary>
    /// The invariant that makes the ledger trustworthy: history and the row say
    /// the same thing. The original defect broke it in the worse direction — one
    /// <c>MemberExited</c> line, zero exited rows.
    /// </summary>
    [Fact]
    public async Task Every_MemberExited_line_in_history_has_an_exited_row_behind_it()
    {
        await AssertAppRoleIsNotVacuousAsync();

        (await CountMemberExitedAuditRowsAsync()).Should().Be(0);

        // One request that succeeds, one that is refused for a farm the caller
        // does not belong to, and one that is refused by invariant I3.
        (await ExitAsync(FarmA, WorkerBoth)).IsSuccess.Should().BeTrue();
        (await ExitAsync(FarmA, OwnerB)).IsFailure.Should().BeTrue("OwnerB has no membership on Farm A");
        (await ExitAsync(FarmA, OwnerA)).IsFailure.Should().BeTrue("OwnerA is Farm A's only active owner");

        var exitedRows = await CountExitedMembershipRowsAsync();
        var auditRows = await CountMemberExitedAuditRowsAsync();

        auditRows.Should().Be(1);
        exitedRows.Should().Be(auditRows,
            "an audit trail that records departures which did not happen is worse than no audit trail");

        output.WriteLine("[EVIDENCE] === history matches the rows ===");
        output.WriteLine($"[EVIDENCE] MemberExited audit rows = {auditRows}   status=Exited rows = {exitedRows}");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Idempotency — a retry is not a second departure.
    // ═════════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task Re_exiting_converges_against_real_rows_and_writes_no_second_audit_row()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var first = await ExitAsync(FarmA, WorkerBoth);
        first.IsSuccess.Should().BeTrue();
        first.Value!.AlreadyExited.Should().BeFalse();
        var firstRow = await ReadMembershipRowAsync(FarmA, WorkerBoth);

        var second = await ExitAsync(FarmA, WorkerBoth);

        second.IsSuccess.Should().BeTrue(
            "a farmer on a rural connection re-sending the same request must converge — being told "
            + "'you are not a member of this farm' about a farm they just left is a lie and a scare");
        second.Value!.AlreadyExited.Should().BeTrue();
        second.Value.MembershipId.Should().Be(first.Value.MembershipId);

        var secondRow = await ReadMembershipRowAsync(FarmA, WorkerBoth);
        secondRow.ExitedAtUtc.Should().Be(firstRow.ExitedAtUtc, "the departure happened once");
        (await CountMemberExitedAuditRowsAsync()).Should().Be(1);

        output.WriteLine("[EVIDENCE] === idempotent re-exit ===");
        output.WriteLine($"[EVIDENCE] first: alreadyExited=False   second: alreadyExited={second.Value.AlreadyExited}");
        output.WriteLine($"[EVIDENCE] exited_at_utc unchanged: {secondRow.ExitedAtUtc:O}");
        output.WriteLine($"[EVIDENCE] MemberExited audit rows: {await CountMemberExitedAuditRowsAsync()} (expect 1)");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // A farm is never left without an owner.
    // ═════════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task The_only_active_primary_owner_is_refused_and_may_leave_once_a_second_owner_exists()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var refused = await ExitAsync(FarmA, OwnerA);

        refused.IsFailure.Should().BeTrue();
        refused.Error.Code.Should().Be("exit.last_primary_owner");
        (await ReadMembershipRowAsync(FarmA, OwnerA)).Status.Should().Be(3, "the refusal wrote nothing");
        (await CountMemberExitedAuditRowsAsync()).Should().Be(0);

        // Promote a second owner, and the same request now succeeds.
        var secondOwner = Guid.Parse("ed555555-5555-5555-5555-555555555555");
        await using (var seed = new NpgsqlConnection(_superuserConn))
        {
            await seed.OpenAsync();
            await SeedMembershipAsync(seed, FarmA, secondOwner, AccountA, "PrimaryOwner");
        }

        (await ExitAsync(FarmA, OwnerA)).IsSuccess.Should().BeTrue();

        var owners = await CountActiveOwnerRowsAsync(FarmA);
        owners.Should().Be(1, "the guard's whole content is that the farm still has an active owner");

        output.WriteLine("[EVIDENCE] === invariant I3 against real rows ===");
        output.WriteLine($"[EVIDENCE] sole owner leaving : {refused.Error.Code} (row untouched, 0 audit rows)");
        output.WriteLine($"[EVIDENCE] after a second owner exists, active PrimaryOwner rows = {owners}");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // E4 — the application half and the policy half, separately.
    // ═════════════════════════════════════════════════════════════════════════

    [Fact]
    public async Task A_caller_cannot_exit_a_farm_they_do_not_belong_to_and_writes_nothing()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var forged = await ExitAsync(FarmA, OwnerB);
        forged.IsFailure.Should().BeTrue();
        forged.Error.Code.Should().Be("exit.no_membership");

        var mirror = await ExitAsync(FarmB, OwnerA);
        mirror.IsFailure.Should().BeTrue();
        mirror.Error.Code.Should().Be("exit.no_membership");

        (await CountExitedMembershipRowsAsync()).Should().Be(0);
        (await CountMemberExitedAuditRowsAsync()).Should().Be(0);

        output.WriteLine("[EVIDENCE] === foreign farm, both directions ===");
        output.WriteLine($"[EVIDENCE] OwnerB -> Farm A : {forged.Error.Code}");
        output.WriteLine($"[EVIDENCE] OwnerA -> Farm B : {mirror.Error.Code}");
    }

    /// <summary>
    /// The POLICY half, below the handler entirely: raw SQL as
    /// <c>agrisync_app</c>. A future caller that reaches the table without going
    /// through <see cref="ExitMembershipHandler"/> must still be unable to
    /// terminate another farm's membership. The control at the end is what proves
    /// the rejection was the farm scope and not a typo'd predicate — and the zero
    /// row count, rather than an error, is exactly why a handler that trusted
    /// "no exception" would report success over a write that never happened.
    /// </summary>
    [Fact]
    public async Task A_raw_exit_scoped_to_Farm_B_cannot_terminate_Farm_As_membership()
    {
        await AssertAppRoleIsNotVacuousAsync();

        const string sql = """
            UPDATE ssf.farm_memberships
            SET status = 6, exited_at_utc = NOW(), modified_at_utc = NOW()
            WHERE farm_id = @farm AND user_id = @user
            """;

        var forged = await ExecuteAsAppRoleAsync(FarmB, WorkerBoth, sql, ("farm", FarmA), ("user", WorkerBoth));
        forged.Error.Should().BeNull("RLS hides the row rather than raising — the tell is the row count");
        forged.Affected.Should().Be(0,
            "p_tenant_farm_memberships' USING clause makes Farm A's membership invisible under Farm B's "
            + "GUC, so the UPDATE matches nothing");

        (await ReadMembershipRowAsync(FarmA, WorkerBoth)).Status.Should().Be(3);

        var honest = await ExecuteAsAppRoleAsync(FarmA, WorkerBoth, sql, ("farm", FarmA), ("user", WorkerBoth));
        honest.Error.Should().BeNull();
        honest.Affected.Should().Be(1,
            "the control proves the earlier zero was the farm scope and not a broken predicate");

        output.WriteLine("[EVIDENCE] === policy half: raw UPDATE as agrisync_app ===");
        output.WriteLine($"[EVIDENCE] Farm B scope -> Farm A row : affected={forged.Affected} (expect 0)");
        output.WriteLine($"[EVIDENCE] Farm A scope -> Farm A row : affected={honest.Affected} (expect 1)");
    }

    // ═════════════════════════════════════════════════════════════════════════
    // Harness
    // ═════════════════════════════════════════════════════════════════════════

    /// <summary>
    /// Mirrors the production request for
    /// <c>POST /shramsafal/farms/{farmId}/memberships/self-exit</c>: the route is
    /// NOT on <c>TenantTransactionMiddleware</c>'s skip list and NOT user-scoped,
    /// so the middleware opens a transaction and leaves <see cref="TenantContext"/>
    /// EMPTY — no elevation, no claim, nothing. Establishing the farm scope is the
    /// handler's own first step, which is the point: replicating it here instead
    /// would prove the test, not the code.
    /// </summary>
    private async Task<Result<ExitMembershipResult>> ExitAsync(Guid farmId, Guid callerUserId)
    {
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        var ctx = sp.GetRequiredService<ShramSafalDbContext>();

        await using var tx = await ctx.Database.BeginTransactionAsync();

        var handler = new ExitMembershipHandler(
            sp.GetRequiredService<IShramSafalRepository>(),
            new FrozenClock(Now),
            new NullAnalyticsWriter(),
            sp.GetRequiredService<ICallerFarmTenantScope>());

        var result = await handler.HandleAsync(new FarmId(farmId), new UserId(callerUserId));

        // The middleware commits whenever the pipeline returns without throwing —
        // INCLUDING on a failure Result, which is a value and not an exception.
        // Committing here too is what makes the "wrote nothing" assertions
        // meaningful rather than an artefact of a rollback.
        await tx.CommitAsync();
        return result;
    }

    private sealed record AccessSnapshot(
        bool MemberOfA,
        bool MemberOfB,
        AgriSync.SharedKernel.Contracts.Roles.AppRole? RoleOnA,
        bool TenantOnA,
        bool ScopeOnA,
        bool LabourGateOnA,
        IReadOnlyList<Guid> SyncFarmIds,
        IReadOnlyList<Guid> MyFarmIds);

    /// <summary>
    /// Reads the real authorization surfaces the way a later request would.
    /// Admin-elevated with only <c>agrisync.user_id</c> set — the user-scoped read
    /// posture ADR 0019 defines and <c>GET /sync/pull</c> and
    /// <c>GET /shramsafal/farms/mine</c> actually run under. Farm B is read on the
    /// SAME connection in the same call so that every <c>false</c> about Farm A
    /// carries a live <c>true</c> beside it.
    /// </summary>
    private async Task<AccessSnapshot> ReadAccessAsync(Guid userId)
    {
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        var ctx = sp.GetRequiredService<ShramSafalDbContext>();
        var repo = sp.GetRequiredService<IShramSafalRepository>();
        var tenant = sp.GetRequiredService<TenantContext>();

        tenant.ElevateToAdminCrossTenant();
        await using var tx = await ctx.Database.BeginTransactionAsync();
        await ctx.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('agrisync.user_id', {userId.ToString()}, true)");
        await ctx.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('agrisync.farm_id', {Guid.Empty.ToString()}, true)");

        var memberA = await repo.IsUserMemberOfFarmAsync(FarmA, userId);
        var memberB = await repo.IsUserMemberOfFarmAsync(FarmB, userId);
        var roleA = await repo.GetUserRoleForFarmAsync(FarmA, userId);
        var (tenantA, _) = await repo.GetFarmMembershipForTenantAsync(FarmA, userId);
        var labourA = await LabourManagementGate.IsAllowedAsync(repo, FarmA, userId);
        var syncFarmIds = await repo.GetFarmIdsForUserAsync(userId);
        var myFarms = await repo.GetMyFarmsAsync(userId);

        await tx.CommitAsync();

        // The endpoint gate gets its own scope: EstablishForCallerAsync elevates,
        // and a scope that has already elevated cannot be re-entered cleanly.
        var scopeOnA = await CanEstablishScopeAsync(FarmA, userId);

        return new AccessSnapshot(
            memberA, memberB, roleA, tenantA, scopeOnA, labourA,
            syncFarmIds, myFarms.Select(f => f.FarmId).ToList());
    }

    private async Task<bool> CanEstablishScopeAsync(Guid farmId, Guid userId)
    {
        await using var scope = _rootProvider!.CreateAsyncScope();
        var sp = scope.ServiceProvider;
        var ctx = sp.GetRequiredService<ShramSafalDbContext>();
        await using var tx = await ctx.Database.BeginTransactionAsync();
        var result = await sp.GetRequiredService<ICallerFarmTenantScope>()
            .EstablishForCallerAsync(farmId, userId);
        await tx.RollbackAsync();
        return result.IsSuccess;
    }

    private async Task<(int Status, DateTime? ExitedAtUtc)> ReadMembershipRowAsync(Guid farmId, Guid userId)
    {
        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();
        await using var cmd = read.CreateCommand();
        cmd.CommandText = """
            SELECT status, exited_at_utc FROM ssf.farm_memberships
            WHERE farm_id = @f AND user_id = @u
            ORDER BY modified_at_utc DESC LIMIT 1
            """;
        cmd.Parameters.AddWithValue("f", farmId);
        cmd.Parameters.AddWithValue("u", userId);
        await using var reader = await cmd.ExecuteReaderAsync();
        (await reader.ReadAsync()).Should().BeTrue("the membership row must exist");
        return (reader.GetInt32(0), reader.IsDBNull(1) ? null : reader.GetDateTime(1));
    }

    private async Task<int> CountMemberExitedAuditRowsAsync()
    {
        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();
        return Convert.ToInt32(await ScalarAsync(read,
            """
            SELECT COUNT(*) FROM ssf.audit_events
            WHERE entity_type = 'FarmMembership' AND action = 'MemberExited'
            """));
    }

    private async Task<int> CountExitedMembershipRowsAsync()
    {
        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();
        return Convert.ToInt32(await ScalarAsync(read,
            "SELECT COUNT(*) FROM ssf.farm_memberships WHERE status = 6"));
    }

    private async Task<int> CountActiveOwnerRowsAsync(Guid farmId)
    {
        await using var read = new NpgsqlConnection(_superuserConn);
        await read.OpenAsync();
        return Convert.ToInt32(await ScalarAsync(read,
            """
            SELECT COUNT(*) FROM ssf.farm_memberships
            WHERE farm_id = @f AND status = 3 AND role = 'PrimaryOwner'
            """,
            ("f", farmId)));
    }

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

    /// <summary>Status 3 = Active (see <c>MembershipStatus</c>: PendingOtpClaim=1 .. Exited=6).</summary>
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

    private sealed class FrozenClock(DateTime utcNow) : IClock
    {
        public DateTime UtcNow { get; } = utcNow;
    }

    /// <summary>
    /// Analytics is emitted AFTER the unit of work commits and is not what this
    /// suite is about; a no-op keeps the assertions on the row and the ledger.
    /// </summary>
    private sealed class NullAnalyticsWriter : IAnalyticsWriter
    {
        public Task EmitAsync(AnalyticsEvent analyticsEvent, System.Threading.CancellationToken ct = default)
            => Task.CompletedTask;

        public Task EmitManyAsync(IEnumerable<AnalyticsEvent> events, System.Threading.CancellationToken ct = default)
            => Task.CompletedTask;
    }
}
