// spec: data-principle-spine-2026-05-05/08.2
// spec: data-principle-spine-2026-05-05/08.3
//
// DPDP §11 / §12 data-rights endpoints per Phase 08 R0/OQ-2 verdict
// (OPTION_C: self-serve AND admin override). Self-serve mounts under
// /shramsafal/me/*; admin-on-behalf-of mounts under
// /shramsafal/admin/erasure/request and requires platform-admin claim
// via AdminScopeHelper (BreachEndpoints precedent). Both endpoints
// enqueue identical ErasureRequest payload; the audit trail
// differentiates via RequestedByUserId (admin) vs OnBehalfOfUserId
// (target). All routes require bearer token.

using AgriSync.BuildingBlocks.Audit;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Admin.Ports;
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

        // Phase 08 R0/OQ-2 OPTION_C — admin-on-behalf-of erasure trigger.
        // Required for fraud, account closure, support-ticket-driven flows
        // where the principal cannot or will not initiate. AdminScopeHelper
        // platform-admin gate matches BreachEndpoints precedent.
        group.MapPost("/admin/erasure/request", HandleAdminErasureRequestAsync)
            .WithName("RequestErasureOnBehalfOfUser")
            .RequireAuthorization();

        return group;
    }

    public sealed record AdminErasureRequest(Guid TargetUserId);

    private static async Task<IResult> HandleAdminErasureRequestAsync(
        HttpContext httpContext,
        IEntitlementResolver resolver,
        AdminErasureRequest request,
        RequestErasureHandler handler,
        CancellationToken ct)
    {
        var scope = await AdminScopeHelper.ResolveOrDenyAsync(httpContext, resolver, ct);
        if (scope is null) return Results.Empty;
        if (!await AdminScopeHelper.RequirePlatformAdminAsync(httpContext, scope)) return Results.Empty;

        if (request is null || request.TargetUserId == Guid.Empty)
        {
            return Results.BadRequest(new
            {
                error = ShramSafalErrors.InvalidCommand.Code,
                message = "TargetUserId is required.",
            });
        }

        if (!EndpointActorContext.TryGetUserId(httpContext.User, out var adminUserId))
        {
            return Results.Unauthorized();
        }

        var (deviceId, ipHash) = httpContext.AuditClaims();
        var appVersion = ResolveAppVersion(httpContext);

        // RequestedByUserId = admin (the actor); OnBehalfOfUserId = target
        // (the principal whose data is being erased). Worker enqueues
        // identical anonymization regardless of trigger; audit row carries
        // both fields so reviewers can distinguish self-serve from admin-
        // initiated post-hoc.
        var command = new RequestErasureCommand(
            RequestedByUserId: adminUserId,
            OnBehalfOfUserId: request.TargetUserId,
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
