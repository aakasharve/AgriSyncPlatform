using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Finance.AddCostEntry;
using ShramSafal.Application.UseCases.Finance.AllocateGlobalExpense;
using ShramSafal.Application.UseCases.Finance.CorrectCostEntry;
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

namespace ShramSafal.Domain.Tests.Finance;

/// <summary>
/// MIS Integration Plan — Phase 2 Batch D.
/// Verifies that the three finance commit-time handlers emit exactly one
/// <see cref="AnalyticsEvent"/> on the success path, with the expected event
/// type, actor, farm, and core property shape. These tests are hermetic —
/// they use an in-memory fake repository so there is no DB dependency.
/// </summary>
public sealed class FinanceAnalyticsEmissionTests
{
    private static readonly DateTime FixedUtcNow = new(2026, 4, 19, 12, 0, 0, DateTimeKind.Utc);

    // ---- D1 --------------------------------------------------------------

    [Fact]
    public async Task AddCostEntry_SuccessPath_EmitsSingleCostEntryAddedEvent()
    {
        var farmId = new FarmId(Guid.NewGuid());
        var userId = new UserId(Guid.NewGuid());
        var plotId = Guid.NewGuid();

        var repo = new InMemoryFinanceRepo();
        repo.AddFarm(Farm.Create(farmId, "Test Farm", userId, FixedUtcNow));
        repo.AddPlot(Plot.Create(plotId, farmId, "Plot A", 2m, FixedUtcNow));
        repo.AddMembership(farmId.Value, userId.Value, AppRole.PrimaryOwner);

        var analytics = new CapturingAnalyticsWriter();
        var handler = new AddCostEntryHandler(
            repo,
            new SequentialIdGenerator(),
            new FixedClock(FixedUtcNow),
            new AllowAllEntitlementPolicy(),
            analytics);

        var command = new AddCostEntryCommand(
            FarmId: farmId.Value,
            PlotId: plotId,
            CropCycleId: null,
            Category: "Fertilizer",
            Description: "Urea 50kg",
            Amount: 1500m,
            CurrencyCode: "INR",
            EntryDate: new DateOnly(2026, 4, 19),
            CreatedByUserId: userId.Value,
            Location: null,
            CostEntryId: null,
            ActorRole: "owner",
            ClientCommandId: "cmd-d1");

        var result = await handler.HandleAsync(command);

        Assert.True(result.IsSuccess);
        Assert.Single(analytics.Events);

        var evt = analytics.Events[0];
        Assert.Equal(AnalyticsEventType.CostEntryAdded, evt.EventType);
        Assert.Equal(userId, evt.ActorUserId);
        Assert.Equal(farmId, evt.FarmId);
        Assert.Null(evt.OwnerAccountId);
        Assert.Equal("owner", evt.ActorRole);
        Assert.Equal("manual", evt.Trigger);
        Assert.Equal("v1", evt.SchemaVersion);
        Assert.Contains("costEntryId", evt.PropsJson);
        Assert.Contains("category", evt.PropsJson);
        Assert.Contains("hasReceipt", evt.PropsJson);
    }

    // ---- D2 --------------------------------------------------------------

