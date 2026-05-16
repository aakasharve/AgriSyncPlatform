// spec: data-principle-spine-2026-05-05/04.6
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Security.Claims;
using System.Text.Encodings.Web;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Application;
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
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Application.UseCases.Logs.AddLogTask;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Application.UseCases.Logs.VerifyLog;
using ShramSafal.Domain.AI;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Crops;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Logs;
using ShramSafal.Infrastructure.Persistence;
using Xunit;

namespace ShramSafal.Sync.IntegrationTests.Audit;

/// <summary>
/// DATA_PRINCIPLE_SPINE_2026-05-05 sub-phase 04.6 — proves the audit ledger is
/// reconstructable end-to-end. Given a single <c>daily_log</c> id, the audit
/// chain reads back as a complete <c>(actor, when, app_version, device_id,
/// ip_hash, source_ai_job_id)</c> lineage across the log's three-event
/// lifecycle: <c>Created</c> → <c>TaskAdded</c> → <c>VerificationChanged</c>.
///
/// <para>
/// The spec's prose lists <c>Created → Verified → Flagged</c> as the lifecycle,
/// but there is no <c>FlagDailyLog</c> handler in the repo today. The realistic
/// three-event chain a daily-log lifecycle emits today (per the handler bodies)
/// is the one asserted here. The semantic the spec cares about — every audit
/// row carries the forensic provenance trio plus a back-link to the AI job for
/// voice-created rows — is unchanged.
/// </para>
///
/// <para>
/// Drives the handlers directly via <see cref="IHandler{TCommand, TResult}"/>
/// resolved from the test scope (option a from the spec), so the assertions
/// target the audit shape the handlers commit rather than the HTTP envelope.
/// </para>
/// </summary>
public sealed class AuditReconstructionTests
{
    private static readonly Guid TestUserId = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid FarmGuid = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid PlotGuid = Guid.Parse("33333333-3333-3333-3333-333333333333");
    private static readonly Guid CropCycleGuid = Guid.Parse("44444444-4444-4444-4444-444444444444");
    private static readonly Guid AiJobGuid = Guid.Parse("66666666-6666-6666-6666-666666666666");

    private const string TestAppVersion = "1.0.0-test";
    private const string TestDeviceId = "test-device-001";
    private const string TestIpHash = "sha256:test-ip-hash";

