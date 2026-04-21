using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Farms;
using ShramSafal.Application.UseCases.Farms.CreatePlot;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Farms;
using Xunit;

namespace ShramSafal.Domain.Tests.Regression;

/// <summary>
/// Spec §9 regression: subscription expiry blocks paid features but NOT
/// worker visibility (spec §D6).
/// </summary>
public sealed class SubscriptionEntitlementTests
{
    [Fact]
    public async Task CreatePlot_Denied_When_SubscriptionExpired()
    {
        var farmId = new FarmId(Guid.NewGuid());
        var userId = new UserId(Guid.NewGuid());

        var fakeRepo = new FakeRepo(farmId, userId, AppRole.PrimaryOwner);
        var denyPolicy = new DenyAllEntitlementPolicy();
        var handler = new CreatePlotHandler(fakeRepo, new GuidIdGenerator(), new SystemClock(), denyPolicy, new NullAnalyticsWriter());

        var command = new CreatePlotCommand(farmId.Value, "Plot A", 1.5m, userId.Value, null, "PrimaryOwner", null);
        var result = await handler.HandleAsync(command);

        Assert.True(result.IsFailure);
        Assert.Contains("entitlement", result.Error.Code);
    }

    [Fact]
    public async Task CreatePlot_Allowed_When_SubscriptionActive()
    {
        var farmId = new FarmId(Guid.NewGuid());
        var userId = new UserId(Guid.NewGuid());

        var fakeRepo = new FakeRepo(farmId, userId, AppRole.PrimaryOwner);
        var allowPolicy = new AllowAllEntitlementPolicy();
        var handler = new CreatePlotHandler(fakeRepo, new GuidIdGenerator(), new SystemClock(), allowPolicy, new NullAnalyticsWriter());

        var command = new CreatePlotCommand(farmId.Value, "Plot A", 1.5m, userId.Value, null, "PrimaryOwner", null);
        var result = await handler.HandleAsync(command);

        Assert.True(result.IsSuccess);
    }

    // --- Stubs ---

    private sealed class DenyAllEntitlementPolicy : IEntitlementPolicy
    {
        public Task<EntitlementDecision> EvaluateAsync(UserId userId, FarmId farmId, PaidFeature feature, CancellationToken ct = default)
            => Task.FromResult(new EntitlementDecision(false, EntitlementReason.SubscriptionExpired, 4));
    }

    private sealed class AllowAllEntitlementPolicy : IEntitlementPolicy
    {
        public Task<EntitlementDecision> EvaluateAsync(UserId userId, FarmId farmId, PaidFeature feature, CancellationToken ct = default)
            => Task.FromResult(new EntitlementDecision(true, EntitlementReason.Allowed, null));
    }

    private sealed class FakeRepo : IShramSafalRepository
    {
        private readonly FarmId _farmId;
        private readonly UserId _userId;
        private readonly AppRole _role;
        private readonly Farm _farm;

        public FakeRepo(FarmId farmId, UserId userId, AppRole role)
        {
            _farmId = farmId; _userId = userId; _role = role;
            _farm = Farm.Create(farmId.Value, "Test Farm", userId.Value, DateTime.UtcNow);
        }

        public Task<AppRole?> GetUserRoleForFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default)
            => Task.FromResult<AppRole?>(farmId == _farmId.Value && userId == _userId.Value ? _role : (AppRole?)null);

