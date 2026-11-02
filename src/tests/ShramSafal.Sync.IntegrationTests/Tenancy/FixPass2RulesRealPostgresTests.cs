// spec: plr-d10-redesign-real-integration-2026-10-25 — lane F99 fix pass 2 (second review, REQUEST_CHANGES 43/50).
//
// On a real Postgres as agrisync_app (E3 first), through the real host:
//   N-8  the platform-admin check of the global price list (D-72), asked directly for every kind of seat; and the phone's
//        "may I edit the price list" question no longer records a farmer as an unauthorised admin;
//   N-9  GET /shramsafal/ai/health and PUT /shramsafal/ai/config (skip-listed in fix pass 1): the admin is answered, a
//        farmer is refused.
using System;
using System.Collections.Generic;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Npgsql;
using ShramSafal.Application.Admin.Ports;
using ShramSafal.Application.Ports;
using ShramSafal.Sync.IntegrationTests.Memberships;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.Tenancy;

[Trait("Category", "RequiresPostgres")]
public sealed class FixPass2RulesRealPostgresTests(ITestOutputHelper output) : RoleScopedFarm(output)
{
    private static readonly Guid PlatformOwner = Guid.Parse("3d099300-0000-4000-8000-000000000001");
    private static readonly Guid PlatformViewer = Guid.Parse("3d099300-0000-4000-8000-000000000002");
    private static readonly Guid RetiredPlatformOwner = Guid.Parse("3d099300-0000-4000-8000-000000000003");
    private static readonly Guid FpoOwner = Guid.Parse("3d099300-0000-4000-8000-000000000004");

    /// <summary>Analytics on this database, as in production, so a written analytics event can be counted.</summary>
    protected override void AddHostServices(IServiceCollection services)
    {
        services.RemoveAll<Microsoft.EntityFrameworkCore.Infrastructure.IDbContextOptionsConfiguration<AgriSync.BuildingBlocks.Analytics.AnalyticsDbContext>>();
        services.RemoveAll<DbContextOptions<AgriSync.BuildingBlocks.Analytics.AnalyticsDbContext>>();
        services.AddDbContext<AgriSync.BuildingBlocks.Analytics.AnalyticsDbContext>(o => o.UseNpgsql(AppConn));
    }

    // ── N-8: the platform-admin check, asked directly ───────────────────────────────────────

    [Fact]
    public async Task N8_only_an_active_owner_of_an_active_platform_organisation_may_write_the_price_list()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedPlatformOwnerAsync(PlatformOwner, Guid.Parse("3d099300-0000-4000-8000-0000000000f1"), phone: "9300000931");
        await SeedPlatformOwnerAsync(PlatformViewer, Guid.Parse("3d099300-0000-4000-8000-0000000000f2"), role: 4, phone: "9300000932");
        await SeedPlatformOwnerAsync(RetiredPlatformOwner, Guid.Parse("3d099300-0000-4000-8000-0000000000f3"), orgActive: false, phone: "9300000933");
        await SeedPlatformOwnerAsync(FpoOwner, Guid.Parse("3d099300-0000-4000-8000-0000000000f4"), orgType: 1, phone: "9300000934");

