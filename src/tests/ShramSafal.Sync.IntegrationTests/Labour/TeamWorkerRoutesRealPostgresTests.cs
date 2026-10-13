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
using ShramSafal.Sync.IntegrationTests.Dfes;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Labour;

/// <summary>
/// Team page "Add worker" / "Remove" over the REAL production pipeline (auth, tenant transaction
/// middleware, interceptor, FORCE RLS, pipeline-wrapped handlers) against real Postgres as
/// <c>agrisync_app</c>: <c>POST .../labour/field-operators</c> (now accepting a client id) and
/// <c>POST .../labour/field-operators/{id}/deactivate</c>.
///
/// <para>Doctrine E3 vacuity guard: the host connects as a role that is neither superuser nor
/// BYPASSRLS.</para>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class TeamWorkerRoutesRealPostgresTests : IAsyncLifetime
{
    private const string AppRoleUser = TestRoleCredentials.AppRoleUser;
    private static string AppRolePassword => TestRoleCredentials.AppRolePassword;

    private static readonly Guid FarmA = Guid.Parse("c9e20001-0000-0000-0000-000000000001");
    private static readonly Guid FarmB = Guid.Parse("c9e20001-0000-0000-0000-000000000002");
    private static readonly Guid AccountA = Guid.Parse("c9e20001-0000-0000-0000-0000000000c1");
    private static readonly Guid AccountB = Guid.Parse("c9e20001-0000-0000-0000-0000000000c2");
    private static readonly Guid OwnerA = Guid.Parse("c9e20001-0000-0000-0000-0000000000a1");
    private static readonly Guid OwnerB = Guid.Parse("c9e20001-0000-0000-0000-0000000000a2");
    private static readonly Guid CoOwnerA = Guid.Parse("c9e20001-0000-0000-0000-0000000000a3");
    private static readonly Guid MukadamA = Guid.Parse("c9e20001-0000-0000-0000-0000000000b2");
    private static readonly Guid WorkerA = Guid.Parse("c9e20001-0000-0000-0000-0000000000b1");
    private static readonly Guid GrantedWorkerA = Guid.Parse("c9e20001-0000-0000-0000-0000000000b3");
    private static readonly Guid Stranger = Guid.Parse("c9e20001-0000-0000-0000-0000000000f9");

    private string _rootConn = string.Empty;
    private string _scratchDbName = string.Empty;
    private string _superuserConn = string.Empty;
    private string _appConn = string.Empty;
    private WebApplication? _app;
    private HttpClient _client = default!;

    public async Task InitializeAsync()
    {
        _rootConn = await RequiresPostgresConnection.ResolveReachableConnectionOrThrowAsync();

        _scratchDbName = $"ssf_teamwk_routes_{Guid.NewGuid():N}";
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

        await using (var raw = new NpgsqlConnection(_superuserConn))
        {
            await raw.OpenAsync();
            await ExecAsync(raw, $"""
                GRANT USAGE ON SCHEMA public TO {AppRoleUser};
                GRANT SELECT ON ALL TABLES IN SCHEMA public TO {AppRoleUser};
                """);
            foreach (var (farm, owner, account, name) in new[]
                     {
                         (FarmA, OwnerA, AccountA, "Team Routes Farm A"),
                         (FarmB, OwnerB, AccountB, "Team Routes Farm B"),
                     })
            {
                await ExecAsync(raw, """
                    INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status)
                    VALUES (@farm, @name, @owner, @account, NOW(), NOW(), 3.0, 'Unchecked');
                    """, ("farm", farm), ("name", name), ("owner", owner), ("account", account));
            }

            await SeedMembershipAsync(raw, FarmA, AccountA, OwnerA, "PrimaryOwner", false);
            await SeedMembershipAsync(raw, FarmA, AccountA, CoOwnerA, "SecondaryOwner", false);
            await SeedMembershipAsync(raw, FarmA, AccountA, MukadamA, "Mukadam", false);
            await SeedMembershipAsync(raw, FarmA, AccountA, WorkerA, "Worker", false);
            await SeedMembershipAsync(raw, FarmA, AccountA, GrantedWorkerA, "Worker", true);
            await SeedMembershipAsync(raw, FarmB, AccountB, OwnerB, "PrimaryOwner", false);
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
    public async Task Owner_adds_a_named_worker_over_HTTP_it_is_stored_once_and_a_replay_returns_the_same_person()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var members = await CountAsync("ssf.farm_memberships");
        var users = await CountAsync("public.users");
        var id = Guid.NewGuid();

        using var first = await SendAsync(HttpMethod.Post, OperatorsUrl(FarmA), OwnerA, new { displayName = "Ramesh", id });
        var firstBody = await first.Content.ReadAsStringAsync();
        first.StatusCode.Should().Be(HttpStatusCode.Created, firstBody);
        JsonDocument.Parse(firstBody).RootElement.GetProperty("id").GetGuid().Should().Be(id);

        using var replay = await SendAsync(HttpMethod.Post, OperatorsUrl(FarmA), OwnerA, new { displayName = "Ramesh", id });
        replay.StatusCode.Should().Be(HttpStatusCode.Created, await replay.Content.ReadAsStringAsync());
        JsonDocument.Parse(await replay.Content.ReadAsStringAsync()).RootElement.GetProperty("id").GetGuid().Should().Be(id);

        (await CountAsync($"ssf.field_operators WHERE \"Id\" = '{id}'")).Should().Be(1);
        (await CountAsync("ssf.farm_memberships")).Should().Be(members, "a name creates no membership");
        (await CountAsync("public.users")).Should().Be(users, "a name creates no login");

        // After the server ack the roster read (what the Team page loads on reload) carries him.
        using var roster = await SendAsync(HttpMethod.Get, OperatorsUrl(FarmA), OwnerA);
        roster.StatusCode.Should().Be(HttpStatusCode.OK);
        using var doc = JsonDocument.Parse(await roster.Content.ReadAsStringAsync());
        doc.RootElement.EnumerateArray()
            .Should().ContainSingle(o => o.GetProperty("id").GetGuid() == id && o.GetProperty("isActive").GetBoolean());
    }

    [Fact]
    public async Task Add_is_201_for_owner_coowner_and_granted_worker_and_403_for_the_rest_with_nothing_written()
    {
        await AssertAppRoleIsNotVacuousAsync();

        foreach (var (who, user, expected) in new[]
                 {
                     ("owner", OwnerA, HttpStatusCode.Created),
                     ("co-owner", CoOwnerA, HttpStatusCode.Created),
                     ("granted worker", GrantedWorkerA, HttpStatusCode.Created),
                     ("un-granted mukadam", MukadamA, HttpStatusCode.Forbidden),
                     ("un-granted worker", WorkerA, HttpStatusCode.Forbidden),
                     ("non-member of farm A", Stranger, HttpStatusCode.Forbidden),
                     ("owner of farm B on farm A", OwnerB, HttpStatusCode.Forbidden),
                 })
        {
            using var r = await SendAsync(HttpMethod.Post, OperatorsUrl(FarmA), user, new { displayName = $"N-{who}", id = Guid.NewGuid() });
            r.StatusCode.Should().Be(expected, who);
        }

        (await CountAsync("ssf.field_operators WHERE display_name LIKE 'N-%'")).Should().Be(3);
        using var anon = await SendAsync(HttpMethod.Post, OperatorsUrl(FarmA), null, new { displayName = "Anon" });
        anon.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task An_id_already_used_on_farm_A_is_never_re_used_or_returned_to_farm_B()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var id = Guid.NewGuid();
        (await SendAsync(HttpMethod.Post, OperatorsUrl(FarmA), OwnerA, new { displayName = "Ramesh", id }))
            .StatusCode.Should().Be(HttpStatusCode.Created);

        using var cross = await SendAsync(HttpMethod.Post, OperatorsUrl(FarmB), OwnerB, new { displayName = "Ramesh", id });
        cross.StatusCode.Should().Be(HttpStatusCode.Forbidden, await cross.Content.ReadAsStringAsync());
        (await CountAsync($"ssf.field_operators WHERE \"Id\" = '{id}' AND originating_farm_id = '{FarmA}'")).Should().Be(1);
        (await CountAsync($"ssf.field_operators WHERE originating_farm_id = '{FarmB}'")).Should().Be(0);
    }

    [Fact]
    public async Task Remove_retires_the_worker_over_HTTP_keeps_every_row_and_is_refused_to_a_plain_mukadam_and_a_stranger()
    {
        await AssertAppRoleIsNotVacuousAsync();
        var id = Guid.NewGuid();
        (await SendAsync(HttpMethod.Post, OperatorsUrl(FarmA), OwnerA, new { displayName = "Ganesh", id }))
            .StatusCode.Should().Be(HttpStatusCode.Created);
        await using (var raw = new NpgsqlConnection(_superuserConn))
        {
            await raw.OpenAsync();
            await ExecAsync(raw, """
                INSERT INTO ssf.attendance_marks ("Id", farm_id, field_operator_id, work_date, day_mark, night_mark, recorded_by_user_id, recorded_at_utc, modified_at_utc)
                VALUES (@id, @farm, @op, DATE '2026-10-12', 1, 0, @by, NOW(), NOW());
                """, ("id", Guid.NewGuid()), ("farm", FarmA), ("op", id), ("by", OwnerA));
        }

        var operatorsBefore = await CountAsync("ssf.field_operators");
        var marksBefore = await CountAsync("ssf.attendance_marks");

        foreach (var (who, user) in new[] { ("mukadam", MukadamA), ("worker", WorkerA), ("stranger", Stranger), ("farm B owner", OwnerB) })
        {
            using var refused = await SendAsync(HttpMethod.Post, DeactivateUrl(FarmA, id), user);
            refused.StatusCode.Should().Be(HttpStatusCode.Forbidden, who);
        }

        (await ReadActiveAsync(id)).Should().BeTrue("refusals change nothing");

        using var ok = await SendAsync(HttpMethod.Post, DeactivateUrl(FarmA, id), CoOwnerA);
        var okBody = await ok.Content.ReadAsStringAsync();
        ok.StatusCode.Should().Be(HttpStatusCode.OK, okBody);
        JsonDocument.Parse(okBody).RootElement.GetProperty("isActive").GetBoolean().Should().BeFalse();
        using var again = await SendAsync(HttpMethod.Post, DeactivateUrl(FarmA, id), OwnerA);
        again.StatusCode.Should().Be(HttpStatusCode.OK, "retiring twice converges");

        (await ReadActiveAsync(id)).Should().BeFalse();
        (await CountAsync("ssf.field_operators")).Should().Be(operatorsBefore, "nothing is deleted");
        (await CountAsync("ssf.attendance_marks")).Should().Be(marksBefore, "his history stays");

        using var roster = await SendAsync(HttpMethod.Get, OperatorsUrl(FarmA), OwnerA);
        using var doc = JsonDocument.Parse(await roster.Content.ReadAsStringAsync());
        doc.RootElement.EnumerateArray().Single(o => o.GetProperty("id").GetGuid() == id)
            .GetProperty("isActive").GetBoolean().Should().BeFalse();

        // Another farm's id, or one that does not exist, answers the same way.
        using var unknown = await SendAsync(HttpMethod.Post, DeactivateUrl(FarmA, Guid.NewGuid()), OwnerA);
        unknown.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    // ── Harness ──────────────────────────────────────────────────────────────

    private static string OperatorsUrl(Guid farm) => $"/shramsafal/farms/{farm}/labour/field-operators";

    private static string DeactivateUrl(Guid farm, Guid id) => $"{OperatorsUrl(farm)}/{id}/deactivate";

    private async Task<HttpResponseMessage> SendAsync(HttpMethod method, string url, Guid? userId, object? body = null)
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

        var storageDir = Path.Combine(Path.GetTempPath(), "agrisync-teamwk-routes", Guid.NewGuid().ToString("N"));
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
        builder.Services.AddAnalytics(o => o.UseInMemoryDatabase($"teamwk-routes-analytics-{Guid.NewGuid()}"));
        builder.Services.AddShramSafalApi(builder.Configuration);

        var app = builder.Build();
        app.UseAuthentication();
        app.UseAuthorization();
        app.UseMiddleware<TenantTransactionMiddleware>();
        app.MapShramSafalApi();

        await app.StartAsync();
        return app;
    }

    private async Task<long> CountAsync(string fromWhere)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = $"SELECT count(*) FROM {fromWhere}";
        return Convert.ToInt64(await cmd.ExecuteScalarAsync());
    }

    private async Task<bool> ReadActiveAsync(Guid id)
    {
        await using var db = new NpgsqlConnection(_superuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT is_active FROM ssf.field_operators WHERE \"Id\" = @id";
        cmd.Parameters.AddWithValue("id", id);
        return Convert.ToBoolean(await cmd.ExecuteScalarAsync());
    }

    private async Task AssertAppRoleIsNotVacuousAsync()
    {
        await using var db = new NpgsqlConnection(_appConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname = current_user";
        Convert.ToBoolean(await cmd.ExecuteScalarAsync()).Should().BeFalse(
            "doctrine E3 — a tenancy proof executed as a superuser or BYPASSRLS role proves nothing");
    }

    private static Task SeedMembershipAsync(NpgsqlConnection db, Guid farm, Guid account, Guid userId, string role, bool grant)
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
