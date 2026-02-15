using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.UseCases.Planning.ComputePlannedVsExecutedDelta;
using ShramSafal.Application.UseCases.Planning.GeneratePlanFromTemplate;

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

        group.MapGet("/compare", async (
            Guid cropCycleId,
            ComputePlannedVsExecutedDeltaHandler handler,
            CancellationToken ct) =>
        {
            var result = await handler.HandleAsync(new ComputePlannedVsExecutedDeltaQuery(cropCycleId), ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("ComputePlannedVsExecutedDelta");

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

