using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Attachments;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Crops;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Labour;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.Schedules;
using ShramSafal.Domain.Work;

namespace ShramSafal.Domain.Tests.Work.Handlers;

/// <summary>
/// Base stub repository for handler unit tests.
/// All members throw <see cref="NotSupportedException"/> by default.
/// Override only the methods required by the handler under test.
/// </summary>
internal abstract class StubShramSafalRepository : IShramSafalRepository
{
    public virtual Task AddFarmAsync(Farm farm, CancellationToken ct = default) => throw new NotSupportedException();
    public virtual Task<Farm?> GetFarmByIdAsync(Guid farmId, CancellationToken ct = default) => throw new NotSupportedException();
    public virtual Task AddFarmMembershipAsync(FarmMembership membership, CancellationToken ct = default) => throw new NotSupportedException();
    public virtual Task<FarmMembership?> GetFarmMembershipAsync(Guid farmId, Guid userId, CancellationToken ct = default) => Task.FromResult<FarmMembership?>(null);
    public virtual Task<AppRole?> GetUserRoleForFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default) => Task.FromResult<AppRole?>(null);
    public virtual Task<bool> IsUserOwnerOfFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default) => Task.FromResult(false);
    public virtual Task AddPlotAsync(Plot plot, CancellationToken ct = default) => throw new NotSupportedException();
    public virtual Task<Plot?> GetPlotByIdAsync(Guid plotId, CancellationToken ct = default) => throw new NotSupportedException();
    public virtual Task<List<Plot>> GetPlotsByFarmIdAsync(Guid farmId, CancellationToken ct = default) => throw new NotSupportedException();
    public virtual Task AddCropCycleAsync(CropCycle cropCycle, CancellationToken ct = default) => throw new NotSupportedException();
    public virtual Task<CropCycle?> GetCropCycleByIdAsync(Guid cropCycleId, CancellationToken ct = default) => throw new NotSupportedException();
    public virtual Task<List<CropCycle>> GetCropCyclesByPlotIdAsync(Guid plotId, CancellationToken ct = default) => throw new NotSupportedException();
    public virtual Task AddDailyLogAsync(DailyLog log, CancellationToken ct = default) => throw new NotSupportedException();
    public virtual Task<DailyLog?> GetDailyLogByIdAsync(Guid dailyLogId, CancellationToken ct = default) => Task.FromResult<DailyLog?>(null);
    public virtual Task<DailyLog?> GetDailyLogByIdempotencyKeyAsync(string idempotencyKey, CancellationToken ct = default) => throw new NotSupportedException();
    public virtual Task AddCostEntryAsync(CostEntry costEntry, CancellationToken ct = default) => throw new NotSupportedException();
    public virtual Task<CostEntry?> GetCostEntryByIdAsync(Guid costEntryId, CancellationToken ct = default) => throw new NotSupportedException();
    public virtual Task<List<CostEntry>> GetCostEntriesByIdsAsync(IEnumerable<Guid> costEntryIds, CancellationToken ct = default) => throw new NotSupportedException();
    public virtual Task<List<CostEntry>> GetCostEntriesForDuplicateCheck(FarmId farmId, Guid? plotId, string category, DateTime since, CancellationToken ct = default) => throw new NotSupportedException();
    public virtual Task AddFinanceCorrectionAsync(FinanceCorrection correction, CancellationToken ct = default) => throw new NotSupportedException();
    public virtual Task AddDayLedgerAsync(DayLedger dayLedger, CancellationToken ct = default) => throw new NotSupportedException();
    public virtual Task<DayLedger?> GetDayLedgerByIdAsync(Guid dayLedgerId, CancellationToken ct = default) => throw new NotSupportedException();
    public virtual Task<DayLedger?> GetDayLedgerBySourceCostEntryIdAsync(Guid costEntryId, CancellationToken ct = default) => throw new NotSupportedException();
    public virtual Task<List<DayLedger>> GetDayLedgersForFarm(Guid farmId, DateOnly from, DateOnly to, CancellationToken ct = default) => throw new NotSupportedException();
    public virtual Task AddAttachmentAsync(Attachment attachment, CancellationToken ct = default) => throw new NotSupportedException();
    public virtual Task<Attachment?> GetAttachmentByIdAsync(Guid attachmentId, CancellationToken ct = default) => throw new NotSupportedException();
    public virtual Task<List<Attachment>> GetAttachmentsForEntityAsync(Guid entityId, string entityType, CancellationToken ct = default) => throw new NotSupportedException();
    public virtual Task AddPriceConfigAsync(PriceConfig config, CancellationToken ct = default) => throw new NotSupportedException();
    public virtual Task AddAuditEventAsync(AuditEvent auditEvent, CancellationToken ct = default) => Task.CompletedTask;
    public virtual Task AddScheduleTemplateAsync(ScheduleTemplate template, CancellationToken ct = default) => throw new NotSupportedException();
    public virtual Task<List<ScheduleTemplate>> GetScheduleTemplatesAsync(CancellationToken ct = default) => throw new NotSupportedException();
    public virtual Task AddPlannedActivitiesAsync(IEnumerable<PlannedActivity> plannedActivities, CancellationToken ct = default) => throw new NotSupportedException();
    public virtual Task<PlannedActivity?> GetPlannedActivityByIdAsync(Guid id, CancellationToken ct = default) => throw new NotSupportedException();
    public virtual Task<List<PlannedActivity>> GetPlannedActivitiesByCropCycleIdAsync(Guid cropCycleId, CancellationToken ct = default) => throw new NotSupportedException();
    public virtual Task<List<LogTask>> GetExecutedTasksByCropCycleIdAsync(Guid cropCycleId, CancellationToken ct = default) => throw new NotSupportedException();
    public virtual Task<List<CostEntry>> GetCostEntriesAsync(DateOnly? fromDate, DateOnly? toDate, CancellationToken ct = default) => throw new NotSupportedException();
    public virtual Task<List<FinanceCorrection>> GetCorrectionsForEntriesAsync(IEnumerable<Guid> costEntryIds, CancellationToken ct = default) => throw new NotSupportedException();
    public virtual Task<List<Farm>> GetFarmsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
    public virtual Task<List<Plot>> GetPlotsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
    public virtual Task<List<CropCycle>> GetCropCyclesChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
    public virtual Task<List<DailyLog>> GetDailyLogsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
    public virtual Task<List<CostEntry>> GetCostEntriesChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
    public virtual Task<List<FinanceCorrection>> GetFinanceCorrectionsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
    public virtual Task<List<DayLedger>> GetDayLedgersChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
    public virtual Task<List<PriceConfig>> GetPriceConfigsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
    public virtual Task<List<PlannedActivity>> GetPlannedActivitiesChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
    public virtual Task<List<Attachment>> GetAttachmentsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
    public virtual Task<List<AuditEvent>> GetAuditEventsChangedSinceAsync(DateTime sinceUtc, CancellationToken ct = default) => throw new NotSupportedException();
    public virtual Task<List<AuditEvent>> GetAuditEventsForEntityAsync(Guid entityId, string entityType, CancellationToken ct = default) => throw new NotSupportedException();
    public virtual Task<List<AuditEvent>> GetAuditEventsForFarmAsync(Guid farmId, DateOnly from, DateOnly to, int limit, int offset, CancellationToken ct = default) => throw new NotSupportedException();
    public virtual Task<List<Guid>> GetFarmIdsForUserAsync(Guid userId, CancellationToken ct = default) => throw new NotSupportedException();
    public virtual Task<IReadOnlyList<SyncOperatorDto>> GetOperatorsByIdsAsync(IEnumerable<Guid> userIds, CancellationToken ct = default) => throw new NotSupportedException();
    public virtual Task<bool> IsUserMemberOfFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default) => Task.FromResult(false);
    public virtual Task<int> CountActivePrimaryOwnersAsync(Guid farmId, CancellationToken ct = default) => throw new NotSupportedException();
    public virtual Task AddCropScheduleTemplateAsync(CropScheduleTemplate template, CancellationToken ct = default) => throw new NotSupportedException();
    public virtual Task<CropScheduleTemplate?> GetCropScheduleTemplateByIdAsync(ScheduleTemplateId templateId, CancellationToken ct = default) => Task.FromResult<CropScheduleTemplate?>(null);
    public virtual Task<List<CropScheduleTemplate>> GetCropScheduleTemplatesForCropAsync(string cropKey, string? regionCode, CancellationToken ct = default) => throw new NotSupportedException();
    public virtual Task AddScheduleSubscriptionAsync(ScheduleSubscription subscription, CancellationToken ct = default) => throw new NotSupportedException();
    public virtual Task<ScheduleSubscription?> GetScheduleSubscriptionByIdAsync(ScheduleSubscriptionId subscriptionId, CancellationToken ct = default) => throw new NotSupportedException();
    public virtual Task<ScheduleSubscription?> GetActiveScheduleSubscriptionAsync(Guid plotId, string cropKey, Guid cropCycleId, CancellationToken ct = default) => Task.FromResult<ScheduleSubscription?>(null);
    public virtual Task AddScheduleMigrationEventAsync(ScheduleMigrationEvent migrationEvent, CancellationToken ct = default) => throw new NotSupportedException();
    public virtual Task<ScheduleTemplate?> GetScheduleTemplateByIdAsync(Guid templateId, CancellationToken ct = default) => throw new NotSupportedException();
    public virtual Task<bool> HasActiveOwnerMembershipAsync(Guid userId, CancellationToken ct = default) => throw new NotSupportedException();
    public virtual Task<List<ScheduleTemplate>> GetScheduleLineageAsync(Guid rootTemplateId, CancellationToken ct = default) => throw new NotSupportedException();
    public virtual Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    public virtual Task<int> GetDisputedLogCountForPlotAsync(Guid plotId, CancellationToken ct = default) => throw new NotSupportedException();

    // --- CEI Phase 4 §4.8 (Work Trust Ledger) ------------------------------------------
    public virtual Task AddJobCardAsync(JobCard jobCard, CancellationToken ct = default) => Task.CompletedTask;
    public virtual Task<JobCard?> GetJobCardByIdAsync(Guid jobCardId, CancellationToken ct = default) => Task.FromResult<JobCard?>(null);
    public virtual Task<List<JobCard>> GetJobCardsForFarmAsync(FarmId farmId, JobCardStatus? statusFilter, CancellationToken ct = default) => Task.FromResult(new List<JobCard>());
    public virtual Task<List<JobCard>> GetJobCardsForWorkerAsync(UserId workerUserId, CancellationToken ct = default) => Task.FromResult(new List<JobCard>());
    public virtual Task<List<JobCard>> GetJobCardsChangedSinceAsync(IEnumerable<Guid> farmIds, DateTime sinceUtc, CancellationToken ct = default) => Task.FromResult(new List<JobCard>());
    public virtual Task<WorkerMetricsDto> GetWorkerMetricsAsync(UserId workerUserId, IReadOnlyCollection<Guid> scopedFarmIds, DateTime since30d, CancellationToken ct = default) => Task.FromResult(new WorkerMetricsDto(0, 0, 0, 0, 0, 0, 0));

    // spec: dfes-companion-2026-07-11 (wave-4.4). False by default so every handler test
    // inherits the closed state; a test that wants the portable case must say so out
    // loud by overriding it. See WorkerRecordPortability (founder ruling A, 2026-08-17).
    public virtual Task<bool> HasWorkerRecordPortabilityConsentAsync(UserId workerUserId, CancellationToken ct = default) => Task.FromResult(false);

    // Empty by default — a test that wants the two-farms-of-his-own case (founder ruling,
    // 2026-08-17) must claim that ownership out loud.
    public virtual Task<List<Guid>> GetOwnedFarmIdsForUserAsync(Guid userId, CancellationToken ct = default) => Task.FromResult(new List<Guid>());

    // TIER 2. Empty is the production answer too — nothing writes statements yet, and
    // empty means the farm said nothing, never a zero.
    public virtual Task<IReadOnlyList<WorkerStatement>> GetWorkerStatementsAsync(UserId workerUserId, CancellationToken ct = default) => Task.FromResult<IReadOnlyList<WorkerStatement>>([]);
    public virtual Task<JobCard?> GetJobCardByLinkedDailyLogIdAsync(Guid dailyLogId, CancellationToken ct = default) => Task.FromResult<JobCard?>(null);

    // Sub-plan 03 Task 5 (T-IGH-03-PORT-COMPLETE-MIGRATION):
    // required interface members; no-op in this test stub.
    public Task AddFarmBoundaryAsync(ShramSafal.Domain.Farms.FarmBoundary boundary, CancellationToken ct = default) => Task.CompletedTask;

    // DATA_PRINCIPLE_SPINE sub-phase 02.3 — warm-tier transcript persistence;
    // not exercised by JobCard pipeline tests so a virtual no-op is sufficient.
    public virtual Task AddTranscriptAsync(ShramSafal.Domain.AI.Transcript transcript, CancellationToken ct = default) => Task.CompletedTask;

    // --- Task 11 (spec: 2026-07-13-labour-attendance-approval-design) — Field
    // Operator identity commands. These five all have DEFAULT bodies on
    // IShramSafalRepository (A10), so this abstract class is not REQUIRED to
    // re-declare them to compile. It does so anyway, `virtual`, matching every
    // other member in this file — a C# class that relies on an interface's own
    // default-interface-method body (rather than declaring its own virtual
    // member) cannot have that member overridden by a further-derived class;
    // dispatch through an IShramSafalRepository-typed reference would keep
    // resolving to the interface default no matter what a FakeRepo subclass
    // declares. Skipping this would make every FakeRepo override below
    // silently no-op instead of failing to compile — worse than a compile
    // error, so it is called out explicitly here.
    public virtual Task AddFieldOperatorAsync(FieldOperator o, CancellationToken ct = default) => Task.CompletedTask;
    public virtual Task<FieldOperator?> GetFieldOperatorByIdAsync(Guid id, CancellationToken ct = default) => Task.FromResult<FieldOperator?>(null);
    public virtual Task<LabourAssignment?> GetLabourAssignmentByIdAsync(Guid id, CancellationToken ct = default) => Task.FromResult<LabourAssignment?>(null);
    public virtual Task<IReadOnlyList<FieldOperator>> GetFieldOperatorsForFarmAsync(FarmId farmId, CancellationToken ct = default) => Task.FromResult<IReadOnlyList<FieldOperator>>([]);
    public virtual Task<bool> TryAddFieldOperatorWorkRowAsync(FieldOperatorWorkRow r, CancellationToken ct = default) => Task.FromResult(true);

    // Task 12b — restated here for the SAME reason as the Task 11 block above:
    // an interface DEFAULT implementation is not a virtual class member, so a
    // FakeRepo subclass could not override it and every override would silently
    // no-op instead of failing to compile.
    public virtual Task AddLabourCorrectionAsync(LabourCorrection c, CancellationToken ct = default) => Task.CompletedTask;
    public virtual Task<IReadOnlyList<FieldOperatorWorkRow>> GetFieldOperatorWorkRowsForAssignmentAsync(Guid labourAssignmentId, CancellationToken ct = default) => Task.FromResult<IReadOnlyList<FieldOperatorWorkRow>>([]);
    public virtual Task RemoveFieldOperatorWorkRowAsync(FieldOperatorWorkRow r, CancellationToken ct = default) => Task.CompletedTask;
    public virtual Task AddFieldOperatorWorkRowAsync(FieldOperatorWorkRow r, CancellationToken ct = default) => Task.CompletedTask;

    // LABOUR_PHASE2 Phase 5 (migration ②) — restated `virtual` for the SAME
    // reason as the two blocks above, and it matters more here than anywhere
    // else in this file: GetLabourManagementGrantAsync is the input to an
    // AUTHORIZATION decision. Left as the interface default, a FakeRepo that
    // "grants" the capability would be silently ignored, every allow-case test
    // would fail, and — far worse — every DENY-case test would still pass while
    // proving nothing about the grant path.
    public virtual Task<bool> GetLabourManagementGrantAsync(Guid farmId, Guid userId, DateTime nowUtc, CancellationToken ct = default) => Task.FromResult(false);
    public virtual Task<FarmMembership?> GetTrackedFarmMembershipAsync(Guid farmId, Guid userId, CancellationToken ct = default) => Task.FromResult<FarmMembership?>(null);

    // Task 1.2's roster read, restated `virtual` for the third time for the same
    // reason. Same default (empty) as the interface body, so nothing that relied
    // on it changes — it simply becomes overridable, which the Phase 5
    // labour-permission roster read needs.
    public virtual Task<List<FarmMembership>> GetFarmMembershipsAsync(FarmId farmId, CancellationToken ct = default) => Task.FromResult(new List<FarmMembership>());

    // Task 1 (spec: 2026-08-28-labour-v2-release-1) — restated `virtual` for the
    // SAME reason as every block above: an interface DEFAULT implementation is
    // not a virtual class member, so a FakeRepo subclass could not override it
    // — every override would silently no-op instead of failing to compile.
    // Same default (empty) as the interface body. EarnedIsUnknownNotZeroTests
    // needs this overridable to prove a farm can carry real labour-money
    // CostEntry rows while GetJobCardsForFarmAsync stays at its (already
    // overridable) empty default — the exact "money paid, zero job cards"
    // shape production is in today.
    public virtual Task<List<(CostEntry CostEntry, Guid? AssignedWorkerUserId)>> GetLabourPayoutCostEntriesWithJobCardAsync(
        FarmId farmId, DateOnly? fromDate, DateOnly? toDateInclusive, CancellationToken ct = default)
        => Task.FromResult(new List<(CostEntry, Guid?)>());

    // Task 6 (spec: 2026-08-28-labour-v2-release-1) — restated `virtual` for the
    // SAME reason as every block above: an interface DEFAULT implementation is
    // not a virtual class member, so a FakeRepo subclass could not override it
    // — every override would silently no-op instead of failing to compile.
    // Same default (empty) as the interface body. UnknownHeadcountIsNotZeroTests
    // needs this overridable to seed a LabourAssignment whose headcount was
    // never stated (all three of WorkerCount/MaleCount/FemaleCount null) — the
    // exact row shape that used to sum to a fabricated 0 man-days.
    // Task 9 (spec: 2026-08-28-labour-v2-release-1) — renamed from
    // ...ForFarmSinceAsync and given an optional, two-sided date window. Same
    // default (empty), same `virtual` reason as above.
    public virtual Task<List<LabourAssignment>> GetLabourAssignmentsForFarmInWindowAsync(
        FarmId farmId, DateOnly? fromDate, DateOnly? toDateInclusive, CancellationToken ct = default)
        => Task.FromResult(new List<LabourAssignment>());

    // Task 6 fix round 1/5 (spec: 2026-08-28-labour-v2-release-1) — restated
    // `virtual` for the SAME reason as every block above. UnknownHeadcountIsNotZeroTests
    // needs this overridable to distinguish "no daily log at all this week" from
    // "logs exist this week but none carries labour" — the three-case split the
    // review required (Fix round 1/5): absence of any record is UNKNOWN, a
    // recorded day with no labour is a genuine 0.
    public virtual Task<List<DailyLog>> GetDailyLogsByFarmAsync(FarmId farmId, CancellationToken ct = default)
        => Task.FromResult(new List<DailyLog>());

    // Task 3.5b (spec: 2026-08-28-labour-v2-release-1) — restated `virtual`
    // for the SAME reason as every block above: an interface DEFAULT
    // implementation is not a virtual class member, so a FakeRepo subclass
    // could not override it — every override would silently no-op instead of
    // failing to compile. Bodies MATCH the interface defaults exactly: the
    // facts read and the mark read/add THROW (a "no contradiction found" or
    // "nothing recorded" answer is a positive claim an unimplemented double
    // must not make silently); the correction add stages benignly like
    // AddLabourCorrectionAsync.
    public virtual Task<IReadOnlyList<AttendanceEngagementFact>> GetAttendanceEngagementFactsAsync(
        FarmId farmId, Guid fieldOperatorId, DateOnly workDate, CancellationToken ct = default)
        => throw new NotSupportedException(
            "GetAttendanceEngagementFactsAsync is not implemented by this test double. "
            + "Returning an empty list would assert that no contradiction exists.");

    public virtual Task<AttendanceMark?> GetAttendanceMarkAsync(
        FarmId farmId, Guid fieldOperatorId, DateOnly workDate, CancellationToken ct = default)
        => throw new NotSupportedException("GetAttendanceMarkAsync is not implemented by this test double.");

    public virtual Task AddAttendanceMarkAsync(AttendanceMark mark, CancellationToken ct = default)
        => throw new NotSupportedException("AddAttendanceMarkAsync is not implemented by this test double.");

    public virtual Task AddAttendanceMarkCorrectionAsync(AttendanceMarkCorrection correction, CancellationToken ct = default)
        => Task.CompletedTask;
}
