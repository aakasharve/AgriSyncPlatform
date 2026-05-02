using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using FluentAssertions;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using ShramSafal.Api;
using ShramSafal.Application.Ports;
using static ShramSafal.Application.Ports.IEntitlementPolicy;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Logs;
using ShramSafal.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Scenarios;

/// <summary>
/// CEI Phase 4 §4.8 end-to-end scenario — Work Trust Ledger full lifecycle.
///
/// Happy path:
///   Ramu (PrimaryOwner) creates a JobCard → assigns to Vikas (Worker) →
///   Vikas starts and creates a DailyLog → completes the job card →
///   Ramu verifies the log → explicit verify-for-payout → settle (payout) →
///   assert CEI-I8 (single labour_payout cost entry) + worker profile.
///
/// Negative cases:
///   - POST /finance/cost-entry with category=labour_payout → 400
///   - POST /job-cards/{id}/settle on already-PaidOut card → 400
///   - POST /job-cards/{id}/verify-for-payout before log is verified → 400
/// </summary>
public sealed class CEIPhase4EndToEnd
{
    private static readonly Guid RamuUserId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid VikasUserId = Guid.Parse("44444444-4444-4444-4444-444444444444");

    [Fact]
    public async Task WorkTrustLedger_FullLifecycle_HappyAndNegativePaths()
    {
        await using var harness = await TestHarness.CreateAsync();

        // ── STEP 1: Ramu creates a farm + plot + crop cycle ──────────────────
        var farmId = Guid.NewGuid();
        var plotId = Guid.NewGuid();
        var cropCycleId = Guid.NewGuid();

        var pushResult = await harness.AsRamu().PostAsJsonAsync("/sync/push", new
        {
            deviceId = "device-cei4",
            mutations = new object[]
            {
                new
                {
                    clientRequestId = "req-farm4",
                    mutationType = "create_farm",
                    payload = new { farmId, name = "Ramu's Phase4 Farm" }
                },
                new
                {
                    clientRequestId = "req-plot4",
                    mutationType = "create_plot",
                    payload = new { plotId, farmId, name = "Main Block", areaInAcres = 3m }
                },
                new
                {
                    clientRequestId = "req-cycle4",
                    mutationType = "create_crop_cycle",
                    payload = new
                    {
                        cropCycleId,
                        farmId,
                        plotId,
                        cropName = "Grapes",
                        stage = "Harvesting",
                        startDate = "2026-01-01",
                        endDate = "2026-12-31"
                    }
                }
            }
        });
        pushResult.EnsureSuccessStatusCode();

        // Seed Vikas as a Worker on Ramu's farm.
        await harness.SeedFarmMembershipAsync(farmId, VikasUserId, AppRole.Worker);

        // ── STEP 2: Ramu creates a JobCard ────────────────────────────────────
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        using var createJobCardReq = CreateJsonRequest(
            HttpMethod.Post,
            "/shramsafal/job-cards",
            new
            {
                farmId,
                plotId,
                cropCycleId = (Guid?)cropCycleId,
                plannedDate = today.ToString("yyyy-MM-dd"),
                lineItems = new[]
                {
                    new
                    {
                        activityType = "spray",
                        expectedHours = 4m,
                        ratePerHourAmount = 50m,
                        ratePerHourCurrencyCode = "INR",
                        notes = (string?)null
                    }
                },
                clientCommandId = "jc-create-001"
            },
            RamuUserId,
            "shramsafal:PrimaryOwner");

        var createJobCardResp = await harness.Client.SendAsync(createJobCardReq);
        createJobCardResp.StatusCode.Should().Be(HttpStatusCode.Created,
            "Ramu (PrimaryOwner) must be able to create a JobCard");

        Guid jobCardId;
        using (var doc = JsonDocument.Parse(await createJobCardResp.Content.ReadAsStringAsync()))
        {
            jobCardId = doc.RootElement.GetProperty("jobCardId").GetGuid();
            jobCardId.Should().NotBeEmpty("jobCardId must be returned in the 201 response");
        }

        // ── STEP 3: Ramu assigns to Vikas ─────────────────────────────────────
        using var assignReq = CreateJsonRequest(
            HttpMethod.Post,
            $"/shramsafal/job-cards/{jobCardId}/assign",
            new { workerUserId = VikasUserId, clientCommandId = "jc-assign-001" },
            RamuUserId,
            "shramsafal:PrimaryOwner");

        var assignResp = await harness.Client.SendAsync(assignReq);
        assignResp.StatusCode.Should().Be(HttpStatusCode.OK,
            "Ramu (PrimaryOwner) must be able to assign the JobCard to Vikas");

        using (var doc = JsonDocument.Parse(await assignResp.Content.ReadAsStringAsync()))
        {
            // AssignJobCardResult returns JobCardId — status is readable via GET.
            doc.RootElement.GetProperty("jobCardId").GetGuid().Should().Be(jobCardId,
                "AssignJobCard must return the same JobCardId");
        }

        // ── STEP 4: Vikas starts the job ──────────────────────────────────────
        using var startReq = CreateJsonRequest<object?>(
            HttpMethod.Post,
            $"/shramsafal/job-cards/{jobCardId}/start",
            new { clientCommandId = "jc-start-001" },
            VikasUserId,
            "shramsafal:Worker");

        var startResp = await harness.Client.SendAsync(startReq);
        startResp.StatusCode.Should().Be(HttpStatusCode.OK,
            "Vikas (the assigned Worker) must be able to start the JobCard");

        using (var doc = JsonDocument.Parse(await startResp.Content.ReadAsStringAsync()))
        {
            // StartJobCardResult returns JobCardId + StartedAtUtc.
            doc.RootElement.GetProperty("jobCardId").GetGuid().Should().Be(jobCardId,
                "StartJobCard must return the same JobCardId");
            doc.RootElement.GetProperty("startedAtUtc").GetDateTime().Should().NotBe(default,
                "StartedAtUtc must be populated");
        }

        // ── STEP 5: Vikas creates a DailyLog + LogTask ────────────────────────
        using var createLogReq = CreateJsonRequest(
            HttpMethod.Post,
            "/shramsafal/logs",
            new
            {
                farmId,
                plotId,
                cropCycleId = (Guid?)cropCycleId,
                logDate = today.ToString("yyyy-MM-dd"),
                location = (object?)null,
                deviceId = "device-vikas",
                clientRequestId = "log-vikas-001"
            },
            VikasUserId,
            "shramsafal:Worker");

        var createLogResp = await harness.Client.SendAsync(createLogReq);
        createLogResp.EnsureSuccessStatusCode();

        Guid dailyLogId;
        using (var doc = JsonDocument.Parse(await createLogResp.Content.ReadAsStringAsync()))
        {
            // DailyLogDto uses "id" not "dailyLogId".
            dailyLogId = doc.RootElement.GetProperty("id").GetGuid();
            dailyLogId.Should().NotBeEmpty("dailyLogId must be returned");
        }

        // Add a spray task to the log.
        using var addTaskReq = CreateJsonRequest(
            HttpMethod.Post,
            $"/shramsafal/logs/{dailyLogId}/tasks",
            new
            {
                activityType = "spray",
                notes = (string?)null,
                occurredAtUtc = DateTime.UtcNow
            },
            VikasUserId,
            "shramsafal:Worker");
        var addTaskResp = await harness.Client.SendAsync(addTaskReq);
        addTaskResp.EnsureSuccessStatusCode();

        // ── STEP 6: Vikas completes the JobCard (links the DailyLog) ─────────
        using var completeReq = CreateJsonRequest(
            HttpMethod.Post,
            $"/shramsafal/job-cards/{jobCardId}/complete",
            new { dailyLogId, clientCommandId = "jc-complete-001" },
            VikasUserId,
            "shramsafal:Worker");

        var completeResp = await harness.Client.SendAsync(completeReq);
        completeResp.StatusCode.Should().Be(HttpStatusCode.OK,
            "Vikas must be able to complete the JobCard with a linked DailyLog");

        using (var doc = JsonDocument.Parse(await completeResp.Content.ReadAsStringAsync()))
        {
            // CompleteJobCardResult returns JobCardId + LinkedDailyLogId + CompletedAtUtc.
            doc.RootElement.GetProperty("jobCardId").GetGuid().Should().Be(jobCardId,
                "CompleteJobCard must return the same JobCardId");
            doc.RootElement.GetProperty("linkedDailyLogId").GetGuid().Should().Be(dailyLogId,
                "CompleteJobCard result must carry the linked DailyLogId");
        }

        // ── NEGATIVE CASE 14: verify-for-payout before log is verified → 400 ─
        // The log is still in Draft status — VerifyForPayout must reject this.
        using var earlyVerifyReq = CreateJsonRequest<object?>(
            HttpMethod.Post,
            $"/shramsafal/job-cards/{jobCardId}/verify-for-payout",
            new { clientCommandId = (string?)null },
            RamuUserId,
            "shramsafal:PrimaryOwner");

        var earlyVerifyResp = await harness.Client.SendAsync(earlyVerifyReq);
        earlyVerifyResp.StatusCode.Should().Be(HttpStatusCode.BadRequest,
            "CEI-I9: verify-for-payout must be rejected when the linked DailyLog is not yet Verified");

        // ── STEP 7: Ramu verifies the DailyLog (Draft → Confirmed → Verified) ─
        // The VerificationStateMachine requires two steps: Draft → Confirmed → Verified.
        using var confirmLogReq = CreateJsonRequest(
            HttpMethod.Post,
            $"/shramsafal/logs/{dailyLogId}/verify",
            new
            {
                status = "Confirmed",
                reason = (string?)null
            },
            RamuUserId,
            "shramsafal:PrimaryOwner");

        var confirmLogResp = await harness.Client.SendAsync(confirmLogReq);
        confirmLogResp.EnsureSuccessStatusCode();

        using var verifyLogReq = CreateJsonRequest(
            HttpMethod.Post,
            $"/shramsafal/logs/{dailyLogId}/verify",
            new
            {
                status = "Verified",
                reason = (string?)null
            },
            RamuUserId,
            "shramsafal:PrimaryOwner");

        var verifyLogResp = await harness.Client.SendAsync(verifyLogReq);
        verifyLogResp.EnsureSuccessStatusCode();

        using (var doc = JsonDocument.Parse(await verifyLogResp.Content.ReadAsStringAsync()))
        {
            // DailyLogDto uses "lastVerificationStatus".
            doc.RootElement.GetProperty("lastVerificationStatus").GetString().Should().Be("Verified",
                "DailyLog must be Verified after two-step verification");
        }

        // ── STEP 8: Auto-verify-for-payout fired by OnLogVerifiedAutoVerifyJobCard ─
        // CEI-I9 auto-path (commit 207579c) wires OnLogVerifiedAutoVerifyJobCard into
        // VerifyLogHandler, so when STEP 7 verified the DailyLog the linked JobCard was
        // automatically transitioned to VerifiedForPayout — no explicit call needed.
        // We read back via the status filter to prove the auto-transition happened.

        // Assert job card appears in the VerifiedForPayout filter.
        using var getVerifiedJobCardsReq = CreateRequest(
            HttpMethod.Get,
            $"/shramsafal/farms/{farmId}/job-cards?status=VerifiedForPayout",
            RamuUserId,
            "shramsafal:PrimaryOwner");

        var getVerifiedJobCardsResp = await harness.Client.SendAsync(getVerifiedJobCardsReq);
        getVerifiedJobCardsResp.StatusCode.Should().Be(HttpStatusCode.OK);

        using (var doc = JsonDocument.Parse(await getVerifiedJobCardsResp.Content.ReadAsStringAsync()))
        {
            var jobCards = doc.RootElement.EnumerateArray().ToList();
            // JobCardDto uses "id" not "jobCardId".
            jobCards.Should().Contain(jc => jc.GetProperty("id").GetGuid() == jobCardId,
                "The VerifiedForPayout job card must appear when filtered by status=VerifiedForPayout");
        }

        // ── STEP 9: Ramu settles (pays out) ───────────────────────────────────
        using var settleReq = CreateJsonRequest(
            HttpMethod.Post,
            $"/shramsafal/job-cards/{jobCardId}/settle",
            new
            {
                actualPayoutAmount = 200m,
                actualPayoutCurrencyCode = "INR",
                settlementNote = (string?)null,
                clientCommandId = "jc-settle-001"
            },
            RamuUserId,
            "shramsafal:PrimaryOwner");

        var settleResp = await harness.Client.SendAsync(settleReq);
        settleResp.StatusCode.Should().Be(HttpStatusCode.OK,
            "Ramu (PrimaryOwner) must be able to settle the payout");

        Guid costEntryId;
        using (var doc = JsonDocument.Parse(await settleResp.Content.ReadAsStringAsync()))
        {
            // SettleJobCardPayoutResult returns CostEntryId + JobCardStatus.
            // JobCardStatus enum serialized as integer (5 = PaidOut) by default in ASP.NET minimal APIs.
            costEntryId = doc.RootElement.GetProperty("costEntryId").GetGuid();
            costEntryId.Should().NotBeEmpty("a CostEntry id must be returned on settle");
            var statusProp = doc.RootElement.GetProperty("jobCardStatus");
            // Accepts either numeric 5 or string "PaidOut" depending on serializer config.
            var isPaidOut = statusProp.ValueKind == JsonValueKind.Number
                ? statusProp.GetInt32() == (int)ShramSafal.Domain.Work.JobCardStatus.PaidOut
                : statusProp.GetString() == "PaidOut";
            isPaidOut.Should().BeTrue("After settle the JobCard status must be PaidOut (5)");
        }

        // ── STEP 10: CEI-I8 — verify exactly one labour_payout cost entry ─────
        // Access the cost entry directly from the DB to assert category = labour_payout
        // and jobCardId link (the HTTP surface doesn't expose cost-entries-by-jobcard).
        await harness.AssertLabourPayoutCostEntryAsync(costEntryId, jobCardId, 200m);

        // ── STEP 11: Worker profile — assert ReliabilityOverall > 0 ──────────
        // We query as Ramu (shared farm member). VikasUserId must share a farm with Ramu.
        using var profileReq = CreateRequest(
            HttpMethod.Get,
            $"/shramsafal/workers/{VikasUserId}/profile",
            RamuUserId,
            "shramsafal:PrimaryOwner");

        var profileResp = await harness.Client.SendAsync(profileReq);
        profileResp.StatusCode.Should().Be(HttpStatusCode.OK,
            "Ramu (shared-farm member) must be able to view Vikas's worker profile");

        using (var doc = JsonDocument.Parse(await profileResp.Content.ReadAsStringAsync()))
        {
            var overall = doc.RootElement.GetProperty("reliabilityOverall").GetDecimal();
            overall.Should().BeGreaterThan(0,
                "ReliabilityOverall must be > 0 for a registered worker " +
                "(baseline score is 100 when metrics are zero — perfect with no data)");
        }

        // ── NEGATIVE CASE 12: POST cost-entry with category=labour_payout → 400
        using var labourPayoutDirectReq = CreateJsonRequest(
            HttpMethod.Post,
            "/shramsafal/finance/cost-entry",
            new
            {
                farmId,
                plotId = (Guid?)null,
                cropCycleId = (Guid?)null,
                category = "labour_payout",
                description = "direct payout attempt",
                amount = 200m,
                currencyCode = "INR",
                entryDate = today.ToString("yyyy-MM-dd"),
                location = (object?)null,
                clientCommandId = "ce-labour-direct-001"
            },
            RamuUserId,
            "shramsafal:PrimaryOwner");

        var labourPayoutDirectResp = await harness.Client.SendAsync(labourPayoutDirectReq);
        labourPayoutDirectResp.StatusCode.Should().Be(HttpStatusCode.BadRequest,
            "CEI-I8: POST /finance/cost-entry with category='labour_payout' must return 400 — " +
            "labour payouts must only go through the settle-job-card path");

        // ── NEGATIVE CASE 13: settle on a PaidOut card → 400 ─────────────────
        using var doubleSettleReq = CreateJsonRequest(
            HttpMethod.Post,
            $"/shramsafal/job-cards/{jobCardId}/settle",
            new
            {
                actualPayoutAmount = 200m,
                actualPayoutCurrencyCode = "INR",
                settlementNote = (string?)null,
                clientCommandId = "jc-settle-002"
            },
            RamuUserId,
            "shramsafal:PrimaryOwner");

        var doubleSettleResp = await harness.Client.SendAsync(doubleSettleReq);
        doubleSettleResp.StatusCode.Should().Be(HttpStatusCode.BadRequest,
            "Settling an already PaidOut JobCard must return 400 (FSM terminal state guard)");
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    private static HttpRequestMessage CreateJsonRequest<T>(
        HttpMethod method,
        string uri,
        T body,
        Guid userId,
        string membershipClaim)
    {
        var request = CreateRequest(method, uri, userId, membershipClaim);
        if (body is not null)
            request.Content = JsonContent.Create(body);
        return request;
    }

    private static HttpRequestMessage CreateRequest(
        HttpMethod method,
        string uri,
        Guid userId,
        string membershipClaim)
    {
        var request = new HttpRequestMessage(method, uri);
        request.Headers.Add("X-Test-UserId", userId.ToString());
        request.Headers.Add("X-Test-Membership", membershipClaim);
        return request;
    }

    // ─── Test harness ─────────────────────────────────────────────────────────

    private sealed class TestHarness(WebApplication app, HttpClient client, string storageDir) : IAsyncDisposable
    {
        // Expression-bodied to reuse the captured primary-ctor field;
        // `{ get; } = client` would create a second backing field
        // (CS9124).
        public HttpClient Client => client;

        /// <summary>Returns the shared HttpClient which sends requests as the current user
        /// based on per-request headers (see TestAuthHandler). Used for sync push which
        /// reads the default Auth header set on the default client.</summary>
        public HttpClient AsRamu() => client;

        public static async Task<TestHarness> CreateAsync()
        {
            var builder = WebApplication.CreateBuilder(new WebApplicationOptions
            {
                EnvironmentName = "Testing"
            });

            builder.WebHost.UseTestServer();
            var storageDir = Path.Combine(Path.GetTempPath(), "agrisync-cei4-e2e", Guid.NewGuid().ToString("N"));
            builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:ShramSafalDb"] = "Host=localhost;Port=5432;Database=test;Username=test;Password=test",
                ["ShramSafal:Storage:DataDirectory"] = storageDir
            });

            builder.Services
                .AddAuthentication("Test")
                .AddScheme<AuthenticationSchemeOptions, TestAuthHandler>("Test", _ => { });
            builder.Services.AddAuthorization();
            builder.Services.AddBuildingBlocks();
            builder.Services.AddAnalytics(options =>
                options.UseInMemoryDatabase($"cei4-e2e-analytics-{Guid.NewGuid()}"));
            builder.Services.AddShramSafalApi(builder.Configuration);
            builder.Services.RemoveAll<DbContextOptions<ShramSafalDbContext>>();
            builder.Services.RemoveAll<IDbContextOptionsConfiguration<ShramSafalDbContext>>();
            builder.Services.RemoveAll<IEntitlementPolicy>();
            builder.Services.AddScoped<IEntitlementPolicy, AllowEntitlementPolicy>();

            var dbRoot = new InMemoryDatabaseRoot();
            var dbName = $"cei4-e2e-{Guid.NewGuid()}";
            builder.Services.AddDbContext<ShramSafalDbContext>(options =>
                options.UseInMemoryDatabase(dbName, dbRoot));

            builder.Logging.SetMinimumLevel(LogLevel.Warning);

            var app = builder.Build();
            app.UseAuthentication();
            app.UseAuthorization();
            app.MapShramSafalApi();

            await app.StartAsync();
            var client = app.GetTestClient();
            // Default auth for sync/push calls (reads Authorization header via Bearer scheme fallback).
            // Per-user calls use X-Test-UserId / X-Test-Membership headers handled by TestAuthHandler.
            client.DefaultRequestHeaders.Authorization =
                new System.Net.Http.Headers.AuthenticationHeaderValue("Test",
                    $"{RamuUserId}|shramsafal:PrimaryOwner");

            return new TestHarness(app, client, storageDir);
        }

