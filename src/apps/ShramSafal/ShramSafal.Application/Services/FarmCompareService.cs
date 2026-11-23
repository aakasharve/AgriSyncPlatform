using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Compare;
using ShramSafal.Domain.Dfes;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Inputs;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.Schedules;

namespace ShramSafal.Application.Services;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 (lane CMP-D2; D-68, D-83 = 1, D-86 note / R33, R34, R12, R10, R28, P4, P11) - the farm's
/// तुलना worked out on the server. Thin client: the numbers are the one engine's (<see cref="ScheduleFollowEngine"/>), computed here from the days
/// the schedules STORE and the records of the plot's CURRENT season; the phone only draws them.
/// <list type="bullet">
/// <item><b>Who</b>: the primary account holder, or a seat that holds <see cref="FarmAuthority.SeeCompare"/> (<see cref="Gate"/>). A Worker can never
/// hold it. A seat that is no member of the farm, a waiting or paused seat: <c>Forbidden</c> (E4: one answer for a farm he cannot open and a farm that
/// does not exist). A chosen-plots seat gets his plots only (MU-4).</item>
/// <item><b>Per plot</b> (current season): the stage windows come from the मुख्य schedule (R28); then ONE <c>Follow</c> over every followed schedule and
/// those windows; each schedule counts from its own day 0 (its <c>reference_date</c>, else the season's start). In the trial only today's stage is
/// counted (R10, <see cref="PlotPlanningState.TrialStage"/>); after the trial with nothing followed (<see cref="PlotPlanningState.NeedsSchedule"/>) nothing
/// is counted, and the read never refuses a record (D-83 = 1). An ahead stage is null (P4). Counts attach to the stage they were computed for, by
/// POSITION in the मुख्य schedule's windows - never by the stage's name (two stages may share one).</item>
/// <item><b>Hidden records (PRV, D-26/D-68)</b>: a record kept from the reader counts as DONE (he is never told to repeat it) and is never listed, quoted
/// or linked. Own work and not-recognised items of such a record are left out. An order note is kept ONLY when it is the same note with and without the
/// records the reader may not see: its days would otherwise reveal a hidden record's day. Money: a record that states money keeps its words from a
/// reader who does not hear wages (D-66).</item>
/// <item><b>Cost (P001)</b>: the farm-wide reads are made ONCE for the farm (<see cref="ScheduleRequirement.FactsForFarmAsync"/>; one read of every log
/// of every plot; one money-word check for every record that needs it). Each plot with a season costs at most TWO more commands: its season's row and
/// that season's tasks (<see cref="IShramSafalRepository.GetExecutedTasksByCropCycleIdAsync"/>).</item>
/// <item><b>Reasons (CMP-D3, "का केलं")</b>: the reason kept on an own-work item is read in ONE read for the whole farm
/// (<see cref="ILogPracticeReasonStore.GetForLogsAsync"/>; none at all when no plot has own work), never one per plot. It is served only with an item the reader may
/// see (a hidden record is never listed, so its reason never is). Its KIND is always given; its WORDS are withheld (null) from a reader who may not hear a
/// record that states money, or words that state it themselves, unless he wrote them (D-66 / D-69, <see cref="MoneyMention"/>).</item>
/// </list>
/// Doses are not compared. No quantity, no amber, no "differed" - a record is yes or no (R33).
/// </summary>
/// <remarks>
/// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (slice 6, "नोंद and तुलना close the loop"; approved spec SM-12) - a plan made from a work of his own schedule
/// and completed WITH a record counts that record against exactly that work (<see cref="ScheduleTaskLines.Links"/>; words only for the rest). A schedule in the task
/// format counts its "after" and "when seen" works once their date is known, and keeps the rest as words under their stage or "stage unknown"
/// (<see cref="ScheduleTaskLines.Lines"/>). An own schedule still being built is its OWN row (<see cref="OwnBuildingCompareDto"/>) counted in the मुख्य stages,
/// which do not change; once made main it is a followed schedule like any other. A stage that ends on a sign stays open past its expected end until the next
/// stage begins (<see cref="ScheduleDefinitionMapper.StageHolding"/>), as the stage line holds it. Cost: the farm's own works and their plans are read ONCE for the
/// farm (none at all when it has no own work), the answers about signs once per plot-season that has own works, and each followed version in the task format
/// once with its tasks.
/// </remarks>
public sealed class FarmCompareService(
    IShramSafalRepository repository,
    ScheduleRequirement requirement,
    IClock clock,
    ILogPracticeReasonStore reasons,
    IOwnScheduleStore ownStore,
    IScheduleFeedStore feedStore)
{
    private static readonly string[] PartOrder = ["irrigation", "nutrition", "spray", "work"];

    /// <summary>
    /// The one rule for every compare read: the primary account holder, or a seat that holds <see cref="FarmAuthority.SeeCompare"/> now.
    /// A Worker label can never hold it (<see cref="FarmAuthorities.CanBeHeldBy"/>), a paused or waiting seat holds nothing, no standing holds nothing.
    /// </summary>
    public static bool Gate(FarmAccess? access, DateTime atUtc) => FarmCompareGate.Gate(access, atUtc);

    /// <summary>The same rule for a route that names only a season (the two old compare routes): load his standing on the farm, then <see cref="Gate"/>.</summary>
    public static async Task<bool> MayAsync(
        IShramSafalRepository repository, Guid farmId, Guid userId, DateTime atUtc, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(repository);
        if (farmId == Guid.Empty || userId == Guid.Empty)
        {
            return false;
        }

        return Gate(await repository.GetFarmAccessForUserAsync(farmId, userId, ct), atUtc);
    }

    public async Task<Result<FarmCompareDto>> ForFarmAsync(Guid farmId, Guid callerUserId, CancellationToken ct = default)
    {
        var now = clock.UtcNow;
        var access = farmId == Guid.Empty || callerUserId == Guid.Empty
            ? null
            : await repository.GetFarmAccessForUserAsync(farmId, callerUserId, ct);
        var scope = FarmReadScope.Of(farmId, access, now);
        if (scope is null || !Gate(access, now))
        {
            return Result.Failure<FarmCompareDto>(ShramSafalErrors.Forbidden);
        }

        var visibility = await RecordVisibility.ForFarmAsync(repository, farmId, callerUserId, now, ct);
        var today = FarmLocalDay.From(now);
        var plots = (await repository.GetPlotsByFarmIdAsync(farmId, ct))
            .Where(p => scope.CoversPlot(p.Id))
            .OrderBy(p => p.Id)
            .ToList();

        // P001: every farm-wide read once for the farm, then in memory per plot.
        var gathered = await requirement.FactsForFarmAsync(farmId, plots.Select(p => p.Id).ToList(), callerUserId, ct);
        if (!gathered.IsSuccess)
        {
            return Result.Failure<FarmCompareDto>(gathered.Error);
        }

        // Pass 1 (in memory): what each plot with a season follows and which windows it counts; then the season's tasks for the plots that count.
        var plans = new List<PlotPlan>();
        foreach (var plot in plots)
        {
            if (Prepare(gathered.Value[plot.Id], today) is { } plan)
            {
                plans.Add(plan);
            }
        }

        // slice 6: the farm's own works and the plans made from them (ONE read each, none without own work), each followed version in the task format with its
        // tasks, and the answers about signs of each plot-season that has own works.
        var loops = await LoopsAsync(farmId, plans, ct);

        var tasksByPlot = new Dictionary<Guid, IReadOnlyList<LogTask>>();
        foreach (var plan in plans.Where(p => p.Counts))
        {
            tasksByPlot[plan.PlotId] = await repository.GetExecutedTasksByCropCycleIdAsync(plan.Season.CycleId, ct);
        }

        // ONE read of every log of every plot (their days, disputes and makers).
        var logIds = tasksByPlot.Values.SelectMany(t => t).Select(t => t.DailyLogId).Distinct().ToList();
        var logs = logIds.Count == 0
            ? new Dictionary<Guid, DailyLog>()
            : (await repository.GetDailyLogsForFarmByIdsAsync(new FarmId(farmId), logIds, ct)).ToDictionary(l => l.Id);

        // Pass 2 (in memory): count, filter by what the reader may see, build each plot's answer with its own work still pending the money check.
        var drafts = plans
            .Select(plan => Finish(plan, loops.Of(plan.PlotId), tasksByPlot.GetValueOrDefault(plan.PlotId) ?? [], logs, scope, visibility, callerUserId, today))
            .ToList();

        // ONE money-word check for every record whose words may be withheld (D-66): not his own, he does not hear wages.
        var withheld = await WithheldRecordsAsync(farmId, drafts, scope, callerUserId, ct);

        // CMP-D3: ONE read of the reasons of every own-work record of the farm (none when there is no own work), then in memory.
        var reasonsOf = await ReasonsAsync(drafts, withheld, scope, callerUserId, ct);

        var result = drafts.Select(d => d.Build(withheld, reasonsOf)).ToList();
        return Result.Success(new FarmCompareDto(now, result, new RecogniserVersionsDto(WorkVocabulary.Version, InputCatalog.Version)));
    }

    /// <summary>What one plot follows and which windows it counts, from the facts alone (no record is read).</summary>
    internal sealed record PlotPlan(
        Guid PlotId,
        PlanningSeason Season,
        PlotPlanningState State,
        ScheduleSubscription? Main,
        DateOnly MainDayZero,
        IReadOnlyList<StageDefinition> OrderedStages,
        IReadOnlyList<StageWindow> Windows,
        int? OnlyIndex,
        IReadOnlyList<(ScheduleSubscription Sub, ScheduleTemplateDto Template, ScheduleDefinition Def)> Definitions,
        IReadOnlyList<CompareStageDto> Stages,
        bool Counts);

    internal static PlotPlan? Prepare(PlanningFacts facts, DateOnly today)
    {
        if (facts.Season is not { } season)
        {
            return null; // no crop season: nothing to compare
        }

        var state = ScheduleRequirement.Decide(facts);
        var followed = ScheduleRequirement.FollowedNow(facts, season);
        var byId = facts.Listing.GroupBy(t => t.Id).ToDictionary(g => g.Key, g => g.First());
        var main = MainSchedule.Pick(followed, MainScheduleFactsReader.FromListing(facts.Listing), facts.PlotFarmOwnerUserId);

        var mainDayZero = main?.ReferenceDate ?? season.StartDate;
        ScheduleDefinition? mainDef = main is not null && byId.TryGetValue(main.ScheduleTemplateId.Value, out var mainTemplate)
            ? ScheduleDefinitionMapper.From(mainTemplate)
            : null;
        var orderedStages = mainDef?.Stages.OrderBy(s => s.StartDay).ThenBy(s => s.EndDay).ToList() ?? [];
        var windows = mainDef is null ? new List<StageWindow>() : ScheduleFollowEngine.StageWindows(mainDef, mainDayZero).ToList();

        // slice 6: a stage that ends on a sign stays open past its expected end until the next stage begins (the stage line's own rule): its window reaches today.
        if (mainDef is not null && ScheduleDefinitionMapper.StageHolding(mainDef, mainDayZero, today) is { } holding)
        {
            var at = windows.FindIndex(w => w.Name == holding.Window.Name && w.From == holding.Window.From);
            if (at >= 0 && holding.Window.To > windows[at].To)
            {
                windows[at] = holding.Window;
            }
        }

        var stages = windows
            .Select((w, i) =>
            {
                var current = w.From <= today && today <= w.To;
                var passed = w.To < today;
                return new CompareStageDto(
                    w.Name,
                    passed ? "passed" : current ? "current" : "ahead",
                    orderedStages[i].StartDay,
                    orderedStages[i].EndDay,
                    current ? w.To.DayNumber - today.DayNumber : null);
            })
            .ToList();

        var definitions = followed
            .OrderBy(s => s.Origin == ScheduleOrigin.Own ? 1 : 0)
            .ThenBy(s => s.Slot is { } slot ? (int)slot : int.MaxValue)
            .ThenBy(s => s.AdoptedAtUtc)
            .ThenBy(s => s.Id)
            .Where(s => byId.ContainsKey(s.ScheduleTemplateId.Value)) // a schedule he may not read is never described
            .Select(s => (Sub: s, Template: byId[s.ScheduleTemplateId.Value], Def: ScheduleDefinitionMapper.From(byId[s.ScheduleTemplateId.Value])))
            .ToList();

        // D-83 = 1: after the trial with nothing followed nothing is counted. Nor is anything without a stored मुख्य stage list. In the trial
        // only today's stage is (R10); no stored today's stage, nothing.
        int? onlyIndex = null;
        var counts = !state.NeedsSchedule && windows.Count > 0;
        if (counts && state.InTrial)
        {
            var at = state.TrialStage is { } trial ? orderedStages.FindIndex(s => s == trial) : -1;
            if (at < 0)
            {
                counts = false;
            }
            else
            {
                onlyIndex = at;
            }
        }

        return new PlotPlan(facts.PlotId, season, state, main, mainDayZero, orderedStages, windows, onlyIndex, definitions, stages, counts);
    }

    private sealed record Pending(DailyLog Log, Loaded Rec, OwnWorkItem? Own, NotRecognisedItem? NotRecognised);

    /// <summary>One plot's answer, built except for the words that money may withhold.</summary>
    private sealed record Draft(PlotCompareDto Shell, IReadOnlyList<Pending> Pendings, int MainDayZero)
    {
        public PlotCompareDto Build(IReadOnlySet<Guid> withheld, IReadOnlyDictionary<(Guid LogId, string WorkKey), LogReasonDto> reasonsOf)
        {
            var own = new List<OwnWorkDto>();
            var notRecognised = new List<NotRecognisedDto>();
            foreach (var p in Pendings)
            {
                var hide = withheld.Contains(p.Log.Id);
                var day = p.Rec.Work.WorkDate.DayNumber - MainDayZero;
                if (p.Own is { } item)
                {
                    var identity = WorkRecogniser.Recognise(p.Rec.Work.ActivityType);
                    var workKey = CompareWorkKey.Of(identity);
                    own.Add(new OwnWorkDto(
                        p.Log.Id,
                        workKey,
                        day,
                        item.StageName,
                        identity?.Part.ToString().ToLowerInvariant() ?? "work",
                        hide ? null : p.Rec.Work.ActivityType.Trim(),
                        hide ? [] : item.MatchedWords,
                        reasonsOf.GetValueOrDefault((p.Log.Id, workKey))));
                }
                else if (p.NotRecognised is { } missed)
                {
                    notRecognised.Add(new NotRecognisedDto(
                        p.Log.Id, "unrecognised", day, missed.StageName, hide ? null : p.Rec.Work.ActivityType.Trim()));
                }
            }

            return Shell with { OwnWork = own, NotRecognised = notRecognised };
        }
    }

    private static Draft Finish(
        PlotPlan plan, SeasonLoop loop, IReadOnlyList<LogTask> tasks, IReadOnlyDictionary<Guid, DailyLog> logs,
        FarmReadScope scope, RecordVisibility visibility, Guid callerUserId, DateOnly today)
    {
        var shell = new PlotCompareDto(
            plan.PlotId, plan.Season.CycleId, plan.State.InTrial, today.DayNumber - plan.MainDayZero.DayNumber,
            plan.OrderedStages.Count == 0 ? null : plan.OrderedStages.Max(s => s.EndDay), plan.Stages, [], [], []);
        var mainDayZero = plan.MainDayZero.DayNumber;

        var building = loop.Building(plan);
        if (!plan.Counts)
        {
            return new Draft(
                shell with
                {
                    Schedules = plan.Definitions.Select(d => Describe(d.Sub, d.Template, plan.Main, [], [])).ToList(),
                    OwnBuilding = building is null ? null : new OwnBuildingCompareDto(building.Count, new StageCompareCountsDto?[plan.Windows.Count], null),
                },
                [],
                mainDayZero);
        }

        // slice 6: what really happened to each own work (recorded, sign seen) and which record each completed plan names.
        var logDays = logs.Values.ToDictionary(l => l.Id, l => l.LogDate);
        var facts = ScheduleTaskLines.Facts(loop.Plans, logDays, loop.Events);
        var links = ScheduleTaskLines.Links(loop.Plans, tasks, logDays);
        var records = LoadRecords(tasks, logs, links);
        var recorded = records.Select(r => r.Work).ToList();
        var follow = plan.Definitions
            .Select(d => new FollowedSchedule(d.Sub.Slot ?? -1, loop.WithTasks(d.Sub, d.Template, d.Def, d.Sub.ReferenceDate ?? plan.Season.StartDate, facts), d.Sub.ReferenceDate ?? plan.Season.StartDate))
            .ToList();
        var ownDayZero = plan.Definitions.Select(d => d.Sub).Where(s => s.ReferenceDate is not null).OrderBy(s => s.Slot ?? short.MaxValue).FirstOrDefault()?.ReferenceDate
            ?? plan.Season.StartDate;
        if (building is not null)
        {
            var lines = ScheduleTaskLines.Lines(building, new HashSet<string>(), plan.OrderedStages, ownDayZero, facts, stageZeroMayBeOpen: true);
            follow.Add(new FollowedSchedule(-2, new ScheduleDefinition(Guid.Empty, string.Empty, [], lines), ownDayZero));
        }

        StageWindow? only = plan.OnlyIndex is { } at ? plan.Windows[at] : null;
        var full = ScheduleFollowEngine.Follow(follow, plan.Windows, recorded, today, only);

        // What the reader may see: hidden by audience or place, or someone else's record for an own-records-only seat.
        var seen = records.Select(r => MaySee(r.Log, visibility, scope, callerUserId)).ToList();
        PlotFollowResult visible = full;
        if (seen.Any(s => !s))
        {
            var kept = records.Where((_, i) => seen[i]).Select(r => r.Work).ToList();
            visible = ScheduleFollowEngine.Follow(follow, plan.Windows, kept, today, only);
        }

        var schedules = new List<ScheduleCompareDto>(plan.Definitions.Count);
        for (var s = 0; s < plan.Definitions.Count; s++)
        {
            var (sub, template, def) = plan.Definitions[s];
            var counts = CountsByStage(plan, full.Schedules[s].Stages);

            // An order note is kept only when it is the very same note without the records he may not see.
            var notes = full.Schedules[s].Order
                .Where(n => visible.Schedules[s].Order.Any(v =>
                    v.FirstActivityId == n.FirstActivityId && v.ThenActivityId == n.ThenActivityId
                    && v.FirstDay == n.FirstDay && v.ThenDay == n.ThenDay))
                .Select(n => new OrderNoteDto(
                    def.Activities.First(a => a.ActivityId == n.FirstActivityId).Title,
                    def.Activities.First(a => a.ActivityId == n.ThenActivityId).Title,
                    n.FirstDay is { } fd ? fd.DayNumber - plan.MainDayZero.DayNumber : null,
                    n.ThenDay.DayNumber - plan.MainDayZero.DayNumber))
                .ToList();

            schedules.Add(Describe(sub, template, plan.Main, counts, notes, full.Schedules[s].StageUnknown is { } unknown ? ToCounts(unknown) : null));
        }

        OwnBuildingCompareDto? ownRow = null;
        if (building is not null)
        {
            var own = full.Schedules[plan.Definitions.Count];
            ownRow = new OwnBuildingCompareDto(building.Count, CountsByStage(plan, own.Stages), own.StageUnknown is { } unknown ? ToCounts(unknown) : null);
        }

        var pendings = new List<Pending>();
        foreach (var item in full.OwnWork.Where(o => seen[o.RecordIndex]))
        {
            pendings.Add(new Pending(records[item.RecordIndex].Log!, records[item.RecordIndex], item, null));
        }

        foreach (var item in full.NotRecognised.Where(o => seen[o.RecordIndex]))
        {
            pendings.Add(new Pending(records[item.RecordIndex].Log!, records[item.RecordIndex], null, item));
        }

        return new Draft(shell with { Schedules = schedules, OwnBuilding = ownRow }, pendings, mainDayZero);
    }

    /// <summary>One schedule's counts lined up with the plot's stages: by POSITION in the windows, never by the stage's name (P008); an ahead stage carries none.</summary>
    private static StageCompareCountsDto?[] CountsByStage(PlotPlan plan, IReadOnlyList<StageCount> computed)
    {
        var counts = new StageCompareCountsDto?[plan.Windows.Count];
        if (plan.OnlyIndex is { } onlyAt)
        {
            // the engine counted ONE window: the one asked for
            if (computed.Count > 0 && computed[0].State != StageState.Ahead)
            {
                counts[onlyAt] = ToCounts(computed[0]);
            }
        }
        else
        {
            for (var k = 0; k < computed.Count && k < counts.Length; k++)
            {
                if (computed[k].State != StageState.Ahead)
                {
                    counts[k] = ToCounts(computed[k]);
                }
            }
        }

        return counts;
    }

    private sealed record Loaded(RecordedWork Work, DailyLog? Log);

    /// <summary>
    /// This season's tasks and the days of their records. A task whose log is not on this farm's list falls back to the farm-local day it was
    /// recorded on and is never visible to a reader (no record to judge, so none to show).
    /// </summary>
    private static List<Loaded> LoadRecords(
        IReadOnlyList<LogTask> tasks, IReadOnlyDictionary<Guid, DailyLog> logs, IReadOnlyDictionary<Guid, string> links) =>
        tasks
            .OrderBy(t => t.OccurredAtUtc)
            .ThenBy(t => t.Id)
            .Select(t => logs.TryGetValue(t.DailyLogId, out var log)
                ? new Loaded(new RecordedWork(t.ActivityType, log.LogDate, t.ExecutionStatus,
                    log.CurrentVerificationStatus == VerificationStatus.Disputed, links.GetValueOrDefault(t.Id)), log)
                : new Loaded(new RecordedWork(t.ActivityType, FarmLocalDay.From(t.OccurredAtUtc), t.ExecutionStatus, ForTaskKey: links.GetValueOrDefault(t.Id)), null))
            .ToList();

    /// <summary>slice 6: what the loop needs for the whole farm, read once (see the remarks on the class).</summary>
    private async Task<FarmLoops> LoopsAsync(Guid farmId, IReadOnlyList<PlotPlan> plans, CancellationToken ct)
    {
        if (plans.Count == 0)
        {
            return FarmLoops.None;
        }

        var items = await ownStore.GetOfFarmsAsync([farmId], ct);
        var plansOfItems = items.Count == 0 ? [] : await feedStore.GetPlansOfItemsAsync(items.Select(i => i.Id).ToList(), ct);

        var versions = new Dictionary<Guid, ScheduleTemplate>();
        foreach (var id in plans.SelectMany(p => p.Definitions).Where(d => d.Template.HasTaskFormat == true).Select(d => d.Template.Id).Distinct())
        {
            if (await repository.GetScheduleTemplateWithTasksByIdAsync(id, ct) is { } version)
            {
                versions[id] = version;
            }
        }

        var seasons = new Dictionary<Guid, SeasonLoop>();
        foreach (var plan in plans)
        {
            var mine = items.Where(i => i.PlotId == plan.PlotId && i.CropCycleId == plan.Season.CycleId && (Guid)i.FarmId == farmId).ToList();
            var ids = mine.Select(i => i.Id).ToHashSet();
            var events = mine.Count == 0 ? [] : await feedStore.GetEventsAsync(plan.PlotId, plan.Season.CycleId, ct);
            seasons[plan.PlotId] = new SeasonLoop(
                mine, plansOfItems.Where(p => p.OwnItemId is { } id && ids.Contains(id)).ToList(), events, versions);
        }

        return new FarmLoops(seasons, versions);
    }

    private sealed record FarmLoops(IReadOnlyDictionary<Guid, SeasonLoop> Seasons, IReadOnlyDictionary<Guid, ScheduleTemplate> Versions)
    {
        public static readonly FarmLoops None = new(new Dictionary<Guid, SeasonLoop>(), new Dictionary<Guid, ScheduleTemplate>());

        public SeasonLoop Of(Guid plotId) => Seasons.GetValueOrDefault(plotId) ?? new SeasonLoop([], [], [], Versions);
    }

    /// <summary>One plot-season's own works, the plans made from them, the answers about their signs, and the farm's followed versions in the task format.</summary>
    private sealed record SeasonLoop(
        IReadOnlyList<OwnScheduleItem> Items,
        IReadOnlyList<PlannedWork> Plans,
        IReadOnlyList<ScheduleTaskEvent> Events,
        IReadOnlyDictionary<Guid, ScheduleTemplate> Versions)
    {
        /// <summary>
        /// The own schedule still being built, as task sources: its active works, when none of the schedules the plot follows was frozen from them (once made
        /// main it is a followed schedule like any other). Null when there is none.
        /// </summary>
        public IReadOnlyList<ScheduleTaskSource>? Building(PlotPlan plan)
        {
            var active = Items.Where(i => i.State == OwnScheduleItemState.Active).ToList();
            if (active.Count == 0)
            {
                return null;
            }

            var followed = plan.Definitions.Select(d => d.Template.Id).ToHashSet();
            return Items.Any(i => i.MainVersionId is { } v && followed.Contains(v))
                ? null
                : active.Select(i => new ScheduleTaskSource(i.Id, i.Content)).ToList();
        }

        /// <summary>
        /// A followed version in the task format, with its works added as lines: the works it already wrote as stored activities take their task key; the
        /// others become lines of their own. Only a version frozen from HIS works (his own place) reads his plans' links and sign answers (their keys are its
        /// keys); any other version counts its extra lines by words (a work taken from it is the next slice).
        /// </summary>
        public ScheduleDefinition WithTasks(
            ScheduleSubscription sub, ScheduleTemplateDto template, ScheduleDefinition def, DateOnly dayZero, IReadOnlyDictionary<string, ScheduleTaskFacts> facts)
        {
            if (!Versions.TryGetValue(template.Id, out var version) || version.Tasks.Count == 0)
            {
                return def;
            }

            var his = sub.Origin == ScheduleOrigin.Own;
            var keyOf = version.ProjectedTaskKeyByActivity();
            var stages = version.Stages.OrderBy(s => s.StartDay).ThenBy(s => s.EndDay).ToList();
            var extra = ScheduleTaskLines.Lines(
                version.Tasks.Select(t => new ScheduleTaskSource(t.Id, t.Content)).ToList(),
                keyOf.Values.ToHashSet(StringComparer.Ordinal),
                stages,
                dayZero,
                his ? facts : new Dictionary<string, ScheduleTaskFacts>(),
                stageZeroMayBeOpen: his);
            var activities = def.Activities
                .Select(a => his && keyOf.TryGetValue(a.ActivityId, out var key) ? a with { TaskKey = key } : a)
                .Concat(his ? extra : extra.Select(a => a with { TaskKey = null }))
                .ToList();
            return def with { Activities = activities };
        }
    }

    private static bool MaySee(DailyLog? log, RecordVisibility visibility, FarmReadScope scope, Guid readerUserId) =>
        log is not null
        && visibility.MaySeeLog(log.Id)
        && scope.MayReadRecordOf(readerUserId, log.OperatorUserId.Value);

    /// <summary>
    /// D-66: the records whose words stay with the holder - listed to this reader, not his own, he does not hear wages, and the record states
    /// money. All the candidates are checked in ONE batch. A candidate the store cannot return is withheld (fail closed).
    /// </summary>
    private async Task<IReadOnlySet<Guid>> WithheldRecordsAsync(
        Guid farmId, IReadOnlyList<Draft> drafts, FarmReadScope scope, Guid readerUserId, CancellationToken ct)
    {
        if (MoneyMention.HearsMoneyWords(scope))
        {
            return new HashSet<Guid>();
        }

        var candidates = drafts
            .SelectMany(d => d.Pendings)
            .Select(p => p.Log)
            .Where(l => l.OperatorUserId.Value != readerUserId)
            .DistinctBy(l => l.Id)
            .Select(l => l.Id)
            .ToList();
        if (candidates.Count == 0)
        {
            return new HashSet<Guid>();
        }

        var whole = await repository.GetDailyLogsWithTasksForFarmByIdsAsync(new FarmId(farmId), candidates, ct);
        var mentioning = await MoneyMention.InStoredRecordsAsync(repository, whole.ToList(), ct);
        var found = whole.Select(l => l.Id).ToHashSet();
        mentioning.UnionWith(candidates.Where(id => !found.Contains(id)));
        return mentioning;
    }

    /// <summary>
    /// CMP-D3: the latest reason of every own-work item listed to this reader, from ONE read (zero commands when nothing is listed). The words are
    /// withheld (null, the kind kept) when the record is one whose words stay with the holder (<paramref name="withheld"/>, D-66) or the words state money
    /// themselves and he does not hear wages - and never from the person who wrote them.
    /// </summary>
    private async Task<IReadOnlyDictionary<(Guid LogId, string WorkKey), LogReasonDto>> ReasonsAsync(
        IReadOnlyList<Draft> drafts, IReadOnlySet<Guid> withheld, FarmReadScope scope, Guid readerUserId, CancellationToken ct)
    {
        var listed = drafts
            .SelectMany(d => d.Pendings)
            .Where(p => p.Own is not null)
            .Select(p => p.Log.Id)
            .Distinct()
            .ToList();
        var answer = new Dictionary<(Guid LogId, string WorkKey), LogReasonDto>();
        if (listed.Count == 0)
        {
            return answer;
        }

        var hears = MoneyMention.HearsMoneyWords(scope);
        var latest = (await reasons.GetForLogsAsync(listed, ct))
            .GroupBy(r => (r.DailyLogId, r.WorkKey))
            .Select(g => g.OrderBy(r => r.CreatedAtUtc).ThenBy(r => r.Id).Last());
        foreach (var r in latest)
        {
            var mine = r.AuthorUserId.Value == readerUserId;
            var keep = r.Words is null || mine || (!withheld.Contains(r.DailyLogId) && (hears || !MoneyMention.InText(r.Words)));
            answer[(r.DailyLogId, r.WorkKey)] = new LogReasonDto(
                LogReasonKindWire.ToWire(r.Kind), keep ? r.Words : null, keep && r.SaidByVoice);
        }

        return answer;
    }

    private static ScheduleCompareDto Describe(
        ScheduleSubscription sub, ScheduleTemplateDto template, ScheduleSubscription? main,
        IReadOnlyList<StageCompareCountsDto?> stages, IReadOnlyList<OrderNoteDto> order, StageCompareCountsDto? stageUnknown = null)
    {
        var isOwn = sub.Origin == ScheduleOrigin.Own;
        return new ScheduleCompareDto(
            sub.Id,
            template.Id,
            template.Name,
            isOwn ? null : template.Check,
            sub.Slot,
            (sub.Origin ?? ScheduleOrigin.Outside).ToString(),
            main is not null && sub.Id == main.Id,
            stages,
            order,
            stageUnknown);
    }

    private static StageCompareCountsDto ToCounts(StageCount count)
    {
        var parts = count.Activities
            .GroupBy(a => a.Part)
            .OrderBy(g => Array.IndexOf(PartOrder, g.Key) is var at && at < 0 ? int.MaxValue : at)
            .Select(g => new ComparePartDto(
                g.Key,
                g.Select(a => new CompareItemDto(a.ActivityId, a.Title, a.Asked, a.Done, a.NotYet, a.SaidNotDone, a.MoreThanAsked)).ToList()))
            .ToList();
        return new StageCompareCountsDto(
            count.Asked,
            count.Done,
            count.NotYet,
            count.Activities.Sum(a => a.SaidNotDone),
            count.Activities.Sum(a => a.MoreThanAsked),
            parts);
    }
}
