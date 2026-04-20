using System.Security.Claims;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;

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
            ClaimsPrincipal user,
            IShramSafalRepository repository,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            if (!string.IsNullOrWhiteSpace(entityType) && entityId.HasValue)
            {
                var events = await repository.GetAuditEventsForEntityAsync(entityId.Value, entityType, ct);

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

                return Results.Ok(events.Select(ToDto).ToList());
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
