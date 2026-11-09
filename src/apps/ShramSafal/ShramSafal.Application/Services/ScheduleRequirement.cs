using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Application.UseCases.ReferenceData.GetScheduleTemplates;
using ShramSafal.Domain.Crops;
using ShramSafal.Domain.Dfes;
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.Schedules;

namespace ShramSafal.Application.Services;

// spec: plr-d10-redesign-real-integration-2026-10-25 (lane SCH-GATE-a; D-76, D-82 = 3, D-83 = 1, D-91 = 1, R6, R7, R9, R10)

/// <summary>The newest crop season of a plot: its id, its crop name and its start date (the default day 0).</summary>
public sealed record PlanningSeason(Guid CycleId, string CropName, DateOnly StartDate);

/// <summary>
/// The owner account's subscription as ShramSafal may read it (<c>ssf.subscription_projections</c>): is it Trialing, when the trial
/// ends (null = the row carries no trial end), and when its validity ends.
/// </summary>
public sealed record TrialStanding(bool IsTrialing, DateTime? TrialEndsAtUtc, DateTime ValidUntilUtc);

/// <summary>
/// Everything <see cref="ScheduleRequirement.Decide"/> reads about ONE plot; no I/O happens after this is built.
/// <see cref="Followed"/> are the plot's schedule subscriptions (the decision keeps the Active ones of the current season),
/// <see cref="Listing"/> is the CALLER's library as his phone gets it, plus the schedules his plots already follow (R7), and
/// <see cref="OriginOf"/> answers whose schedule a listed row is FOR THIS PLOT's farm (<see cref="FollowableOnPlot.Classify"/>).
/// </summary>
public sealed record PlanningFacts(
    Guid PlotId,
    PlanningSeason? Season,
    DateTime NowUtc,
    TrialStanding? Standing,
    bool HasAccessExtension,
    IReadOnlyList<ScheduleSubscription> Followed,
    IReadOnlyList<ScheduleTemplateDto> Listing,
    Func<ScheduleTemplateDto, ScheduleOrigin?> OriginOf);

/// <summary>
/// What the planning gate says about one plot (the plan's record, plus the season it was judged on - open point 6).
/// </summary>
public sealed record PlotPlanningState(
    Guid PlotId,
    Guid? CropCycleId,
    bool InTrial,
    bool FollowsAllowed,
    bool CanFollowSomething,
    StageDefinition? TrialStage,
    bool NeedsSchedule)
{
    public PlotPlanningStateDto ToDto() => new(
        PlotId, CropCycleId, InTrial, FollowsAllowed, CanFollowSomething,
        TrialStage is null ? null : new StageDefinitionDto(TrialStage.Name, TrialStage.StartDay, TrialStage.EndDay),
        NeedsSchedule);
}

