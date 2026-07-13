using System.Runtime.CompilerServices;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.AI;
using ShramSafal.Domain.Attachments;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Crops;
using ShramSafal.Domain.Dfes;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.Schedules;
using ShramSafal.Domain.Storage;
using ShramSafal.Domain.Work;

namespace ShramSafal.Domain.Tests.Common;

/// <summary>Shared strict IShramSafalRepository fake. Every member throws until a
/// subclass overrides it — so a test that routes through an un-stubbed codepath
/// fails LOUDLY instead of getting a silent default. Reused by Phase 2 (derivation
/// service) and Phase 5 (handler) test doubles.</summary>
public class FakeShramSafalRepository : IShramSafalRepository
{
    private static NotSupportedException NotStubbed([CallerMemberName] string? m = null)
        => new($"FakeShramSafalRepository.{m} is not stubbed — override it in your test subclass.");

    public virtual Task AddFarmAsync(Farm farm, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task AddFarmBoundaryAsync(FarmBoundary boundary, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task<Farm?> GetFarmByIdAsync(Guid farmId, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task AddFarmMembershipAsync(FarmMembership membership, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task<FarmMembership?> GetFarmMembershipAsync(Guid farmId, Guid userId, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task<AppRole?> GetUserRoleForFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task<bool> IsUserOwnerOfFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task AddPlotAsync(Plot plot, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task<Plot?> GetPlotByIdAsync(Guid plotId, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task<List<Plot>> GetPlotsByFarmIdAsync(Guid farmId, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task AddCropCycleAsync(CropCycle cropCycle, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task<CropCycle?> GetCropCycleByIdAsync(Guid cropCycleId, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task<List<CropCycle>> GetCropCyclesByPlotIdAsync(Guid plotId, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task AddDailyLogAsync(DailyLog log, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task<DailyLog?> GetDailyLogByIdAsync(Guid dailyLogId, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task<DailyLog?> GetDailyLogByIdempotencyKeyAsync(string idempotencyKey, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task AddCostEntryAsync(CostEntry costEntry, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task<CostEntry?> GetCostEntryByIdAsync(Guid costEntryId, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task<List<CostEntry>> GetCostEntriesByIdsAsync(IEnumerable<Guid> costEntryIds, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task<List<CostEntry>> GetCostEntriesForDuplicateCheck(FarmId farmId, Guid? plotId, string category, DateTime since, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task AddFinanceCorrectionAsync(FinanceCorrection correction, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task AddDayLedgerAsync(DayLedger dayLedger, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task<DayLedger?> GetDayLedgerByIdAsync(Guid dayLedgerId, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task<DayLedger?> GetDayLedgerBySourceCostEntryIdAsync(Guid costEntryId, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task<List<DayLedger>> GetDayLedgersForFarm(Guid farmId, DateOnly from, DateOnly to, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task AddAttachmentAsync(Attachment attachment, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task<Attachment?> GetAttachmentByIdAsync(Guid attachmentId, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task<List<Attachment>> GetAttachmentsForEntityAsync(Guid entityId, string entityType, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task AddPriceConfigAsync(PriceConfig config, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task AddAuditEventAsync(AuditEvent auditEvent, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task AddScheduleTemplateAsync(ScheduleTemplate template, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task<List<ScheduleTemplate>> GetScheduleTemplatesAsync(CancellationToken ct = default) => throw NotStubbed();
    public virtual Task AddPlannedActivitiesAsync(IEnumerable<PlannedActivity> plannedActivities, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task<PlannedActivity?> GetPlannedActivityByIdAsync(Guid id, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task<List<PlannedActivity>> GetPlannedActivitiesByCropCycleIdAsync(Guid cropCycleId, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task<List<LogTask>> GetExecutedTasksByCropCycleIdAsync(Guid cropCycleId, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task<List<CostEntry>> GetCostEntriesAsync(DateOnly? fromDate, DateOnly? toDate, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task<List<FinanceCorrection>> GetCorrectionsForEntriesAsync(IEnumerable<Guid> costEntryIds, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task<List<Farm>> GetFarmsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task<List<Plot>> GetPlotsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task<List<CropCycle>> GetCropCyclesChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task<List<DailyLog>> GetDailyLogsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task<List<CostEntry>> GetCostEntriesChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task<List<FinanceCorrection>> GetFinanceCorrectionsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task<List<DayLedger>> GetDayLedgersChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task<List<PriceConfig>> GetPriceConfigsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task<List<PlannedActivity>> GetPlannedActivitiesChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task<List<Attachment>> GetAttachmentsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task<List<AuditEvent>> GetAuditEventsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task<List<AuditEvent>> GetAuditEventsForEntityAsync(Guid entityId, string entityType, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task<List<AuditEvent>> GetAuditEventsForFarmAsync(Guid farmId, DateOnly from, DateOnly to, int limit, int offset, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task<List<Guid>> GetFarmIdsForUserAsync(Guid userId, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task<IReadOnlyList<SyncOperatorDto>> GetOperatorsByIdsAsync(IEnumerable<Guid> userIds, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task<bool> IsUserMemberOfFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task<int> CountActivePrimaryOwnersAsync(Guid farmId, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task AddCropScheduleTemplateAsync(CropScheduleTemplate template, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task<CropScheduleTemplate?> GetCropScheduleTemplateByIdAsync(ScheduleTemplateId templateId, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task<List<CropScheduleTemplate>> GetCropScheduleTemplatesForCropAsync(string cropKey, string? regionCode, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task AddScheduleSubscriptionAsync(ScheduleSubscription subscription, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task<ScheduleSubscription?> GetScheduleSubscriptionByIdAsync(ScheduleSubscriptionId subscriptionId, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task<ScheduleSubscription?> GetActiveScheduleSubscriptionAsync(Guid plotId, string cropKey, Guid cropCycleId, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task AddScheduleMigrationEventAsync(ScheduleMigrationEvent migrationEvent, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task<ScheduleTemplate?> GetScheduleTemplateByIdAsync(Guid templateId, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task<bool> HasActiveOwnerMembershipAsync(Guid userId, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task<List<ScheduleTemplate>> GetScheduleLineageAsync(Guid rootTemplateId, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task SaveChangesAsync(CancellationToken ct = default) => throw NotStubbed();
    public virtual Task<int> GetDisputedLogCountForPlotAsync(Guid plotId, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task AddJobCardAsync(JobCard jobCard, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task AddTranscriptAsync(Transcript transcript, CancellationToken ct = default) => throw NotStubbed();

    // ── DFES additive members (re-declared virtual so subclasses can override) ──
    public virtual Task<IReadOnlyList<DailyLog>> GetDailyLogsForFarmDateAsync(Guid farmId, DateOnly localDate, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task<IReadOnlyList<ObservationEvent>> GetObservationEventsForDailyLogsAsync(IReadOnlyCollection<Guid> dailyLogIds, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task<DailyRichnessAggregate?> GetDailyRichnessAggregateAsync(Guid farmId, DateOnly localDate, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task AddDailyRichnessAggregateAsync(DailyRichnessAggregate aggregate, CancellationToken ct = default) => throw NotStubbed();

    // ── DFES Phase 5 — question-engine telemetry ──
    public virtual Task AddQuestionEventAsync(QuestionEvent e, CancellationToken ct = default) => throw NotStubbed();
    public virtual Task<IReadOnlyList<QuestionEvent>> GetRecentQuestionEventsForFarmAsync(Guid farmId, DateTime sinceUtc, CancellationToken ct = default) => throw NotStubbed();
}
