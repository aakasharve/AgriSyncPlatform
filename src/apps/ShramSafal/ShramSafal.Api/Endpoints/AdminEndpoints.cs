using Microsoft.AspNetCore.Http;
using ShramSafal.Application.Admin.Ports;
using ShramSafal.Application.UseCases.Admin.GetFarmsList;
using ShramSafal.Application.UseCases.Admin.GetOpsErrors;
using ShramSafal.Application.UseCases.Admin.GetOpsHealth;
using ShramSafal.Application.UseCases.Admin.GetOpsVoice;
using ShramSafal.Application.UseCases.Admin.GetSilentChurn;
using ShramSafal.Application.UseCases.Admin.GetSuffering;
using ShramSafal.Application.UseCases.Admin.GetUsersList;
using ShramSafal.Application.UseCases.Admin.GetWvfdHistory;
using ShramSafal.Domain.Organizations;

namespace ShramSafal.Api.Endpoints;

/// <summary>
/// Admin-only endpoints. Every route resolves the caller's AdminScope via
/// <see cref="IEntitlementResolver"/> (W0-A foundation) and gates on a module key
/// (<see cref="ModuleKey"/>). No ClaimsPrincipal inspection for authorization —
/// the shramsafal:admin claim is no longer stamped as of W0-B.
///
/// Resolver outcomes map to HTTP:
///   Unauthorized  → 401 (no active membership)
///   Ambiguous     → 428 (multi-membership, no X-Active-Org-Id header)
///   NotInOrg      → 403 (X-Active-Org-Id not in user's memberships)
///   ModuleGate    → 403 (caller has a scope, but not for this module)
///
/// See <see cref="AdminScopeHelper"/> for the response-shape contract.
/// </summary>
public static class AdminEndpoints
{
    public static RouteGroupBuilder MapAdminEndpoints(this RouteGroupBuilder group)
    {
        group.MapGet("/admin/ops/health", async (
            HttpContext http,
            IEntitlementResolver resolver,
            GetOpsHealthHandler handler,
            CancellationToken ct) =>
        {
            var scope = await AdminScopeHelper.ResolveOrDenyAsync(http, resolver, ct);
            if (scope is null) return Results.Empty;
            if (!await AdminScopeHelper.RequireReadAsync(http, scope, ModuleKey.OpsLive)) return Results.Empty;

            var result = await handler.HandleAsync(new GetOpsHealthQuery(http.User.GetUserIdOrEmpty()), ct);
            return result.IsSuccess ? Results.Ok(result.Value) : Results.Forbid();
        })
        .WithName("GetAdminOpsHealth")
        .CacheOutput("AdminLive");

        group.MapGet("/admin/ops/errors", async (
            HttpContext http,
            IEntitlementResolver resolver,
            GetOpsErrorsHandler handler,
            int page,
            int pageSize,
            string? endpoint,
            string? since,
            CancellationToken ct) =>
        {
            var scope = await AdminScopeHelper.ResolveOrDenyAsync(http, resolver, ct);
            if (scope is null) return Results.Empty;
            if (!await AdminScopeHelper.RequireReadAsync(http, scope, ModuleKey.OpsErrors)) return Results.Empty;

            DateTime? sinceDate = DateTime.TryParse(since, out var dt) ? dt : null;
            var result = await handler.HandleAsync(
                new GetOpsErrorsQuery(
                    Math.Max(1, page),
                    Math.Clamp(pageSize, 10, 200),
                    endpoint,
                    sinceDate,
                    http.User.GetUserIdOrEmpty()),
                ct);
            return result.IsSuccess ? Results.Ok(result.Value) : Results.Problem();
        })
        .WithName("GetAdminOpsErrors")
        .CacheOutput("AdminLive");

        group.MapGet("/admin/ops/voice", async (
            HttpContext http,
            IEntitlementResolver resolver,
            GetOpsVoiceHandler handler,
            int days,
            CancellationToken ct) =>
        {
            var scope = await AdminScopeHelper.ResolveOrDenyAsync(http, resolver, ct);
            if (scope is null) return Results.Empty;
            if (!await AdminScopeHelper.RequireReadAsync(http, scope, ModuleKey.OpsVoice)) return Results.Empty;

            var result = await handler.HandleAsync(
                new GetOpsVoiceQuery(Math.Clamp(days, 7, 30), http.User.GetUserIdOrEmpty()), ct);
            return result.IsSuccess ? Results.Ok(result.Value) : Results.Problem();
        })
        .WithName("GetAdminOpsVoice")
        .CacheOutput("AdminLive");

        group.MapGet("/admin/metrics/wvfd", async (
            HttpContext http,
            IEntitlementResolver resolver,
            GetWvfdHistoryHandler handler,
            int weeks,
            CancellationToken ct) =>
        {
            var scope = await AdminScopeHelper.ResolveOrDenyAsync(http, resolver, ct);
            if (scope is null) return Results.Empty;
            if (!await AdminScopeHelper.RequireReadAsync(http, scope, ModuleKey.MetricsNsm)) return Results.Empty;

            var result = await handler.HandleAsync(
                new GetWvfdHistoryQuery(Math.Clamp(weeks, 4, 52), http.User.GetUserIdOrEmpty()), ct);
            return result.IsSuccess ? Results.Ok(result.Value) : Results.Problem();
        })
        .WithName("GetAdminWvfd")
        .CacheOutput("AdminMaterialized");

        group.MapGet("/admin/farms", async (
            HttpContext http,
            IEntitlementResolver resolver,
            GetFarmsListHandler h,
            int page,
            int pageSize,
            string? search,
            string? tier,
            CancellationToken ct) =>
        {
            var scope = await AdminScopeHelper.ResolveOrDenyAsync(http, resolver, ct);
            if (scope is null) return Results.Empty;
            if (!await AdminScopeHelper.RequireReadAsync(http, scope, ModuleKey.FarmsList)) return Results.Empty;

            var r = await h.HandleAsync(new GetFarmsListQuery(
                Math.Max(1, page), Math.Clamp(pageSize, 10, 200), search, tier,
                http.User.GetUserIdOrEmpty()), ct);
            return r.IsSuccess ? Results.Ok(r.Value) : Results.Problem();
        })
        .WithName("GetAdminFarms")
        .CacheOutput("AdminLive");

        group.MapGet("/admin/farms/silent-churn", async (
            HttpContext http,
            IEntitlementResolver resolver,
            GetSilentChurnHandler h,
            CancellationToken ct) =>
        {
            var scope = await AdminScopeHelper.ResolveOrDenyAsync(http, resolver, ct);
            if (scope is null) return Results.Empty;
            if (!await AdminScopeHelper.RequireReadAsync(http, scope, ModuleKey.FarmsSilentChurn)) return Results.Empty;

            var r = await h.HandleAsync(new GetSilentChurnQuery(http.User.GetUserIdOrEmpty()), ct);
            return r.IsSuccess ? Results.Ok(r.Value) : Results.Problem();
        })
        .WithName("GetAdminSilentChurn")
        .CacheOutput("AdminMaterialized");

        group.MapGet("/admin/farms/suffering", async (
            HttpContext http,
            IEntitlementResolver resolver,
            GetSufferingHandler h,
            CancellationToken ct) =>
        {
            var scope = await AdminScopeHelper.ResolveOrDenyAsync(http, resolver, ct);
            if (scope is null) return Results.Empty;
            if (!await AdminScopeHelper.RequireReadAsync(http, scope, ModuleKey.FarmsSuffering)) return Results.Empty;

            var r = await h.HandleAsync(new GetSufferingQuery(http.User.GetUserIdOrEmpty()), ct);
            return r.IsSuccess ? Results.Ok(r.Value) : Results.Problem();
        })
        .WithName("GetAdminSuffering")
        .CacheOutput("AdminLive");

        group.MapGet("/admin/users", async (
            HttpContext http,
            IEntitlementResolver resolver,
            GetUsersListHandler h,
            int page,
            int pageSize,
            string? search,
            CancellationToken ct) =>
        {
            var scope = await AdminScopeHelper.ResolveOrDenyAsync(http, resolver, ct);
            if (scope is null) return Results.Empty;
            if (!await AdminScopeHelper.RequireReadAsync(http, scope, ModuleKey.AdminUsers)) return Results.Empty;

            var r = await h.HandleAsync(new GetUsersListQuery(
                Math.Max(1, page), Math.Clamp(pageSize, 10, 200), search,
                http.User.GetUserIdOrEmpty()), ct);
            return r.IsSuccess ? Results.Ok(r.Value) : Results.Problem();
        })
        .WithName("GetAdminUsers")
        .CacheOutput("AdminLive");

        return group;
    }
}

file static class ClaimsPrincipalExtensions
{
    /// <summary>
    /// Handlers today take a Guid actorId purely for attribution. Pull the 'sub'
    /// claim — this is AFTER AdminScopeHelper has already authorised, so the
    /// user is guaranteed to have a resolvable identity at this point.
    /// </summary>
    internal static Guid GetUserIdOrEmpty(this System.Security.Claims.ClaimsPrincipal user)
        => EndpointActorContext.TryGetUserId(user, out var id) ? id : Guid.Empty;
}