/// <summary>
/// spec: plr-d10 lane SCH-GATE-a (founder D-76, D-83 = 1) - does this plot need a schedule chosen before NEW planning, the शेड्यूल page
/// and तुलना? Only these rules are built; there is no switch.
/// <list type="bullet">
/// <item><see cref="PlotPlanningState.InTrial"/> (R9): the owner account's subscription is Trialing AND now is before its trial end
/// (else its valid-until) - the daily expiry job can lag a day, so the clock decides first - AND no pilot access extension is on (an
/// extension counts as AFTER the trial). No subscription row = after the trial.</item>
/// <item><see cref="PlotPlanningState.FollowsAllowed"/>: the plot's current season has an Active Outside row (any check state: a
/// Checked one, a sample under D-91 = 1, one kept from before or one whose check was withdrawn - R7, nothing asks him again), or an
/// Active Own row whose schedule stores days (D-82 = 3: no check).</item>
/// <item><see cref="PlotPlanningState.CanFollowSomething"/>: some schedule in the CALLER's listing for the season's crop that
/// <see cref="ScheduleLibrary.NewChoiceOpen"/> says may be chosen new now - the same rule adopt uses, so the day SCH-OWN opens his
/// own schedules the gate counts them with no change here.</item>
/// <item><see cref="PlotPlanningState.TrialStage"/> (R6, R10): in the trial only - today's stage of the मुख्य schedule's STORED stages.</item>
/// <item><see cref="PlotPlanningState.NeedsSchedule"/> = after the trial and not following and something to follow.</item>
/// </list>
/// <b>Read only by the pull and by <see cref="ScheduleStagePlan"/>.</b> A record door (daily log, attendance, cost entry), a planned-work
/// write or any /sync/push case never asks it: the server never refuses, parks or hides a record because of a schedule (D-83 = 1). A
/// source-scan test pins that.
/// </summary>
public sealed class ScheduleRequirement(
    IShramSafalRepository repository,
    ISubscriptionReader subscriptions,
    GetScheduleTemplatesHandler templates,
    IClock clock)
{
    // ---- the decision (pure) ---------------------------------------------------------------------------------

    public static PlotPlanningState Decide(PlanningFacts facts)
    {
        ArgumentNullException.ThrowIfNull(facts);
        var inTrial = IsInTrial(facts);
        if (facts.Season is not { } season)
        {
            // No crop season: nothing to follow and nothing to ask (a plot with no crop has no schedule to choose).
            return new PlotPlanningState(facts.PlotId, null, inTrial, false, false, null, false);
        }

        var followed = FollowedNow(facts, season);
        var byId = facts.Listing.GroupBy(t => t.Id).ToDictionary(g => g.Key, g => g.First());

        var followsAllowed = followed.Any(s => s.Origin != ScheduleOrigin.Own)
            || followed.Any(s => s.Origin == ScheduleOrigin.Own
                                 && byId.TryGetValue(s.ScheduleTemplateId.Value, out var own)
                                 && own.HasStoredDays == true);

        var checkedCrops = ScheduleLibrary.CheckedOutsideCropsOf(facts.Listing);
        var canFollowSomething = facts.Listing.Any(t =>
            ScheduleLibrary.MatchesCrop(t, season.CropName)
            && ScheduleLibrary.NewChoiceOpen(
                facts.OriginOf(t),
                isBuiltIn: t.Scope is null,
                hasStoredDays: t.HasStoredDays == true,
                ParseState(t),
                checkedCrops.Contains(ScheduleLibrary.CropGroupKey(t.CropType))));

        var trialStage = inTrial ? TrialStageOf(facts, season, followed, byId) : null;
        return new PlotPlanningState(
            facts.PlotId, season.CycleId, inTrial, followsAllowed, canFollowSomething, trialStage,
            NeedsSchedule: !inTrial && !followsAllowed && canFollowSomething);
    }

    /// <summary>The plot's Active subscriptions on its CURRENT season (anything else is ignored).</summary>
    public static IReadOnlyList<ScheduleSubscription> FollowedNow(PlanningFacts facts, PlanningSeason season) =>
        facts.Followed
            .Where(s => s.State == ScheduleSubscriptionState.Active && s.PlotId == facts.PlotId && s.CropCycleId == season.CycleId)
            .ToList();

    private static bool IsInTrial(PlanningFacts facts)
    {
        if (facts.Standing is not { IsTrialing: true } standing || facts.HasAccessExtension)
        {
            return false;
        }

        return facts.NowUtc < (standing.TrialEndsAtUtc ?? standing.ValidUntilUtc);
    }

    private static StageDefinition? TrialStageOf(
        PlanningFacts facts, PlanningSeason season, IReadOnlyList<ScheduleSubscription> followed,
        IReadOnlyDictionary<Guid, ScheduleTemplateDto> byId)
    {
        var main = MainSchedule.Pick(followed, MainScheduleFactsReader.FromListing(facts.Listing));
        if (main is null || !byId.TryGetValue(main.ScheduleTemplateId.Value, out var template) || template.HasStoredDays != true)
        {
            return null;
        }

        var dayZero = main.ReferenceDate ?? season.StartDate;
        return ScheduleDefinitionMapper.StageHolding(
            ScheduleDefinitionMapper.From(template), dayZero, FarmLocalDay.From(facts.NowUtc))?.Stage;
    }

    private static ScheduleCheckState ParseState(ScheduleTemplateDto t) =>
        Enum.TryParse<ScheduleCheckState>(t.Check?.State, out var state) ? state : ScheduleCheckState.NotChecked;

    /// <summary>The phone's rule for "the season on screen": the newest by start date; a tie goes to the lower id.</summary>
    public static PlanningSeason? CurrentSeason(IEnumerable<CropCycle> cycles) =>
        cycles
            .OrderByDescending(c => c.StartDate)
            .ThenBy(c => c.Id.ToString(), StringComparer.Ordinal)
            .Select(c => new PlanningSeason(c.Id, c.CropName, c.StartDate))
            .FirstOrDefault();

    // ---- the loaders (gather facts; no rule lives here) ------------------------------------------------------

    /// <summary>
    /// The facts for ONE plot as <paramref name="callerUserId"/> sees them: his own library (the same listing adopt and his phone
    /// use) plus the schedules this plot follows, resolved exactly as the pull does (<c>GetScheduleTemplatesHandler.HandleAsync</c>
    /// with the followed ids - <c>FindAsync</c> would lose a sample kept after its crop got a checked schedule, R7).
    /// </summary>
    public async Task<Result<PlanningFacts>> FactsForPlotAsync(Guid farmId, Guid plotId, Guid callerUserId, CancellationToken ct = default)
    {
        var now = clock.UtcNow;
        var farm = await repository.GetFarmByIdAsync(farmId, ct);
        var plot = await repository.GetPlotByIdAsync(plotId, ct);
        if (farm is null || plot is null || (Guid)plot.FarmId != farmId)
        {
            return Result.Success(new PlanningFacts(plotId, null, now, null, false, [], [], _ => null));
        }

        var season = CurrentSeason(await repository.GetCropCyclesByPlotIdAsync(plotId, ct));
        IReadOnlyList<ScheduleSubscription> followed = season is null
            ? []
            : await repository.GetActiveScheduleSubscriptionsAsync(plotId, season.CycleId, ct);
        var listing = await templates.HandleAsync(callerUserId, followed.Select(s => s.ScheduleTemplateId.Value).Distinct().ToList(), ct);
        if (!listing.IsSuccess)
        {
            return Result.Failure<PlanningFacts>(listing.Error);
        }

        var library = listing.Value ?? [];
        var (standing, extension) = await StandingOfAsync(farm.OwnerAccountId, now, ct);
        var originFor = await OriginsAsync(library, callerUserId, ct);
        return Result.Success(new PlanningFacts(
            plotId, season, now, standing, extension, followed, library, originFor(farm.OwnerUserId.Value)));
    }

    public async Task<Result<PlotPlanningState>> ForPlotAsync(Guid farmId, Guid plotId, Guid callerUserId, CancellationToken ct = default)
    {
        var facts = await FactsForPlotAsync(farmId, plotId, callerUserId, ct);
        return facts.IsSuccess ? Result.Success(Decide(facts.Value)) : Result.Failure<PlotPlanningState>(facts.Error);
    }

    /// <summary>
    /// The pull's way: one state per plot the reader may see, from the objects the pull already holds - the scopes of the farms whose
    /// overview he reads (<paramref name="overviewScopes"/>), the Active subscriptions of those plots (<paramref name="followedNow"/>)
    /// and the library listing his phone gets (<paramref name="listing"/>, followed extras included) - plus ONE read each of the
    /// farms, plots and crop seasons of those farms, and one subscription read per distinct owner account.
    /// </summary>
    public async Task<IReadOnlyList<PlotPlanningState>> ForPullAsync(
        Guid callerUserId,
        IReadOnlyDictionary<Guid, FarmReadScope> overviewScopes,
        IReadOnlyList<ScheduleSubscription> followedNow,
        IReadOnlyList<ScheduleTemplateDto> listing,
        CancellationToken ct = default)
    {
        if (overviewScopes.Count == 0)
        {
            return [];
        }

        var now = clock.UtcNow;
        var farmIds = overviewScopes.Keys.OrderBy(id => id).ToList();
        var farms = (await repository.GetFarmsChangedSinceAsync(farmIds, DateTime.UnixEpoch, ct))
            .Where(f => overviewScopes.ContainsKey((Guid)f.Id))
            .DistinctBy(f => (Guid)f.Id)
            .ToDictionary(f => (Guid)f.Id);
        var plots = (await repository.GetPlotsChangedSinceAsync(farmIds, DateTime.UnixEpoch, ct))
            .Where(p => overviewScopes.TryGetValue((Guid)p.FarmId, out var scope) && scope.CoversPlot(p.Id))
            .DistinctBy(p => p.Id)
            .OrderBy(p => p.Id)
            .ToList();
        var cyclesByPlot = (await repository.GetCropCyclesChangedSinceAsync(farmIds, DateTime.UnixEpoch, ct))
            .GroupBy(c => c.PlotId)
            .ToDictionary(g => g.Key, g => g.ToList());
        var followedByPlot = followedNow
            .GroupBy(s => s.PlotId)
            .ToDictionary(g => g.Key, g => (IReadOnlyList<ScheduleSubscription>)g.ToList());

        var standings = new Dictionary<Guid, (TrialStanding? Standing, bool Extension)>();
        var originFor = await OriginsAsync(listing, callerUserId, ct);
        var states = new List<PlotPlanningState>(plots.Count);
        foreach (var plot in plots)
        {
            if (!farms.TryGetValue((Guid)plot.FarmId, out var farm))
            {
                continue;
            }

            var account = farm.OwnerAccountId.IsEmpty ? Guid.Empty : farm.OwnerAccountId.Value;
            if (!standings.TryGetValue(account, out var standing))
            {
                standings[account] = standing = await StandingOfAsync(farm.OwnerAccountId, now, ct);
            }

            var season = CurrentSeason(cyclesByPlot.GetValueOrDefault(plot.Id) ?? []);
            states.Add(Decide(new PlanningFacts(
                plot.Id, season, now, standing.Standing, standing.Extension,
                followedByPlot.GetValueOrDefault(plot.Id) ?? [], listing, originFor(farm.OwnerUserId.Value))));
        }

        return states;
    }

    private async Task<(TrialStanding? Standing, bool Extension)> StandingOfAsync(OwnerAccountId account, DateTime now, CancellationToken ct)
    {
        if (account.IsEmpty)
        {
            return (null, false);
        }

        var row = await subscriptions.GetByOwnerAccountAsync(account, ct);
        if (row is null)
        {
            return (null, false);
        }

        var standing = new TrialStanding(row.IsTrialing, row.TrialEndsAtUtc, row.ValidUntilUtc);
        // An extension only matters to a farm that would otherwise read as IN its trial (R9: it then counts as after it); for every
        // other farm the answer is "after the trial" already, so the extension is not asked (one read less per account per pull).
        var wouldBeInTrial = row.IsTrialing && now < (row.TrialEndsAtUtc ?? row.ValidUntilUtc);
        var extension = wouldBeInTrial && await subscriptions.GetActiveAccessExtensionAsync(account, now, ct) is not null;
        return (standing, extension);
    }

    /// <summary>
    /// Whose a listed row is for a plot's farm, as <see cref="ScheduleLibrary.ChooseAsync"/> reads it: Public and built-in rows are
    /// Outside with no read; a row of any other scope is classified through <see cref="ScheduleViewer.OwnerOfAsync"/> and
    /// <see cref="FollowableOnPlot.Classify"/> against the plot farm's owner (the rows are read only when the listing holds such a row).
    /// </summary>
    private async Task<Func<Guid, Func<ScheduleTemplateDto, ScheduleOrigin?>>> OriginsAsync(
        IReadOnlyList<ScheduleTemplateDto> listing, Guid callerUserId, CancellationToken ct)
    {
        var nonPublic = listing
            .Where(t => t.Scope is not null && !string.Equals(t.Scope, nameof(TenantScope.Public), StringComparison.Ordinal))
            .ToList();
        if (nonPublic.Count == 0)
        {
            return _ => _ => ScheduleOrigin.Outside;
        }

        var rows = await repository.GetScheduleTemplatesAsync(ct);
        var rowById = rows.GroupBy(r => r.Id).ToDictionary(g => g.Key, g => g.First());
        var viewer = new ScheduleViewer(repository, callerUserId, rows);
        var owners = new Dictionary<Guid, Guid?>();
        foreach (var t in nonPublic)
        {
            if (rowById.TryGetValue(t.Id, out var row))
            {
                owners[t.Id] = await viewer.OwnerOfAsync(row, ct);
            }
        }

        return farmOwner => t =>
            t.Scope is null || string.Equals(t.Scope, nameof(TenantScope.Public), StringComparison.Ordinal)
                ? ScheduleOrigin.Outside
                : Enum.TryParse<TenantScope>(t.Scope, out var scope)
                    ? FollowableOnPlot.Classify(scope, owners.GetValueOrDefault(t.Id), isBuiltIn: false, farmOwner)
                    : null;
    }
}
