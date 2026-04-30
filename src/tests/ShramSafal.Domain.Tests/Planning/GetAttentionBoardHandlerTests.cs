using System.Diagnostics;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Planning.GetAttentionBoard;
using ShramSafal.Domain.Attachments;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Crops;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.Schedules;
using ShramSafal.Domain.Tests;
using Xunit;

namespace ShramSafal.Domain.Tests.Planning;

public sealed class GetAttentionBoardHandlerTests
{
    private static readonly DateTime Now = new(2026, 4, 21, 10, 0, 0, DateTimeKind.Utc);
    private static readonly Guid UserId = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private static readonly Guid FarmId = Guid.Parse("ffffffff-ffff-ffff-ffff-ffffffffffff");
    private static readonly Guid PlotId1 = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid PlotId2 = Guid.Parse("22222222-2222-2222-2222-222222222222");

    private static GetAttentionBoardHandler CreateHandler(FakeAttentionRepo repo) =>
        new(repo, new FakeTestInstanceRepo(), new NullComplianceSignalRepository(), new FakeClock(Now),
            Microsoft.Extensions.Logging.Abstractions.NullLogger<GetAttentionBoardHandler>.Instance);

    private static GetAttentionBoardHandler CreateHandler(FakeAttentionRepo repo, FakeTestInstanceRepo testRepo) =>
        new(repo, testRepo, new NullComplianceSignalRepository(), new FakeClock(Now),
            Microsoft.Extensions.Logging.Abstractions.NullLogger<GetAttentionBoardHandler>.Instance);