        public async Task SeedFarmMembershipAsync(Guid farmId, Guid userId, AppRole role)
        {
            await using var scope = app.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<ShramSafalDbContext>();
            db.FarmMemberships.Add(FarmMembership.Create(
                Guid.NewGuid(),
                new FarmId(farmId),
                new UserId(userId),
                role,
                DateTime.UtcNow));
            await db.SaveChangesAsync();
        }

        /// <summary>
        /// Directly queries the in-memory DbContext to assert the labour_payout CostEntry
        /// has the correct JobCardId and amount.
        /// </summary>
        public async Task AssertLabourPayoutCostEntryAsync(Guid costEntryId, Guid jobCardId, decimal expectedAmount)
        {
            await using var scope = app.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<ShramSafalDbContext>();

            var entry = await db.Set<ShramSafal.Domain.Finance.CostEntry>()
                .FirstOrDefaultAsync(c => c.Id == costEntryId);

            entry.Should().NotBeNull("the labour_payout CostEntry must exist in the DB");
            entry!.Category.Should().Be("labour_payout",
                "CEI-I8: SettleJobCardPayout must create a CostEntry with category='labour_payout'");
            entry.JobCardId.Should().Be(jobCardId,
                "CEI-I8: the CostEntry must be linked to the JobCard via JobCardId");
            entry.Amount.Should().Be(expectedAmount,
                "the payout amount must match the settled amount");
        }