    [Fact]
    public async Task Daily_log_lifecycle_can_be_fully_reconstructed_from_audit()
    {
        await using var harness = await TestHarness.CreateAsync();
        await harness.SeedFarmAndCropCycleAsync();
        await harness.SeedVoiceAiJobAsync(AiJobGuid);

        // ---- Step 1: Create the daily log via a voice-confirm path so the
        // first audit row's SourceAiJobId is non-null.
        DailyLogDto createdLog;
        await using (var scope = harness.CreateScope())
        {
            var createHandler = scope.ServiceProvider
                .GetRequiredService<IHandler<CreateDailyLogCommand, DailyLogDto>>();

            var createCommand = new CreateDailyLogCommand(
                FarmId: FarmGuid,
                PlotId: PlotGuid,
                CropCycleId: CropCycleGuid,
                RequestedByUserId: TestUserId,
                OperatorUserId: TestUserId,
                LogDate: new DateOnly(2026, 5, 14),
                Location: null,
                DeviceId: "device-1",
                ClientRequestId: $"create-{Guid.NewGuid():N}",
                DailyLogId: null,
                ActorRole: "primary_owner",
                SourceAiJobId: AiJobGuid,
                ClientAppVersion: TestAppVersion,
                AuditDeviceId: TestDeviceId,
                AuditIpHash: TestIpHash);

            var createResult = await createHandler.HandleAsync(createCommand);
            createResult.IsSuccess.Should().BeTrue(
                $"CreateDailyLog must succeed (got error: {createResult.Error?.Code})");
            createdLog = createResult.Value!;
        }

        // ---- Step 2: Add a task to that log.
        await using (var scope = harness.CreateScope())
        {
            var addTaskHandler = scope.ServiceProvider
                .GetRequiredService<IHandler<AddLogTaskCommand, DailyLogDto>>();

            var addTaskCommand = new AddLogTaskCommand(
                DailyLogId: createdLog.Id,
                ActivityType: "Spraying",
                Notes: "neem spray morning",
                OccurredAtUtc: new DateTime(2026, 5, 14, 8, 0, 0, DateTimeKind.Utc),
                LogTaskId: null,
                ActorUserId: TestUserId,
                ActorRole: "primary_owner",
                ClientCommandId: $"task-{Guid.NewGuid():N}",
                ExecutionStatus: ExecutionStatus.Completed,
                DeviationReasonCode: null,
                DeviationNote: null,
                ClientAppVersion: TestAppVersion,
                AuditDeviceId: TestDeviceId,
                AuditIpHash: TestIpHash);

            var addTaskResult = await addTaskHandler.HandleAsync(addTaskCommand);
            addTaskResult.IsSuccess.Should().BeTrue(
                $"AddLogTask must succeed (got error: {addTaskResult.Error?.Code})");
        }

        // ---- Step 3: Verify the log (owner-tier action that emits a
        // VerificationChanged audit row through VerifyLogHandler).
        await using (var scope = harness.CreateScope())
        {
            var verifyHandler = scope.ServiceProvider
                .GetRequiredService<IHandler<VerifyLogCommand, DailyLogDto>>();

            var verifyCommand = new VerifyLogCommand(
                DailyLogId: createdLog.Id,
                TargetStatus: VerificationStatus.Confirmed,
                Reason: "looks good",
                VerifiedByUserId: TestUserId,
                VerificationEventId: null,
                ActorRole: "primary_owner",
                ClientCommandId: $"verify-{Guid.NewGuid():N}",
                ClientAppVersion: TestAppVersion,
                AuditDeviceId: TestDeviceId,
                AuditIpHash: TestIpHash);

            var verifyResult = await verifyHandler.HandleAsync(verifyCommand);
            verifyResult.IsSuccess.Should().BeTrue(
                $"VerifyLog must succeed (got error: {verifyResult.Error?.Code})");
        }

        // ---- Assert the chain reconstructs in full.
        await using (var scope = harness.CreateScope())
        {
            var db = scope.ServiceProvider.GetRequiredService<ShramSafalDbContext>();

            var chain = await db.AuditEvents
                .Where(a => a.EntityType == "DailyLog" && a.EntityId == createdLog.Id)
                .OrderBy(a => a.OccurredAtUtc)
                .ToListAsync();

            chain.Should().HaveCount(3,
                "the lifecycle emits exactly three audit rows: Created, TaskAdded, VerificationChanged");

            chain[0].Action.Should().Be("Created");
            chain[1].Action.Should().Be("TaskAdded");
            chain[2].Action.Should().Be("VerificationChanged");

            // P6 — forensic trio must be present on every row.
            chain.Should().AllSatisfy(row =>
            {
                row.AppVersion.Should().NotBeNullOrEmpty(
                    "every audit row must carry the client-stamped app_version (P6)");
                row.DeviceId.Should().NotBeNullOrEmpty(
                    "every audit row must carry the X-Device-Id (P6)");
                row.IpHash.Should().NotBeNullOrEmpty(
                    "every audit row must carry the salted remote-IP hash (P6)");
                row.IpHash.Should().StartWith("sha256:",
                    "the ip_hash column is a salted SHA-256 — every value must be prefixed " +
                    "with the algorithm tag so downstream tooling can validate the format");
                row.FarmId.Should().NotBeNull(
                    "the row must back-link to the farm so multi-tenant audit slicing works");
                row.FarmId!.Value.Should().Be(FarmGuid,
                    "the audit row's FarmId must equal the seeded farm id");
            });

            // P8 — voice-created rows back-link to the AI job that produced the
            // parsed draft. Only the Created row was emitted on the voice path;
            // TaskAdded and VerificationChanged hand `sourceAiJobId: null` to
            // the factory per their handler code.
            chain[0].SourceAiJobId.Should().Be(AiJobGuid,
                "voice-confirmed Create rows must back-link to the originating AiJob (P8)");
            chain[1].SourceAiJobId.Should().BeNull(
                "TaskAdded does not originate from an AI parse — its handler passes null");
            chain[2].SourceAiJobId.Should().BeNull(
                "VerificationChanged does not originate from an AI parse — its handler passes null");
        }
    }

    // -----------------------------------------------------------------------
    // Test harness (mirrors CEIPhase1EndToEnd.TestHarness but exposes a
    // CreateScope helper + seed methods specific to this lineage scenario).
    // -----------------------------------------------------------------------

    private sealed class TestHarness(WebApplication app, HttpClient client, string storageDirectory) : IAsyncDisposable
    {
        public HttpClient Client { get; } = client;

        public AsyncServiceScope CreateScope() => app.Services.CreateAsyncScope();

