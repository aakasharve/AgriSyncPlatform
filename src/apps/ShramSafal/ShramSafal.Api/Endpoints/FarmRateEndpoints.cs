using System.Security.Claims;
using AgriSync.BuildingBlocks.Audit;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Finance.GetFarmRates;
using ShramSafal.Application.UseCases.Finance.SetFarmRate;
using ShramSafal.Domain.Finance;

namespace ShramSafal.Api.Endpoints;

/// <summary>
/// spec: plr-d10-redesign-real-integration-2026-10-25 — lane RATE-1 part A (founder D-72 "Own farm prices" = D-17 / D-43).
/// The REST doors of each farm's own price and rate list. The queued push <c>set_farm_rate</c> is the phone's write path;
/// the POST below runs the SAME handler. The shared ShramSafal list keeps its own doors (<c>/finance/price-config</c>,
/// <c>/may-write</c>), unchanged.
/// <list type="bullet">
/// <item><c>GET /finance/farm-rates?farmId=</c> — the farm's list as the caller may read it, with "may I set rates".</item>
/// <item><c>POST /finance/farm-rates</c> — one change (set / retire); refused visibly (403 with the rule's code and words)
/// to anyone but the primary account holder.</item>
/// <item><c>GET /finance/farm-rates/suggestions</c> — "ShramSafal सुचवलेला दर": ShramSafal's own suggested rates.</item>
/// </list>
/// </summary>
public static class FarmRateEndpoints
{
    public static RouteGroupBuilder MapFarmRateEndpoints(this RouteGroupBuilder group)
    {
        group.MapGet("/finance/farm-rates", async (
            Guid farmId,
            ClaimsPrincipal user,
            GetFarmRatesHandler handler,
            ICallerFarmTenantScope farmScope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            // The farm's scope first: a farm he is not an Active member of is refused with no farm GUC ever set (E4).
            if (await RouteFarmScope.OpenAsync(farmScope, farmId, actorUserId, ct) is { } refused)
            {
                return ToErrorResult(refused);
            }

            var result = await handler.HandleAsync(farmId, actorUserId, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("GetFarmRates");

        group.MapPost("/finance/farm-rates", async (
            SetFarmRateRequest request,
            HttpContext httpContext,
            ClaimsPrincipal user,
            SetFarmRateHandler handler,
            ICallerFarmTenantScope farmScope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            if (await RouteFarmScope.OpenAsync(farmScope, request.FarmId, actorUserId, ct) is { } refused)
            {
                return ToErrorResult(refused);
            }

            var (auditDeviceId, auditIpHash) = httpContext.AuditClaims();
            var header = httpContext.Request.Headers["X-App-Version"].FirstOrDefault();
            var result = await handler.HandleAsync(
                new SetFarmRateCommand(
                    request.FarmRateId ?? Guid.NewGuid(),
                    request.RateLineId ?? Guid.NewGuid(),
                    request.FarmId,
                    request.Change ?? SetFarmRateCommand.SetChange,
                    request.Kind,
                    request.ItemName,
                    request.Unit,
                    request.Basis,
                    request.WorkerCategory,
                    request.Amount,
                    request.CurrencyCode,
                    request.EffectiveFrom,
                    request.Season,
                    request.EndsOn,
                    request.SuggestionId,
                    actorUserId,
                    EndpointActorContext.GetActorRole(user),
                    ClientRequestId: null,
                    ClientAppVersion: string.IsNullOrWhiteSpace(header) ? "unknown" : header.Trim(),
                    AuditDeviceId: auditDeviceId,
                    AuditIpHash: auditIpHash),
                ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("SetFarmRate");

        group.MapGet("/finance/farm-rates/suggestions", async (
            ClaimsPrincipal user,
            GetRateSuggestionsHandler handler,
            ICallerUserTenantScope userScope,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            // The shared list belongs to no farm: read under the caller's own user scope (as /price-config/may-write).
            var result = await userScope.RunForCallerAsync(actorUserId, token => handler.HandleAsync(token), ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("GetFarmRateSuggestions");

        return group;
    }

    /// <summary>Every refusal carries its code and words (P5): the phone says the rule, never a bare status.</summary>
    private static IResult ToErrorResult(Error error)
    {
        var body = new { error = error.Code, message = error.Description };
        if (error.Code.EndsWith("Forbidden", StringComparison.Ordinal))
        {
            return Results.Json(body, statusCode: StatusCodes.Status403Forbidden);
        }

        if (error.Code.EndsWith("NotFound", StringComparison.Ordinal))
        {
            return Results.NotFound(body);
        }

        return error.Code == FarmRateErrors.Conflict.Code
            ? Results.Conflict(body)
            : Results.BadRequest(body);
    }
}

/// <summary>
/// lane RATE-1 — the REST body of one change: the same fields as the queued <c>set_farm_rate</c>. Absent ids are made by
/// the server (a REST caller that wants a repeat-safe write sends its own).
/// </summary>
public sealed record SetFarmRateRequest(
    Guid FarmId,
    Guid? FarmRateId,
    Guid? RateLineId,
    string? Change,
    string? Kind,
    string? ItemName,
    string? Unit,
    string? Basis,
    string? WorkerCategory,
    decimal? Amount,
    string? CurrencyCode,
    DateOnly? EffectiveFrom,
    string? Season,
    DateOnly? EndsOn,
    Guid? SuggestionId);
