using AgriSync.BuildingBlocks.Audit;
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
            HttpContext httpContext,
            ClaimsPrincipal user,
            CreateFarmHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            // DATA_PRINCIPLE_SPINE sub-phase 04.3b — extract forensic
            // provenance for the AuditEvent row.
            var (auditDeviceId, auditIpHash) = httpContext.AuditClaims();
            var clientAppVersion = ResolveClientAppVersion(httpContext);

            var command = new CreateFarmCommand(
                request.Name,
                actorUserId,
                FarmId: null,
                ActorRole: null,
                ClientCommandId: null,
                ClientAppVersion: clientAppVersion,
                AuditDeviceId: auditDeviceId,
                AuditIpHash: auditIpHash);
            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("CreateFarm");

        group.MapGet("/farms/{farmId:guid}", async (
            Guid farmId,
            ClaimsPrincipal user,
            GetFarmDetailsHandler handler,
            ShramSafal.Application.Ports.ICallerFarmTenantScope scope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            // spec: voice-tenant-claim-caller-farm-2026-06-08 — establish the
            // membership-validated single-farm tenant scope so the farm read
            // passes under prod FORCE-RLS (this handler self-authorizes via the
            // repository and never sets the tenant claim). A non-member farmId
            // returns Forbidden → ToErrorResult maps the "...Forbidden" code to
            // Results.Forbid().
            var scopeResult = await scope.EstablishForCallerAsync(farmId, actorUserId, ct);
            if (!scopeResult.IsSuccess)
            {
                return ToErrorResult(scopeResult.Error);
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
            ShramSafal.Application.Ports.ICallerFarmTenantScope scope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            // spec: voice-tenant-claim-caller-farm-2026-06-08 — establish scope
            // before the farm read; weather then reaches its existing
            // WeatherProviderNotConfigured (503) path rather than the RLS 500.
            var scopeResult = await scope.EstablishForCallerAsync(farmId, actorUserId, ct);
            if (!scopeResult.IsSuccess)
            {
                return ToErrorResult(scopeResult.Error);
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
            ShramSafal.Application.Ports.ICallerFarmTenantScope scope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            // spec: voice-tenant-claim-caller-farm-2026-06-08 — establish scope
            // before the farm read; weather then reaches its existing
            // WeatherProviderNotConfigured (503) path rather than the RLS 500.
            var scopeResult = await scope.EstablishForCallerAsync(farmId, actorUserId, ct);
            if (!scopeResult.IsSuccess)
            {
                return ToErrorResult(scopeResult.Error);
            }

            var result = await handler.HandleAsync(new GetFarmForecastCommand(farmId, actorUserId, days ?? 5), ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("GetFarmWeatherForecast");

        group.MapPut("/farms/{farmId:guid}/boundary", async (
            Guid farmId,
            UpdateFarmBoundaryRequest request,
            HttpContext httpContext,
            ClaimsPrincipal user,
            AgriSync.BuildingBlocks.Application.IHandler<UpdateFarmBoundaryCommand, ShramSafal.Application.Contracts.Dtos.FarmDto> handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            // DATA_PRINCIPLE_SPINE sub-phase 04.3b — extract forensic
            // provenance for the AuditEvent row.
            var (auditDeviceId, auditIpHash) = httpContext.AuditClaims();
            var clientAppVersion = ResolveClientAppVersion(httpContext);

            var command = new UpdateFarmBoundaryCommand(
                farmId,
                actorUserId,
                request.PolygonGeoJson,
                request.CentreLat,
                request.CentreLng,
                request.CalculatedAreaAcres,
                ActorRole: EndpointActorContext.GetActorRole(user),
                ClientCommandId: null,
                ClientAppVersion: clientAppVersion,
                AuditDeviceId: auditDeviceId,
                AuditIpHash: auditIpHash);
            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("UpdateFarmBoundary");

        group.MapPost("/plots", async (
            CreatePlotRequest request,
            HttpContext httpContext,
            ClaimsPrincipal user,
            AgriSync.BuildingBlocks.Application.IHandler<CreatePlotCommand, ShramSafal.Application.Contracts.Dtos.PlotDto> handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            // DATA_PRINCIPLE_SPINE sub-phase 04.3b — extract forensic
            // provenance for the AuditEvent row.
            var (auditDeviceId, auditIpHash) = httpContext.AuditClaims();
            var clientAppVersion = ResolveClientAppVersion(httpContext);

            var command = new CreatePlotCommand(
                request.FarmId,
                request.Name,
                request.AreaInAcres,
                actorUserId,
                PlotId: null,
                ActorRole: EndpointActorContext.GetActorRole(user),
                ClientCommandId: null,
                ClientAppVersion: clientAppVersion,
                AuditDeviceId: auditDeviceId,
                AuditIpHash: auditIpHash);
            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("CreatePlot");

        group.MapPost("/cropcycles", async (
            CreateCropCycleRequest request,
            HttpContext httpContext,
            ClaimsPrincipal user,
            AgriSync.BuildingBlocks.Application.IHandler<CreateCropCycleCommand, ShramSafal.Application.Contracts.Dtos.CropCycleDto> handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            // DATA_PRINCIPLE_SPINE sub-phase 04.3b — extract forensic
            // provenance for the AuditEvent row.
            var (auditDeviceId, auditIpHash) = httpContext.AuditClaims();
            var clientAppVersion = ResolveClientAppVersion(httpContext);

            var command = new CreateCropCycleCommand(
                request.FarmId,
                request.PlotId,
                request.CropName,
                request.Stage,
                request.StartDate,
                request.EndDate,
                actorUserId,
                CropCycleId: null,
                ActorRole: EndpointActorContext.GetActorRole(user),
                ClientCommandId: null,
                ClientAppVersion: clientAppVersion,
                AuditDeviceId: auditDeviceId,
                AuditIpHash: auditIpHash);

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

    // DATA_PRINCIPLE_SPINE sub-phase 04.3b — single source for resolving the
    // X-App-Version header into the AuditEvent.AppVersion column, mirroring the
    // sub-phase 01.4 fallback used by other endpoints (FinanceEndpoints etc).
    private static string ResolveClientAppVersion(HttpContext httpContext)
    {
        var header = httpContext.Request.Headers["X-App-Version"].FirstOrDefault();
        return string.IsNullOrWhiteSpace(header) ? "unknown" : header!.Trim();
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
