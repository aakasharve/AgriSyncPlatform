using ShramSafal.Application.Admin;
using ShramSafal.Application.Admin.Ports;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Organizations;

namespace ShramSafal.Api.Endpoints;

public static class AuditEndpoints
{
    public static RouteGroupBuilder MapAuditEndpoints(this RouteGroupBuilder group)
    {
        group.MapGet("/audit", async (
            string? entityType,
            Guid? entityId,
            Guid? farmId,
            DateOnly? fromDate,
            DateOnly? toDate,
            int? limit,
            int? offset,
            HttpContext http,
            IShramSafalRepository repository,
            IEntitlementResolver entitlementResolver,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(http.User, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            if (!string.IsNullOrWhiteSpace(entityType) && entityId.HasValue)
            {
                return await GetEntityStreamAsync(
                    entityType, entityId.Value, actorUserId, http, repository, entitlementResolver, ct);
            }

            if (!farmId.HasValue)
            {
                return Results.BadRequest(new
                {
                    error = "ShramSafal.InvalidCommand",
                    message = "Provide either (entityType + entityId) or farmId."
                });
            }

            var isFarmMember = await repository.IsUserMemberOfFarmAsync(farmId.Value, actorUserId, ct);
            if (!isFarmMember)
            {
                return Results.Forbid();
            }

            var from = fromDate ?? DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-30));
            var to = toDate ?? DateOnly.FromDateTime(DateTime.UtcNow);
            if (from > to)
            {
                return Results.BadRequest(new
                {
                    error = "ShramSafal.InvalidCommand",
                    message = "fromDate cannot be greater than toDate."
                });
            }

            var pageSize = limit ?? 200;
            var pageOffset = offset ?? 0;

            var farmEvents = await repository.GetAuditEventsForFarmAsync(
                farmId.Value,
                from,
                to,
                pageSize,
                pageOffset,
                ct);

            var result = farmEvents
                .Select(ToDto)
                .ToList();

            return Results.Ok(result);
        })
        .WithName("GetAuditEvents");

        return group;
    }

    /// <summary>
    /// The <c>entityType + entityId</c> branch of <c>GET /shramsafal/audit</c>,
    /// lifted out of the route lambda so §P0.2's proof can execute the SAME code
    /// the route executes, against a real Postgres, as <c>agrisync_app</c>. A
    /// test that re-implements the rule proves only that the test agrees with
    /// itself.
    /// </summary>
    public static async Task<IResult> GetEntityStreamAsync(
        string entityType,
        Guid entityId,
        Guid actorUserId,
        HttpContext http,
        IShramSafalRepository repository,
        IEntitlementResolver entitlementResolver,
        CancellationToken ct)
    {
        var events = await repository.GetAuditEventsForEntityAsync(entityId, entityType, ct);

        // Entity stream may include farm-linked events; enforce visibility by farm membership.
        foreach (var relatedFarmId in events
                     .Select(x => x.FarmId)
                     .Where(x => x.HasValue)
                     .Select(x => x!.Value)
                     .Distinct())
        {
            var isMember = await repository.IsUserMemberOfFarmAsync(relatedFarmId, actorUserId, ct);
            if (!isMember)
            {
                return Results.Forbid();
            }
        }

        // §P0.2 — the NULL-farm branch. The membership loop above skips every row
        // whose farm_id IS NULL, and those are precisely the cross-farm ones:
        // retained-voice-clip retention (S3 object keys for other farmers' raw
        // recordings), PII-review decisions and their unbounded staff note, admin
        // elevation reasons, DEK handles, erasure/export subjects' GUIDs. Before
        // this filter any authenticated caller who could guess an
        // entityType+entityId got them verbatim, payload included.
        //
        // The rule: your own actor rows, or a platform admin. There is no
        // platform-admin claim and one must not be invented — the scope resolves
        // through IEntitlementResolver, exactly as every other admin surface does
        // (AdminAuthGateTests G2). TryResolveSilently is the right helper because
        // /audit is open to any authenticated user and merely serves MORE to an
        // admin; a non-admin must get a filtered 200, never a 401/403 about admin
        // membership they never asked for.
        var scope = await AdminScopeHelper.TryResolveSilentlyAsync(http, entitlementResolver, ct);
        if (!IsPlatformAuditReader(scope))
        {
            events = events
                .Where(x => x.FarmId.HasValue || (Guid)x.ActorUserId == actorUserId)
                .ToList();
        }

        return Results.Ok(events.Select(ToDto).ToList());
    }

    /// <summary>
    /// §P0.2 — the only thing that unlocks another actor's NULL-farm audit rows.
    /// Platform+Owner (<see cref="AdminScope.IsPlatformAdmin"/>) AND read on
    /// <see cref="ModuleKey.AuditLedger"/>, so revoking the module row in
    /// <see cref="EntitlementMatrix"/> is sufficient to close the surface without
    /// touching this file. A null scope (the ordinary farmer) is never a reader.
    /// </summary>
    private static bool IsPlatformAuditReader(AdminScope? scope) =>
        scope is { IsPlatformAdmin: true } && scope.CanRead(ModuleKey.AuditLedger);

    private static AuditEventDto ToDto(Domain.Audit.AuditEvent auditEvent) =>
        new(
            auditEvent.Id,
            auditEvent.FarmId,
            auditEvent.EntityType,
            auditEvent.EntityId,
            auditEvent.Action,
            auditEvent.ActorUserId,
            auditEvent.ActorRole,
            auditEvent.Payload,
            auditEvent.OccurredAtUtc,
            auditEvent.ClientCommandId);
}
