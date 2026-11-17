using System.Globalization;
using Microsoft.AspNetCore.Http;
using ShramSafal.Application.Admin.Ports;
using ShramSafal.Application.UseCases.Admin.GetCompanyMis;
using ShramSafal.Application.UseCases.Admin.GetAiProviderHealth24h;
using ShramSafal.Application.UseCases.Admin.GetAiSpendMonthly;
using ShramSafal.Application.UseCases.Admin.GetAppVersions;
using ShramSafal.Application.UseCases.Admin.GetFarmContacts;
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
        // GET /admin/me/scope
        // Self-describing endpoint: tells the client what AdminScope the caller has.
        // Unlike other admin endpoints, this one never gates on a module (it IS the
        // gate) and never returns 401/428/403. It returns 200 with a structured
        // outcome so the client can drive UI state (show switcher / forbidden /
        // render shell) without parsing error codes.
        //
        // Requires authentication (JWT must be valid). If JWT missing → 401 from
        // auth middleware, not this handler.
        group.MapGet("/admin/me/scope", async (
            HttpContext http,
            IEntitlementResolver resolver,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(http.User, out var userIdGuid))
            {
                return Results.Unauthorized();
            }

            Guid? activeOrgId = null;
            if (http.Request.Headers.TryGetValue("X-Active-Org-Id", out var raw)
                && Guid.TryParse(raw.ToString(), out var parsed))
            {
                activeOrgId = parsed;
            }

            var result = await resolver.ResolveAsync(
                new AgriSync.SharedKernel.Contracts.Ids.UserId(userIdGuid), activeOrgId, ct);

            return Results.Ok(new
            {
                outcome = result.Outcome.ToString(),
                scope = result.Scope is null ? null : new
                {
                    userId = userIdGuid,
                    orgId = result.Scope.OrganizationId,
                    orgType = result.Scope.OrganizationType.ToString(),
                    orgRole = result.Scope.OrganizationRole.ToString(),
                    isPlatformAdmin = result.Scope.IsPlatformAdmin,
                    modules = result.Scope.Modules.Select(m => new
                    {
                        key = m.ModuleKey,
                        canRead = m.CanRead,
                        canExport = m.CanExport,
                        canWrite = m.CanWrite
                    })
                },
                memberships = result.Memberships.Select(m => new
                {
                    orgId = m.OrganizationId,
                    orgName = m.OrganizationName,
                    orgType = m.OrganizationType.ToString(),
                    orgRole = m.OrganizationRole.ToString()
                })
            });
        })
        .WithName("GetAdminMeScope");

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

        // spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, Task 5, C11, C29) — alert check R10, voice
        // recordings failing, counted live: it reads every farm's voice jobs (farm keys through the audited
        // cross-farm factory), so it is not on the polled /admin/ops/health; the console asks it when Live Health
        // opens and on "Check again" only. Platform owners only (a read across every farm). Deliberately has no
        // CacheOutput: each call is an honest live count and writes one cross-farm audit row. Failures are not
        // caught: a read failure answers 500, never an answer that reads as clear.
        group.MapGet("/admin/ops/voice-check", async (
            HttpContext http,
            IEntitlementResolver resolver,
            GetVoiceCheckHandler h,
            CancellationToken ct) =>
        {
            var scope = await AdminScopeHelper.ResolveOrDenyAsync(http, resolver, ct);
            if (scope is null) return Results.Empty;
            if (!await AdminScopeHelper.RequireReadAsync(http, scope, ModuleKey.OpsLive)) return Results.Empty;
            if (!await AdminScopeHelper.RequirePlatformAdminAsync(http, scope)) return Results.Empty;

            var r = await h.HandleAsync(new GetVoiceCheckQuery(
                http.User.GetUserIdOrEmpty(), scope.IsPlatformAdmin), ct);

            if (r.IsSuccess) return Results.Ok(r.Value);

            return r.Error.Kind switch
            {
                AgriSync.BuildingBlocks.Results.ErrorKind.Forbidden => Results.Json(new
                {
                    code = "admin_platform_only",
                    message = "This action requires Platform+Owner scope."
                }, statusCode: StatusCodes.Status403Forbidden),
                _ => Results.Problem()
            };
        })
        .WithName("GetAdminOpsVoiceCheck");

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

        // spec: control-room-app-versions-2026-11-12 (ADR 0028) — who used the app on which version.
        // Deliberately has no CacheOutput. The handler catches nothing: a repository failure escapes to the
        // server's own error path and answers 500, so the page says it could not load instead of showing an
        // empty list.
        group.MapGet("/admin/ops/app-versions", async (
            HttpContext http,
            IEntitlementResolver resolver,
            GetAppVersionsHandler handler,
            int? days,
            CancellationToken ct) =>
        {
            var scope = await AdminScopeHelper.ResolveOrDenyAsync(http, resolver, ct);
            if (scope is null) return Results.Empty;
            if (!await AdminScopeHelper.RequireReadAsync(http, scope, ModuleKey.OpsLive)) return Results.Empty;

            var result = await handler.HandleAsync(
                new GetAppVersionsQuery(days, http.User.GetUserIdOrEmpty()), ct);
            return result.IsSuccess ? Results.Ok(result.Value) : Results.Problem();
        })
        .WithName("GetAdminOpsAppVersions");

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
            // spec: company-mis-real-numbers-2026-11-15 — every farm / every person across the platform: platform
            // owners only (an FPO owner also holds this module).
            if (!await AdminScopeHelper.RequirePlatformAdminAsync(http, scope)) return Results.Empty;

            var r = await h.HandleAsync(new GetFarmsListQuery(
                Math.Max(1, page), Math.Clamp(pageSize, 10, 200), search, tier,
                http.User.GetUserIdOrEmpty()), ct);
            return r.IsSuccess ? Results.Ok(r.Value) : Results.Problem();
        })
        .WithName("GetAdminFarms")
        .CacheOutput("AdminLive");

        // spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, Task 1) — farm names and owner phones for a list
        // of farm ids (?ids=<comma-separated uuids>, 1 to 200), so the pages the console polls carry farm ids only
        // and never open the audited cross-farm factory. Platform owners only (names and phones). Deliberately has
        // no CacheOutput: each call writes one cross-farm audit row. A farm that does not exist is left out. A read
        // failure is not caught: it answers 500, never an empty list.
        group.MapGet("/admin/farms/contacts", async (
            HttpContext http,
            IEntitlementResolver resolver,
            GetFarmContactsHandler h,
            string? ids,
            CancellationToken ct) =>
        {
            var scope = await AdminScopeHelper.ResolveOrDenyAsync(http, resolver, ct);
            if (scope is null) return Results.Empty;
            if (!await AdminScopeHelper.RequireReadAsync(http, scope, ModuleKey.FarmsList)) return Results.Empty;
            if (!await AdminScopeHelper.RequirePlatformAdminAsync(http, scope)) return Results.Empty;

            var r = await h.HandleAsync(new GetFarmContactsQuery(
                ids, http.User.GetUserIdOrEmpty(), scope.IsPlatformAdmin), ct);

            if (r.IsSuccess)
            {
                return Results.Ok(r.Value.Select(c => new
                {
                    farmId = c.FarmId,
                    name = c.Name,
                    ownerPhone = c.OwnerPhone
                }).ToList());
            }

            return r.Error.Kind switch
            {
                // C17: the refusal key is "code", as every other admin refusal.
                AgriSync.BuildingBlocks.Results.ErrorKind.Validation => Results.BadRequest(new
                {
                    code = "contacts_ids_invalid",
                    message = r.Error.Description
                }),
                AgriSync.BuildingBlocks.Results.ErrorKind.Forbidden => Results.Json(new
                {
                    code = "admin_platform_only",
                    message = "This action requires Platform+Owner scope."
                }, statusCode: StatusCodes.Status403Forbidden),
                _ => Results.Problem()
            };
        })
        .WithName("GetAdminFarmContacts");

        // spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, Task 4, C26) — the silent farms, named, with phone,
        // band and plan, counted live. Platform owners only (names and phones of every farm). Deliberately has no
        // CacheOutput: each load opens the audited cross-farm factory. Failures are not caught: a read failure
        // answers 500, never an empty list.
        group.MapGet("/admin/farms/silent-churn", async (
            HttpContext http,
            IEntitlementResolver resolver,
            GetSilentChurnHandler h,
            CancellationToken ct) =>
        {
            var scope = await AdminScopeHelper.ResolveOrDenyAsync(http, resolver, ct);
            if (scope is null) return Results.Empty;
            if (!await AdminScopeHelper.RequireReadAsync(http, scope, ModuleKey.FarmsSilentChurn)) return Results.Empty;
            if (!await AdminScopeHelper.RequirePlatformAdminAsync(http, scope)) return Results.Empty;

            var r = await h.HandleAsync(new GetSilentChurnQuery(
                http.User.GetUserIdOrEmpty(), scope.IsPlatformAdmin), ct);

            if (r.IsSuccess) return Results.Ok(r.Value);

            return r.Error.Kind switch
            {
                AgriSync.BuildingBlocks.Results.ErrorKind.Forbidden => Results.Json(new
                {
                    code = "admin_platform_only",
                    message = "This action requires Platform+Owner scope."
                }, statusCode: StatusCodes.Status403Forbidden),
                _ => Results.Problem()
            };
        })
        .WithName("GetAdminSilentChurn");

        group.MapGet("/admin/farms/suffering", async (
            HttpContext http,
            IEntitlementResolver resolver,
            GetSufferingHandler h,
            CancellationToken ct) =>
        {
            var scope = await AdminScopeHelper.ResolveOrDenyAsync(http, resolver, ct);
            if (scope is null) return Results.Empty;
            if (!await AdminScopeHelper.RequireReadAsync(http, scope, ModuleKey.FarmsSuffering)) return Results.Empty;
            // spec: company-mis-real-numbers-2026-11-15 (plan CR-2e, Task 2) — a list across all farms: platform
            // owners only. It reads analytics.events only and opens no cross-farm factory, so it keeps its cache.
            if (!await AdminScopeHelper.RequirePlatformAdminAsync(http, scope)) return Results.Empty;

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
            // spec: company-mis-real-numbers-2026-11-15 — every farm / every person across the platform: platform
            // owners only (an FPO owner also holds this module).
            if (!await AdminScopeHelper.RequirePlatformAdminAsync(http, scope)) return Results.Empty;

            var r = await h.HandleAsync(new GetUsersListQuery(
                Math.Max(1, page), Math.Clamp(pageSize, 10, 200), search,
                http.User.GetUserIdOrEmpty()), ct);
            return r.IsSuccess ? Results.Ok(r.Value) : Results.Problem();
        })
        .WithName("GetAdminUsers")
        .CacheOutput("AdminLive");

        // spec: company-mis-real-numbers-2026-11-15 (plan CR-2a) — company-wide numbers counted live
        // from real rows, India-time days. Platform owners only: metrics.nsm is also held by FPO owners,
        // so the platform gate follows the module gate and the handler re-checks before reading anything.
        // Deliberately has no CacheOutput (each load writes one cross-farm audit row). Failures are not
        // caught: a read failure answers 500, never an empty answer.
        group.MapGet("/admin/mis/company", async (
            HttpContext http,
            IEntitlementResolver resolver,
            GetCompanyMisHandler h,
            string? from,
            string? to,
            CancellationToken ct) =>
        {
            var scope = await AdminScopeHelper.ResolveOrDenyAsync(http, resolver, ct);
            if (scope is null) return Results.Empty;
            if (!await AdminScopeHelper.RequireReadAsync(http, scope, ModuleKey.MetricsNsm)) return Results.Empty;
            if (!await AdminScopeHelper.RequirePlatformAdminAsync(http, scope)) return Results.Empty;

            if (!TryParseMisDay(from, out var fromDay) || !TryParseMisDay(to, out var toDay))
            {
                return Results.BadRequest(new
                {
                    code = "mis_range_invalid",
                    message = "Dates must be written yyyy-MM-dd."
                });
            }

            var r = await h.HandleAsync(new GetCompanyMisQuery(
                fromDay, toDay, http.User.GetUserIdOrEmpty(), scope.IsPlatformAdmin), ct);

            if (r.IsSuccess) return Results.Ok(r.Value);

            return r.Error.Kind switch
            {
                AgriSync.BuildingBlocks.Results.ErrorKind.Validation => Results.BadRequest(new
                {
                    code = "mis_range_invalid",
                    message = r.Error.Description
                }),
                AgriSync.BuildingBlocks.Results.ErrorKind.Forbidden => Results.Json(new
                {
                    code = "admin_platform_only",
                    message = "This action requires Platform+Owner scope."
                }, statusCode: StatusCodes.Status403Forbidden),
                _ => Results.Problem()
            };
        })
        .WithName("GetAdminCompanyMis");

        // SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 3.1 — rolling 24h
        // provider-health rollup. Reads ssf.v_ai_provider_health_24h via
        // IAdminAiObservabilityRepository. Gated on ModuleKey.OpsVoice
        // (same scope as /admin/ops/voice — same operational surface).
        group.MapGet("/admin/ai-health", async (
            HttpContext http,
            IEntitlementResolver resolver,
            GetAiProviderHealth24hHandler handler,
            CancellationToken ct) =>
        {
            var scope = await AdminScopeHelper.ResolveOrDenyAsync(http, resolver, ct);
            if (scope is null) return Results.Empty;
            if (!await AdminScopeHelper.RequireReadAsync(http, scope, ModuleKey.OpsVoice)) return Results.Empty;

            var result = await handler.HandleAsync(
                new GetAiProviderHealth24hQuery(http.User.GetUserIdOrEmpty()), ct);
            return result.IsSuccess ? Results.Ok(result.Value) : Results.Problem();
        })
        .WithName("GetAdminAiHealth")
        .CacheOutput("AdminLive");

        // SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 3.2 — monthly
        // AI provider spend rollup. Reads ssf.v_ai_spend_monthly +
        // ssf.ai_provider_configs.monthly_budget_inr via
        // IAdminAiObservabilityRepository. Gated on ModuleKey.OpsVoice
        // alongside the health endpoint.
        group.MapGet("/admin/ai-spend", async (
            HttpContext http,
            IEntitlementResolver resolver,
            GetAiSpendMonthlyHandler handler,
            CancellationToken ct) =>
        {
            var scope = await AdminScopeHelper.ResolveOrDenyAsync(http, resolver, ct);
            if (scope is null) return Results.Empty;
            if (!await AdminScopeHelper.RequireReadAsync(http, scope, ModuleKey.OpsVoice)) return Results.Empty;

            var result = await handler.HandleAsync(
                new GetAiSpendMonthlyQuery(http.User.GetUserIdOrEmpty()), ct);
            return result.IsSuccess ? Results.Ok(result.Value) : Results.Problem();
        })
        .WithName("GetAdminAiSpend")
        .CacheOutput("AdminMaterialized");

        return group;
    }

    /// <summary>
    /// Company MIS date parameter: absent or blank is null (true); otherwise it must be
    /// exactly yyyy-MM-dd, else false (the route answers 400 mis_range_invalid).
    /// </summary>
    private static bool TryParseMisDay(string? raw, out DateOnly? day)
    {
        day = null;
        if (string.IsNullOrWhiteSpace(raw)) return true;
        if (!DateOnly.TryParseExact(raw.Trim(), "yyyy-MM-dd", CultureInfo.InvariantCulture,
                DateTimeStyles.None, out var parsed))
        {
            return false;
        }

        day = parsed;
        return true;
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
