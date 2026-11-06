using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Services;
using ShramSafal.Application.UseCases.ReferenceData.GetScheduleTemplates;
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
///   - lane L8b-1: the schedule comes from the LIBRARY (rows, else the built-in catalog); another account's private
///     schedule answers like an unknown id; the day 0 is kept; the schedule gate refuses a कामगार.
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
        var listed = GetScheduleTemplatesHandler.Listing(repo.Templates.Values.Select(t => t.Row).ToList()).Single(t => t.Id == template.Id);

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
        Assert.Equal(ScheduleLibrary.VersionTagOf(listed), dto.ScheduleVersionTag);
        Assert.Null(dto.ReferenceDate);

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
    public async Task HandleAsync_AnotherAccountsPrivateTemplate_ReturnsTemplateNotFound()
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
        Assert.Equal(ShramSafalErrors.ScheduleTemplateNotFound, result.Error);
        Assert.Empty(repo.Subscriptions);
        Assert.Equal(0, repo.SaveCalls);
    }

    [Fact]
    public async Task HandleAsync_BuiltInLibraryTemplate_AdoptsWithDayZero()
    {
        // No rows: the library is the built-in catalog, exactly as the phone lists it.
        var repo = BuildRepoWithBasics();
        var builtIn = ReferenceDataCatalog.ScheduleTemplates.Single(t => t.CropType == "Grapes");
        var handler = CreateHandler(repo);

        var result = await handler.HandleAsync(new AdoptScheduleCommand(
            FarmId: FarmIdVal.Value,
            PlotId: PlotIdVal,
            CropCycleId: CycleIdVal,
            ScheduleTemplateId: builtIn.Id,
            ActorUserId: ActorIdVal,
            ReferenceDate: new DateOnly(2026, 2, 20)));

        Assert.True(result.IsSuccess);
        Assert.Equal(builtIn.Id, result.Value.ScheduleTemplateId);
        Assert.Equal(new DateOnly(2026, 2, 20), result.Value.ReferenceDate);
        Assert.Equal(new DateOnly(2026, 2, 20), Assert.Single(repo.Subscriptions).ReferenceDate);
    }

    [Fact]
    public async Task HandleAsync_WorkerSeat_IsRefusedByTheScheduleGate()
    {
        var repo = BuildRepoWithBasics();
        repo.Role = AppRole.Worker;
        var builtIn = ReferenceDataCatalog.ScheduleTemplates.Single(t => t.CropType == "Grapes");

        var result = await CreateHandler(repo).HandleAsync(new AdoptScheduleCommand(
            FarmId: FarmIdVal.Value,
            PlotId: PlotIdVal,
            CropCycleId: CycleIdVal,
            ScheduleTemplateId: builtIn.Id,
            ActorUserId: ActorIdVal));

        Assert.True(result.IsFailure);
        Assert.Equal(ShramSafalErrors.Forbidden, result.Error);
        Assert.Empty(repo.Subscriptions);
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

    private static LibraryTemplate BuildPublishedTemplate(string cropKey) =>
        BuildTemplate(cropKey, publish: true);

    private static LibraryTemplate BuildTemplate(string cropKey, bool publish) =>
        BuildLibraryTemplate(cropKey, "v1", publish);

    /// <summary>lane L8b-1 — a library schedule ROW (ssf.schedule_templates) as the handlers now adopt it.</summary>
    private sealed record LibraryTemplate(ScheduleTemplate Row, string VersionTag)
    {
        public Guid Id => Row.Id;
        public ScheduleTemplateId TemplateId => new(Row.Id);
    }

    /// <summary>
    /// A library row named the way the library reads its crop ("grapes - v1" → Grapes). <paramref name="publish"/> false:
    /// another account's PRIVATE schedule (the library has no "unpublished" — it lists every row; what a caller may not
    /// adopt is a schedule he may not see).
    /// </summary>
    private static LibraryTemplate BuildLibraryTemplate(string cropKey, string versionTag, bool publish)
    {
        var row = ScheduleTemplate.Create(
            Guid.NewGuid(), $"{cropKey} - {versionTag}", "flowering", Now.AddDays(-30),
            createdByUserId: publish ? null : new UserId(Guid.Parse("99999999-9999-9999-9999-999999999999")),
            tenantScope: publish ? TenantScope.Public : TenantScope.Private);
        row.AddActivity(Guid.NewGuid(), "fertigation", 10);
        return new LibraryTemplate(row, versionTag);
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
        public Dictionary<ScheduleTemplateId, LibraryTemplate> Templates { get; } = new();
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

        // lane L8b-1 — the compliance model is not the library: a handler that still read it would fail here.
        public Task<CropScheduleTemplate?> GetCropScheduleTemplateByIdAsync(
            ScheduleTemplateId templateId, CancellationToken ct = default) =>
            throw new NotSupportedException("adoption reads the library (ScheduleLibrary), never crop_schedule_templates");

        public Task<List<ScheduleTemplate>> GetScheduleTemplatesAsync(CancellationToken ct = default) =>
            Task.FromResult(Templates.Values.Select(t => t.Row).ToList());

        public Task<List<Guid>> GetFarmIdsForUserAsync(Guid userId, CancellationToken ct = default) =>
            Task.FromResult(FarmMembers.Where(m => m.userId == userId).Select(m => m.farmId).ToList());

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
        // lane L8b-1 — the schedule doors ask ScheduleChangeGate (founder D-73: the primary owner, or a PlanWork seat).
        public AppRole? Role { get; set; } = AppRole.PrimaryOwner;
        public Task<AppRole?> GetUserRoleForFarmAsync(Guid farmId, Guid userId, CancellationToken ct = default) => Task.FromResult(Role);
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
        public Task<int> CountActivePrimaryOwnersAsync(Guid farmId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddCropScheduleTemplateAsync(CropScheduleTemplate template, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<CropScheduleTemplate>> GetCropScheduleTemplatesForCropAsync(string cropKey, string? regionCode, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<ScheduleSubscription?> GetScheduleSubscriptionByIdAsync(ScheduleSubscriptionId subscriptionId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddScheduleMigrationEventAsync(ScheduleMigrationEvent migrationEvent, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<ScheduleTemplate?> GetScheduleTemplateByIdAsync(Guid templateId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<bool> HasActiveOwnerMembershipAsync(Guid userId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<ScheduleTemplate>> GetScheduleLineageAsync(Guid rootTemplateId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<int> GetDisputedLogCountForPlotAsync(Guid plotId, CancellationToken ct = default) => throw new NotSupportedException();

        // Sub-plan 03 Task 5 (T-IGH-03-PORT-COMPLETE-MIGRATION):
        // required interface members; no-op in this test stub.
        public Task AddFarmBoundaryAsync(ShramSafal.Domain.Farms.FarmBoundary boundary, CancellationToken ct = default) => Task.CompletedTask;
        public Task AddJobCardAsync(ShramSafal.Domain.Work.JobCard jobCard, CancellationToken ct = default) => Task.CompletedTask;
        public Task AddTranscriptAsync(ShramSafal.Domain.AI.Transcript transcript, CancellationToken ct = default) => Task.CompletedTask;
    }
}
