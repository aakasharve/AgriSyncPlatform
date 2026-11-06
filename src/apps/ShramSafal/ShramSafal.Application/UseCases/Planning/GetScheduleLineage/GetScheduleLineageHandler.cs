using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.Ports.External;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Planning.GetScheduleLineage;

public sealed class GetScheduleLineageHandler(
    IShramSafalRepository repository,
    IUserDirectory userDirectory)
{
    public async Task<Result<IReadOnlyList<ScheduleLineageDto>>> HandleAsync(
        GetScheduleLineageQuery query,
        CancellationToken ct = default)
    {
        if (query.RootTemplateId == Guid.Empty)
            return Result.Failure<IReadOnlyList<ScheduleLineageDto>>(ShramSafalErrors.InvalidCommand);

        // spec: plr-d10 lane F99 fix pass 1 (review F-8) — the lineage names authors and the private and team clones of a
        // template, so only what the caller may see is answered: Public templates, his own (any scope), and Team templates
        // written by the owner of a farm he works on. A Private or Team template of anyone else, and a Licensed one (not
        // sold yet), is not in his answer — then a fix to template authoring cannot expose another farmer's work here.
        var all = await VisibleAsync(
            await repository.GetScheduleLineageAsync(query.RootTemplateId, ct), query.CallerUserId, ct);

        var userIds = all
            .Where(t => t.CreatedByUserId.HasValue)
            .Select(t => t.CreatedByUserId!.Value.Value)
            .Distinct();

        var names = await userDirectory.GetDisplayNamesAsync(userIds, ct);

        var dtos = all.Select(t => new ScheduleLineageDto(
            Id: t.Id,
            Name: t.Name,
            Version: t.Version,
            CreatedByUserId: t.CreatedByUserId?.Value,
            CreatedByDisplayName: t.CreatedByUserId.HasValue
                ? names.GetValueOrDefault(t.CreatedByUserId.Value.Value)
                : null,
            TenantScope: t.TenantScope.ToString(),
            PublishedAtUtc: t.PublishedAtUtc,
            DerivedFromTemplateId: t.DerivedFromTemplateId,
            PreviousVersionId: t.PreviousVersionId))
            .ToList();

        return Result.Success<IReadOnlyList<ScheduleLineageDto>>(dtos);
    }

    // spec: plr-d10 lane L8b-1 — the F-8 rule now lives in ONE place (ScheduleLibrary.MaySeeAsync), asked here and by every
    // schedule adoption, so what a lineage shows and what a farmer may adopt cannot drift apart.
    private async Task<List<Domain.Planning.ScheduleTemplate>> VisibleAsync(
        IReadOnlyList<Domain.Planning.ScheduleTemplate> templates, Guid callerUserId, CancellationToken ct)
    {
        var visible = new List<Domain.Planning.ScheduleTemplate>(templates.Count);
        foreach (var template in templates)
        {
            if (await Services.ScheduleLibrary.MaySeeAsync(repository, template, callerUserId, ct))
            {
                visible.Add(template);
            }
        }

        return visible;
    }
}
