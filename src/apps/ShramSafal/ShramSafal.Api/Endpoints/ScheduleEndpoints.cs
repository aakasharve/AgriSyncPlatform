using System.Security.Claims;
using AgriSync.BuildingBlocks.Audit;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Schedules.AbandonSchedule;
using ShramSafal.Application.UseCases.Schedules.AdoptSchedule;
using ShramSafal.Application.UseCases.Schedules.CompleteSchedule;
using ShramSafal.Application.UseCases.Schedules.MigrateSchedule;
using ShramSafal.Domain.Schedules;

namespace ShramSafal.Api.Endpoints;

/// <summary>
/// Phase 3 MIS — schedule lifecycle endpoints. Routes nest under
/// <c>/plots/{plotId}/cycles/{cycleId}</c> per the MIS plan; farmId + template
/// references ride in the body so the caller only needs plot/cycle ids in the
/// URL. Idempotency tokens (<c>clientCommandId</c>, <c>subscriptionId</c>,
/// <c>migrationEventId</c>) are optional and forwarded straight to the
/// handler, which checks them.
/// </summary>
public static class ScheduleEndpoints
{
    public static RouteGroupBuilder MapScheduleEndpoints(this RouteGroupBuilder group)
    {
        group.MapPost("/plots/{plotId:guid}/cycles/{cycleId:guid}/schedule/adopt", async (
            Guid plotId,
            Guid cycleId,
            AdoptScheduleRequest request,
            HttpContext httpContext,
            ClaimsPrincipal user,
            AdoptScheduleHandler handler,
            ICallerFarmTenantScope farmScope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            // lane F99 — the farm the request names: its scope first (the route answered 500 without it).
            if (await RouteFarmScope.OpenAsync(farmScope, request.FarmId, actorUserId, ct) is { } refused)
            {
                return ToErrorResult(refused);
            }

            // DATA_PRINCIPLE_SPINE sub-phase 04.3b — extract forensic
            // provenance for the AuditEvent row.
            var (auditDeviceId, auditIpHash) = httpContext.AuditClaims();
            var clientAppVersion = ResolveClientAppVersion(httpContext);

            var command = new AdoptScheduleCommand(
                FarmId: request.FarmId,
                PlotId: plotId,
                CropCycleId: cycleId,
                ScheduleTemplateId: request.ScheduleTemplateId,
                ActorUserId: actorUserId,
                ActorRole: EndpointActorContext.GetActorRole(user),
                ClientCommandId: request.ClientCommandId,
                SubscriptionId: request.SubscriptionId,
                ClientAppVersion: clientAppVersion,
                AuditDeviceId: auditDeviceId,
                AuditIpHash: auditIpHash,
                ReferenceDate: request.ReferenceDate);

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("AdoptSchedule");

        group.MapPost("/plots/{plotId:guid}/cycles/{cycleId:guid}/schedule/migrate", async (
            Guid plotId,
            Guid cycleId,
            MigrateScheduleRequest request,
            HttpContext httpContext,
            ClaimsPrincipal user,
            MigrateScheduleHandler handler,
            ICallerFarmTenantScope farmScope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            // lane F99 — the farm the request names: its scope first (the route answered 500 without it).
            if (await RouteFarmScope.OpenAsync(farmScope, request.FarmId, actorUserId, ct) is { } refused)
            {
                return ToErrorResult(refused);
            }

            if (!Enum.TryParse<ScheduleMigrationReason>(request.Reason, ignoreCase: true, out var reason))
            {
                return Results.BadRequest(new
                {
                    error = "ShramSafal.InvalidCommand",
                    message = $"Unknown migration reason '{request.Reason}'."
                });
            }

            // DATA_PRINCIPLE_SPINE sub-phase 04.3b — extract forensic
            // provenance for the AuditEvent row.
            var (auditDeviceId, auditIpHash) = httpContext.AuditClaims();
            var clientAppVersion = ResolveClientAppVersion(httpContext);

            var command = new MigrateScheduleCommand(
                FarmId: request.FarmId,
                PlotId: plotId,
                CropCycleId: cycleId,
                NewScheduleTemplateId: request.NewScheduleTemplateId,
                Reason: reason,
                ActorUserId: actorUserId,
                ReasonText: request.ReasonText,
                ActorRole: EndpointActorContext.GetActorRole(user),
                ClientCommandId: request.ClientCommandId,
                NewSubscriptionId: request.NewSubscriptionId,
                MigrationEventId: request.MigrationEventId,
                ClientAppVersion: clientAppVersion,
                AuditDeviceId: auditDeviceId,
                AuditIpHash: auditIpHash,
                ReferenceDate: request.ReferenceDate,
                FromSubscriptionId: request.FromSubscriptionId);

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("MigrateSchedule");

        group.MapPost("/plots/{plotId:guid}/cycles/{cycleId:guid}/schedule/abandon", async (
            Guid plotId,
            Guid cycleId,
            AbandonScheduleRequest request,
            HttpContext httpContext,
            ClaimsPrincipal user,
            AbandonScheduleHandler handler,
            ICallerFarmTenantScope farmScope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            // lane F99 — the farm the request names: its scope first (the route answered 500 without it).
            if (await RouteFarmScope.OpenAsync(farmScope, request.FarmId, actorUserId, ct) is { } refused)
            {
                return ToErrorResult(refused);
            }

            // DATA_PRINCIPLE_SPINE sub-phase 04.3b — extract forensic
            // provenance for the AuditEvent row.
            var (auditDeviceId, auditIpHash) = httpContext.AuditClaims();
            var clientAppVersion = ResolveClientAppVersion(httpContext);

            var command = new AbandonScheduleCommand(
                FarmId: request.FarmId,
                PlotId: plotId,
                CropCycleId: cycleId,
                ActorUserId: actorUserId,
                ReasonText: request.ReasonText,
                ActorRole: EndpointActorContext.GetActorRole(user),
                ClientCommandId: request.ClientCommandId,
                ClientAppVersion: clientAppVersion,
                AuditDeviceId: auditDeviceId,
                AuditIpHash: auditIpHash);

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("AbandonSchedule");

        group.MapPost("/plots/{plotId:guid}/cycles/{cycleId:guid}/schedule/complete", async (
            Guid plotId,
            Guid cycleId,
            CompleteScheduleRequest request,
            HttpContext httpContext,
            ClaimsPrincipal user,
            CompleteScheduleHandler handler,
            ICallerFarmTenantScope farmScope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            // lane F99 — the farm the request names: its scope first (the route answered 500 without it).
            if (await RouteFarmScope.OpenAsync(farmScope, request.FarmId, actorUserId, ct) is { } refused)
            {
                return ToErrorResult(refused);
            }

            // DATA_PRINCIPLE_SPINE sub-phase 04.3b — extract forensic
            // provenance for the AuditEvent row.
            var (auditDeviceId, auditIpHash) = httpContext.AuditClaims();
            var clientAppVersion = ResolveClientAppVersion(httpContext);

            var command = new CompleteScheduleCommand(
                FarmId: request.FarmId,
                PlotId: plotId,
                CropCycleId: cycleId,
                ActorUserId: actorUserId,
                ActorRole: EndpointActorContext.GetActorRole(user),
                ClientCommandId: request.ClientCommandId,
                ClientAppVersion: clientAppVersion,
                AuditDeviceId: auditDeviceId,
                AuditIpHash: auditIpHash);

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("CompleteSchedule");

        return group;
    }

    private static IResult ToErrorResult(Error error)
    {
        // lane F99 (MU-4 review R3-L4) — the plot rule's refusal carries its code and words, as the job-card and test routes do.
        if (PlotRefusalResult.For(error) is { } plotRefusal)
        {
            return plotRefusal;
        }

        return error.Code.EndsWith("NotFound", StringComparison.Ordinal)
            ? Results.NotFound(new { error = error.Code, message = error.Description })
            : error.Code.EndsWith("Forbidden", StringComparison.Ordinal)
                ? Results.Forbid()
                : Results.BadRequest(new { error = error.Code, message = error.Description });
    }

    // DATA_PRINCIPLE_SPINE sub-phase 04.3b — single source for resolving the
    // X-App-Version header into the AuditEvent.AppVersion column, mirroring the
    // sub-phase 01.4 fallback used by other endpoints (FinanceEndpoints etc).
    private static string ResolveClientAppVersion(HttpContext httpContext)
    {
        var header = httpContext.Request.Headers["X-App-Version"].FirstOrDefault();
        return string.IsNullOrWhiteSpace(header) ? "unknown" : header!.Trim();
    }
}

public sealed record AdoptScheduleRequest(
    Guid FarmId,
    Guid ScheduleTemplateId,
    string? ClientCommandId = null,
    Guid? SubscriptionId = null,
    // spec: plr-d10 lane L8b-1 — the plot's day 0 (optional; the push contract carries the same field).
    DateOnly? ReferenceDate = null);

public sealed record MigrateScheduleRequest(
    Guid FarmId,
    Guid NewScheduleTemplateId,
    string Reason,
    string? ReasonText = null,
    string? ClientCommandId = null,
    Guid? NewSubscriptionId = null,
    Guid? MigrationEventId = null,
    // spec: plr-d10 lane L8b-1 — the plot's day 0 (optional; none keeps the plot's current day 0).
    DateOnly? ReferenceDate = null,
    // spec: plr-d10 lane L8b-2 fix round 1 (B006) — the subscription the caller believed was Active (optional).
    Guid? FromSubscriptionId = null);

public sealed record AbandonScheduleRequest(
    Guid FarmId,
    string? ReasonText = null,
    string? ClientCommandId = null);

public sealed record CompleteScheduleRequest(
    Guid FarmId,
    string? ClientCommandId = null);
