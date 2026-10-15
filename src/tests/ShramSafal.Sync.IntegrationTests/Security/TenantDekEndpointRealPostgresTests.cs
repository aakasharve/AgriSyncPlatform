// spec: 2026-08-25-prod-cutover-waves
using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Auth.Jwt;
using AgriSync.BuildingBlocks.Persistence;
using AgriSync.BuildingBlocks.Security;
using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using ShramSafal.Api;
using User.Application.Ports;
using User.Infrastructure;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Security;

/// <summary>
/// <b>D1 - <c>GET /shramsafal/security/tenant-dek</c> and
/// <c>POST /shramsafal/security/tenant-dek/resolve</c>, end to end over the REAL
/// production pipeline against real Postgres as <c>agrisync_app</c>.</b>
///
/// <para>Both routes answered <c>401 join.unauthenticated</c> in ~1 ms to every
/// logged-in user: the handlers read <c>TenantContext.OwnerAccountId</c>, which only
/// <c>ShramSafalAuthorizationEnforcer</c> sets and these routes never reach, and the
/// JWT carries no owner-account claim. The unit tests called <c>SetTenant</c> by hand
/// and so could not see it. This suite sends a REAL bearer token minted by the real
/// <see cref="IJwtTokenService"/> (the one login/OTP use) through the real
/// <c>AddJwtTokenValidation</c> JwtBearer scheme, the real
/// <c>TenantTransactionMiddleware</c>, the real interceptor and the real RLS.</para>
///
/// <para>The ONLY substitute is the KMS: <see cref="TestKmsStandInTenantDekService"/> is
/// registered as <see cref="ITenantDekService"/> and reproduces the one property of KMS
/// that matters here - a DEK wrapped under owner account X cannot be unwrapped under Y.</para>
///
/// <para>Doctrine E3 - vacuity guard: the host connects as <c>agrisync_app</c> and a fact
/// asserts that role is neither superuser nor BYPASSRLS.</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class TenantDekEndpointRealPostgresTests : IAsyncLifetime
{
    private const string AppRoleUser = TestRoleCredentials.AppRoleUser;
    private static string AppRolePassword => TestRoleCredentials.AppRolePassword;

    // Active = 3, Suspended = 4, Revoked = 5, Exited = 6, PendingApproval = 2 (MembershipStatus enum).
    private const int Active = 3;
    private const int PendingApproval = 2;
    private const int Suspended = 4;
    private const int Revoked = 5;
    private const int Exited = 6;

    private static readonly Guid FarmA = Guid.Parse("d1de0001-0000-0000-0000-000000000001");
    private static readonly Guid FarmA2 = Guid.Parse("d1de0001-0000-0000-0000-000000000003");
    private static readonly Guid FarmB = Guid.Parse("d1de0001-0000-0000-0000-000000000002");
    private static readonly Guid AccountA = Guid.Parse("d1de0001-0000-0000-0000-0000000000c1");
    private static readonly Guid AccountB = Guid.Parse("d1de0001-0000-0000-0000-0000000000c2");
    private static readonly Guid OwnerA = Guid.Parse("d1de0001-0000-0000-0000-0000000000a1");
    private static readonly Guid OwnerB = Guid.Parse("d1de0001-0000-0000-0000-0000000000a2");
    private static readonly Guid MukadamA = Guid.Parse("d1de0001-0000-0000-0000-0000000000b2");
    private static readonly Guid WorkerBothAccounts = Guid.Parse("d1de0001-0000-0000-0000-0000000000b5");
    private static readonly Guid SuspendedA = Guid.Parse("d1de0001-0000-0000-0000-0000000000b3");
    private static readonly Guid RevokedA = Guid.Parse("d1de0001-0000-0000-0000-0000000000b4");
    private static readonly Guid ExitedA = Guid.Parse("d1de0001-0000-0000-0000-0000000000b6");
    private static readonly Guid PendingA = Guid.Parse("d1de0001-0000-0000-0000-0000000000b7");
    private static readonly Guid Stranger = Guid.Parse("d1de0001-0000-0000-0000-0000000000f9");
    private static readonly Guid NoSuchFarm = Guid.Parse("d1de0001-0000-0000-0000-0000000000ee");

    private const string JwtSigningKey = "d1-test-signing-key-0123456789-abcdefghijklmnopqrstuvwxyz";

    private string _rootConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private string _superuserConn = string.Empty;
    private string _appConn = string.Empty;
    private WebApplication? _app;
    private HttpClient _client = default!;
    private readonly TestKmsStandInTenantDekService _kms = new();

    public async Task InitializeAsync()
    {
        _rootConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();

        _scratchDbName = $"ssf_tenantdek_{Guid.NewGuid():N}";
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
            await SeedFarmAsync(raw, FarmA, "Dek Farm A", OwnerA, AccountA, "DKA001");
            await SeedFarmAsync(raw, FarmA2, "Dek Farm A2", OwnerA, AccountA, "DKA002");
            await SeedFarmAsync(raw, FarmB, "Dek Farm B", OwnerB, AccountB, "DKB001");
            await SeedMembershipAsync(raw, FarmA, AccountA, OwnerA, "PrimaryOwner", Active);
            await SeedMembershipAsync(raw, FarmA, AccountA, MukadamA, "Mukadam", Active);
            await SeedMembershipAsync(raw, FarmA, AccountA, WorkerBothAccounts, "Worker", Active);
            await SeedMembershipAsync(raw, FarmB, AccountB, WorkerBothAccounts, "Worker", Active);
            await SeedMembershipAsync(raw, FarmA, AccountA, SuspendedA, "Mukadam", Suspended);
            await SeedMembershipAsync(raw, FarmA, AccountA, RevokedA, "SecondaryOwner", Revoked);
            await SeedMembershipAsync(raw, FarmA, AccountA, ExitedA, "Mukadam", Exited);
            await SeedMembershipAsync(raw, FarmA, AccountA, PendingA, "Worker", PendingApproval);
            await SeedMembershipAsync(raw, FarmB, AccountB, OwnerB, "PrimaryOwner", Active);
        }

        _app = await BuildHostAsync(_appConn, _kms);
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
    public async Task The_declared_owner_gets_200_and_a_DEK_bound_to_the_farms_owner_account()
    {
        await AssertAppRoleIsNotVacuousAsync();

        using var response = await GetDekAsync(OwnerA, FarmA);
        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(
            HttpStatusCode.OK,
            "this was 401 join.unauthenticated for every logged-in user because nothing on the route "
            + $"ever set the owner account. body: {body}");

        var dek = ReadDek(body);
        dek.DekId.Should().NotBeNullOrWhiteSpace();
        Convert.FromBase64String(dek.DekBase64).Length.Should().Be(32);
        _kms.IssuedFor.Should().Equal(new[] { AccountA },
            "the DEK must be bound to the FARM's owner account read from the farm row");
    }

    [Fact]
    public async Task An_Active_member_who_is_not_the_owner_gets_200_for_the_same_owner_account()
    {
        await AssertAppRoleIsNotVacuousAsync();

        using var response = await GetDekAsync(MukadamA, FarmA);
        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.OK, body);
        _kms.IssuedFor.Should().Equal(new[] { AccountA });
    }

    [Fact]
    public async Task Two_farms_of_the_same_account_resolve_to_the_same_owner_account()
    {
        await AssertAppRoleIsNotVacuousAsync();

        using var a = await GetDekAsync(OwnerA, FarmA);
        using var a2 = await GetDekAsync(OwnerA, FarmA2);
        a.StatusCode.Should().Be(HttpStatusCode.OK);
        a2.StatusCode.Should().Be(HttpStatusCode.OK);
        _kms.IssuedFor.Should().Equal(new[] { AccountA, AccountA });
    }

    [Fact]
    public async Task Resolve_round_trip_returns_the_same_DEK_and_writes_both_audit_rows()
    {
        await AssertAppRoleIsNotVacuousAsync();

        using var issued = await GetDekAsync(MukadamA, FarmA);
        var dek = ReadDek(await issued.Content.ReadAsStringAsync());

        // A different Active member of the same account, on a different farm of it, can unwrap it.
        using var resolved = await ResolveAsync(OwnerA, dek.DekId, FarmA2);
        var body = await resolved.Content.ReadAsStringAsync();
        resolved.StatusCode.Should().Be(HttpStatusCode.OK, body);
        using var doc = JsonDocument.Parse(body);
        doc.RootElement.GetProperty("dekBase64").GetString().Should().Be(dek.DekBase64);

        (await AuditCountAsync(FarmA, "Issued", MukadamA)).Should().Be(1);
        (await AuditCountAsync(FarmA2, "Resolved", OwnerA)).Should().Be(1);
    }

    [Fact]
    public async Task Resolving_under_a_different_owner_account_the_caller_also_belongs_to_is_404_not_the_key()
    {
        await AssertAppRoleIsNotVacuousAsync();

        using var issued = await GetDekAsync(WorkerBothAccounts, FarmA); // wrapped under AccountA
        var dek = ReadDek(await issued.Content.ReadAsStringAsync());

        // Same person, legitimately in account B too. Asking account B to unwrap A's key fails
        // the KMS binding: 404 (the client's clean "not this account" miss), never the key.
        using var wrongAccount = await ResolveAsync(WorkerBothAccounts, dek.DekId, FarmB);
        wrongAccount.StatusCode.Should().Be(HttpStatusCode.NotFound, await wrongAccount.Content.ReadAsStringAsync());
        (await wrongAccount.Content.ReadAsStringAsync()).Should().NotContain(dek.DekBase64);
        (await AuditCountAsync(FarmB, "ResolveFailed", WorkerBothAccounts)).Should().Be(1);

        using var rightAccount = await ResolveAsync(WorkerBothAccounts, dek.DekId, FarmA);
        rightAccount.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task A_member_of_ANOTHER_account_gets_403_and_no_DEK_is_issued_or_audited()
    {
        await AssertAppRoleIsNotVacuousAsync();

        using var response = await GetDekAsync(OwnerB, FarmA);
        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.Forbidden, body);
        body.Should().NotContain("dekBase64");
        _kms.IssuedFor.Should().BeEmpty("a non-member must never reach the key service");
        (await AuditCountAsync(FarmA, "Issued", OwnerB)).Should().Be(0);
    }

    [Fact]
    public async Task A_stranger_who_belongs_to_no_account_gets_403()
    {
        await AssertAppRoleIsNotVacuousAsync();

        using var response = await GetDekAsync(Stranger, FarmA);
        response.StatusCode.Should().Be(HttpStatusCode.Forbidden, await response.Content.ReadAsStringAsync());
        _kms.IssuedFor.Should().BeEmpty();
    }

    [Fact]
    public async Task A_farm_that_does_not_exist_is_refused_exactly_like_a_farm_the_caller_is_not_in()
    {
        await AssertAppRoleIsNotVacuousAsync();

        using var missing = await GetDekAsync(OwnerA, NoSuchFarm);
        using var foreign = await GetDekAsync(OwnerA, FarmB);
        var missingBody = await missing.Content.ReadAsStringAsync();
        var foreignBody = await foreign.Content.ReadAsStringAsync();

        missing.StatusCode.Should().Be(HttpStatusCode.Forbidden, missingBody);
        foreign.StatusCode.Should().Be(HttpStatusCode.Forbidden, foreignBody);
        missingBody.Should().Be(foreignBody, "existence must not leak: both answers are byte-identical");
        _kms.IssuedFor.Should().BeEmpty();
    }

    [Theory]
    [InlineData("suspended")]
    [InlineData("revoked")]
    [InlineData("exited")]
    [InlineData("pending")]
    public async Task A_membership_that_is_not_Active_is_refused_403_on_both_routes(string kind)
    {
        await AssertAppRoleIsNotVacuousAsync();

        var user = kind switch
        {
            "suspended" => SuspendedA,
            "revoked" => RevokedA,
            "exited" => ExitedA,
            _ => PendingA,
        };

        using var issue = await GetDekAsync(user, FarmA);
        issue.StatusCode.Should().Be(HttpStatusCode.Forbidden, $"{kind}: {await issue.Content.ReadAsStringAsync()}");

        // Even holding a dekId that a legitimate member really got.
        using var legit = await GetDekAsync(OwnerA, FarmA);
        var dek = ReadDek(await legit.Content.ReadAsStringAsync());
        using var resolve = await ResolveAsync(user, dek.DekId, FarmA);
        resolve.StatusCode.Should().Be(HttpStatusCode.Forbidden, $"{kind}: {await resolve.Content.ReadAsStringAsync()}");
        (await resolve.Content.ReadAsStringAsync()).Should().NotContain(dek.DekBase64);

        _kms.IssuedFor.Should().Equal(new[] { AccountA }, "only the legitimate owner's call may have reached the key service");
        _kms.ResolveCalls.Should().Be(0, "a refused caller must never reach the key service");
    }

    [Fact]
    public async Task An_unauthenticated_caller_gets_401_on_both_routes()
    {
        await AssertAppRoleIsNotVacuousAsync();

        using var get = await GetDekAsync(userId: null, FarmA);
        get.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        using var post = await ResolveAsync(userId: null, "whatever", FarmA);
        post.StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        // A token signed with the wrong key is not a token.
        using var forged = new HttpRequestMessage(HttpMethod.Get, $"/shramsafal/security/tenant-dek?farmId={FarmA}");
        forged.Headers.Authorization = new AuthenticationHeaderValue("Bearer", ForgedToken(OwnerA));
        using var forgedResponse = await _client.SendAsync(forged);
        forgedResponse.StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        _kms.IssuedFor.Should().BeEmpty();
    }

    [Fact]
    public async Task A_missing_or_empty_farmId_is_400_and_an_OLD_client_that_sends_no_farm_fails_closed()
    {
        await AssertAppRoleIsNotVacuousAsync();

        using var noQuery = await SendAsync(HttpMethod.Get, "/shramsafal/security/tenant-dek", OwnerA);
        noQuery.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        using var emptyGuid = await GetDekAsync(OwnerA, Guid.Empty);
        emptyGuid.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        using var notAGuid = await SendAsync(HttpMethod.Get, "/shramsafal/security/tenant-dek?farmId=banana", OwnerA);
        notAGuid.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        // Exactly what every shipped client sends today: { dekId } and nothing else.
        using var oldResolve = await SendAsync(
            HttpMethod.Post, "/shramsafal/security/tenant-dek/resolve", OwnerA, new { dekId = "x" });
        oldResolve.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        using var noDekId = await ResolveAsync(OwnerA, "", FarmA);
        noDekId.StatusCode.Should().Be(HttpStatusCode.BadRequest);

        _kms.IssuedFor.Should().BeEmpty();
        _kms.ResolveCalls.Should().Be(0);
    }

    // -- Harness ----------------------------------------------------------------

    private sealed record Dek(string DekId, string DekBase64);

    private static Dek ReadDek(string body)
    {
        using var doc = JsonDocument.Parse(body);
        var r = doc.RootElement;
        return new Dek(r.GetProperty("dekId").GetString()!, r.GetProperty("dekBase64").GetString()!);
    }

    private Task<HttpResponseMessage> GetDekAsync(Guid? userId, Guid farmId)
        => SendAsync(HttpMethod.Get, $"/shramsafal/security/tenant-dek?farmId={farmId}", userId);

    private Task<HttpResponseMessage> ResolveAsync(Guid? userId, string dekId, Guid farmId)
        => SendAsync(HttpMethod.Post, "/shramsafal/security/tenant-dek/resolve", userId, new { dekId, farmId });

    private async Task<HttpResponseMessage> SendAsync(
        HttpMethod method, string url, Guid? userId, object? body = null)
    {
        var request = new HttpRequestMessage(method, url);
        if (userId is { } id)
        {
            // A REAL access token from the real IJwtTokenService (identity-only claims: sub +
            // phone_verified, exactly what a logged-in farmer holds), validated by the real
            // JwtBearer scheme. No owner-account claim exists in it - that is the whole defect.
            var tokens = _app!.Services.GetRequiredService<IJwtTokenService>().GenerateIdentityTokens(id, phoneVerified: true);
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", tokens.AccessToken);
        }

        if (body is not null)
        {
            request.Content = JsonContent.Create(body);
        }

        return await _client.SendAsync(request);
    }

    private static string ForgedToken(Guid userId)
    {
        var key = new Microsoft.IdentityModel.Tokens.SymmetricSecurityKey(
            System.Text.Encoding.UTF8.GetBytes("a-completely-different-signing-key-of-32+chars!!"));
        var token = new System.IdentityModel.Tokens.Jwt.JwtSecurityToken(
            issuer: "AgriSync",
            audience: "AgriSync.Clients",
            claims: new[] { new System.Security.Claims.Claim("sub", userId.ToString()) },
            expires: DateTime.UtcNow.AddMinutes(5),
            signingCredentials: new Microsoft.IdentityModel.Tokens.SigningCredentials(
                key, Microsoft.IdentityModel.Tokens.SecurityAlgorithms.HmacSha256));
        return new System.IdentityModel.Tokens.Jwt.JwtSecurityTokenHandler().WriteToken(token);
    }

    private static async Task<WebApplication> BuildHostAsync(string appConn, ITenantDekService kms)
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
        builder.WebHost.UseTestServer();

        var storageDir = Path.Combine(Path.GetTempPath(), "agrisync-tenantdek", Guid.NewGuid().ToString("N"));
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:ShramSafalDb"] = appConn,
            ["ConnectionStrings:UserDb"] = appConn,
            ["ShramSafal:Storage:DataDirectory"] = storageDir,
            ["Jwt:Issuer"] = "AgriSync",
            ["Jwt:Audience"] = "AgriSync.Clients",
            ["Jwt:SigningKey"] = JwtSigningKey,
            ["Jwt:AccessTokenMinutes"] = "15",
        });

        // The REAL token validation and the REAL token issuer (User.Infrastructure.JwtTokenIssuer,
        // the IJwtTokenService login/OTP use), composed the way Program.cs composes them.
        builder.Services.AddJwtTokenValidation(builder.Configuration);
        builder.Services.AddAuthorization();
        builder.Services.AddBuildingBlocks();
        builder.Services.AddAnalytics(o => o.UseInMemoryDatabase($"tenantdek-analytics-{Guid.NewGuid()}"));
        builder.Services.AddUserInfrastructure(builder.Configuration);
        // The REAL production DI graph: Npgsql ShramSafalDbContext WITH the
        // TenantConnectionInterceptor, the pipeline-wrapped handlers and the real
        // authorization enforcer. No InMemory swap - that is the whole point.
        builder.Services.AddShramSafalApi(builder.Configuration);
        // The only stand-in: KMS (Program.cs registers KmsTenantDekService / NullTenantDekService).
        builder.Services.AddSingleton(kms);

        var app = builder.Build();
        app.UseAuthentication();
        app.UseAuthorization();
        // Same order as Program.cs: auth, TenantTransactionMiddleware, endpoints.
        app.UseMiddleware<TenantTransactionMiddleware>();
        app.MapShramSafalApi();

        await app.StartAsync();
        return app;
    }

    private async Task<int> AuditCountAsync(Guid farm, string action, Guid actor)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText =
            "SELECT count(*) FROM ssf.audit_events WHERE entity_type = 'TenantDek' AND farm_id = @f AND action = @a AND actor_user_id = @u";
        cmd.Parameters.AddWithValue("f", farm);
        cmd.Parameters.AddWithValue("a", action);
        cmd.Parameters.AddWithValue("u", actor);
        return Convert.ToInt32(await cmd.ExecuteScalarAsync());
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
/// <b>Test double for the KMS-backed <see cref="ITenantDekService"/>.</b> The real service
/// needs AWS KMS and is exercised separately by <c>TenantDekServiceIntegrationTests</c>
/// (LocalStack). This stand-in reproduces the single property the endpoint authorization
/// depends on: a DEK issued for owner account X can be unwrapped only under X (the KMS
/// EncryptionContext), and records every call so a test can prove a refused caller never
/// reached the key service.
/// </summary>
internal sealed class TestKmsStandInTenantDekService : ITenantDekService
{
    private readonly object _gate = new();
    private readonly Dictionary<string, (Guid Owner, byte[] Bytes)> _issued = new();
    private readonly List<Guid> _issuedFor = new();
    private int _resolveCalls;

    public IReadOnlyList<Guid> IssuedFor
    {
        get { lock (_gate) { return _issuedFor.ToArray(); } }
    }

    public int ResolveCalls
    {
        get { lock (_gate) { return _resolveCalls; } }
    }

    public Task<TenantDek> IssueAsync(Guid ownerAccountId, CancellationToken ct)
    {
        var bytes = new byte[32];
        System.Security.Cryptography.RandomNumberGenerator.Fill(bytes);
        var dekId = $"test-dek-{Guid.NewGuid():N}";
        lock (_gate)
        {
            _issued[dekId] = (ownerAccountId, bytes);
            _issuedFor.Add(ownerAccountId);
        }

        return Task.FromResult(new TenantDek(dekId, bytes, DateTime.UtcNow.AddHours(24)));
    }

    public Task<byte[]?> ResolveAsync(Guid ownerAccountId, string dekId, CancellationToken ct)
    {
        lock (_gate)
        {
            _resolveCalls++;
            return Task.FromResult(
                _issued.TryGetValue(dekId, out var entry) && entry.Owner == ownerAccountId
                    ? entry.Bytes
                    : null);
        }
    }
}
