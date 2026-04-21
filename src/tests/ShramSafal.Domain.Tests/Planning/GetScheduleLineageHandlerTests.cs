using AgriSync.SharedKernel.Contracts.Ids;
using FluentAssertions;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Application.UseCases.Planning.GetScheduleLineage;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Planning;
using Xunit;

namespace ShramSafal.Domain.Tests.Planning;

public sealed class GetScheduleLineageHandlerTests
{
    private static readonly DateTime Now = new(2026, 4, 21, 10, 0, 0, DateTimeKind.Utc);

    [Fact]
    public async Task GetLineage_ReturnsRootPlusAllDerivatives_Flat()
    {
        var author = UserId.New();
        var root = ScheduleTemplate.Create(Guid.NewGuid(), "Root", "S1", Now, createdByUserId: author);
        var clone = root.Clone(Guid.NewGuid(), UserId.New(), TenantScope.Private, "test", Now);

        var repo = new FakeRepo([root, clone]);
        var dir = new FakeUserDirectory([]);
        var handler = new GetScheduleLineageHandler(repo, dir);

        var result = await handler.HandleAsync(new GetScheduleLineageQuery(root.Id));

        result.IsSuccess.Should().BeTrue();
        result.Value.Should().HaveCount(2);
        result.Value.Should().Contain(d => d.Id == root.Id);
        result.Value.Should().Contain(d => d.Id == clone.Id);
    }

    [Fact]
    public async Task GetLineage_ForUnknownId_Returns_Empty()
    {
        var repo = new FakeRepo([]);
        var dir = new FakeUserDirectory([]);
        var handler = new GetScheduleLineageHandler(repo, dir);

        var result = await handler.HandleAsync(new GetScheduleLineageQuery(Guid.NewGuid()));

        result.IsSuccess.Should().BeTrue();
        result.Value.Should().BeEmpty();
    }

    [Fact]
    public async Task GetLineage_EmptyRootId_Returns_InvalidCommand()
    {
        var handler = new GetScheduleLineageHandler(new FakeRepo([]), new FakeUserDirectory([]));
        var result = await handler.HandleAsync(new GetScheduleLineageQuery(Guid.Empty));
        result.IsSuccess.Should().BeFalse();
        result.Error.Should().Be(ShramSafalErrors.InvalidCommand);
    }

    // ---------------------------------------------------------------------------
    //  Minimal fake repo — only the lineage method is implemented
    // ---------------------------------------------------------------------------

    private sealed class FakeRepo(List<ScheduleTemplate> templates) : IShramSafalRepository
    {
        public Task<List<ScheduleTemplate>> GetScheduleLineageAsync(Guid rootTemplateId, CancellationToken ct = default) =>
            Task.FromResult(templates.Where(t => t.Id == rootTemplateId || t.DerivedFromTemplateId == rootTemplateId).ToList());

