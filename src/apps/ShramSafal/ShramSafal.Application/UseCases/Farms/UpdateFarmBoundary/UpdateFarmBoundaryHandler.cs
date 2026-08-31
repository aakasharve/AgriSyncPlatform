using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using System.Text.Json;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Application.UseCases.Farms.UpdateFarmBoundary;

/// <summary>
/// Records a new farm boundary (canonical centre, mapped area, polygon
/// + GeoValidationStatus.SelfDeclared). Archives any prior active
/// boundary and bumps the version.
///
/// <para>
/// T-IGH-03-PIPELINE-ROLLOUT (UpdateFarmBoundary): caller-shape +
/// payload-shape validation lives in
/// <see cref="UpdateFarmBoundaryValidator"/>; farm-existence + owner
/// authorization lives in <see cref="UpdateFarmBoundaryAuthorizer"/>.
/// When this handler is resolved via the pipeline, both run before the
/// body. The body retains its inline gates (farm lookup, owner check,
/// <c>OwnerAccountId.IsEmpty</c> defense) as defense-in-depth for
/// direct callers; the OwnerAccountId check is intentionally not
/// extracted because it's I/O-state-bound (not a property of the
/// command alone).
/// </para>
/// </summary>
public sealed class UpdateFarmBoundaryHandler(
    IShramSafalRepository repository,
    IIdGenerator idGenerator,
    IClock clock)
    : IHandler<UpdateFarmBoundaryCommand, FarmDto>
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

        // Stage A0 / A3 — the ledger records the actor's role ON THIS FARM.
        //
        // The role was never client-spoofable: it arrived server-derived from the signed
        // JWT membership claim (EndpointActorContext.cs:26-43). The defect is that the
        // claim carries ONE role per account, so an owner of another farm acting here was
        // recorded as an owner here.
        //
        // This is the same resolver IsUserOwnerOfFarmAsync just used above
        // (ShramSafalRepository.cs:92-96 delegates straight to it), so the audit trail and
        // the access decision cannot disagree. Null is therefore unreachable here by
        // construction; "unknown" exists to prevent a fabricated role, never as a normal
        // outcome, and a real one in the ledger means a broken tenant scope worth chasing.
        var resolvedActorRole = await repository.GetUserRoleForFarmAsync(
            command.FarmId, command.ActorUserId, ct);

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
        // DATA_PRINCIPLE_SPINE sub-phase 04.3b — migrate from AuditEvent.Create
        // (sentinel provenance) to AuditEventFactory.Create with the real
        // X-Device-Id / IP hash / X-App-Version sourced from the endpoint's
        // AuditContextAccessor.
        await repository.AddAuditEventAsync(
            AuditEventFactory.Create(
                entityType: "Farm",
                entityId: farm.Id,
                action: "BoundaryUpdated",
                actorUserId: command.ActorUserId,
                actorRole: resolvedActorRole?.ToString().ToLowerInvariant() ?? "unknown",
                payload: new
                {
                    farmId = farm.Id,
                    ownerAccountId = farm.OwnerAccountId,
                    boundaryId = boundary.Id,
                    centreSource = FarmCentreSource.PolygonCentroid.ToString(),
                    command.CalculatedAreaAcres
                },
                farmId: farm.Id,
                clientCommandId: command.ClientCommandId,
                appVersion: command.ClientAppVersion,
                deviceId: command.AuditDeviceId,
                ipHash: command.AuditIpHash,
                sourceAiJobId: null),
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
        catch (JsonException ex)
        {
            // Sub-plan 03 Task 10: malformed GeoJSON returns false (so
            // the caller surfaces a typed validation error). Activity
            // event keeps the parser-rejection observable in traces.
            System.Diagnostics.Activity.Current?.AddEvent(new System.Diagnostics.ActivityEvent(
                "UpdateFarmBoundary.MalformedGeoJson",
                tags: new System.Diagnostics.ActivityTagsCollection
                {
                    ["exception.type"] = ex.GetType().Name,
                    ["exception.message"] = ex.Message,
                }));
            return false;
        }
    }
}
