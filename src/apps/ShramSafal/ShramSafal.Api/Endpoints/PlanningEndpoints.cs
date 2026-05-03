using System.Security.Claims;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.UseCases.Planning.ComputePlannedVsExecutedDelta;
using ShramSafal.Application.UseCases.Planning.GeneratePlanFromTemplate;
using ShramSafal.Application.UseCases.Planning.GetStagePlan;
using ShramSafal.Application.UseCases.Planning.GetTodaysPlan;

namespace ShramSafal.Api.Endpoints;

public static class PlanningEndpoints
{
    public static RouteGroupBuilder MapPlanningEndpoints(this RouteGroupBuilder group)
    {
        // T-IGH-03-PIPELINE-ROLLOUT (GeneratePlanFromTemplate): resolves
        // the pipeline-wrapped IHandler so the canonical
        // InvalidCommand → CropCycleNotFound → Forbidden ordering runs
        // before the body's template construction / planned-activity
        // expansion / test-due-date materialisation.
        group.MapPost("/plan/generate", async (
            GeneratePlanRequest request,
            ClaimsPrincipal user,
            IHandler<GeneratePlanFromTemplateCommand, PlanGenerationResultDto> handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            var activities = request.Activities
                .Select(a => new TemplateActivityInput(a.ActivityName, a.OffsetDays))
                .ToList();

            var command = new GeneratePlanFromTemplateCommand(
                actorUserId,
                request.CropCycleId,
                request.TemplateName,
                request.Stage,
                request.PlanStartDate,
                activities);

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("GeneratePlanFromTemplate");

        group.MapGet("/plan/today", async (
            Guid cropCycleId,
            ClaimsPrincipal user,
            GetTodaysPlanHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
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
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            var result = await handler.HandleAsync(new GetStagePlanQuery(actorUserId, cropCycleId, stage), ct);
            return result.IsSuccess
                ? Results.Ok(new { stage = stage ?? "current", activities = result.Value })
                : ToErrorResult(result.Error);
        })
        .WithName("GetStagePlan");

        group.MapGet("/compare", async (
            Guid cropCycleId,
            ClaimsPrincipal user,
            ComputePlannedVsExecutedDeltaHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
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
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            var result = await handler.HandleAsync(new ComputePlannedVsExecutedDeltaQuery(actorUserId, cropCycleId, stage), ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("ComputeStageComparison");

        return group;
    }

    private static IResult ToErrorResult(Error error)
    {
        return error.Code.EndsWith("NotFound", StringComparison.Ordinal)
            ? Results.NotFound(new { error = error.Code, message = error.Description })
            : Results.BadRequest(new { error = error.Code, message = error.Description });
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