    [Fact]
    public async Task CorrectCostEntry_SuccessPath_EmitsSingleCostEntryCorrectedEvent()
    {
        var farmId = new FarmId(Guid.NewGuid());
        var correctorUserId = new UserId(Guid.NewGuid());
        var creatorUserId = new UserId(Guid.NewGuid());
        var costEntryId = Guid.NewGuid();

        var entry = CostEntry.Create(
            costEntryId,
            farmId,
            plotId: null,
            cropCycleId: null,
            category: "Fertilizer",
            description: "Urea",
            amount: 1000m,
            currencyCode: "INR",
            entryDate: new DateOnly(2026, 4, 19),
            createdByUserId: creatorUserId,
            location: null,
            createdAtUtc: FixedUtcNow);

        var repo = new InMemoryFinanceRepo();
        repo.AddCostEntry(entry);
        repo.AddMembership(farmId.Value, correctorUserId.Value, AppRole.PrimaryOwner);

        var analytics = new CapturingAnalyticsWriter();
        var handler = new CorrectCostEntryHandler(
            repo,
            new SequentialIdGenerator(),
            new FixedClock(FixedUtcNow),
            new AllowAllEntitlementPolicy(),
            analytics);

        var command = new CorrectCostEntryCommand(
            CostEntryId: costEntryId,
            CorrectedAmount: 1200m,
            CurrencyCode: "INR",
            Reason: "Vendor invoice revised",
            CorrectedByUserId: correctorUserId.Value,
            FinanceCorrectionId: null,
            ActorRole: null,
            ClientCommandId: "cmd-d2");

        var result = await handler.HandleAsync(command);

        Assert.True(result.IsSuccess);
        Assert.Single(analytics.Events);

        var evt = analytics.Events[0];
        Assert.Equal(AnalyticsEventType.CostEntryCorrected, evt.EventType);
        Assert.Equal(correctorUserId, evt.ActorUserId);
        Assert.Equal(farmId, evt.FarmId);
        Assert.Null(evt.OwnerAccountId);
        // ActorRole comes from the resolved AppRole, lowercased.
        Assert.Equal("primaryowner", evt.ActorRole);
        Assert.Equal("manual", evt.Trigger);
        Assert.Equal("v1", evt.SchemaVersion);
        Assert.Contains("correctionReason", evt.PropsJson);
        Assert.Contains("priorAmount", evt.PropsJson);
        Assert.Contains("newAmount", evt.PropsJson);
    }

    // ---- D3 --------------------------------------------------------------

    [Fact]
    public async Task AllocateGlobalExpense_SuccessPath_EmitsSingleGlobalExpenseAllocatedEvent()
    {
        var farmId = new FarmId(Guid.NewGuid());
        var userId = new UserId(Guid.NewGuid());
        var costEntryId = Guid.NewGuid();

        var entry = CostEntry.Create(
            costEntryId,
            farmId,
            plotId: null,
            cropCycleId: null,
            category: "Electricity",
            description: "Farm-wide electricity",
            amount: 600m,
            currencyCode: "INR",
            entryDate: new DateOnly(2026, 4, 19),
            createdByUserId: userId,
            location: null,
            createdAtUtc: FixedUtcNow);

        var repo = new InMemoryFinanceRepo();
        repo.AddCostEntry(entry);
        repo.AddMembership(farmId.Value, userId.Value, AppRole.PrimaryOwner);
        repo.AddPlot(Plot.Create(Guid.NewGuid(), farmId, "Plot A", 2m, FixedUtcNow));
        repo.AddPlot(Plot.Create(Guid.NewGuid(), farmId, "Plot B", 3m, FixedUtcNow));
        repo.AddPlot(Plot.Create(Guid.NewGuid(), farmId, "Plot C", 2m, FixedUtcNow));

        var analytics = new CapturingAnalyticsWriter();
        var handler = new AllocateGlobalExpenseHandler(
            repo,
            new SequentialIdGenerator(),
            new FixedClock(FixedUtcNow),
            new AllowAllEntitlementPolicy(),
            analytics);

        var command = new AllocateGlobalExpenseCommand(
            CostEntryId: costEntryId,
            AllocationBasis: "equal",
            Allocations: new List<AllocateGlobalExpenseAllocationCommand>(),
            CreatedByUserId: userId.Value,
            DayLedgerId: null,
            ActorRole: "operator",
            ClientCommandId: "cmd-d3");

        var result = await handler.HandleAsync(command);

        Assert.True(result.IsSuccess);
        Assert.Single(analytics.Events);

        var evt = analytics.Events[0];
        Assert.Equal(AnalyticsEventType.GlobalExpenseAllocated, evt.EventType);
        Assert.Equal(userId, evt.ActorUserId);
        Assert.Equal(farmId, evt.FarmId);
        Assert.Null(evt.OwnerAccountId);
        Assert.Equal("operator", evt.ActorRole);
        Assert.Equal("manual", evt.Trigger);
        Assert.Equal("v1", evt.SchemaVersion);
        Assert.Contains("\"allocationPolicy\":\"EQUAL\"", evt.PropsJson);
        Assert.Contains("plotCount", evt.PropsJson);
        Assert.Contains("totalAllocated", evt.PropsJson);
    }

