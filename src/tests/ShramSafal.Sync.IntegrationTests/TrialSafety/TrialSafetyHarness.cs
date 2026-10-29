// spec: pre-launch repair R-11 (trial safety) + I19 (password back door)
using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading.Tasks;
using Accounts.Infrastructure;
using AgriSync.Bootstrapper.Endpoints;
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
using ShramSafal.Api;
using ShramSafal.Application.Ports.External;
using ShramSafal.Sync.IntegrationTests.Labour;
using ShramSafal.Sync.IntegrationTests.Memberships;
using User.Infrastructure;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.TrialSafety;

/// <summary>
/// spec R-11 / I19 — one migrated scratch database per test class (<c>ssf_reseed_trial_*</c>, so the
/// reseed harness's name guard applies), built with the production 4-phase migration chain and the
/// app's own history tables, and a TestServer host that runs the REAL production DI graph — the real
/// <c>DefaultEntitlementPolicy</c>, the real tenant middleware, the first-farm route and the admin
/// extension route — connected as the non-superuser, non-BYPASSRLS <c>agrisync_app</c>.
/// Only the AI orchestrator is replaced (no model is ever called).
///
/// <para>Point it at a throwaway cluster with <c>REQUIRES_POSTGRES_ROOT_CONN</c>; it never opens a
/// database it did not create.</para>
/// </summary>
public sealed class TrialSafetyDatabase : IAsyncLifetime
{
    public string MaintenanceConn { get; private set; } = string.Empty;
    public string Name { get; private set; } = string.Empty;
    public string SuperuserConn { get; private set; } = string.Empty;
    public string AppConn { get; private set; } = string.Empty;

    /// <summary>Privileges the migration itself gave the app role on accounts.access_extensions,
    /// read BEFORE the harness's broad accounts grant (which would mask them).</summary>
    public (bool Select, bool Insert, bool Update, bool Delete) MigrationGrantOnExtensions { get; private set; }

    public bool MigrationGrantOnExtensionView { get; private set; }

    public async Task InitializeAsync()
    {
        MaintenanceConn = await PurveshDemoReseedHarness.MaintenanceConnectionAsync();
        Name = PurveshDemoReseedHarness.NewDatabaseName("trial");
        await PurveshDemoReseedHarness.CreateDatabaseAsync(MaintenanceConn, Name);
        SuperuserConn = PurveshDemoReseedHarness.SuperuserConnFor(MaintenanceConn, Name);
        AppConn = PurveshDemoReseedHarness.AppConnFor(SuperuserConn);

        await PurveshDemoReseedHarness.MigrateLikeProductionAsync(SuperuserConn);

        MigrationGrantOnExtensions = (
            await PrivAsync("accounts.access_extensions", "SELECT"),
            await PrivAsync("accounts.access_extensions", "INSERT"),
            await PrivAsync("accounts.access_extensions", "UPDATE"),
            await PrivAsync("accounts.access_extensions", "DELETE"));
        MigrationGrantOnExtensionView = await PrivAsync("ssf.access_extension_projections", "SELECT");

        // HARNESS PARITY (PurveshDemoReseedHarness.GrantAppRoleAsync): public / analytics / accounts are
        // provisioned outside the migration chain. Re-assert the append-only posture of the new table
        // afterwards — the broad grant would otherwise hand UPDATE/DELETE back to the app role.
        await PurveshDemoReseedHarness.GrantAppRoleAsync(SuperuserConn);
        await PurveshDemoReseedHarness.ExecAsync(SuperuserConn,
            "REVOKE UPDATE, DELETE ON accounts.access_extensions FROM agrisync_app;");
    }

    public async Task DisposeAsync()
    {
        NpgsqlClearPools();
        await PurveshDemoReseedHarness.DropDatabaseAsync(MaintenanceConn, Name);
    }

    public async Task AssertAppRoleIsNotVacuousAsync()
    {
        (await PurveshDemoReseedHarness.CanBypassRlsAsync(AppConn)).Should().BeFalse(
            "doctrine E3 — a proof run as a superuser or BYPASSRLS role proves nothing");
    }

    private async Task<bool> PrivAsync(string table, string privilege) =>
        (bool)(await PurveshDemoReseedHarness.ScalarAsync(SuperuserConn,
            $"SELECT has_table_privilege('agrisync_app', '{table}', '{privilege}')"))!;

    private static void NpgsqlClearPools() => Npgsql.NpgsqlConnection.ClearAllPools();

    // ── arrange (superuser: the arrangement never depends on the code under test) ──

    public Task SeedAccountAsync(Guid account, Guid owner, Guid? bootstrappedFarm = null) =>
        PurveshDemoReseedHarness.ExecAsync(SuperuserConn, """
            INSERT INTO accounts.owner_accounts
                (owner_account_id, account_name, primary_owner_user_id, account_type, status, created_at_utc, modified_at_utc, bootstrapped_farm_id)
            VALUES (@a, 'Probe account', @o, 1, 1, NOW(), NOW(), @f);
            """, ("a", account), ("o", owner), ("f", (object?)bootstrappedFarm ?? DBNull.Value));

    public Task SeedSubscriptionAsync(Guid account, int status, DateTime validUntilUtc) =>
        PurveshDemoReseedHarness.ExecAsync(SuperuserConn, """
            INSERT INTO accounts.subscriptions
                (subscription_id, owner_account_id, plan_code, status, valid_from_utc, valid_until_utc, trial_ends_at_utc, created_at_utc, updated_at_utc)
            VALUES (@id, @a, 'shramsafal_pro', @s, @until - INTERVAL '14 days', @until, @until, @until - INTERVAL '14 days', @until);
            """, ("id", Guid.NewGuid()), ("a", account), ("s", status), ("until", validUntilUtc));

