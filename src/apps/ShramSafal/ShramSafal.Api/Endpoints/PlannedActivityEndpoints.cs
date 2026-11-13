using System.Security.Claims;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Audit;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Planning.MoveScheduleStep;
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

        // spec: plr-d10 lane ATT-W (R29; founder L8-C1 note) - "पुढे ठरवा" on a step a FOLLOWED schedule asks (a step of the schedule's own
        // stored days, not a planned-activity row, so the override door above cannot move it). WHO: the schedule gate (PlanWork on this
        // farm and, for a chosen-plots seat, the subscription's plot), never the role-based check of that door. The farm is in the path, so
        // its scope is opened first (E4: a farm he cannot open answers like one that does not exist). Appends a row; nothing else changes.
        group.MapPost("/farms/{farmId:guid}/schedule-steps/move", async (
            Guid farmId,
            MoveScheduleStepRequest request,
            HttpContext httpContext,
            ClaimsPrincipal user,
            MoveScheduleStepHandler handler,
            ICallerFarmTenantScope farmScope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            if (await RouteFarmScope.OpenAsync(farmScope, farmId, actorUserId, ct) is { } refused)
            {
                return ToErrorResult(refused);
            }

            var (auditDeviceId, auditIpHash) = httpContext.AuditClaims();
            var result = await handler.HandleAsync(
                new MoveScheduleStepCommand(
                    FarmId: farmId,
                    SubscriptionId: request.SubscriptionId,
                    ActivityId: request.ActivityId,
                    OriginalDate: request.OriginalDate,
                    NewDate: request.NewDate,
                    CallerUserId: actorUserId,
                    ClientAppVersion: ResolveClientAppVersion(httpContext),
                    AuditDeviceId: auditDeviceId,
                    AuditIpHash: auditIpHash),
                ct);
            return result.IsSuccess ? Results.Ok() : ToErrorResult(result.Error);
        })
        .WithName("MoveScheduleStep");

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

/// <summary>spec: plr-d10 lane ATT-W - the body of the schedule-step move: ids and two days, no reason text.</summary>
public sealed record MoveScheduleStepRequest(
    Guid SubscriptionId,
    Guid ActivityId,
    DateOnly OriginalDate,
    DateOnly NewDate);
