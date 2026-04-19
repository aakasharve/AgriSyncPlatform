using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Schedules.MigrateSchedule;
using ShramSafal.Domain.Attachments;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Crops;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Finance;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.Schedules;
using Xunit;

namespace ShramSafal.Domain.Tests.Schedules;

/// <summary>
/// Phase 3 MIS — MigrateScheduleHandler covers invariants I-14 and I-15:
///   - Happy path: prev → Migrated, new → Active, migration event recorded,
///     all domain writes before the single SaveChanges boundary.
///   - No active subscription → failure (nothing to migrate).
///   - Sequential migrations preserve I-14: each call migrates the currently
///     Active subscription and the system always has exactly one Active row
///     for (plot, cropKey, cycle) afterwards.
///   - Lost race: if prev was already Migrated by another actor before this
///     handler's Active lookup ran, we fail cleanly with no SaveChanges and
///     no analytics emitted. DB-level enforcement for truly simultaneous
///     writes is the partial unique index on (plot_id, crop_id, crop_cycle_id)
///     WHERE state = 'Active', validated by Infrastructure integration tests.
/// </summary>
public sealed class MigrateScheduleHandlerTests
{
    private static readonly FarmId FarmIdVal = new(Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"));
    private static readonly Guid PlotIdVal = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    private static readonly Guid CycleIdVal = Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc");
    private static readonly Guid ActorIdVal = Guid.Parse("dddddddd-dddd-dddd-dddd-dddddddddddd");
    private static readonly DateTime Now = new(2026, 4, 19, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public async Task HandleAsync_HappyPath_MigratesAtomically()
    {
        var repo = BuildRepoWithBasics();
        var prevTemplate = BuildPublishedTemplate("grapes", "v1");
        var newTemplate = BuildPublishedTemplate("grapes", "v2");
        repo.Templates[prevTemplate.TemplateId] = prevTemplate;
        repo.Templates[newTemplate.TemplateId] = newTemplate;

        var prev = ScheduleSubscription.Adopt(
            Guid.Parse("eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"),
            FarmIdVal, PlotIdVal, CycleIdVal, "grapes",
            prevTemplate.TemplateId, prevTemplate.VersionTag, Now.AddDays(-10));
        repo.Subscriptions.Add(prev);

        var analytics = new CapturingAnalyticsWriter();
        var handler = CreateHandler(repo, analytics,
            newSubIdSeed: Guid.Parse("ffffffff-ffff-ffff-ffff-ffffffffffff"),
            migrationIdSeed: Guid.Parse("11111111-2222-3333-4444-555555555555"));

        var result = await handler.HandleAsync(new MigrateScheduleCommand(
            FarmId: FarmIdVal.Value,
            PlotId: PlotIdVal,
            CropCycleId: CycleIdVal,
            NewScheduleTemplateId: newTemplate.Id,
            Reason: ScheduleMigrationReason.BetterFit,
            ActorUserId: ActorIdVal,
            ReasonText: "Moving to v2 after weather shift"));

        Assert.True(result.IsSuccess);
        Assert.Equal("Active", result.Value.State);
        Assert.Equal(newTemplate.Id, result.Value.ScheduleTemplateId);
        Assert.Equal(prev.Id, result.Value.MigratedFromSubscriptionId);

        // Prev transitioned to Migrated in-memory.
        Assert.Equal(ScheduleSubscriptionState.Migrated, prev.State);
        Assert.Equal(ScheduleMigrationReason.BetterFit, prev.MigrationReason);
        Assert.NotNull(prev.MigratedToSubscriptionId);
        Assert.Equal(result.Value.Id, prev.MigratedToSubscriptionId!.Value.Value);

        // Two subscriptions now exist (prev Migrated + new Active).
        Assert.Equal(2, repo.Subscriptions.Count);
        Assert.Single(repo.MigrationEvents);
        Assert.Equal(prev.Id, repo.MigrationEvents[0].PrevSubscriptionId.Value);
        Assert.Equal(result.Value.Id, repo.MigrationEvents[0].NewSubscriptionId.Value);

        // Audit + single SaveChanges commit.
        Assert.Single(repo.AuditEvents);
        Assert.Equal("Migrated", repo.AuditEvents[0].Action);
        Assert.Equal(1, repo.SaveCalls);

        // Analytics emitted after the tx.
        Assert.Single(analytics.Events);
        Assert.Equal(AnalyticsEventType.ScheduleMigrated, analytics.Events[0].EventType);
    }

    [Fact]
    public async Task HandleAsync_NoActiveSubscription_ReturnsSubscriptionNotFound()
    {
        var repo = BuildRepoWithBasics();
        var newTemplate = BuildPublishedTemplate("grapes", "v2");
        repo.Templates[newTemplate.TemplateId] = newTemplate;

        var handler = CreateHandler(repo, new CapturingAnalyticsWriter());

        var result = await handler.HandleAsync(new MigrateScheduleCommand(
            FarmId: FarmIdVal.Value,
            PlotId: PlotIdVal,
            CropCycleId: CycleIdVal,
            NewScheduleTemplateId: newTemplate.Id,
            Reason: ScheduleMigrationReason.BetterFit,
            ActorUserId: ActorIdVal));

        Assert.True(result.IsFailure);
        Assert.Equal(ShramSafalErrors.ScheduleSubscriptionNotFound, result.Error);
        Assert.Empty(repo.MigrationEvents);
        Assert.Equal(0, repo.SaveCalls);
    }

    [Fact]
    public async Task HandleAsync_NewTemplateUnpublished_ReturnsTemplateUnpublished()
    {
        var repo = BuildRepoWithBasics();
        var prevTemplate = BuildPublishedTemplate("grapes", "v1");
        var newTemplate = BuildTemplate("grapes", "v2", publish: false);
        repo.Templates[prevTemplate.TemplateId] = prevTemplate;
        repo.Templates[newTemplate.TemplateId] = newTemplate;

        var prev = ScheduleSubscription.Adopt(
            Guid.NewGuid(), FarmIdVal, PlotIdVal, CycleIdVal, "grapes",
            prevTemplate.TemplateId, prevTemplate.VersionTag, Now.AddDays(-5));
        repo.Subscriptions.Add(prev);

        var handler = CreateHandler(repo, new CapturingAnalyticsWriter());

        var result = await handler.HandleAsync(new MigrateScheduleCommand(
            FarmId: FarmIdVal.Value,
            PlotId: PlotIdVal,
            CropCycleId: CycleIdVal,
            NewScheduleTemplateId: newTemplate.Id,
            Reason: ScheduleMigrationReason.BetterFit,
            ActorUserId: ActorIdVal));

        Assert.True(result.IsFailure);
        Assert.Equal(ShramSafalErrors.ScheduleTemplateUnpublished, result.Error);
        Assert.Equal(ScheduleSubscriptionState.Active, prev.State); // Unchanged.
        Assert.Empty(repo.MigrationEvents);
        Assert.Equal(0, repo.SaveCalls);
    }

    [Fact]
    public async Task HandleAsync_NewTemplateCropMismatch_ReturnsCropMismatch()
    {
        var repo = BuildRepoWithBasics();
        var prevTemplate = BuildPublishedTemplate("grapes", "v1");
        var newTemplate = BuildPublishedTemplate("onion", "v1");
        repo.Templates[prevTemplate.TemplateId] = prevTemplate;
        repo.Templates[newTemplate.TemplateId] = newTemplate;

        var prev = ScheduleSubscription.Adopt(
            Guid.NewGuid(), FarmIdVal, PlotIdVal, CycleIdVal, "grapes",
            prevTemplate.TemplateId, prevTemplate.VersionTag, Now.AddDays(-5));
        repo.Subscriptions.Add(prev);

        var handler = CreateHandler(repo, new CapturingAnalyticsWriter());

        var result = await handler.HandleAsync(new MigrateScheduleCommand(
            FarmId: FarmIdVal.Value,
            PlotId: PlotIdVal,
            CropCycleId: CycleIdVal,
            NewScheduleTemplateId: newTemplate.Id,
            Reason: ScheduleMigrationReason.SwitchedCropVariety,
            ActorUserId: ActorIdVal));

        Assert.True(result.IsFailure);
        Assert.Equal(ShramSafalErrors.ScheduleTemplateCropMismatch, result.Error);
        Assert.Equal(ScheduleSubscriptionState.Active, prev.State);
        Assert.Equal(0, repo.SaveCalls);
    }

    [Fact]
    public async Task HandleAsync_SequentialMigrations_PreserveI14()
    {
        // Two consecutive migrations on the same (plot, cropKey, cycle).
        // After each migration the system must still have exactly one Active
        // subscription (I-14). The second migration targets yet another
        // published template and must migrate the *newly active* subscription
        // produced by the first call, not the original prev (which is now
        // Migrated). This proves the handler re-fetches Active fresh each
        // call and never stamps two Active rows for the same key.
        //
        // True simultaneous writes (both handlers loading prev before either
        // commits) are defended by the DB partial unique index on
        // (plot_id, crop_id, crop_cycle_id) WHERE state = 'Active' — that
        // layer is validated by the Infrastructure integration tests, not
        // here.
        var repo = BuildRepoWithBasics();
        var prevTemplate = BuildPublishedTemplate("grapes", "v1");
        var midTemplate = BuildPublishedTemplate("grapes", "v2");
        var newTemplate = BuildPublishedTemplate("grapes", "v3");
        repo.Templates[prevTemplate.TemplateId] = prevTemplate;
        repo.Templates[midTemplate.TemplateId] = midTemplate;
        repo.Templates[newTemplate.TemplateId] = newTemplate;

        var prev = ScheduleSubscription.Adopt(
            Guid.NewGuid(), FarmIdVal, PlotIdVal, CycleIdVal, "grapes",
            prevTemplate.TemplateId, prevTemplate.VersionTag, Now.AddDays(-10));
        repo.Subscriptions.Add(prev);

        var handler = CreateHandler(repo, new CapturingAnalyticsWriter());

        var first = await handler.HandleAsync(new MigrateScheduleCommand(
            FarmId: FarmIdVal.Value,
            PlotId: PlotIdVal,
            CropCycleId: CycleIdVal,
            NewScheduleTemplateId: midTemplate.Id,
            Reason: ScheduleMigrationReason.BetterFit,
            ActorUserId: ActorIdVal));

        var second = await handler.HandleAsync(new MigrateScheduleCommand(
            FarmId: FarmIdVal.Value,
            PlotId: PlotIdVal,
            CropCycleId: CycleIdVal,
            NewScheduleTemplateId: newTemplate.Id,
            Reason: ScheduleMigrationReason.SwitchedCropVariety,
            ActorUserId: ActorIdVal));

        Assert.True(first.IsSuccess);
        Assert.True(second.IsSuccess);

        // I-14: exactly one Active subscription on the key.
        var activeSubs = repo.Subscriptions
            .Where(s => s.PlotId == PlotIdVal && s.CropKey == "grapes" && s.CropCycleId == CycleIdVal)
            .Where(s => s.State == ScheduleSubscriptionState.Active)
            .ToList();
        Assert.Single(activeSubs);
        Assert.Equal(newTemplate.Id, activeSubs[0].ScheduleTemplateId.Value);

        // Three subscriptions total (v1 Migrated, v2 Migrated, v3 Active) and
        // two migration events recorded.
        Assert.Equal(3, repo.Subscriptions.Count);
        Assert.Equal(2, repo.MigrationEvents.Count);
        Assert.Equal(2, repo.Subscriptions.Count(s => s.State == ScheduleSubscriptionState.Migrated));
    }

    [Fact]
    public async Task HandleAsync_PrevAlreadyMigratedByAnotherActor_ReturnsSubscriptionNotFound()
    {
        // Simulates the "losing side" of a concurrent migration race: operator A
        // already committed prev → Migrated before operator B's handler got to
        // the Active-lookup step. B must find no Active subscription and fail
        // cleanly with ScheduleSubscriptionNotFound (no SaveChanges, no
        // analytics). I-14 never breaks because B never creates a second
        // Active row.
        var repo = BuildRepoWithBasics();
        var newTemplate = BuildPublishedTemplate("grapes", "v2");
        repo.Templates[newTemplate.TemplateId] = newTemplate;

        // prev was Adopted then already Migrated (by a prior committed tx).
        var prev = ScheduleSubscription.Adopt(
            Guid.NewGuid(), FarmIdVal, PlotIdVal, CycleIdVal, "grapes",
            new ScheduleTemplateId(Guid.NewGuid()), "v1", Now.AddDays(-10));
        prev.Migrate(new ScheduleSubscriptionId(Guid.NewGuid()), ScheduleMigrationReason.BetterFit, Now.AddMinutes(-1));
        repo.Subscriptions.Add(prev);

        var analytics = new CapturingAnalyticsWriter();
        var handler = CreateHandler(repo, analytics);

        var result = await handler.HandleAsync(new MigrateScheduleCommand(
            FarmId: FarmIdVal.Value,
            PlotId: PlotIdVal,
            CropCycleId: CycleIdVal,
            NewScheduleTemplateId: newTemplate.Id,
            Reason: ScheduleMigrationReason.BetterFit,
            ActorUserId: ActorIdVal));

        Assert.True(result.IsFailure);
        Assert.Equal(ShramSafalErrors.ScheduleSubscriptionNotFound, result.Error);
        Assert.Equal(0, repo.SaveCalls);
        Assert.Empty(analytics.Events);
    }

    // ---------- Helpers ----------

    private static FakeMigrateRepo BuildRepoWithBasics()
    {
        var repo = new FakeMigrateRepo();
        var farm = Farm.Create(FarmIdVal, "Patil Farm", new UserId(ActorIdVal), Now.AddDays(-20));
        repo.Farms[FarmIdVal.Value] = farm;
        var plot = Plot.Create(PlotIdVal, FarmIdVal, "North Block", 2.5m, Now.AddDays(-20));
        repo.Plots[plot.Id] = plot;
        var cycle = CropCycle.Create(
            CycleIdVal, FarmIdVal, plot.Id, cropName: "Grapes", stage: "flowering",
            startDate: new DateOnly(2026, 3, 1), endDate: null, createdAtUtc: Now.AddDays(-15));
        repo.CropCycles[cycle.Id] = cycle;
        repo.FarmMembers.Add((FarmIdVal.Value, ActorIdVal));
        return repo;
    }

    private static CropScheduleTemplate BuildPublishedTemplate(string cropKey, string versionTag) =>
        BuildTemplate(cropKey, versionTag, publish: true);

    private static CropScheduleTemplate BuildTemplate(string cropKey, string versionTag, bool publish)
    {
        var templateId = ScheduleTemplateId.New();
        var task = PrescribedTask.Create(
            PrescribedTaskId.New(),
            taskType: "fertigation",
            stage: "flowering",
            dayOffsetFromCycleStart: 10,
            toleranceDaysPlusMinus: 2);
        var template = CropScheduleTemplate.Create(
            templateId.Value,
            templateKey: $"{cropKey}_{versionTag}",
            cropKey: cropKey,
            regionCode: null,
            name: $"{cropKey} {versionTag}",
            versionTag: versionTag,
            createdAtUtc: Now.AddDays(-30),
            tasks: new[] { task });
        if (publish) template.Publish();
        return template;
    }

    private static MigrateScheduleHandler CreateHandler(
        FakeMigrateRepo repo,
        IAnalyticsWriter analytics,
        Guid? newSubIdSeed = null,
        Guid? migrationIdSeed = null)
    {
        var seeds = new List<Guid>();
        if (newSubIdSeed.HasValue) seeds.Add(newSubIdSeed.Value);
        if (migrationIdSeed.HasValue) seeds.Add(migrationIdSeed.Value);
        var ids = new SequentialIdGenerator(seeds.ToArray());
        var clock = new FixedClock(Now);
        return new MigrateScheduleHandler(repo, ids, clock, new AllowEntitlementPolicy(), analytics);
    }

    private sealed class FixedClock(DateTime now) : IClock
    {
        public DateTime UtcNow { get; } = now;
    }

    private sealed class SequentialIdGenerator(params Guid[] ids) : IIdGenerator
    {
        private readonly Queue<Guid> _queue = new(ids);
        public Guid New() => _queue.Count == 0 ? Guid.NewGuid() : _queue.Dequeue();
    }

    private sealed class AllowEntitlementPolicy : IEntitlementPolicy
    {
        public Task<EntitlementDecision> EvaluateAsync(
            UserId userId, FarmId farmId, PaidFeature feature, CancellationToken ct = default) =>
            Task.FromResult(new EntitlementDecision(true, EntitlementReason.Allowed, null));
    }

    private sealed class CapturingAnalyticsWriter : IAnalyticsWriter
    {
        public List<AnalyticsEvent> Events { get; } = new();

        public Task EmitAsync(AnalyticsEvent analyticsEvent, CancellationToken cancellationToken = default)
        {
            Events.Add(analyticsEvent);
            return Task.CompletedTask;
        }

        public Task EmitManyAsync(IEnumerable<AnalyticsEvent> events, CancellationToken cancellationToken = default)
        {
            Events.AddRange(events);
            return Task.CompletedTask;
        }
    }

    private sealed class FakeMigrateRepo : IShramSafalRepository
    {
        public Dictionary<Guid, Farm> Farms { get; } = new();
        public Dictionary<Guid, Plot> Plots { get; } = new();
        public Dictionary<Guid, CropCycle> CropCycles { get; } = new();
        public Dictionary<ScheduleTemplateId, CropScheduleTemplate> Templates { get; } = new();
        public List<ScheduleSubscription> Subscriptions { get; } = new();
        public List<ScheduleMigrationEvent> MigrationEvents { get; } = new();
        public List<AuditEvent> AuditEvents { get; } = new();
        public HashSet<(Guid farmId, Guid userId)> FarmMembers { get; } = new();
        public int SaveCalls { get; private set; }

        public Task<Farm?> GetFarmByIdAsync(Guid farmId, CancellationToken ct = default) =>
            Task.FromResult(Farms.TryGetValue(farmId, out var f) ? f : null);

        public Task<Plot?> GetPlotByIdAsync(Guid plotId, CancellationToken ct = default) =>
            Task.FromResult(Plots.TryGetValue(plotId, out var p) ? p : null);

        public Task<CropCycle?> GetCropCycleByIdAsync(Guid cropCycleId, CancellationToken ct = default) =>
            Task.FromResult(CropCycles.TryGetValue(cropCycleId, out var c) ? c : null);

        public Task<bool> IsUserMemberOfFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default) =>
            Task.FromResult(FarmMembers.Contains((farmId, userId)));

        public Task<CropScheduleTemplate?> GetCropScheduleTemplateByIdAsync(
            ScheduleTemplateId templateId, CancellationToken ct = default) =>
            Task.FromResult(Templates.TryGetValue(templateId, out var t) ? t : null);

        public Task<ScheduleSubscription?> GetActiveScheduleSubscriptionAsync(
            Guid plotId, string cropKey, Guid cropCycleId, CancellationToken ct = default)
        {
            var normalized = (cropKey ?? string.Empty).Trim().ToLowerInvariant();
            var sub = Subscriptions.FirstOrDefault(s =>
                s.PlotId == plotId
                && s.CropCycleId == cropCycleId
                && s.CropKey == normalized
                && s.State == ScheduleSubscriptionState.Active);
            return Task.FromResult(sub);
        }

        public Task AddScheduleSubscriptionAsync(ScheduleSubscription subscription, CancellationToken ct = default)
        {
            Subscriptions.Add(subscription);
            return Task.CompletedTask;
        }

        public Task AddScheduleMigrationEventAsync(ScheduleMigrationEvent migrationEvent, CancellationToken ct = default)
        {
            MigrationEvents.Add(migrationEvent);
            return Task.CompletedTask;
        }

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

        // --- Unused — throw if accidentally called. ---
        public Task AddFarmAsync(Farm farm, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddFarmMembershipAsync(FarmMembership membership, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<FarmMembership?> GetFarmMembershipAsync(Guid farmId, Guid userId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<AppRole?> GetUserRoleForFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<bool> IsUserOwnerOfFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddPlotAsync(Plot plot, CancellationToken ct = default) => throw new NotSupportedException();
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
        public Task AddScheduleTemplateAsync(ScheduleTemplate template, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<ScheduleTemplate>> GetScheduleTemplatesAsync(CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddPlannedActivitiesAsync(IEnumerable<PlannedActivity> plannedActivities, CancellationToken ct = default) => throw new NotSupportedException();
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
        public Task<int> CountActivePrimaryOwnersAsync(Guid farmId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddCropScheduleTemplateAsync(CropScheduleTemplate template, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<CropScheduleTemplate>> GetCropScheduleTemplatesForCropAsync(string cropKey, string? regionCode, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<ScheduleSubscription?> GetScheduleSubscriptionByIdAsync(ScheduleSubscriptionId subscriptionId, CancellationToken ct = default) => throw new NotSupportedException();
    }
}
