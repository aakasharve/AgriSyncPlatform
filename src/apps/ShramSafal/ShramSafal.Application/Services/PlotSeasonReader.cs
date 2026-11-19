// spec: facts-card-input-truth-2026-11-19 (lane FACTS, slice B)
using ShramSafal.Domain.Schedules;

namespace ShramSafal.Application.Services;

/// <summary>
/// A plot's crop, its day zero and its stages, as the server's own schedule engine holds them. <see cref="DayZero"/> is null when the
/// plot has no main schedule (P4: no schedule, no day); <see cref="StageOn"/> answers null for a day no stage holds.
/// </summary>
public sealed record PlotSeason(string? Crop, DateOnly? DayZero, string? DayZeroSource, Guid? TemplateId, Func<DateOnly, string?>? StageFor)
{
    public static PlotSeason None { get; } = new(null, null, null, null, null);

    public string? StageOn(DateOnly day) => StageFor?.Invoke(day);
}

/// <summary>Reads a plot's <see cref="PlotSeason"/>. Read only: it never writes and never refuses anything.</summary>
public interface IPlotSeasonReader
{
    Task<PlotSeason> ReadAsync(Guid farmId, Guid plotId, Guid ownerUserId, CancellationToken ct = default);
}

/// <summary>
/// <see cref="IPlotSeasonReader"/> over the one schedule engine the stage panel reads (the same followed schedules, the same main-schedule
/// pick, the same day zero and stage windows), so the ledger's day count is the plot's one day count, not a second one.
///
/// <para><b>The only reader here, on purpose.</b> The planning gate's guard keeps every record door away from the schedule decision
/// (D-83 = 1: capture never waits for a schedule). This reader is not a door and asks no decision (<c>Decide</c> is never called): it is
/// reached only AFTER a record is saved, by the input-use derivation, inside its own savepoint where a failure is swallowed, and by the
/// owner's rebuild. Whatever it reads or fails to read, the record he saved is exactly as it was.</para>
/// </summary>
public sealed class PlotSeasonReader(ScheduleRequirement requirement) : IPlotSeasonReader
{
    public async Task<PlotSeason> ReadAsync(Guid farmId, Guid plotId, Guid ownerUserId, CancellationToken ct = default)
    {
        var gathered = await requirement.FactsForPlotAsync(farmId, plotId, ownerUserId, ct);
        if (!gathered.IsSuccess || gathered.Value.Season is not { } season)
        {
            return PlotSeason.None;
        }

        var facts = gathered.Value;
        var followed = ScheduleRequirement.FollowedNow(facts, season);
        var main = MainSchedule.Pick(followed, MainScheduleFactsReader.FromListing(facts.Listing), facts.PlotFarmOwnerUserId);
        if (main is null)
        {
            // No main schedule: the crop is known, a day is not (P4).
            return PlotSeason.None with { Crop = season.CropName };
        }

        var byId = facts.Listing.GroupBy(t => t.Id).ToDictionary(g => g.Key, g => g.First());
        var dayZero = main.ReferenceDate ?? season.StartDate;
        var definition = byId.TryGetValue(main.ScheduleTemplateId.Value, out var template) ? ScheduleDefinitionMapper.From(template) : null;
        return new PlotSeason(
            season.CropName, dayZero, main.ReferenceDate is null ? "crop-cycle-start" : "schedule", main.ScheduleTemplateId.Value,
            definition is null ? null : day => ScheduleDefinitionMapper.StageHolding(definition, dayZero, day)?.Stage.Name);
    }
}
