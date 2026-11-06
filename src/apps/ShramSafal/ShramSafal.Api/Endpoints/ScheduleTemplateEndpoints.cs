using System.Security.Claims;
using AgriSync.BuildingBlocks.Audit;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Planning.CloneScheduleTemplate;
using ShramSafal.Application.UseCases.Planning.EditScheduleTemplate;
using ShramSafal.Application.UseCases.Planning.GetScheduleLineage;
using ShramSafal.Application.UseCases.Planning.PublishScheduleTemplate;
using ShramSafal.Domain.Planning;

namespace ShramSafal.Api.Endpoints;

public static class ScheduleTemplateEndpoints
{
    public static RouteGroupBuilder MapScheduleTemplateEndpoints(this RouteGroupBuilder group)
    {
        // TODO: add rate limit 30/hr/user when rate limiting middleware is configured with a dedicated "schedule-clone" policy
        group.MapPost("/schedule-templates/{id}/clone", async (
            Guid id,
            CloneScheduleTemplateRequest request,
            Guid? farmId,
            HttpContext httpContext,
            ClaimsPrincipal user,
            CloneScheduleTemplateHandler handler,
            ICallerFarmTenantScope scope,
            ICallerUserTenantScope userScope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            // lane 2b (founder D-26; MU design §2) — a Team / Licensed write is authorised by a FARM
            // SEAT (schedule templates), never the account's global role: the caller names the farm
            // (?farmId=…) and its scope is set for that read. A Private write needs no farm.
            if (farmId is { } namedFarm)
            {
                var farmScope = await scope.EstablishForCallerAsync(namedFarm, actorUserId, ct);
                if (!farmScope.IsSuccess)
                {
                    return Results.Forbid();
                }
            }

            var newTemplateId = request.NewId ?? Guid.NewGuid();

            // DATA_PRINCIPLE_SPINE sub-phase 04.3b — extract forensic
            // provenance for the AuditEvent row.
            var (auditDeviceId, auditIpHash) = httpContext.AuditClaims();
            var clientAppVersion = ResolveClientAppVersion(httpContext);

            var command = new CloneScheduleTemplateCommand(
                SourceTemplateId: id,
                NewTemplateId: newTemplateId,
                CallerUserId: actorUserId,
                CallerRole: EndpointActorContext.GetActorRoleEnum(user),
                NewScope: request.NewScope,
                Reason: request.Reason,
                ClientCommandId: request.ClientCommandId,
                ClientAppVersion: clientAppVersion,
                AuditDeviceId: auditDeviceId,
                AuditIpHash: auditIpHash,
                FarmId: farmId);

            // spec: plr-d10 lane L8b-1 — a schedule template belongs to no farm: with no farm named, the caller's OWN user
            // scope is opened for the work (the route opened none, and its first read failed closed: 500 once the Include
            // fault in front of it was gone; F99 sweep, BareRequest).
            var result = farmId is null
                ? await userScope.RunForCallerAsync(actorUserId, token => handler.HandleAsync(command, token), ct)
                : await handler.HandleAsync(command, ct);
            return result.IsSuccess
                ? Results.Created($"/schedule-templates/{result.Value.NewTemplateId}", result.Value)
                : ToErrorResult(result.Error);
        })
        .WithName("CloneScheduleTemplate");

        group.MapPost("/schedule-templates/{id}/edit", async (
            Guid id,
            EditScheduleTemplateRequest request,
            Guid? farmId,
            HttpContext httpContext,
            ClaimsPrincipal user,
            EditScheduleTemplateHandler handler,
            ICallerFarmTenantScope scope,
            ICallerUserTenantScope userScope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            // lane 2b (founder D-26; MU design §2) — a Team / Licensed write is authorised by a FARM
            // SEAT (schedule templates), never the account's global role: the caller names the farm
            // (?farmId=…) and its scope is set for that read. A Private write needs no farm.
            if (farmId is { } namedFarm)
            {
                var farmScope = await scope.EstablishForCallerAsync(namedFarm, actorUserId, ct);
                if (!farmScope.IsSuccess)
                {
                    return Results.Forbid();
                }
            }

            // DATA_PRINCIPLE_SPINE sub-phase 04.3b — extract forensic
            // provenance for the AuditEvent row.
            var (auditDeviceId, auditIpHash) = httpContext.AuditClaims();
            var clientAppVersion = ResolveClientAppVersion(httpContext);

            var command = new EditScheduleTemplateCommand(
                SourceTemplateId: id,
                NewTemplateId: request.NewId,
                CallerUserId: actorUserId,
                CallerRole: EndpointActorContext.GetActorRoleEnum(user),
                NewName: request.NewName,
                NewStage: request.NewStage,
                ClientCommandId: request.ClientCommandId,
                ClientAppVersion: clientAppVersion,
                AuditDeviceId: auditDeviceId,
                AuditIpHash: auditIpHash,
                FarmId: farmId);

            // spec: plr-d10 lane L8b-1 — a schedule template belongs to no farm: with no farm named, the caller's OWN user
            // scope is opened for the work (the route opened none, and its first read failed closed: 500 once the Include
            // fault in front of it was gone; F99 sweep, BareRequest).
            var result = farmId is null
                ? await userScope.RunForCallerAsync(actorUserId, token => handler.HandleAsync(command, token), ct)
                : await handler.HandleAsync(command, ct);
            return result.IsSuccess
                ? Results.Created($"/schedule-templates/{result.Value.NewTemplateId}", result.Value)
                : ToErrorResult(result.Error);
        })
        .WithName("EditScheduleTemplate");

        group.MapPost("/schedule-templates/{id}/publish", async (
            Guid id,
            PublishScheduleTemplateRequest request,
            Guid? farmId,
            HttpContext httpContext,
            ClaimsPrincipal user,
            PublishScheduleTemplateHandler handler,
            ICallerFarmTenantScope scope,
            ICallerUserTenantScope userScope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            // lane 2b (founder D-26; MU design §2) — a Team / Licensed write is authorised by a FARM
            // SEAT (schedule templates), never the account's global role: the caller names the farm
            // (?farmId=…) and its scope is set for that read. A Private write needs no farm.
            if (farmId is { } namedFarm)
            {
                var farmScope = await scope.EstablishForCallerAsync(namedFarm, actorUserId, ct);
                if (!farmScope.IsSuccess)
                {
                    return Results.Forbid();
                }
            }

            // DATA_PRINCIPLE_SPINE sub-phase 04.3b — extract forensic
            // provenance for the AuditEvent row.
            var (auditDeviceId, auditIpHash) = httpContext.AuditClaims();
            var clientAppVersion = ResolveClientAppVersion(httpContext);

            var command = new PublishScheduleTemplateCommand(
                TemplateId: id,
                CallerUserId: actorUserId,
                CallerRole: EndpointActorContext.GetActorRoleEnum(user),
                ClientCommandId: request.ClientCommandId,
                ClientAppVersion: clientAppVersion,
                AuditDeviceId: auditDeviceId,
                AuditIpHash: auditIpHash,
                FarmId: farmId);

            // spec: plr-d10 lane L8b-1 — a schedule template belongs to no farm: with no farm named, the caller's OWN user
            // scope is opened for the work (the route opened none, and its first read failed closed: 500 once the Include
            // fault in front of it was gone; F99 sweep, BareRequest).
            var result = farmId is null
                ? await userScope.RunForCallerAsync(actorUserId, token => handler.HandleAsync(command, token), ct)
                : await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("PublishScheduleTemplate");

        group.MapGet("/schedule-templates/{rootId}/lineage", async (
            Guid rootId,
            ClaimsPrincipal user,
            GetScheduleLineageHandler handler,
            ICallerUserTenantScope userScope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            // lane F99 — a template's lineage belongs to no farm, so it is read under the caller's own user scope (the route
            // opened none: its first read failed closed, 500 for everyone).
            var result = await userScope.RunForCallerAsync(
                actorUserId, token => handler.HandleAsync(new GetScheduleLineageQuery(rootId, actorUserId), token), ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("GetScheduleLineage");

        return group;
    }

    private static IResult ToErrorResult(AgriSync.BuildingBlocks.Results.Error error)
    {
        if (error.Code.EndsWith("NotFound", StringComparison.Ordinal))
            return Results.NotFound(new { error = error.Code, message = error.Description });

        if (error.Code.EndsWith("Forbidden", StringComparison.Ordinal))
            return Results.Forbid();

        return Results.BadRequest(new { error = error.Code, message = error.Description });
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

public sealed record CloneScheduleTemplateRequest(
    Guid? NewId,
    TenantScope NewScope,
    string Reason,
    string? ClientCommandId);

public sealed record EditScheduleTemplateRequest(
    Guid NewId,
    string? NewName,
    string? NewStage,
    string? ClientCommandId);

public sealed record PublishScheduleTemplateRequest(
    string? ClientCommandId);
