using AgriSync.BuildingBlocks.Results;
using ShramSafal.Domain.Common;

namespace ShramSafal.Api.Endpoints;

/// <summary>
/// spec: plr-d10 lane MU-4 fix pass 2 (N4) — a REST refusal by the plot rule (<c>ShramSafal.PlotScope.Forbidden</c>) is a 403
/// that carries its code and words, so the person who tried (the owner assigning a task to someone whose plots do not
/// include it, too) is told the rule, never shown a bare "forbidden". Every other refusal answers as before.
/// </summary>
public static class PlotRefusalResult
{
    public static IResult? For(Error error) =>
        error.Code == ShramSafalErrors.PlotScopeForbidden.Code
            ? Results.Json(new { error = error.Code, message = error.Description }, statusCode: StatusCodes.Status403Forbidden)
            : null;
}
