// spec: 2026-08-28-labour-v2-release-1
using System;
using System.Collections.Generic;
using System.IO;
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
using ShramSafal.Sync.IntegrationTests.Dfes;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Labour;

/// <summary>
/// <b>The two owner-only labour-permission routes, end to end, over the REAL
/// production pipeline against real Postgres as <c>agrisync_app</c>.</b>
///
/// <para><b>Why this file exists.</b>
/// <c>GET /shramsafal/farms/{farmId}/labour-permissions</c> and
/// <c>PUT …/labour-permissions/{userId}</c> answered <b>HTTP 500 to every
/// caller, the farm owner included</b>, so the owner's "जबाबदारी द्या" switch
/// never rendered. Root cause: the pipeline's owner check
/// (<c>EnsureIsOwner</c> → <c>IsUserOwnerOfFarmAsync</c> →
/// <c>GetUserRoleForFarmAsync</c>) issues its FIRST DbCommand before it has
/// published any tenant claim, and the route was not on the tenant skip list
/// and did not establish farm scope, so <c>TenantConnectionInterceptor</c>
/// fail-closed with "no tenant claim set and not in admin scope".</para>
///
/// <para><b>Why nothing caught it.</b> <c>LabourPermissionEndpointTests</c> runs
/// on EF InMemory, where the interceptor never fires and
/// <c>CallerFarmTenantScope</c> no-ops by design;
/// <c>LabourCapabilityGrantRealPostgresTests</c> pre-scopes the request by hand
/// and calls the handlers directly, so it never goes through the route. This
/// suite is the only one that drives the actual route through the actual
/// <c>TenantTransactionMiddleware</c> + interceptor + FORCE-RLS.</para>
///
/// <para><b>Doctrine E3 — vacuity guard.</b> The host connects as
/// <c>agrisync_app</c>; the guard asserts that role is neither superuser nor
/// BYPASSRLS, because an RLS/interceptor proof run as a superuser proves
/// nothing.</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class LabourPermissionRoutesRealPostgresTests : IAsyncLifetime
{
    private const string AppRoleUser = TestRoleCredentials.AppRoleUser;
    private static string AppRolePassword => TestRoleCredentials.AppRolePassword;

    private static readonly Guid Farm = Guid.Parse("c9e00001-0000-0000-0000-000000000001");
    private static readonly Guid Account = Guid.Parse("c9e00001-0000-0000-0000-0000000000c1");
    private static readonly Guid Owner = Guid.Parse("c9e00001-0000-0000-0000-0000000000a1");
    private static readonly Guid Worker = Guid.Parse("c9e00001-0000-0000-0000-0000000000b1");
    private static readonly Guid Mukadam = Guid.Parse("c9e00001-0000-0000-0000-0000000000b2");
    private static readonly Guid Stranger = Guid.Parse("c9e00001-0000-0000-0000-0000000000f9");

    private string _rootConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private string _superuserConn = string.Empty;
    private string _appConn = string.Empty;
    private WebApplication? _app;
    private HttpClient _client = default!;

    public async Task InitializeAsync()
    {
        _rootConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();

        _scratchDbName = $"ssf_labperm_routes_{Guid.NewGuid():N}";
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
            await ExecAsync(raw, """
                INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status)
                VALUES (@farm, 'Labour Permission Routes Farm', @owner, @account, NOW(), NOW(), 3.0, 'Unchecked');
                """, ("farm", Farm), ("owner", Owner), ("account", Account));
            await SeedMembershipAsync(raw, Owner, "PrimaryOwner");
            await SeedMembershipAsync(raw, Worker, "Worker");
            await SeedMembershipAsync(raw, Mukadam, "Mukadam");
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
    public async Task Owner_reads_the_labour_permission_roster_200()
    {
        await AssertAppRoleIsNotVacuousAsync();

        using var response = await SendAsync(HttpMethod.Get, RosterUrl, Owner);

        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(
            HttpStatusCode.OK,
            "the owner of the farm must be able to read the labour-permission roster — it was 500 "
            + "(TenantConnectionInterceptor: no tenant claim set and not in admin scope) because the "
            + $"route never established farm scope before the owner check ran. body: {body}");

        using var doc = JsonDocument.Parse(body);
        var userIds = new List<Guid>();
        foreach (var row in doc.RootElement.EnumerateArray())
        {
            userIds.Add(row.GetProperty("userId").GetGuid());
        }

        userIds.Should().Contain(Worker).And.Contain(Mukadam);
    }

    [Fact]
    public async Task Owner_grants_and_revokes_a_worker_over_HTTP_and_the_rows_really_change()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var putUrl = $"{RosterUrl}/{Worker}";

        using (var grant = await SendAsync(
                   HttpMethod.Put, putUrl, Owner, new { canManageLabourRecords = true }))
        {
            var body = await grant.Content.ReadAsStringAsync();
            grant.StatusCode.Should().Be(HttpStatusCode.OK, body);
        }

        (await ReadGrantAsync(Worker)).Should().BeTrue("the grant must be persisted, not just answered");

        using (var roster = await SendAsync(HttpMethod.Get, RosterUrl, Owner))
        {
            roster.StatusCode.Should().Be(HttpStatusCode.OK);
            using var doc = JsonDocument.Parse(await roster.Content.ReadAsStringAsync());
            var worker = default(JsonElement);
            foreach (var row in doc.RootElement.EnumerateArray())
            {
                if (row.GetProperty("userId").GetGuid() == Worker)
                {
                    worker = row.Clone();
                }
            }

            worker.GetProperty("canManageLabourRecords").GetBoolean().Should().BeTrue();
        }

        using (var revoke = await SendAsync(
                   HttpMethod.Put, putUrl, Owner, new { canManageLabourRecords = false }))
        {
            revoke.StatusCode.Should().Be(HttpStatusCode.OK, await revoke.Content.ReadAsStringAsync());
        }

        (await ReadGrantAsync(Worker)).Should().BeFalse();
    }

    [Fact]
    public async Task A_member_who_is_not_an_owner_gets_403_and_changes_nothing()
    {
        await AssertAppRoleIsNotVacuousAsync();

        using var read = await SendAsync(HttpMethod.Get, RosterUrl, Mukadam);
        read.StatusCode.Should().Be(HttpStatusCode.Forbidden, await read.Content.ReadAsStringAsync());

        using var write = await SendAsync(
            HttpMethod.Put, $"{RosterUrl}/{Worker}", Mukadam, new { canManageLabourRecords = true });
        write.StatusCode.Should().Be(HttpStatusCode.Forbidden, await write.Content.ReadAsStringAsync());

        (await ReadGrantAsync(Worker)).Should().BeFalse("a refused grant must write nothing");
    }

    [Fact]
    public async Task A_caller_who_is_not_a_member_of_the_farm_gets_403_never_data()
    {
        await AssertAppRoleIsNotVacuousAsync();

        using var read = await SendAsync(HttpMethod.Get, RosterUrl, Stranger);
        read.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await read.Content.ReadAsStringAsync()).Should().NotContain(Worker.ToString());

        using var write = await SendAsync(
            HttpMethod.Put, $"{RosterUrl}/{Worker}", Stranger, new { canManageLabourRecords = true });
        write.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        (await ReadGrantAsync(Worker)).Should().BeFalse();
    }

    [Fact]
    public async Task An_unauthenticated_caller_gets_401()
    {
        await AssertAppRoleIsNotVacuousAsync();

        using var read = await SendAsync(HttpMethod.Get, RosterUrl, userId: null);
        read.StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        using var write = await SendAsync(
            HttpMethod.Put, $"{RosterUrl}/{Worker}", userId: null, new { canManageLabourRecords = true });
        write.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    // ── Harness ──────────────────────────────────────────────────────────────

    private static string RosterUrl => $"/shramsafal/farms/{Farm}/labour-permissions";

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

        var storageDir = Path.Combine(Path.GetTempPath(), "agrisync-labperm-routes", Guid.NewGuid().ToString("N"));
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:ShramSafalDb"] = appConn,
            ["ConnectionStrings:UserDb"] = appConn,
            ["ShramSafal:Storage:DataDirectory"] = storageDir,
        });

        builder.Services
            .AddAuthentication("Test")
            .AddScheme<AuthenticationSchemeOptions, DfesTestAuthHandler>("Test", _ => { });
        builder.Services.AddAuthorization();
        builder.Services.AddBuildingBlocks();
        builder.Services.AddAnalytics(o => o.UseInMemoryDatabase($"labperm-routes-analytics-{Guid.NewGuid()}"));
        // The REAL production DI graph: Npgsql ShramSafalDbContext WITH the
        // TenantConnectionInterceptor, the pipeline-wrapped handlers and the real
        // authorization enforcer. No InMemory swap — that is the whole point.
        builder.Services.AddShramSafalApi(builder.Configuration);

        var app = builder.Build();
        app.UseAuthentication();
        app.UseAuthorization();
        // Same order as Program.cs: auth → TenantTransactionMiddleware → endpoints.
        app.UseMiddleware<TenantTransactionMiddleware>();
        app.MapShramSafalApi();

        await app.StartAsync();
        return app;
    }

    private async Task<bool> ReadGrantAsync(Guid userId)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText =
            "SELECT can_manage_labour_records FROM ssf.farm_memberships WHERE farm_id = @f AND user_id = @u";
        cmd.Parameters.AddWithValue("f", Farm);
        cmd.Parameters.AddWithValue("u", userId);
        return Convert.ToBoolean(await cmd.ExecuteScalarAsync());
    }

    private async Task AssertAppRoleIsNotVacuousAsync()
    {
        await using var db = new NpgsqlConnection(_appConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user";
        var superOrBypass = Convert.ToBoolean(await cmd.ExecuteScalarAsync());
        superOrBypass.Should().BeFalse(
            "doctrine E3 — a tenancy proof executed as a superuser or BYPASSRLS role proves nothing");
    }

    private static Task SeedMembershipAsync(NpgsqlConnection db, Guid userId, string role)
        => ExecAsync(db, """
            INSERT INTO ssf.farm_memberships
                ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status)
            VALUES (@id, @farm, @user, @role, NOW(), NOW(), @account, 3);
            """,
            ("id", Guid.NewGuid()), ("farm", Farm), ("user", userId), ("role", role), ("account", Account));

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
