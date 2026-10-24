using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Attachments;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Crops;
using ShramSafal.Domain.Dfes;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Labour;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.Schedules;

namespace ShramSafal.Domain.Tests.Logs;

/// <summary>
/// Minimal in-memory <see cref="IShramSafalRepository"/> covering only
/// the methods that <c>CreateDailyLogHandler</c>, <c>VerifyLogHandler</c>,
/// and the <c>OnLogVerifiedAutoVerifyJobCard</c> hook touch on a happy
/// path. Anything else throws loudly so a refactor that routes through a
/// new codepath cannot slip past silently.
///
/// <para>
/// Extracted from <c>LogHandlerAnalyticsTests</c> as part of
/// T-IGH-03-PIPELINE-ROLLOUT (VerifyLog) so the new
/// <c>VerifyLogPipelineTests</c> can reuse the same seedable repo
/// without duplicating ~80 method stubs.
/// </para>
/// </summary>
internal sealed class InMemoryShramSafalRepository : IShramSafalRepository
{
    private readonly Dictionary<Guid, Farm> _farms = new();
    private readonly Dictionary<Guid, Plot> _plots = new();
    private readonly Dictionary<Guid, CropCycle> _cropCycles = new();
    private readonly Dictionary<Guid, DailyLog> _logs = new();
    private readonly Dictionary<(Guid farmId, Guid userId), AppRole> _memberships = new();
    private readonly List<AuditEvent> _auditEvents = new();

    public IReadOnlyList<AuditEvent> AuditEvents => _auditEvents;

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

    // ── AI Intelligence Plan WP-2c (Track B typed ledger writers) ────────────
    // Capturing overrides of the IShramSafalRepository default no-op writers so
    // LedgerDerivationServiceTests (and any handler test that runs the confirm-
    // time derivation) can assert the staged rows. Everything is held in memory;
    // no SaveChanges semantics — the service stages, the handler commits.
    public List<FarmOperation> CapturedOperations { get; } = [];
    public List<ApplicationInputItem> CapturedInputItems { get; } = [];
    public List<IrrigationEntry> CapturedIrrigations { get; } = [];
    public List<LabourAssignment> CapturedLabour { get; } = [];
    public List<MachineryUsage> CapturedMachinery { get; } = [];
    public List<ObservationEvent> CapturedObservations { get; } = [];
    public List<DisturbanceEvent> CapturedDisturbances { get; } = [];

    /// <summary>Seed a CURRENT FarmOperation so a re-derivation supersedes it.</summary>
    public void SeedFarmOperation(FarmOperation op) => CapturedOperations.Add(op);

    /// <summary>
    /// Fix F1 — optional fault-injection hook fired at the START of
    /// <see cref="AddFarmOperationAsync"/> (the first derivation write). When set,
    /// the delegate runs before the row is captured, so a throw simulates a DB
    /// failure inside the NON-BLOCKING derivation side-car. Null (default) keeps
    /// the plain capture behaviour every other test relies on.
    /// </summary>
    public Action? OnAddFarmOperation { get; set; }

    public Task AddFarmOperationAsync(FarmOperation op, CancellationToken ct = default)
    {
        OnAddFarmOperation?.Invoke();
        CapturedOperations.Add(op);
        return Task.CompletedTask;
    }

    public Task AddApplicationInputItemAsync(ApplicationInputItem item, CancellationToken ct = default)
    { CapturedInputItems.Add(item); return Task.CompletedTask; }

    public Task AddIrrigationEntryAsync(IrrigationEntry e, CancellationToken ct = default)
    { CapturedIrrigations.Add(e); return Task.CompletedTask; }

    public Task AddLabourAssignmentAsync(LabourAssignment a, CancellationToken ct = default)
    { CapturedLabour.Add(a); return Task.CompletedTask; }

    // ── Task 11 (spec: 2026-07-13-labour-attendance-approval-design) —
    // Field Operator identity commands. Port has three homes (interface, EF
    // impl, this in-memory double); this sealed class needs no `virtual` —
    // nothing subclasses it.
    public List<FieldOperator> CapturedFieldOperators { get; } = [];
    public List<FieldOperatorWorkRow> CapturedFieldOperatorWorkRows { get; } = [];

    public Task AddFieldOperatorAsync(FieldOperator o, CancellationToken ct = default)
    { CapturedFieldOperators.Add(o); return Task.CompletedTask; }

    public Task<FieldOperator?> GetFieldOperatorByIdAsync(Guid id, CancellationToken ct = default)
        => Task.FromResult(CapturedFieldOperators.FirstOrDefault(o => o.Id == id));

    public Task<LabourAssignment?> GetLabourAssignmentByIdAsync(Guid id, CancellationToken ct = default)
        => Task.FromResult(CapturedLabour.FirstOrDefault(a => a.Id == id));

