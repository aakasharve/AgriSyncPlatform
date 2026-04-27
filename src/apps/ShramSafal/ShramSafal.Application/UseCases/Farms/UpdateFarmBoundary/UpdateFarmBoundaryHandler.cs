using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using System.Text.Json;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Application.UseCases.Farms.UpdateFarmBoundary;

public sealed class UpdateFarmBoundaryHandler(
    IShramSafalRepository repository,
    IIdGenerator idGenerator,
    IClock clock)
{
    public async Task<Result<FarmDto>> HandleAsync(
        UpdateFarmBoundaryCommand command,
        CancellationToken ct = default)
    {
        if (command.FarmId == Guid.Empty ||
            command.ActorUserId == Guid.Empty ||
            string.IsNullOrWhiteSpace(command.PolygonGeoJson) ||
            !IsCoordinateInRange(command.CentreLat, -90, 90) ||
            !IsCoordinateInRange(command.CentreLng, -180, 180) ||
            !IsSupportedBoundaryGeoJson(command.PolygonGeoJson) ||
            command.CalculatedAreaAcres <= 0)
        {
            return Result.Failure<FarmDto>(ShramSafalErrors.InvalidCommand);
        }

        var farm = await repository.GetFarmByIdAsync(command.FarmId, ct);
        if (farm is null)
        {
            return Result.Failure<FarmDto>(ShramSafalErrors.FarmNotFound);
        }

        if (!await repository.IsUserOwnerOfFarmAsync(command.FarmId, command.ActorUserId, ct))
        {
            return Result.Failure<FarmDto>(ShramSafalErrors.Forbidden);
        }

        if (farm.OwnerAccountId.IsEmpty)
        {
            return Result.Failure<FarmDto>(ShramSafalErrors.InvalidCommand);
        }

        var nowUtc = clock.UtcNow;
        farm.SetCanonicalCentre(
            command.CentreLat,
            command.CentreLng,
            FarmCentreSource.PolygonCentroid,
            nowUtc);
        farm.SetMappedArea(command.CalculatedAreaAcres, nowUtc);
        farm.MarkGeoValidation(GeoValidationStatus.SelfDeclared, nowUtc);

        var activeBoundary = await repository.GetActiveFarmBoundaryAsync(command.FarmId, ct);
        var nextVersion = (activeBoundary?.Version ?? 0) + 1;
        activeBoundary?.Archive(nowUtc);

        var boundary = FarmBoundary.Create(
            idGenerator.New(),
            farm.Id,
            farm.OwnerAccountId,
            command.PolygonGeoJson,
            command.CalculatedAreaAcres,
            FarmBoundarySource.UserDrawn,
            nextVersion,
            nowUtc);

        await repository.AddFarmBoundaryAsync(boundary, ct);
        await repository.AddAuditEventAsync(
            AuditEvent.Create(
                farm.Id,
                "Farm",
                farm.Id,
                "BoundaryUpdated",
                command.ActorUserId,
                command.ActorRole ?? "unknown",
                new
                {
                    farmId = farm.Id,
                    ownerAccountId = farm.OwnerAccountId,
                    boundaryId = boundary.Id,
                    centreSource = FarmCentreSource.PolygonCentroid.ToString(),
                    command.CalculatedAreaAcres
                },
                command.ClientCommandId,
                nowUtc),
            ct);
        await repository.SaveChangesAsync(ct);

        return Result.Success(farm.ToDto());
    }

    private static bool IsCoordinateInRange(double value, double min, double max) =>
        !double.IsNaN(value) && !double.IsInfinity(value) && value >= min && value <= max;

    private static bool IsSupportedBoundaryGeoJson(string polygonGeoJson)
    {
        const int maxBoundaryBytes = 250_000;
        if (string.IsNullOrWhiteSpace(polygonGeoJson) || polygonGeoJson.Length > maxBoundaryBytes)
        {
            return false;
        }

        try
        {
            using var document = JsonDocument.Parse(polygonGeoJson);
            if (document.RootElement.ValueKind is not JsonValueKind.Object)
            {
                return false;
            }

            var type = document.RootElement.TryGetProperty("type", out var typeElement)
                ? typeElement.GetString()
                : null;

            if (string.Equals(type, "Feature", StringComparison.OrdinalIgnoreCase))
            {
                if (!document.RootElement.TryGetProperty("geometry", out var geometry) ||
                    geometry.ValueKind is not JsonValueKind.Object ||
                    !geometry.TryGetProperty("type", out var geometryType))
                {
                    return false;
                }

                type = geometryType.GetString();
            }

            return string.Equals(type, "Polygon", StringComparison.OrdinalIgnoreCase) ||
                   string.Equals(type, "MultiPolygon", StringComparison.OrdinalIgnoreCase);
        }
        catch (JsonException)
        {
            return false;
        }
    }
}