        public Task<bool> IsUserMemberOfFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default)
            => Task.FromResult(farmId == _farmId.Value && userId == _userId.Value);

        public Task AddPlotAsync(Plot plot, CancellationToken ct = default) => Task.CompletedTask;
        public Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
        public Task AddAuditEventAsync(ShramSafal.Domain.Audit.AuditEvent e, CancellationToken ct = default) => Task.CompletedTask;

        // Remaining IShramSafalRepository members — all throw so unexpected calls surface loudly.
        public Task<Farm?> GetFarmByIdAsync(Guid farmId, CancellationToken ct = default)
            => Task.FromResult<Farm?>(farmId == _farmId.Value ? _farm : null);
        public Task AddFarmAsync(Farm farm, CancellationToken ct = default) => throw new NotImplementedException();
        public Task AddFarmMembershipAsync(FarmMembership membership, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<FarmMembership?> GetFarmMembershipAsync(Guid farmId, Guid userId, CancellationToken ct = default) => Task.FromResult<FarmMembership?>(null);
        public Task<Plot?> GetPlotByIdAsync(Guid plotId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<Plot>> GetPlotsByFarmIdAsync(Guid farmId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<bool> IsUserOwnerOfFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default) => Task.FromResult(_role is AppRole.PrimaryOwner or AppRole.SecondaryOwner);
        public Task<int> CountActivePrimaryOwnersAsync(Guid farmId, CancellationToken ct = default) => Task.FromResult(1);
        public Task<ShramSafal.Domain.Logs.DailyLog?> GetDailyLogByIdAsync(Guid dailyLogId, CancellationToken ct = default) => Task.FromResult<ShramSafal.Domain.Logs.DailyLog?>(null);
        public Task<ShramSafal.Domain.Logs.DailyLog?> GetDailyLogByIdempotencyKeyAsync(string key, CancellationToken ct = default) => Task.FromResult<ShramSafal.Domain.Logs.DailyLog?>(null);
        public Task AddDailyLogAsync(ShramSafal.Domain.Logs.DailyLog log, CancellationToken ct = default) => throw new NotImplementedException();
        public Task AddCropCycleAsync(ShramSafal.Domain.Crops.CropCycle cycle, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<ShramSafal.Domain.Crops.CropCycle?> GetCropCycleByIdAsync(Guid id, CancellationToken ct = default) => Task.FromResult<ShramSafal.Domain.Crops.CropCycle?>(null);
        public Task<List<ShramSafal.Domain.Crops.CropCycle>> GetCropCyclesByPlotIdAsync(Guid plotId, CancellationToken ct = default) => Task.FromResult(new List<ShramSafal.Domain.Crops.CropCycle>());
        public Task AddCostEntryAsync(ShramSafal.Domain.Finance.CostEntry entry, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<ShramSafal.Domain.Finance.CostEntry?> GetCostEntryByIdAsync(Guid id, CancellationToken ct = default) => Task.FromResult<ShramSafal.Domain.Finance.CostEntry?>(null);
        public Task<List<ShramSafal.Domain.Finance.CostEntry>> GetCostEntriesByIdsAsync(IEnumerable<Guid> ids, CancellationToken ct = default) => Task.FromResult(new List<ShramSafal.Domain.Finance.CostEntry>());
        public Task<List<ShramSafal.Domain.Finance.CostEntry>> GetCostEntriesForDuplicateCheck(FarmId farmId, Guid? plotId, string category, DateTime since, CancellationToken ct = default) => Task.FromResult(new List<ShramSafal.Domain.Finance.CostEntry>());
        public Task AddFinanceCorrectionAsync(ShramSafal.Domain.Finance.FinanceCorrection c, CancellationToken ct = default) => throw new NotImplementedException();
        public Task AddDayLedgerAsync(ShramSafal.Domain.Finance.DayLedger l, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<ShramSafal.Domain.Finance.DayLedger?> GetDayLedgerByIdAsync(Guid id, CancellationToken ct = default) => Task.FromResult<ShramSafal.Domain.Finance.DayLedger?>(null);
        public Task<ShramSafal.Domain.Finance.DayLedger?> GetDayLedgerBySourceCostEntryIdAsync(Guid id, CancellationToken ct = default) => Task.FromResult<ShramSafal.Domain.Finance.DayLedger?>(null);
        public Task<List<ShramSafal.Domain.Finance.DayLedger>> GetDayLedgersForFarm(Guid farmId, DateOnly from, DateOnly to, CancellationToken ct = default) => Task.FromResult(new List<ShramSafal.Domain.Finance.DayLedger>());
        public Task AddAttachmentAsync(ShramSafal.Domain.Attachments.Attachment a, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<ShramSafal.Domain.Attachments.Attachment?> GetAttachmentByIdAsync(Guid id, CancellationToken ct = default) => Task.FromResult<ShramSafal.Domain.Attachments.Attachment?>(null);
        public Task<List<ShramSafal.Domain.Attachments.Attachment>> GetAttachmentsForEntityAsync(Guid entityId, string entityType, CancellationToken ct = default) => Task.FromResult(new List<ShramSafal.Domain.Attachments.Attachment>());
        public Task AddPriceConfigAsync(ShramSafal.Domain.Finance.PriceConfig c, CancellationToken ct = default) => throw new NotImplementedException();
        public Task AddScheduleTemplateAsync(ShramSafal.Domain.Planning.ScheduleTemplate t, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<ShramSafal.Domain.Planning.ScheduleTemplate>> GetScheduleTemplatesAsync(CancellationToken ct = default) => Task.FromResult(new List<ShramSafal.Domain.Planning.ScheduleTemplate>());
        public Task AddPlannedActivitiesAsync(IEnumerable<ShramSafal.Domain.Planning.PlannedActivity> activities, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<ShramSafal.Domain.Planning.PlannedActivity?> GetPlannedActivityByIdAsync(Guid id, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<ShramSafal.Domain.Planning.PlannedActivity>> GetPlannedActivitiesByCropCycleIdAsync(Guid cropCycleId, CancellationToken ct = default) => Task.FromResult(new List<ShramSafal.Domain.Planning.PlannedActivity>());
        public Task<List<ShramSafal.Domain.Logs.LogTask>> GetExecutedTasksByCropCycleIdAsync(Guid cropCycleId, CancellationToken ct = default) => Task.FromResult(new List<ShramSafal.Domain.Logs.LogTask>());
        public Task<List<ShramSafal.Domain.Finance.CostEntry>> GetCostEntriesAsync(DateOnly? fromDate, DateOnly? toDate, CancellationToken ct = default) => Task.FromResult(new List<ShramSafal.Domain.Finance.CostEntry>());
        public Task<List<ShramSafal.Domain.Finance.FinanceCorrection>> GetCorrectionsForEntriesAsync(IEnumerable<Guid> ids, CancellationToken ct = default) => Task.FromResult(new List<ShramSafal.Domain.Finance.FinanceCorrection>());
        public Task<List<Farm>> GetFarmsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => Task.FromResult(new List<Farm>());
        public Task<List<Plot>> GetPlotsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => Task.FromResult(new List<Plot>());
        public Task<List<ShramSafal.Domain.Crops.CropCycle>> GetCropCyclesChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => Task.FromResult(new List<ShramSafal.Domain.Crops.CropCycle>());
        public Task<List<ShramSafal.Domain.Logs.DailyLog>> GetDailyLogsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => Task.FromResult(new List<ShramSafal.Domain.Logs.DailyLog>());
        public Task<List<ShramSafal.Domain.Finance.CostEntry>> GetCostEntriesChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => Task.FromResult(new List<ShramSafal.Domain.Finance.CostEntry>());
        public Task<List<ShramSafal.Domain.Finance.FinanceCorrection>> GetFinanceCorrectionsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => Task.FromResult(new List<ShramSafal.Domain.Finance.FinanceCorrection>());
        public Task<List<ShramSafal.Domain.Finance.DayLedger>> GetDayLedgersChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => Task.FromResult(new List<ShramSafal.Domain.Finance.DayLedger>());
        public Task<List<ShramSafal.Domain.Finance.PriceConfig>> GetPriceConfigsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => Task.FromResult(new List<ShramSafal.Domain.Finance.PriceConfig>());
        public Task<List<ShramSafal.Domain.Planning.PlannedActivity>> GetPlannedActivitiesChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => Task.FromResult(new List<ShramSafal.Domain.Planning.PlannedActivity>());
        public Task<List<ShramSafal.Domain.Attachments.Attachment>> GetAttachmentsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => Task.FromResult(new List<ShramSafal.Domain.Attachments.Attachment>());
        public Task<List<ShramSafal.Domain.Audit.AuditEvent>> GetAuditEventsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => Task.FromResult(new List<ShramSafal.Domain.Audit.AuditEvent>());
        public Task<List<ShramSafal.Domain.Audit.AuditEvent>> GetAuditEventsForEntityAsync(Guid entityId, string entityType, CancellationToken ct = default) => Task.FromResult(new List<ShramSafal.Domain.Audit.AuditEvent>());
        public Task<List<ShramSafal.Domain.Audit.AuditEvent>> GetAuditEventsForFarmAsync(Guid farmId, DateOnly from, DateOnly to, int limit, int offset, CancellationToken ct = default) => Task.FromResult(new List<ShramSafal.Domain.Audit.AuditEvent>());
        public Task<List<Guid>> GetFarmIdsForUserAsync(Guid userId, CancellationToken ct = default) => Task.FromResult(new List<Guid>());
        public Task<IReadOnlyList<ShramSafal.Application.Contracts.Dtos.SyncOperatorDto>> GetOperatorsByIdsAsync(IEnumerable<Guid> userIds, CancellationToken ct = default) => Task.FromResult<IReadOnlyList<ShramSafal.Application.Contracts.Dtos.SyncOperatorDto>>(new List<ShramSafal.Application.Contracts.Dtos.SyncOperatorDto>());
        public Task AddCropScheduleTemplateAsync(ShramSafal.Domain.Schedules.CropScheduleTemplate template, CancellationToken ct = default) => Task.CompletedTask;
        public Task<ShramSafal.Domain.Schedules.CropScheduleTemplate?> GetCropScheduleTemplateByIdAsync(AgriSync.SharedKernel.Contracts.Ids.ScheduleTemplateId id, CancellationToken ct = default) => Task.FromResult<ShramSafal.Domain.Schedules.CropScheduleTemplate?>(null);
        public Task<List<ShramSafal.Domain.Schedules.CropScheduleTemplate>> GetCropScheduleTemplatesForCropAsync(string cropKey, string? regionCode, CancellationToken ct = default) => Task.FromResult(new List<ShramSafal.Domain.Schedules.CropScheduleTemplate>());
        public Task AddScheduleSubscriptionAsync(ShramSafal.Domain.Schedules.ScheduleSubscription s, CancellationToken ct = default) => Task.CompletedTask;
        public Task<ShramSafal.Domain.Schedules.ScheduleSubscription?> GetScheduleSubscriptionByIdAsync(AgriSync.SharedKernel.Contracts.Ids.ScheduleSubscriptionId id, CancellationToken ct = default) => Task.FromResult<ShramSafal.Domain.Schedules.ScheduleSubscription?>(null);
        public Task<ShramSafal.Domain.Schedules.ScheduleSubscription?> GetActiveScheduleSubscriptionAsync(Guid plotId, string cropKey, Guid cropCycleId, CancellationToken ct = default) => Task.FromResult<ShramSafal.Domain.Schedules.ScheduleSubscription?>(null);
        public Task AddScheduleMigrationEventAsync(ShramSafal.Domain.Schedules.ScheduleMigrationEvent e, CancellationToken ct = default) => Task.CompletedTask;
        public Task<ShramSafal.Domain.Planning.ScheduleTemplate?> GetScheduleTemplateByIdAsync(Guid templateId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<bool> HasActiveOwnerMembershipAsync(Guid userId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<ShramSafal.Domain.Planning.ScheduleTemplate>> GetScheduleLineageAsync(Guid rootTemplateId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<int> GetDisputedLogCountForPlotAsync(Guid plotId, CancellationToken ct = default) => throw new NotSupportedException();
    }

    private sealed class NullAnalyticsWriter : AgriSync.BuildingBlocks.Analytics.IAnalyticsWriter
    {
        public Task EmitAsync(AgriSync.BuildingBlocks.Analytics.AnalyticsEvent e, CancellationToken ct = default) => Task.CompletedTask;
        public Task EmitManyAsync(IEnumerable<AgriSync.BuildingBlocks.Analytics.AnalyticsEvent> events, CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class GuidIdGenerator : IIdGenerator { public Guid New() => Guid.NewGuid(); }
    private sealed class SystemClock : IClock { public DateTime UtcNow => DateTime.UtcNow; }
}
