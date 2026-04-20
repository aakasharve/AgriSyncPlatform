using System.Security.Claims;
using ShramSafal.Application.UseCases.Admin.GetOpsHealth;

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
            var role = EndpointActorContext.GetActorRole(user);
            if (!string.Equals(role, "admin", StringComparison.OrdinalIgnoreCase))
            {
                return Results.Forbid();
            }

            if (!EndpointActorContext.TryGetUserId(user, out var actorId))
            {
                return Results.Unauthorized();
            }

            var result = await handler.HandleAsync(new GetOpsHealthQuery(actorId), ct);
            return result.IsSuccess
                ? Results.Ok(result.Value)
                : Results.Forbid();
        })
        .WithName("GetAdminOpsHealth");

        return group;
    }
}
