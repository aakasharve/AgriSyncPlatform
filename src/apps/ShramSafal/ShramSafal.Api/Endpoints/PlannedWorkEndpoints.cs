// spec: plr-d10-redesign-real-integration-2026-10-25 — lane L8c-1 (founder D-24 / D-24c / D-24e1, D-26, D-79; E4).
using System.Security.Claims;
using AgriSync.BuildingBlocks.Audit;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Planning.PlannedWork;

namespace ShramSafal.Api.Endpoints;

/// <summary>
/// The REST reads of the task record (the writes are the queued <c>plannedwork.*</c> pushes). Every route names its farm, so
/// the farm's scope is opened first (a farm he is not an Active member of is refused with no farm scope ever set: F99), and
/// every read follows the reader's rights exactly as the pull does (<c>PlannedWorkVisibility</c>).
/// <list type="bullet">
/// <item><c>GET /farms/{farmId}/planned-work/assignees</c> - the Active members the caller may give work to, each with the
/// plots he covers. The primary account holder and a holder of AssignWork only (others: 403).</item>
/// <item><c>GET /farms/{farmId}/planned-work[?since=]</c> - the tasks of the farm he may see.</item>
/// <item><c>GET /farms/{farmId}/planned-work/{plannedWorkId}</c> - one task; 404 for a made-up id, another farm's task and a
/// task he may not see (all the same answer).</item>
/// <item>Lane REM-1 (founder D-78; REST only, never queued: R21), for the primary owner and a holder of
/// "आठवणींची मांडणी बदलणे": <c>GET</c> and <c>PUT /farms/{farmId}/reminder-settings</c> and
/// <c>PUT</c> / <c>DELETE /farms/{farmId}/reminder-settings/always-show/{userId}</c>. Anyone else: 403. Another farm: the answer for
/// an unknown farm.</item>
/// </list>
/// </summary>
public static class PlannedWorkEndpoints
{
    public static RouteGroupBuilder MapPlannedWorkEndpoints(this RouteGroupBuilder group)
    {
        group.MapGet("/farms/{farmId:guid}/planned-work/assignees", async (
            Guid farmId,
            ClaimsPrincipal user,
            PlannedWorkReads reads,
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

            var result = await reads.AssigneesAsync(farmId, actorUserId, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("GetPlannedWorkAssignees");

        group.MapGet("/farms/{farmId:guid}/planned-work", async (
            Guid farmId,
            DateTime? since,
            ClaimsPrincipal user,
            PlannedWorkReads reads,
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

            var result = await reads.ListAsync(farmId, actorUserId, since?.ToUniversalTime(), ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("GetPlannedWork");

        group.MapGet("/farms/{farmId:guid}/planned-work/{plannedWorkId:guid}", async (
            Guid farmId,
            Guid plannedWorkId,
            ClaimsPrincipal user,
            PlannedWorkReads reads,
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

            var result = await reads.GetAsync(farmId, plannedWorkId, actorUserId, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("GetPlannedWorkById");

        // spec: plr-d10 lane REM-1 - the owner's reminder settings (REST only, online: a setting changes who sees what on every phone).
        group.MapGet("/farms/{farmId:guid}/reminder-settings", async (
            Guid farmId,
            ClaimsPrincipal user,
            ReminderSettingsHandler handler,
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

            var result = await handler.GetAsync(farmId, actorUserId, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("GetReminderSettings");

        group.MapPut("/farms/{farmId:guid}/reminder-settings", async (
            Guid farmId,
            UpdateReminderSettingsRequest? request,
            HttpContext http,
            ClaimsPrincipal user,
            ReminderSettingsHandler handler,
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

            var result = await handler.UpdateAsync(farmId, request, CallerOf(http, user, actorUserId), ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("PutReminderSettings");

        group.MapPut("/farms/{farmId:guid}/reminder-settings/always-show/{userId:guid}", async (
            Guid farmId,
            Guid userId,
            HttpContext http,
            ClaimsPrincipal user,
            ReminderSettingsHandler handler,
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

            var result = await handler.MarkAsync(farmId, userId, CallerOf(http, user, actorUserId), ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("PutReminderAlwaysShow");

        group.MapDelete("/farms/{farmId:guid}/reminder-settings/always-show/{userId:guid}", async (
            Guid farmId,
            Guid userId,
            HttpContext http,
            ClaimsPrincipal user,
            ReminderSettingsHandler handler,
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

            var result = await handler.UnmarkAsync(farmId, userId, CallerOf(http, user, actorUserId), ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("DeleteReminderAlwaysShow");

        return group;
    }

    /// <summary>The authenticated sender and the audit stamps of a REST call (no client mutation id: it is not queued).</summary>
    private static PlannedWorkCaller CallerOf(HttpContext http, ClaimsPrincipal user, Guid actorUserId)
    {
        var (deviceId, ipHash) = http.AuditClaims();
        var version = http.Request.Headers["X-App-Version"].FirstOrDefault();
        return new PlannedWorkCaller(
            actorUserId,
            EndpointActorContext.GetActorRole(user),
            ClientMutationId: null,
            ClientAppVersion: string.IsNullOrWhiteSpace(version) ? "unknown" : version.Trim(),
            AuditDeviceId: deviceId,
            AuditIpHash: ipHash);
    }

    /// <summary>Every refusal carries its code and words (P5): the phone says the rule, never a bare status.</summary>
    private static IResult ToErrorResult(Error error)
    {
        var body = new { error = error.Code, message = error.Description };
        if (error.Code.EndsWith("Forbidden", StringComparison.Ordinal))
        {
            return Results.Json(body, statusCode: StatusCodes.Status403Forbidden);
        }

        return error.Code.EndsWith("NotFound", StringComparison.Ordinal)
            ? Results.NotFound(body)
            : Results.BadRequest(body);
    }
}
