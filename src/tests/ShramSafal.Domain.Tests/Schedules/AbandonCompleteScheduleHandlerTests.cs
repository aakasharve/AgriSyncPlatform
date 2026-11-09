using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.SharedKernel.Contracts.Ids;
using AgriSync.SharedKernel.Contracts.Roles;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Schedules.AbandonSchedule;
using ShramSafal.Application.UseCases.Schedules.CompleteSchedule;
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
/// Phase 3 MIS — Abandon and Complete share the same shape (single-state
/// transition on the Active <see cref="ScheduleSubscription"/> for
/// (plot, cropKey, cycle), audit + analytics, no new subscription). One test
/// class covers both to keep the fakes in sync.
/// </summary>
public sealed class AbandonCompleteScheduleHandlerTests
{
    private static readonly FarmId FarmIdVal = new(Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"));
    private static readonly Guid PlotIdVal = Guid.Parse("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    private static readonly Guid CycleIdVal = Guid.Parse("cccccccc-cccc-cccc-cccc-cccccccccccc");
    private static readonly Guid ActorIdVal = Guid.Parse("dddddddd-dddd-dddd-dddd-dddddddddddd");
    private static readonly DateTime Now = new(2026, 4, 19, 12, 0, 0, DateTimeKind.Utc);

    // ------- Abandon ---------

    [Fact]
    public async Task Abandon_HappyPath_TransitionsAndEmitsAnalytics()
    {
        var repo = BuildRepoWithBasics();
        var template = BuildPublishedTemplate("grapes", "v1");
        repo.Templates[template.TemplateId] = template;
        var sub = ScheduleSubscription.Adopt(
            Guid.NewGuid(), FarmIdVal, PlotIdVal, CycleIdVal, "grapes",
            template.TemplateId, template.VersionTag, Now.AddDays(-5));
        repo.Subscriptions.Add(sub);

        var analytics = new CapturingAnalyticsWriter();
        var handler = new AbandonScheduleHandler(repo, new FixedClock(Now), new AllowEntitlementPolicy(), analytics);

        var result = await handler.HandleAsync(new AbandonScheduleCommand(
            FarmId: FarmIdVal.Value,
            PlotId: PlotIdVal,
            CropCycleId: CycleIdVal,
            ActorUserId: ActorIdVal,
            ReasonText: "pest outbreak, giving up this cycle"));

        Assert.True(result.IsSuccess);
        Assert.Equal("Abandoned", result.Value!.State);
        Assert.Equal(ScheduleSubscriptionState.Abandoned, sub.State);
        Assert.Equal(Now, sub.StateChangedAtUtc);
        Assert.Equal(1, repo.SaveCalls);
        Assert.Single(repo.AuditEvents);
        Assert.Equal("Abandoned", repo.AuditEvents[0].Action);
        Assert.Single(analytics.Events);
        Assert.Equal(AnalyticsEventType.ScheduleAbandoned, analytics.Events[0].EventType);
    }

    [Fact]
    public async Task Abandon_NoActiveSubscription_ReturnsSubscriptionNotFound()
    {
        var repo = BuildRepoWithBasics();
        var analytics = new CapturingAnalyticsWriter();
        var handler = new AbandonScheduleHandler(repo, new FixedClock(Now), new AllowEntitlementPolicy(), analytics);

        var result = await handler.HandleAsync(new AbandonScheduleCommand(
            FarmId: FarmIdVal.Value,
            PlotId: PlotIdVal,
            CropCycleId: CycleIdVal,
            ActorUserId: ActorIdVal));

        Assert.True(result.IsFailure);
        Assert.Equal(ShramSafalErrors.ScheduleSubscriptionNotFound, result.Error);
        Assert.Equal(0, repo.SaveCalls);
        Assert.Empty(analytics.Events);
    }

    [Fact]
    public async Task Abandon_NonMember_ReturnsForbidden()
    {
        var repo = BuildRepoWithBasics();
        repo.FarmMembers.Clear();
        var analytics = new CapturingAnalyticsWriter();
        var handler = new AbandonScheduleHandler(repo, new FixedClock(Now), new AllowEntitlementPolicy(), analytics);

        var result = await handler.HandleAsync(new AbandonScheduleCommand(
            FarmId: FarmIdVal.Value,
            PlotId: PlotIdVal,
            CropCycleId: CycleIdVal,
            ActorUserId: ActorIdVal));

        Assert.True(result.IsFailure);
        Assert.Equal(ShramSafalErrors.Forbidden, result.Error);
        Assert.Equal(0, repo.SaveCalls);
        Assert.Empty(analytics.Events);
    }

    // ------- Complete ---------

    [Fact]
    public async Task Complete_HappyPath_TransitionsAndEmitsAnalytics()
    {
        var repo = BuildRepoWithBasics();
        var template = BuildPublishedTemplate("grapes", "v1");
        repo.Templates[template.TemplateId] = template;
        var sub = ScheduleSubscription.Adopt(
            Guid.NewGuid(), FarmIdVal, PlotIdVal, CycleIdVal, "grapes",
            template.TemplateId, template.VersionTag, Now.AddDays(-120));
        repo.Subscriptions.Add(sub);

        var analytics = new CapturingAnalyticsWriter();
        var handler = new CompleteScheduleHandler(repo, new FixedClock(Now), new AllowEntitlementPolicy(), analytics);

        var result = await handler.HandleAsync(new CompleteScheduleCommand(
            FarmId: FarmIdVal.Value,
            PlotId: PlotIdVal,
            CropCycleId: CycleIdVal,
            ActorUserId: ActorIdVal));

        Assert.True(result.IsSuccess);
        Assert.Equal("Completed", result.Value!.State);
        Assert.Equal(ScheduleSubscriptionState.Completed, sub.State);
        Assert.Equal(Now, sub.StateChangedAtUtc);
        Assert.Equal(1, repo.SaveCalls);
        Assert.Single(repo.AuditEvents);
        Assert.Equal("Completed", repo.AuditEvents[0].Action);
        Assert.Single(analytics.Events);
        Assert.Equal(AnalyticsEventType.ScheduleCompleted, analytics.Events[0].EventType);
    }

    [Fact]
    public async Task Complete_NoActiveSubscription_ReturnsSubscriptionNotFound()
    {
        var repo = BuildRepoWithBasics();
        var analytics = new CapturingAnalyticsWriter();
        var handler = new CompleteScheduleHandler(repo, new FixedClock(Now), new AllowEntitlementPolicy(), analytics);

        var result = await handler.HandleAsync(new CompleteScheduleCommand(
            FarmId: FarmIdVal.Value,
            PlotId: PlotIdVal,
            CropCycleId: CycleIdVal,
            ActorUserId: ActorIdVal));

        Assert.True(result.IsFailure);
        Assert.Equal(ShramSafalErrors.ScheduleSubscriptionNotFound, result.Error);
        Assert.Equal(0, repo.SaveCalls);
        Assert.Empty(analytics.Events);
    }

    [Fact]
    public async Task Complete_InvalidCommand_EmptyFarmId_ReturnsInvalidCommand()
    {
        var repo = BuildRepoWithBasics();
        var analytics = new CapturingAnalyticsWriter();
        var handler = new CompleteScheduleHandler(repo, new FixedClock(Now), new AllowEntitlementPolicy(), analytics);

        var result = await handler.HandleAsync(new CompleteScheduleCommand(
            FarmId: Guid.Empty,
            PlotId: PlotIdVal,
            CropCycleId: CycleIdVal,
            ActorUserId: ActorIdVal));

        Assert.True(result.IsFailure);
        Assert.Equal(ShramSafalErrors.InvalidCommand, result.Error);
        Assert.Equal(0, repo.SaveCalls);
    }

    // ------- lane L8b-3 (founder D-74, "3 + 1"): which one -------

    private static ScheduleSubscription FollowingAt(short slot, Guid? farm = null, Guid? plot = null, Guid? cycle = null) =>
        ScheduleSubscription.Adopt(
            Guid.NewGuid(), new FarmId(farm ?? FarmIdVal.Value), plot ?? PlotIdVal, cycle ?? CycleIdVal, "grapes",
            ScheduleTemplateId.New(), "v1", Now.AddDays(-10 + slot), null, ScheduleOrigin.Outside, ScheduleCheckState.NotChecked, slot);

    private static (AbandonScheduleHandler Handler, CapturingAnalyticsWriter Analytics) AbandonHandler(FakeAbandonCompleteRepo repo)
    {
        var analytics = new CapturingAnalyticsWriter();
        return (new AbandonScheduleHandler(repo, new FixedClock(Now), new AllowEntitlementPolicy(), analytics), analytics);
    }

    private static AbandonScheduleCommand AbandonOf(Guid? subscription) => new(
        FarmId: FarmIdVal.Value, PlotId: PlotIdVal, CropCycleId: CycleIdVal, ActorUserId: ActorIdVal, SubscriptionId: subscription);

    private static CompleteScheduleCommand CompleteOf(Guid? subscription) => new(
        FarmId: FarmIdVal.Value, PlotId: PlotIdVal, CropCycleId: CycleIdVal, ActorUserId: ActorIdVal, SubscriptionId: subscription);

    [Fact]
    public async Task Abandon_with_an_id_acts_on_that_row_only()
    {
        var repo = BuildRepoWithBasics();
        var one = FollowingAt(1);
        var two = FollowingAt(2);
        repo.Subscriptions.AddRange([one, two]);

        var result = (await AbandonHandler(repo).Handler.HandleAsync(AbandonOf(two.Id)));

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Code : null);
        Assert.Equal(two.Id, result.Value.Id);
        Assert.Equal(ScheduleSubscriptionState.Abandoned, two.State);
        Assert.Equal(ScheduleSubscriptionState.Active, one.State);
    }

    [Fact]
    public async Task Abandon_without_an_id_and_one_active_acts_on_that_row_P11()
    {
        var repo = BuildRepoWithBasics();
        var only = FollowingAt(1);
        repo.Subscriptions.Add(only);

        var result = await AbandonHandler(repo).Handler.HandleAsync(AbandonOf(null));

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Code : null);
        Assert.Equal(ScheduleSubscriptionState.Abandoned, only.State);
    }

