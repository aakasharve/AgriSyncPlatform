using AgriSync.BuildingBlocks.Results;
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
            GeneratePlanFromTemplateHandler handler,
            CancellationToken ct) =>
        {
            var activities = request.Activities
                .Select(a => new TemplateActivityInput(a.ActivityName, a.OffsetDays))
                .ToList();

            var command = new GeneratePlanFromTemplateCommand(
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
            GetTodaysPlanHandler handler,
            CancellationToken ct) =>
        {
            var result = await handler.HandleAsync(new GetTodaysPlanQuery(cropCycleId), ct);
            return result.IsSuccess ? Results.Ok(new { activities = result.Value }) : ToErrorResult(result.Error);
        })
        .WithName("GetTodaysPlan");

        group.MapGet("/plan/stage", async (
            Guid cropCycleId,
            string? stage,
            GetStagePlanHandler handler,
            CancellationToken ct) =>
        {
            var result = await handler.HandleAsync(new GetStagePlanQuery(cropCycleId, stage), ct);
            return result.IsSuccess
                ? Results.Ok(new { stage = stage ?? "current", activities = result.Value })
                : ToErrorResult(result.Error);
        })
        .WithName("GetStagePlan");

        group.MapGet("/compare", async (
            Guid cropCycleId,
            ComputePlannedVsExecutedDeltaHandler handler,
            CancellationToken ct) =>
        {
            var result = await handler.HandleAsync(new ComputePlannedVsExecutedDeltaQuery(cropCycleId), ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("ComputePlannedVsExecutedDelta");

        group.MapGet("/compare/stage", async (
            Guid cropCycleId,
            string? stage,
            ComputePlannedVsExecutedDeltaHandler handler,
            CancellationToken ct) =>
        {
            var result = await handler.HandleAsync(new ComputePlannedVsExecutedDeltaQuery(cropCycleId, stage), ct);
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

