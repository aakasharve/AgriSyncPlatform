using System.Security.Claims;
using AgriSync.BuildingBlocks.Audit;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Planning.ComputePlannedVsExecutedDelta;
using ShramSafal.Application.UseCases.Planning.GeneratePlanFromTemplate;
using ShramSafal.Application.UseCases.Planning.GetStagePlan;
using ShramSafal.Application.UseCases.Planning.GetTodaysPlan;

namespace ShramSafal.Api.Endpoints;

public static class PlanningEndpoints
{
    public static RouteGroupBuilder MapPlanningEndpoints(this RouteGroupBuilder group)
    {
        group.MapPost("/plan/generate", async (
            GeneratePlanRequest request,
            HttpContext httpContext,
            ClaimsPrincipal user,
            GeneratePlanFromTemplateHandler handler,
            IShramSafalRepository repository,
            ICallerUserTenantScope userScope,
            ICallerFarmTenantScope farmScope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            // lane F99 — the season's farm, found under his own scope, then its scope (the route answered 500 without it). The
            // handler then asks its own rules (membership, the plot rule), as before.
            if (await RouteFarmScope.OpenForRecordAsync(
                    userScope,
                    farmScope,
                    actorUserId,
                    async token => (await repository.GetCropCycleByIdAsync(request.CropCycleId, token))?.FarmId.Value,
                    ShramSafal.Domain.Common.ShramSafalErrors.CropCycleNotFound,
                    ct) is { } refused)
            {
                return ToErrorResult(refused);
            }

            // lane F99 — a body with no activities is the handler's own answer, never a null read (500).
            var activities = (request.Activities ?? [])
                .Select(a => new TemplateActivityInput(a.ActivityName, a.OffsetDays))
                .ToList();

            // DATA_PRINCIPLE_SPINE sub-phase 04.3b — extract forensic
            // provenance for downstream propagation into the chained
            // ScheduleTestDueDatesCommand.
            var (auditDeviceId, auditIpHash) = httpContext.AuditClaims();
            var clientAppVersion = ResolveClientAppVersion(httpContext);

            var command = new GeneratePlanFromTemplateCommand(
                actorUserId,
                request.CropCycleId,
                request.TemplateName,
                request.Stage,
                request.PlanStartDate,
                activities,
                ClientAppVersion: clientAppVersion,
                AuditDeviceId: auditDeviceId,
                AuditIpHash: auditIpHash);

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("GeneratePlanFromTemplate");

        group.MapGet("/plan/today", async (
            Guid cropCycleId,
            ClaimsPrincipal user,
            GetTodaysPlanHandler handler,
            IShramSafalRepository repository,
            ICallerUserTenantScope userScope,
            ICallerFarmTenantScope farmScope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            if (await OpenCycleFarmAsync(cropCycleId, actorUserId, repository, userScope, farmScope, ct) is { } refused)
            {
                return refused;
            }

            var result = await handler.HandleAsync(new GetTodaysPlanQuery(actorUserId, cropCycleId), ct);
            return result.IsSuccess ? Results.Ok(new { activities = result.Value }) : ToErrorResult(result.Error);
        })
        .WithName("GetTodaysPlan");

        group.MapGet("/plan/stage", async (
            Guid cropCycleId,
            string? stage,
            ClaimsPrincipal user,
            GetStagePlanHandler handler,
            IShramSafalRepository repository,
            ICallerUserTenantScope userScope,
            ICallerFarmTenantScope farmScope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            if (await OpenCycleFarmAsync(cropCycleId, actorUserId, repository, userScope, farmScope, ct) is { } refused)
            {
                return refused;
            }

            var result = await handler.HandleAsync(new GetStagePlanQuery(actorUserId, cropCycleId, stage), ct);
            return result.IsSuccess
                ? Results.Ok(new { stage = stage ?? "current", activities = result.Value })
                : ToErrorResult(result.Error);
        })
        .WithName("GetStagePlan");

        // spec: plr-d10 lane SCH-GATE-a (D-99, R28, E4) - what each schedule a plot follows asks in the plot's stage. A seat that does
        // not read the farm's overview gets 403; a plot that is not his to see answers 404, like a made-up id.
        group.MapGet("/farms/{farmId:guid}/plots/{plotId:guid}/stage-plan", async (
            Guid farmId,
            Guid plotId,
            DateOnly? forDate,
            ClaimsPrincipal user,
            ShramSafal.Application.Services.ScheduleStagePlan stagePlan,
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

            var result = await stagePlan.ForPlotAsync(farmId, plotId, actorUserId, forDate, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("GetPlotStagePlan");

        group.MapGet("/compare", async (
            Guid cropCycleId,
            ClaimsPrincipal user,
            ComputePlannedVsExecutedDeltaHandler handler,
            IShramSafalRepository repository,
            ICallerUserTenantScope userScope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            // spec: plr-d10 lane MU-4 - the route only: a season on a plot outside his chosen plots is not his to read.
            // The comparison itself is lane CMP-T's (founder D-68) and is not touched here.
            if (await CycleOutsidePlotsAsync(cropCycleId, actorUserId, repository, userScope, ct) is { } outside)
            {
                return outside;
            }

            var result = await handler.HandleAsync(new ComputePlannedVsExecutedDeltaQuery(actorUserId, cropCycleId), ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("ComputePlannedVsExecutedDelta");

        group.MapGet("/compare/stage", async (
            Guid cropCycleId,
            string? stage,
            ClaimsPrincipal user,
            ComputePlannedVsExecutedDeltaHandler handler,
            IShramSafalRepository repository,
            ICallerUserTenantScope userScope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            // spec: plr-d10 lane MU-4 - the route only (CMP-T owns the comparison): his plots' seasons only.
            if (await CycleOutsidePlotsAsync(cropCycleId, actorUserId, repository, userScope, ct) is { } outside)
            {
                return outside;
            }

            var result = await handler.HandleAsync(new ComputePlannedVsExecutedDeltaQuery(actorUserId, cropCycleId, stage), ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("ComputeStageComparison");

        return group;
    }

    /// <summary>
    /// lane MU-3 fix 1 (review item 12) — the plan routes name a CROP SEASON, so its farm is found under the caller's
    /// own user scope first (a season of a farm he is not on is not found), then the farm scope is opened as every
    /// working farm route does; without it the first read failed closed (500 for everyone). The handler then asks
    /// the farm's read scope (a कामगार is not shown the farm's plan). Null = open; otherwise the answer to return.
    /// </summary>
    private static async Task<IResult?> OpenCycleFarmAsync(
        Guid cropCycleId,
        Guid actorUserId,
        IShramSafalRepository repository,
        ICallerUserTenantScope userScope,
        ICallerFarmTenantScope farmScope,
        CancellationToken ct)
    {
        var farmId = await userScope.RunForCallerAsync(
            actorUserId,
            async token => (await repository.GetCropCycleByIdAsync(cropCycleId, token)) is { } cycle ? (Guid?)(Guid)cycle.FarmId : null,
            ct);
        if (farmId is not { } farm)
        {
            return ToErrorResult(ShramSafal.Domain.Common.ShramSafalErrors.CropCycleNotFound);
        }

        var established = await farmScope.EstablishForCallerAsync(farm, actorUserId, ct);
        if (!established.IsSuccess)
        {
            return ToErrorResult(established.Error);
        }

        // spec: plr-d10 lane MU-4 (11.6) - a chosen-plots seat reads the plan of his plots' seasons only.
        return await CycleOutsidePlotsAsync(cropCycleId, actorUserId, repository, userScope, ct);
    }

    /// <summary>
    /// spec: plr-d10 lane MU-4 - Forbidden when the season lies on a plot outside the caller's chosen plots; null when it
    /// is his (or he covers every plot, or the season is not found under his own scope - the caller's next read answers).
    /// </summary>
    private static async Task<IResult?> CycleOutsidePlotsAsync(
        Guid cropCycleId,
        Guid actorUserId,
        IShramSafalRepository repository,
        ICallerUserTenantScope userScope,
        CancellationToken ct)
    {
        var outside = await userScope.RunForCallerAsync(
            actorUserId,
            async token =>
            {
                if (await repository.GetCropCycleByIdAsync(cropCycleId, token) is not { } cycle)
                {
                    return false;
                }

                var scope = await ShramSafal.Application.Services.FarmReadGate.ScopeAsync(
                    repository, (Guid)cycle.FarmId, actorUserId, DateTime.UtcNow, token);
                return scope is not null && !scope.CoversPlot(cycle.PlotId);
            },
            ct);
        return outside ? ToErrorResult(ShramSafal.Domain.Common.ShramSafalErrors.Forbidden) : null;
    }

    private static IResult ToErrorResult(Error error)
    {
        // lane F99 (MU-4 review R3-L4) — the plot rule's refusal carries its code and words, as the job-card and test routes do.
        if (PlotRefusalResult.For(error) is { } plotRefusal)
        {
            return plotRefusal;
        }

        // lane MU-3 fix 1 — a refusal is a refusal (403), never a malformed request.
        if (error.Code.EndsWith("Forbidden", StringComparison.Ordinal))
        {
            return Results.Forbid();
        }

        return error.Code.EndsWith("NotFound", StringComparison.Ordinal)
            ? Results.NotFound(new { error = error.Code, message = error.Description })
            : Results.BadRequest(new { error = error.Code, message = error.Description });
    }

    // DATA_PRINCIPLE_SPINE sub-phase 04.3b — single source for resolving the
    // X-App-Version header into the AuditEvent.AppVersion column.
    private static string ResolveClientAppVersion(HttpContext httpContext)
    {
        var header = httpContext.Request.Headers["X-App-Version"].FirstOrDefault();
        return string.IsNullOrWhiteSpace(header) ? "unknown" : header!.Trim();
    }
}

public sealed record GeneratePlanRequest(
    Guid CropCycleId,
    string TemplateName,
    string Stage,
    DateOnly PlanStartDate,
    IReadOnlyList<GeneratePlanActivityRequest> Activities);

public sealed record GeneratePlanActivityRequest(
    string ActivityName,
    int OffsetDays);