    [Fact]
    public async Task Abandon_without_an_id_and_several_active_is_ScheduleChoiceNeeded_and_nothing_changes()
    {
        var repo = BuildRepoWithBasics();
        var one = FollowingAt(1);
        var two = FollowingAt(2);
        repo.Subscriptions.AddRange([one, two]);
        var (handler, analytics) = AbandonHandler(repo);

        var result = await handler.HandleAsync(AbandonOf(null));

        Assert.Equal(ShramSafalErrors.ScheduleChoiceNeeded, result.Error);
        Assert.Equal(ScheduleSubscriptionState.Active, one.State);
        Assert.Equal(ScheduleSubscriptionState.Active, two.State);
        Assert.Equal(0, repo.SaveCalls);
        Assert.Empty(repo.AuditEvents);
        Assert.Empty(analytics.Events);
    }

    [Fact]
    public async Task Abandon_with_the_id_of_a_row_already_ended_is_ScheduleChangedElsewhere()
    {
        var repo = BuildRepoWithBasics();
        var ended = FollowingAt(1);
        ended.Abandon(Now.AddDays(-1));
        repo.Subscriptions.AddRange([ended, FollowingAt(2)]);

        var result = await AbandonHandler(repo).Handler.HandleAsync(AbandonOf(ended.Id));

        Assert.Equal(ShramSafalErrors.ScheduleChangedElsewhere, result.Error);
        Assert.Equal(0, repo.SaveCalls);
    }