    public Task SeedExtensionAsync(Guid account, DateTime startsUtc, DateTime endsUtc, string reason = "probe-extension") =>
        PurveshDemoReseedHarness.ExecAsync(SuperuserConn, """
            INSERT INTO accounts.access_extensions
                (access_extension_id, owner_account_id, reason, starts_at_utc, ends_at_utc, granted_by_user_id, created_at_utc)
            VALUES (@id, @a, @r, @s, @e, 'ffffffff-ffff-ffff-ffff-ffffffffffff', NOW());
            """, ("id", Guid.NewGuid()), ("a", account), ("r", reason), ("s", startsUtc), ("e", endsUtc));

    public async Task SeedFarmAsync(Guid farm, Guid owner, Guid account, string code)
    {
        await PurveshDemoReseedHarness.ExecAsync(SuperuserConn, """
            INSERT INTO ssf.farms ("Id", name, owner_user_id, owner_account_id, created_at_utc, modified_at_utc, weather_radius_km, geo_validation_status, farm_code)
            VALUES (@farm, 'Probe Trial Farm', @owner, @account, NOW(), NOW(), 3.0, 'Unchecked', @code);
            """, ("farm", farm), ("owner", owner), ("account", account), ("code", code));
        await SeedSeatAsync(farm, account, owner, "PrimaryOwner");
    }

    public Task SeedSeatAsync(Guid farm, Guid account, Guid user, string role) =>
        PurveshDemoReseedHarness.ExecAsync(SuperuserConn, """
            INSERT INTO ssf.farm_memberships ("Id", farm_id, user_id, role, granted_at_utc, modified_at_utc, owner_account_id, status, joined_via)
            VALUES (@id, @farm, @user, @role, NOW(), NOW(), @account, 3, 2);
            """, ("id", Guid.NewGuid()), ("farm", farm), ("user", user), ("role", role), ("account", account));

    public Task SeedPlatformAdminAsync(Guid user) =>
        PurveshDemoReseedHarness.ExecAsync(SuperuserConn, """
            INSERT INTO ssf.organization_memberships (id, organization_id, user_id, role, added_by_user_id, joined_at_utc, is_active)
            VALUES (@id, '00000000-0000-0000-0000-00000000a000', @u, 0, @u, NOW(), TRUE);
            """, ("id", Guid.NewGuid()), ("u", user));

    public Task<long> CountAsync(string sql, params (string Name, object Value)[] args) =>
        PurveshDemoReseedHarness.CountAsync(SuperuserConn, sql, args);

    // ── the host ──

    public async Task<WebApplication> BuildHostAsync(IAiOrchestrator? orchestrator = null)
    {
        var builder = WebApplication.CreateBuilder(new WebApplicationOptions { EnvironmentName = "Testing" });
        builder.WebHost.UseTestServer();
        var storageDir = Path.Combine(Path.GetTempPath(), "agrisync-trial-safety", Guid.NewGuid().ToString("N"));
        builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["ConnectionStrings:ShramSafalDb"] = AppConn,
            ["ConnectionStrings:UserDb"] = AppConn,
            ["ConnectionStrings:AccountsDb"] = AppConn,
            // The privileged role the admin cross-tenant factory uses (the startup backfill), as in production.
            ["ConnectionStrings:ShramSafalDb_Migration"] = SuperuserConn,
            ["ShramSafal:Storage:DataDirectory"] = storageDir,
        });

        builder.Services.AddAuthentication("Test").AddScheme<AuthenticationSchemeOptions, JoinByCodeTestAuthHandler>("Test", _ => { });
        builder.Services.AddAuthorization();
        builder.Services.AddBuildingBlocks();
        builder.Services.AddAnalytics(o => o.UseInMemoryDatabase($"trial-analytics-{Guid.NewGuid()}"));
        builder.Services.AddUserInfrastructure(builder.Configuration);
        builder.Services.AddAccountsInfrastructure(builder.Configuration);
        // The REAL production DI graph — including DefaultEntitlementPolicy (nothing overrides it).
        builder.Services.AddShramSafalApi(builder.Configuration);
        if (orchestrator is not null)
        {
            builder.Services.AddSingleton(orchestrator);
        }

        var app = builder.Build();
        app.UseAuthentication();
        app.UseAuthorization();
        app.UseMiddleware<TenantTransactionMiddleware>();
        app.MapShramSafalApi();
        app.MapFirstFarmBootstrapEndpoints();
        app.MapAccessExtensionAdminEndpoints();
        await app.StartAsync();
        return app;
    }

    public static async Task<HttpResponseMessage> SendAsync(HttpClient client, HttpMethod method, string url, Guid who, object? body = null, HttpContent? content = null)
    {
        var request = new HttpRequestMessage(method, url);
        if (content is not null)
        {
            request.Content = content;
        }
        else if (body is not null)
        {
            request.Content = JsonContent.Create(body);
        }

        request.Headers.Add("X-Test-UserId", who.ToString());
        request.Headers.Add("X-Test-PhoneVerified", "true");
        return await client.SendAsync(request);
    }

    public static async Task<JsonElement> JsonAsync(HttpResponseMessage response)
    {
        var text = await response.Content.ReadAsStringAsync();
        return JsonDocument.Parse(text).RootElement.Clone();
    }
}
