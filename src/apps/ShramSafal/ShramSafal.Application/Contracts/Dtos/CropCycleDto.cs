namespace ShramSafal.Application.Contracts.Dtos;

public sealed record CropCycleDto(
    Guid Id,
    Guid FarmId,
    Guid PlotId,
    string CropName,
    string Stage,
    DateOnly StartDate,
    DateOnly? EndDate,
    DateTime CreatedAtUtc,
    DateTime ModifiedAtUtc);