    [Fact]
    public async Task Abandon_with_an_unknown_other_plot_or_other_farm_id_answers_like_a_made_up_id_E4()
    {
        var repo = BuildRepoWithBasics();
        repo.Subscriptions.Add(FollowingAt(1));
        var otherPlot = FollowingAt(1, plot: Guid.NewGuid());
        var otherCycle = FollowingAt(1, cycle: Guid.NewGuid());
        var otherFarm = FollowingAt(1, farm: Guid.NewGuid(), plot: Guid.NewGuid());
        repo.Subscriptions.AddRange([otherPlot, otherCycle, otherFarm]);
        var handler = AbandonHandler(repo).Handler;

        var madeUp = await handler.HandleAsync(AbandonOf(Guid.NewGuid()));
        Assert.Equal(ShramSafalErrors.ScheduleSubscriptionNotFound, madeUp.Error);
        foreach (var foreign in new[] { otherPlot, otherCycle, otherFarm })
        {
            var result = await handler.HandleAsync(AbandonOf(foreign.Id));
            Assert.Equal(madeUp.Error, result.Error);
            Assert.Equal(ScheduleSubscriptionState.Active, foreign.State);
        }

        Assert.Equal(0, repo.SaveCalls);
    }

    [Fact]
    public async Task Complete_with_an_id_acts_on_that_row_only_and_without_one_follows_the_same_rules()
    {
        var repo = BuildRepoWithBasics();
        var one = FollowingAt(1);
        var two = FollowingAt(2);
        repo.Subscriptions.AddRange([one, two]);
        var handler = new CompleteScheduleHandler(repo, new FixedClock(Now), new AllowEntitlementPolicy(), new CapturingAnalyticsWriter());

        var unnamed = await handler.HandleAsync(CompleteOf(null));
        Assert.Equal(ShramSafalErrors.ScheduleChoiceNeeded, unnamed.Error);
        Assert.Equal(0, repo.SaveCalls);

        var named = await handler.HandleAsync(CompleteOf(one.Id));
        Assert.True(named.IsSuccess, named.IsFailure ? named.Error.Code : null);
        Assert.Equal(ScheduleSubscriptionState.Completed, one.State);
        Assert.Equal(ScheduleSubscriptionState.Active, two.State);

        var foreign = await handler.HandleAsync(CompleteOf(Guid.NewGuid()));
        Assert.Equal(ShramSafalErrors.ScheduleSubscriptionNotFound, foreign.Error);

        var ended = await handler.HandleAsync(CompleteOf(one.Id));
        Assert.Equal(ShramSafalErrors.ScheduleChangedElsewhere, ended.Error);
    }

