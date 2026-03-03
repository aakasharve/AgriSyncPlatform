using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.UseCases.ReferenceData.GetScheduleTemplates;

namespace ShramSafal.Application.UseCases.ReferenceData.GetCropTypes;

public sealed class GetCropTypesHandler(GetScheduleTemplatesHandler getScheduleTemplatesHandler)
{
    public async Task<Result<IReadOnlyList<CropTypeDto>>> HandleAsync(CancellationToken ct = default)
    {
        ct.ThrowIfCancellationRequested();

        var templatesResult = await getScheduleTemplatesHandler.HandleAsync(ct);
        if (!templatesResult.IsSuccess)
        {
            return Result.Failure<IReadOnlyList<CropTypeDto>>(templatesResult.Error);
        }

        var templates = templatesResult.Value ?? [];
        var cropTypes = GetScheduleTemplatesHandler.BuildCropTypes(templates);
        return Result.Success<IReadOnlyList<CropTypeDto>>(cropTypes);
    }
}
