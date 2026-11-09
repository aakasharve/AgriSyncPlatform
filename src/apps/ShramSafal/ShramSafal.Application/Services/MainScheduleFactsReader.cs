using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Planning;
using ShramSafal.Domain.Schedules;

namespace ShramSafal.Application.Services;

/// <summary>
/// spec: plr-d10 lane L8b-3 (R6, P4) - where <see cref="MainSchedule.Pick"/> gets what it needs to know about the schedules a
/// plot-season follows: who each comes from and whether ShramSafal's check says Checked NOW. A schedule that is not known (a built-in
/// sample carries no owner type; a row the reader may not see) answers <c>null</c>: never assumed to be an Institution.
/// </summary>
public static class MainScheduleFactsReader
{
    /// <summary>The pull's way: from the library listing the same pull already holds (no new query path past the reader's filter).</summary>
    public static Func<ScheduleTemplateId, MainScheduleFacts?> FromListing(IEnumerable<ScheduleTemplateDto> listing)
    {
        ArgumentNullException.ThrowIfNull(listing);
        var byId = new Dictionary<Guid, MainScheduleFacts>();
        foreach (var template in listing)
        {
            ScheduleOwnerType? owner = ScheduleOwnerTypeWire.TryParse(template.OwnerType, out var parsed) ? parsed : null;
            byId[template.Id] = new MainScheduleFacts(owner, string.Equals(template.Check?.State, nameof(ScheduleCheckState.Checked), StringComparison.Ordinal));
        }

        return id => byId.GetValueOrDefault(id.Value);
    }

    /// <summary>The server's own way (compliance): from the library rows and checks of these schedules.</summary>
    public static async Task<Func<ScheduleTemplateId, MainScheduleFacts?>> FromRepositoryAsync(
        IShramSafalRepository repository, IReadOnlyCollection<ScheduleTemplateId> templateIds, CancellationToken ct = default)
    {
        ArgumentNullException.ThrowIfNull(repository);
        var ids = templateIds.Select(t => t.Value).Distinct().ToList();
        var checks = await repository.GetScheduleChecksAsync(ids, ct);
        var byId = new Dictionary<Guid, MainScheduleFacts>();
        foreach (var id in ids)
        {
            var row = await repository.GetScheduleTemplateByIdAsync(id, ct);
            if (row is null)
            {
                continue;
            }

            byId[id] = new MainScheduleFacts(
                row.OwnerType,
                ScheduleCheck.StateOf(checks.Where(c => c.ScheduleTemplateId == id)) == ScheduleCheckState.Checked);
        }

        return id => byId.GetValueOrDefault(id.Value);
    }
}
