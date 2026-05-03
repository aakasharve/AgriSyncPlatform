using System.Text.Json;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.AspNetCore.Http;
using ShramSafal.Application.Admin;
using ShramSafal.Application.Admin.Ports;

namespace ShramSafal.Api.Endpoints;

/// <summary>
/// Shared helper every admin endpoint calls before running its handler.
/// Resolves the caller's AdminScope via IEntitlementResolver and maps the
/// four ResolveOutcome states to the right HTTP response.
///
/// Callers (via <see cref="ResolveOrDenyAsync"/>):
///   return scope is null  → await scope.WriteErrorAsync(ctx) already happened;
///                           just return Results.Empty
///   scope not null        → pass to handler; after handler runs, optionally
///                           re-gate by <see cref="RequireRead"/> / RequireWrite.
///
/// No claim inspection for authorization — that's the whole point of the pivot.
/// Only <c>sub</c> claim is read, for identity.
/// </summary>
public static class AdminScopeHelper
{
    private const string ActiveOrgHeader = "X-Active-Org-Id";

    /// <summary>
    /// Resolves the scope OR writes the appropriate HTTP error response and returns null.
    /// Caller should early-return with <c>Results.Empty</c> when this returns null.
    /// </summary>
    public static async Task<AdminScope?> ResolveOrDenyAsync(
        HttpContext ctx,
        IEntitlementResolver resolver,
        CancellationToken ct)
    {
        if (!EndpointActorContext.TryGetUserId(ctx.User, out var userIdGuid))
        {
            await WriteJsonAsync(ctx, StatusCodes.Status401Unauthorized, new
            {
                code = "admin_auth_required",
                message = "Admin endpoints require an authenticated user."
            });
            return null;
        }

        Guid? activeOrgId = null;
        if (ctx.Request.Headers.TryGetValue(ActiveOrgHeader, out var raw)
            && Guid.TryParse(raw.ToString(), out var parsed))
        {
            activeOrgId = parsed;
        }

        var result = await resolver.ResolveAsync(new UserId(userIdGuid), activeOrgId, ct);
        switch (result.Outcome)
        {
            case ResolveOutcome.Resolved:
                return result.Scope!;

            case ResolveOutcome.Unauthorized:
                await WriteJsonAsync(ctx, StatusCodes.Status401Unauthorized, new
                {
                    code = "admin_no_membership",
                    message = "User has no active admin membership."
                });
                return null;

            case ResolveOutcome.Ambiguous:
                await WriteJsonAsync(ctx, StatusCodes.Status428PreconditionRequired, new
                {
                    code = "admin_active_org_required",
                    message = $"Send X-Active-Org-Id header selecting one of the {result.Memberships.Count} memberships.",
                    memberships = result.Memberships.Select(m => new
                    {
                        orgId = m.OrganizationId,
                        orgName = m.OrganizationName,
                        orgType = m.OrganizationType.ToString(),
                        orgRole = m.OrganizationRole.ToString()
                    })
                });
                return null;

            case ResolveOutcome.NotInOrg:
                await WriteJsonAsync(ctx, StatusCodes.Status403Forbidden, new
                {
                    code = "admin_not_in_org",
                    message = "The requested active org is not one of your memberships.",
                    memberships = result.Memberships.Select(m => new
                    {
                        orgId = m.OrganizationId,
                        orgName = m.OrganizationName,
                        orgType = m.OrganizationType.ToString(),
                        orgRole = m.OrganizationRole.ToString()
                    })
                });
                return null;

            default:
                await WriteJsonAsync(ctx, StatusCodes.Status500InternalServerError, new
                {
                    code = "admin_resolve_unknown",
                    message = "Resolver returned an unrecognised outcome."
                });
                return null;
        }
    }

    /// <summary>
    /// Module-gate helper. Returns true if the scope can read the module;
    /// otherwise writes 403 and returns false. Caller should early-return
    /// on false.
    /// </summary>
    public static async Task<bool> RequireReadAsync(
        HttpContext ctx, AdminScope scope, string moduleKey)
    {
        if (scope.CanRead(moduleKey)) return true;
        await WriteJsonAsync(ctx, StatusCodes.Status403Forbidden, new
        {
            code = "admin_module_forbidden",
            moduleKey,
            message = $"Your admin scope does not grant read on '{moduleKey}'."
        });
        return false;
    }

    /// <summary>Write-gate counterpart of <see cref="RequireReadAsync"/>.</summary>
    public static async Task<bool> RequireWriteAsync(
        HttpContext ctx, AdminScope scope, string moduleKey)
    {
        if (scope.CanWrite(moduleKey)) return true;
        await WriteJsonAsync(ctx, StatusCodes.Status403Forbidden, new
        {
            code = "admin_module_forbidden",
            moduleKey,
            message = $"Your admin scope does not grant write on '{moduleKey}'."
        });
        return false;
    }

    /// <summary>
    /// Platform-only gate for surfaces that do not map to a scoped module key
    /// (e.g. AI provider config writes, cross-tenant admin actions).
    /// </summary>
    public static async Task<bool> RequirePlatformAdminAsync(HttpContext ctx, AdminScope scope)
    {
        if (scope.IsPlatformAdmin) return true;
        await WriteJsonAsync(ctx, StatusCodes.Status403Forbidden, new
        {
            code = "admin_platform_only",
            message = "This action requires Platform+Owner scope."
        });
        return false;
    }

    /// <summary>
    /// Silent resolver — returns a scope if the caller has one, else null.
    /// Never writes an error response. Use when an endpoint is open to any
    /// authenticated user but serves an augmented response to admins
    /// (e.g. <c>GET /ai/jobs/:id</c> revealing raw provider data for admins).
    /// </summary>
    public static async Task<AdminScope?> TryResolveSilentlyAsync(
        HttpContext ctx,
        IEntitlementResolver resolver,
        CancellationToken ct)
    {
        if (!EndpointActorContext.TryGetUserId(ctx.User, out var userIdGuid)) return null;

        Guid? activeOrgId = null;
        if (ctx.Request.Headers.TryGetValue(ActiveOrgHeader, out var raw)
            && Guid.TryParse(raw.ToString(), out var parsed))
        {
            activeOrgId = parsed;
        }

        var result = await resolver.ResolveAsync(new UserId(userIdGuid), activeOrgId, ct);
        return result.Outcome == ResolveOutcome.Resolved ? result.Scope : null;
    }

    private static async Task WriteJsonAsync(HttpContext ctx, int status, object body)
    {
        ctx.Response.StatusCode = status;
        ctx.Response.ContentType = "application/json; charset=utf-8";
        await JsonSerializer.SerializeAsync(ctx.Response.Body, body);
    }
}
