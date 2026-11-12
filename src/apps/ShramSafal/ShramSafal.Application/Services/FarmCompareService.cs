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
/// </list>
/// Doses are not compared. No quantity, no amber, no "differed" - a record is yes or no (R33).
/// </summary>
public sealed class FarmCompareService(
    IShramSafalRepository repository,
    ScheduleRequirement requirement,
    IClock clock)
{
    private static readonly string[] PartOrder = ["irrigation", "nutrition", "spray", "work"];

    /// <summary>
    /// The one rule for every compare read: the primary account holder, or a seat that holds <see cref="FarmAuthority.SeeCompare"/> now.
    /// A Worker label can never hold it (<see cref="FarmAuthorities.CanBeHeldBy"/>), a paused or waiting seat holds nothing, no standing holds nothing.
    /// </summary>
    public static bool Gate(FarmAccess? access, DateTime atUtc) =>
        FarmAccessPolicy.IsPrimaryAccountHolder(access) || FarmAccessPolicy.Holds(access, FarmAuthority.SeeCompare, atUtc);

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
            .Select(plan => Finish(plan, tasksByPlot.GetValueOrDefault(plan.PlotId) ?? [], logs, scope, visibility, callerUserId, today))
            .ToList();

        // ONE money-word check for every record whose words may be withheld (D-66): not his own, he does not hear wages.
        var withheld = await WithheldRecordsAsync(farmId, drafts, scope, callerUserId, ct);

        var result = drafts.Select(d => d.Build(withheld)).ToList();
        return Result.Success(new FarmCompareDto(now, result, new RecogniserVersionsDto(WorkVocabulary.Version, InputCatalog.Version)));
    }

    /// <summary>What one plot follows and which windows it counts, from the facts alone (no record is read).</summary>
    private sealed record PlotPlan(
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

    private static PlotPlan? Prepare(PlanningFacts facts, DateOnly today)
    {
        if (facts.Season is not { } season)
        {
            return null; // no crop season: nothing to compare
        }

        var state = ScheduleRequirement.Decide(facts);
        var followed = ScheduleRequirement.FollowedNow(facts, season);
        var byId = facts.Listing.GroupBy(t => t.Id).ToDictionary(g => g.Key, g => g.First());
        var main = MainSchedule.Pick(followed, MainScheduleFactsReader.FromListing(facts.Listing));

        var mainDayZero = main?.ReferenceDate ?? season.StartDate;
        ScheduleDefinition? mainDef = main is not null && byId.TryGetValue(main.ScheduleTemplateId.Value, out var mainTemplate)
            ? ScheduleDefinitionMapper.From(mainTemplate)
            : null;
        var orderedStages = mainDef?.Stages.OrderBy(s => s.StartDay).ThenBy(s => s.EndDay).ToList() ?? [];
        var windows = mainDef is null ? new List<StageWindow>() : ScheduleFollowEngine.StageWindows(mainDef, mainDayZero).ToList();

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
        public PlotCompareDto Build(IReadOnlySet<Guid> withheld)
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
                    own.Add(new OwnWorkDto(
                        p.Log.Id,
                        WorkKeyOf(identity),
                        day,
                        item.StageName,
                        identity?.Part.ToString().ToLowerInvariant() ?? "work",
                        hide ? null : p.Rec.Work.ActivityType.Trim(),
                        hide ? [] : item.MatchedWords,
                        null));
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
        PlotPlan plan, IReadOnlyList<LogTask> tasks, IReadOnlyDictionary<Guid, DailyLog> logs,
        FarmReadScope scope, RecordVisibility visibility, Guid callerUserId, DateOnly today)
    {
        var shell = new PlotCompareDto(
            plan.PlotId, plan.Season.CycleId, plan.State.InTrial, today.DayNumber - plan.MainDayZero.DayNumber,
            plan.OrderedStages.Count == 0 ? null : plan.OrderedStages.Max(s => s.EndDay), plan.Stages, [], [], []);
        var mainDayZero = plan.MainDayZero.DayNumber;

        if (!plan.Counts)
        {
            return new Draft(
                shell with { Schedules = plan.Definitions.Select(d => Describe(d.Sub, d.Template, plan.Main, [], [])).ToList() },
                [],
                mainDayZero);
        }

        var records = LoadRecords(tasks, logs);
        var recorded = records.Select(r => r.Work).ToList();
        var follow = plan.Definitions
            .Select(d => new FollowedSchedule(d.Sub.Slot ?? -1, d.Def, d.Sub.ReferenceDate ?? plan.Season.StartDate))
            .ToList();
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
            var counts = new StageCompareCountsDto?[plan.Windows.Count];
            var computed = full.Schedules[s].Stages;
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
                // the engine counts every window, in the windows' own order: counts attach by position, never by the stage's name (P008)
                for (var k = 0; k < computed.Count && k < counts.Length; k++)
                {
                    if (computed[k].State != StageState.Ahead)
                    {
                        counts[k] = ToCounts(computed[k]);
                    }
                }
            }

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

            schedules.Add(Describe(sub, template, plan.Main, counts, notes));
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

        return new Draft(shell with { Schedules = schedules }, pendings, mainDayZero);
    }

    private sealed record Loaded(RecordedWork Work, DailyLog? Log);

    /// <summary>
    /// This season's tasks and the days of their records. A task whose log is not on this farm's list falls back to the farm-local day it was
    /// recorded on and is never visible to a reader (no record to judge, so none to show).
    /// </summary>
    private static List<Loaded> LoadRecords(IReadOnlyList<LogTask> tasks, IReadOnlyDictionary<Guid, DailyLog> logs) =>
        tasks
            .OrderBy(t => t.OccurredAtUtc)
            .ThenBy(t => t.Id)
            .Select(t => logs.TryGetValue(t.DailyLogId, out var log)
                ? new Loaded(new RecordedWork(t.ActivityType, log.LogDate, t.ExecutionStatus,
                    log.CurrentVerificationStatus == VerificationStatus.Disputed), log)
                : new Loaded(new RecordedWork(t.ActivityType, FarmLocalDay.From(t.OccurredAtUtc), t.ExecutionStatus), null))
            .ToList();

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

    private static string WorkKeyOf(WorkIdentity? identity)
    {
        if (identity is null)
        {
            return "unrecognised";
        }

        var part = identity.Part.ToString().ToLowerInvariant();
        var detail = identity.Role ?? identity.NutrientKey ?? identity.OperationKey;
        return detail is null ? part : $"{part}:{detail}";
    }

    private static ScheduleCompareDto Describe(
        ScheduleSubscription sub, ScheduleTemplateDto template, ScheduleSubscription? main,
        IReadOnlyList<StageCompareCountsDto?> stages, IReadOnlyList<OrderNoteDto> order)
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
            order);
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
