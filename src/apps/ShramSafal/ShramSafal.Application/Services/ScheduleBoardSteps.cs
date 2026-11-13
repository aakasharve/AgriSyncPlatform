using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.ReferenceData.GetScheduleTemplates;
using ShramSafal.Domain.Compare;
using ShramSafal.Domain.Crops;
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.Schedules;

namespace ShramSafal.Application.Services;

// spec: plr-d10-redesign-real-integration-2026-10-25 (lane ATT-W; R29 path b, R13, R35)

/// <summary>
/// One step a followed schedule asks, as the attention board shows it. <see cref="Step"/> is what the matcher reads (its
/// <c>PlannedDate</c> is the day लक्ष द्या reminds: the schedule's own day, or the day a person moved it to); the rest is what the item
/// shows: which schedule, which activity and original day (what a move names), the schedule's own day number, the stage it sits in, and how
/// often the schedule stores it (<see cref="RepeatCode"/>, null when no repeat is stored: never guessed, P4).
/// </summary>
public sealed record BoardStep(
    ScheduledStep Step,
    Guid SubscriptionId,
    string ScheduleName,
    Guid ActivityId,
    DateOnly OriginalDate,
    int ScheduleDay,
    string? StageName,
    string? RepeatCode);

/// <summary>The steps of ONE followed schedule on one plot's current season.</summary>
public sealed record BoardScheduleSteps(Guid SubscriptionId, string ScheduleName, IReadOnlyList<BoardStep> Steps);

/// <summary>
/// spec: plr-d10 lane ATT-W (R29) - what the board reads for the plots that have an Active subscription. Everything is read ONCE for the
/// request (<see cref="ScheduleBoardSteps.LoadAsync"/>): three reads in all, however many farms and plots, so the board adds no query
/// per plot (the CMP-D2 lesson, P001).
/// </summary>
public sealed class BoardScheduleSource
{
    public static readonly BoardScheduleSource None = new([], new Dictionary<Guid, ScheduleTemplateDto>(), []);

    private readonly IReadOnlyList<ScheduleSubscription> active;
    private readonly IReadOnlyDictionary<Guid, ScheduleTemplateDto> templates;
    private readonly IReadOnlyDictionary<(Guid Subscription, Guid Activity, DateOnly Original), DateOnly> latestMoves;
    private readonly Func<ScheduleTemplateId, MainScheduleFacts?> factsOf;

    internal BoardScheduleSource(
        IReadOnlyList<ScheduleSubscription> active,
        IReadOnlyDictionary<Guid, ScheduleTemplateDto> templates,
        IReadOnlyList<ScheduleStepMove> moveRows)
    {
        this.active = active;
        this.templates = templates;
        factsOf = MainScheduleFactsReader.FromListing(templates.Values);

        // moveRows come oldest first: the later row of a step replaces the earlier one (the latest wins; the history stays in the table).
        var latest = new Dictionary<(Guid Subscription, Guid Activity, DateOnly Original), DateOnly>();
        foreach (var move in moveRows.OrderBy(m => m.MovedAtUtc).ThenBy(m => m.Id))
        {
            latest[(move.ScheduleSubscriptionId, move.TemplateActivityId, move.OriginalDate)] = move.NewDate;
        }

        latestMoves = latest;
    }

