// spec: data-principle-spine-2026-05-05/08.2
// spec: data-principle-spine-2026-05-05/08.3
//
// DPDP §11 / §12 data-rights endpoints. Self-serve flow only here
// (the admin-on-behalf-of erasure endpoint lives in AdminEndpoints —
// see /shramsafal/admin/erasure/request). All routes mount under
// /shramsafal/me/* and require the bearer token.

using AgriSync.BuildingBlocks.Audit;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.UseCases.Privacy.RequestErasure;
using ShramSafal.Application.UseCases.Privacy.RequestExport;
using ShramSafal.Domain.Common;

namespace ShramSafal.Api.Endpoints;

public static class DataRightsEndpoints
{
    public static RouteGroupBuilder MapDataRightsEndpoints(this RouteGroupBuilder group)
    {
        group.MapPost("/me/erasure/request", HandleRequestErasureAsync)
            .WithName("RequestErasureForCurrentUser")
            .RequireAuthorization();

        group.MapPost("/me/export/request", HandleRequestExportAsync)
            .WithName("RequestExportForCurrentUser")
            .RequireAuthorization();

        return group;
    }

    private static async Task<IResult> HandleRequestErasureAsync(
        HttpContext httpContext,
        RequestErasureHandler handler,
        CancellationToken ct)
    {
        if (!EndpointActorContext.TryGetUserId(httpContext.User, out var userId))
        {
            return Results.Unauthorized();
        }

        var (deviceId, ipHash) = httpContext.AuditClaims();
        var appVersion = ResolveAppVersion(httpContext);

        var command = new RequestErasureCommand(
            RequestedByUserId: userId,
            OnBehalfOfUserId: null,
            ClientAppVersion: appVersion,
            AuditDeviceId: deviceId,
            AuditIpHash: ipHash);

        var result = await handler.HandleAsync(command, ct);
        if (!result.IsSuccess)
        {
            return ToErrorResult(result.Error);
        }

        // 202 Accepted per OQ-6 (async + 48h SLA).
        return Results.Accepted(value: result.Value);
    }

    private static async Task<IResult> HandleRequestExportAsync(
        HttpContext httpContext,
        RequestExportHandler handler,
        CancellationToken ct)
    {
        if (!EndpointActorContext.TryGetUserId(httpContext.User, out var userId))
        {
            return Results.Unauthorized();
        }

        var (deviceId, ipHash) = httpContext.AuditClaims();
        var appVersion = ResolveAppVersion(httpContext);

        var command = new RequestExportCommand(
            RequestedByUserId: userId,
            ClientAppVersion: appVersion,
            AuditDeviceId: deviceId,
            AuditIpHash: ipHash);

        var result = await handler.HandleAsync(command, ct);
        if (!result.IsSuccess)
        {
            return ToErrorResult(result.Error);
        }

        return Results.Accepted(value: result.Value);
    }

    private static IResult ToErrorResult(Error error)
    {
        var body = new { error = error.Code, message = error.Description };
        return error.Kind switch
        {
            ErrorKind.NotFound => Results.NotFound(body),
            ErrorKind.Forbidden => Results.Json(body, statusCode: StatusCodes.Status403Forbidden),
            ErrorKind.Unauthenticated => Results.Json(body, statusCode: StatusCodes.Status401Unauthorized),
            ErrorKind.Conflict => Results.Conflict(body),
            ErrorKind.Validation => Results.BadRequest(body),
            _ => Results.BadRequest(body),
        };
    }

    private static string ResolveAppVersion(HttpContext httpContext)
    {
        var header = httpContext.Request.Headers["X-App-Version"].FirstOrDefault();
        return string.IsNullOrWhiteSpace(header) ? "unknown" : header!.Trim();
    }
}
