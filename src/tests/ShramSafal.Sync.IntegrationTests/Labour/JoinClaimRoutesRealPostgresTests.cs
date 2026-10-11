// spec: 2026-08-25-prod-cutover-waves
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Persistence;
using FluentAssertions;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShramSafal.Api;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Labour;

/// <summary>
/// <b>The worker half of the QR invite flow - <c>POST /shramsafal/join/claim</c> - end to
/// end, over the REAL production pipeline against real Postgres as the non-superuser
/// <c>agrisync_app</c>.</b>
///
/// <para>Before the fix the route answered HTTP 500 to every worker: the claimant is not
/// yet a member, so the route has no farm claim to publish, and
/// <c>TenantConnectionInterceptor</c> fail-closed ("no tenant claim set and not in admin
/// scope") on the handler's first DbCommand (<c>GetTokenByHashAsync</c>). The InMemory
/// handler tests cannot see it - the interceptor never fires there.</para>
///
/// <para>Doctrine E3 - vacuity guard: the host connects as <c>agrisync_app</c> and a fact
/// asserts that role is neither superuser nor BYPASSRLS, so FORCE-RLS is genuinely in
/// play for every assertion below (the membership INSERT must pass
/// <c>p_tenant_farm_memberships</c> WITH CHECK under a farm claim published only after
/// the token validated).</para>
///
/// <para>Tokens carry no expiry in the model (<c>FarmJoinToken</c> has only
/// <c>IsRevoked</c>), so "expired" is not a reachable state; rotation and revocation are.</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class JoinClaimRoutesRealPostgresTests : IAsyncLifetime
{
    private const string AppRoleUser = TestRoleCredentials.AppRoleUser;
    private static string AppRolePassword => TestRoleCredentials.AppRolePassword;

    private static readonly Guid FarmA = Guid.Parse("c9e20001-0000-0000-0000-000000000001");
    private static readonly Guid FarmB = Guid.Parse("c9e20001-0000-0000-0000-000000000002");
    private static readonly Guid AccountA = Guid.Parse("c9e20001-0000-0000-0000-0000000000c1");
    private static readonly Guid AccountB = Guid.Parse("c9e20001-0000-0000-0000-0000000000c2");
    private static readonly Guid OwnerA = Guid.Parse("c9e20001-0000-0000-0000-0000000000a1");
    private static readonly Guid OwnerB = Guid.Parse("c9e20001-0000-0000-0000-0000000000a2");
    private static readonly Guid Worker = Guid.Parse("c9e20001-0000-0000-0000-0000000000d1");
    private static readonly Guid Worker2 = Guid.Parse("c9e20001-0000-0000-0000-0000000000d2");
    private static readonly Guid RevokedBefore = Guid.Parse("c9e20001-0000-0000-0000-0000000000d3");
    private static readonly Guid ExitedBefore = Guid.Parse("c9e20001-0000-0000-0000-0000000000d4");
    private static readonly Guid Racer = Guid.Parse("c9e20001-0000-0000-0000-0000000000d5");
    private static readonly Guid ExistingMukadam = Guid.Parse("c9e20001-0000-0000-0000-0000000000b2");

    private string _rootConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private string _superuserConn = string.Empty;
    private string _appConn = string.Empty;
    private WebApplication? _app;
    private HttpClient _client = default!;

    public async Task InitializeAsync()
    {
        _rootConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();

        _scratchDbName = $"ssf_joinclaim_routes_{Guid.NewGuid():N}";
        await using (var admin = new NpgsqlConnection(_rootConn))
        {
            await admin.OpenAsync();
            await using var create = admin.CreateCommand();
            create.CommandText = $"CREATE DATABASE \"{_scratchDbName}\"";
            await create.ExecuteNonQueryAsync();
        }

        _superuserConn = new NpgsqlConnectionStringBuilder(_rootConn) { Database = _scratchDbName }.ConnectionString;
        _appConn = new NpgsqlConnectionStringBuilder(_superuserConn)
        {
            Username = AppRoleUser,
            Password = AppRolePassword,
        }.ConnectionString;

        await IntegrationMigrationChain.ApplyAsync(_superuserConn);

        // Planted as SUPERUSER: the plant must never depend on the code under test.
        await using (var raw = new NpgsqlConnection(_superuserConn))
        {
            await raw.OpenAsync();
            await SeedFarmAsync(raw, FarmA, "Join Farm A", OwnerA, AccountA, "JNA001");
            await SeedFarmAsync(raw, FarmB, "Join Farm B", OwnerB, AccountB, "JNB001");
            await SeedMembershipAsync(raw, FarmA, AccountA, OwnerA, "PrimaryOwner", 3);
            await SeedMembershipAsync(raw, FarmA, AccountA, ExistingMukadam, "Mukadam", 3);
            await SeedMembershipAsync(raw, FarmB, AccountB, OwnerB, "PrimaryOwner", 3);
            await SeedMembershipAsync(raw, FarmA, AccountA, RevokedBefore, "Worker", 5);
            await SeedMembershipAsync(raw, FarmA, AccountA, ExitedBefore, "Worker", 6);
        }

        _app = await BuildHostAsync(_appConn);
        _client = _app.GetTestClient();
    }

    public async Task DisposeAsync()
    {
        if (_app is not null)
        {
            _client.Dispose();
            await _app.StopAsync();
            await _app.DisposeAsync();
        }

        if (string.IsNullOrEmpty(_scratchDbName) || string.IsNullOrEmpty(_rootConn))
        {
            return;
        }

        try
        {
            await using var admin = new NpgsqlConnection(_rootConn);
            await admin.OpenAsync();
            await ExecAsync(admin,
                "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = @db AND pid <> pg_backend_pid()",
                ("db", _scratchDbName));
            await ExecAsync(admin, $"DROP DATABASE IF EXISTS \"{_scratchDbName}\"");
        }
        catch
        {
            // Best-effort teardown; a leaked scratch DB is harmless.
        }
    }

    [Fact]
    public async Task The_host_connects_as_a_role_that_is_neither_superuser_nor_bypassrls()
    {
        await AssertAppRoleIsNotVacuousAsync();
    }

    [Fact]
    public async Task A_valid_token_makes_the_worker_an_Active_Worker_of_THAT_farm_only_with_an_audit_row()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var invite = await IssueOkAsync(OwnerA, FarmA);

        using var claim = await ClaimAsync(Worker, invite.Token, invite.FarmCode);
        var body = await claim.Content.ReadAsStringAsync();
        claim.StatusCode.Should().Be(
            HttpStatusCode.OK,
            "a worker scanning a valid QR must be able to join - it was 500 (TenantConnectionInterceptor: "
            + $"no tenant claim set and not in admin scope) on the token lookup. body: {body}");

        using var doc = JsonDocument.Parse(body);
        doc.RootElement.GetProperty("farmId").GetGuid().Should().Be(FarmA);
        doc.RootElement.GetProperty("role").GetString().Should().Be("Worker");
        doc.RootElement.GetProperty("wasAlreadyMember").GetBoolean().Should().BeFalse();

        (await MembershipsAsync(FarmA, Worker)).Should().Equal(("Worker", 3, 3));
        (await MembershipsAsync(FarmB, Worker)).Should().BeEmpty("the token authorises farm A only");
        (await AuditCountAsync(FarmA, Worker, "MemberJoined")).Should().Be(1);
        (await AuditCountAsync(FarmB, Worker, "MemberJoined")).Should().Be(0);
    }

    [Fact]
    public async Task Claiming_again_with_the_same_token_is_idempotent_one_membership_one_audit_row()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var invite = await IssueOkAsync(OwnerA, FarmA);

        using var first = await ClaimAsync(Worker, invite.Token, invite.FarmCode);
        first.StatusCode.Should().Be(HttpStatusCode.OK, await first.Content.ReadAsStringAsync());
        using var second = await ClaimAsync(Worker, invite.Token, invite.FarmCode);
        var body = await second.Content.ReadAsStringAsync();
        second.StatusCode.Should().Be(HttpStatusCode.OK, body);

        using var doc = JsonDocument.Parse(body);
        doc.RootElement.GetProperty("wasAlreadyMember").GetBoolean().Should().BeTrue();
        (await MembershipsAsync(FarmA, Worker)).Should().HaveCount(1);
        (await AuditCountAsync(FarmA, Worker, "MemberJoined")).Should().Be(1);
    }

    [Fact]
    public async Task A_rotated_away_token_is_refused_404_and_writes_nothing_while_the_new_token_joins()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var oldInvite = await IssueOkAsync(OwnerA, FarmA);
        using var rotate = await SendAsync(HttpMethod.Post, $"/shramsafal/farms/{FarmA}/invite-qr/rotate", OwnerA);
        var rotated = ReadInvite(await rotate.Content.ReadAsStringAsync());

        using var dead = await ClaimAsync(Worker, oldInvite.Token, oldInvite.FarmCode);
        dead.StatusCode.Should().Be(HttpStatusCode.NotFound, await dead.Content.ReadAsStringAsync());
        (await MembershipsAsync(FarmA, Worker)).Should().BeEmpty();
        (await AuditCountAsync(FarmA, Worker, "MemberJoined")).Should().Be(0);

        using var live = await ClaimAsync(Worker, rotated.Token, rotated.FarmCode);
        live.StatusCode.Should().Be(HttpStatusCode.OK, await live.Content.ReadAsStringAsync());
        (await MembershipsAsync(FarmA, Worker)).Should().Equal(("Worker", 3, 3));
    }

    [Fact]
    public async Task Revoked_unknown_and_empty_tokens_get_the_identical_refusal_and_write_nothing()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var invite = await IssueOkAsync(OwnerA, FarmA);
        await RevokeTokenRowAsync(invite.Token);

        using var revoked = await ClaimAsync(Worker, invite.Token, invite.FarmCode);
        using var garbage = await ClaimAsync(Worker, "not-a-real-token-" + Guid.NewGuid().ToString("N"), invite.FarmCode);
        using var wrongCodeGarbage = await ClaimAsync(Worker, "also-not-real", "ZZZ999");

        var bodies = new List<string>();
        foreach (var response in new[] { revoked, garbage, wrongCodeGarbage })
        {
            response.StatusCode.Should().Be(HttpStatusCode.NotFound);
            bodies.Add(await response.Content.ReadAsStringAsync());
        }

        // No oracle: a revoked token, an unknown token and an unknown token with a wrong farm
        // code are indistinguishable (same status, same error code, same message).
        bodies.Distinct().Should().HaveCount(1, "revoked/unknown tokens must not be distinguishable");
        bodies[0].Should().Contain("join.token_invalid");
        (await MembershipsAsync(FarmA, Worker)).Should().BeEmpty();
        (await AuditCountAsync(FarmA, Worker, "MemberJoined")).Should().Be(0);
    }

    [Fact]
    public async Task A_token_of_farm_A_cannot_create_a_membership_on_farm_B_even_with_farm_Bs_code()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var inviteA = await IssueOkAsync(OwnerA, FarmA);
        var inviteB = await IssueOkAsync(OwnerB, FarmB);

        // Token A + farm B's code: a spliced QR. Refused; nothing written on either farm.
        using var spliced = await ClaimAsync(Worker, inviteA.Token, inviteB.FarmCode);
        spliced.StatusCode.Should().Be(HttpStatusCode.Conflict, await spliced.Content.ReadAsStringAsync());
        (await MembershipsAsync(FarmA, Worker)).Should().BeEmpty();
        (await MembershipsAsync(FarmB, Worker)).Should().BeEmpty();

        // Token A + farm A's code lands on farm A and ONLY farm A.
        using var ok = await ClaimAsync(Worker2, inviteA.Token, inviteA.FarmCode);
        ok.StatusCode.Should().Be(HttpStatusCode.OK, await ok.Content.ReadAsStringAsync());
        (await MembershipsAsync(FarmA, Worker2)).Should().HaveCount(1);
        (await MembershipsAsync(FarmB, Worker2)).Should().BeEmpty();
    }

    [Fact]
    public async Task An_unauthenticated_caller_gets_401_and_writes_nothing()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var invite = await IssueOkAsync(OwnerA, FarmA);

        using var response = await SendAsync(
            HttpMethod.Post, "/shramsafal/join/claim", userId: null, new { token = invite.Token, farmCode = invite.FarmCode });
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        (await CountMembershipsAsync(FarmA)).Should().Be(4, "only the four planted rows exist");
    }

    [Fact]
    public async Task An_existing_member_who_rescans_is_idempotent_and_keeps_their_role_no_escalation_no_downgrade()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var invite = await IssueOkAsync(OwnerA, FarmA);

        using var mukadam = await ClaimAsync(ExistingMukadam, invite.Token, invite.FarmCode);
        mukadam.StatusCode.Should().Be(HttpStatusCode.OK, await mukadam.Content.ReadAsStringAsync());
        using var owner = await ClaimAsync(OwnerA, invite.Token, invite.FarmCode);
        owner.StatusCode.Should().Be(HttpStatusCode.OK, await owner.Content.ReadAsStringAsync());

        (await MembershipsAsync(FarmA, ExistingMukadam)).Should().Equal(("Mukadam", 3, 2));
        (await MembershipsAsync(FarmA, OwnerA)).Should().Equal(("PrimaryOwner", 3, 2));
    }

    [Fact]
    public async Task Revoked_and_Exited_prior_members_PINNED_get_a_fresh_Active_Worker_row_the_terminal_row_is_kept()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var invite = await IssueOkAsync(OwnerA, FarmA);

        // Current behaviour, preserved: GetFarmMembershipAsync ignores terminal rows, so a
        // re-scan is a fresh join (QR is the sanctioned way back in); the Revoked/Exited
        // history row is not touched. Pinned so a change is a conscious one.
        foreach (var who in new[] { RevokedBefore, ExitedBefore })
        {
            using var response = await ClaimAsync(who, invite.Token, invite.FarmCode);
            response.StatusCode.Should().Be(HttpStatusCode.OK, $"{who}: {await response.Content.ReadAsStringAsync()}");
        }

        var revoked = await MembershipsAsync(FarmA, RevokedBefore);
        revoked.Select(m => (m.Role, m.Status)).Should().BeEquivalentTo(new[] { ("Worker", 5), ("Worker", 3) });
        var exited = await MembershipsAsync(FarmA, ExitedBefore);
        exited.Select(m => (m.Role, m.Status)).Should().BeEquivalentTo(new[] { ("Worker", 6), ("Worker", 3) });
    }

    [Fact]
    public async Task Concurrent_double_claim_by_the_same_user_creates_exactly_one_membership()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var invite = await IssueOkAsync(OwnerA, FarmA);

        // A worker double-tapping a QR scan fires concurrent claims with the same token. The
        // losers hit the partial unique index ix_farm_memberships_farm_user_nonterminal
        // (23505); the handler must turn that into the idempotent already-member success.
        var outcomes = await Task.WhenAll(Enumerable.Range(0, 4).Select(async _ =>
        {
            using var r = await ClaimAsync(Racer, invite.Token, invite.FarmCode);
            return (r.StatusCode, Body: await r.Content.ReadAsStringAsync());
        }));

        outcomes.Should().OnlyContain(o => o.StatusCode == HttpStatusCode.OK,
            "every racer must get 200, never a 500: " + string.Join(" | ", outcomes.Select(o => (int)o.StatusCode + " " + o.Body)));
        var flags = outcomes.Select(o =>
        {
            using var doc = JsonDocument.Parse(o.Body);
            return doc.RootElement.GetProperty("wasAlreadyMember").GetBoolean();
        }).ToList();
        flags.Count(f => !f).Should().Be(1, "exactly one racer actually created the membership");
        (await MembershipsAsync(FarmA, Racer)).Should().Equal(("Worker", 3, 3));
        (await AuditCountAsync(FarmA, Racer, "MemberJoined")).Should().Be(1);
    }

    // -- Harness ----------------------------------------------------------------

    private sealed record Invite(Guid InvitationId, Guid FarmId, string Token, string FarmCode);

    private static Invite ReadInvite(string body)
    {
        using var doc = JsonDocument.Parse(body);
        var r = doc.RootElement;
        return new Invite(
            r.GetProperty("invitationId").GetGuid(),
            r.GetProperty("farmId").GetGuid(),
            r.GetProperty("token").GetString()!,
            r.GetProperty("farmCode").GetString()!);
    }

    private async Task<Invite> IssueOkAsync(Guid caller, Guid farm)
    {
        using var response = await SendAsync(HttpMethod.Post, $"/shramsafal/farms/{farm}/invite-qr", caller);
        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.OK, body);
        return ReadInvite(body);
    }

    private Task<HttpResponseMessage> ClaimAsync(Guid caller, string token, string farmCode)
        => SendAsync(HttpMethod.Post, "/shramsafal/join/claim", caller, new { token, farmCode });

    private async Task<HttpResponseMessage> SendAsync(
        HttpMethod method, string url, Guid? userId, object? body = null)
    {
        var request = new HttpRequestMessage(method, url);
        if (userId is { } id)
        {
            request.Headers.Add("X-Test-UserId", id.ToString());
        }

        if (body is not null)
        {
            request.Content = JsonContent.Create(body);
        }

        return await _client.SendAsync(request);
    }

    private static async Task<WebApplication> BuildHostAsync(string appConn)
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
        builder.WebHost.UseTestServer();

        var storageDir = Path.Combine(Path.GetTempPath(), "agrisync-joinclaim-routes", Guid.NewGuid().ToString("N"));
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:ShramSafalDb"] = appConn,
            ["ConnectionStrings:UserDb"] = appConn,
            ["ShramSafal:Storage:DataDirectory"] = storageDir,
        });

        builder.Services
            .AddAuthentication("Test")
            .AddScheme<AuthenticationSchemeOptions, InviteTestAuthHandler>("Test", _ => { });
        builder.Services.AddAuthorization();
        builder.Services.AddBuildingBlocks();
        builder.Services.AddAnalytics(o => o.UseInMemoryDatabase($"joinclaim-routes-analytics-{Guid.NewGuid()}"));
        // The REAL production DI graph: Npgsql ShramSafalDbContext WITH the
        // TenantConnectionInterceptor, the pipeline-wrapped handlers, the real tenant scopes.
        builder.Services.AddShramSafalApi(builder.Configuration);

        var app = builder.Build();
        app.UseAuthentication();
        app.UseAuthorization();
        // Same order as Program.cs: auth, TenantTransactionMiddleware, endpoints.
        app.UseMiddleware<TenantTransactionMiddleware>();
        app.MapShramSafalApi();

        await app.StartAsync();
        return app;
    }

    private async Task<List<(string Role, int Status, int JoinedVia)>> MembershipsAsync(Guid farm, Guid user)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT role, status, joined_via FROM ssf.farm_memberships WHERE farm_id = @f AND user_id = @u ORDER BY status";
        cmd.Parameters.AddWithValue("f", farm);
        cmd.Parameters.AddWithValue("u", user);
        var rows = new List<(string, int, int)>();
        await using var reader = await cmd.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            rows.Add((reader.GetString(0), reader.GetInt32(1), reader.GetInt32(2)));
        }

        return rows;
    }

    private async Task<int> CountMembershipsAsync(Guid farm)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT count(*) FROM ssf.farm_memberships WHERE farm_id = @f";
        cmd.Parameters.AddWithValue("f", farm);
        return Convert.ToInt32(await cmd.ExecuteScalarAsync());
    }

    private async Task<int> AuditCountAsync(Guid farm, Guid actor, string action)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT count(*) FROM ssf.audit_events WHERE farm_id = @f AND actor_user_id = @a AND action = @act";
        cmd.Parameters.AddWithValue("f", farm);
        cmd.Parameters.AddWithValue("a", actor);
        cmd.Parameters.AddWithValue("act", action);
        return Convert.ToInt32(await cmd.ExecuteScalarAsync());
    }

    private async Task RevokeTokenRowAsync(string rawToken)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await ExecAsync(db,
            "UPDATE ssf.farm_join_tokens SET is_revoked = true, revoked_at_utc = NOW() WHERE raw_token = @t",
            ("t", rawToken));
    }

    private async Task AssertAppRoleIsNotVacuousAsync()
    {
        await using var db = new NpgsqlConnection(_appConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user";
        var superOrBypass = Convert.ToBoolean(await cmd.ExecuteScalarAsync());
        superOrBypass.Should().BeFalse(
            "doctrine E3 - a tenancy proof executed as a superuser or BYPASSRLS role proves nothing");
    }

    private static Task SeedFarmAsync(
        NpgsqlConnection db, Guid farm, string name, Guid owner, Guid account, string code)
        => ExecAsync(db, """
            INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status, farm_code)
            VALUES (@farm, @name, @owner, @account, NOW(), NOW(), 3.0, 'Unchecked', @code);
            """,
            ("farm", farm), ("name", name), ("owner", owner), ("account", account), ("code", code));

    private static Task SeedMembershipAsync(
        NpgsqlConnection db, Guid farm, Guid account, Guid userId, string role, int status)
        => ExecAsync(db, """
            INSERT INTO ssf.farm_memberships
                ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status, joined_via)
            VALUES (@id, @farm, @user, @role, NOW(), NOW(), @account, @status, 2);
            """,
            ("id", Guid.NewGuid()), ("farm", farm), ("user", userId), ("role", role),
            ("account", account), ("status", status));

    private static async Task ExecAsync(NpgsqlConnection db, string sql, params (string Name, object Value)[] args)
    {
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        foreach (var (name, value) in args)
        {
            cmd.Parameters.AddWithValue(name, value);
        }

        await cmd.ExecuteNonQueryAsync();
    }
}
