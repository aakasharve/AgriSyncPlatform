using AgriSync.SharedKernel.Contracts.Ids;
using ShramSafal.Application.Admin;
using ShramSafal.Application.Admin.Ports;
using ShramSafal.Application.UseCases.Admin.GetCohortPatterns;
using ShramSafal.Application.UseCases.Admin.GetFarmerHealth;
using ShramSafal.Domain.Organizations;

namespace AgriSync.Bootstrapper;

/// <summary>
/// DWC v2 §3.8 — admin endpoints for the Daily Work Closure
/// farmer-health dashboard. Two GETs grouped under
/// <c>/admin/farmer-health</c>:
/// </summary>
/// <list type="bullet">
/// <item><c>GET /admin/farmer-health/{farmId:guid}</c> — Mode A
///   per-farmer drilldown (score breakdown, 14-day timeline, sync
///   state, AI invocation health, verification counts, worker
///   summary). Scope-checked, audit-logged, redacted per
///   <see cref="ModuleKey.FarmerHealth"/>.</item>
/// <item><c>GET /admin/farmer-health/cohort</c> — Mode B cohort
///   patterns (intervention queue, watchlist, distributions, heatmap,
///   trends, top-10 suffering). Same gates.</item>
/// </list>
/// <remarks>
/// <para>
/// Mapped directly on the root <see cref="IEndpointRouteBuilder"/>
/// (not nested under <c>/shramsafal</c>) per the plan's external
/// route contract — admin-web targets <c>/admin/farmer-health/*</c>.
/// </para>
/// <para>
/// The plan sketch invokes a <c>RequireAdminScope()</c> extension
/// that does not exist in this codebase. The W0-A spine instead
/// resolves admin scope via
/// <see cref="AdminScopeHelper.ResolveOrDenyAsync"/> +
/// <see cref="AdminScopeHelper.RequireReadAsync"/> inside each
/// endpoint delegate (see
/// <c>ShramSafal.Api.Endpoints.AdminEndpoints</c>); we follow that
/// established pattern rather than introducing a new abstraction.
/// 401 / 428 / 403 are written by the helper before the handler
/// runs.
/// </para>
/// </remarks>
public static class AdminFarmerHealthEndpoints
{
    public static IEndpointRouteBuilder MapAdminFarmerHealth(this IEndpointRouteBuilder app)
    {
        var grp = app.MapGroup("/admin/farmer-health")
            .WithTags("admin/farmer-health")
            .RequireAuthorization();

        grp.MapGet("/{farmId:guid}", async (
            Guid farmId,
            HttpContext http,
            IEntitlementResolver resolver,
            GetFarmerHealthHandler handler,
            CancellationToken ct) =>
        {
            var scope = await ShramSafal.Api.Endpoints.AdminScopeHelper
                .ResolveOrDenyAsync(http, resolver, ct);
            if (scope is null) return Results.Empty;
            if (!await ShramSafal.Api.Endpoints.AdminScopeHelper
                    .RequireReadAsync(http, scope, ModuleKey.FarmerHealth))
                return Results.Empty;

            var result = await handler.HandleAsync(
                new GetFarmerHealthQuery(scope, farmId), ct);

            if (result.IsSuccess) return Results.Ok(result.Value);
            return result.Error.Kind == AgriSync.BuildingBlocks.Results.ErrorKind.NotFound
                ? Results.NotFound()
                : Results.BadRequest();
        })
        .WithName("GetAdminFarmerHealthDrilldown");

        grp.MapGet("/cohort", async (
            HttpContext http,
            IEntitlementResolver resolver,
            GetCohortPatternsHandler handler,
            CancellationToken ct) =>
        {
            var scope = await ShramSafal.Api.Endpoints.AdminScopeHelper
                .ResolveOrDenyAsync(http, resolver, ct);
            if (scope is null) return Results.Empty;
            if (!await ShramSafal.Api.Endpoints.AdminScopeHelper
                    .RequireReadAsync(http, scope, ModuleKey.FarmerHealth))
                return Results.Empty;

            var result = await handler.HandleAsync(
                new GetCohortPatternsQuery(scope), ct);
            return result.IsSuccess ? Results.Ok(result.Value) : Results.BadRequest();
        })
        .WithName("GetAdminFarmerHealthCohort");

        return app;
    }
}