        var expected = new Dictionary<Guid, bool>
        {
            [PlatformOwner] = true,
            [PlatformViewer] = false,
            [RetiredPlatformOwner] = false,
            [FpoOwner] = false,
            [Owner] = false, // a farmer: no organisation seat at all
        };
        foreach (var (user, may) in expected)
        {
            // Directly: the one rule the write obeys.
            await using (var scope = HostServices.CreateAsyncScope())
            {
                var userScope = scope.ServiceProvider.GetRequiredService<ICallerUserTenantScope>();
                var resolver = scope.ServiceProvider.GetRequiredService<IEntitlementResolver>();
                (await userScope.RunForCallerAsync(user, t => resolver.IsPlatformOwnerAsync(new UserId(user), t), default))
                    .Should().Be(may, $"{user}");
            }

            // And as the phone asks it.
            var (status, body) = await GetAsync(user, "/shramsafal/finance/price-config/may-write");
            status.Should().Be(HttpStatusCode.OK, body);
            Json(body).GetProperty("mayWrite").GetBoolean().Should().Be(may, $"{user}: {body}");
        }
    }

    [Fact]
    public async Task N8_a_farmer_opening_the_price_book_is_not_recorded_as_an_unauthorised_admin()
    {
        await AssertAppRoleIsNotVacuousAsync();
        const string Sql = "SELECT count(*) FROM analytics.events WHERE event_type = 'admin.scope.unauthorized' AND actor_user_id = @u";

        // The question the price book asks now: nothing recorded.
        (await GetAsync(Owner, "/shramsafal/finance/price-config/may-write")).Status.Should().Be(HttpStatusCode.OK);
        (await CountAsync(Sql, Owner)).Should().Be(0);

        // The control: the question it used to ask (/admin/me/scope) records him, so the count above can see a write.
        (await GetAsync(Owner, "/shramsafal/admin/me/scope")).Status.Should().Be(HttpStatusCode.OK);
        (await CountAsync(Sql, Owner)).Should().Be(1);
    }

    // ── N-9: the two admin AI routes left untested in fix pass 1 ───────────────────────────

    [Fact]
    public async Task N9_ai_health_and_putting_the_ai_config_answer_the_admin_and_refuse_a_farmer()
    {
        await AssertAppRoleIsNotVacuousAsync();
        await SeedPlatformOwnerAsync(PlatformOwner, Guid.Parse("3d099300-0000-4000-8000-0000000000f1"), phone: "9300000931");

        var (health, healthBody) = await GetAsync(PlatformOwner, "/shramsafal/ai/health");
        health.Should().Be(HttpStatusCode.OK, healthBody);
        (await GetAsync(Owner, "/shramsafal/ai/health")).Status.Should().BeOneOf(HttpStatusCode.Unauthorized, HttpStatusCode.Forbidden);

        var config = new { fallbackEnabled = false, maxRetries = 2 };
        var (put, putBody) = await SendForAsync(HttpMethod.Put, PlatformOwner, "/shramsafal/ai/config", config);
        put.Should().Be(HttpStatusCode.OK, putBody);
        var (refused, _) = await SendForAsync(HttpMethod.Put, Owner, "/shramsafal/ai/config", new { fallbackEnabled = true, maxRetries = 5 });
        refused.Should().BeOneOf(HttpStatusCode.Unauthorized, HttpStatusCode.Forbidden);

        // What the admin wrote is what is read back; the farmer's attempt changed nothing.
        var (read, readBody) = await GetAsync(PlatformOwner, "/shramsafal/ai/config");
        read.Should().Be(HttpStatusCode.OK, readBody);
        readBody.Should().Contain("\"maxRetries\":2").And.Contain("\"fallbackEnabled\":false");
    }

    // ── Helpers ─────────────────────────────────────────────────────────────────────────

    private Task<(HttpStatusCode Status, string Body)> GetAsync(Guid user, string url) => SendForAsync(HttpMethod.Get, user, url, null);

    private async Task<(HttpStatusCode Status, string Body)> SendForAsync(HttpMethod method, Guid user, string url, object? body)
    {
        using var response = await SendAsync(method, url, user, body);
        var text = await response.Content.ReadAsStringAsync();
        Output.WriteLine($"[F99-2] {user} {method} {url} -> {(int)response.StatusCode} {text}");
        return (response.StatusCode, text);
    }

    private static JsonElement Json(string body) => JsonDocument.Parse(body).RootElement.Clone();

    private async Task<long> CountAsync(string sql, Guid user)
    {
        await using var db = new NpgsqlConnection(SuperuserConn);
        await db.OpenAsync();
        await using var cmd = db.CreateCommand();
        cmd.CommandText = sql;
        cmd.Parameters.AddWithValue("u", user);
        return (long)(await cmd.ExecuteScalarAsync())!;
    }
}
