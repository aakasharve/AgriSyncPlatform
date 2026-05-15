namespace ShramSafal.Domain.Finance;

public static class DuplicateDetector
{
    public static bool IsPotentialDuplicate(
        List<CostEntry> existing,
        CostEntry candidate,
        int windowMinutes = 120)
    {
        ArgumentNullException.ThrowIfNull(existing);
        ArgumentNullException.ThrowIfNull(candidate);

        if (windowMinutes < 0)
        {
            throw new ArgumentException("Window minutes cannot be negative.", nameof(windowMinutes));
        }

        foreach (var entry in existing)
        {
            // DATA_PRINCIPLE_SPINE sub-phase 02.5 — CategoryId is a
            // canonical code from `ssf.cost_categories(id)`. Codes are
            // exact (no whitespace or case variants reach this point
            // because the entity normalises on Create), so plain `==`
            // replaces the legacy Trim()/OrdinalIgnoreCase compare.
            var sameCategory = entry.CategoryId == candidate.CategoryId;

            var samePlot = entry.PlotId == candidate.PlotId;
            var sameAmount = decimal.Round(entry.Amount, 2, MidpointRounding.AwayFromZero) ==
                             decimal.Round(candidate.Amount, 2, MidpointRounding.AwayFromZero);

            var minutes = Math.Abs((entry.CreatedAtUtc - candidate.CreatedAtUtc).TotalMinutes);

            if (sameCategory && samePlot && sameAmount && minutes <= windowMinutes)
            {
                return true;
            }
        }

        return false;
    }
}
