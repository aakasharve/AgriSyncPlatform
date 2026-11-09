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
///   - lane L8b-3 (founder D-74, "3 + 1", replacing I-14): the SAME schedule twice on a plot-season is rejected; a different one takes
///     the next place (outside 1..3, his own 0); a 4th outside is refused ScheduleLimitReached with nothing written; a schedule the
///     check rule refuses never takes a place; two phones racing for one place: the loser re-reads once, then is told the limit.
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

        // Seed a pre-existing active subscription of the SAME schedule: the same one twice is still refused (3 + 1).
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

    private static AdoptScheduleCommand AdoptOf(Guid templateId, bool carryOver = false) => new(
        FarmId: FarmIdVal.Value,
        PlotId: PlotIdVal,
        CropCycleId: CycleIdVal,
        ScheduleTemplateId: templateId,
        ActorUserId: ActorIdVal,
        CarryOver: carryOver);

    private static ScheduleSubscription FollowingAt(LibraryTemplate template, short slot, ScheduleOrigin origin = ScheduleOrigin.Outside) =>
        ScheduleSubscription.Adopt(
            Guid.NewGuid(), FarmIdVal, PlotIdVal, CycleIdVal, "grapes", template.TemplateId, template.VersionTag,
            Now.AddDays(-slot - 1), null, origin, ScheduleCheckState.NotChecked, slot);

    [Fact]
    public async Task Three_outside_schedules_take_places_1_2_3_in_turn()
    {
        var repo = BuildRepoWithBasics();
        var templates = Enumerable.Range(1, 3).Select(i => BuildPublishedTemplate("grapes")).ToList();
        foreach (var t in templates) repo.Templates[t.TemplateId] = t;
        var handler = CreateHandler(repo);

        foreach (var t in templates)
        {
            var result = await handler.HandleAsync(AdoptOf(t.Id));
            Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Code : null);
        }

        Assert.Equal(new short?[] { 1, 2, 3 }, repo.Subscriptions.Select(s => s.Slot).ToArray());
        Assert.All(repo.Subscriptions, s => Assert.Equal(ScheduleOrigin.Outside, s.Origin));
        Assert.Equal(
            new[] { 1, 2, 3 },
            repo.AuditEvents.Select(a => System.Text.Json.JsonDocument.Parse(a.Payload).RootElement.GetProperty("slot").GetInt32()).ToArray());
    }

    [Fact]
    public async Task A_fourth_outside_schedule_is_refused_ScheduleLimitReached_and_nothing_is_written()
    {
        var repo = BuildRepoWithBasics();
        for (short slot = 1; slot <= 3; slot++)
        {
            var held = BuildPublishedTemplate("grapes");
            repo.Templates[held.TemplateId] = held;
            repo.Subscriptions.Add(FollowingAt(held, slot));
        }

        var fourth = BuildPublishedTemplate("grapes");
        repo.Templates[fourth.TemplateId] = fourth;

        var result = await CreateHandler(repo).HandleAsync(AdoptOf(fourth.Id));

        Assert.True(result.IsFailure);
        Assert.Equal(ShramSafalErrors.ScheduleLimitReached, result.Error);
        Assert.Equal(3, repo.Subscriptions.Count);
        Assert.Empty(repo.AuditEvents);
        Assert.Equal(0, repo.SaveCalls);
    }

    [Fact]
    public async Task An_abandoned_place_is_free_again()
    {
        var repo = BuildRepoWithBasics();
        for (short slot = 1; slot <= 3; slot++)
        {
            var t = BuildPublishedTemplate("grapes");
            repo.Templates[t.TemplateId] = t;
            repo.Subscriptions.Add(FollowingAt(t, slot));
        }

        repo.Subscriptions[1].Abandon(Now); // place 2 is let go
        var next = BuildPublishedTemplate("grapes");
        repo.Templates[next.TemplateId] = next;

        var result = await CreateHandler(repo).HandleAsync(AdoptOf(next.Id));

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Code : null);
        Assert.Equal((short?)2, repo.Subscriptions.Single(s => s.ScheduleTemplateId == next.TemplateId).Slot);
    }

    [Fact]
    public async Task A_different_schedule_on_a_plot_that_follows_one_is_adopted_not_refused()
    {
        var repo = BuildRepoWithBasics();
        var first = BuildPublishedTemplate("grapes");
        var second = BuildPublishedTemplate("grapes");
        repo.Templates[first.TemplateId] = first;
        repo.Templates[second.TemplateId] = second;
        repo.Subscriptions.Add(FollowingAt(first, 1));

        var result = await CreateHandler(repo).HandleAsync(AdoptOf(second.Id));

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Code : null);
        Assert.Equal((short?)2, result.Value.Slot);
        Assert.Equal(2, repo.Subscriptions.Count(s => s.State == ScheduleSubscriptionState.Active));
    }

    [Fact]
    public async Task A_schedule_the_check_rule_refuses_takes_no_place_even_when_the_plot_is_full()
    {
        // The check rule runs FIRST (ScheduleLibrary.ChooseAsync): a schedule of another crop is a crop mismatch, never "limit reached".
        var repo = BuildRepoWithBasics();
        for (short slot = 1; slot <= 3; slot++)
        {
            var held = BuildPublishedTemplate("grapes");
            repo.Templates[held.TemplateId] = held;
            repo.Subscriptions.Add(FollowingAt(held, slot));
        }

        var onion = BuildPublishedTemplate("onion");
        repo.Templates[onion.TemplateId] = onion;

        var result = await CreateHandler(repo).HandleAsync(AdoptOf(onion.Id));

        Assert.Equal(ShramSafalErrors.ScheduleTemplateCropMismatch, result.Error);
        Assert.Equal(3, repo.Subscriptions.Count);
    }

    [Fact]
    public async Task A_carry_over_onto_a_plot_season_that_already_follows_something_is_refused_ScheduleAlreadyAdopted()
    {
        var repo = BuildRepoWithBasics();
        var held = BuildPublishedTemplate("grapes");
        var carried = BuildPublishedTemplate("grapes");
        repo.Templates[held.TemplateId] = held;
        repo.Templates[carried.TemplateId] = carried;
        repo.Subscriptions.Add(FollowingAt(held, 1));

        var result = await CreateHandler(repo).HandleAsync(AdoptOf(carried.Id, carryOver: true));

        Assert.Equal(ShramSafalErrors.ScheduleAlreadyAdopted, result.Error);
        Assert.Single(repo.Subscriptions);
    }

    [Fact]
    public async Task A_place_taken_once_by_a_rival_is_retried_once_and_takes_the_next_free_place()
    {
        var repo = BuildRepoWithBasics();
        var mine = BuildPublishedTemplate("grapes");
        var rivalTemplate = BuildPublishedTemplate("grapes");
        repo.Templates[mine.TemplateId] = mine;
        repo.Templates[rivalTemplate.TemplateId] = rivalTemplate;
        repo.RivalsOnPlaceTaken.Enqueue(FollowingAt(rivalTemplate, 1));

        var result = await CreateHandler(repo).HandleAsync(AdoptOf(mine.Id));

        Assert.True(result.IsSuccess, result.IsFailure ? result.Error.Code : null);
        Assert.Equal((short?)2, result.Value.Slot);
        Assert.Equal(2, repo.TrySaveCalls);
        Assert.Equal(2, repo.Subscriptions.Count);
        Assert.Single(repo.AuditEvents); // the lost attempt's audit row was discarded with it
    }

    [Fact]
    public async Task A_place_taken_twice_is_told_ScheduleLimitReached_and_writes_nothing()
    {
        var repo = BuildRepoWithBasics();
        var mine = BuildPublishedTemplate("grapes");
        var a = BuildPublishedTemplate("grapes");
        var b = BuildPublishedTemplate("grapes");
        repo.Templates[mine.TemplateId] = mine;
        repo.RivalsOnPlaceTaken.Enqueue(FollowingAt(a, 1));
        repo.RivalsOnPlaceTaken.Enqueue(FollowingAt(b, 2));

        var result = await CreateHandler(repo).HandleAsync(AdoptOf(mine.Id));

        Assert.Equal(ShramSafalErrors.ScheduleLimitReached, result.Error);
        Assert.Equal(2, repo.TrySaveCalls);
        Assert.DoesNotContain(repo.Subscriptions, s => s.ScheduleTemplateId == mine.TemplateId);
        Assert.Empty(repo.AuditEvents);
    }

    [Fact]
    public async Task The_same_schedule_taken_at_the_same_moment_is_ScheduleAlreadyAdopted()
    {
        var repo = BuildRepoWithBasics();
        var mine = BuildPublishedTemplate("grapes");
        repo.Templates[mine.TemplateId] = mine;
        repo.TemplateAlreadyFollowedOnSave = true;

        var result = await CreateHandler(repo).HandleAsync(AdoptOf(mine.Id));

        Assert.Equal(ShramSafalErrors.ScheduleAlreadyAdopted, result.Error);
        Assert.Empty(repo.Subscriptions);
    }

    [Fact]
    public void A_place_and_its_origin_must_agree()
    {
        var template = ScheduleTemplateId.New();
        Assert.Throws<ArgumentException>(() => ScheduleSubscription.Adopt(
            Guid.NewGuid(), FarmIdVal, PlotIdVal, CycleIdVal, "grapes", template, "v1", Now, null, ScheduleOrigin.Own, null, 1));
        Assert.Throws<ArgumentException>(() => ScheduleSubscription.Adopt(
            Guid.NewGuid(), FarmIdVal, PlotIdVal, CycleIdVal, "grapes", template, "v1", Now, null, ScheduleOrigin.Outside, null, 0));
        Assert.Throws<ArgumentException>(() => ScheduleSubscription.Adopt(
            Guid.NewGuid(), FarmIdVal, PlotIdVal, CycleIdVal, "grapes", template, "v1", Now, null, ScheduleOrigin.Outside, null, 4));
        Assert.Throws<ArgumentException>(() => ScheduleSubscription.Adopt(
            Guid.NewGuid(), FarmIdVal, PlotIdVal, CycleIdVal, "grapes", template, "v1", Now, null, null, null, 1));
        Assert.Equal((short?)0, ScheduleSubscription.Adopt(
            Guid.NewGuid(), FarmIdVal, PlotIdVal, CycleIdVal, "grapes", template, "v1", Now, null, ScheduleOrigin.Own, null, 0).Slot);
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

        // lane L8b-3 - simulate the database's places index: each enqueued rival takes its place just before the next save, and that
        // save is refused (PlaceTaken) after discarding what was staged, exactly as TrySaveScheduleSubscriptionAsync does.
        public Queue<ScheduleSubscription> RivalsOnPlaceTaken { get; } = new();
        public bool TemplateAlreadyFollowedOnSave { get; set; }
        public int TrySaveCalls { get; private set; }
        private int _stagedSubscriptions;
        private int _stagedAudit;

        public Task<ScheduleSubscriptionSave> TrySaveScheduleSubscriptionAsync(CancellationToken ct = default)
        {
            TrySaveCalls++;
            var refused = RivalsOnPlaceTaken.Count > 0 || TemplateAlreadyFollowedOnSave;
            if (!refused)
            {
                _stagedSubscriptions = 0;
                _stagedAudit = 0;
                SaveCalls++;
                return Task.FromResult(ScheduleSubscriptionSave.Saved);
            }

            Subscriptions.RemoveRange(Subscriptions.Count - _stagedSubscriptions, _stagedSubscriptions);
            AuditEvents.RemoveRange(AuditEvents.Count - _stagedAudit, _stagedAudit);
            _stagedSubscriptions = 0;
            _stagedAudit = 0;
            if (TemplateAlreadyFollowedOnSave)
            {
                return Task.FromResult(ScheduleSubscriptionSave.TemplateAlreadyFollowed);
            }

            Subscriptions.Add(RivalsOnPlaceTaken.Dequeue());
            return Task.FromResult(ScheduleSubscriptionSave.PlaceTaken);
        }

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

        // spec: plr-d10 lane L8b-3 - every Active subscription of the plot-season (the single read it replaces relied on I-14), by place.
        public Task<List<ScheduleSubscription>> GetActiveScheduleSubscriptionsAsync(
            Guid plotId, Guid cropCycleId, CancellationToken ct = default) =>
            Task.FromResult(Subscriptions
                .Where(s => s.PlotId == plotId && s.CropCycleId == cropCycleId && s.State == ScheduleSubscriptionState.Active)
                .OrderBy(s => s.Slot is null).ThenBy(s => s.Slot).ThenBy(s => s.AdoptedAtUtc).ThenBy(s => s.Id)
                .ToList());

        public Task AddScheduleSubscriptionAsync(ScheduleSubscription subscription, CancellationToken ct = default)
        {
            Subscriptions.Add(subscription);
            _stagedSubscriptions++;
            return Task.CompletedTask;
        }

        public Task AddAuditEventAsync(AuditEvent auditEvent, CancellationToken ct = default)
        {
            AuditEvents.Add(auditEvent);
            _stagedAudit++;
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