    // ------- Helpers ---------

    private static FakeAbandonCompleteRepo BuildRepoWithBasics()
    {
        var repo = new FakeAbandonCompleteRepo();
        var farm = Farm.Create(FarmIdVal, "Patil Farm", new UserId(ActorIdVal), Now.AddDays(-30));
        repo.Farms[FarmIdVal.Value] = farm;
        var plot = Plot.Create(PlotIdVal, FarmIdVal, "North Block", 2.5m, Now.AddDays(-30));
        repo.Plots[plot.Id] = plot;
        var cycle = CropCycle.Create(
            CycleIdVal, FarmIdVal, plot.Id, cropName: "Grapes", stage: "flowering",
            startDate: new DateOnly(2026, 1, 1), endDate: null, createdAtUtc: Now.AddDays(-25));
        repo.CropCycles[cycle.Id] = cycle;
        repo.FarmMembers.Add((FarmIdVal.Value, ActorIdVal));
        return repo;
    }

    private static CropScheduleTemplate BuildPublishedTemplate(string cropKey, string versionTag)
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
            createdAtUtc: Now.AddDays(-60),
            tasks: new[] { task });
        template.Publish();
        return template;
    }

    private sealed class FixedClock(DateTime now) : IClock
    {
        public DateTime UtcNow { get; } = now;
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

    private sealed class FakeAbandonCompleteRepo : IShramSafalRepository
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

        // spec: plr-d10 lane L8b-3 - every Active subscription of the plot-season (the single read it replaces relied on I-14), by place.
        public Task<List<ScheduleSubscription>> GetActiveScheduleSubscriptionsAsync(
            Guid plotId, Guid cropCycleId, CancellationToken ct = default) =>
            Task.FromResult(Subscriptions
                .Where(s => s.PlotId == plotId && s.CropCycleId == cropCycleId && s.State == ScheduleSubscriptionState.Active)
                .OrderBy(s => s.Slot is null).ThenBy(s => s.Slot).ThenBy(s => s.AdoptedAtUtc).ThenBy(s => s.Id)
                .ToList());

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
        public Task<int> CountActivePrimaryOwnersAsync(Guid farmId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddCropScheduleTemplateAsync(CropScheduleTemplate template, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<CropScheduleTemplate?> GetCropScheduleTemplateByIdAsync(ScheduleTemplateId templateId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<List<CropScheduleTemplate>> GetCropScheduleTemplatesForCropAsync(string cropKey, string? regionCode, CancellationToken ct = default) => throw new NotSupportedException();
        public Task AddScheduleSubscriptionAsync(ScheduleSubscription subscription, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<ScheduleSubscription?> GetScheduleSubscriptionByIdAsync(ScheduleSubscriptionId subscriptionId, CancellationToken ct = default) =>
            Task.FromResult(Subscriptions.FirstOrDefault(s => s.Id == subscriptionId.Value));
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
