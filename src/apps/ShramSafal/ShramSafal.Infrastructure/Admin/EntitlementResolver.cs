using System.Diagnostics;
using System.Text.Json;
using AgriSync.BuildingBlocks.Analytics;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.EntityFrameworkCore;
using ShramSafal.Application.Admin;
using ShramSafal.Application.Admin.Ports;
using ShramSafal.Domain.Organizations;
using ShramSafal.Infrastructure.Persistence;

namespace ShramSafal.Infrastructure.Admin;

/// <summary>
/// Resolves the caller's AdminScope. Load-bearing for every admin HTTP request —
/// endpoints never read claims or config for authorization, only this resolver.
///
/// Contract per plan §4.4:
///   0 memberships  → Unauthorized (HTTP 401)
///   1 membership   → Resolved (activeOrgId ignored)
///   &gt;1 memberships, no activeOrgId → Ambiguous (HTTP 428)
///   &gt;1 memberships, activeOrgId in set → Resolved to that org
///   &gt;1 memberships, activeOrgId NOT in set → NotInOrg (HTTP 403)
///
/// Every resolve emits exactly one analytics event for observability —
/// powers mis.admin_scope_health.
/// </summary>
internal sealed class EntitlementResolver(
    ShramSafalDbContext db,
    IAnalyticsWriter analytics) : IEntitlementResolver
{
    public async Task<ResolveResult> ResolveAsync(
        UserId userId,
        Guid? activeOrgId,
        CancellationToken ct)
    {
        var sw = Stopwatch.StartNew();

        var memberships = await (
            from m in db.OrganizationMemberships
            join o in db.Organizations on m.OrganizationId equals o.Id
            where m.UserId == userId && m.IsActive && o.IsActive
            select new MembershipSummary(
                o.Id,
                o.Name,
                o.Type,
                m.Role))
            .ToListAsync(ct);

        if (memberships.Count == 0)
        {
            await EmitAsync(AnalyticsEventType.AdminScopeUnauthorized, userId, new
            {
                endpointPath = "resolver"
            }, ct);
            return ResolveResult.Unauthorized();
        }

        MembershipSummary selected;
        if (memberships.Count == 1)
        {
            selected = memberships[0];
        }
        else if (activeOrgId is null)
        {
            await EmitAsync(AnalyticsEventType.AdminScopeAmbiguous, userId, new
            {
                membershipCount = memberships.Count
            }, ct);
            return ResolveResult.Ambiguous(memberships);
        }
        else
        {
            var match = memberships.FirstOrDefault(m => m.OrganizationId == activeOrgId.Value);
            if (match is null)
            {
                await EmitAsync(AnalyticsEventType.AdminScopeForbidden, userId, new
                {
                    requestedOrgId = activeOrgId.Value,
                    endpointPath = "resolver"
                }, ct);
                return ResolveResult.NotInOrg(memberships);
            }
            selected = match;
        }

        var modules = EntitlementMatrix.For(selected.OrganizationType, selected.OrganizationRole);
        var isPlatformAdmin =
            selected.OrganizationType == OrganizationType.Platform &&
            selected.OrganizationRole == OrganizationRole.Owner;

        var scope = new AdminScope(
            selected.OrganizationId,
            selected.OrganizationType,
            selected.OrganizationRole,
            modules,
            isPlatformAdmin);

        sw.Stop();
        await EmitAsync(AnalyticsEventType.AdminScopeResolved, userId, new
        {
            orgId = selected.OrganizationId,
            orgType = selected.OrganizationType.ToString(),
            orgRole = selected.OrganizationRole.ToString(),
            resolveMs = (int)sw.ElapsedMilliseconds,
            membershipCount = memberships.Count
        }, ct);

        return ResolveResult.Resolved(scope, memberships);
    }

    private Task EmitAsync(string eventType, UserId userId, object props, CancellationToken ct)
        => analytics.EmitAsync(new AnalyticsEvent(
                EventId: Guid.NewGuid(),
                EventType: eventType,
                OccurredAtUtc: DateTime.UtcNow,
                ActorUserId: userId,
                FarmId: null,
                OwnerAccountId: null,
                ActorRole: "admin",
                Trigger: "resolver",
                DeviceOccurredAtUtc: null,
                SchemaVersion: "v1",
                PropsJson: JsonSerializer.Serialize(props)),
            ct);
}
