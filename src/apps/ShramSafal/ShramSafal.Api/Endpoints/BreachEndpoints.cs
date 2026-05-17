// spec: data-principle-spine-2026-05-05/08.5
//
// DPDP §8(6) + 2025 Rules Rule 7 breach endpoint (admin-only).
// Phase 08 scaffolding per OQ-5: records a BreachIncident row + emits
// AuditEvent. NO SendGrid wire — the handler logs "notification
// dispatch deferred to Phase 12+". Counsel finalises the LRP-tagged
// templates under _COFOUNDER/.../Legal/templates/ before Phase 12+
// goes live.

using AgriSync.BuildingBlocks.Audit;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Admin.Ports;
using ShramSafal.Application.UseCases.Privacy.ReportBreach;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Privacy;

namespace ShramSafal.Api.Endpoints;

public static class BreachEndpoints
{
    public static RouteGroupBuilder MapBreachEndpoints(this RouteGroupBuilder group)
    {
        group.MapPost("/admin/breach/report", HandleReportBreachAsync)
            .WithName("ReportBreachIncident")
            .RequireAuthorization();

        return group;
    }

    private static async Task<IResult> HandleReportBreachAsync(
        HttpContext httpContext,
        IEntitlementResolver resolver,
        ReportBreachRequest request,
        ReportBreachHandler handler,
        CancellationToken ct)
    {
        var scope = await AdminScopeHelper.ResolveOrDenyAsync(httpContext, resolver, ct);
        if (scope is null) return Results.Empty;
        if (!await AdminScopeHelper.RequirePlatformAdminAsync(httpContext, scope)) return Results.Empty;

        if (request is null)
        {
            return Results.BadRequest(new
            {
                error = ShramSafalErrors.InvalidCommand.Code,
                message = "Request body is required.",
            });
        }

        if (!EndpointActorContext.TryGetUserId(httpContext.User, out var reporterId))
        {
            return Results.Unauthorized();
        }

        if (!Enum.TryParse<BreachSeverity>(request.Severity, ignoreCase: true, out var severity))
        {
            return Results.BadRequest(new
            {
                error = ShramSafalErrors.InvalidCommand.Code,
                message = "Severity must be one of Low/Medium/High/Critical.",
            });
        }

        var (deviceId, ipHash) = httpContext.AuditClaims();
        var appVersion = httpContext.Request.Headers["X-App-Version"].FirstOrDefault() ?? "unknown";

        var command = new ReportBreachCommand(
            ReporterUserId: reporterId,
            Severity: severity,
            ScopeDescription: request.ScopeDescription ?? string.Empty,
            AffectedUserCount: request.AffectedUserCount ?? 0,
            ClientAppVersion: appVersion,
            AuditDeviceId: deviceId,
            AuditIpHash: ipHash);

        var result = await handler.HandleAsync(command, ct);
        if (!result.IsSuccess)
        {
            var body = new { error = result.Error.Code, message = result.Error.Description };
            return result.Error.Kind switch
            {
                ErrorKind.Validation => Results.BadRequest(body),
                ErrorKind.Unauthenticated => Results.Json(body, statusCode: StatusCodes.Status401Unauthorized),
                ErrorKind.Forbidden => Results.Json(body, statusCode: StatusCodes.Status403Forbidden),
                _ => Results.BadRequest(body),
            };
        }

        return Results.Accepted(value: result.Value);
    }
}

public sealed record ReportBreachRequest(
    string? Severity,
    string? ScopeDescription,
    int? AffectedUserCount);
