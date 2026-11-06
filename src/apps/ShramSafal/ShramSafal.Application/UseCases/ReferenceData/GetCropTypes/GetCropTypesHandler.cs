using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.UseCases.ReferenceData.GetScheduleTemplates;

namespace ShramSafal.Application.UseCases.ReferenceData.GetCropTypes;

public sealed class GetCropTypesHandler(GetScheduleTemplatesHandler getScheduleTemplatesHandler)
{
    // spec: plr-d10 lane L8b-1 fix round 1 (review H2) — the crop types of the caller's OWN library.
    public async Task<Result<IReadOnlyList<CropTypeDto>>> HandleAsync(Guid callerUserId, CancellationToken ct = default)
    {
        ct.ThrowIfCancellationRequested();

        var templatesResult = await getScheduleTemplatesHandler.HandleAsync(callerUserId, ct);
        if (!templatesResult.IsSuccess)
        {
            return Result.Failure<IReadOnlyList<CropTypeDto>>(templatesResult.Error);
        }

        var templates = templatesResult.Value ?? [];
        var cropTypes = GetScheduleTemplatesHandler.BuildCropTypes(templates);
        return Result.Success<IReadOnlyList<CropTypeDto>>(cropTypes);
    }
}