        // All other interface methods throw
        public Task AddFarmAsync(Domain.Farms.Farm farm, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Domain.Farms.Farm?> GetFarmByIdAsync(Guid farmId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddFarmMembershipAsync(Domain.Farms.FarmMembership membership, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Domain.Farms.FarmMembership?> GetFarmMembershipAsync(Guid farmId, Guid userId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<AgriSync.SharedKernel.Contracts.Roles.AppRole?> GetUserRoleForFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<bool> IsUserOwnerOfFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<bool> IsUserMemberOfFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<int> CountActivePrimaryOwnersAsync(Guid farmId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddPlotAsync(Domain.Farms.Plot plot, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Domain.Farms.Plot?> GetPlotByIdAsync(Guid plotId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<Domain.Farms.Plot>> GetPlotsByFarmIdAsync(Guid farmId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddCropCycleAsync(Domain.Crops.CropCycle cropCycle, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Domain.Crops.CropCycle?> GetCropCycleByIdAsync(Guid cropCycleId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<Domain.Crops.CropCycle>> GetCropCyclesByPlotIdAsync(Guid plotId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddDailyLogAsync(Domain.Logs.DailyLog log, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Domain.Logs.DailyLog?> GetDailyLogByIdAsync(Guid dailyLogId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Domain.Logs.DailyLog?> GetDailyLogByIdempotencyKeyAsync(string idempotencyKey, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddCostEntryAsync(Domain.Finance.CostEntry costEntry, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Domain.Finance.CostEntry?> GetCostEntryByIdAsync(Guid costEntryId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<Domain.Finance.CostEntry>> GetCostEntriesByIdsAsync(IEnumerable<Guid> costEntryIds, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<Domain.Finance.CostEntry>> GetCostEntriesForDuplicateCheck(AgriSync.SharedKernel.Contracts.Ids.FarmId farmId, Guid? plotId, string category, DateTime since, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddFinanceCorrectionAsync(Domain.Finance.FinanceCorrection correction, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddDayLedgerAsync(Domain.Finance.DayLedger dayLedger, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Domain.Finance.DayLedger?> GetDayLedgerByIdAsync(Guid dayLedgerId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Domain.Finance.DayLedger?> GetDayLedgerBySourceCostEntryIdAsync(Guid costEntryId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<Domain.Finance.DayLedger>> GetDayLedgersForFarm(Guid farmId, DateOnly from, DateOnly to, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddAttachmentAsync(Domain.Attachments.Attachment attachment, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Domain.Attachments.Attachment?> GetAttachmentByIdAsync(Guid attachmentId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<Domain.Attachments.Attachment>> GetAttachmentsForEntityAsync(Guid entityId, string entityType, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddPriceConfigAsync(Domain.Finance.PriceConfig config, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddAuditEventAsync(Domain.Audit.AuditEvent auditEvent, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddScheduleTemplateAsync(ScheduleTemplate template, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<ScheduleTemplate>> GetScheduleTemplatesAsync(CancellationToken ct = default) => throw new NotSupportedException();
        public Task<ScheduleTemplate?> GetScheduleTemplateByIdAsync(Guid templateId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<bool> HasActiveOwnerMembershipAsync(Guid userId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddPlannedActivitiesAsync(IEnumerable<Domain.Planning.PlannedActivity> plannedActivities, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Domain.Planning.PlannedActivity?> GetPlannedActivityByIdAsync(Guid id, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<Domain.Planning.PlannedActivity>> GetPlannedActivitiesByCropCycleIdAsync(Guid cropCycleId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<Domain.Logs.LogTask>> GetExecutedTasksByCropCycleIdAsync(Guid cropCycleId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<Domain.Finance.CostEntry>> GetCostEntriesAsync(DateOnly? fromDate, DateOnly? toDate, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<Domain.Finance.FinanceCorrection>> GetCorrectionsForEntriesAsync(IEnumerable<Guid> costEntryIds, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<Domain.Farms.Farm>> GetFarmsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<Domain.Farms.Plot>> GetPlotsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<Domain.Crops.CropCycle>> GetCropCyclesChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<Domain.Logs.DailyLog>> GetDailyLogsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<Domain.Finance.CostEntry>> GetCostEntriesChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<Domain.Finance.FinanceCorrection>> GetFinanceCorrectionsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<Domain.Finance.DayLedger>> GetDayLedgersChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<Domain.Finance.PriceConfig>> GetPriceConfigsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<Domain.Planning.PlannedActivity>> GetPlannedActivitiesChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<Domain.Attachments.Attachment>> GetAttachmentsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<Domain.Audit.AuditEvent>> GetAuditEventsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<Domain.Audit.AuditEvent>> GetAuditEventsForEntityAsync(Guid entityId, string entityType, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<Domain.Audit.AuditEvent>> GetAuditEventsForFarmAsync(Guid farmId, DateOnly from, DateOnly to, int limit, int offset, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<Guid>> GetFarmIdsForUserAsync(Guid userId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<IReadOnlyList<Application.Contracts.Dtos.SyncOperatorDto>> GetOperatorsByIdsAsync(IEnumerable<Guid> userIds, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddCropScheduleTemplateAsync(Domain.Schedules.CropScheduleTemplate template, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Domain.Schedules.CropScheduleTemplate?> GetCropScheduleTemplateByIdAsync(AgriSync.SharedKernel.Contracts.Ids.ScheduleTemplateId templateId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<Domain.Schedules.CropScheduleTemplate>> GetCropScheduleTemplatesForCropAsync(string cropKey, string? regionCode, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddScheduleSubscriptionAsync(Domain.Schedules.ScheduleSubscription subscription, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Domain.Schedules.ScheduleSubscription?> GetScheduleSubscriptionByIdAsync(AgriSync.SharedKernel.Contracts.Ids.ScheduleSubscriptionId subscriptionId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Domain.Schedules.ScheduleSubscription?> GetActiveScheduleSubscriptionAsync(Guid plotId, string cropKey, Guid cropCycleId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddScheduleMigrationEventAsync(Domain.Schedules.ScheduleMigrationEvent migrationEvent, CancellationToken ct = default) => throw new NotSupportedException();
        public Task SaveChangesAsync(CancellationToken ct = default) => throw new NotSupportedException();
        public Task<int> GetDisputedLogCountForPlotAsync(Guid plotId, CancellationToken ct = default) => throw new NotSupportedException();
    }

    private sealed class FakeUserDirectory(List<(Guid Id, string Name)> users) : IUserDirectory
    {
        public Task<IReadOnlyDictionary<Guid, string>> GetDisplayNamesAsync(IEnumerable<Guid> userIds, CancellationToken ct = default) =>
            Task.FromResult<IReadOnlyDictionary<Guid, string>>(
                users.Where(u => userIds.Contains(u.Id)).ToDictionary(u => u.Id, u => u.Name));
    }
}
