using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.Extensions.Logging;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Compare;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Compliance;
using ShramSafal.Domain.Dfes;
using ShramSafal.Domain.Farms;
using ShramSafal.Domain.Logs;
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.Tests;

namespace ShramSafal.Application.UseCases.Planning.GetAttentionBoard;

public sealed class GetAttentionBoardHandler(
    IShramSafalRepository repository,
    ITestInstanceRepository testInstanceRepository,
    IComplianceSignalRepository complianceSignalRepository,
    IClock clock,
    ILogger<GetAttentionBoardHandler> logger,
    // spec: plr-d10 lane ATT-W (R29) - optional so every existing construction compiles and a host that does not register it keeps today's board.
    Services.ScheduleBoardSteps? scheduleBoardSteps = null)
{
    private static readonly TestInstanceStatus[] MissingStatuses =
    [
        TestInstanceStatus.Due,
        TestInstanceStatus.Overdue
    ];

    public async Task<Result<AttentionBoardDto>> HandleAsync(GetAttentionBoardQuery query, CancellationToken ct = default)
    {
        if (query.CallerUserId == Guid.Empty)
            return Result.Failure<AttentionBoardDto>(ShramSafalErrors.InvalidCommand);

        var asOf = query.AsOfUtc ?? clock.UtcNow;
        // spec: plr-d10 (I22) — "today" is the FARM's day (India time), not the UTC date: between 00:00 and 05:30
        // IST the UTC date is still yesterday, which made a step planned for today read as not yet due.
        var today = FarmLocalDay.From(asOf);

        // 1. Get all farmIds for the caller
        // lane MU-3 fix 1 (review item 12) — the board is the farm overview: only farms whose seat reads it
        // (FarmReadScope.SeeFarmOverview; a कामगार seat does not), every seat in ONE batched read.
        var memberFarmIds = await repository.GetFarmIdsForUserAsync(query.CallerUserId, ct);
        var accesses = await repository.GetFarmAccessesForUserAsync(query.CallerUserId, memberFarmIds, ct);
        var farmIds = memberFarmIds
            .Where(id => Services.FarmReadScope.Of(id, accesses.GetValueOrDefault(id), clock.UtcNow) is { SeeFarmOverview: true })
            .ToList();
        // spec: plr-d10 lane MU-4 (11.6) - and, for a chosen-plots seat, only the items about his plots.
        var plotScopes = farmIds.ToDictionary(id => id, id => Services.FarmReadScope.Of(id, accesses.GetValueOrDefault(id), clock.UtcNow));
        if (farmIds.Count == 0)
            return Result.Success(new AttentionBoardDto(asOf, Array.Empty<AttentionCardDto>(), Array.Empty<ScheduledWorkItemDto>()));

        var cards = new List<AttentionCardDto>();
        var scheduledWork = new List<ScheduledWorkItemDto>();

        // spec: plr-d10 lane PRV (founder D-26; fix pass 1, H3) — a planned step that work kept from him completed is DONE
        // for him too: the founder's own text, "the app must not simultaneously assign that hidden activity to someone who
        // cannot see it" (a member must never be told to repeat a private spray). So steps are matched against ALL the
        // recorded work, and only what is SHOWN is narrowed: the board names planned steps (plan text he already reads)
        // and counts; no record id, day, words, amounts or maker of a hidden record ever reaches it. Disputes he cannot
        // see are not counted for him.
        var visibility = await Services.RecordVisibility.ForFarmsAsync(repository, farmIds, query.CallerUserId, clock.UtcNow, ct);

        // spec: plr-d10 lane ATT-W (R29, path b) - the steps the followed schedules ask, read ONCE for the whole request (three reads in all,
        // none per plot). A plot with no Active subscription on its season reads its planned rows exactly as before (P11).
        var scheduleSource = scheduleBoardSteps is null
            ? Services.BoardScheduleSource.None
            : await scheduleBoardSteps.LoadAsync(farmIds, query.CallerUserId, ct);

        foreach (var farmId in farmIds)
        {
            var farm = await repository.GetFarmByIdAsync(farmId, ct);
            if (farm is null) continue;

            var plots = await repository.GetPlotsByFarmIdAsync(farmId, ct);

            // CEI Phase 2 §4.5 — pull Due/Overdue test instances for this farm and
            // bucket them per plot using only those whose planned due date has
            // arrived (≤ today).
            var missingByPlot = await GetMissingTestCountsByPlotAsync(new FarmId(farmId), today, ct);

            foreach (var plot in plots)
            {
                if (plotScopes.GetValueOrDefault(farmId) is not { } plotScope || !plotScope.CoversPlot(plot.Id))
                {
                    continue;
                }

                var cycles = await repository.GetCropCyclesByPlotIdAsync(plot.Id, ct);
                // Most recent cycle
                var latestCycle = cycles.OrderByDescending(c => c.StartDate).FirstOrDefault();
                if (latestCycle is null) continue;

                // Get planned activities and log tasks for this cycle
                var planned = await repository.GetPlannedActivitiesByCropCycleIdAsync(latestCycle.Id, ct);
                var executed = await repository.GetExecutedTasksByCropCycleIdAsync(latestCycle.Id, ct);

                // Filter out removed planned activities
                planned = planned.Where(p => !p.IsRemoved).ToList();

                // spec: plr-d10 (I22) — the plot's health is judged on the steps that were DUE, with the same
                // matching as the overdue count below (CompareEngine's thresholds, per kind of work). It used to
                // compare the whole season's plan — future steps included — against the work done so far by
                // exact names, so a freshly planned plot read "most planned activities are missing" (Critical).
                var stageName = latestCycle.Stage ?? "Unknown";
                HealthScore? health = null;

                // spec: plr-d10 (I22) — overdue = a step whose day has passed and that no recorded work met,
                // matched one-to-one by kind of work and by DATE (ScheduledWorkMatcher). It used to be one name
                // set over every task of the cycle: one "Spray" cleared every planned spray of the season.
                var overdueCount = 0;
                var plotSchedules = scheduleSource.For(plot.Id, latestCycle);
                if (plotSchedules is null)
                {
                    // No Active subscription on this season: today's board, exactly (P11).
                    if (planned.Any(p => p.PlannedDate <= today))
                    {
                        // spec: plr-d10 (I22) — the day each recorded task's WORK was done is its log's date, and a
                        // disputed log's work is not "done". Only this season's logs are read (this runs on every pull).
                        var logFacts = await LoadLogFactsAsync(new FarmId(farmId), executed, ct);
                        var statuses = ScheduledWorkMatcher.Match(planned, ToRecordedWork(executed, logFacts), today);
                        health = HealthOfDueSteps(statuses.Select(s => (s.Planned.ActivityName, s.State)));
                        foreach (var status in statuses.Where(s => s.State != ScheduledWorkState.Done))
                        {
                            if (status.State == ScheduledWorkState.Overdue) overdueCount++;
                            scheduledWork.Add(ItemOf(status, farmId, plot.Id, plot.Name, latestCycle.Id));
                        }
                    }
                }
                else
                {
                    // spec: plr-d10 lane ATT-W (R29, R35) - a plot with an Active subscription: the schedule steps are each followed schedule's
                    // stored days (a moved step on its moved day) plus the season's LOCALLY ADDED rows. The rows a template generated are NOT
                    // read (the schedule asks the same steps: no double count).
                    var local = planned.Where(p => p.IsLocallyAdded).ToList();
                    if (plotSchedules.Any(sch => sch.Steps.Any(st => st.Step.PlannedDate <= today)) || local.Any(p => p.PlannedDate <= today))
                    {
                        var logFacts = await LoadLogFactsAsync(new FarmId(farmId), executed, ct);
                        var recorded = ToRecordedWork(executed, logFacts);

                        // Proof ("शेवटची फवारणी ‹N› दिवसांपूर्वी") is read only from records this reader may see (PRV): a record kept from him
                        // clears a step for him, but its day never reaches him.
                        var scope = plotScopes[farmId]!;
                        var visibleRecorded = ToRecordedWork(
                            executed.Where(t => logFacts.TryGetValue(t.DailyLogId, out var f)
                                && visibility.MaySeeLog(t.DailyLogId)
                                && scope.MayReadRecordOf(query.CallerUserId, f.OperatorUserId)),
                            logFacts);

                        // Each followed schedule's steps are matched on their own (R35), then the open ones merge.
                        var perSchedule = plotSchedules
                            .Select(sch => (Schedule: sch, Statuses: ScheduledWorkMatcher.Match(sch.Steps.Select(st => st.Step), recorded, today)))
                            .ToList();
                        var localStatuses = ScheduledWorkMatcher.Match(local, recorded, today);

                        health = HealthOfDueSteps(
                            perSchedule.SelectMany(p => p.Statuses.Select(s => (s.Step.ActivityName, s.State)))
                                .Concat(localStatuses.Select(s => (s.Planned.ActivityName, s.State))));

                        foreach (var item in MergeOpenSteps(perSchedule, farmId, plot.Id, plot.Name, latestCycle.Id, visibleRecorded, today))
                        {
                            // the merged item counts once; a step due today is not overdue
                            if (item.ReasonKey != ScheduledReasonKey.DueToday) overdueCount++;
                            scheduledWork.Add(item);
                        }

                        foreach (var status in localStatuses.Where(s => s.State != ScheduledWorkState.Done))
                        {
                            if (status.State == ScheduledWorkState.Overdue) overdueCount++;
                            scheduledWork.Add(ItemOf(status, farmId, plot.Id, plot.Name, latestCycle.Id));
                        }
                    }
                }

                // Count disputes
                var disputeCount = await repository.GetDisputedLogCountForPlotAsync(plot.Id, ct);
                if (visibility.HiddenLogIds.Count > 0)
                {
                    var hiddenDisputes = (await repository.GetDailyLogsForFarmByIdsAsync(new FarmId(farmId), visibility.HiddenLogIds.ToList(), ct))
                        .Count(l => l.PlotId == plot.Id && l.CurrentVerificationStatus == VerificationStatus.Disputed);
                    disputeCount = Math.Max(0, disputeCount - hiddenDisputes);
                }

                // CEI Phase 2 §4.5 — missing tests on this plot
                var missingTestCount = missingByPlot.TryGetValue(plot.Id, out var mtc) ? mtc : 0;

                // Determine rank — applies missing-test elevation rules
                var rank = DetermineRank(health, overdueCount, disputeCount, missingTestCount);

                // CEI Phase 3 §4.6 — compliance signal elevation.
                // Sub-plan 03 Task 10: a repository failure here used to be
                // silently swallowed and produced an empty signals list,
                // which made the AttentionBoard tile under-elevate plots
                // with real compliance issues. We now log the failure so
                // it shows in ops dashboards.
                //
                // HONEST TRADE-OFF: this catch SOFT-DEGRADES locally — the
                // exception does NOT bubble to the caller, so when
                // PullSyncChangesHandler invokes us its outer catch never
                // fires and the response carries NO `AttentionBoard`
                // entry in DegradedComponents / X-Degraded. The reasoning:
                // we iterate compliance signals PER FARM, and a single
                // farm's repository hiccup shouldn't degrade the whole
                // AttentionBoard tile across all the caller's farms.
                // Cost: clients can't tell that one row had truncated
                // signals from the response payload alone (only ops can,
                // via logs / OTel events).
                //
                // If finer-grained surfacing matters, the right fix is to
                // expose a per-row `degradedSignals` flag on
                // AttentionBoardCardDto rather than to bubble the whole
                // tile. Filed inline as a future refinement; not a
                // build-blocker today.
                IReadOnlyList<ComplianceSignal> complianceSignals;
                try
                {
                    complianceSignals = await complianceSignalRepository.GetOpenForFarmAsync(
                        new FarmId(farmId), ct);
                }
                catch (Exception ex)
                {
                    logger.LogWarning(ex,
                        "GetAttentionBoard: ComplianceSignalRepository.GetOpenForFarmAsync threw {ExceptionType} for farm {FarmId}; soft-degrading signals to empty for this plot row (NOT bubbled to PullSync's AttentionBoard degraded surface — see comment above).",
                        ex.GetType().Name, farmId);
                    complianceSignals = Array.Empty<ComplianceSignal>();
                }

                // spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT2) - a wrong-mix alert whose evidence names a record kept
                // from him (its audience, his plots) is not his to read, exactly as the pull and the compliance door already
                // hold for every warning they send: no card, no id and no word of it reaches him. Asked of this rule's signals
                // only, so every other warning's card is exactly as it was.
                var plotSignals = complianceSignals
                    .Where(s => s.PlotId == plot.Id)
                    .Where(s => s.RuleCode != ComplianceRuleCode.InputMixNeverTogether || !visibility.MentionsHidden(s.PayloadJson))
                    .ToList();
                var openComplianceSignalCount = plotSignals.Count;
                ComplianceSignal? highestSeveritySignal = plotSignals
                    .OrderByDescending(s => (int)s.Severity)
                    .FirstOrDefault();

                // Elevate rank based on compliance severity
                if (highestSeveritySignal is not null)
                {
                    rank = highestSeveritySignal.Severity switch
                    {
                        ComplianceSeverity.Critical when rank > AttentionRank.Critical
                            => AttentionRank.Critical,
                        ComplianceSeverity.NeedsAttention when rank > AttentionRank.NeedsAttention
                            => AttentionRank.NeedsAttention,
                        _ => rank
                    };
                }

                // Only include non-Healthy plots (or plots with compliance signals)
                if (rank == AttentionRank.Healthy && openComplianceSignalCount == 0) continue;

                // If the only reason for inclusion is a compliance signal, we still include the plot
                if (rank == AttentionRank.Healthy && openComplianceSignalCount > 0)
                {
                    rank = AttentionRank.Watch;
                }

                var card = BuildCard(
                    farmId, farm.Name, plot.Id, plot.Name,
                    latestCycle.Id, stageName, rank,
                    health, overdueCount, disputeCount, missingTestCount,
                    openComplianceSignalCount, highestSeveritySignal, asOf);

                cards.Add(card);
            }
        }

        // Sort: rank asc (Critical first), then overdueCount desc, then farmName asc
        var sorted = cards
            .OrderBy(c => c.Rank)
            .ThenByDescending(c => c.OverdueTaskCount ?? 0)
            .ThenBy(c => c.FarmName)
            .ToList();

        // Most late first, then by farm and plot — the order the लक्ष द्या page lists them.
        var orderedWork = scheduledWork
            .OrderByDescending(w => w.DaysLate)
            .ThenBy(w => w.PlotName, StringComparer.Ordinal)
            .ThenBy(w => w.PlannedActivityId)
            .ToList();

        return Result.Success(new AttentionBoardDto(asOf, sorted, orderedWork));
    }

    /// <summary>
    /// CompareEngine's per-kind thresholds over the steps whose day has passed (plus today's that are already
    /// done). A step due today and not yet recorded is not a failure. <c>null</c> when nothing was due.
    /// </summary>
    private static HealthScore? HealthOfDueSteps(IEnumerable<(string ActivityName, ScheduledWorkState State)> statuses)
    {
        var judged = statuses.Where(s => s.State != ScheduledWorkState.DueToday).ToList();
        if (judged.Count == 0) return null;
        return CompareEngine.DetermineOverallHealth(judged
            .GroupBy(s => CompareEngine.Categorize(s.ActivityName), StringComparer.OrdinalIgnoreCase)
            .Select(g => CompareEngine.DetermineBucketHealth(g.Count(s => s.State == ScheduledWorkState.Done), g.Count()))
            .ToList());
    }

    /// <summary>One board item from a planned-activity row (today's shape; the lane ATT-W members stay null, only the reason key is set).</summary>
    private static ScheduledWorkItemDto ItemOf(ScheduledWorkStatus status, Guid farmId, Guid plotId, string plotName, Guid cropCycleId)
    {
        var missed = status.DaysLate > ScheduledWorkMatcher.OnTimeToleranceDays;
        return new ScheduledWorkItemDto(
            PlannedActivityId: status.Planned.Id,
            FarmId: farmId,
            PlotId: plotId,
            PlotName: plotName,
            CropCycleId: cropCycleId,
            ActivityName: status.Planned.ActivityName,
            Stage: status.Planned.Stage,
            PlannedDate: status.Planned.PlannedDate,
            DaysLate: status.DaysLate,
            IsMissed: missed,
            ReasonKey: ScheduledReasonKey.Of(status.DaysLate, missed));
    }

    /// <summary>
    /// spec: plr-d10 lane ATT-W (R13, R35) - the steps still OPEN after each followed schedule was matched on its own, as board items. Only open
    /// steps that are the same work (WORK-ID <c>Same</c>) on the same reminder day, asked by DIFFERENT schedules, merge into ONE item: the first
    /// schedule (the मुख्य one, then by place) is the item, the others' names go to <c>AlsoAskedBy</c>, and the item counts once in the overdue
    /// count. A step the record already met never merges and never appears.
    /// </summary>
    private static List<ScheduledWorkItemDto> MergeOpenSteps(
        IReadOnlyList<(Services.BoardScheduleSteps Schedule, IReadOnlyList<ScheduledStepStatus> Statuses)> perSchedule,
        Guid farmId,
        Guid plotId,
        string plotName,
        Guid cropCycleId,
        IReadOnlyList<RecordedWork> visibleRecorded,
        DateOnly today)
    {
        var groups = new List<(Services.BoardStep Primary, ScheduledStepStatus Status, List<string> Also, HashSet<Guid> Members)>();
        foreach (var (schedule, statuses) in perSchedule)
        {
            var byStepId = schedule.Steps.ToDictionary(b => b.Step.StepId);
            foreach (var status in statuses.Where(s => s.State != ScheduledWorkState.Done))
            {
                var step = byStepId[status.Step.StepId];
                // Fix round 1 (P007): a group takes at most ONE step of each schedule, so two same-work same-day steps in each of two schedules
                // make two groups that each name both schedules (never one group twice and the other not at all).
                var at = groups.FindIndex(g =>
                    !g.Members.Contains(step.SubscriptionId)
                    && g.Primary.Step.PlannedDate == step.Step.PlannedDate
                    && ScheduledWorkMatcher.SameStepWork(g.Primary.Step, step.Step));
                if (at >= 0)
                {
                    var also = groups[at].Also;
                    groups[at].Members.Add(step.SubscriptionId);
                    if (step.ScheduleName != groups[at].Primary.ScheduleName && !also.Contains(step.ScheduleName, StringComparer.Ordinal))
                    {
                        also.Add(step.ScheduleName);
                    }

                    continue;
                }

                groups.Add((step, status, new List<string>(), new HashSet<Guid> { step.SubscriptionId }));
            }
        }

        return groups
            .Select(g =>
            {
                var missed = g.Status.DaysLate > ScheduledWorkMatcher.OnTimeToleranceDays;
                return new ScheduledWorkItemDto(
                    PlannedActivityId: g.Primary.Step.StepId,
                    FarmId: farmId,
                    PlotId: plotId,
                    PlotName: plotName,
                    CropCycleId: cropCycleId,
                    ActivityName: g.Primary.Step.ActivityName,
                    Stage: g.Primary.StageName ?? string.Empty,
                    PlannedDate: g.Primary.Step.PlannedDate,
                    DaysLate: g.Status.DaysLate,
                    IsMissed: missed,
                    SubscriptionId: g.Primary.SubscriptionId,
                    ScheduleName: g.Primary.ScheduleName,
                    AlsoAskedBy: g.Also.Count == 0 ? null : g.Also,
                    LastSameWorkDate: ScheduledWorkMatcher.LastSameWorkDate(g.Primary.Step, visibleRecorded, today),
                    RepeatText: g.Primary.RepeatCode,
                    ReasonKey: ScheduledReasonKey.Of(g.Status.DaysLate, missed),
                    ActivityId: g.Primary.ActivityId,
                    OriginalDate: g.Primary.OriginalDate,
                    ScheduleDay: g.Primary.ScheduleDay);
            })
            .ToList();
    }

    /// <summary>The logs these tasks belong to, as the two facts the matcher needs: the work day and whether it is disputed.</summary>
    private async Task<Dictionary<Guid, (DateOnly WorkDate, bool Disputed, Guid OperatorUserId)>> LoadLogFactsAsync(
        FarmId farmId,
        IEnumerable<LogTask> executed,
        CancellationToken ct)
    {
        var ids = executed.Select(t => t.DailyLogId).Distinct().ToList();
        var logs = await repository.GetDailyLogsForFarmByIdsAsync(farmId, ids, ct);
        var facts = new Dictionary<Guid, (DateOnly, bool, Guid)>(logs.Count);
        foreach (var log in logs)
        {
            facts[log.Id] = (log.LogDate, log.CurrentVerificationStatus == VerificationStatus.Disputed, log.OperatorUserId.Value);
        }
        return facts;
    }

    /// <summary>
    /// Each recorded task on its log's day. A task whose log is not in the farm's list (a store that cannot
    /// say) falls back to the farm-local day it was recorded on, never to "today".
    /// </summary>
    private static List<RecordedWork> ToRecordedWork(
        IEnumerable<LogTask> executed,
        IReadOnlyDictionary<Guid, (DateOnly WorkDate, bool Disputed, Guid OperatorUserId)> logFacts) =>
        executed
            .Select(t => logFacts.TryGetValue(t.DailyLogId, out var f)
                ? new RecordedWork(t.ActivityType, f.WorkDate, t.ExecutionStatus, f.Disputed)
                : new RecordedWork(t.ActivityType, FarmLocalDay.From(t.OccurredAtUtc), t.ExecutionStatus))
            .ToList();

    private async Task<Dictionary<Guid, int>> GetMissingTestCountsByPlotAsync(
        FarmId farmId,
        DateOnly today,
        CancellationToken ct)
    {
        var instances = await testInstanceRepository
            .GetByFarmIdAndStatusAsync(farmId, MissingStatuses, ct);

        var result = new Dictionary<Guid, int>();
        if (instances.Count == 0)
        {
            return result;
        }

        foreach (var instance in instances)
        {
            if (instance.PlannedDueDate > today)
            {
                continue; // not yet due
            }

            result[instance.PlotId] = result.TryGetValue(instance.PlotId, out var existing)
                ? existing + 1
                : 1;
        }

        return result;
    }

    private static AttentionRank DetermineRank(
        HealthScore? health,
        int overdueCount,
        int disputeCount,
        int missingTestCount)
    {
        // Rule 1: Critical health → Critical
        if (health == HealthScore.Critical) return AttentionRank.Critical;
        // Rule 2: Any dispute → Critical
        if (disputeCount > 0) return AttentionRank.Critical;
        // Rule 3: 3+ overdue → NeedsAttention
        if (overdueCount >= 3) return AttentionRank.NeedsAttention;
        // Rule 4: NeedsAttention health → NeedsAttention
        if (health == HealthScore.NeedsAttention) return AttentionRank.NeedsAttention;

        // CEI Phase 2 §4.5 — missing-test elevation rules
        // 3+ missing tests → NeedsAttention
        if (missingTestCount >= 3) return AttentionRank.NeedsAttention;

        // Rule 5: 1-2 overdue → Watch
        if (overdueCount >= 1) return AttentionRank.Watch;

        // CEI Phase 2 §4.5 — at least one missing test on a healthy plot bumps to Watch
        if (missingTestCount >= 1) return AttentionRank.Watch;

        // Rule 6: Healthy
        return AttentionRank.Healthy;
    }

    private static AttentionCardDto BuildCard(
        Guid farmId, string farmName, Guid plotId, string plotName,
        Guid cropCycleId, string stageName, AttentionRank rank,
        HealthScore? health, int overdueCount, int disputeCount, int missingTestCount,
        int openComplianceSignalCount, ComplianceSignal? highestSeveritySignal,
        DateTime asOf)
    {
        // Determine suggested action and labels based on rank + context.
        // CEI Phase 3 §4.6: prefer highest-severity compliance signal's SuggestedAction
        // over auto-derived when it produces a more specific action.
        SuggestedActionKind action;
        string labelEn, labelMr;
        string titleEn, titleMr, descEn, descMr;

        if (highestSeveritySignal is { RuleCode: ComplianceRuleCode.InputMixNeverTogether })
        {
            // spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT-S1; F168) - the card is filed by this signal's rule code
            // (TopSignalRuleCode below), so it says this signal's own words whatever rank branch would match first (overdue
            // work, a dispute, stage health): rank, counts and ids stay as they are.
            action = MapComplianceSuggestedAction(highestSeveritySignal.SuggestedAction);
            labelEn = "View compliance signal"; labelMr = "अनुपालन सिग्नल पहा";
            titleEn = highestSeveritySignal.TitleEn; titleMr = highestSeveritySignal.TitleMr;
            descEn = highestSeveritySignal.DescriptionEn;
            descMr = highestSeveritySignal.DescriptionMr;
        }
        else if (rank == AttentionRank.Critical && disputeCount > 0)
        {
            action = SuggestedActionKind.ResolveDispute;
            labelEn = "Open disputes"; labelMr = "वाद सोडवा";
            titleEn = "Log disputes need resolution"; titleMr = "नोंदींमध्ये वाद आहेत";
            descEn = $"{disputeCount} disputed log(s) need attention";
            descMr = $"{disputeCount} नोंदींमध्ये वाद आहे";
        }
        else if (rank == AttentionRank.Critical && highestSeveritySignal?.Severity == ComplianceSeverity.Critical)
        {
            // Compliance signal drives the critical rank — use its suggested action
            action = MapComplianceSuggestedAction(highestSeveritySignal.SuggestedAction);
            labelEn = "View compliance signal"; labelMr = "अनुपालन सिग्नल पहा";
            titleEn = highestSeveritySignal.TitleEn; titleMr = highestSeveritySignal.TitleMr;
            descEn = highestSeveritySignal.DescriptionEn;
            descMr = highestSeveritySignal.DescriptionMr;
        }
        else if (rank == AttentionRank.Critical && health == HealthScore.Critical)
        {
            action = SuggestedActionKind.OpenStageCompare;
            labelEn = "Open stage compare"; labelMr = "टप्पा तुलना पहा";
            titleEn = "Stage compliance is critical"; titleMr = "टप्प्याची अनुपालन गंभीर आहे";
            descEn = "Most planned activities are missing for this stage";
            descMr = "या टप्प्यात बहुतेक नियोजित कामे झाली नाहीत";
        }
        else if (rank == AttentionRank.NeedsAttention && overdueCount >= 3)
        {
            action = SuggestedActionKind.ReviewOverdueTasks;
            labelEn = "Review overdue tasks"; labelMr = "थकलेली कामे पहा";
            titleEn = $"{overdueCount} tasks overdue"; titleMr = $"{overdueCount} कामे थकलेली";
            descEn = "Several planned activities are past their scheduled date";
            descMr = "अनेक नियोजित कामे वेळेवर झाली नाहीत";
        }
        else if (rank == AttentionRank.NeedsAttention && missingTestCount >= 3)
        {
            action = SuggestedActionKind.AssignTest;
            labelEn = "Assign tests"; labelMr = "चाचण्या नियुक्त करा";
            titleEn = $"{missingTestCount} tests overdue"; titleMr = $"{missingTestCount} चाचण्या थकल्या";
            descEn = "Several scheduled tests have not been collected";
            descMr = "अनेक नियोजित चाचण्या घेतल्या गेल्या नाहीत";
        }
        else if (rank == AttentionRank.NeedsAttention && highestSeveritySignal?.Severity == ComplianceSeverity.NeedsAttention)
        {
            action = MapComplianceSuggestedAction(highestSeveritySignal.SuggestedAction);
            labelEn = "View compliance signal"; labelMr = "अनुपालन सिग्नल पहा";
            titleEn = highestSeveritySignal.TitleEn; titleMr = highestSeveritySignal.TitleMr;
            descEn = highestSeveritySignal.DescriptionEn;
            descMr = highestSeveritySignal.DescriptionMr;
        }
        else if (rank == AttentionRank.NeedsAttention && health == HealthScore.NeedsAttention)
        {
            action = SuggestedActionKind.OpenStageCompare;
            labelEn = "Open stage compare"; labelMr = "टप्पा तुलना पहा";
            titleEn = "Stage needs attention"; titleMr = "टप्प्यात लक्ष द्या";
            descEn = "Some planned activities are not being logged";
            descMr = "काही नियोजित कामांच्या नोंदी नाहीत";
        }
        else if (rank == AttentionRank.Watch && missingTestCount >= 1 && overdueCount == 0)
        {
            action = SuggestedActionKind.AssignTest;
            labelEn = "Assign tests"; labelMr = "चाचण्या नियुक्त करा";
            titleEn = missingTestCount == 1
                ? "1 test pending collection"
                : $"{missingTestCount} tests pending collection";
            titleMr = missingTestCount == 1
                ? "1 चाचणी प्रलंबित"
                : $"{missingTestCount} चाचण्या प्रलंबित";
            descEn = "Scheduled lab test(s) have not been collected yet";
            descMr = "नियोजित चाचणी अद्याप घेतलेली नाही";
        }
        else // Watch — overdue tasks or compliance signals
        {
            if (openComplianceSignalCount > 0 && overdueCount == 0 && highestSeveritySignal is not null)
            {
                action = MapComplianceSuggestedAction(highestSeveritySignal.SuggestedAction);
                labelEn = "View compliance signal"; labelMr = "अनुपालन सिग्नल पहा";
                titleEn = highestSeveritySignal.TitleEn; titleMr = highestSeveritySignal.TitleMr;
                descEn = highestSeveritySignal.DescriptionEn;
                descMr = highestSeveritySignal.DescriptionMr;
            }
            else
            {
                action = SuggestedActionKind.OpenPlot;
                labelEn = "Go to plot"; labelMr = "तुकडा पहा";
                titleEn = overdueCount > 0 ? $"{overdueCount} task(s) slightly behind" : "Plot needs a check";
                titleMr = overdueCount > 0 ? $"{overdueCount} काम थोडे उशीर" : "तुकडा तपासा";
                descEn = "A few activities may need follow-up";
                descMr = "काही कामांवर लक्ष द्यावे";
            }
        }

        return new AttentionCardDto(
            CardId: Guid.NewGuid(),
            FarmId: farmId,
            FarmName: farmName,
            PlotId: plotId,
            PlotName: plotName,
            CropCycleId: cropCycleId,
            StageName: stageName,
            Rank: rank,
            TitleEn: titleEn,
            TitleMr: titleMr,
            DescriptionEn: descEn,
            DescriptionMr: descMr,
            SuggestedAction: action,
            SuggestedActionLabelEn: labelEn,
            SuggestedActionLabelMr: labelMr,
            OverdueTaskCount: overdueCount > 0 ? overdueCount : null,
            LatestHealthScore: health?.ToString(),
            UnresolvedDisputeCount: disputeCount > 0 ? disputeCount : null,
            MissingTestCount: missingTestCount > 0 ? missingTestCount : null,
            OpenComplianceSignalCount: openComplianceSignalCount,
            // spec: dfes-input-truth-and-mix-check-2026-11-06 (lane IT2, Task 4) - the signal that ranks the card, so the phone
            // can name it (wrong mix in one tank) and acknowledge it (पाहिलं).
            TopSignalId: highestSeveritySignal?.Id,
            TopSignalRuleCode: highestSeveritySignal?.RuleCode,
            ComputedAtUtc: asOf);
    }

    /// <summary>
    /// Maps a <see cref="ComplianceSuggestedAction"/> to the attention board's
    /// <see cref="SuggestedActionKind"/>. Both enums cover overlapping domain actions.
    /// </summary>
    private static SuggestedActionKind MapComplianceSuggestedAction(ComplianceSuggestedAction action) =>
        action switch
        {
            ComplianceSuggestedAction.OpenStageCompare => SuggestedActionKind.OpenStageCompare,
            ComplianceSuggestedAction.AssignTest => SuggestedActionKind.AssignTest,
            ComplianceSuggestedAction.ResolveDispute => SuggestedActionKind.ResolveDispute,
            ComplianceSuggestedAction.ScheduleMissingActivity => SuggestedActionKind.ReviewOverdueTasks,
            _ => SuggestedActionKind.OpenPlot
        };
}
