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
/// spec: plr-d10 lane CMP-OWN - both ways also say whose row it is (scope + the owner COLUMN) and whether it stores stages (it stores its days
/// and at least one stage: exactly the stages <see cref="ScheduleDefinitionMapper"/> hands the compare), so the pick can name his own plan.
/// The two ways agree on every field.
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
            TenantScope? scope = Enum.TryParse<TenantScope>(template.Scope, out var parsedScope) ? parsedScope : null;
            byId[template.Id] = new MainScheduleFacts(
                owner,
                string.Equals(template.Check?.State, nameof(ScheduleCheckState.Checked), StringComparison.Ordinal),
                scope,
                template.OwnerUserId,
                HasStages: HasStageLine(template));
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
            // spec: plr-d10 schedule slice 3 - WITH its tasks: a version of only "after" and "sign" works stores no day of a work and still has a stage line.
            var row = await repository.GetScheduleTemplateWithTasksByIdAsync(id, ct);
            if (row is null)
            {
                continue;
            }

            byId[id] = new MainScheduleFacts(
                row.OwnerType,
                ScheduleCheck.StateOf(checks.Where(c => c.ScheduleTemplateId == id)) == ScheduleCheckState.Checked,
                row.TenantScope,
                row.OwnerUserId?.Value,
                HasStages: row.HasStageLine);
        }

        return id => byId.GetValueOrDefault(id.Value);
    }

    /// <summary>
    /// The listing's answer to "does this row have a stage line a plot can follow?": it stores its days and lists stages (the old rule, unchanged), or - spec:
    /// plr-d10 schedule slice 3 - it is written in the task format and has stages (listed in <c>Stages</c>, or in <c>DraftStages</c> when no work stores a day). The
    /// same answer as <see cref="ScheduleTemplate.HasStageLine"/> on the row.
    /// </summary>
    public static bool HasStageLine(ScheduleTemplateDto template) =>
        (template.HasStoredDays == true && template.Stages.Count > 0)
        || (template.HasTaskFormat == true && (template.Stages.Count > 0 || (template.DraftStages?.Count ?? 0) > 0));
}