    /// <summary>
    /// The steps the plot's followed schedules ask in <paramref name="cycle"/>, or <c>null</c> when the plot has NO Active subscription on that
    /// season - then the board is exactly today's (it reads the season's planned rows, P11). A plot with Active subscriptions whose schedules the
    /// caller may not read gets an empty list: still not today's rows (no double count, and a schedule he may not read is never described).
    /// </summary>
    public IReadOnlyList<BoardScheduleSteps>? For(Guid plotId, CropCycle cycle)
    {
        ArgumentNullException.ThrowIfNull(cycle);
        var followed = active
            .Where(s => s.PlotId == plotId && s.CropCycleId == cycle.Id && s.State == ScheduleSubscriptionState.Active)
            .ToList();
        if (followed.Count == 0)
        {
            return null;
        }

        var main = MainSchedule.Pick(followed, factsOf);
        IReadOnlyList<StageWindow> windows = [];
        if (main is not null && templates.TryGetValue(main.ScheduleTemplateId.Value, out var mainTemplate))
        {
            windows = ScheduleFollowEngine.StageWindows(
                ScheduleDefinitionMapper.From(mainTemplate), main.ReferenceDate ?? cycle.StartDate);
        }

        var ordered = followed
            .OrderBy(s => main is not null && s.Id == main.Id ? 0 : 1)
            .ThenBy(s => s.Origin == ScheduleOrigin.Own ? 1 : 0)
            .ThenBy(s => s.Slot is { } slot ? (int)slot : int.MaxValue)
            .ThenBy(s => s.AdoptedAtUtc)
            .ThenBy(s => s.Id)
            .ToList();

        var result = new List<BoardScheduleSteps>(ordered.Count);
        foreach (var sub in ordered)
        {
            if (!templates.TryGetValue(sub.ScheduleTemplateId.Value, out var template))
            {
                continue; // a schedule he may not read is never described
            }

            var definition = ScheduleDefinitionMapper.From(template);
            var dayZero = sub.ReferenceDate ?? cycle.StartDate;
            var steps = new List<BoardStep>();
            foreach (var expected in ScheduleFollowEngine.Expand(definition, dayZero))
            {
                var shown = latestMoves.TryGetValue((sub.Id, expected.ActivityId, expected.Date), out var moved) ? moved : expected.Date;
                var window = windows.FirstOrDefault(w => expected.Date >= w.From && expected.Date <= w.To);
                steps.Add(new BoardStep(
                    new ScheduledStep(
                        ScheduledStepIds.ForStep(sub.Id, expected.ActivityId, expected.Date),
                        expected.Title,
                        shown,
                        expected.Part,
                        expected.OperationKey,
                        expected.Role,
                        expected.NutrientKey,
                        expected.OnceOnly,
                        window?.From,
                        window?.To),
                    sub.Id,
                    template.Name,
                    expected.ActivityId,
                    expected.Date,
                    expected.Date.DayNumber - dayZero.DayNumber,
                    window?.Name,
                    RepeatCodeOf(definition, expected.ActivityId)));
            }

            result.Add(new BoardScheduleSteps(sub.Id, template.Name, steps));
        }

        return result;
    }

    /// <summary>
    /// How often the schedule STORES an activity, as a code the phone words in either language: <c>every_n_days:N</c> or <c>per_week:N</c>.
    /// Null for a stored one-time work and for an activity that stores no repeat at all (never guessed from its name, P4).
    /// </summary>
    private static string? RepeatCodeOf(ScheduleDefinition definition, Guid activityId)
    {
        var activity = definition.Activities.FirstOrDefault(a => a.ActivityId == activityId);
        return activity switch
        {
            { FrequencyMode: FrequencyMode.EveryNDays, IntervalDays: { } n and > 0 } => $"every_n_days:{n}",
            { FrequencyMode: FrequencyMode.PerWeek, IntervalDays: { } n and > 0 } => $"per_week:{n}",
            _ => null,
        };
    }
}

/// <summary>
/// spec: plr-d10 lane ATT-W (R29) - loads what <see cref="BoardScheduleSource"/> needs, once for the request: the Active subscriptions of the
/// caller's farms (ONE read), the schedules they follow as the caller's library lists them with the followed ones added (ONE read, R7: never
/// <c>ScheduleLibrary.FindAsync</c>, which is the new-choice list and would lose a kept sample), and the moves of those subscriptions (ONE read).
/// When no farm has an Active subscription nothing more is read.
/// </summary>
public sealed class ScheduleBoardSteps(
    IShramSafalRepository repository,
    GetScheduleTemplatesHandler templates,
    IScheduleStepMoveStore moves)
{
    public async Task<BoardScheduleSource> LoadAsync(
        IReadOnlyCollection<Guid> farmIds, Guid callerUserId, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(farmIds);
        if (farmIds.Count == 0)
        {
            return BoardScheduleSource.None;
        }

        var active = await repository.GetActiveScheduleSubscriptionsOfFarmsAsync(farmIds.ToList(), ct);
        if (active.Count == 0)
        {
            return BoardScheduleSource.None;
        }

        var listing = await templates.HandleAsync(callerUserId, active.Select(s => s.ScheduleTemplateId.Value).Distinct().ToList(), ct);
        if (!listing.IsSuccess)
        {
            // A library that cannot be read for this caller: no followed schedule is described, today's board stays (P11).
            return BoardScheduleSource.None;
        }

        var byId = (listing.Value ?? []).GroupBy(t => t.Id).ToDictionary(g => g.Key, g => g.First());
        var rows = await moves.GetForSubscriptionsAsync(active.Select(s => s.Id).ToList(), ct);
        return new BoardScheduleSource(active, byId, rows);
    }
}
