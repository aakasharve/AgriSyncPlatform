// spec: data-principle-spine-2026-05-05/05.2
//
// Sub-phase 05.2 — security surface that issues per-tenant Data
// Encryption Keys (DEKs) for the Phase 05.3 frontend voice-envelope
// pipeline. Two endpoints:
//
//   GET  /shramsafal/security/tenant-dek            → IssueTenantDekHandler
//   POST /shramsafal/security/tenant-dek/resolve   → ResolveTenantDekHandler
//
// Both require a bearer token (RequireAuthorization() on the parent
// /shramsafal group); both short-circuit to 401 when no caller identity
// can be extracted from the JWT.
//
// Route prefix follows the same /shramsafal/* convention sub-phase 05.1
// established (NOT the bare /api/security/* shown in the plan body) so
// the admin/main route mounts share a single tenant-context middleware
// stack.

using System.Security.Claims;
using AgriSync.BuildingBlocks.Audit;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.UseCases.Privacy.IssueTenantDek;
using ShramSafal.Application.UseCases.Privacy.ResolveTenantDek;
using ShramSafal.Domain.Common;

namespace ShramSafal.Api.Endpoints;

public static class SecurityEndpoints
{
    public static RouteGroupBuilder MapSecurityEndpoints(this RouteGroupBuilder group)
    {
        group.MapGet("/security/tenant-dek", HandleIssueTenantDekAsync)
            .WithName("IssueTenantDek")
            .RequireAuthorization();

        group.MapPost("/security/tenant-dek/resolve", HandleResolveTenantDekAsync)
            .WithName("ResolveTenantDek")
            .RequireAuthorization();

        return group;
    }

    private static async Task<IResult> HandleIssueTenantDekAsync(
        HttpContext httpContext,
        IssueTenantDekHandler handler,
        CancellationToken ct)
    {
        if (!EndpointActorContext.TryGetUserId(httpContext.User, out var userId))
        {
            return Results.Unauthorized();
        }

        var (deviceId, ipHash) = httpContext.AuditClaims();
        var appVersion = ResolveClientAppVersion(httpContext);

        var command = new IssueTenantDekCommand(
            UserId: userId,
            ClientAppVersion: appVersion,
            ActorRole: EndpointActorContext.GetActorRole(httpContext.User),
            AuditDeviceId: deviceId,
            AuditIpHash: ipHash);

        var result = await handler.HandleAsync(command, ct);
        if (!result.IsSuccess)
        {
            return ToErrorResult(result.Error);
        }

        var payload = result.Value!;
        return Results.Ok(new
        {
            dekId = payload.DekId,
            dekBase64 = payload.DekBase64,
            expiresAtUtc = payload.ExpiresAtUtc,
        });
    }

    private static async Task<IResult> HandleResolveTenantDekAsync(
        HttpContext httpContext,
        ResolveTenantDekRequest request,
        ResolveTenantDekHandler handler,
        CancellationToken ct)
    {
        if (!EndpointActorContext.TryGetUserId(httpContext.User, out var userId))
        {
            return Results.Unauthorized();
        }

        if (request is null || string.IsNullOrWhiteSpace(request.DekId))
        {
            return Results.BadRequest(new
            {
                error = ShramSafalErrors.InvalidCommand.Code,
                message = "dekId is required."
            });
        }

        var (deviceId, ipHash) = httpContext.AuditClaims();
        var appVersion = ResolveClientAppVersion(httpContext);

        var command = new ResolveTenantDekCommand(
            UserId: userId,
            DekId: request.DekId,
            ClientAppVersion: appVersion,
            ActorRole: EndpointActorContext.GetActorRole(httpContext.User),
            AuditDeviceId: deviceId,
            AuditIpHash: ipHash);

        var result = await handler.HandleAsync(command, ct);
        if (!result.IsSuccess)
        {
            return ToErrorResult(result.Error);
        }

        var payload = result.Value!;
        return Results.Ok(new
        {
            dekBase64 = payload.DekBase64,
        });
    }

    // Mirror of AiEndpoints.ToErrorResult / ResolveClientAppVersion (single
    // source of behaviour per endpoint file — refactor to a shared adapter
    // when a third file needs the same mapping).
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

    private static string ResolveClientAppVersion(HttpContext httpContext)
    {
        var header = httpContext.Request.Headers["X-App-Version"].FirstOrDefault();
        return string.IsNullOrWhiteSpace(header) ? "unknown" : header!.Trim();
    }
}

// spec: data-principle-spine-2026-05-05/05.2
//
// Wire shape for POST /shramsafal/security/tenant-dek/resolve.
public sealed record ResolveTenantDekRequest(string DekId);
