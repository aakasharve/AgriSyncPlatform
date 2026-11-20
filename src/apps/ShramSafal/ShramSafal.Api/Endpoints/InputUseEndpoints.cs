// spec: facts-card-input-truth-2026-11-19 (lane FACTS, slice C)
using System.Security.Claims;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Inputs.InputUseLedger;

namespace ShramSafal.Api.Endpoints;

/// <summary>
/// The season ledger of a farm's inputs (what he said and what the server worked out beside it), as JSON for the owner screen and as a
/// CSV that opens in Excel with Marathi readable, plus the rebuild of the derived rows. Owner (primary account holder) only; a seat that
/// is not 403, a farm he is not on answers like a made-up id (E4). Read-only except the rebuild, which replaces derived rows only.
/// </summary>
public static class InputUseEndpoints
{
    public static RouteGroupBuilder MapInputUseEndpoints(this RouteGroupBuilder group)
    {
        group.MapGet("/farms/{farmId:guid}/input-use", async (
            Guid farmId, DateOnly? from, DateOnly? to,
            ClaimsPrincipal user, GetInputUseLedgerHandler handler, ICallerFarmTenantScope farmScope, CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId)) return Results.Unauthorized();
            if (await RouteFarmScope.OpenAsync(farmScope, farmId, actorUserId, ct) is { } refused) return ToErrorResult(refused);

            var result = await handler.HandleAsync(farmId, actorUserId, from, to, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("GetInputUseLedger");

        group.MapGet("/farms/{farmId:guid}/input-use.csv", async (
            Guid farmId, DateOnly? from, DateOnly? to,
            ClaimsPrincipal user, GetInputUseLedgerHandler handler, ICallerFarmTenantScope farmScope, CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId)) return Results.Unauthorized();
            if (await RouteFarmScope.OpenAsync(farmScope, farmId, actorUserId, ct) is { } refused) return ToErrorResult(refused);

            var result = await handler.HandleAsync(farmId, actorUserId, from, to, ct);
            if (!result.IsSuccess) return ToErrorResult(result.Error);

            var ledger = result.Value;
            return Results.File(InputUseLedgerCsv.Build(ledger), "text/csv; charset=utf-8", $"input-use-{ledger.From:yyyy-MM-dd}-to-{ledger.To:yyyy-MM-dd}.csv");
        })
        .WithName("GetInputUseLedgerCsv");

        group.MapPost("/farms/{farmId:guid}/input-use/rebuild", async (
            Guid farmId, DateOnly? from, DateOnly? to,
            ClaimsPrincipal user, RebuildInputUseHandler handler, ICallerFarmTenantScope farmScope, CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId)) return Results.Unauthorized();
            if (await RouteFarmScope.OpenAsync(farmScope, farmId, actorUserId, ct) is { } refused) return ToErrorResult(refused);

            var result = await handler.HandleAsync(farmId, actorUserId, from, to, ct);
            return result.IsSuccess ? Results.Ok(new { derived = result.Value }) : ToErrorResult(result.Error);
        })
        .WithName("RebuildInputUse");

        return group;
    }

    private static IResult ToErrorResult(Error error) =>
        error.Code.Contains("NotFound") ? Results.NotFound(error.Description)
        : error.Code.Contains("Forbidden") ? Results.Forbid()
        : Results.BadRequest(error.Description);
}
