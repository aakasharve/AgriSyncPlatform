using System.Security.Claims;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Application;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
using Microsoft.AspNetCore.Mvc;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Application.UseCases.Finance.AddCostEntry;
using ShramSafal.Application.UseCases.Finance.AllocateGlobalExpense;
using ShramSafal.Application.UseCases.Finance.CorrectCostEntry;
using ShramSafal.Application.UseCases.Finance.GetFinanceSummary;
using ShramSafal.Application.UseCases.Finance.GetPlotFinanceSummary;
using ShramSafal.Application.UseCases.Finance.SetPriceConfigVersion;
using ShramSafal.Domain.Finance;

namespace ShramSafal.Api.Endpoints;

public static class FinanceEndpoints
{
    public static RouteGroupBuilder MapFinanceEndpoints(this RouteGroupBuilder group)
    {
        group.MapPost("/finance/price-config", async (
            SetPriceConfigRequest request,
            ClaimsPrincipal user,
            IHandler<SetPriceConfigVersionCommand, ShramSafal.Application.Contracts.Dtos.PriceConfigDto> handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            var command = new SetPriceConfigVersionCommand(
                request.ItemName,
                request.UnitPrice,
                request.CurrencyCode,
                request.EffectiveFrom,
                request.Version,
                actorUserId,
                PriceConfigId: null,
                ActorRole: EndpointActorContext.GetActorRole(user));

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("SetPriceConfigVersion");

        // T-IGH-03-PIPELINE-ROLLOUT (AddCostEntry): resolves the
        // pipeline-wrapped handler. ValidationBehavior surfaces
        // InvalidCommand / UseSettleJobCardForLabourPayout,
        // AuthorizationBehavior surfaces FarmNotFound / Forbidden, and
        // the body re-checks farm + membership as defense-in-depth
        // before running the entitlement gate, plot lookup, crop-cycle
        // lookup, duplicate detection, high-amount flagging, audit,
        // save, and analytics. PushSyncBatchHandler stays on the raw
        // handler in this rollout pass (per the "only-with-tests"
        // guardrail).
        group.MapPost("/finance/cost-entry", async (
            AddCostEntryRequest request,
            ClaimsPrincipal user,
            IHandler<AddCostEntryCommand, AddCostEntryResultDto> handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            var command = new AddCostEntryCommand(
                request.FarmId,
                request.PlotId,
                request.CropCycleId,
                request.Category,
                request.Description,
                request.Amount,
                request.CurrencyCode,
                request.EntryDate,
                actorUserId,
                request.Location?.ToDomain(),
                CostEntryId: null,
                ActorRole: EndpointActorContext.GetActorRole(user));

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("AddCostEntry")
        .RequireAuthorization();

        group.MapPost("/finance/allocate", async (
            AllocateGlobalExpenseRequest request,
            ClaimsPrincipal user,
            AllocateGlobalExpenseHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            var command = new AllocateGlobalExpenseCommand(
                request.CostEntryId,
                request.AllocationBasis,
                request.Allocations
                    .Select(a => new AllocateGlobalExpenseAllocationCommand(a.PlotId, a.Amount))
                    .ToList(),
                actorUserId,
                request.DayLedgerId,
                EndpointActorContext.GetActorRole(user));

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("AllocateGlobalExpense")
        .RequireAuthorization();

        group.MapPost("/finance/cost-entry/{id:guid}/correct", async (
            Guid id,
            CorrectCostEntryRequest request,
            ClaimsPrincipal user,
            CorrectCostEntryHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            var command = new CorrectCostEntryCommand(
                id,
                request.CorrectedAmount,
                request.CurrencyCode,
                request.Reason,
                actorUserId,
                FinanceCorrectionId: null,
                ActorRole: EndpointActorContext.GetActorRole(user));

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("CorrectCostEntry")
        .RequireAuthorization();

        group.MapGet("/finance/summary", async (
            string? groupBy,
            DateOnly? fromDate,
            DateOnly? toDate,
            ClaimsPrincipal user,
            [FromServices] GetFinanceSummaryHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            var query = new GetFinanceSummaryQuery(actorUserId, groupBy ?? "day", fromDate, toDate);
            var result = await handler.HandleAsync(query, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("GetFinanceSummary");

        group.MapGet("/finance/plot-summary", async (
            Guid plotId,
            DateOnly? fromDate,
            DateOnly? toDate,
            ClaimsPrincipal user,
            [FromServices] GetPlotFinanceSummaryHandler handler,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            var result = await handler.HandleAsync(
                new GetPlotFinanceSummaryQuery(actorUserId, plotId, fromDate, toDate),
                ct);

            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("GetPlotFinanceSummary");

        group.MapPost("/finance/duplicate-check", async (
            DuplicateCheckRequest request,
            ClaimsPrincipal user,
            IShramSafalRepository repository,
            IClock clock,
            CancellationToken ct) =>
        {
            if (!EndpointActorContext.TryGetUserId(user, out var actorUserId))
            {
                return Results.Unauthorized();
            }

            if (request.FarmId == Guid.Empty ||
                string.IsNullOrWhiteSpace(request.Category) ||
                request.Amount <= 0)
            {
                return Results.BadRequest(new
                {
                    error = "ShramSafal.InvalidCommand",
                    message = "Request is invalid."
                });
            }

            var canReadFarm = await repository.IsUserMemberOfFarmAsync(request.FarmId, actorUserId, ct);
            if (!canReadFarm)
            {
                return Results.Forbid();
            }

            var windowMinutes = request.WindowMinutes <= 0 ? 120 : request.WindowMinutes;
            var candidate = CostEntry.Create(
                Guid.NewGuid(),
                request.FarmId,
                request.PlotId,
                request.CropCycleId,
                request.Category,
                request.Description ?? string.Empty,
                request.Amount,
                request.CurrencyCode,
                request.EntryDate,
                actorUserId,
                null,
                clock.UtcNow);

            var existing = await repository.GetCostEntriesForDuplicateCheck(
                new FarmId(request.FarmId),
                request.PlotId,
                request.Category,
                clock.UtcNow.AddMinutes(-windowMinutes),
                ct);

            var isDuplicate = DuplicateDetector.IsPotentialDuplicate(existing, candidate, windowMinutes);
            var matchedEntryId = existing.FirstOrDefault(entry =>
                string.Equals(entry.Category.Trim(), candidate.Category.Trim(), StringComparison.OrdinalIgnoreCase) &&
                entry.PlotId == candidate.PlotId &&
                decimal.Round(entry.Amount, 2, MidpointRounding.AwayFromZero) == decimal.Round(candidate.Amount, 2, MidpointRounding.AwayFromZero) &&
                Math.Abs((entry.CreatedAtUtc - candidate.CreatedAtUtc).TotalMinutes) <= windowMinutes)?.Id;

            return Results.Ok(new DuplicateCheckResponse(isDuplicate, matchedEntryId));
        })
        .WithName("CheckDuplicateCostEntry");

        return group;
    }

    private static IResult ToErrorResult(Error error)
    {
        if (error.Code.EndsWith("Forbidden", StringComparison.Ordinal))
        {
            return Results.Forbid();
        }

        return error.Code.EndsWith("NotFound", StringComparison.Ordinal)
            ? Results.NotFound(new { error = error.Code, message = error.Description })
            : Results.BadRequest(new { error = error.Code, message = error.Description });
    }

}

public sealed record SetPriceConfigRequest(
    string ItemName,
    decimal UnitPrice,
    string CurrencyCode,
    DateOnly EffectiveFrom,
    int Version);

public sealed record AddCostEntryRequest(
    Guid FarmId,
    Guid? PlotId,
    Guid? CropCycleId,
    string Category,
    string Description,
    decimal Amount,
    string CurrencyCode,
    DateOnly EntryDate,
    LocationRequest? Location);

public sealed record AllocateGlobalExpenseRequest(
    Guid CostEntryId,
    string AllocationBasis,
    IReadOnlyList<AllocateGlobalExpenseAllocationRequest> Allocations,
    Guid? DayLedgerId = null);

public sealed record DuplicateCheckRequest(
    Guid FarmId,
    Guid? PlotId,
    Guid? CropCycleId,
    string Category,
    string? Description,
    decimal Amount,
    string CurrencyCode,
    DateOnly EntryDate,
    int WindowMinutes = 120);

public sealed record DuplicateCheckResponse(bool IsDuplicate, Guid? MatchedEntryId);

public sealed record CorrectCostEntryRequest(
    decimal CorrectedAmount,
    string CurrencyCode,
    string Reason);

public sealed record AllocateGlobalExpenseAllocationRequest(
    Guid PlotId,
    decimal Amount);

