using AgriSync.BuildingBlocks.Abstractions;
using AgriSync.BuildingBlocks.Results;
using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Audit;
using ShramSafal.Domain.Common;
using ShramSafal.Domain.Farms;

namespace ShramSafal.Application.UseCases.Finance.AllocateGlobalExpense;

public sealed class AllocateGlobalExpenseHandler(
    IShramSafalRepository repository,
    IIdGenerator idGenerator,
    IClock clock)
{
    public async Task<Result<DayLedgerDto>> HandleAsync(AllocateGlobalExpenseCommand command, CancellationToken ct = default)
    {
        if (command.CostEntryId == Guid.Empty ||
            command.CreatedByUserId == Guid.Empty ||
            string.IsNullOrWhiteSpace(command.AllocationBasis))
        {
            return Result.Failure<DayLedgerDto>(ShramSafalErrors.InvalidCommand);
        }

        if (command.DayLedgerId.HasValue && command.DayLedgerId.Value == Guid.Empty)
        {
            return Result.Failure<DayLedgerDto>(ShramSafalErrors.InvalidCommand);
        }

        var costEntry = await repository.GetCostEntryByIdAsync(command.CostEntryId, ct);
        if (costEntry is null)
        {
            return Result.Failure<DayLedgerDto>(ShramSafalErrors.CostEntryNotFound);
        }

        var canWriteFarm = await repository.IsUserMemberOfFarmAsync(costEntry.FarmId, command.CreatedByUserId, ct);
        if (!canWriteFarm)
        {
            return Result.Failure<DayLedgerDto>(ShramSafalErrors.Forbidden);
        }

        var existing = await repository.GetDayLedgerBySourceCostEntryIdAsync(command.CostEntryId, ct);
        if (existing is not null)
        {
            return Result.Success(existing.ToDto());
        }

        var normalizedBasis = NormalizeAllocationBasis(command.AllocationBasis);
        if (normalizedBasis is null)
        {
            return Result.Failure<DayLedgerDto>(ShramSafalErrors.InvalidCommand);
        }

        var farmPlots = await repository.GetPlotsByFarmIdAsync(costEntry.FarmId, ct);
        if (farmPlots.Count == 0)
        {
            return Result.Failure<DayLedgerDto>(ShramSafalErrors.PlotNotFound);
        }

        var nowUtc = clock.UtcNow;
        var allocations = normalizedBasis switch
        {
            "equal" => BuildEqualAllocations(costEntry.Amount, costEntry.CurrencyCode, farmPlots, nowUtc),
            "by_acreage" => BuildAcreageAllocations(costEntry.Amount, costEntry.CurrencyCode, farmPlots, nowUtc),
            "custom" => BuildCustomAllocations(costEntry.Amount, costEntry.CurrencyCode, farmPlots, command.Allocations, nowUtc),
            _ => null
        };

        if (allocations is null || allocations.Count == 0)
        {
            return Result.Failure<DayLedgerDto>(ShramSafalErrors.InvalidCommand);
        }

        var dayLedger = Domain.Finance.DayLedger.Create(
            command.DayLedgerId ?? idGenerator.New(),
            costEntry.FarmId,
            costEntry.Id,
            costEntry.EntryDate,
            normalizedBasis,
            command.CreatedByUserId,
            allocations,
            nowUtc);

        await repository.AddDayLedgerAsync(dayLedger, ct);
        await repository.AddAuditEventAsync(
            AuditEvent.Create(
                costEntry.FarmId,
                "DayLedger",
                dayLedger.Id,
                "Allocated",
                command.CreatedByUserId,
                command.ActorRole ?? "unknown",
                new
                {
                    dayLedger.Id,
                    dayLedger.FarmId,
                    dayLedger.SourceCostEntryId,
                    dayLedger.LedgerDate,
                    dayLedger.AllocationBasis,
                    TotalAmount = costEntry.Amount,
                    CurrencyCode = costEntry.CurrencyCode,
                    Allocations = dayLedger.Allocations.Select(a => new
                    {
                        a.Id,
                        a.PlotId,
                        a.AllocatedAmount,
                        a.CurrencyCode
                    }).ToList()
                },
                command.ClientCommandId,
                nowUtc),
            ct);

        await repository.SaveChangesAsync(ct);
        return Result.Success(dayLedger.ToDto());
    }

    private static string? NormalizeAllocationBasis(string rawBasis)
    {
        var normalized = rawBasis.Trim().ToLowerInvariant();
        return normalized switch
        {
            "equal" => "equal",
            "by_acreage" => "by_acreage",
            "custom" => "custom",
            _ => null
        };
    }

    private static IReadOnlyCollection<Domain.Finance.DayLedgerAllocation>? BuildEqualAllocations(
        decimal totalAmount,
        string currencyCode,
        IReadOnlyList<Plot> plots,
        DateTime allocatedAtUtc)
    {
        var totalCents = ToCents(totalAmount);
        if (totalCents < plots.Count)
        {
            return null;
        }

        var baseCents = totalCents / plots.Count;
        var remainder = totalCents % plots.Count;
        var allocations = new List<Domain.Finance.DayLedgerAllocation>(plots.Count);

        for (var index = 0; index < plots.Count; index++)
        {
            var cents = baseCents + (index < remainder ? 1L : 0L);
            allocations.Add(Domain.Finance.DayLedgerAllocation.Create(
                Guid.NewGuid(),
                plots[index].Id,
                FromCents(cents),
                currencyCode,
                allocatedAtUtc));
        }

        return allocations;
    }

    private static IReadOnlyCollection<Domain.Finance.DayLedgerAllocation>? BuildAcreageAllocations(
        decimal totalAmount,
        string currencyCode,
        IReadOnlyList<Plot> plots,
        DateTime allocatedAtUtc)
    {
        if (plots.Any(p => p.AreaInAcres <= 0))
        {
            return null;
        }

        var totalArea = plots.Sum(p => p.AreaInAcres);
        if (totalArea <= 0)
        {
            return null;
        }

        var totalCents = ToCents(totalAmount);
        if (totalCents < plots.Count)
        {
            return null;
        }

        var allocatedCents = 0L;
        var allocations = new List<Domain.Finance.DayLedgerAllocation>(plots.Count);
        for (var index = 0; index < plots.Count; index++)
        {
            var plot = plots[index];
            long cents;
            if (index == plots.Count - 1)
            {
                cents = totalCents - allocatedCents;
            }
            else
            {
                var ratio = plot.AreaInAcres / totalArea;
                cents = Math.Max(1L, (long)Math.Floor((double)(totalCents * ratio)));
                allocatedCents += cents;
            }

            allocations.Add(Domain.Finance.DayLedgerAllocation.Create(
                Guid.NewGuid(),
                plot.Id,
                FromCents(cents),
                currencyCode,
                allocatedAtUtc));
        }

        return allocations;
    }

    private static IReadOnlyCollection<Domain.Finance.DayLedgerAllocation>? BuildCustomAllocations(
        decimal totalAmount,
        string currencyCode,
        IReadOnlyList<Plot> farmPlots,
        IReadOnlyList<AllocateGlobalExpenseAllocationCommand> requestedAllocations,
        DateTime allocatedAtUtc)
    {
        if (requestedAllocations is null || requestedAllocations.Count == 0)
        {
            return null;
        }

        var farmPlotIds = farmPlots.Select(p => p.Id).ToHashSet();
        if (requestedAllocations.Any(a => a.PlotId == Guid.Empty || a.Amount <= 0 || !farmPlotIds.Contains(a.PlotId)))
        {
            return null;
        }

        var duplicatePlotId = requestedAllocations
            .GroupBy(a => a.PlotId)
            .Any(g => g.Count() > 1);
        if (duplicatePlotId)
        {
            return null;
        }

        var expected = decimal.Round(totalAmount, 2, MidpointRounding.AwayFromZero);
        var supplied = decimal.Round(requestedAllocations.Sum(a => a.Amount), 2, MidpointRounding.AwayFromZero);
        if (expected != supplied)
        {
            return null;
        }

        return requestedAllocations
            .Select(a => Domain.Finance.DayLedgerAllocation.Create(
                Guid.NewGuid(),
                a.PlotId,
                a.Amount,
                currencyCode,
                allocatedAtUtc))
            .ToList();
    }

    private static long ToCents(decimal amount) =>
        (long)decimal.Round(amount * 100m, 0, MidpointRounding.AwayFromZero);

    private static decimal FromCents(long cents) =>
        decimal.Round(cents / 100m, 2, MidpointRounding.AwayFromZero);
}