        public static async Task<TestHarness> CreateAsync()
        {
            var builder = WebApplication.CreateBuilder(new WebApplicationOptions
            {
                EnvironmentName = "Testing"
            });

            builder.WebHost.UseTestServer();
            var storageDirectory = Path.Combine(
                Path.GetTempPath(),
                "agrisync-audit-reconstruction-tests",
                Guid.NewGuid().ToString("N"));
            builder.Configuration.AddInMemoryCollection(new Dictionary<string, string?>
            {
                ["ConnectionStrings:ShramSafalDb"] = "Host=localhost;Port=5432;Database=test;Username=test;Password=test",
                ["ShramSafal:Storage:DataDirectory"] = storageDirectory
            });

            builder.Services
                .AddAuthentication("Test")
                .AddScheme<AuthenticationSchemeOptions, TestAuthHandler>("Test", _ => { });
            builder.Services.AddAuthorization();
            builder.Services.AddBuildingBlocks();
            builder.Services.AddAnalytics(options =>
                options.UseInMemoryDatabase($"audit-reconstruction-analytics-{Guid.NewGuid()}"));
            builder.Services.AddShramSafalApi(builder.Configuration);
            builder.Services.RemoveAll<DbContextOptions<ShramSafalDbContext>>();
            builder.Services.RemoveAll<IDbContextOptionsConfiguration<ShramSafalDbContext>>();
            builder.Services.RemoveAll<IEntitlementPolicy>();
            builder.Services.AddScoped<IEntitlementPolicy, AllowEntitlementPolicy>();

            var dbName = $"audit-reconstruction-{Guid.NewGuid()}";
            var dbRoot = new InMemoryDatabaseRoot();
            builder.Services.AddDbContext<ShramSafalDbContext>(options =>
                options.UseInMemoryDatabase(dbName, dbRoot));

            builder.Logging.SetMinimumLevel(LogLevel.Warning);

            var app = builder.Build();
            app.UseAuthentication();
            app.UseAuthorization();
            app.MapShramSafalApi();

            await app.StartAsync();
            var client = app.GetTestClient();
            return new TestHarness(app, client, storageDirectory);
        }

        public async Task SeedFarmAndCropCycleAsync()
        {
            await using var scope = app.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<ShramSafalDbContext>();

            var nowUtc = new DateTime(2026, 5, 1, 0, 0, 0, DateTimeKind.Utc);

            db.Farms.Add(Farm.Create(
                new FarmId(FarmGuid),
                "Reconstruction Test Farm",
                new UserId(TestUserId),
                nowUtc));

            db.Plots.Add(Plot.Create(
                PlotGuid,
                new FarmId(FarmGuid),
                "Plot A",
                1.0m,
                nowUtc));

            db.CropCycles.Add(CropCycle.Create(
                CropCycleGuid,
                new FarmId(FarmGuid),
                PlotGuid,
                "Grapes",
                "Fruiting",
                new DateOnly(2026, 1, 1),
                null,
                nowUtc));

            // PrimaryOwner so the VerifyLog pipeline (owner-tier) passes.
            db.FarmMemberships.Add(FarmMembership.Create(
                Guid.NewGuid(),
                new FarmId(FarmGuid),
                new UserId(TestUserId),
                AppRole.PrimaryOwner,
                nowUtc));

            await db.SaveChangesAsync();
        }

        public async Task SeedVoiceAiJobAsync(Guid aiJobId)
        {
            await using var scope = app.Services.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<ShramSafalDbContext>();

            var voiceProvenance = new Provenance(
                source: Source.Voice,
                modelVersion: "gemini-2.5-flash",
                promptVersion: "v3.2.0",
                promptContentHash: "abc123abc123abc123abc123abc123abc123abc123abc123abc123abc123abc1",
                appVersion: "0.9.0-pre-confirm");

            var aiJob = AiJob.Create(
                id: aiJobId,
                idempotencyKey: $"voice-job-{aiJobId:N}",
                operationType: AiOperationType.VoiceToStructuredLog,
                userId: TestUserId,
                farmId: FarmGuid,
                inputContentHash: null,
                rawInputRef: null,
                inputSessionMetadataJson: null,
                provenance: voiceProvenance);

            db.AiJobs.Add(aiJob);
            await db.SaveChangesAsync();
        }

        public async ValueTask DisposeAsync()
        {
            Client.Dispose();
            await app.StopAsync();
            await app.DisposeAsync();
            if (Directory.Exists(storageDirectory))
            {
                try
                {
                    Directory.Delete(storageDirectory, recursive: true);
                }
                catch (IOException)
                {
                    // best-effort cleanup
                }
            }
        }
    }

    private sealed class TestAuthHandler(
        IOptionsMonitor<AuthenticationSchemeOptions> options,
        ILoggerFactory logger,
        UrlEncoder encoder)
        : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
    {
        protected override Task<AuthenticateResult> HandleAuthenticateAsync()
        {
            var claims = new List<Claim>
            {
                new("sub", TestUserId.ToString()),
                new("membership", "shramsafal:PrimaryOwner")
            };

            var identity = new ClaimsIdentity(claims, Scheme.Name);
            var principal = new ClaimsPrincipal(identity);
            var ticket = new AuthenticationTicket(principal, Scheme.Name);
            return Task.FromResult(AuthenticateResult.Success(ticket));
        }
    }

    private sealed class AllowEntitlementPolicy : IEntitlementPolicy
    {
        public Task<EntitlementDecision> EvaluateAsync(
            UserId userId,
            FarmId farmId,
            PaidFeature feature,
            CancellationToken ct = default)
            => Task.FromResult(new EntitlementDecision(
                Allowed: true,
                EntitlementReason.Allowed,
                SubscriptionStatus: null));
    }
}