    public Task<IReadOnlyList<FieldOperator>> GetFieldOperatorsForFarmAsync(FarmId farmId, CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<FieldOperator>>(
            CapturedFieldOperators.Where(o => o.OriginatingFarmId == farmId).ToList());

    /// <summary>In-memory "ON CONFLICT DO NOTHING" — mirrors the unique index on (FieldOperatorId, LabourAssignmentId).</summary>
    public Task<bool> TryAddFieldOperatorWorkRowAsync(FieldOperatorWorkRow r, CancellationToken ct = default)
    {
        var alreadyExists = CapturedFieldOperatorWorkRows.Any(
            x => x.FieldOperatorId == r.FieldOperatorId && x.LabourAssignmentId == r.LabourAssignmentId);
        if (alreadyExists)
        {
            return Task.FromResult(false);
        }

        CapturedFieldOperatorWorkRows.Add(r);
        return Task.FromResult(true);
    }

    public Task AddMachineryUsageAsync(MachineryUsage m, CancellationToken ct = default)
    { CapturedMachinery.Add(m); return Task.CompletedTask; }

    public Task AddObservationEventAsync(ObservationEvent o, CancellationToken ct = default)
    { CapturedObservations.Add(o); return Task.CompletedTask; }

    /// <summary>
    /// Task 8.5 (labour-v2-r1) — fault-injection hook fired at the START of
    /// <see cref="AddDisturbanceEventAsync"/>, mirroring
    /// <see cref="OnAddFarmOperation"/>: a throw simulates a DB failure on the
    /// disturbance write, proving the dedup path never swallows a real write
    /// error. Null (default) keeps the plain capture behaviour.
    /// </summary>
    public Action? OnAddDisturbanceEvent { get; set; }

    public Task AddDisturbanceEventAsync(DisturbanceEvent d, CancellationToken ct = default)
    {
        OnAddDisturbanceEvent?.Invoke();
        CapturedDisturbances.Add(d);
        return Task.CompletedTask;
    }

    public Task<FarmOperation?> GetFarmOperationByKeyAsync(string derivedEventKey, CancellationToken ct = default)
        => Task.FromResult(CapturedOperations.FirstOrDefault(
            o => o.IsCurrentVersion && o.DerivedEventKey.Value == derivedEventKey));

    /// <summary>
    /// Task 8.5 — mirrors the production farm-day join: the event carries no
    /// farm or date, so its (farm, log-day, reason) identity resolves through
    /// the parent log in <c>_logs</c>. A captured disturbance whose parent log
    /// was never <see cref="AddLog"/>'d cannot claim a farm-day and is invisible
    /// here — tests exercising dedup must AddLog their logs first, exactly as
    /// production guarantees the log row is durable before the side-car runs.
    /// </summary>
    public Task<DisturbanceEvent?> GetDisturbanceEventForFarmDayAsync(
        Guid farmId, DateOnly logDate, string reason, CancellationToken ct = default)
        => Task.FromResult(CapturedDisturbances
            .Where(e => _logs.TryGetValue(e.DailyLogId, out var l)
                && l.FarmId.Value == farmId
                && l.LogDate == logDate
                && e.Reason == reason)
            .OrderBy(e => e.CreatedAtUtc)
            .FirstOrDefault());

    // ── WP-2d (D5) RoutineMemory upsert ──────────────────────────────────────
    // Captures the routine_patterns the derivation upserts so the reinforce
    // assertion can inspect them. GetRoutinePatternAsync returns the live
    // instance (not a copy) so the service's Reinforce mutation is observable.
    public List<RoutinePattern> CapturedRoutinePatterns { get; } = [];

    public Task<RoutinePattern?> GetRoutinePatternAsync(Guid farmId, Guid? plotId, string operationType, CancellationToken ct = default)
    {
        var normalizedOp = (operationType ?? string.Empty).Trim();
        return Task.FromResult(CapturedRoutinePatterns.FirstOrDefault(
            p => p.FarmId == farmId && p.PlotId == plotId && p.OperationType == normalizedOp));
    }

    public Task AddRoutinePatternAsync(RoutinePattern p, CancellationToken ct = default)
    { CapturedRoutinePatterns.Add(p); return Task.CompletedTask; }

    public Task<bool> IsUserMemberOfFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default)
        => Task.FromResult(_memberships.ContainsKey((farmId, userId)));

    // DFES (dfes-companion-2026-07-11) Phase 3 — seam for GetFarmerEngagementHandlerTests.
    // IShramSafalRepository.GetDailyRichnessAggregatesForFarmAsync is default-bodied
    // (returns empty) on the port; this override lets tests seed farm-scoped rows.
    public List<DailyRichnessAggregate> SeededRichnessAggregates { get; } = [];