    // ---- Test stubs ------------------------------------------------------

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

    private sealed class FixedClock(DateTime utcNow) : IClock
    {
        public DateTime UtcNow { get; } = utcNow;
    }

    private sealed class SequentialIdGenerator : IIdGenerator
    {
        public Guid New() => Guid.NewGuid();
    }

    private sealed class AllowAllEntitlementPolicy : IEntitlementPolicy
    {
        public Task<EntitlementDecision> EvaluateAsync(
            UserId userId,
            FarmId farmId,
            PaidFeature feature,
            CancellationToken ct = default)
            => Task.FromResult(new EntitlementDecision(true, EntitlementReason.Allowed, null));
    }

    /// <summary>
    /// Minimal in-memory repository wired just for the three finance handlers.
    /// Methods the handlers never call throw <see cref="NotImplementedException"/>
    /// so an accidental future dependency surfaces loudly instead of returning a
    /// silent default.
    /// </summary>
    private sealed class InMemoryFinanceRepo : IShramSafalRepository
    {
        private readonly Dictionary<Guid, Farm> _farms = new();
        private readonly Dictionary<Guid, Plot> _plots = new();
        private readonly Dictionary<Guid, CostEntry> _costEntries = new();
        private readonly List<FinanceCorrection> _corrections = new();
        private readonly List<DayLedger> _dayLedgers = new();
        private readonly List<AuditEvent> _auditEvents = new();
        private readonly Dictionary<(Guid farmId, Guid userId), AppRole> _memberships = new();

        public void AddFarm(Farm farm) => _farms[farm.Id.Value] = farm;
        public void AddPlot(Plot plot) => _plots[plot.Id] = plot;
        public void AddCostEntry(CostEntry entry) => _costEntries[entry.Id] = entry;
        public void AddMembership(Guid farmId, Guid userId, AppRole role)
            => _memberships[(farmId, userId)] = role;

        // --- Used by the three handlers under test ------------------------

        public Task<Farm?> GetFarmByIdAsync(Guid farmId, CancellationToken ct = default)
            => Task.FromResult(_farms.TryGetValue(farmId, out var farm) ? farm : null);

        public Task<bool> IsUserMemberOfFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default)
            => Task.FromResult(_memberships.ContainsKey((farmId, userId)));

