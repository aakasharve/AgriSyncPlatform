// spec: pre-launch repair R-11 (b) + (c, server half) — the server-managed access extension
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using FluentAssertions;
using Microsoft.AspNetCore.TestHost;
using Xunit;
using Xunit.Abstractions;

namespace ShramSafal.Sync.IntegrationTests.TrialSafety;

/// <summary>
/// spec R-11 (b) (founder N-1: "Use an explicit, server-managed pilot extension with a recorded
/// reason and end date") — over the REAL pipeline (tenant middleware, /sync/push, the real
/// <c>DefaultEntitlementPolicy</c>, the admin route) on real Postgres as the app role:
/// <list type="bullet">
/// <item>an expired account WITHOUT an extension is refused — owner and worker alike — with
/// <c>entitlement.subscriptionexpired</c> (the code the phone now HOLDS);</item>
/// <item>an admin grants an extension (reason, end, who) and the SAME held record, re-sent with the
/// SAME client ids, is applied once — never twice;</item>
/// <item>an extension that has ended, or has not started, allows nothing;</item>
/// <item>only a platform admin can grant one, and a bad request is refused.</item>
/// </list>
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class EntitlementExtensionRealPostgresTests(TrialSafetyDatabase db, ITestOutputHelper output)
    : IClassFixture<TrialSafetyDatabase>
{
    private sealed record Farm(Guid FarmId, Guid Account, Guid Owner, Guid Worker);

    [Fact]
    public async Task An_expired_farm_is_refused_for_owner_and_worker_and_the_same_record_goes_once_after_an_admin_extension()
    {
        await db.AssertAppRoleIsNotVacuousAsync();
        var farm = await SeedExpiredFarmAsync();
        var admin = Guid.NewGuid();
        await db.SeedPlatformAdminAsync(admin);
        await using var app = await db.BuildHostAsync();
        using var client = app.GetTestClient();

        var ownerCost = Guid.NewGuid();
        var workerCost = Guid.NewGuid();
        var refusedOwner = await PushCostAsync(client, farm, farm.Owner, ownerCost, "held-owner");
        var refusedWorker = await PushCostAsync(client, farm, farm.Worker, workerCost, "held-worker");
        output.WriteLine($"[EVIDENCE] expired, no extension: owner={refusedOwner} worker={refusedWorker}");
        refusedOwner.Should().Be(("failed", "entitlement.subscriptionexpired"));
        refusedWorker.Should().Be(("failed", "entitlement.subscriptionexpired"), "a worker's work is gated by the farm's plan too");
        (await CostRowsAsync(ownerCost)).Should().Be(0);

        using (var mine = await TrialSafetyDatabase.SendAsync(client, HttpMethod.Get, "/shramsafal/farms/mine", farm.Worker))
        {
            var sub = await SnapshotAsync(mine, farm.FarmId);
            sub.GetProperty("allowsOwnerWrites").GetBoolean().Should().BeFalse();
            sub.GetProperty("accessExtendedUntilUtc").ValueKind.Should().Be(JsonValueKind.Null);
        }

        var endsAt = DateTime.UtcNow.AddDays(30);
        using (var granted = await TrialSafetyDatabase.SendAsync(client, HttpMethod.Post, "/shramsafal/admin/access-extensions", admin,
            new { ownerAccountId = farm.Account, reason = "pilot-extension-2026-10", endsAtUtc = endsAt }))
        {
            var text = await granted.Content.ReadAsStringAsync();
            output.WriteLine($"[EVIDENCE] admin grant: {(int)granted.StatusCode} {text}");
            granted.StatusCode.Should().Be(HttpStatusCode.OK, text);
        }

        var row = await ShramSafal.Sync.IntegrationTests.Labour.PurveshDemoReseedHarness.RowsAsync(db.SuperuserConn,
            "SELECT reason, granted_by_user_id, ends_at_utc FROM accounts.access_extensions WHERE owner_account_id = @a", ("a", farm.Account));
        row.Should().ContainSingle();
        row[0][0].Should().Be("pilot-extension-2026-10");
        row[0][1].Should().Be(admin, "the row records WHO granted it");

        // The phone re-sends the HELD rows with their own ids — applied once.
        (await PushCostAsync(client, farm, farm.Owner, ownerCost, "held-owner")).Status.Should().Be("applied");
        (await PushCostAsync(client, farm, farm.Worker, workerCost, "held-worker")).Status.Should().Be("applied");
        (await PushCostAsync(client, farm, farm.Owner, ownerCost, "held-owner")).Status.Should().Be("duplicate", "a re-send is never a second record");
        (await CostRowsAsync(ownerCost)).Should().Be(1);
        (await CostRowsAsync(workerCost)).Should().Be(1);

        using (var mine = await TrialSafetyDatabase.SendAsync(client, HttpMethod.Get, "/shramsafal/farms/mine", farm.Worker))
        {
            var sub = await SnapshotAsync(mine, farm.FarmId);
            sub.GetProperty("status").GetString().Should().Be("Expired", "the subscription itself is not pretended current");
            sub.GetProperty("allowsOwnerWrites").GetBoolean().Should().BeTrue("the phone must not say expired while the server accepts work");
            sub.GetProperty("accessExtendedUntilUtc").GetDateTime().Should().BeCloseTo(endsAt, TimeSpan.FromSeconds(1));
        }
    }

    [Theory]
    [InlineData(-20, -1, "ended yesterday")]
    [InlineData(1, 30, "starts tomorrow")]
    public async Task An_extension_outside_its_window_allows_nothing(int startDays, int endDays, string because)
    {
        await db.AssertAppRoleIsNotVacuousAsync();
        var farm = await SeedExpiredFarmAsync();
        await db.SeedExtensionAsync(farm.Account, DateTime.UtcNow.AddDays(startDays), DateTime.UtcNow.AddDays(endDays));
        await using var app = await db.BuildHostAsync();
        using var client = app.GetTestClient();

        var outcome = await PushCostAsync(client, farm, farm.Owner, Guid.NewGuid(), $"window-{startDays}");

        outcome.Should().Be(("failed", "entitlement.subscriptionexpired"), because);
    }

    [Fact]
    public async Task Only_a_platform_admin_grants_an_extension_and_a_bad_request_is_refused()
    {
        await db.AssertAppRoleIsNotVacuousAsync();
        var farm = await SeedExpiredFarmAsync();
        var admin = Guid.NewGuid();
        await db.SeedPlatformAdminAsync(admin);
        await using var app = await db.BuildHostAsync();
        using var client = app.GetTestClient();

        foreach (var who in new[] { farm.Owner, farm.Worker })
        {
            using var refused = await TrialSafetyDatabase.SendAsync(client, HttpMethod.Post, "/shramsafal/admin/access-extensions", who,
                new { ownerAccountId = farm.Account, reason = "self-service", endsAtUtc = DateTime.UtcNow.AddDays(30) });
            ((int)refused.StatusCode).Should().BeOneOf(401, 403);
        }

        using (var noReason = await TrialSafetyDatabase.SendAsync(client, HttpMethod.Post, "/shramsafal/admin/access-extensions", admin,
            new { ownerAccountId = farm.Account, reason = " ", endsAtUtc = DateTime.UtcNow.AddDays(30) }))
        {
            noReason.StatusCode.Should().Be(HttpStatusCode.BadRequest, "a reason is required");
        }

        using (var backwards = await TrialSafetyDatabase.SendAsync(client, HttpMethod.Post, "/shramsafal/admin/access-extensions", admin,
            new { ownerAccountId = farm.Account, reason = "x", startsAtUtc = DateTime.UtcNow.AddDays(5), endsAtUtc = DateTime.UtcNow.AddDays(1) }))
        {
            backwards.StatusCode.Should().Be(HttpStatusCode.BadRequest, "an extension must end after it starts");
        }

        using (var unknown = await TrialSafetyDatabase.SendAsync(client, HttpMethod.Post, "/shramsafal/admin/access-extensions", admin,
            new { ownerAccountId = Guid.NewGuid(), reason = "x", endsAtUtc = DateTime.UtcNow.AddDays(1) }))
        {
            unknown.StatusCode.Should().Be(HttpStatusCode.NotFound);
        }

        (await db.CountAsync("SELECT count(*) FROM accounts.access_extensions WHERE owner_account_id = @a", ("a", farm.Account)))
            .Should().Be(0, "nothing was granted");

        using var list = await TrialSafetyDatabase.SendAsync(client, HttpMethod.Get,
            $"/shramsafal/admin/access-extensions?ownerAccountId={farm.Account}", admin);
        list.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task The_app_role_may_add_an_extension_but_never_change_or_delete_one()
    {
        db.MigrationGrantOnExtensions.Should().Be((true, true, false, false),
            "the migration's own grant: append-only (SELECT, INSERT)");
        db.MigrationGrantOnExtensionView.Should().BeTrue("the ssf view is readable by the app role");
        await Task.CompletedTask;
    }

    // ── helpers ──

    private async Task<Farm> SeedExpiredFarmAsync()
    {
        var farm = new Farm(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid());
        await db.SeedAccountAsync(farm.Account, farm.Owner, farm.FarmId);
        await db.SeedFarmAsync(farm.FarmId, farm.Owner, farm.Account, ShramSafal.Domain.Farms.FarmCode.New());
        await db.SeedSeatAsync(farm.FarmId, farm.Account, farm.Worker, "Worker");
        await db.SeedSubscriptionAsync(farm.Account, 4, DateTime.UtcNow.AddDays(-2));
        return farm;
    }

    private static async Task<(string Status, string? ErrorCode)> PushCostAsync(HttpClient client, Farm farm, Guid who, Guid costEntryId, string requestId)
    {
        var request = new
        {
            deviceId = $"device-{who:N}",
            mutations = new[]
            {
                new
                {
                    clientRequestId = requestId,
                    clientCommandId = requestId,
                    mutationType = "add_cost_entry",
                    payload = new Dictionary<string, object?>
                    {
                        ["costEntryId"] = costEntryId, ["farmId"] = farm.FarmId, ["categoryId"] = "seeds",
                        ["description"] = "R-11 probe purchase", ["amount"] = 250m, ["currencyCode"] = "INR",
                        ["entryDate"] = DateTime.UtcNow.ToString("yyyy-MM-dd"),
                    },
                },
            },
        };

        using var response = await TrialSafetyDatabase.SendAsync(client, HttpMethod.Post, "/sync/push", who, request);
        var body = await response.Content.ReadAsStringAsync();
        response.StatusCode.Should().Be(HttpStatusCode.OK, body);
        using var doc = JsonDocument.Parse(body);
        var result = doc.RootElement.GetProperty("results").EnumerateArray().Single();
        return (
            result.GetProperty("status").GetString()!,
            result.TryGetProperty("errorCode", out var code) && code.ValueKind == JsonValueKind.String ? code.GetString() : null);
    }

    private static async Task<JsonElement> SnapshotAsync(HttpResponseMessage mine, Guid farmId)
    {
        var text = await mine.Content.ReadAsStringAsync();
        mine.StatusCode.Should().Be(HttpStatusCode.OK, text);
        var farms = JsonDocument.Parse(text).RootElement.Clone();
        return farms.EnumerateArray().Single(f => f.GetProperty("farmId").GetGuid() == farmId).GetProperty("subscription");
    }

    private Task<long> CostRowsAsync(Guid costEntryId) =>
        db.CountAsync("SELECT count(*) FROM ssf.cost_entries WHERE \"Id\" = @id", ("id", costEntryId));
}
