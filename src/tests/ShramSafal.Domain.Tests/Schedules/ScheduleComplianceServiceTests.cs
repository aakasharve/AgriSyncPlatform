using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Domain.Attachments;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Crops;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.Schedules;
using Xunit;

namespace ShramSafal.Domain.Tests.Schedules;

public sealed class ScheduleComplianceServiceTests
{
    private static readonly FarmId Farm = new(Guid.NewGuid());
    private static readonly Guid Plot = Guid.NewGuid();
    private static readonly Guid Cycle = Guid.NewGuid();
    private static readonly DateOnly CycleStart = new(2026, 4, 1);
    private const string CropKey = "grapes";
    private const string TaskType = "fertigation";
    private const string Stage = "flowering";

    [Fact]
    public async Task NoActiveSubscription_ReturnsUnscheduled()
    {
        var repo = new FakeRepo
        {
            Cycle = BuildCycle(),
            ActiveSubscription = null,
        };

        var service = new ScheduleComplianceService(repo);
        var result = await service.EvaluateAsync(new ScheduleComplianceQuery(
            Cycle, TaskType, Stage, CycleStart.AddDays(10)));

        Assert.Equal(ComplianceOutcome.Unscheduled, result.Outcome);
        Assert.Null(result.SubscriptionId);
        Assert.Null(result.MatchedTaskId);
    }

    [Fact]
    public async Task LoggedOnPrescribedDay_ReturnsOnTime()
    {
        var (subscription, template) = BuildSubscriptionAndTemplate(dayOffset: 10, tolerance: 2);
        var repo = new FakeRepo
        {
            Cycle = BuildCycle(),
            ActiveSubscription = subscription,
            Template = template,
        };

        var service = new ScheduleComplianceService(repo);
        var result = await service.EvaluateAsync(new ScheduleComplianceQuery(
            Cycle, TaskType, Stage, CycleStart.AddDays(10)));

        Assert.Equal(ComplianceOutcome.OnTime, result.Outcome);
        Assert.Equal(0, result.DeltaDays);
        Assert.Equal(subscription.SubscriptionId, result.SubscriptionId);
        Assert.Equal(template.Tasks[0].Id, result.MatchedTaskId);
    }

    [Fact]
    public async Task LoggedFiveDaysEarly_ReturnsEarly()
    {
        var (subscription, template) = BuildSubscriptionAndTemplate(dayOffset: 10, tolerance: 2);
        var repo = new FakeRepo
        {
            Cycle = BuildCycle(),
            ActiveSubscription = subscription,
            Template = template,
        };

        var service = new ScheduleComplianceService(repo);
        var result = await service.EvaluateAsync(new ScheduleComplianceQuery(
            Cycle, TaskType, Stage, CycleStart.AddDays(5)));

        Assert.Equal(ComplianceOutcome.Early, result.Outcome);
        Assert.Equal(-5, result.DeltaDays);
    }

    [Fact]
    public async Task LoggedFiveDaysLate_ReturnsLate()
    {
        var (subscription, template) = BuildSubscriptionAndTemplate(dayOffset: 10, tolerance: 2);
        var repo = new FakeRepo
        {
            Cycle = BuildCycle(),
            ActiveSubscription = subscription,
            Template = template,
        };

        var service = new ScheduleComplianceService(repo);
        var result = await service.EvaluateAsync(new ScheduleComplianceQuery(
            Cycle, TaskType, Stage, CycleStart.AddDays(15)));

        Assert.Equal(ComplianceOutcome.Late, result.Outcome);
        Assert.Equal(5, result.DeltaDays);
    }

    private static CropCycle BuildCycle() =>
        CropCycle.Create(Cycle, Farm, Plot, CropKey, Stage, CycleStart, endDate: null, createdAtUtc: DateTime.UtcNow);

    private static (ScheduleSubscription Subscription, CropScheduleTemplate Template) BuildSubscriptionAndTemplate(
        int dayOffset,
        int tolerance)
    {
        var templateId = ScheduleTemplateId.New();
        var task = PrescribedTask.Create(
            PrescribedTaskId.New(),
            TaskType,
            Stage,
            dayOffset,
            tolerance);

        var template = CropScheduleTemplate.Create(
            templateId.Value,
            templateKey: "test-template-v1",
            cropKey: CropKey,
            regionCode: null,
            name: "Test Template",
            versionTag: "v1",
            createdAtUtc: DateTime.UtcNow,
            tasks: new[] { task });
        template.Publish();

        var subscription = ScheduleSubscription.Adopt(
            Guid.NewGuid(),
            Farm,
            Plot,
            Cycle,
            CropKey,
            templateId,
            "v1",
            DateTime.UtcNow);

        return (subscription, template);
    }

    // Minimal stub — the service only calls three methods; everything else throws if misused.
    private sealed class FakeRepo : IShramSafalRepository
    {
        public CropCycle? Cycle { get; set; }
        public ScheduleSubscription? ActiveSubscription { get; set; }
        public CropScheduleTemplate? Template { get; set; }

        public Task<CropCycle?> GetCropCycleByIdAsync(Guid cropCycleId, CancellationToken ct = default) =>
            Task.FromResult(Cycle);

