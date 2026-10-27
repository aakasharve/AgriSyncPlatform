using System.Security.Claims;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Audit;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Planning.OverridePlannedActivity;

namespace ShramSafal.Api.Endpoints;

public static class PlannedActivityEndpoints
{
    public static RouteGroupBuilder MapPlannedActivityEndpoints(this RouteGroupBuilder group)
    {
        group.MapPost("/planned-activities/{id:guid}/override", async (
            Guid id,
            OverridePlannedActivityRequest request,
            HttpContext httpContext,
            ClaimsPrincipal user,
            OverridePlannedActivityHandler handler,
            ICallerFarmTenantScope scope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            // spec: plr-d7-m1-multiuser-2026-10-26 (step 2) — scope first, on the farm the body
            // names, so the authorizer's farm reads run under the caller's tenant claim
            // (TenantConnectionInterceptor fails closed without one — the defect class
            // FarmScopedRouteTenantScopeTests guards for path-keyed routes; these three carry the
            // farm in the body). Not a member → 403, as elsewhere. WHO may plan is unchanged
            // (role >= Mukadam, the authorizers): the PlanWork permission is for D-24 tasks, and
            // the crop-schedule ↔ planning integration is on hold (founder D-24e2, 26 Oct).
            var scopeResult = await scope.EstablishForCallerAsync(request.FarmId, actorUserId, ct);
            if (!scopeResult.IsSuccess)
            {
                return ToErrorResult(scopeResult.Error);
            }

            // DATA_PRINCIPLE_SPINE sub-phase 04.3b — extract forensic
            // provenance for the AuditEvent row.
            var (auditDeviceId, auditIpHash) = httpContext.AuditClaims();
            var clientAppVersion = ResolveClientAppVersion(httpContext);

            var command = new OverridePlannedActivityCommand(
                PlannedActivityId: id,
                FarmId: request.FarmId,
                NewPlannedDate: request.NewPlannedDate,
                NewActivityName: request.NewActivityName,
                NewStage: request.NewStage,
                Reason: request.Reason,
                CallerUserId: actorUserId,
                ClientCommandId: request.ClientCommandId,
                ClientAppVersion: clientAppVersion,
                AuditDeviceId: auditDeviceId,
                AuditIpHash: auditIpHash);

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok() : ToErrorResult(result.Error);
        })
        .WithName("OverridePlannedActivity");

        group.MapPost("/planned-activities", async (
            AddLocalPlannedActivityRequest request,
            HttpContext httpContext,
            ClaimsPrincipal user,
            IHandler<AddLocalPlannedActivityCommand> handler,
            ICallerFarmTenantScope scope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            // spec: plr-d7-m1-multiuser-2026-10-26 (step 2) — scope first, on the farm the body
            // names, so the authorizer's farm reads run under the caller's tenant claim
            // (TenantConnectionInterceptor fails closed without one — the defect class
            // FarmScopedRouteTenantScopeTests guards for path-keyed routes; these three carry the
            // farm in the body). Not a member → 403, as elsewhere. WHO may plan is unchanged
            // (role >= Mukadam, the authorizers): the PlanWork permission is for D-24 tasks, and
            // the crop-schedule ↔ planning integration is on hold (founder D-24e2, 26 Oct).
            var scopeResult = await scope.EstablishForCallerAsync(request.FarmId, actorUserId, ct);
            if (!scopeResult.IsSuccess)
            {
                return ToErrorResult(scopeResult.Error);
            }

            // DATA_PRINCIPLE_SPINE sub-phase 04.3b — extract forensic
            // provenance for the AuditEvent row.
            var (auditDeviceId, auditIpHash) = httpContext.AuditClaims();
            var clientAppVersion = ResolveClientAppVersion(httpContext);

            var command = new AddLocalPlannedActivityCommand(
                NewActivityId: request.NewActivityId ?? Guid.NewGuid(),
                CropCycleId: request.CropCycleId,
                FarmId: request.FarmId,
                ActivityName: request.ActivityName,
                Stage: request.Stage,
                PlannedDate: request.PlannedDate,
                Reason: request.Reason,
                CallerUserId: actorUserId,
                ClientCommandId: request.ClientCommandId,
                ClientAppVersion: clientAppVersion,
                AuditDeviceId: auditDeviceId,
                AuditIpHash: auditIpHash);

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Created() : ToErrorResult(result.Error);
        })
        .WithName("AddLocalPlannedActivity");

        group.MapPost("/planned-activities/{id:guid}/remove", async (
            Guid id,
            RemovePlannedActivityRequest request,
            HttpContext httpContext,
            ClaimsPrincipal user,
            IHandler<RemovePlannedActivityCommand> handler,
            ICallerFarmTenantScope scope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            // spec: plr-d7-m1-multiuser-2026-10-26 (step 2) — scope first, on the farm the body
            // names, so the authorizer's farm reads run under the caller's tenant claim
            // (TenantConnectionInterceptor fails closed without one — the defect class
            // FarmScopedRouteTenantScopeTests guards for path-keyed routes; these three carry the
            // farm in the body). Not a member → 403, as elsewhere. WHO may plan is unchanged
            // (role >= Mukadam, the authorizers): the PlanWork permission is for D-24 tasks, and
            // the crop-schedule ↔ planning integration is on hold (founder D-24e2, 26 Oct).
            var scopeResult = await scope.EstablishForCallerAsync(request.FarmId, actorUserId, ct);
            if (!scopeResult.IsSuccess)
            {
                return ToErrorResult(scopeResult.Error);
            }

            // DATA_PRINCIPLE_SPINE sub-phase 04.3b — extract forensic
            // provenance for the AuditEvent row.
            var (auditDeviceId, auditIpHash) = httpContext.AuditClaims();
            var clientAppVersion = ResolveClientAppVersion(httpContext);

            var command = new RemovePlannedActivityCommand(
                PlannedActivityId: id,
                FarmId: request.FarmId,
                Reason: request.Reason,
                CallerUserId: actorUserId,
                ClientCommandId: request.ClientCommandId,
                ClientAppVersion: clientAppVersion,
                AuditDeviceId: auditDeviceId,
                AuditIpHash: auditIpHash);

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok() : ToErrorResult(result.Error);
        })
        .WithName("RemovePlannedActivity");

        return group;
    }

    private static IResult ToErrorResult(Error error)
    {
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

public sealed record OverridePlannedActivityRequest(
    Guid FarmId,
    DateOnly? NewPlannedDate,
    string? NewActivityName,
    string? NewStage,
    string Reason,
    string? ClientCommandId = null);

public sealed record AddLocalPlannedActivityRequest(
    Guid CropCycleId,
    Guid FarmId,
    string ActivityName,
    string Stage,
    DateOnly PlannedDate,
    string Reason,
    Guid? NewActivityId = null,
    string? ClientCommandId = null);

public sealed record RemovePlannedActivityRequest(
    Guid FarmId,
    string Reason,
    string? ClientCommandId = null);
