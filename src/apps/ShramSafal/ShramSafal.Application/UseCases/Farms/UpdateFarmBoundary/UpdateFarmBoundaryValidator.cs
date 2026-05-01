using System.Text.Json;
using AgriSync.BuildingBlocks.Application.PipelineBehaviors;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Domain.Common;

namespace ShramSafal.Application.UseCases.Farms.UpdateFarmBoundary;

/// <summary>
/// T-IGH-03-PIPELINE-ROLLOUT (UpdateFarmBoundary): caller-shape +
/// payload-shape validation moves OUT of the handler body into the
/// <see cref="ValidationBehavior{TCommand,TResult}"/> pipeline stage.
///
/// <para>
/// Validation surface (all yield <see cref="ShramSafalErrors.InvalidCommand"/>):
/// <list type="bullet">
/// <item>Empty <see cref="UpdateFarmBoundaryCommand.FarmId"/> or
/// <see cref="UpdateFarmBoundaryCommand.ActorUserId"/>.</item>
/// <item>Whitespace <see cref="UpdateFarmBoundaryCommand.PolygonGeoJson"/>.</item>
/// <item><see cref="UpdateFarmBoundaryCommand.CentreLat"/> outside [-90, 90]
/// or <see cref="UpdateFarmBoundaryCommand.CentreLng"/> outside
/// [-180, 180] (or NaN/Infinity).</item>
/// <item><see cref="UpdateFarmBoundaryCommand.PolygonGeoJson"/> is not
/// a parseable GeoJSON Feature or Polygon/MultiPolygon under the
/// 250 KB ceiling.</item>
/// <item><see cref="UpdateFarmBoundaryCommand.CalculatedAreaAcres"/>
/// is non-positive.</item>
/// </list>
/// </para>
///
/// <para>
/// The handler body still owns: farm-existence lookup (FarmNotFound),
/// owner check (Forbidden — both extracted into
/// <see cref="UpdateFarmBoundaryAuthorizer"/>), the
/// <c>OwnerAccountId.IsEmpty</c> defense-in-depth gate (it's
/// I/O-state-bound, can't be expressed against the command alone),
/// boundary versioning, archive, audit, save. The endpoint path
/// (PUT /farms/{id}/boundary) gets the canonical
/// <c>InvalidCommand → FarmNotFound → Forbidden</c> ordering through
/// the pipeline.
/// </para>
/// </summary>
public sealed class UpdateFarmBoundaryValidator : IValidator<UpdateFarmBoundaryCommand>
{
    private const int MaxBoundaryBytes = 250_000;

    public IEnumerable<Error> Validate(UpdateFarmBoundaryCommand command)
    {
        if (command.FarmId == Guid.Empty
            || command.ActorUserId == Guid.Empty
            || string.IsNullOrWhiteSpace(command.PolygonGeoJson)
            || !IsCoordinateInRange(command.CentreLat, -90, 90)
            || !IsCoordinateInRange(command.CentreLng, -180, 180)
            || !IsSupportedBoundaryGeoJson(command.PolygonGeoJson)
            || command.CalculatedAreaAcres <= 0)
        {
            yield return ShramSafalErrors.InvalidCommand;
        }
    }

    private static bool IsCoordinateInRange(double value, double min, double max) =>
        !double.IsNaN(value) && !double.IsInfinity(value) && value >= min && value <= max;

    private static bool IsSupportedBoundaryGeoJson(string polygonGeoJson)
    {
        if (string.IsNullOrWhiteSpace(polygonGeoJson) || polygonGeoJson.Length > MaxBoundaryBytes)
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
            // Malformed GeoJSON returns false (validator yields InvalidCommand).
            // Activity event keeps the parser-rejection observable in traces,
            // mirroring the body's existing observability seam.
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
