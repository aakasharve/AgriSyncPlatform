using System.Security.Claims;
using ShramSafal.Application.UseCases.Admin.GetOpsHealth;
using ShramSafal.Application.UseCases.Admin.GetOpsErrors;
using ShramSafal.Application.UseCases.Admin.GetOpsVoice;

namespace ShramSafal.Api.Endpoints;

/// <summary>
/// Admin-only endpoints. All routes require the caller to have
/// actorRole = "admin" claim (issued only to the seeded admin user).
/// Returns 403 for any non-admin request — response shape is not leaked.
/// </summary>
public static class AdminEndpoints
{
    public static RouteGroupBuilder MapAdminEndpoints(this RouteGroupBuilder group)
    {
        group.MapGet("/admin/ops/health", async (
            ClaimsPrincipal user,
            GetOpsHealthHandler handler,
            CancellationToken ct) =>
        {
            if (!IsAdmin(user, out var actorId)) return Results.Forbid();
            var result = await handler.HandleAsync(new GetOpsHealthQuery(actorId), ct);
            return result.IsSuccess ? Results.Ok(result.Value) : Results.Forbid();
        })
        .WithName("GetAdminOpsHealth")
        .CacheOutput("AdminLive");

        group.MapGet("/admin/ops/errors", async (
            ClaimsPrincipal user,
            GetOpsErrorsHandler handler,
            int page,
            int pageSize,
            string? endpoint,
            string? since,
            CancellationToken ct) =>
        {
            if (!IsAdmin(user, out var actorId)) return Results.Forbid();
            DateTime? sinceDate = DateTime.TryParse(since, out var dt) ? dt : null;
            var result = await handler.HandleAsync(
                new GetOpsErrorsQuery(
                    Math.Max(1, page),
                    Math.Clamp(pageSize, 10, 200),
                    endpoint,
                    sinceDate,
                    actorId), ct);
            return result.IsSuccess ? Results.Ok(result.Value) : Results.Problem();
        })
        .WithName("GetAdminOpsErrors")
        .CacheOutput("AdminLive");

        group.MapGet("/admin/ops/voice", async (
            ClaimsPrincipal user,
            GetOpsVoiceHandler handler,
            int days,
            CancellationToken ct) =>
        {
            if (!IsAdmin(user, out var actorId)) return Results.Forbid();
            var result = await handler.HandleAsync(
                new GetOpsVoiceQuery(Math.Clamp(days, 7, 30), actorId), ct);
            return result.IsSuccess ? Results.Ok(result.Value) : Results.Problem();
        })
        .WithName("GetAdminOpsVoice")
        .CacheOutput("AdminLive");

        return group;
    }

    private static bool IsAdmin(ClaimsPrincipal user, out Guid actorId)
    {
        actorId = Guid.Empty;
        if (!string.Equals(EndpointActorContext.GetActorRole(user), "admin",
                StringComparison.OrdinalIgnoreCase)) return false;
        return EndpointActorContext.TryGetUserId(user, out actorId);
    }
}
