using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Logs.CreateDailyLog;
using ShramSafal.Application.UseCases.Logs.VerifyLog;
using ShramSafal.Application.UseCases.Work.Handlers;
using ShramSafal.Application.UseCases.Work.VerifyJobCardForPayout;
using ShramSafal.Domain.AI;
using ShramSafal.Domain.Attachments;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Crops;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.Schedules;
using Xunit;

namespace ShramSafal.Domain.Tests.Logs;

/// <summary>
/// Phase 2 Batch C — MIS Integration. Verifies that CreateDailyLogHandler and
/// VerifyLogHandler each emit exactly one AnalyticsEvent on their success
/// path, with the expected event type, actor, farm, and props shape.
/// </summary>
public sealed class LogHandlerAnalyticsTests
{
    [Fact]
    public async Task CreateDailyLog_EmitsLogCreatedAnalyticsEvent_OnSuccess()
    {
        var farmGuid = Guid.NewGuid();
        var farmId = new FarmId(farmGuid);
        var ownerGuid = Guid.NewGuid();
        var ownerUserId = new UserId(ownerGuid);
        var plotGuid = Guid.NewGuid();
        var cropCycleGuid = Guid.NewGuid();
        var now = new DateTime(2026, 4, 19, 10, 0, 0, DateTimeKind.Utc);

        var repo = new InMemoryShramSafalRepository();
        repo.AddFarm(Farm.Create(farmId, "Test Farm", ownerUserId, now));
        repo.AddPlot(Plot.Create(plotGuid, farmId, "Plot A", 2.5m, now));
        repo.AddCropCycle(CropCycle.Create(
            cropCycleGuid, farmId, plotGuid, "Grapes", "Veraison",
            new DateOnly(2026, 1, 1), null, now));
        repo.SetMembership(farmGuid, ownerGuid, AppRole.PrimaryOwner);

        var analytics = new CapturingAnalyticsWriter();
        var handler = new CreateDailyLogHandler(
            repo,
            new FixedIdGenerator(Guid.NewGuid()),
            new FixedClock(now),
            new AllowAllEntitlementPolicy(),
            analytics);

        var command = new CreateDailyLogCommand(
            FarmId: farmGuid,
            PlotId: plotGuid,
            CropCycleId: cropCycleGuid,
            RequestedByUserId: ownerGuid,
            OperatorUserId: ownerGuid,
            LogDate: new DateOnly(2026, 4, 19),
            Location: null,
            DeviceId: "device-1",
            ClientRequestId: "req-1",
            DailyLogId: null,
            ActorRole: "primaryowner");

        var result = await handler.HandleAsync(command);

        Assert.True(result.IsSuccess);
        var evt = Assert.Single(analytics.Events);
        Assert.Equal(AnalyticsEventType.LogCreated, evt.EventType);
        Assert.Equal(new UserId(ownerGuid), evt.ActorUserId);
        Assert.Equal(farmId, evt.FarmId);
        Assert.Null(evt.OwnerAccountId);
        Assert.Equal("primaryowner", evt.ActorRole);
        Assert.Equal("manual", evt.Trigger);
        Assert.Equal("v1", evt.SchemaVersion);
        Assert.Equal(now, evt.OccurredAtUtc);

        using var props = JsonDocument.Parse(evt.PropsJson);
        var root = props.RootElement;
        Assert.Equal(plotGuid, root.GetProperty("plotId").GetGuid());
        Assert.Equal(cropCycleGuid, root.GetProperty("cropCycleId").GetGuid());
        // Phase 3 stubs — present but null.
        Assert.Equal(JsonValueKind.Null, root.GetProperty("scheduleSubscriptionId").ValueKind);
        Assert.Equal(JsonValueKind.Null, root.GetProperty("matchedTaskId").ValueKind);
        Assert.Equal(JsonValueKind.Null, root.GetProperty("deltaDaysVsSchedule").ValueKind);
        Assert.Equal(JsonValueKind.Null, root.GetProperty("complianceOutcome").ValueKind);
    }

