namespace ShramSafal.Application.Contracts.Dtos;

public sealed record PlotDto(
    Guid Id,
    Guid FarmId,
    string Name,
    decimal AreaInAcres,
    DateTime CreatedAtUtc,
    DateTime ModifiedAtUtc);
