using AgriSync.BuildingBlocks.Results;
using System.Security.Claims;
using ShramSafal.Application.UseCases.CropCycles.CreateCropCycle;
using ShramSafal.Application.UseCases.Farms.CreateFarm;
using ShramSafal.Application.UseCases.Farms.CreatePlot;
using ShramSafal.Application.UseCases.Farms.GetFarmDetails;
using ShramSafal.Application.UseCases.Farms.GetFarmWeather;
using ShramSafal.Application.UseCases.Farms.UpdateFarmBoundary;

namespace ShramSafal.Api.Endpoints;

public static class FarmEndpoints
{
    public static RouteGroupBuilder MapFarmEndpoints(this RouteGroupBuilder group)
    {
        group.MapPost("/farms", async (
            CreateFarmRequest request,
            ClaimsPrincipal user,
            CreateFarmHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            var command = new CreateFarmCommand(request.Name, actorUserId);
            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("CreateFarm");

        group.MapGet("/farms/{farmId:guid}", async (
            Guid farmId,
            ClaimsPrincipal user,
            GetFarmDetailsHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            var command = new GetFarmDetailsCommand(farmId, actorUserId);
            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("GetFarmDetails");

        group.MapGet("/farms/{farmId:guid}/weather/current", async (
            Guid farmId,
            ClaimsPrincipal user,
            GetFarmWeatherHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            var result = await handler.HandleAsync(new GetFarmWeatherCommand(farmId, actorUserId), ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("GetFarmWeatherCurrent");

        group.MapGet("/farms/{farmId:guid}/weather/forecast", async (
            Guid farmId,
            int? days,
            ClaimsPrincipal user,
            GetFarmWeatherHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            var result = await handler.HandleAsync(new GetFarmForecastCommand(farmId, actorUserId, days ?? 5), ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("GetFarmWeatherForecast");

        group.MapPut("/farms/{farmId:guid}/boundary", async (
            Guid farmId,
            UpdateFarmBoundaryRequest request,
            ClaimsPrincipal user,
            AgriSync.BuildingBlocks.Application.IHandler<UpdateFarmBoundaryCommand, ShramSafal.Application.Contracts.Dtos.FarmDto> handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            var command = new UpdateFarmBoundaryCommand(
                farmId,
                actorUserId,
                request.PolygonGeoJson,
                request.CentreLat,
                request.CentreLng,
                request.CalculatedAreaAcres,
                ActorRole: EndpointActorContext.GetActorRole(user));
            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("UpdateFarmBoundary");

        group.MapPost("/plots", async (
            CreatePlotRequest request,
            ClaimsPrincipal user,
            AgriSync.BuildingBlocks.Application.IHandler<CreatePlotCommand, ShramSafal.Application.Contracts.Dtos.PlotDto> handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            var command = new CreatePlotCommand(
                request.FarmId,
                request.Name,
                request.AreaInAcres,
                actorUserId,
                PlotId: null,
                ActorRole: EndpointActorContext.GetActorRole(user));
            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("CreatePlot");

        group.MapPost("/cropcycles", async (
            CreateCropCycleRequest request,
            ClaimsPrincipal user,
            AgriSync.BuildingBlocks.Application.IHandler<CreateCropCycleCommand, ShramSafal.Application.Contracts.Dtos.CropCycleDto> handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            var command = new CreateCropCycleCommand(
                request.FarmId,
                request.PlotId,
                request.CropName,
                request.Stage,
                request.StartDate,
                request.EndDate,
                actorUserId,
                CropCycleId: null,
                ActorRole: EndpointActorContext.GetActorRole(user));

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("CreateCropCycle");

        return group;
    }

    private static IResult ToErrorResult(Error error)
    {
        if (error.Code.EndsWith("Forbidden", StringComparison.Ordinal))
        {
            return Results.Forbid();
        }

        if (error.Code == "ShramSafal.WeatherProviderNotConfigured")
        {
            return Results.Json(
                new { error = error.Code, message = error.Description },
                statusCode: StatusCodes.Status503ServiceUnavailable);
        }

        return error.Code.EndsWith("NotFound", StringComparison.Ordinal)
            ? Results.NotFound(new { error = error.Code, message = error.Description })
            : Results.BadRequest(new { error = error.Code, message = error.Description });
    }
}

public sealed record CreateFarmRequest(string Name);

public sealed record UpdateFarmBoundaryRequest(
    string PolygonGeoJson,
    double CentreLat,
    double CentreLng,
    decimal CalculatedAreaAcres);

public sealed record CreatePlotRequest(Guid FarmId, string Name, decimal AreaInAcres);

public sealed record CreateCropCycleRequest(
    Guid FarmId,
    Guid PlotId,
    string CropName,
    string Stage,
    DateOnly StartDate,
    DateOnly? EndDate);
