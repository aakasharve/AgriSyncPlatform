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
// D1 (2026-10-15) - WHICH TENANT. These routes used to read the owner account
// from TenantContext, which nothing on this route ever set (the JWT carries no
// owner-account claim; only ShramSafalAuthorizationEnforcer sets it, and these
// routes never reach it), so every call answered 401 join.unauthenticated.
// They now take the farm the caller is working in (query `farmId` on GET, body
// `farmId` on POST) and establish the tenant the same way the other farm routes
// do: ICallerFarmTenantScope validates the caller's membership under their own
// user-scoped RLS and only then sets the farm GUCs. The handler then re-checks
// the stricter Active-only rule and derives the owner account FROM THE FARM ROW.
// The owner account is never accepted from the request.
//   missing/empty farmId        -> 400
//   not a member / no such farm -> 403 (identical, so existence does not leak)
//   pending/suspended/revoked   -> 403
//
// Route prefix follows the same /shramsafal/* convention sub-phase 05.1
// established (NOT the bare /api/security/* shown in the plan body) so
// the admin/main route mounts share a single tenant-context middleware
// stack.

using System.Security.Claims;
using AgriSync.BuildingBlocks.Audit;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
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
        ICallerFarmTenantScope scope,
        Guid? farmId,
        CancellationToken ct)
    {
        if (!EndpointActorContext.TryGetUserId(httpContext.User, out var userId))
        {
            return Results.Unauthorized();
        }

        if (farmId is not { } requestedFarmId || requestedFarmId == Guid.Empty)
        {
            return FarmIdRequired();
        }

        var scopeResult = await scope.EstablishForCallerAsync(requestedFarmId, userId, ct);
        if (!scopeResult.IsSuccess)
        {
            return ToErrorResult(scopeResult.Error);
        }

        var (deviceId, ipHash) = httpContext.AuditClaims();
        var appVersion = ResolveClientAppVersion(httpContext);

        var command = new IssueTenantDekCommand(
            UserId: userId,
            FarmId: requestedFarmId,
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
        ICallerFarmTenantScope scope,
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

        if (request.FarmId is not { } requestedFarmId || requestedFarmId == Guid.Empty)
        {
            return FarmIdRequired();
        }

        var scopeResult = await scope.EstablishForCallerAsync(requestedFarmId, userId, ct);
        if (!scopeResult.IsSuccess)
        {
            return ToErrorResult(scopeResult.Error);
        }

        var (deviceId, ipHash) = httpContext.AuditClaims();
        var appVersion = ResolveClientAppVersion(httpContext);

        var command = new ResolveTenantDekCommand(
            UserId: userId,
            FarmId: requestedFarmId,
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

    private static IResult FarmIdRequired() => Results.BadRequest(new
    {
        error = ShramSafalErrors.InvalidCommand.Code,
        message = "farmId is required."
    });

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
// FarmId is nullable + optional so an OLD client (which sends only dekId) still
// deserializes and is answered with a clean 400 instead of a binding failure.
public sealed record ResolveTenantDekRequest(string DekId, Guid? FarmId = null);
