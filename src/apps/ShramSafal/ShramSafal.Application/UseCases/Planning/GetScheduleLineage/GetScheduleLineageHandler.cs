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

        var all = await repository.GetScheduleLineageAsync(query.RootTemplateId, ct);

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
}
