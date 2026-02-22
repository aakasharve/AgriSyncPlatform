using System.Security.Claims;
using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using AgriSync.SharedKernel.Contracts.Ids;
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
            SetPriceConfigVersionHandler handler,
            CancellationToken ct) =>
        {
            var command = new SetPriceConfigVersionCommand(
                request.ItemName,
                request.UnitPrice,
                request.CurrencyCode,
                request.EffectiveFrom,
                request.Version,
                request.CreatedByUserId);

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("SetPriceConfigVersion");

        group.MapPost("/finance/cost-entry", async (
            AddCostEntryRequest request,
            ClaimsPrincipal user,
            AddCostEntryHandler handler,
            CancellationToken ct) =>
        {
            if (!TryGetCallerUserId(user, out var callerUserId))
            {
                return Results.Unauthorized();
            }

            if (request.CreatedByUserId != Guid.Empty && request.CreatedByUserId != callerUserId)
            {
                return Results.Forbid();
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
                callerUserId);

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("AddCostEntry")
        .RequireAuthorization();

        group.MapPost("/finance/cost-entry/{id:guid}/correct", async (
            Guid id,
            CorrectCostEntryRequest request,
            ClaimsPrincipal user,
            CorrectCostEntryHandler handler,
            CancellationToken ct) =>
        {
            if (!TryGetCallerUserId(user, out var callerUserId))
            {
                return Results.Unauthorized();
            }

            if (request.CorrectedByUserId != Guid.Empty && request.CorrectedByUserId != callerUserId)
            {
                return Results.Forbid();
            }

            var command = new CorrectCostEntryCommand(
                id,
                request.CorrectedAmount,
                request.CurrencyCode,
                request.Reason,
                callerUserId);

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("CorrectCostEntry")
        .RequireAuthorization();

        group.MapGet("/finance/summary", async (
            string? groupBy,
            DateOnly? fromDate,
            DateOnly? toDate,
            GetFinanceSummaryHandler handler,
            CancellationToken ct) =>
        {
            var query = new GetFinanceSummaryQuery(groupBy ?? "day", fromDate, toDate);
            var result = await handler.HandleAsync(query, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("GetFinanceSummary");

        group.MapPost("/finance/allocate", async (
            AllocateGlobalExpenseRequest request,
            ClaimsPrincipal user,
            AllocateGlobalExpenseHandler handler,
            CancellationToken ct) =>
        {
            if (!TryGetCallerUserId(user, out var callerUserId))
            {
                return Results.Unauthorized();
            }

            if (!Enum.TryParse<AllocationStrategy>(request.Strategy, true, out var strategy))
            {
                return Results.BadRequest(new
                {
                    error = "ShramSafal.InvalidAllocationStrategy",
                    message = "Allocation strategy must be Equal, ByAcreage, or Custom."
                });
            }

            var command = new AllocateGlobalExpenseCommand(
                request.FarmId,
                callerUserId,
                request.DateKey,
                request.CostEntryIds,
                strategy,
                request.CustomAllocations);

            var result = await handler.HandleAsync(command, ct);
            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("AllocateGlobalExpense")
        .RequireAuthorization();

        group.MapGet("/finance/plot-summary", async (
            Guid plotId,
            DateOnly? fromDate,
            DateOnly? toDate,
            GetPlotFinanceSummaryHandler handler,
            CancellationToken ct) =>
        {
            var result = await handler.HandleAsync(
                new GetPlotFinanceSummaryQuery(plotId, fromDate, toDate),
                ct);

            return result.IsSuccess ? Results.Ok(result.Value) : ToErrorResult(result.Error);
        })
        .WithName("GetPlotFinanceSummary");

        group.MapPost("/finance/duplicate-check", async (
            DuplicateCheckRequest request,
            IShramSafalRepository repository,
            IClock clock,
            CancellationToken ct) =>
        {
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
                request.CreatedByUserId == Guid.Empty ? Guid.NewGuid() : request.CreatedByUserId,
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
        return error.Code.EndsWith("NotFound", StringComparison.Ordinal)
            ? Results.NotFound(new { error = error.Code, message = error.Description })
            : Results.BadRequest(new { error = error.Code, message = error.Description });
    }

    private static bool TryGetCallerUserId(ClaimsPrincipal user, out Guid callerUserId)
    {
        callerUserId = Guid.Empty;
        var sub = user.FindFirstValue("sub") ?? user.FindFirstValue(ClaimTypes.NameIdentifier);
        return sub is not null && Guid.TryParse(sub, out callerUserId);
    }
}

public sealed record SetPriceConfigRequest(
    string ItemName,
    decimal UnitPrice,
    string CurrencyCode,
    DateOnly EffectiveFrom,
    int Version,
    Guid CreatedByUserId);

public sealed record AddCostEntryRequest(
    Guid FarmId,
    Guid? PlotId,
    Guid? CropCycleId,
    string Category,
    string Description,
    decimal Amount,
    string CurrencyCode,
    DateOnly EntryDate,
    Guid CreatedByUserId);

public sealed record AllocateGlobalExpenseRequest(
    Guid FarmId,
    DateOnly DateKey,
    IReadOnlyList<Guid> CostEntryIds,
    string Strategy,
    IReadOnlyDictionary<Guid, decimal>? CustomAllocations);

public sealed record DuplicateCheckRequest(
    Guid FarmId,
    Guid? PlotId,
    Guid? CropCycleId,
    string Category,
    string? Description,
    decimal Amount,
    string CurrencyCode,
    DateOnly EntryDate,
    Guid CreatedByUserId,
    int WindowMinutes = 120);

public sealed record DuplicateCheckResponse(bool IsDuplicate, Guid? MatchedEntryId);

public sealed record CorrectCostEntryRequest(
    decimal CorrectedAmount,
    string CurrencyCode,
    string Reason,
    Guid CorrectedByUserId);
