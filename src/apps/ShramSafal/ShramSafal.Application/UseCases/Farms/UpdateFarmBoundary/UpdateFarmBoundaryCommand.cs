namespace ShramSafal.Application.UseCases.Farms.UpdateFarmBoundary;

public sealed record UpdateFarmBoundaryCommand(
    Guid FarmId,
    Guid ActorUserId,
    string PolygonGeoJson,
    double CentreLat,
    double CentreLng,
    decimal CalculatedAreaAcres,
    string? ActorRole = null,
    string? ClientCommandId = null);

