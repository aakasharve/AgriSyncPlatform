using AgriSync.BuildingBlocks.Audit;
using AgriSync.BuildingBlocks.Results;
using System.Security.Claims;
using System.Text.Json.Serialization;
using ShramSafal.Application.UseCases.CropCycles.CreateCropCycle;
using ShramSafal.Application.UseCases.Farms.CreateFarm;
using ShramSafal.Application.UseCases.Farms.CreatePlot;
using ShramSafal.Application.UseCases.Farms.SetPlotGroup;
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

        // Coordinate-based weather (no farm anchor) — used by the client when a
        // farm has no drawn centre, to show weather from the device's GPS.
        // Auth-required (group.RequireAuthorization); NO farm read / membership.
        group.MapGet("/weather/current", async (
            double lat,
            double lon,
            ClaimsPrincipal user,
            GetCoordinateWeatherHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out _))
            {
                return Results.Unauthorized();
            }

            var result = await handler.HandleAsync(new GetCoordinateWeatherCommand(lat, lon), ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("GetCoordinateWeatherCurrent")
        .RequireRateLimiting("ai");

        group.MapGet("/weather/forecast", async (
            double lat,
            double lon,
            int? days,
            ClaimsPrincipal user,
            GetCoordinateWeatherHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out _))
            {
                return Results.Unauthorized();
            }

            var result = await handler.HandleAsync(new GetCoordinateForecastCommand(lat, lon, days ?? 5), ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("GetCoordinateWeatherForecast")
        .RequireRateLimiting("ai");

        group.MapPut("/farms/{farmId:guid}/boundary", async (
            Guid farmId,
            UpdateFarmBoundaryRequest request,
            HttpContext httpContext,
            ClaimsPrincipal user,
            AgriSync.BuildingBlocks.Application.IHandler<UpdateFarmBoundaryCommand, ShramSafal.Application.Contracts.Dtos.FarmDto> handler,
            ShramSafal.Application.Ports.ICallerFarmTenantScope scope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            // spec: FINAL_SERVER_AUTHORITATIVE_EXECUTION_PLAN §P0.3 — establish
            // the membership-validated single-farm tenant scope BEFORE the
            // command runs. 69262b9f wired EstablishForCallerAsync into the
            // three farm READ routes above and missed this write; since
            // FORCE-RLS landed on ssf.farms the PUT has died at
            // TenantConnectionInterceptor's fail-closed throw on the FIRST
            // DbCommand of the authorization stage
            // (UpdateFarmBoundaryAuthorizer → GetFarmByIdAsync) — a 500 with
            // nothing written, for every farmer, on both live client call
            // sites (BackendFarmGeographyClient.ts, inviteApi.ts).
            //
            // 🛑 This must NOT be "fixed" by adding /shramsafal/farms to
            // TenantTransactionMiddleware.SkipPathPrefixes. Admin elevation
            // makes the interceptor a no-op that sets NO GUC at all, so once
            // ssf.farm_boundaries carries a policy the prior-boundary read
            // filters to nothing: the handler's `?? 0` silently resets the
            // version to 1 and `?.Archive` silently no-ops, losing boundary
            // history with no error. Only ICallerFarmTenantScope sets both
            // agrisync.farm_id and agrisync.owner_account_id.
            //
            // Authorization overlap: this scope forbids non-MEMBERS and is
            // NOT the ownership gate — UpdateFarmBoundaryAuthorizer still
            // requires owner and runs after it. A non-member farmId returns
            // Forbidden → ToErrorResult maps "...Forbidden" to Results.Forbid().
            var scopeResult = await scope.EstablishForCallerAsync(farmId, actorUserId, ct);
            if (!scopeResult.IsSuccess)
            {
                return ToErrorResult(scopeResult.Error);
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
                // Stage A0 / A3 — ActorRole no longer travels on the command. The JWT
                // membership claim GetActorRole reads is one role per ACCOUNT; the handler
                // now resolves the role on the target farm instead.
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
            ShramSafal.Application.Ports.ICallerFarmTenantScope farmScope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            // lane F99 — the farm the plot is for: its scope first (the route answered 500 without it).
            if (await RouteFarmScope.OpenAsync(farmScope, request.FarmId, actorUserId, ct) is { } refused)
            {
                return ToErrorResult(refused);
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

        // spec: plr-d10 lane GRP-1a - the owner's optional group label on ONE plot ({ "groupName": "..." | null }; null or
        // blank clears it). PUT, not PATCH: the host's CORS policy lists GET/POST/PUT/DELETE/OPTIONS only, so a browser or
        // WebView PATCH would die in preflight; a PUT of the label is also naturally idempotent (the same name twice is a
        // success). Same gate as add-plot (edit farm setup, from THIS farm's seat - not "owner only", the owner can
        // delegate it). The route names a plot of a farm: the plot's farm is found under the caller's own scope first, so a
        // missing plot, a plot of a farm he is not on, and a made-up farm id all answer 404 alike; only a member without
        // the authority is refused with 403.
        group.MapPut("/farms/{farmId:guid}/plots/{plotId:guid}/group", async (
            Guid farmId,
            Guid plotId,
            SetPlotGroupRequest request,
            HttpContext httpContext,
            ClaimsPrincipal user,
            AgriSync.BuildingBlocks.Application.IHandler<SetPlotGroupCommand, ShramSafal.Application.Contracts.Dtos.PlotDto> handler,
            ShramSafal.Application.Ports.IShramSafalRepository repository,
            ShramSafal.Application.Ports.ICallerUserTenantScope userScope,
            ShramSafal.Application.Ports.ICallerFarmTenantScope farmScope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            // The plot's farm is found under the caller's OWN user scope (a plot of a farm he is not on is not found, exactly
            // like a made-up id), then that farm's scope is opened - written out here (not through RouteFarmScope) because
            // FarmScopedRouteTenantScopeTests requires every /farms/{farmId} route to call EstablishForCallerAsync itself.
            var plotFarmId = await userScope.RunForCallerAsync(
                actorUserId,
                async token => (await repository.GetPlotByIdAsync(plotId, token)) is { } plot ? (Guid?)(Guid)plot.FarmId : null,
                ct);
            if (plotFarmId is not { } farmOfPlot)
            {
                return ToErrorResult(ShramSafal.Domain.Common.ShramSafalErrors.PlotNotFound);
            }

            var established = await farmScope.EstablishForCallerAsync(farmOfPlot, actorUserId, ct);
            if (!established.IsSuccess)
            {
                return ToErrorResult(established.Error);
            }

            var (auditDeviceId, auditIpHash) = httpContext.AuditClaims();
            var clientAppVersion = ResolveClientAppVersion(httpContext);

            var command = new SetPlotGroupCommand(
                farmId,
                plotId,
                request.GroupName,
                actorUserId,
                ClientCommandId: null,
                ClientAppVersion: clientAppVersion,
                AuditDeviceId: auditDeviceId,
                AuditIpHash: auditIpHash);
            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("SetPlotGroup");

        group.MapPost("/cropcycles", async (
            CreateCropCycleRequest request,
            HttpContext httpContext,
            ClaimsPrincipal user,
            AgriSync.BuildingBlocks.Application.IHandler<CreateCropCycleCommand, ShramSafal.Application.Contracts.Dtos.CropCycleDto> handler,
            ShramSafal.Application.Ports.ICallerFarmTenantScope farmScope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            // lane F99 — the farm the season is for: its scope first (the route answered 500 without it).
            if (await RouteFarmScope.OpenAsync(farmScope, request.FarmId, actorUserId, ct) is { } refused)
            {
                return ToErrorResult(refused);
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
                // Stage A0 / A3 — ActorRole no longer travels on the command. The JWT
                // membership claim GetActorRole reads is one role per ACCOUNT; the handler
                // now resolves the role on the target farm instead.
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
        => ErrorCapture.Stamp(error, MapErrorResult(error));

    private static IResult MapErrorResult(Error error)
    {
        // lane F99 (MU-4 review R3-L4) — the plot rule's refusal carries its code and words, as the job-card and test routes do.
        if (PlotRefusalResult.For(error) is { } plotRefusal)
        {
            return plotRefusal;
        }

        if (error.Code.EndsWith("Forbidden", StringComparison.Ordinal))
        {
            return Results.Forbid();
        }

        if (error.Code is "ShramSafal.WeatherProviderNotConfigured" or "ShramSafal.WeatherProviderUnavailable")
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

/// <summary>
/// spec: plr-d10 lane GRP-1a - the group label to set; <c>null</c> (or blank) clears it. The property is REQUIRED in the JSON
/// (a body without it is a 400): a body that merely forgot the field must never be read as "clear the group".
/// </summary>
public sealed record SetPlotGroupRequest([property: JsonRequired] string? GroupName);

public sealed record CreateCropCycleRequest(
    Guid FarmId,
    Guid PlotId,
    string CropName,
    string Stage,
    DateOnly StartDate,
    DateOnly? EndDate);