    // ---------------------------------------------------------------------------
    // 1. A plot with 1 disputed log produces a Critical card
    // ---------------------------------------------------------------------------
    [Fact]
    public async Task GetAttentionBoard_ReturnsCriticalCardForDisputedLog()
    {
        var farmTypedId = new FarmId(FarmId);
        var ownerTypedId = new UserId(UserId);

        var farm = Farm.Create(farmTypedId, "Ramu Farm", ownerTypedId, Now.AddDays(-100));
        var plot = Plot.Create(PlotId1, farmTypedId, "Plot A", 2.5m, Now.AddDays(-100));
        var cycle = CropCycle.Create(
            Guid.NewGuid(), farmTypedId, PlotId1, "Grapes", "Fruiting",
            DateOnly.FromDateTime(Now.AddDays(-30)), null, Now.AddDays(-30));

        var repo = new FakeAttentionRepo();
        repo.AddFarmForUser(UserId, farm);
        repo.AddPlot(plot);
        repo.AddCropCycle(PlotId1, cycle);
        repo.SetDisputedLogCount(PlotId1, 1);

        var handler = CreateHandler(repo);
        var result = await handler.HandleAsync(new GetAttentionBoardQuery(UserId), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Single(result.Value.Cards);
        var card = result.Value.Cards[0];
        Assert.Equal(AttentionRank.Critical, card.Rank);
        Assert.Equal(SuggestedActionKind.ResolveDispute, card.SuggestedAction);
        Assert.Equal(1, card.UnresolvedDisputeCount);
    }

    // ---------------------------------------------------------------------------
    // 2. Sort order: Critical before NeedsAttention
    // ---------------------------------------------------------------------------
    [Fact]
    public async Task GetAttentionBoard_SortOrder_CriticalFirst()
    {
        var farmTypedId = new FarmId(FarmId);
        var ownerTypedId = new UserId(UserId);

        var farm = Farm.Create(farmTypedId, "Ramu Farm", ownerTypedId, Now.AddDays(-100));

        // Plot 1: 3 overdue out of 10 planned (7 executed → 70% → Good health) → NeedsAttention via overdue rule
        var plot1 = Plot.Create(PlotId1, farmTypedId, "Plot A", 2.5m, Now.AddDays(-100));
        var cycle1 = CropCycle.Create(
            Guid.NewGuid(), farmTypedId, PlotId1, "Grapes", "Fruiting",
            DateOnly.FromDateTime(Now.AddDays(-60)), null, Now.AddDays(-60));
        // 7 planned activities that ARE executed (matched)
        var executedNames = new[] { "task-e1", "task-e2", "task-e3", "task-e4", "task-e5", "task-e6", "task-e7" };
        var activities1 = executedNames.Select(n =>
            PlannedActivity.CreateLocallyAdded(Guid.NewGuid(), cycle1.Id, n, "Fruiting",
                DateOnly.FromDateTime(Now.AddDays(-20)), new UserId(UserId), "test", Now.AddDays(-20)))
            .ToList();
        // 3 overdue planned activities with no matching executed tasks
        activities1.Add(PlannedActivity.CreateLocallyAdded(Guid.NewGuid(), cycle1.Id, "overdue-a", "Fruiting",
            DateOnly.FromDateTime(Now.AddDays(-5)), new UserId(UserId), "test", Now.AddDays(-5)));
        activities1.Add(PlannedActivity.CreateLocallyAdded(Guid.NewGuid(), cycle1.Id, "overdue-b", "Fruiting",
            DateOnly.FromDateTime(Now.AddDays(-4)), new UserId(UserId), "test", Now.AddDays(-4)));
        activities1.Add(PlannedActivity.CreateLocallyAdded(Guid.NewGuid(), cycle1.Id, "overdue-c", "Fruiting",
            DateOnly.FromDateTime(Now.AddDays(-3)), new UserId(UserId), "test", Now.AddDays(-3)));
        // The 7 executed tasks (matching the executed names above), created via DailyLog.AddTask
        var dailyLog1 = DailyLog.Create(Guid.NewGuid(), farmTypedId, PlotId1, cycle1.Id,
            new UserId(UserId), DateOnly.FromDateTime(Now.AddDays(-15)), null, null, Now.AddDays(-15));
        var executed1 = executedNames.Select(n =>
            dailyLog1.AddTask(Guid.NewGuid(), n, null, Now.AddDays(-15)))
            .ToList();

        // Plot 2: 1 disputed log → Critical
        var plot2 = Plot.Create(PlotId2, farmTypedId, "Plot B", 1.5m, Now.AddDays(-100));
        var cycle2 = CropCycle.Create(
            Guid.NewGuid(), farmTypedId, PlotId2, "Onion", "Vegetative",
            DateOnly.FromDateTime(Now.AddDays(-40)), null, Now.AddDays(-40));

        var repo = new FakeAttentionRepo();
        repo.AddFarmForUser(UserId, farm);
        repo.AddPlot(plot1);
        repo.AddPlot(plot2);
        repo.AddCropCycle(PlotId1, cycle1);
        repo.AddCropCycle(PlotId2, cycle2);
        repo.AddPlannedActivities(cycle1.Id, activities1);
        repo.AddExecutedTasks(cycle1.Id, executed1);
        repo.SetDisputedLogCount(PlotId2, 1);

        var handler = CreateHandler(repo);
        var result = await handler.HandleAsync(new GetAttentionBoardQuery(UserId), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Equal(2, result.Value.Cards.Count);
        // Critical (dispute) must come before NeedsAttention (overdue)
        Assert.Equal(AttentionRank.Critical, result.Value.Cards[0].Rank);
        Assert.Equal(AttentionRank.NeedsAttention, result.Value.Cards[1].Rank);
    }

    // ---------------------------------------------------------------------------
    // 3. All returned cards have non-null SuggestedAction (CEI-I6)
    // ---------------------------------------------------------------------------
    [Fact]
    public async Task GetAttentionBoard_AllSuggestedActionsNonNull()
    {
        // SuggestedAction is a non-nullable enum struct — this test documents CEI-I6
        var farmTypedId = new FarmId(FarmId);
        var ownerTypedId = new UserId(UserId);

        var farm = Farm.Create(farmTypedId, "Ramu Farm", ownerTypedId, Now.AddDays(-100));
        var plot = Plot.Create(PlotId1, farmTypedId, "Plot A", 2.5m, Now.AddDays(-100));
        var cycle = CropCycle.Create(
            Guid.NewGuid(), farmTypedId, PlotId1, "Grapes", "Fruiting",
            DateOnly.FromDateTime(Now.AddDays(-30)), null, Now.AddDays(-30));

        var repo = new FakeAttentionRepo();
        repo.AddFarmForUser(UserId, farm);
        repo.AddPlot(plot);
        repo.AddCropCycle(PlotId1, cycle);
        repo.SetDisputedLogCount(PlotId1, 1);

        var handler = CreateHandler(repo);
        var result = await handler.HandleAsync(new GetAttentionBoardQuery(UserId), CancellationToken.None);

        Assert.True(result.IsSuccess);
        foreach (var card in result.Value.Cards)
        {
            // Non-nullable struct: compiler-guaranteed non-null, but we assert the enum is valid
            Assert.True(Enum.IsDefined(typeof(SuggestedActionKind), card.SuggestedAction),
                $"SuggestedAction value {card.SuggestedAction} is not a valid SuggestedActionKind");
        }
    }

    // ---------------------------------------------------------------------------
    // 4. Empty list (not 404) for user with no farms
    // ---------------------------------------------------------------------------
    [Fact]
    public async Task GetAttentionBoard_EmptyForUserWithNoFarms_ReturnsEmptyList_Not404()
    {
        var repo = new FakeAttentionRepo();
        // No farms registered for this user

        var handler = CreateHandler(repo);
        var result = await handler.HandleAsync(new GetAttentionBoardQuery(UserId), CancellationToken.None);

        Assert.True(result.IsSuccess, "Should succeed, not fail with 404 or error");
        Assert.Empty(result.Value.Cards);
    }

    // ---------------------------------------------------------------------------
    // 5. Performance gate: handler completes in <500ms on a 6-plot fake
    // ---------------------------------------------------------------------------
    [Fact]
    public async Task GetAttentionBoard_PerformanceGate_Under500Ms_For6Plots()
    {
        var farmTypedId = new FarmId(FarmId);
        var ownerTypedId = new UserId(UserId);
        var farm = Farm.Create(farmTypedId, "Ramu Farm", ownerTypedId, Now.AddDays(-200));

        var repo = new FakeAttentionRepo();
        repo.AddFarmForUser(UserId, farm);

        for (var i = 0; i < 6; i++)
        {
            var plotId = Guid.NewGuid();
            var plot = Plot.Create(plotId, farmTypedId, $"Plot {i}", 1.0m + i, Now.AddDays(-200));
            repo.AddPlot(plot);
            var cycle = CropCycle.Create(
                Guid.NewGuid(), farmTypedId, plotId, "Grapes", "Fruiting",
                DateOnly.FromDateTime(Now.AddDays(-60)), null, Now.AddDays(-60));
            repo.AddCropCycle(plotId, cycle);
            // 2 overdue activities
            repo.AddPlannedActivities(cycle.Id, new List<PlannedActivity>
            {
                PlannedActivity.CreateLocallyAdded(Guid.NewGuid(), cycle.Id, $"Task A{i}", "Fruiting",
                    DateOnly.FromDateTime(Now.AddDays(-5)), new UserId(UserId), "reason", Now.AddDays(-5)),
                PlannedActivity.CreateLocallyAdded(Guid.NewGuid(), cycle.Id, $"Task B{i}", "Fruiting",
                    DateOnly.FromDateTime(Now.AddDays(-3)), new UserId(UserId), "reason", Now.AddDays(-3)),
            });
        }

        var handler = CreateHandler(repo);
        var sw = Stopwatch.StartNew();
        var result = await handler.HandleAsync(new GetAttentionBoardQuery(UserId), CancellationToken.None);
        sw.Stop();

        Assert.True(result.IsSuccess);
        Assert.True(sw.ElapsedMilliseconds < 500,
            $"Handler took {sw.ElapsedMilliseconds}ms — expected <500ms for 6-plot fake");
    }

    // ---------------------------------------------------------------------------
    // 6. CEI Phase 2 §4.5 — missing tests surface as AssignTest cards
    // ---------------------------------------------------------------------------
    [Fact]
    public async Task AttentionBoard_WithMissingTests_ProducesAssignTestCard()
    {
        var farmTypedId = new FarmId(FarmId);
        var ownerTypedId = new UserId(UserId);

        var farm = Farm.Create(farmTypedId, "Ramu Farm", ownerTypedId, Now.AddDays(-100));
        var plot = Plot.Create(PlotId1, farmTypedId, "Plot A", 2.5m, Now.AddDays(-100));
        var cycle = CropCycle.Create(
            Guid.NewGuid(), farmTypedId, PlotId1, "Grapes", "Fruiting",
            DateOnly.FromDateTime(Now.AddDays(-30)), null, Now.AddDays(-30));

        var repo = new FakeAttentionRepo();
        repo.AddFarmForUser(UserId, farm);
        repo.AddPlot(plot);
        repo.AddCropCycle(PlotId1, cycle);
        // Note: no disputes, no overdue planned activities — plot would otherwise be Healthy.

        // Seed one Due test instance whose planned due date has already arrived.
        var today = DateOnly.FromDateTime(Now);
        var instance = TestInstance.Schedule(
            id: Guid.NewGuid(),
            testProtocolId: Guid.NewGuid(),
            protocolKind: TestProtocolKind.Soil,
            cropCycleId: cycle.Id,
            farmId: farmTypedId,
            plotId: PlotId1,
            stageName: "Fruiting",
            plannedDueDate: today.AddDays(-2),
            createdAtUtc: Now.AddDays(-10));

        var testRepo = new FakeTestInstanceRepo();
        testRepo.Seed(instance);

        var handler = CreateHandler(repo, testRepo);
        var result = await handler.HandleAsync(new GetAttentionBoardQuery(UserId), CancellationToken.None);

        Assert.True(result.IsSuccess);
        Assert.Single(result.Value.Cards);
        var card = result.Value.Cards[0];
        Assert.Equal(AttentionRank.Watch, card.Rank);
        Assert.Equal(SuggestedActionKind.AssignTest, card.SuggestedAction);
        Assert.Equal(1, card.MissingTestCount);
    }

    // ---------------------------------------------------------------------------
    // Private fake infrastructure
    // ---------------------------------------------------------------------------

    private sealed class FakeAttentionRepo : IShramSafalRepository
    {
        private readonly Dictionary<Guid, List<Guid>> _userFarms = new();
        private readonly Dictionary<Guid, Farm> _farms = new();
        private readonly Dictionary<Guid, List<Plot>> _farmPlots = new();
        private readonly Dictionary<Guid, List<CropCycle>> _plotCycles = new();
        private readonly Dictionary<Guid, List<PlannedActivity>> _cyclePlanned = new();
        private readonly Dictionary<Guid, List<LogTask>> _cycleExecuted = new();
        private readonly Dictionary<Guid, int> _disputedCounts = new();

        public void AddFarmForUser(Guid userId, Farm farm)
        {
            if (!_userFarms.TryGetValue(userId, out var list))
            {
                list = new List<Guid>();
                _userFarms[userId] = list;
            }
            list.Add(farm.Id.Value);
            _farms[farm.Id.Value] = farm;
        }

        public void AddPlot(Plot plot)
        {
            var farmId = plot.FarmId.Value;
            if (!_farmPlots.TryGetValue(farmId, out var list))
            {
                list = new List<Plot>();
                _farmPlots[farmId] = list;
            }
            list.Add(plot);
        }

        public void AddCropCycle(Guid plotId, CropCycle cycle)
        {
            if (!_plotCycles.TryGetValue(plotId, out var list))
            {
                list = new List<CropCycle>();
                _plotCycles[plotId] = list;
            }
            list.Add(cycle);
        }

        public void AddPlannedActivities(Guid cycleId, List<PlannedActivity> activities)
        {
            if (!_cyclePlanned.TryGetValue(cycleId, out var list))
            {
                list = new List<PlannedActivity>();
                _cyclePlanned[cycleId] = list;
            }
            list.AddRange(activities);
        }

        public void SetDisputedLogCount(Guid plotId, int count)
        {
            _disputedCounts[plotId] = count;
        }

        public void AddExecutedTasks(Guid cycleId, IEnumerable<LogTask> tasks)
        {
            if (!_cycleExecuted.TryGetValue(cycleId, out var list))
            {
                list = new List<LogTask>();
                _cycleExecuted[cycleId] = list;
            }
            list.AddRange(tasks);
        }

        public Task<List<Guid>> GetFarmIdsForUserAsync(Guid userId, CancellationToken ct = default)
        {
            var ids = _userFarms.TryGetValue(userId, out var list) ? list : new List<Guid>();
            return Task.FromResult(ids);
        }

        public Task<Farm?> GetFarmByIdAsync(Guid farmId, CancellationToken ct = default)
        {
            _farms.TryGetValue(farmId, out var farm);
            return Task.FromResult(farm);
        }

        public Task<List<Plot>> GetPlotsByFarmIdAsync(Guid farmId, CancellationToken ct = default)
        {
            var plots = _farmPlots.TryGetValue(farmId, out var list) ? list : new List<Plot>();
            return Task.FromResult(plots);
        }

        public Task<List<CropCycle>> GetCropCyclesByPlotIdAsync(Guid plotId, CancellationToken ct = default)
        {
            var cycles = _plotCycles.TryGetValue(plotId, out var list) ? list : new List<CropCycle>();
            return Task.FromResult(cycles);
        }

        public Task<List<PlannedActivity>> GetPlannedActivitiesByCropCycleIdAsync(Guid cropCycleId, CancellationToken ct = default)
        {
            var activities = _cyclePlanned.TryGetValue(cropCycleId, out var list) ? list : new List<PlannedActivity>();
            return Task.FromResult(activities);
        }

        public Task<List<LogTask>> GetExecutedTasksByCropCycleIdAsync(Guid cropCycleId, CancellationToken ct = default)
        {
            var tasks = _cycleExecuted.TryGetValue(cropCycleId, out var list) ? list : new List<LogTask>();
            return Task.FromResult(tasks);
        }

        public Task<int> GetDisputedLogCountForPlotAsync(Guid plotId, CancellationToken ct = default)
        {
            var count = _disputedCounts.TryGetValue(plotId, out var c) ? c : 0;
            return Task.FromResult(count);
        }

        public Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;

        // --- stubs for unused interface members ---
        public Task AddFarmAsync(Farm farm, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddFarmMembershipAsync(FarmMembership membership, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<FarmMembership?> GetFarmMembershipAsync(Guid farmId, Guid userId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<AppRole?> GetUserRoleForFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<int> CountActivePrimaryOwnersAsync(Guid farmId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<bool> IsUserOwnerOfFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<bool> IsUserMemberOfFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddPlotAsync(Plot plot, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<Plot?> GetPlotByIdAsync(Guid plotId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddCropCycleAsync(CropCycle cropCycle, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<CropCycle?> GetCropCycleByIdAsync(Guid cropCycleId, CancellationToken ct = default) => throw new NotSupportedException();
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
        public Task AddAuditEventAsync(AuditEvent auditEvent, CancellationToken ct = default) => throw new NotSupportedException();
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
    
    // Sub-plan 03 Task 5 (T-IGH-03-PORT-COMPLETE-MIGRATION):
    // required interface members; no-op in this test stub.
    public Task AddFarmBoundaryAsync(ShramSafal.Domain.Farms.FarmBoundary boundary, CancellationToken ct = default) => Task.CompletedTask;
    public Task AddJobCardAsync(ShramSafal.Domain.Work.JobCard jobCard, CancellationToken ct = default) => Task.CompletedTask;
}

    private sealed class FakeClock : IClock
    {
        private readonly DateTime _now;
        public FakeClock(DateTime now) => _now = now;
        public DateTime UtcNow => _now;
    }

    private sealed class FakeTestInstanceRepo : ITestInstanceRepository
    {
        private readonly Dictionary<Guid, TestInstance> _byId = new();

        public void Seed(TestInstance instance) => _byId[instance.Id] = instance;

        public Task AddAsync(TestInstance instance, CancellationToken ct = default)
        {
            _byId[instance.Id] = instance;
            return Task.CompletedTask;
        }

        public Task AddRangeAsync(IEnumerable<TestInstance> instances, CancellationToken ct = default)
        {
            foreach (var i in instances) _byId[i.Id] = i;
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

        public Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }

    private sealed class NullComplianceSignalRepository : ShramSafal.Application.Ports.IComplianceSignalRepository
    {
        public Task<ShramSafal.Domain.Compliance.ComplianceSignal?> FindOpenAsync(AgriSync.SharedKernel.Contracts.Ids.FarmId farmId, Guid plotId, string ruleCode, Guid? cropCycleId, CancellationToken ct = default)
            => Task.FromResult<ShramSafal.Domain.Compliance.ComplianceSignal?>(null);
        public Task<IReadOnlyList<ShramSafal.Domain.Compliance.ComplianceSignal>> GetOpenForFarmAsync(AgriSync.SharedKernel.Contracts.Ids.FarmId farmId, CancellationToken ct = default)
            => Task.FromResult<IReadOnlyList<ShramSafal.Domain.Compliance.ComplianceSignal>>(Array.Empty<ShramSafal.Domain.Compliance.ComplianceSignal>());
        public Task<IReadOnlyList<ShramSafal.Domain.Compliance.ComplianceSignal>> GetForFarmAsync(AgriSync.SharedKernel.Contracts.Ids.FarmId farmId, bool includeResolved, bool includeAcknowledged, CancellationToken ct = default)
            => Task.FromResult<IReadOnlyList<ShramSafal.Domain.Compliance.ComplianceSignal>>(Array.Empty<ShramSafal.Domain.Compliance.ComplianceSignal>());
        public Task<ShramSafal.Domain.Compliance.ComplianceSignal?> GetByIdAsync(Guid id, CancellationToken ct = default)
            => Task.FromResult<ShramSafal.Domain.Compliance.ComplianceSignal?>(null);
        public Task<IReadOnlyList<ShramSafal.Domain.Compliance.ComplianceSignal>> GetSinceCursorAsync(AgriSync.SharedKernel.Contracts.Ids.FarmId farmId, DateTime cursor, CancellationToken ct = default)
            => Task.FromResult<IReadOnlyList<ShramSafal.Domain.Compliance.ComplianceSignal>>(Array.Empty<ShramSafal.Domain.Compliance.ComplianceSignal>());
        public void Add(ShramSafal.Domain.Compliance.ComplianceSignal signal) { }
        public Task<DateTime?> GetLatestEvaluationTimeAsync(AgriSync.SharedKernel.Contracts.Ids.FarmId farmId, CancellationToken ct = default)
            => Task.FromResult<DateTime?>(null);
        public Task SaveChangesAsync(CancellationToken ct = default) => Task.CompletedTask;
    }
}
