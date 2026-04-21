using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Attachments;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Crops;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.Schedules;
using ShramSafal.Domain.Tests;

namespace ShramSafal.Domain.Tests.Tests;

/// <summary>Shared fakes for CEI Phase 2 §4.5 test-handler unit tests.</summary>
internal sealed class FakeClock : IClock
{
    private DateTime _now;
    public FakeClock(DateTime now) => _now = now;
    public DateTime UtcNow => _now;
    public void Advance(TimeSpan by) => _now = _now.Add(by);
}

internal sealed class FakeIdGenerator(IEnumerable<Guid>? preset = null) : IIdGenerator
{
    private readonly Queue<Guid> _queue = new(preset ?? Array.Empty<Guid>());
    public Guid New() => _queue.TryDequeue(out var id) ? id : Guid.NewGuid();
}

internal sealed class FakeTestProtocolRepository : ITestProtocolRepository
{
    private readonly Dictionary<Guid, TestProtocol> _byId = new();

    public List<TestProtocol> Added { get; } = new();

    public void Seed(TestProtocol protocol) => _byId[protocol.Id] = protocol;

    public Task AddAsync(TestProtocol protocol, CancellationToken ct = default)
    {
        _byId[protocol.Id] = protocol;
        Added.Add(protocol);
        return Task.CompletedTask;
    }

    public Task<TestProtocol?> GetByIdAsync(Guid protocolId, CancellationToken ct = default)
    {
        _byId.TryGetValue(protocolId, out var p);
        return Task.FromResult(p);
    }

    public Task<IReadOnlyList<TestProtocol>> GetByCropTypeAsync(string cropType, CancellationToken ct = default)
    {
        IReadOnlyList<TestProtocol> results = _byId.Values
            .Where(p => string.Equals(p.CropType.Trim(), cropType?.Trim(), StringComparison.OrdinalIgnoreCase))
            .ToList();
        return Task.FromResult(results);
    }
}

internal sealed class FakeTestInstanceRepository : ITestInstanceRepository
{
    private readonly Dictionary<Guid, TestInstance> _byId = new();

    public List<TestInstance> Added { get; } = new();
    public int SaveCalls { get; private set; }

    public void Seed(TestInstance instance) => _byId[instance.Id] = instance;

    public Task AddAsync(TestInstance instance, CancellationToken ct = default)
    {
        _byId[instance.Id] = instance;
        Added.Add(instance);
        return Task.CompletedTask;
    }

    public Task AddRangeAsync(IEnumerable<TestInstance> instances, CancellationToken ct = default)
    {
        foreach (var i in instances)
        {
            _byId[i.Id] = i;
            Added.Add(i);
        }
        return Task.CompletedTask;
    }

    public Task<TestInstance?> GetByIdAsync(Guid testInstanceId, CancellationToken ct = default)
    {
        _byId.TryGetValue(testInstanceId, out var i);
        return Task.FromResult(i);
    }

    public Task<IReadOnlyList<TestInstance>> GetByCropCycleIdAsync(Guid cropCycleId, CancellationToken ct = default)
    {
        IReadOnlyList<TestInstance> r = _byId.Values
            .Where(i => i.CropCycleId == cropCycleId)
            .OrderBy(i => i.PlannedDueDate)
            .ToList();
        return Task.FromResult(r);
    }

    public Task<IReadOnlyList<TestInstance>> GetByFarmIdAndStatusAsync(
        FarmId farmId,
        IReadOnlyCollection<TestInstanceStatus> statuses,
        CancellationToken ct = default)
    {
        var statusSet = statuses.ToHashSet();
        IReadOnlyList<TestInstance> r = _byId.Values
            .Where(i => i.FarmId == farmId && statusSet.Contains(i.Status))
            .ToList();
        return Task.FromResult(r);
    }

    public Task<IReadOnlyList<TestInstance>> GetOverdueAsync(DateOnly today, CancellationToken ct = default)
    {
        IReadOnlyList<TestInstance> r = _byId.Values
            .Where(i => i.Status == TestInstanceStatus.Due && i.PlannedDueDate < today)
            .ToList();
        return Task.FromResult(r);
    }

    public Task<IReadOnlyList<TestInstance>> GetModifiedSinceAsync(
        IReadOnlyCollection<FarmId> farmIds,
        DateTime sinceUtc,
        CancellationToken ct = default)
    {
        var farmSet = farmIds.ToHashSet();
        IReadOnlyList<TestInstance> r = _byId.Values
            .Where(i => farmSet.Contains(i.FarmId) && i.ModifiedAtUtc > sinceUtc)
            .OrderBy(i => i.ModifiedAtUtc)
            .ToList();
        return Task.FromResult(r);
    }

    public Task SaveChangesAsync(CancellationToken ct = default)
    {
        SaveCalls++;
        return Task.CompletedTask;
    }
}

