using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.UseCases.CropCycles.CreateCropCycle;
using ShramSafal.Application.UseCases.Farms.CreateFarm;
using ShramSafal.Application.UseCases.Farms.CreatePlot;

namespace ShramSafal.Api.Endpoints;

public static class FarmEndpoints
{
    public static RouteGroupBuilder MapFarmEndpoints(this RouteGroupBuilder group)
    {
        group.MapPost("/farms", async (
            CreateFarmRequest request,
            CreateFarmHandler handler,
            CancellationToken ct) =>
        {
            var command = new CreateFarmCommand(request.Name, request.OwnerUserId);
            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("CreateFarm");

        group.MapPost("/plots", async (
            CreatePlotRequest request,
            CreatePlotHandler handler,
            CancellationToken ct) =>
        {
            var command = new CreatePlotCommand(request.FarmId, request.Name, request.AreaInAcres);
            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("CreatePlot");

        group.MapPost("/cropcycles", async (
            CreateCropCycleRequest request,
            CreateCropCycleHandler handler,
            CancellationToken ct) =>
        {
            var command = new CreateCropCycleCommand(
                request.FarmId,
                request.PlotId,
                request.CropName,
                request.Stage,
                request.StartDate,
                request.EndDate);

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("CreateCropCycle");

        return group;
    }

    private static IResult ToErrorResult(Error error)
    {
        return error.Code.EndsWith("NotFound", StringComparison.Ordinal)
            ? Results.NotFound(new { error = error.Code, message = error.Description })
            : Results.BadRequest(new { error = error.Code, message = error.Description });
    }
}

public sealed record CreateFarmRequest(string Name, Guid OwnerUserId);

public sealed record CreatePlotRequest(Guid FarmId, string Name, decimal AreaInAcres);

public sealed record CreateCropCycleRequest(
    Guid FarmId,
    Guid PlotId,
    string CropName,
    string Stage,
    DateOnly StartDate,
    DateOnly? EndDate);