        public async ValueTask DisposeAsync()
        {
            client.Dispose();
            await app.StopAsync();
            await app.DisposeAsync();
            if (Directory.Exists(storageDir))
                Directory.Delete(storageDir, recursive: true);
        }
    }

    private sealed class AllowEntitlementPolicy : IEntitlementPolicy
    {
        public Task<EntitlementDecision> EvaluateAsync(
            UserId userId, FarmId farmId, PaidFeature feature, CancellationToken ct = default)
            => Task.FromResult(new EntitlementDecision(Allowed: true, EntitlementReason.Allowed, SubscriptionStatus: null));
    }

    private sealed class TestAuthHandler(
        IOptionsMonitor<AuthenticationSchemeOptions> options,
        ILoggerFactory logger,
        UrlEncoder encoder)
        : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
    {
        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            // Per-request user identity from custom headers (set by CreateRequest helpers).
            // Falls back to the default Ramu identity when headers are absent.
            var userId = Request.Headers.TryGetValue("X-Test-UserId", out var userIdHeader) &&
                         Guid.TryParse(userIdHeader, out var parsedUserId)
                ? parsedUserId
                : RamuUserId;

            var membership = Request.Headers.TryGetValue("X-Test-Membership", out var membershipHeader)
                ? membershipHeader.ToString()
                : "shramsafal:PrimaryOwner";

            var claims = new List<Claim>
            {
                new("sub", userId.ToString())
            };
            if (!string.IsNullOrWhiteSpace(membership))
                claims.Add(new Claim("membership", membership));

            var identity = new ClaimsIdentity(claims, Scheme.Name);
            var principal = new ClaimsPrincipal(identity);
            var ticket = new AuthenticationTicket(principal, Scheme.Name);
            return Task.FromResult(AuthenticateResult.Success(ticket));
        }
    }
}
