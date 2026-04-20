using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Reports.GetFarmWeekMis;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Farms;
using Xunit;

namespace ShramSafal.Domain.Tests.Reports;

/// <summary>
/// Phase 6 Owner MIS — GetFarmWeekMisHandler.
/// </summary>
public sealed class GetFarmWeekMisHandlerTests
{
    private static readonly Guid FarmIdVal = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static readonly Guid ActorIdVal = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    private static readonly DateTime Now = new(2026, 4, 20, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public async Task HandleAsync_HappyPath_ReturnsMisSnapshot()
    {
        var repo = BuildBaseRepo();
        var misRepo = new FakeMisRepo(
            new FarmWeekMisDto(FarmIdVal, 5.0m, "A", 18.5m, 8.2m, 62.0m, 74.0m, 3.1m, 0.12m));

        var handler = new GetFarmWeekMisHandler(repo, misRepo, new AllowEntitlementPolicy());
        var result = await handler.HandleAsync(new GetFarmWeekMisQuery(FarmIdVal, ActorIdVal));

        Assert.True(result.IsSuccess);
        Assert.Equal("A", result.Value!.EngagementTier);
        Assert.Equal(5.0m, result.Value.Wvfd);
        Assert.Equal(18.5m, result.Value.MedianVerifyLagHours);
    }

    [Fact]
    public async Task HandleAsync_NoMisDataYet_ReturnsZeroStateDto()
    {
        var repo = BuildBaseRepo();
        var misRepo = new FakeMisRepo(null); // farm has no analytics data yet

        var handler = new GetFarmWeekMisHandler(repo, misRepo, new AllowEntitlementPolicy());
        var result = await handler.HandleAsync(new GetFarmWeekMisQuery(FarmIdVal, ActorIdVal));

        Assert.True(result.IsSuccess);
        Assert.Equal(0m, result.Value!.Wvfd);
        Assert.Equal("D", result.Value.EngagementTier);
        Assert.Null(result.Value.VoiceSharePct);
    }

    [Fact]
    public async Task HandleAsync_NonMember_ReturnsForbidden()
    {
        var repo = BuildBaseRepo();
        repo.FarmMembers.Clear(); // actor is not a member

        var misRepo = new FakeMisRepo(null);
        var handler = new GetFarmWeekMisHandler(repo, misRepo, new AllowEntitlementPolicy());
        var result = await handler.HandleAsync(new GetFarmWeekMisQuery(FarmIdVal, ActorIdVal));

        Assert.True(result.IsFailure);
        Assert.Equal(ShramSafalErrors.Forbidden, result.Error);
    }

    [Fact]
    public async Task HandleAsync_EntitlementDenied_ReturnsForbidden()
    {
        var repo = BuildBaseRepo();
        var misRepo = new FakeMisRepo(null);
        var handler = new GetFarmWeekMisHandler(repo, misRepo, new DenyEntitlementPolicy());

        var result = await handler.HandleAsync(new GetFarmWeekMisQuery(FarmIdVal, ActorIdVal));

        Assert.True(result.IsFailure);
        // EntitlementGate maps SubscriptionExpired to its own error code, not generic Forbidden
        Assert.True(result.Error.Code.StartsWith("entitlement.", StringComparison.Ordinal));
    }

    // ---- Helpers ----

    private static FakeBaseRepo BuildBaseRepo()
    {
        var repo = new FakeBaseRepo();
        repo.Farms[FarmIdVal] = Farm.Create(new FarmId(FarmIdVal), "Test Farm", new UserId(ActorIdVal), Now.AddDays(-30));
        repo.FarmMembers.Add((FarmIdVal, ActorIdVal));
        return repo;
    }

    private sealed class FakeMisRepo(FarmWeekMisDto? snapshot) : IMisReportRepository
    {
        public Task<FarmWeekMisDto?> GetFarmWeekMisAsync(Guid farmId, CancellationToken ct = default) =>
            Task.FromResult(snapshot);
    }

    private sealed class AllowEntitlementPolicy : IEntitlementPolicy
    {
        public Task<EntitlementDecision> EvaluateAsync(
            UserId userId, FarmId farmId, PaidFeature feature, CancellationToken ct = default) =>
            Task.FromResult(new EntitlementDecision(true, EntitlementReason.Allowed, null));
    }

    private sealed class DenyEntitlementPolicy : IEntitlementPolicy
    {
        public Task<EntitlementDecision> EvaluateAsync(
            UserId userId, FarmId farmId, PaidFeature feature, CancellationToken ct = default) =>
            Task.FromResult(new EntitlementDecision(false, EntitlementReason.SubscriptionExpired, null));
    }

    private sealed class FakeBaseRepo : IShramSafalRepository
    {
        public Dictionary<Guid, Farm> Farms { get; } = new();
        public HashSet<(Guid farmId, Guid userId)> FarmMembers { get; } = new();

        public Task<Farm?> GetFarmByIdAsync(Guid farmId, CancellationToken ct = default) =>
            Task.FromResult(Farms.TryGetValue(farmId, out var f) ? f : null);

        public Task<bool> IsUserMemberOfFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default) =>
            Task.FromResult(FarmMembers.Contains((farmId, userId)));

        // All unused — throw if accidentally called
        public Task AddFarmAsync(Farm farm, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddFarmMembershipAsync(ShramSafal.Domain.Farms.FarmMembership membership, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<ShramSafal.Domain.Farms.FarmMembership?> GetFarmMembershipAsync(Guid farmId, Guid userId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<AgriSync.SharedKernel.Contracts.Roles.AppRole?> GetUserRoleForFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<bool> IsUserOwnerOfFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddPlotAsync(ShramSafal.Domain.Farms.Plot plot, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<ShramSafal.Domain.Farms.Plot?> GetPlotByIdAsync(Guid plotId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<System.Collections.Generic.List<ShramSafal.Domain.Farms.Plot>> GetPlotsByFarmIdAsync(Guid farmId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddCropCycleAsync(ShramSafal.Domain.Crops.CropCycle cropCycle, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<ShramSafal.Domain.Crops.CropCycle?> GetCropCycleByIdAsync(Guid cropCycleId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<System.Collections.Generic.List<ShramSafal.Domain.Crops.CropCycle>> GetCropCyclesByPlotIdAsync(Guid plotId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddDailyLogAsync(ShramSafal.Domain.Logs.DailyLog log, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<ShramSafal.Domain.Logs.DailyLog?> GetDailyLogByIdAsync(Guid dailyLogId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<ShramSafal.Domain.Logs.DailyLog?> GetDailyLogByIdempotencyKeyAsync(string idempotencyKey, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddCostEntryAsync(ShramSafal.Domain.Finance.CostEntry costEntry, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<ShramSafal.Domain.Finance.CostEntry?> GetCostEntryByIdAsync(Guid costEntryId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<System.Collections.Generic.List<ShramSafal.Domain.Finance.CostEntry>> GetCostEntriesByIdsAsync(System.Collections.Generic.IEnumerable<Guid> costEntryIds, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<System.Collections.Generic.List<ShramSafal.Domain.Finance.CostEntry>> GetCostEntriesForDuplicateCheck(FarmId farmId, Guid? plotId, string category, DateTime since, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddFinanceCorrectionAsync(ShramSafal.Domain.Finance.FinanceCorrection correction, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddDayLedgerAsync(ShramSafal.Domain.Finance.DayLedger dayLedger, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<ShramSafal.Domain.Finance.DayLedger?> GetDayLedgerByIdAsync(Guid dayLedgerId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<ShramSafal.Domain.Finance.DayLedger?> GetDayLedgerBySourceCostEntryIdAsync(Guid costEntryId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<System.Collections.Generic.List<ShramSafal.Domain.Finance.DayLedger>> GetDayLedgersForFarm(Guid farmId, DateOnly from, DateOnly to, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddAttachmentAsync(ShramSafal.Domain.Attachments.Attachment attachment, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<ShramSafal.Domain.Attachments.Attachment?> GetAttachmentByIdAsync(Guid attachmentId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<System.Collections.Generic.List<ShramSafal.Domain.Attachments.Attachment>> GetAttachmentsForEntityAsync(Guid entityId, string entityType, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddPriceConfigAsync(ShramSafal.Domain.Finance.PriceConfig config, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddScheduleTemplateAsync(ShramSafal.Domain.Planning.ScheduleTemplate template, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<System.Collections.Generic.List<ShramSafal.Domain.Planning.ScheduleTemplate>> GetScheduleTemplatesAsync(CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddPlannedActivitiesAsync(System.Collections.Generic.IEnumerable<ShramSafal.Domain.Planning.PlannedActivity> plannedActivities, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<System.Collections.Generic.List<ShramSafal.Domain.Planning.PlannedActivity>> GetPlannedActivitiesByCropCycleIdAsync(Guid cropCycleId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<System.Collections.Generic.List<ShramSafal.Domain.Logs.LogTask>> GetExecutedTasksByCropCycleIdAsync(Guid cropCycleId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<System.Collections.Generic.List<ShramSafal.Domain.Finance.CostEntry>> GetCostEntriesAsync(DateOnly? fromDate, DateOnly? toDate, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<System.Collections.Generic.List<ShramSafal.Domain.Finance.FinanceCorrection>> GetCorrectionsForEntriesAsync(System.Collections.Generic.IEnumerable<Guid> costEntryIds, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<System.Collections.Generic.List<Farm>> GetFarmsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<System.Collections.Generic.List<ShramSafal.Domain.Farms.Plot>> GetPlotsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<System.Collections.Generic.List<ShramSafal.Domain.Crops.CropCycle>> GetCropCyclesChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<System.Collections.Generic.List<ShramSafal.Domain.Logs.DailyLog>> GetDailyLogsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<System.Collections.Generic.List<ShramSafal.Domain.Finance.CostEntry>> GetCostEntriesChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<System.Collections.Generic.List<ShramSafal.Domain.Finance.FinanceCorrection>> GetFinanceCorrectionsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<System.Collections.Generic.List<ShramSafal.Domain.Finance.DayLedger>> GetDayLedgersChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<System.Collections.Generic.List<ShramSafal.Domain.Finance.PriceConfig>> GetPriceConfigsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<System.Collections.Generic.List<ShramSafal.Domain.Planning.PlannedActivity>> GetPlannedActivitiesChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<System.Collections.Generic.List<ShramSafal.Domain.Attachments.Attachment>> GetAttachmentsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<System.Collections.Generic.List<ShramSafal.Domain.Audit.AuditEvent>> GetAuditEventsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<System.Collections.Generic.List<ShramSafal.Domain.Audit.AuditEvent>> GetAuditEventsForEntityAsync(Guid entityId, string entityType, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<System.Collections.Generic.List<ShramSafal.Domain.Audit.AuditEvent>> GetAuditEventsForFarmAsync(Guid farmId, DateOnly from, DateOnly to, int limit, int offset, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddAuditEventAsync(ShramSafal.Domain.Audit.AuditEvent auditEvent, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<System.Collections.Generic.List<Guid>> GetFarmIdsForUserAsync(Guid userId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<System.Collections.Generic.IReadOnlyList<ShramSafal.Application.Contracts.Dtos.SyncOperatorDto>> GetOperatorsByIdsAsync(System.Collections.Generic.IEnumerable<Guid> userIds, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<int> CountActivePrimaryOwnersAsync(Guid farmId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddCropScheduleTemplateAsync(ShramSafal.Domain.Schedules.CropScheduleTemplate template, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<ShramSafal.Domain.Schedules.CropScheduleTemplate?> GetCropScheduleTemplateByIdAsync(AgriSync.SharedKernel.Contracts.Ids.ScheduleTemplateId templateId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<System.Collections.Generic.List<ShramSafal.Domain.Schedules.CropScheduleTemplate>> GetCropScheduleTemplatesForCropAsync(string cropKey, string? regionCode, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddScheduleSubscriptionAsync(ShramSafal.Domain.Schedules.ScheduleSubscription subscription, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<ShramSafal.Domain.Schedules.ScheduleSubscription?> GetActiveScheduleSubscriptionAsync(Guid plotId, string cropKey, Guid cropCycleId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<ShramSafal.Domain.Schedules.ScheduleSubscription?> GetScheduleSubscriptionByIdAsync(AgriSync.SharedKernel.Contracts.Ids.ScheduleSubscriptionId subscriptionId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddScheduleMigrationEventAsync(ShramSafal.Domain.Schedules.ScheduleMigrationEvent migrationEvent, CancellationToken ct = default) => throw new NotSupportedException();
        public Task SaveChangesAsync(CancellationToken ct = default) => throw new NotSupportedException();
    }
}