        public Task<AppRole?> GetUserRoleForFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default)
            => Task.FromResult<AppRole?>(_memberships.TryGetValue((farmId, userId), out var role) ? role : null);

        public Task<Plot?> GetPlotByIdAsync(Guid plotId, CancellationToken ct = default)
            => Task.FromResult(_plots.TryGetValue(plotId, out var plot) ? plot : null);

        public Task<List<Plot>> GetPlotsByFarmIdAsync(Guid farmId, CancellationToken ct = default)
            => Task.FromResult(_plots.Values.Where(p => p.FarmId.Value == farmId).ToList());

        public Task<CropCycle?> GetCropCycleByIdAsync(Guid cropCycleId, CancellationToken ct = default)
            => Task.FromResult<CropCycle?>(null);

        public Task AddCostEntryAsync(CostEntry costEntry, CancellationToken ct = default)
        {
            _costEntries[costEntry.Id] = costEntry;
            return Task.CompletedTask;
        }

        public Task<CostEntry?> GetCostEntryByIdAsync(Guid costEntryId, CancellationToken ct = default)
            => Task.FromResult(_costEntries.TryGetValue(costEntryId, out var entry) ? entry : null);

        public Task<List<CostEntry>> GetCostEntriesForDuplicateCheck(FarmId farmId, Guid? plotId, string category, DateTime since, CancellationToken ct = default)
            => Task.FromResult(new List<CostEntry>());

        public Task AddFinanceCorrectionAsync(FinanceCorrection correction, CancellationToken ct = default)
        {
            _corrections.Add(correction);
            return Task.CompletedTask;
        }

        public Task AddDayLedgerAsync(DayLedger dayLedger, CancellationToken ct = default)
        {
            _dayLedgers.Add(dayLedger);
            return Task.CompletedTask;
        }

        public Task<DayLedger?> GetDayLedgerBySourceCostEntryIdAsync(Guid costEntryId, CancellationToken ct = default)
        {
            DayLedger? match = _dayLedgers.FirstOrDefault(l => l.SourceCostEntryId == costEntryId);
            return Task.FromResult(match);
        }

        public Task AddAuditEventAsync(AuditEvent auditEvent, CancellationToken ct = default)
        {
            _auditEvents.Add(auditEvent);
            return Task.CompletedTask;
        }

        public Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;

        // --- Everything else is intentionally unsupported -----------------

        public Task AddFarmAsync(Farm farm, CancellationToken ct = default) => throw new NotImplementedException();
        public Task AddFarmMembershipAsync(FarmMembership membership, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<FarmMembership?> GetFarmMembershipAsync(Guid farmId, Guid userId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<bool> IsUserOwnerOfFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task AddPlotAsync(Plot plot, CancellationToken ct = default) => throw new NotImplementedException();
        public Task AddCropCycleAsync(CropCycle cropCycle, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<CropCycle>> GetCropCyclesByPlotIdAsync(Guid plotId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task AddDailyLogAsync(DailyLog log, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<DailyLog?> GetDailyLogByIdAsync(Guid dailyLogId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<DailyLog?> GetDailyLogByIdempotencyKeyAsync(string idempotencyKey, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<CostEntry>> GetCostEntriesByIdsAsync(IEnumerable<Guid> costEntryIds, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<DayLedger?> GetDayLedgerByIdAsync(Guid dayLedgerId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<DayLedger>> GetDayLedgersForFarm(Guid farmId, DateOnly from, DateOnly to, CancellationToken ct = default) => throw new NotImplementedException();
        public Task AddAttachmentAsync(Attachment attachment, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<Attachment?> GetAttachmentByIdAsync(Guid attachmentId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<Attachment>> GetAttachmentsForEntityAsync(Guid entityId, string entityType, CancellationToken ct = default) => throw new NotImplementedException();
        public Task AddPriceConfigAsync(PriceConfig config, CancellationToken ct = default) => throw new NotImplementedException();
        public Task AddScheduleTemplateAsync(ScheduleTemplate template, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<ScheduleTemplate>> GetScheduleTemplatesAsync(CancellationToken ct = default) => throw new NotImplementedException();
        public Task AddPlannedActivitiesAsync(IEnumerable<PlannedActivity> plannedActivities, CancellationToken ct = default) => throw new NotImplementedException();
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
        public Task<CropScheduleTemplate?> GetCropScheduleTemplateByIdAsync(ScheduleTemplateId templateId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<List<CropScheduleTemplate>> GetCropScheduleTemplatesForCropAsync(string cropKey, string? regionCode, CancellationToken ct = default) => throw new NotImplementedException();
        public Task AddScheduleSubscriptionAsync(ScheduleSubscription subscription, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<ScheduleSubscription?> GetScheduleSubscriptionByIdAsync(ScheduleSubscriptionId subscriptionId, CancellationToken ct = default) => throw new NotImplementedException();
        public Task<ScheduleSubscription?> GetActiveScheduleSubscriptionAsync(Guid plotId, string cropKey, Guid cropCycleId, CancellationToken ct = default) => Task.FromResult<ScheduleSubscription?>(null);
        public Task AddScheduleMigrationEventAsync(ScheduleMigrationEvent migrationEvent, CancellationToken ct = default) => throw new NotImplementedException();
    }
}
