using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.BuildingBlocks.Auth;
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
        var handler = new VerifyLogHandler(
            repo,
            new NoopAuthorizationEnforcer(),
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

    private sealed class NoopAuthorizationEnforcer : IAuthorizationEnforcer
    {
        public Task EnsureIsFarmMember(UserId userId, FarmId farmId) => Task.CompletedTask;
        public Task EnsureIsOwner(UserId userId, FarmId farmId) => Task.CompletedTask;
        public Task EnsureCanVerify(UserId userId, Guid logId) => Task.CompletedTask;
        public Task EnsureCanEditLog(UserId userId, Guid logId) => Task.CompletedTask;
    }

    /// <summary>
    /// Minimal in-memory repository covering only the handful of calls
    /// CreateDailyLog / VerifyLog make. Anything else throws loudly so a
    /// refactor that routes through a new codepath can't slip past silently.
    /// </summary>
    private sealed class InMemoryShramSafalRepository : IShramSafalRepository
    {
        private readonly Dictionary<Guid, Farm> _farms = new();
        private readonly Dictionary<Guid, Plot> _plots = new();
        private readonly Dictionary<Guid, CropCycle> _cropCycles = new();
        private readonly Dictionary<Guid, DailyLog> _logs = new();
        private readonly Dictionary<(Guid farmId, Guid userId), AppRole> _memberships = new();
        private readonly List<AuditEvent> _auditEvents = new();

        public void AddFarm(Farm farm) => _farms[(Guid)farm.Id] = farm;
        public void AddPlot(Plot plot) => _plots[plot.Id] = plot;
        public void AddCropCycle(CropCycle cc) => _cropCycles[cc.Id] = cc;
        public void AddLog(DailyLog log) => _logs[log.Id] = log;
        public void SetMembership(Guid farmId, Guid userId, AppRole role)
            => _memberships[(farmId, userId)] = role;

        public Task<Farm?> GetFarmByIdAsync(Guid farmId, CancellationToken ct = default)
            => Task.FromResult(_farms.TryGetValue(farmId, out var f) ? f : null);

        public Task<Plot?> GetPlotByIdAsync(Guid plotId, CancellationToken ct = default)
            => Task.FromResult(_plots.TryGetValue(plotId, out var p) ? p : null);

        public Task<CropCycle?> GetCropCycleByIdAsync(Guid cropCycleId, CancellationToken ct = default)
            => Task.FromResult(_cropCycles.TryGetValue(cropCycleId, out var c) ? c : null);

        public Task<DailyLog?> GetDailyLogByIdAsync(Guid dailyLogId, CancellationToken ct = default)
            => Task.FromResult(_logs.TryGetValue(dailyLogId, out var l) ? l : null);

        public Task<DailyLog?> GetDailyLogByIdempotencyKeyAsync(string idempotencyKey, CancellationToken ct = default)
            => Task.FromResult(_logs.Values.FirstOrDefault(l => l.IdempotencyKey == idempotencyKey));

        public Task AddDailyLogAsync(DailyLog log, CancellationToken ct = default)
        {
            _logs[log.Id] = log;
            return Task.CompletedTask;
        }

        public Task AddAuditEventAsync(AuditEvent auditEvent, CancellationToken ct = default)
        {
            _auditEvents.Add(auditEvent);
            return Task.CompletedTask;
        }

        public Task<bool> IsUserMemberOfFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default)
            => Task.FromResult(_memberships.ContainsKey((farmId, userId)));

        public Task<AppRole?> GetUserRoleForFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default)
            => Task.FromResult<AppRole?>(
                _memberships.TryGetValue((farmId, userId), out var r) ? r : null);

        public Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;

        // --- Everything below is intentionally not wired for these tests.
        public Task AddFarmAsync(Farm farm, CancellationToken ct = default) => throw new NotImplementedException();
        public Task AddFarmMembershipAsync(FarmMembership membership, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<FarmMembership?> GetFarmMembershipAsync(Guid farmId, Guid userId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<bool> IsUserOwnerOfFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task AddPlotAsync(Plot plot, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<Plot>> GetPlotsByFarmIdAsync(Guid farmId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task AddCropCycleAsync(CropCycle cropCycle, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<CropCycle>> GetCropCyclesByPlotIdAsync(Guid plotId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task AddCostEntryAsync(CostEntry costEntry, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<CostEntry?> GetCostEntryByIdAsync(Guid costEntryId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<CostEntry>> GetCostEntriesByIdsAsync(IEnumerable<Guid> costEntryIds, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<CostEntry>> GetCostEntriesForDuplicateCheck(FarmId farmId, Guid? plotId, string category, DateTime since, CancellationToken ct = default) => throw new NotImplementedException();
        public Task AddFinanceCorrectionAsync(FinanceCorrection correction, CancellationToken ct = default) => throw new NotImplementedException();
        public Task AddDayLedgerAsync(DayLedger dayLedger, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<DayLedger?> GetDayLedgerByIdAsync(Guid dayLedgerId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<DayLedger?> GetDayLedgerBySourceCostEntryIdAsync(Guid costEntryId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<DayLedger>> GetDayLedgersForFarm(Guid farmId, DateOnly from, DateOnly to, CancellationToken ct = default) => throw new NotImplementedException();
        public Task AddAttachmentAsync(Attachment attachment, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<Attachment?> GetAttachmentByIdAsync(Guid attachmentId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<Attachment>> GetAttachmentsForEntityAsync(Guid entityId, string entityType, CancellationToken ct = default) => throw new NotImplementedException();
        public Task AddPriceConfigAsync(PriceConfig config, CancellationToken ct = default) => throw new NotImplementedException();
        public Task AddScheduleTemplateAsync(ScheduleTemplate template, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<ScheduleTemplate>> GetScheduleTemplatesAsync(CancellationToken ct = default) => throw new NotImplementedException();
        public Task AddPlannedActivitiesAsync(IEnumerable<PlannedActivity> plannedActivities, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<PlannedActivity?> GetPlannedActivityByIdAsync(Guid id, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<PlannedActivity>> GetPlannedActivitiesByCropCycleIdAsync(Guid cropCycleId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<LogTask>> GetExecutedTasksByCropCycleIdAsync(Guid cropCycleId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<CostEntry>> GetCostEntriesAsync(DateOnly? fromDate, DateOnly? toDate, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<FinanceCorrection>> GetCorrectionsForEntriesAsync(IEnumerable<Guid> costEntryIds, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<Farm>> GetFarmsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<Plot>> GetPlotsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<CropCycle>> GetCropCyclesChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<DailyLog>> GetDailyLogsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<CostEntry>> GetCostEntriesChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<FinanceCorrection>> GetFinanceCorrectionsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<DayLedger>> GetDayLedgersChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<PriceConfig>> GetPriceConfigsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<PlannedActivity>> GetPlannedActivitiesChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<Attachment>> GetAttachmentsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<AuditEvent>> GetAuditEventsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<AuditEvent>> GetAuditEventsForEntityAsync(Guid entityId, string entityType, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<AuditEvent>> GetAuditEventsForFarmAsync(Guid farmId, DateOnly from, DateOnly to, int limit, int offset, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<Guid>> GetFarmIdsForUserAsync(Guid userId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<IReadOnlyList<SyncOperatorDto>> GetOperatorsByIdsAsync(IEnumerable<Guid> userIds, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<int> CountActivePrimaryOwnersAsync(Guid farmId, CancellationToken ct = default) => throw new NotImplementedException();

        public Task AddCropScheduleTemplateAsync(CropScheduleTemplate template, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<CropScheduleTemplate?> GetCropScheduleTemplateByIdAsync(ScheduleTemplateId templateId, CancellationToken ct = default) => Task.FromResult<CropScheduleTemplate?>(null);
        public Task<List<CropScheduleTemplate>> GetCropScheduleTemplatesForCropAsync(string cropKey, string? regionCode, CancellationToken ct = default) => throw new NotImplementedException();
        public Task AddScheduleSubscriptionAsync(ScheduleSubscription subscription, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<ScheduleSubscription?> GetScheduleSubscriptionByIdAsync(ScheduleSubscriptionId subscriptionId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<ScheduleSubscription?> GetActiveScheduleSubscriptionAsync(Guid plotId, string cropKey, Guid cropCycleId, CancellationToken ct = default) => Task.FromResult<ScheduleSubscription?>(null);
        public Task AddScheduleMigrationEventAsync(ScheduleMigrationEvent migrationEvent, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<ScheduleTemplate?> GetScheduleTemplateByIdAsync(Guid templateId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<bool> HasActiveOwnerMembershipAsync(Guid userId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<ShramSafal.Domain.Planning.ScheduleTemplate>> GetScheduleLineageAsync(Guid rootTemplateId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<int> GetDisputedLogCountForPlotAsync(Guid plotId, CancellationToken ct = default) => throw new NotSupportedException();
    
    // Sub-plan 03 Task 5 (T-IGH-03-PORT-COMPLETE-MIGRATION):
    // required interface members; no-op in this test stub.
    public Task AddFarmBoundaryAsync(ShramSafal.Domain.Farms.FarmBoundary boundary, CancellationToken ct = default) => Task.CompletedTask;
    public Task AddJobCardAsync(ShramSafal.Domain.Work.JobCard jobCard, CancellationToken ct = default) => Task.CompletedTask;
}
}