    public Task<IReadOnlyList<DailyRichnessAggregate>> GetDailyRichnessAggregatesForFarmAsync(
        Guid farmId, CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<DailyRichnessAggregate>>(
            SeededRichnessAggregates
                .Where(a => a.FarmId == farmId)
                .OrderBy(a => a.LocalDate)
                .ToList());

    // DFES (dfes-companion-2026-07-11) Slice 3a — per-day seam for
    // GetDayUnderstandingHandlerTests. Mirrors the farm+local_date lookup the
    // production repo does under RLS; reads the same seeded list.
    public Task<DailyRichnessAggregate?> GetDailyRichnessAggregateAsync(
        Guid farmId, DateOnly localDate, CancellationToken ct = default)
        => Task.FromResult(
            SeededRichnessAggregates
                .FirstOrDefault(a => a.FarmId == farmId && a.LocalDate == localDate));

    // FIX (dfes-companion-2026-07-11) — the recompute write path now asks for a TRACKED
    // aggregate. In-memory there is no change tracker: the list already hands back the
    // live mutable object, so this delegates to the SAME backing store. That equivalence
    // is precisely why no fake-repository test can catch the detached-write bug — the
    // real-EF proof is in ShramSafal.Sync.IntegrationTests/Dfes.
    public Task<DailyRichnessAggregate?> GetDailyRichnessAggregateForUpdateAsync(
        Guid farmId, DateOnly localDate, CancellationToken ct = default)
        => GetDailyRichnessAggregateAsync(farmId, localDate, ct);

    // FIX (dfes-companion-2026-07-11) — the interface default no-ops these two
    // members, which is exactly wrong for a test that needs a REAL round-trip
    // (RecomputeAsync reads the day's logs, then writes the aggregate back).
    // GetDailyLogsForFarmDateAsync reads from the same _logs store AddLog/
    // AddDailyLogAsync populate; AddDailyRichnessAggregateAsync writes into the
    // SAME SeededRichnessAggregates list GetDailyRichnessAggregateAsync reads
    // from, so a write is visible to a later read exactly like the real table.
    public Task<IReadOnlyList<DailyLog>> GetDailyLogsForFarmDateAsync(
        Guid farmId, DateOnly localDate, CancellationToken ct = default)
        => Task.FromResult<IReadOnlyList<DailyLog>>(
            _logs.Values.Where(l => l.FarmId.Value == farmId && l.LogDate == localDate).ToList());

    public Task AddDailyRichnessAggregateAsync(
        DailyRichnessAggregate aggregate, CancellationToken ct = default)
    {
        SeededRichnessAggregates.Add(aggregate);
        return Task.CompletedTask;
    }

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
    // T-IGH-03-PIPELINE-ROLLOUT (AddCostEntry): no-op so the pipeline
    // happy-path test can save without persistence side-effects we
    // don't assert on. Tests that assert specific persistence shape
    // should use a more capable stub or a real DbContext.
    public Task AddCostEntryAsync(CostEntry costEntry, CancellationToken ct = default) => Task.CompletedTask;
    public Task<CostEntry?> GetCostEntryByIdAsync(Guid costEntryId, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<List<CostEntry>> GetCostEntriesByIdsAsync(IEnumerable<Guid> costEntryIds, CancellationToken ct = default) => throw new NotImplementedException();
    // T-IGH-03-PIPELINE-ROLLOUT (AddCostEntry): the AddCostEntry
    // handler body calls this for duplicate detection on every save.
    // The pipeline tests don't seed any CostEntries, so an empty list
    // is the right behaviour — exercising the "no duplicates" path.
    public Task<List<CostEntry>> GetCostEntriesForDuplicateCheck(FarmId farmId, Guid? plotId, string category, DateTime since, CancellationToken ct = default)
        => Task.FromResult(new List<CostEntry>());
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
    public Task<List<ScheduleTemplate>> GetScheduleLineageAsync(Guid rootTemplateId, CancellationToken ct = default) => throw new NotImplementedException();
    public Task<int> GetDisputedLogCountForPlotAsync(Guid plotId, CancellationToken ct = default) => throw new NotSupportedException();

    // Sub-plan 03 Task 5 (T-IGH-03-PORT-COMPLETE-MIGRATION):
    // required interface members; no-op in this test stub.
    public Task AddFarmBoundaryAsync(FarmBoundary boundary, CancellationToken ct = default) => Task.CompletedTask;
    public Task AddJobCardAsync(ShramSafal.Domain.Work.JobCard jobCard, CancellationToken ct = default) => Task.CompletedTask;

    // DATA_PRINCIPLE_SPINE sub-phase 02.3 — warm-tier transcript persistence;
    // not exercised by log handler tests so a no-op is sufficient.
    public Task AddTranscriptAsync(ShramSafal.Domain.AI.Transcript transcript, CancellationToken ct = default) => Task.CompletedTask;
}
