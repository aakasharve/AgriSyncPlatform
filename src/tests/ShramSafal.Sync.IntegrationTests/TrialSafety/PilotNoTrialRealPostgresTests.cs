// spec: plr-d10 pilot lane NO-TRIAL (founder, 28 Nov 2026: "the 21-day trial is for the commercial purposes … For the pilot
// testing, we need to prove the thesis")
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
/// <c>Pilot:TrialEnforcementEnabled = false</c> (the shipped default) over the REAL pipeline — tenant middleware, /sync/push, the
/// real <c>DefaultEntitlementPolicy</c>, /shramsafal/farms/mine and the two streaming AI doors — on real Postgres as the app role:
/// <list type="bullet">
/// <item>an Expired farm with no extension is accepted for owner and worker, and the phone is told so (the status stays "Expired");</item>
/// <item>an ended extension or a missing subscription row closes nothing;</item>
/// <item>a deliberately Canceled or Suspended account is still refused, and a stranger is still a stranger.</item>
/// </list>
/// The same seeds with the switch ON are the existing trial-safety tests (the harness defaults it on), which still refuse.
/// </summary>
[Trait("Category", "RequiresPostgres")]
public sealed class PilotNoTrialRealPostgresTests(TrialSafetyDatabase db, ITestOutputHelper output)
    : IClassFixture<TrialSafetyDatabase>
{
    private sealed record Farm(Guid FarmId, Guid Account, Guid Owner, Guid Worker);

    [Fact]
    public async Task An_expired_farm_with_no_extension_is_accepted_for_owner_and_worker_and_the_phone_is_told_so()
    {
        await db.AssertAppRoleIsNotVacuousAsync();
        var farm = await SeedFarmAsync(status: 4, validUntilUtc: DateTime.UtcNow.AddDays(-30));
        await using var app = await db.BuildHostAsync(trialEnforcementEnabled: false);
        using var client = app.GetTestClient();

        var ownerCost = Guid.NewGuid();
        var workerCost = Guid.NewGuid();
        var owner = await PushCostAsync(client, farm, farm.Owner, ownerCost, "pilot-owner");
        var worker = await PushCostAsync(client, farm, farm.Worker, workerCost, "pilot-worker");
        output.WriteLine($"[EVIDENCE] pilot, expired, no extension: owner={owner} worker={worker}");
        owner.Should().Be(("applied", (string?)null));
        worker.Should().Be(("applied", (string?)null));
        (await CostRowsAsync(ownerCost)).Should().Be(1);
        (await CostRowsAsync(workerCost)).Should().Be(1);

        foreach (var who in new[] { farm.Owner, farm.Worker })
        {
            var sub = await SnapshotAsync(client, who, farm.FarmId);
            output.WriteLine($"[EVIDENCE] /farms/mine pilot: {sub}");
            sub.GetProperty("status").GetString().Should().Be("Expired", "the subscription itself is not pretended current");
            sub.GetProperty("allowsOwnerWrites").GetBoolean().Should().BeTrue("the phone must not say मुदत संपली while the server accepts work");
            sub.GetProperty("accessExtendedUntilUtc").ValueKind.Should().Be(JsonValueKind.Null);
        }

        (await db.CountAsync("SELECT count(*) FROM accounts.subscriptions WHERE owner_account_id = @a AND status = 4", ("a", farm.Account)))
            .Should().Be(1, "nothing rewrites the stored subscription");
    }

    [Fact]
    public async Task An_ended_extension_or_a_missing_subscription_row_closes_nothing()
    {
        await db.AssertAppRoleIsNotVacuousAsync();
        var ended = await SeedFarmAsync(status: 4, validUntilUtc: DateTime.UtcNow.AddDays(-30));
        await db.SeedExtensionAsync(ended.Account, DateTime.UtcNow.AddDays(-40), DateTime.UtcNow.AddDays(-1), "pilot-extension-2026-10");
        var noRow = await SeedFarmAsync(status: null, validUntilUtc: default);
        await using var app = await db.BuildHostAsync(trialEnforcementEnabled: false);
        using var client = app.GetTestClient();

        (await PushCostAsync(client, ended, ended.Owner, Guid.NewGuid(), "pilot-ended-extension")).Should().Be(("applied", (string?)null));
        (await PushCostAsync(client, noRow, noRow.Worker, Guid.NewGuid(), "pilot-no-row")).Should().Be(("applied", (string?)null));
    }

    [Theory]
    [InlineData(5, "entitlement.subscriptioncanceled")]
    [InlineData(6, "entitlement.subscriptionsuspended")]
    public async Task A_canceled_or_suspended_account_is_still_refused(int status, string code)
    {
        await db.AssertAppRoleIsNotVacuousAsync();
        var farm = await SeedFarmAsync(status, DateTime.UtcNow.AddDays(-9));
        await using var app = await db.BuildHostAsync(trialEnforcementEnabled: false);
        using var client = app.GetTestClient();

        (await PushCostAsync(client, farm, farm.Owner, Guid.NewGuid(), $"pilot-closed-{status}")).Should().Be(("failed", code),
            "the pilot removes the time limit only; a deliberate cancel or suspension is not a date");
        (await SnapshotAsync(client, farm.Owner, farm.FarmId)).GetProperty("allowsOwnerWrites").GetBoolean().Should().BeFalse();
    }

    [Fact]
    public async Task The_streaming_AI_doors_allow_an_expired_farm_and_still_refuse_a_stranger()
    {
        await db.AssertAppRoleIsNotVacuousAsync();
        var farm = await SeedFarmAsync(status: 4, validUntilUtc: DateTime.UtcNow.AddDays(-30));
        var orchestrator = new StreamingAiGateRealPostgresTests.CountingOrchestrator();
        await using var app = await db.BuildHostAsync(orchestrator, trialEnforcementEnabled: false);
        using var client = app.GetTestClient();

        foreach (var who in new[] { farm.Owner, farm.Worker })
        {
            using var stream = await TrialSafetyDatabase.SendAsync(client, HttpMethod.Post, "/shramsafal/ai/parse-voice-stream", who,
                new { transcript = "आज फवारणी केली.", farmId = farm.FarmId });
            var text = await stream.Content.ReadAsStringAsync();
            output.WriteLine($"[EVIDENCE] parse-voice-stream pilot: {(int)stream.StatusCode}");
            stream.StatusCode.Should().Be(HttpStatusCode.OK, text);
            stream.Content.Headers.ContentType?.MediaType.Should().Be("text/event-stream");
        }

        orchestrator.Calls.Should().Be(2);

        // transcribe-stream (the skip-listed door with its own short read-only transaction): the gate passes, and the request then
        // fails only on the missing audio — the proof that no trial check refused it.
        using (var passed = await PostTranscribeAsync(client, farm.Owner, farm.FarmId))
        {
            var text = await passed.Content.ReadAsStringAsync();
            output.WriteLine($"[EVIDENCE] transcribe-stream pilot: {(int)passed.StatusCode} {text}");
            passed.StatusCode.Should().Be(HttpStatusCode.BadRequest, text);
            text.Should().Contain("audio is required").And.NotContain("entitlement.");
        }

        using (var stranger = await PostTranscribeAsync(client, Guid.NewGuid(), farm.FarmId))
        {
            stranger.StatusCode.Should().Be(HttpStatusCode.Forbidden, "membership is untouched by the pilot switch");
        }
    }

    // ── helpers ──

    private async Task<Farm> SeedFarmAsync(int? status, DateTime validUntilUtc)
    {
        var farm = new Farm(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid());
        await db.SeedAccountAsync(farm.Account, farm.Owner, farm.FarmId);
        await db.SeedFarmAsync(farm.FarmId, farm.Owner, farm.Account, ShramSafal.Domain.Farms.FarmCode.New());
        await db.SeedSeatAsync(farm.FarmId, farm.Account, farm.Worker, "Worker");
        if (status is { } s)
        {
            await db.SeedSubscriptionAsync(farm.Account, s, validUntilUtc);
        }

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
                        ["description"] = "pilot probe purchase", ["amount"] = 250m, ["currencyCode"] = "INR",
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

    private static async Task<JsonElement> SnapshotAsync(HttpClient client, Guid who, Guid farmId)
    {
        using var mine = await TrialSafetyDatabase.SendAsync(client, HttpMethod.Get, "/shramsafal/farms/mine", who);
        var text = await mine.Content.ReadAsStringAsync();
        mine.StatusCode.Should().Be(HttpStatusCode.OK, text);
        var farms = JsonDocument.Parse(text).RootElement.Clone();
        return farms.EnumerateArray().Single(f => f.GetProperty("farmId").GetGuid() == farmId).GetProperty("subscription");
    }

    private static Task<HttpResponseMessage> PostTranscribeAsync(HttpClient client, Guid who, Guid farm)
    {
        var form = new MultipartFormDataContent
        {
            { new StringContent("mr-IN"), "language_hint" },
            { new StringContent(farm.ToString()), "farm_id" },
        };
        return TrialSafetyDatabase.SendAsync(client, HttpMethod.Post, "/shramsafal/ai/transcribe-stream", who, content: form);
    }

    private Task<long> CostRowsAsync(Guid costEntryId) =>
        db.CountAsync("SELECT count(*) FROM ssf.cost_entries WHERE \"Id\" = @id", ("id", costEntryId));
}
