using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.UseCases.ReferenceData.GetScheduleTemplates;

namespace ShramSafal.Application.UseCases.ReferenceData.GetCropTypes;

public sealed class GetCropTypesHandler
{
    public Task<Result<IReadOnlyList<CropTypeDto>>> HandleAsync(CancellationToken ct = default)
    {
        ct.ThrowIfCancellationRequested();
        return Task.FromResult(Result.Success<IReadOnlyList<CropTypeDto>>(ReferenceDataCatalog.CropTypes));
    }
}
