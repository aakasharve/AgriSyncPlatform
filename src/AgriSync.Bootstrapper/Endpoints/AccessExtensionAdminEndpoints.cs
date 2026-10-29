using System.Security.Claims;
using Accounts.Domain.Subscriptions;
using Accounts.Infrastructure.Persistence;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.EntityFrameworkCore;
using ShramSafal.Api.Endpoints;
using ShramSafal.Application.Admin.Ports;

namespace AgriSync.Bootstrapper.Endpoints;

/// <summary>
/// spec R-11 (b) (pre-launch repair, founder N-1: "Use an explicit, server-managed pilot extension
/// with a recorded reason and end date") — the admin-only way to grant an owner account an access
/// extension, and to read an account's extension history. No farmer screen.
///
/// <list type="bullet">
/// <item><c>POST /shramsafal/admin/access-extensions</c> —
/// <c>{ ownerAccountId, reason, endsAtUtc, startsAtUtc? }</c>. Platform admin only (the same
/// <see cref="AdminScopeHelper"/> gate as every other admin write). Appends one row; never edits or
/// removes one; never touches a subscription.</item>
/// <item><c>GET /shramsafal/admin/access-extensions?ownerAccountId=…</c> — the account's rows,
/// newest first.</item>
/// </list>
///
/// <para>Lives in the Bootstrapper because it spans the admin gate (ShramSafal) and the row's owner
/// (Accounts) — the same reason <see cref="FirstFarmBootstrapEndpoints"/> lives here. The
/// <c>/shramsafal/admin</c> prefix is on the tenant middleware's admin skip-list, and
/// <c>accounts.*</c> carries no farm RLS.</para>
/// </summary>
public static class AccessExtensionAdminEndpoints
{
    public const string Route = "/shramsafal/admin/access-extensions";

    public static IEndpointRouteBuilder MapAccessExtensionAdminEndpoints(this IEndpointRouteBuilder endpoints)
    {
        endpoints.MapPost(Route, GrantAsync)
            .WithName("GrantAccessExtension")
            .WithTags("Admin")
            .RequireAuthorization();

        endpoints.MapGet(Route, ListAsync)
            .WithName("ListAccessExtensions")
            .WithTags("Admin")
            .RequireAuthorization();

        return endpoints;
    }

    public sealed record GrantAccessExtensionRequest(
        Guid OwnerAccountId,
        string? Reason,
        DateTime? EndsAtUtc,
        DateTime? StartsAtUtc = null);

    private static async Task<IResult> GrantAsync(
        HttpContext httpContext,
        IEntitlementResolver resolver,
        GrantAccessExtensionRequest? request,
        AccountsDbContext accountsDb,
        IClock clock,
        CancellationToken ct)
    {
        var scope = await AdminScopeHelper.ResolveOrDenyAsync(httpContext, resolver, ct);
        if (scope is null) return Results.Empty;
        if (!await AdminScopeHelper.RequirePlatformAdminAsync(httpContext, scope)) return Results.Empty;

        if (!TryGetUserId(httpContext.User, out var adminUserId))
        {
            return Results.Unauthorized();
        }

        if (request is null || request.OwnerAccountId == Guid.Empty || request.EndsAtUtc is null)
        {
            return Invalid("ownerAccountId and endsAtUtc are required.");
        }

        var ownerAccountId = new OwnerAccountId(request.OwnerAccountId);
        var accountExists = await accountsDb.OwnerAccounts.AnyAsync(a => a.Id == ownerAccountId, ct);
        if (!accountExists)
        {
            return Results.NotFound(new { error = "access_extension.owner_account_not_found", message = "No such owner account." });
        }

        var nowUtc = clock.UtcNow;
        AccessExtension extension;
        try
        {
            extension = AccessExtension.Grant(
                id: Guid.NewGuid(),
                ownerAccountId: ownerAccountId,
                reason: request.Reason ?? string.Empty,
                startsAtUtc: ToUtc(request.StartsAtUtc) ?? nowUtc,
                endsAtUtc: ToUtc(request.EndsAtUtc)!.Value,
                grantedByUserId: adminUserId,
                createdAtUtc: nowUtc);
        }
        catch (ArgumentException ex)
        {
            return Invalid(ex.Message);
        }

        accountsDb.AccessExtensions.Add(extension);
        await accountsDb.SaveChangesAsync(ct);

        return Results.Ok(ToDto(extension));
    }

    private static async Task<IResult> ListAsync(
        HttpContext httpContext,
        IEntitlementResolver resolver,
        Guid? ownerAccountId,
        AccountsDbContext accountsDb,
        CancellationToken ct)
    {
        var scope = await AdminScopeHelper.ResolveOrDenyAsync(httpContext, resolver, ct);
        if (scope is null) return Results.Empty;
        if (!await AdminScopeHelper.RequirePlatformAdminAsync(httpContext, scope)) return Results.Empty;

        if (ownerAccountId is null || ownerAccountId == Guid.Empty)
        {
            return Invalid("ownerAccountId is required.");
        }

        var typed = new OwnerAccountId(ownerAccountId.Value);
        var rows = await accountsDb.AccessExtensions
            .AsNoTracking()
            .Where(x => x.OwnerAccountId == typed)
            .OrderByDescending(x => x.CreatedAtUtc)
            .ToListAsync(ct);

        return Results.Ok(rows.Select(ToDto));
    }

    private static object ToDto(AccessExtension x) => new
    {
        accessExtensionId = x.Id,
        ownerAccountId = x.OwnerAccountId.Value,
        reason = x.Reason,
        startsAtUtc = x.StartsAtUtc,
        endsAtUtc = x.EndsAtUtc,
        grantedByUserId = x.GrantedByUserId,
        createdAtUtc = x.CreatedAtUtc,
    };

    private static IResult Invalid(string message) =>
        Results.BadRequest(new { error = "access_extension.invalid", message });

    private static DateTime? ToUtc(DateTime? value) => value switch
    {
        null => null,
        { Kind: DateTimeKind.Utc } v => v,
        { Kind: DateTimeKind.Local } v => v.ToUniversalTime(),
        { } v => DateTime.SpecifyKind(v, DateTimeKind.Utc),
    };

    private static bool TryGetUserId(ClaimsPrincipal user, out Guid userId)
    {
        var subject = user.FindFirstValue("sub") ?? user.FindFirstValue(ClaimTypes.NameIdentifier);
        return Guid.TryParse(subject, out userId);
    }
}
