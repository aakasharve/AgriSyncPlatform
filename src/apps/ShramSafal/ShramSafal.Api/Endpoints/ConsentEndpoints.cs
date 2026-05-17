// spec: data-principle-spine-2026-05-05/06.2
//
// Sub-phase 06.2 — consent surface that owns:
//
//   GET  /shramsafal/consent/me  → GetConsentHandler
//   PUT  /shramsafal/consent/me  → UpdateConsentHandler
//
// Both require a bearer token (parent /shramsafal group already calls
// RequireAuthorization()); both short-circuit to 401 when no caller
// identity can be extracted from the JWT.
//
// Route prefix follows the same /shramsafal/* convention sub-phase 05.1
// established (NOT the bare /api/consent/* shown in the plan body) so
// the AuditContextMiddleware + TenantTransactionMiddleware stack already
// covers both routes.

using AgriSync.BuildingBlocks.Audit;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.UseCases.Consent.GetConsent;
using ShramSafal.Application.UseCases.Consent.UpdateConsent;
using ShramSafal.Domain.Common;

namespace ShramSafal.Api.Endpoints;

public static class ConsentEndpoints
{
    public static RouteGroupBuilder MapConsentEndpoints(this RouteGroupBuilder group)
    {
        group.MapGet("/consent/me", HandleGetConsentAsync)
            .WithName("GetConsentForCurrentUser")
            .RequireAuthorization();

        group.MapPut("/consent/me", HandleUpdateConsentAsync)
            .WithName("UpdateConsentForCurrentUser")
            .RequireAuthorization();

        return group;
    }

    private static async Task<IResult> HandleGetConsentAsync(
        HttpContext httpContext,
        GetConsentHandler handler,
        CancellationToken ct)
    {
        if (!EndpointActorContext.TryGetUserId(httpContext.User, out var userId))
        {
            return Results.Unauthorized();
        }

        var result = await handler.HandleAsync(userId, ct);
        if (!result.IsSuccess)
        {
            return ToErrorResult(result.Error);
        }

        return Results.Ok(result.Value);
    }

    private static async Task<IResult> HandleUpdateConsentAsync(
        HttpContext httpContext,
        UpdateConsentRequest request,
        UpdateConsentHandler handler,
        CancellationToken ct)
    {
        if (!EndpointActorContext.TryGetUserId(httpContext.User, out var userId))
        {
            return Results.Unauthorized();
        }

        if (request is null)
        {
            return Results.BadRequest(new
            {
                error = ShramSafalErrors.InvalidCommand.Code,
                message = "Request body is required.",
            });
        }

        var (deviceId, ipHash) = httpContext.AuditClaims();
        var appVersion = ResolveClientAppVersion(httpContext);

        var command = new UpdateConsentCommand(
            UserId: userId,
            FullHistoryJournal: request.FullHistoryJournal,
            CrossFarmAggregation: request.CrossFarmAggregation,
            ResearchCorpusExport: request.ResearchCorpusExport,
            LanguageShown: request.LanguageShown ?? string.Empty,
            ConsentTextVersion: request.ConsentTextVersion ?? 1,
            ClientAppVersion: appVersion,
            AuditDeviceId: deviceId,
            AuditIpHash: ipHash);

        var result = await handler.HandleAsync(command, ct);
        if (!result.IsSuccess)
        {
            return ToErrorResult(result.Error);
        }

        return Results.Ok(result.Value);
    }

    // Mirror of SecurityEndpoints.ToErrorResult / ResolveClientAppVersion
    // (kept local per the SecurityEndpoints precedent — single source of
    // behaviour per endpoint file, refactor to a shared adapter when a
    // third file needs the same mapping).
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

// spec: data-principle-spine-2026-05-05/06.2
//
// Wire shape for PUT /shramsafal/consent/me. Toggles are nullable so a
// client can flip one without re-sending the other two; LanguageShown +
// ConsentTextVersion required (used to stamp the audit row).
public sealed record UpdateConsentRequest(
    bool? FullHistoryJournal,
    bool? CrossFarmAggregation,
    bool? ResearchCorpusExport,
    string? LanguageShown,
    int? ConsentTextVersion);