internal sealed class FakeTestRecommendationRepository : ITestRecommendationRepository
{
    public List<TestRecommendation> Added { get; } = new();

    public Task AddRangeAsync(IEnumerable<TestRecommendation> recommendations, CancellationToken ct = default)
    {
        Added.AddRange(recommendations);
        return Task.CompletedTask;
    }

    public Task<IReadOnlyList<TestRecommendation>> GetByTestInstanceIdAsync(Guid testInstanceId, CancellationToken ct = default)
    {
        IReadOnlyList<TestRecommendation> r = Added
            .Where(x => x.TestInstanceId == testInstanceId)
            .OrderBy(x => x.CreatedAtUtc)
            .ToList();
        return Task.FromResult(r);
    }

    public Task<IReadOnlyList<TestRecommendation>> GetByTestInstanceIdsAsync(
        IReadOnlyCollection<Guid> testInstanceIds,
        CancellationToken ct = default)
    {
        var idSet = testInstanceIds.ToHashSet();
        IReadOnlyList<TestRecommendation> r = Added
            .Where(x => idSet.Contains(x.TestInstanceId))
            .OrderBy(x => x.CreatedAtUtc)
            .ToList();
        return Task.FromResult(r);
    }
}

/// <summary>
/// Minimal <see cref="IShramSafalRepository"/> stub for handler unit tests in
/// CEI §4.5. Only <see cref="AddAuditEventAsync"/> and
/// <see cref="SaveChangesAsync"/> are implemented; everything else throws.
/// </summary>
internal sealed class FakeAuditOnlyRepository : IShramSafalRepository
{
    public List<AuditEvent> AuditEvents { get; } = new();
    public int SaveCalls { get; private set; }

    public Task AddAuditEventAsync(AuditEvent auditEvent, CancellationToken ct = default)
    {
        AuditEvents.Add(auditEvent);
        return Task.CompletedTask;
    }

    public Task SaveChangesAsync(CancellationToken ct = default)
    {
        SaveCalls++;
        return Task.CompletedTask;
    }

    // ---- everything else: NotSupported --------------------------------------------------
    public Task AddFarmAsync(Farm farm, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<Farm?> GetFarmByIdAsync(Guid farmId, CancellationToken ct = default) => throw new NotSupportedException();
    public Task AddFarmMembershipAsync(FarmMembership membership, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<FarmMembership?> GetFarmMembershipAsync(Guid farmId, Guid userId, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<AppRole?> GetUserRoleForFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<int> CountActivePrimaryOwnersAsync(Guid farmId, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<bool> IsUserOwnerOfFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<bool> IsUserMemberOfFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default) => throw new NotSupportedException();
    public Task AddPlotAsync(Plot plot, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<Plot?> GetPlotByIdAsync(Guid plotId, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<List<Plot>> GetPlotsByFarmIdAsync(Guid farmId, CancellationToken ct = default) => throw new NotSupportedException();
    public Task AddCropCycleAsync(CropCycle cropCycle, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<CropCycle?> GetCropCycleByIdAsync(Guid cropCycleId, CancellationToken ct = default) => throw new NotSupportedException();
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
    public Task<IReadOnlyList<SyncOperatorDto>> GetOperatorsByIdsAsync(IEnumerable<Guid> userIds, CancellationToken ct = default) => throw new NotSupportedException();
    public Task AddCropScheduleTemplateAsync(CropScheduleTemplate template, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<CropScheduleTemplate?> GetCropScheduleTemplateByIdAsync(ScheduleTemplateId templateId, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<List<CropScheduleTemplate>> GetCropScheduleTemplatesForCropAsync(string cropKey, string? regionCode, CancellationToken ct = default) => throw new NotSupportedException();
    public Task AddScheduleSubscriptionAsync(ScheduleSubscription subscription, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<ScheduleSubscription?> GetScheduleSubscriptionByIdAsync(ScheduleSubscriptionId subscriptionId, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<ScheduleSubscription?> GetActiveScheduleSubscriptionAsync(Guid plotId, string cropKey, Guid cropCycleId, CancellationToken ct = default) => throw new NotSupportedException();
    public Task AddScheduleMigrationEventAsync(ScheduleMigrationEvent migrationEvent, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<ScheduleTemplate?> GetScheduleTemplateByIdAsync(Guid templateId, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<bool> HasActiveOwnerMembershipAsync(Guid userId, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<List<ScheduleTemplate>> GetScheduleLineageAsync(Guid rootTemplateId, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<int> GetDisputedLogCountForPlotAsync(Guid plotId, CancellationToken ct = default) => throw new NotSupportedException();
    public Task<List<Guid>> GetFarmIdsForUserAsync(Guid userId, CancellationToken ct = default) => throw new NotSupportedException();
}
