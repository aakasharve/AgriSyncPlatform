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
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Privacy.CancelErasure;
using ShramSafal.Application.UseCases.Privacy.GetErasureRequests;
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

        // spec: plr-d10 lane F99 fix pass 1, item 11 (founder D-71) — a request waits 30 days; until then the person who
        // asked may cancel it. His own requests (with the date erasure starts) and the cancel.
        group.MapGet("/me/erasure/requests", HandleListMyErasureRequestsAsync)
            .WithName("ListMyErasureRequests")
            .RequireAuthorization();

        group.MapPost("/me/erasure/{requestId:guid}/cancel", HandleCancelErasureAsync)
            .WithName("CancelMyErasureRequest")
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
        ICallerUserTenantScope userScope,
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

        // lane F99 — his own request about his own data names no farm, so it is written under his own user scope: the route
        // opened none, and its write failed closed in TenantConnectionInterceptor (500 for everyone, the request not kept).
        var result = await userScope.RunForCallerAsync(userId, token => handler.HandleAsync(command, token), ct);
        if (!result.IsSuccess)
        {
            return ToErrorResult(result.Error);
        }

        // 202 Accepted per OQ-6 (async + 48h SLA).
        return Results.Accepted(value: result.Value);
    }

    private static async Task<IResult> HandleListMyErasureRequestsAsync(
        HttpContext httpContext,
        GetMyErasureRequestsHandler handler,
        ICallerUserTenantScope userScope,
        CancellationToken ct)
    {
        if (!EndpointActorContext.TryGetUserId(httpContext.User, out var userId))
        {
            return Results.Unauthorized();
        }

        // His own requests name no farm: read under his own user scope, as the request itself is written.
        var requests = await userScope.RunForCallerAsync(userId, token => handler.HandleAsync(userId, token), ct);
        return Results.Ok(requests);
    }

    private static async Task<IResult> HandleCancelErasureAsync(
        Guid requestId,
        HttpContext httpContext,
        CancelErasureHandler handler,
        ICallerUserTenantScope userScope,
        CancellationToken ct)
    {
        if (!EndpointActorContext.TryGetUserId(httpContext.User, out var userId))
        {
            return Results.Unauthorized();
        }

        var (deviceId, ipHash) = httpContext.AuditClaims();
        var command = new CancelErasureCommand(
            RequestId: requestId,
            CallerUserId: userId,
            ClientAppVersion: ResolveAppVersion(httpContext),
            AuditDeviceId: deviceId,
            AuditIpHash: ipHash);

        // Another person's request and a made-up id answer the same 404 (E4); one that has started answers 409 with
        // its reason.
        var result = await userScope.RunForCallerAsync(userId, token => handler.HandleAsync(command, token), ct);
        return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
    }

    private static async Task<IResult> HandleRequestExportAsync(
        HttpContext httpContext,
        RequestExportHandler handler,
        ICallerUserTenantScope userScope,
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

        // lane F99 — the same: his own export request is written under his own user scope (it failed closed: 500).
        var result = await userScope.RunForCallerAsync(userId, token => handler.HandleAsync(command, token), ct);
        if (!result.IsSuccess)
        {
            return ToErrorResult(result.Error);
        }

        return Results.Accepted(value: result.Value);
    }

    private static IResult ToErrorResult(Error error)
        => ErrorCapture.Stamp(error, MapErrorResult(error));

    private static IResult MapErrorResult(Error error)
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
