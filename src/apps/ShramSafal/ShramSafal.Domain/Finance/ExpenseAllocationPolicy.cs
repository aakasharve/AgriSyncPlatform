namespace ShramSafal.Domain.Finance;

public static class ExpenseAllocationPolicy
{
    public static List<PlotAllocation> CalculateAllocations(
        List<(Guid plotId, decimal acres)> plots,
        decimal totalCost,
        AllocationStrategy strategy,
        Dictionary<Guid, decimal>? customPercents)
    {
        ArgumentNullException.ThrowIfNull(plots);

        if (plots.Count == 0)
        {
            return [];
        }

        if (plots.Count == 1)
        {
            return
            [
                PlotAllocation.Create(
                    plots[0].plotId,
                    Guid.Empty,
                    100m,
                    RoundMoney(totalCost))
            ];
        }

        return strategy switch
        {
            AllocationStrategy.Equal => CalculateEqual(plots, totalCost),
            AllocationStrategy.ByAcreage => CalculateByAcreage(plots, totalCost),
            AllocationStrategy.Custom => CalculateCustom(plots, totalCost, customPercents),
            _ => CalculateEqual(plots, totalCost)
        };
    }

    private static List<PlotAllocation> CalculateEqual(List<(Guid plotId, decimal acres)> plots, decimal totalCost)
    {
        var count = plots.Count;
        var rawPercent = 100m / count;
        var roundedPercent = decimal.Round(rawPercent, 2, MidpointRounding.AwayFromZero);
        var roundedTotal = RoundMoney(totalCost);
        var roundedAmount = RoundMoney(totalCost / count);
        var result = new List<PlotAllocation>(count);
        decimal allocatedSoFar = 0m;
        decimal percentSoFar = 0m;

        for (var i = 0; i < count; i++)
        {
            var isLast = i == count - 1;
            var percent = isLast
                ? decimal.Round(100m - percentSoFar, 2, MidpointRounding.AwayFromZero)
                : roundedPercent;

            var amount = isLast
                ? decimal.Round(roundedTotal - allocatedSoFar, 2, MidpointRounding.AwayFromZero)
                : roundedAmount;

            result.Add(PlotAllocation.Create(plots[i].plotId, Guid.Empty, percent, amount));
            allocatedSoFar += amount;
            percentSoFar += percent;
        }

        return result;
    }

    private static List<PlotAllocation> CalculateByAcreage(List<(Guid plotId, decimal acres)> plots, decimal totalCost)
    {
        var totalAcreage = plots.Sum(p => p.acres > 0 ? p.acres : 0m);
        if (totalAcreage <= 0)
        {
            return CalculateEqual(plots, totalCost);
        }

        var result = new List<PlotAllocation>(plots.Count);
        decimal allocatedSoFar = 0m;
        decimal percentSoFar = 0m;

        for (var i = 0; i < plots.Count; i++)
        {
            var isLast = i == plots.Count - 1;
            var acres = plots[i].acres > 0 ? plots[i].acres : 0m;
            var percentRaw = totalAcreage == 0 ? 0m : (acres / totalAcreage) * 100m;
            var percent = isLast
                ? decimal.Round(100m - percentSoFar, 2, MidpointRounding.AwayFromZero)
                : decimal.Round(percentRaw, 2, MidpointRounding.AwayFromZero);

            var amount = isLast
                ? decimal.Round(RoundMoney(totalCost) - allocatedSoFar, 2, MidpointRounding.AwayFromZero)
                : RoundMoney((percentRaw / 100m) * totalCost);

            result.Add(PlotAllocation.Create(plots[i].plotId, Guid.Empty, percent, amount));
            allocatedSoFar += amount;
            percentSoFar += percent;
        }

        return result;
    }

    private static List<PlotAllocation> CalculateCustom(
        List<(Guid plotId, decimal acres)> plots,
        decimal totalCost,
        Dictionary<Guid, decimal>? customPercents)
    {
        if (customPercents is null || customPercents.Count == 0)
        {
            throw new ArgumentException("Custom percentages are required for custom allocation.", nameof(customPercents));
        }

        var configuredTotal = customPercents.Values.Sum();
        if (Math.Abs(configuredTotal - 100m) > 0.01m)
        {
            throw new ArgumentException("Custom percentages must sum to 100.", nameof(customPercents));
        }

        var result = new List<PlotAllocation>(plots.Count);
        decimal allocatedSoFar = 0m;
        decimal percentSoFar = 0m;

        for (var i = 0; i < plots.Count; i++)
        {
            var isLast = i == plots.Count - 1;
            customPercents.TryGetValue(plots[i].plotId, out var configuredPercent);
            var percent = isLast
                ? decimal.Round(100m - percentSoFar, 2, MidpointRounding.AwayFromZero)
                : decimal.Round(configuredPercent, 2, MidpointRounding.AwayFromZero);

            var amount = isLast
                ? decimal.Round(RoundMoney(totalCost) - allocatedSoFar, 2, MidpointRounding.AwayFromZero)
                : RoundMoney((configuredPercent / 100m) * totalCost);

            result.Add(PlotAllocation.Create(plots[i].plotId, Guid.Empty, percent, amount));
            allocatedSoFar += amount;
            percentSoFar += percent;
        }

        return result;
    }

    private static decimal RoundMoney(decimal amount) =>
        decimal.Round(amount, 2, MidpointRounding.AwayFromZero);
}
