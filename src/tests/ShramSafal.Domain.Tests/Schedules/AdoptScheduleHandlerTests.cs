using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Schedules.AdoptSchedule;
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
/// Phase 3 MIS — AdoptScheduleHandler invariant coverage:
///   - Happy path writes subscription + audit event + SaveChanges.
///   - I-14: duplicate active subscription on same (plot, crop, cycle) is rejected.
///   - Unpublished templates are rejected.
///   - Template crop mismatch is rejected.
/// </summary>
public sealed class AdoptScheduleHandlerTests
{
    private static readonly FarmId FarmIdVal = new(Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"));
    private static readonly Guid PlotIdVal = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    private static readonly Guid CycleIdVal = Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc");
    private static readonly Guid ActorIdVal = Guid.Parse("dddddddd-dddd-dddd-dddd-dddddddddddd");
    private static readonly DateTime Now = new(2026, 4, 19, 12, 0, 0, DateTimeKind.Utc);

    [Fact]
    public async Task HandleAsync_PublishedTemplate_AdoptsSubscription()
    {
        var repo = BuildRepoWithBasics();
        var template = BuildPublishedTemplate(cropKey: "grapes");
        repo.Templates[template.TemplateId] = template;

        var handler = CreateHandler(repo, subscriptionIdSeed: Guid.Parse("eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee"));

        var result = await handler.HandleAsync(new AdoptScheduleCommand(
            FarmId: FarmIdVal.Value,
            PlotId: PlotIdVal,
            CropCycleId: CycleIdVal,
            ScheduleTemplateId: template.Id,
            ActorUserId: ActorIdVal,
            ActorRole: "primaryowner"));

        Assert.True(result.IsSuccess);
        var dto = result.Value;
        Assert.Equal("Active", dto.State);
        Assert.Equal(template.Id, dto.ScheduleTemplateId);
        Assert.Equal("grapes", dto.CropKey);
        Assert.Equal(template.VersionTag, dto.ScheduleVersionTag);

        Assert.Single(repo.Subscriptions);
        Assert.Single(repo.AuditEvents);
        Assert.Equal(1, repo.SaveCalls);
        Assert.Equal("Adopted", repo.AuditEvents[0].Action);
    }

    [Fact]
    public async Task HandleAsync_WhenActiveSubscriptionExists_ReturnsAlreadyAdopted()
    {
        var repo = BuildRepoWithBasics();
        var template = BuildPublishedTemplate(cropKey: "grapes");
        repo.Templates[template.TemplateId] = template;

        // Seed a pre-existing active subscription so I-14 fires.
        var existing = ScheduleSubscription.Adopt(
            Guid.NewGuid(), FarmIdVal, PlotIdVal, CycleIdVal, "grapes",
            template.TemplateId, template.VersionTag, Now.AddDays(-1));
        repo.Subscriptions.Add(existing);

        var handler = CreateHandler(repo);

        var result = await handler.HandleAsync(new AdoptScheduleCommand(
            FarmId: FarmIdVal.Value,
            PlotId: PlotIdVal,
            CropCycleId: CycleIdVal,
            ScheduleTemplateId: template.Id,
            ActorUserId: ActorIdVal));

        Assert.True(result.IsFailure);
        Assert.Equal(ShramSafalErrors.ScheduleAlreadyAdopted, result.Error);
        Assert.Single(repo.Subscriptions); // No new subscription written.
        Assert.Equal(0, repo.SaveCalls);
    }

    [Fact]
    public async Task HandleAsync_UnpublishedTemplate_ReturnsTemplateUnpublished()
    {
        var repo = BuildRepoWithBasics();
        var template = BuildTemplate(cropKey: "grapes", publish: false);
        repo.Templates[template.TemplateId] = template;

        var handler = CreateHandler(repo);

        var result = await handler.HandleAsync(new AdoptScheduleCommand(
            FarmId: FarmIdVal.Value,
            PlotId: PlotIdVal,
            CropCycleId: CycleIdVal,
            ScheduleTemplateId: template.Id,
            ActorUserId: ActorIdVal));

        Assert.True(result.IsFailure);
        Assert.Equal(ShramSafalErrors.ScheduleTemplateUnpublished, result.Error);
        Assert.Empty(repo.Subscriptions);
        Assert.Equal(0, repo.SaveCalls);
    }

    [Fact]
    public async Task HandleAsync_TemplateCropMismatch_ReturnsCropMismatch()
    {
        var repo = BuildRepoWithBasics(); // crop cycle uses "grapes"
        var template = BuildPublishedTemplate(cropKey: "onion");
        repo.Templates[template.TemplateId] = template;

        var handler = CreateHandler(repo);

        var result = await handler.HandleAsync(new AdoptScheduleCommand(
            FarmId: FarmIdVal.Value,
            PlotId: PlotIdVal,
            CropCycleId: CycleIdVal,
            ScheduleTemplateId: template.Id,
            ActorUserId: ActorIdVal));

        Assert.True(result.IsFailure);
        Assert.Equal(ShramSafalErrors.ScheduleTemplateCropMismatch, result.Error);
        Assert.Empty(repo.Subscriptions);
        Assert.Equal(0, repo.SaveCalls);
    }

    private static FakeAdoptRepo BuildRepoWithBasics()
    {
        var repo = new FakeAdoptRepo();
        var farm = Farm.Create(FarmIdVal, "Patil Farm", new UserId(ActorIdVal), Now.AddDays(-10));
        repo.Farms[FarmIdVal.Value] = farm;
        var plot = Plot.Create(PlotIdVal, FarmIdVal, "North Block", 2.5m, Now.AddDays(-10));
        repo.Plots[plot.Id] = plot;
        var cycle = CropCycle.Create(
            CycleIdVal, FarmIdVal, plot.Id, cropName: "Grapes", stage: "flowering",
            startDate: new DateOnly(2026, 3, 1), endDate: null, createdAtUtc: Now.AddDays(-5));
        repo.CropCycles[cycle.Id] = cycle;
        repo.FarmMembers.Add((FarmIdVal.Value, ActorIdVal));
        return repo;
    }

    private static CropScheduleTemplate BuildPublishedTemplate(string cropKey) =>
        BuildTemplate(cropKey, publish: true);

    private static CropScheduleTemplate BuildTemplate(string cropKey, bool publish)
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
            templateKey: $"{cropKey}_standard_v1",
            cropKey: cropKey,
            regionCode: null,
            name: $"{cropKey} standard",
            versionTag: "v1",
            createdAtUtc: Now.AddDays(-30),
            tasks: new[] { task });
        if (publish) template.Publish();
        return template;
    }

    private static AdoptScheduleHandler CreateHandler(FakeAdoptRepo repo, Guid? subscriptionIdSeed = null)
    {
        var ids = subscriptionIdSeed.HasValue
            ? new SequentialIdGenerator(subscriptionIdSeed.Value)
            : new SequentialIdGenerator(Guid.NewGuid());
        var clock = new FixedClock(Now);
        return new AdoptScheduleHandler(repo, ids, clock, new AllowEntitlementPolicy());
    }

    private sealed class FixedClock : IClock
    {
        public FixedClock(DateTime now) => UtcNow = now;
        public DateTime UtcNow { get; }
    }

    private sealed class SequentialIdGenerator : IIdGenerator
    {
        private readonly Queue<Guid> _queue;
        public SequentialIdGenerator(params Guid[] ids) => _queue = new Queue<Guid>(ids);
        public Guid New() => _queue.Count == 0 ? Guid.NewGuid() : _queue.Dequeue();
    }

    private sealed class AllowEntitlementPolicy : IEntitlementPolicy
    {
        public Task<EntitlementDecision> EvaluateAsync(
            UserId userId, FarmId farmId, PaidFeature feature, CancellationToken ct = default) =>
            Task.FromResult(new EntitlementDecision(true, EntitlementReason.Allowed, null));
    }

    private sealed class FakeAdoptRepo : IShramSafalRepository
    {
        public Dictionary<Guid, Farm> Farms { get; } = new();
        public Dictionary<Guid, Plot> Plots { get; } = new();
        public Dictionary<Guid, CropCycle> CropCycles { get; } = new();
        public Dictionary<ScheduleTemplateId, CropScheduleTemplate> Templates { get; } = new();
        public List<ScheduleSubscription> Subscriptions { get; } = new();
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

        // --- Unused members: throw if any accidental dependency slips in. ---
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
        public Task AddScheduleMigrationEventAsync(ScheduleMigrationEvent migrationEvent, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<ScheduleTemplate?> GetScheduleTemplateByIdAsync(Guid templateId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<bool> HasActiveOwnerMembershipAsync(Guid userId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<ScheduleTemplate>> GetScheduleLineageAsync(Guid rootTemplateId, CancellationToken ct = default) => throw new NotSupportedException();
    }
}
