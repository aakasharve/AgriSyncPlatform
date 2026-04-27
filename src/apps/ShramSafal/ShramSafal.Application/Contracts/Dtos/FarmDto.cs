namespace ShramSafal.Application.Contracts.Dtos;

public sealed record FarmDto(
    Guid Id,
    string Name,
    Guid OwnerUserId,
    Guid OwnerAccountId,
    double? CanonicalCentreLat,
    double? CanonicalCentreLng,
    string? CentreSource,
    double WeatherRadiusKm,
    decimal? TotalMappedAreaAcres,
    decimal? TotalGovtAreaAcres,
    string GeoValidationStatus,
    DateTime CreatedAtUtc,
    DateTime ModifiedAtUtc);
