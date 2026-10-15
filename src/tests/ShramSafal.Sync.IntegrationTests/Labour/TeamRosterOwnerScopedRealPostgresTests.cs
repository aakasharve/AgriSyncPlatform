// spec: 2026-08-25-prod-cutover-waves
using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Http;
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
/// <b>Team completeness and real role display, owner-scoped.</b>
///
/// <para>The Team page was built from <c>/sync/pull</c> <c>operators</c>, whose role
/// is read from <c>public.memberships</c> - a table whose RLS policy shows the
/// app role ONLY the caller's own row. So an owner saw the Mukadam as a plain
/// worker and the co-owner not at all. The existing owner-protected source,
/// <c>GET /farms/{farmId}/labour-permissions</c> (owner-tier only, farm-scoped by
/// <c>ICallerFarmTenantScope</c>, reads <c>ssf.farm_memberships</c> under the farm
/// tenant policy), already lists every non-terminal member with the REAL role;
/// it lacked only the display name. This suite pins, as <c>agrisync_app</c>
/// (non-superuser, non-BYPASSRLS) against real Postgres:</para>
/// <list type="bullet">
///   <item>the owner and the co-owner receive every member's real role AND name;</item>
///   <item>a Mukadam, an un-granted Worker, a GRANTED Worker, and the owner of a
///   DIFFERENT farm receive 403 and not one name or id of this farm's team;</item>
///   <item>nothing about the farm's team leaks across farms;</item>
///   <item>no RLS policy was loosened: the app role still cannot see another
///   user's row in <c>public.memberships</c>.</item>
/// </list>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class TeamRosterOwnerScopedRealPostgresTests : IAsyncLifetime
{
    private const string AppRoleUser = TestRoleCredentials.AppRoleUser;
    private static string AppRolePassword => TestRoleCredentials.AppRolePassword;

    private static readonly Guid FarmA = Guid.Parse("c9e10001-0000-0000-0000-000000000001");
    private static readonly Guid FarmB = Guid.Parse("c9e10001-0000-0000-0000-000000000002");
    private static readonly Guid AccountA = Guid.Parse("c9e10001-0000-0000-0000-0000000000c1");
    private static readonly Guid AccountB = Guid.Parse("c9e10001-0000-0000-0000-0000000000c2");
    private static readonly Guid OwnerA = Guid.Parse("c9e10001-0000-0000-0000-0000000000a1");
    private static readonly Guid CoOwnerA = Guid.Parse("c9e10001-0000-0000-0000-0000000000a2");
    private static readonly Guid MukadamA = Guid.Parse("c9e10001-0000-0000-0000-0000000000b2");
    private static readonly Guid WorkerA = Guid.Parse("c9e10001-0000-0000-0000-0000000000b1");
    private static readonly Guid GrantedWorkerA = Guid.Parse("c9e10001-0000-0000-0000-0000000000b3");
    private static readonly Guid OwnerB = Guid.Parse("c9e10001-0000-0000-0000-0000000000d1");
    private static readonly Guid WorkerB = Guid.Parse("c9e10001-0000-0000-0000-0000000000d2");

    private static readonly Dictionary<Guid, (string Name, string Phone)> Names = new()
    {
        [OwnerA] = ("Owner Anil", "9000000001"),
        [CoOwnerA] = ("Sunita CoOwner", "9000000002"),
        [MukadamA] = ("Shankar Mukadam", "9000000003"),
        [WorkerA] = ("Raju Worker", "9000000004"),
        [GrantedWorkerA] = ("Granted Gita", "9000000005"),
        [OwnerB] = ("Owner Bhaskar", "9000000006"),
        [WorkerB] = ("Worker Bhima", "9000000007"),
    };

    private string _rootConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private string _superuserConn = string.Empty;
    private string _appConn = string.Empty;
    private WebApplication? _app;
    private HttpClient _client = default!;

    public async Task InitializeAsync()
    {
        _rootConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();

        _scratchDbName = $"ssf_teamroster_{Guid.NewGuid():N}";
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
            await ExecAsync(raw, $"""
                GRANT USAGE ON SCHEMA public TO {AppRoleUser};
                GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO {AppRoleUser};
                """);
            foreach (var (id, who) in Names)
            {
                await ExecAsync(raw, """
                    INSERT INTO public.users
                        ("Id", phone, display_name, password_hash, credential_created_at_utc,
                         created_at_utc, is_active, auth_mode, preferred_language)
                    VALUES (@id, @phone, @name, 'x', NOW(), NOW(), TRUE, 0, 'mr');
                    """, ("id", id), ("phone", who.Phone), ("name", who.Name));
            }

            await SeedFarmAsync(raw, FarmA, "Team Farm A", OwnerA, AccountA);
            await SeedFarmAsync(raw, FarmB, "Team Farm B", OwnerB, AccountB);
            await SeedMembershipAsync(raw, FarmA, AccountA, OwnerA, "PrimaryOwner");
            await SeedMembershipAsync(raw, FarmA, AccountA, CoOwnerA, "SecondaryOwner");
            await SeedMembershipAsync(raw, FarmA, AccountA, MukadamA, "Mukadam");
            await SeedMembershipAsync(raw, FarmA, AccountA, WorkerA, "Worker");
            await SeedMembershipAsync(raw, FarmA, AccountA, GrantedWorkerA, "Worker", grant: true);
            await SeedMembershipAsync(raw, FarmB, AccountB, OwnerB, "PrimaryOwner");
            await SeedMembershipAsync(raw, FarmB, AccountB, WorkerB, "Worker");
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

    [Theory]
    [InlineData("owner")]
    [InlineData("coowner")]
    public async Task Owner_tier_receives_every_member_with_real_role_and_name(string caller)
    {
        await AssertAppRoleIsNotVacuousAsync();
        var callerId = caller == "owner" ? OwnerA : CoOwnerA;

        using var response = await SendAsync(RosterUrl(FarmA), callerId);
        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.OK, body);

        var rows = ParseRows(body);
        rows.Keys.Should().BeEquivalentTo(new[] { OwnerA, CoOwnerA, MukadamA, WorkerA, GrantedWorkerA },
            "the whole farm-A team, and nobody from farm B");
        rows[OwnerA].Role.Should().Be("PrimaryOwner");
        rows[CoOwnerA].Role.Should().Be("SecondaryOwner");
        rows[MukadamA].Role.Should().Be("Mukadam");
        rows[WorkerA].Role.Should().Be("Worker");
        rows[GrantedWorkerA].Role.Should().Be("Worker");
        foreach (var (id, row) in rows)
        {
            row.DisplayName.Should().Be(Names[id].Name, "the Team page needs a name for a member it was never sent");
            row.Status.Should().Be("Active");
        }

        body.Should().NotContain(Names[OwnerB].Name).And.NotContain(Names[WorkerB].Name);
    }

    [Theory]
    [InlineData("mukadam")]
    [InlineData("worker")]
    [InlineData("grantedworker")]
    [InlineData("farmBowner")]
    public async Task Everyone_who_is_not_owner_tier_of_this_farm_gets_403_and_not_one_name(string caller)
    {
        await AssertAppRoleIsNotVacuousAsync();
        var callerId = caller switch
        {
            "mukadam" => MukadamA,
            "worker" => WorkerA,
            "grantedworker" => GrantedWorkerA,
            _ => OwnerB,
        };

        using var response = await SendAsync(RosterUrl(FarmA), callerId);
        var body = await response.Content.ReadAsStringAsync();

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden, body);
        foreach (var (id, who) in Names)
        {
            body.Should().NotContain(who.Name).And.NotContain(id.ToString());
        }
    }

    [Fact]
    public async Task Farm_B_owner_sees_only_farm_B_people_on_farm_B()
    {
        await AssertAppRoleIsNotVacuousAsync();

        using var response = await SendAsync(RosterUrl(FarmB), OwnerB);
        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.OK, body);

        ParseRows(body).Keys.Should().BeEquivalentTo(new[] { OwnerB, WorkerB });
        body.Should().NotContain(Names[MukadamA].Name).And.NotContain(Names[CoOwnerA].Name);
    }

    [Fact]
    public async Task No_database_protection_was_loosened_the_app_role_still_cannot_see_other_members_rows()
    {
        await AssertAppRoleIsNotVacuousAsync();

        // With only the OWNER's user GUC set, the app role must still see exactly
        // the owner's own public.memberships row (here: none of anyone else's).
        await using var db = new NpgsqlConnection(_appConn);
        await db.OpenAsync();
        await using var tx = await db.BeginTransactionAsync();
        await using (var set = db.CreateCommand())
        {
            set.Transaction = tx;
            set.CommandText = "SELECT set_config('agrisync.user_id', @u, true)";
            set.Parameters.AddWithValue("u", OwnerA.ToString());
            await set.ExecuteNonQueryAsync();
        }

        await using var q = db.CreateCommand();
        q.Transaction = tx;
        q.CommandText = "SELECT count(*) FROM public.memberships WHERE user_id <> @u";
        q.Parameters.AddWithValue("u", OwnerA);
        Convert.ToInt32(await q.ExecuteScalarAsync()).Should().Be(0);
    }

    private sealed record Row(string Role, string Status, string? DisplayName);

    private static Dictionary<Guid, Row> ParseRows(string body)
    {
        using var doc = JsonDocument.Parse(body);
        var map = new Dictionary<Guid, Row>();
        foreach (var el in doc.RootElement.EnumerateArray())
        {
            map[el.GetProperty("userId").GetGuid()] = new Row(
                el.GetProperty("role").GetString()!,
                el.GetProperty("status").GetString()!,
                el.TryGetProperty("displayName", out var n) && n.ValueKind == JsonValueKind.String ? n.GetString() : null);
        }

        return map;
    }

    private static string RosterUrl(Guid farm) => $"/shramsafal/farms/{farm}/labour-permissions";

    private async Task<HttpResponseMessage> SendAsync(string url, Guid userId)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.Add("X-Test-UserId", userId.ToString());
        return await _client.SendAsync(request);
    }

    private static async Task<WebApplication> BuildHostAsync(string appConn)
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
        builder.WebHost.UseTestServer();

        var storageDir = Path.Combine(Path.GetTempPath(), "agrisync-teamroster", Guid.NewGuid().ToString("N"));
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
        builder.Services.AddAnalytics(o => o.UseInMemoryDatabase($"teamroster-analytics-{Guid.NewGuid()}"));
        // The REAL production DI graph: Npgsql ShramSafalDbContext WITH the
        // TenantConnectionInterceptor, the pipeline-wrapped handlers, the real enforcer.
        builder.Services.AddShramSafalApi(builder.Configuration);

        var app = builder.Build();
        app.UseAuthentication();
        app.UseAuthorization();
        app.UseMiddleware<TenantTransactionMiddleware>();
        app.MapShramSafalApi();

        await app.StartAsync();
        return app;
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

    private static Task SeedFarmAsync(NpgsqlConnection db, Guid farm, string name, Guid owner, Guid account)
        => ExecAsync(db, """
            INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status)
            VALUES (@farm, @name, @owner, @account, NOW(), NOW(), 3.0, 'Unchecked');
            """, ("farm", farm), ("name", name), ("owner", owner), ("account", account));

    private static Task SeedMembershipAsync(
        NpgsqlConnection db, Guid farm, Guid account, Guid userId, string role, bool grant = false)
        => ExecAsync(db, """
            INSERT INTO ssf.farm_memberships
                ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status, can_manage_labour_records)
            VALUES (@id, @farm, @user, @role, NOW(), NOW(), @account, 3, @grant);
            """,
            ("id", Guid.NewGuid()), ("farm", farm), ("user", userId), ("role", role), ("account", account), ("grant", grant));

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