        public Task<ScheduleSubscription?> GetActiveScheduleSubscriptionAsync(
            Guid plotId, string cropKey, Guid cropCycleId, CancellationToken ct = default) =>
            Task.FromResult(ActiveSubscription);

        public Task<CropScheduleTemplate?> GetCropScheduleTemplateByIdAsync(
            ScheduleTemplateId templateId, CancellationToken ct = default) =>
            Task.FromResult(Template);

        // ---- Unused members — throw if touched by production code paths we don't expect. ----

        public Task AddFarmAsync(Farm farm, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Farm?> GetFarmByIdAsync(Guid farmId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddFarmMembershipAsync(FarmMembership membership, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<FarmMembership?> GetFarmMembershipAsync(Guid farmId, Guid userId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<AppRole?> GetUserRoleForFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<bool> IsUserOwnerOfFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddPlotAsync(Plot plot, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Plot?> GetPlotByIdAsync(Guid plotId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<Plot>> GetPlotsByFarmIdAsync(Guid farmId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddCropCycleAsync(CropCycle cropCycle, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<CropCycle>> GetCropCyclesByPlotIdAsync(Guid plotId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddDailyLogAsync(DailyLog log, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<DailyLog?> GetDailyLogByIdAsync(Guid dailyLogId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<DailyLog?> GetDailyLogByIdempotencyKeyAsync(string idempotencyKey, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddCostEntryAsync(CostEntry costEntry, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<CostEntry?> GetCostEntryByIdAsync(Guid costEntryId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<CostEntry>> GetCostEntriesByIdsAsync(IEnumerable<Guid> costEntryIds, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<CostEntry>> GetCostEntriesForDuplicateCheck(FarmId farmId, Guid? plotId, string category, DateTime since, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddFinanceCorrectionAsync(FinanceCorrection correction, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddDayLedgerAsync(DayLedger dayLedger, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<DayLedger?> GetDayLedgerByIdAsync(Guid dayLedgerId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<DayLedger?> GetDayLedgerBySourceCostEntryIdAsync(Guid costEntryId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<DayLedger>> GetDayLedgersForFarm(Guid farmId, DateOnly from, DateOnly to, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddAttachmentAsync(Attachment attachment, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Attachment?> GetAttachmentByIdAsync(Guid attachmentId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<Attachment>> GetAttachmentsForEntityAsync(Guid entityId, string entityType, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddPriceConfigAsync(PriceConfig config, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddAuditEventAsync(AuditEvent auditEvent, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddScheduleTemplateAsync(ScheduleTemplate template, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<ScheduleTemplate>> GetScheduleTemplatesAsync(CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddPlannedActivitiesAsync(IEnumerable<PlannedActivity> plannedActivities, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<PlannedActivity?> GetPlannedActivityByIdAsync(Guid id, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<PlannedActivity>> GetPlannedActivitiesByCropCycleIdAsync(Guid cropCycleId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<LogTask>> GetExecutedTasksByCropCycleIdAsync(Guid cropCycleId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<CostEntry>> GetCostEntriesAsync(DateOnly? fromDate, DateOnly? toDate, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<FinanceCorrection>> GetCorrectionsForEntriesAsync(IEnumerable<Guid> costEntryIds, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<Farm>> GetFarmsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<Plot>> GetPlotsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<CropCycle>> GetCropCyclesChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<DailyLog>> GetDailyLogsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<CostEntry>> GetCostEntriesChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<FinanceCorrection>> GetFinanceCorrectionsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<DayLedger>> GetDayLedgersChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<PriceConfig>> GetPriceConfigsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<PlannedActivity>> GetPlannedActivitiesChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<Attachment>> GetAttachmentsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<AuditEvent>> GetAuditEventsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<AuditEvent>> GetAuditEventsForEntityAsync(Guid entityId, string entityType, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<AuditEvent>> GetAuditEventsForFarmAsync(Guid farmId, DateOnly from, DateOnly to, int limit, int offset, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<Guid>> GetFarmIdsForUserAsync(Guid userId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<IReadOnlyList<SyncOperatorDto>> GetOperatorsByIdsAsync(IEnumerable<Guid> userIds, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<bool> IsUserMemberOfFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<int> CountActivePrimaryOwnersAsync(Guid farmId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddCropScheduleTemplateAsync(CropScheduleTemplate template, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<CropScheduleTemplate>> GetCropScheduleTemplatesForCropAsync(string cropKey, string? regionCode, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddScheduleSubscriptionAsync(ScheduleSubscription subscription, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<ScheduleSubscription?> GetScheduleSubscriptionByIdAsync(ScheduleSubscriptionId subscriptionId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddScheduleMigrationEventAsync(ScheduleMigrationEvent migrationEvent, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<ScheduleTemplate?> GetScheduleTemplateByIdAsync(Guid templateId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<bool> HasActiveOwnerMembershipAsync(Guid userId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<ScheduleTemplate>> GetScheduleLineageAsync(Guid rootTemplateId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<int> GetDisputedLogCountForPlotAsync(Guid plotId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task SaveChangesAsync(CancellationToken ct = default) => throw new NotSupportedException();
    }
}