    [Fact]
    public async Task VerifyLog_EmitsLogVerifiedAnalyticsEvent_OnSuccess()
    {
        var farmGuid = Guid.NewGuid();
        var farmId = new FarmId(farmGuid);
        var operatorGuid = Guid.NewGuid();
        var verifierGuid = Guid.NewGuid();
        var plotGuid = Guid.NewGuid();
        var cropCycleGuid = Guid.NewGuid();
        var createdAt = new DateTime(2026, 4, 18, 10, 0, 0, DateTimeKind.Utc);
        var verifyAt = new DateTime(2026, 4, 19, 12, 0, 0, DateTimeKind.Utc);

        // Seed a log in Confirmed state so an owner can transition it to Verified.
        var log = DailyLog.Create(
            id: Guid.NewGuid(),
            farmId: farmId,
            plotId: plotGuid,
            cropCycleId: cropCycleGuid,
            operatorUserId: new UserId(operatorGuid),
            logDate: new DateOnly(2026, 4, 18),
            idempotencyKey: null,
            location: null,
            createdAtUtc: createdAt);

        // Driver pushes Draft -> Confirmed.
        log.Verify(
            verificationEventId: Guid.NewGuid(),
            status: VerificationStatus.Confirmed,
            reason: null,
            callerRole: AppRole.Worker,
            verifiedByUserId: new UserId(operatorGuid),
            occurredAtUtc: createdAt.AddHours(1));

        var repo = new InMemoryShramSafalRepository();
        repo.AddLog(log);
        repo.SetMembership(farmGuid, verifierGuid, AppRole.PrimaryOwner);

        var analytics = new CapturingAnalyticsWriter();
        var fixedClock = new FixedClock(verifyAt);
        var autoVerify = new OnLogVerifiedAutoVerifyJobCard(
            repo,
            new VerifyJobCardForPayoutHandler(repo, fixedClock),
            fixedClock,
            Microsoft.Extensions.Logging.Abstractions.NullLogger<OnLogVerifiedAutoVerifyJobCard>.Instance);
        // T-IGH-03-PIPELINE-ROLLOUT (VerifyLog): the ctor no longer takes
        // IAuthorizationEnforcer (the strict owner-tier check moved to
        // VerifyLogAuthorizer). This direct-construction path exercises
        // the body verbatim — pipeline-level coverage lives in
        // VerifyLogPipelineTests.
        var handler = new VerifyLogHandler(
            repo,
            new FixedIdGenerator(Guid.NewGuid()),
            fixedClock,
            new AllowAllEntitlementPolicy(),
            analytics,
            autoVerify);

        var command = new VerifyLogCommand(
            DailyLogId: log.Id,
            TargetStatus: VerificationStatus.Verified,
            Reason: null,
            VerifiedByUserId: verifierGuid,
            VerificationEventId: null,
            ActorRole: null,
            ClientCommandId: "cmd-verify-1");

        var result = await handler.HandleAsync(command);

        Assert.True(result.IsSuccess);
        var evt = Assert.Single(analytics.Events);
        Assert.Equal(AnalyticsEventType.LogVerified, evt.EventType);
        Assert.Equal(new UserId(verifierGuid), evt.ActorUserId);
        Assert.Equal(farmId, evt.FarmId);
        Assert.Null(evt.OwnerAccountId);
        // ActorRole falls back to the resolved caller role (lowercased).
        Assert.Equal("primaryowner", evt.ActorRole);
        Assert.Equal("manual", evt.Trigger);
        Assert.Equal("v1", evt.SchemaVersion);
        Assert.Equal(verifyAt, evt.OccurredAtUtc);

        using var props = JsonDocument.Parse(evt.PropsJson);
        var root = props.RootElement;
        Assert.Equal(log.Id, root.GetProperty("logId").GetGuid());
        Assert.Equal(verifierGuid, root.GetProperty("verifierUserId").GetGuid());
        Assert.Equal(verifyAt, root.GetProperty("verifiedAtUtc").GetDateTime());
        Assert.Equal("Confirmed", root.GetProperty("priorState").GetString());
        Assert.Equal("Verified", root.GetProperty("newState").GetString());
    }

    // ---- Test doubles -----------------------------------------------------

    private sealed class CapturingAnalyticsWriter : IAnalyticsWriter
    {
        public List<AnalyticsEvent> Events { get; } = new();
        public Task EmitAsync(AnalyticsEvent e, CancellationToken ct = default)
        {
            Events.Add(e);
            return Task.CompletedTask;
        }

        public Task EmitManyAsync(IEnumerable<AnalyticsEvent> events, CancellationToken ct = default)
        {
            Events.AddRange(events);
            return Task.CompletedTask;
        }
    }

    private sealed class FixedClock : IClock
    {
        public FixedClock(DateTime utcNow) { UtcNow = utcNow; }
        public DateTime UtcNow { get; }
    }

    private sealed class FixedIdGenerator : IIdGenerator
    {
        private readonly Guid _id;
        public FixedIdGenerator(Guid id) { _id = id; }
        public Guid New() => _id;
    }

    private sealed class AllowAllEntitlementPolicy : IEntitlementPolicy
    {
        public Task<EntitlementDecision> EvaluateAsync(
            UserId userId, FarmId farmId, PaidFeature feature, CancellationToken ct = default)
            => Task.FromResult(new EntitlementDecision(true, EntitlementReason.Allowed, null));
    }

    // T-IGH-03-PIPELINE-ROLLOUT (VerifyLog): NoopAuthorizationEnforcer
    // was a private double for the now-dropped IAuthorizationEnforcer
    // ctor arg on VerifyLogHandler. The strict owner-tier check moved
    // to VerifyLogAuthorizer (covered by VerifyLogPipelineTests); the
    // body's defense-in-depth membership check is exercised by the
    // direct-construction path here via the seeded
    // PrimaryOwner membership on InMemoryShramSafalRepository.

    // T-IGH-03-PIPELINE-ROLLOUT (VerifyLog): InMemoryShramSafalRepository
    // moved to its own file (Logs/InMemoryShramSafalRepository.cs) so the
    // new VerifyLogPipelineTests can reuse the same seedable repo.
}
