// spec: 2026-08-25-prod-cutover-waves
using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Encodings.Web;
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
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Npgsql;
using ShramSafal.Api;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Labour;

/// <summary>
/// <b>The two owner-only farm-invite (QR) routes, end to end, over the REAL
/// production pipeline against real Postgres as <c>agrisync_app</c>.</b>
///
/// <para><c>POST /shramsafal/farms/{farmId}/invite-qr</c> (IssueFarmInvite) and
/// <c>POST .../invite-qr/rotate</c> (RotateFarmInvite) answered <b>HTTP 500 to the
/// farm owner</b>: the pipeline authorizer runs <c>EnsureIsOwner</c>, whose first
/// DbCommand precedes any tenant claim, so <c>TenantConnectionInterceptor</c>
/// fail-closed ("no tenant claim set and not in admin scope"). Same root cause as
/// the labour-permissions routes (215c2851). The InMemory endpoint tests cannot see
/// it because the interceptor never fires there.</para>
///
/// <para>Doctrine E3 - vacuity guard: the host connects as <c>agrisync_app</c> and a
/// fact asserts that role is neither superuser nor BYPASSRLS.</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class InviteQrRoutesRealPostgresTests : IAsyncLifetime
{
    private const string AppRoleUser = TestRoleCredentials.AppRoleUser;
    private static string AppRolePassword => TestRoleCredentials.AppRolePassword;

    private static readonly Guid FarmA = Guid.Parse("c9e10001-0000-0000-0000-000000000001");
    private static readonly Guid FarmB = Guid.Parse("c9e10001-0000-0000-0000-000000000002");
    private static readonly Guid AccountA = Guid.Parse("c9e10001-0000-0000-0000-0000000000c1");
    private static readonly Guid AccountB = Guid.Parse("c9e10001-0000-0000-0000-0000000000c2");
    private static readonly Guid OwnerA = Guid.Parse("c9e10001-0000-0000-0000-0000000000a1");
    private static readonly Guid OwnerB = Guid.Parse("c9e10001-0000-0000-0000-0000000000a2");
    private static readonly Guid Mukadam = Guid.Parse("c9e10001-0000-0000-0000-0000000000b2");
    private static readonly Guid RevokedCoOwner = Guid.Parse("c9e10001-0000-0000-0000-0000000000b3");
    private static readonly Guid ExitedMukadam = Guid.Parse("c9e10001-0000-0000-0000-0000000000b4");
    private static readonly Guid Stranger = Guid.Parse("c9e10001-0000-0000-0000-0000000000f9");
    private static readonly Guid NewWorker = Guid.Parse("c9e10001-0000-0000-0000-0000000000d1");

    private string _rootConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private string _superuserConn = string.Empty;
    private string _appConn = string.Empty;
    private WebApplication? _app;
    private HttpClient _client = default!;

    public async Task InitializeAsync()
    {
        _rootConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();

        _scratchDbName = $"ssf_inviteqr_routes_{Guid.NewGuid():N}";
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
            await SeedFarmAsync(raw, FarmA, "Invite Farm A", OwnerA, AccountA, "IVA001");
            await SeedFarmAsync(raw, FarmB, "Invite Farm B", OwnerB, AccountB, "IVB001");
            await SeedMembershipAsync(raw, FarmA, AccountA, OwnerA, "PrimaryOwner", 3);
            await SeedMembershipAsync(raw, FarmA, AccountA, Mukadam, "Mukadam", 3);
            await SeedMembershipAsync(raw, FarmA, AccountA, RevokedCoOwner, "SecondaryOwner", 5);
            await SeedMembershipAsync(raw, FarmA, AccountA, ExitedMukadam, "Mukadam", 6);
            await SeedMembershipAsync(raw, FarmB, AccountB, OwnerB, "PrimaryOwner", 3);
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
    public async Task Owner_issues_the_invite_200_with_a_token_and_a_real_row()
    {
        await AssertAppRoleIsNotVacuousAsync();

        using var response = await SendAsync(HttpMethod.Post, IssueUrl(FarmA), OwnerA);
        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(
            HttpStatusCode.OK,
            "the farm owner must be able to issue the invite QR - it was 500 (TenantConnectionInterceptor: "
            + $"no tenant claim set and not in admin scope) because the route never established farm scope. body: {body}");

        var invite = ReadInvite(body);
        invite.FarmId.Should().Be(FarmA);
        invite.Token.Should().NotBeNullOrWhiteSpace();
        (await CountAsync("farm_invitations", FarmA)).Should().Be(1);
        (await CountAsync("farm_join_tokens", FarmA)).Should().Be(1);
    }

    [Fact]
    public async Task Issuing_twice_is_idempotent_and_returns_the_same_live_token()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var first = await IssueOkAsync(OwnerA, FarmA);
        var second = await IssueOkAsync(OwnerA, FarmA);

        // IssueFarmInviteHandler: an existing Active invitation + live token is returned as-is.
        second.Token.Should().Be(first.Token);
        second.InvitationId.Should().Be(first.InvitationId);
        (await CountAsync("farm_invitations", FarmA)).Should().Be(1);
        (await CountAsync("farm_join_tokens", FarmA)).Should().Be(1);
    }

    [Fact]
    public async Task Owner_rotates_200_new_token_differs_and_the_old_token_no_longer_claims()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var first = await IssueOkAsync(OwnerA, FarmA);

        using var response = await SendAsync(HttpMethod.Post, RotateUrl(FarmA), OwnerA);
        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.OK, body);
        var rotated = ReadInvite(body);

        rotated.Token.Should().NotBe(first.Token);
        rotated.InvitationId.Should().NotBe(first.InvitationId);

        // The previous QR is dead in the ledger: its token is revoked, the new one is live.
        // (Proven at the row level here; the HTTP claim of a rotated-away token is the
        // worker-claim fact below.)
        (await TokenIsRevokedAsync(first.Token)).Should().BeTrue("a rotated-away QR must stop working");
        (await TokenIsRevokedAsync(rotated.Token)).Should().BeFalse();
        (await LiveTokenCountAsync(FarmA)).Should().Be(1);

        // A subsequent plain issue returns the rotated (live) token, not the dead one.
        var again = await IssueOkAsync(OwnerA, FarmA);
        again.Token.Should().Be(rotated.Token);
    }

    // Worker half (POST /join/claim): fixed by IJoinClaimTenantScope; the full contract lives in
    // JoinClaimRoutesRealPostgresTests. This keeps the issue -> rotate -> claim chain end to end.
    [Fact]
    public async Task A_worker_who_claims_via_the_issued_or_rotated_invite_becomes_Worker_Active_on_that_farm_only()
    {
        await AssertAppRoleIsNotVacuousAsync();

        var invite = await IssueOkAsync(OwnerA, FarmA);
        using var rotate = await SendAsync(HttpMethod.Post, RotateUrl(FarmA), OwnerA);
        var rotated = ReadInvite(await rotate.Content.ReadAsStringAsync());

        using (var oldClaim = await ClaimAsync(NewWorker, invite.Token, invite.FarmCode))
        {
            oldClaim.StatusCode.Should().Be(HttpStatusCode.NotFound);
        }

        using var claim = await ClaimAsync(NewWorker, rotated.Token, rotated.FarmCode);
        claim.StatusCode.Should().Be(HttpStatusCode.OK, await claim.Content.ReadAsStringAsync());
        (await MembershipRoleAndStatusAsync(FarmA, NewWorker)).Should().Be(("Worker", 3));
        (await MembershipRoleAndStatusAsync(FarmB, NewWorker)).Should().BeNull("the invite is for farm A only");
    }

    [Fact]
    public async Task A_member_who_is_not_an_owner_gets_403_and_NO_invitation_row_is_written()
    {
        await AssertAppRoleIsNotVacuousAsync();

        using var issue = await SendAsync(HttpMethod.Post, IssueUrl(FarmA), Mukadam);
        issue.StatusCode.Should().Be(HttpStatusCode.Forbidden, await issue.Content.ReadAsStringAsync());
        using var rotate = await SendAsync(HttpMethod.Post, RotateUrl(FarmA), Mukadam);
        rotate.StatusCode.Should().Be(HttpStatusCode.Forbidden, await rotate.Content.ReadAsStringAsync());

        (await CountAsync("farm_invitations", FarmA)).Should().Be(0);
        (await CountAsync("farm_join_tokens", FarmA)).Should().Be(0);
    }

    [Fact]
    public async Task Revoked_and_Exited_members_are_refused_403_and_write_nothing()
    {
        await AssertAppRoleIsNotVacuousAsync();

        foreach (var who in new[] { RevokedCoOwner, ExitedMukadam })
        {
            using var issue = await SendAsync(HttpMethod.Post, IssueUrl(FarmA), who);
            issue.StatusCode.Should().Be(HttpStatusCode.Forbidden, $"{who}: {await issue.Content.ReadAsStringAsync()}");
            using var rotate = await SendAsync(HttpMethod.Post, RotateUrl(FarmA), who);
            rotate.StatusCode.Should().Be(HttpStatusCode.Forbidden, $"{who}: {await rotate.Content.ReadAsStringAsync()}");
        }

        (await CountAsync("farm_invitations", FarmA)).Should().Be(0);
        (await CountAsync("farm_join_tokens", FarmA)).Should().Be(0);
    }

    [Fact]
    public async Task A_caller_who_is_not_a_member_of_the_farm_gets_403_and_writes_nothing()
    {
        await AssertAppRoleIsNotVacuousAsync();

        using var issue = await SendAsync(HttpMethod.Post, IssueUrl(FarmA), Stranger);
        issue.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        using var rotate = await SendAsync(HttpMethod.Post, RotateUrl(FarmA), Stranger);
        rotate.StatusCode.Should().Be(HttpStatusCode.Forbidden);

        (await CountAsync("farm_invitations", FarmA)).Should().Be(0);
        (await CountAsync("farm_join_tokens", FarmA)).Should().Be(0);
    }

    [Fact]
    public async Task An_unauthenticated_caller_gets_401()
    {
        await AssertAppRoleIsNotVacuousAsync();

        using var issue = await SendAsync(HttpMethod.Post, IssueUrl(FarmA), userId: null);
        issue.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        using var rotate = await SendAsync(HttpMethod.Post, RotateUrl(FarmA), userId: null);
        rotate.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task The_owner_of_farm_A_cannot_issue_or_rotate_for_farm_B_and_nothing_is_written()
    {
        await AssertAppRoleIsNotVacuousAsync();

        using var issue = await SendAsync(HttpMethod.Post, IssueUrl(FarmB), OwnerA);
        issue.StatusCode.Should().Be(HttpStatusCode.Forbidden, await issue.Content.ReadAsStringAsync());
        using var rotate = await SendAsync(HttpMethod.Post, RotateUrl(FarmB), OwnerA);
        rotate.StatusCode.Should().Be(HttpStatusCode.Forbidden, await rotate.Content.ReadAsStringAsync());

        (await CountAsync("farm_invitations", FarmB)).Should().Be(0);
        (await CountAsync("farm_join_tokens", FarmB)).Should().Be(0);
        (await CountAsync("farm_invitations", FarmA)).Should().Be(0);
    }

    // -- Harness ----------------------------------------------------------------

    private static string IssueUrl(Guid farm) => $"/shramsafal/farms/{farm}/invite-qr";

    private static string RotateUrl(Guid farm) => $"/shramsafal/farms/{farm}/invite-qr/rotate";

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
        using var response = await SendAsync(HttpMethod.Post, IssueUrl(farm), caller);
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

        var storageDir = Path.Combine(Path.GetTempPath(), "agrisync-inviteqr-routes", Guid.NewGuid().ToString("N"));
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
        builder.Services.AddAnalytics(o => o.UseInMemoryDatabase($"inviteqr-routes-analytics-{Guid.NewGuid()}"));
        // The REAL production DI graph: Npgsql ShramSafalDbContext WITH the
        // TenantConnectionInterceptor, the pipeline-wrapped handlers and the real
        // authorization enforcer. No InMemory swap - that is the whole point.
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

    private async Task<int> CountAsync(string table, Guid farm)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = $"SELECT count(*) FROM ssf.{table} WHERE farm_id = @f";
        cmd.Parameters.AddWithValue("f", farm);
        return Convert.ToInt32(await cmd.ExecuteScalarAsync());
    }

    private async Task<bool> TokenIsRevokedAsync(string rawToken)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT is_revoked FROM ssf.farm_join_tokens WHERE raw_token = @t";
        cmd.Parameters.AddWithValue("t", rawToken);
        return Convert.ToBoolean(await cmd.ExecuteScalarAsync());
    }

    private async Task<int> LiveTokenCountAsync(Guid farm)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT count(*) FROM ssf.farm_join_tokens WHERE farm_id = @f AND NOT is_revoked";
        cmd.Parameters.AddWithValue("f", farm);
        return Convert.ToInt32(await cmd.ExecuteScalarAsync());
    }

    private async Task<(string Role, int Status)?> MembershipRoleAndStatusAsync(Guid farm, Guid user)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT role, status FROM ssf.farm_memberships WHERE farm_id = @f AND user_id = @u";
        cmd.Parameters.AddWithValue("f", farm);
        cmd.Parameters.AddWithValue("u", user);
        await using var reader = await cmd.ExecuteReaderAsync();
        return await reader.ReadAsync() ? (reader.GetString(0), reader.GetInt32(1)) : null;
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
                ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status)
            VALUES (@id, @farm, @user, @role, NOW(), NOW(), @account, @status);
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

/// <summary>
/// Test auth for the invite routes: same <c>X-Test-UserId</c> contract as the other
/// real-Postgres route suites, plus <c>phone_verified=true</c> because
/// <c>/join/claim</c> refuses callers without a verified phone.
/// </summary>
internal sealed class InviteTestAuthHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (!Request.Headers.TryGetValue("X-Test-UserId", out var raw)
            || !Guid.TryParse(raw.ToString(), out var userId))
        {
            return Task.FromResult(AuthenticateResult.Fail("missing X-Test-UserId"));
        }

        var id = userId.ToString();
        var claims = new[]
        {
            new Claim("sub", id),
            new Claim(ClaimTypes.NameIdentifier, id),
            new Claim("membership", "shramsafal:PrimaryOwner"),
            new Claim("phone_verified", "true"),
        };
        var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, Scheme.Name));
        return Task.FromResult(AuthenticateResult.Success(new AuthenticationTicket(principal, Scheme.Name)));
    }
}
