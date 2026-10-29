namespace ShramSafal.Domain.Finance;

public static class CostCalculator
{
    // PLR-D10 I20 / N2 (founder D-7, 2026-10-26): `CalculateLabourCost` (count × rate) was DELETED.
    // It had no caller, and a wage worked out from a headcount is exactly what D-7 forbids: money
    // comes only from what the farmer stated, or later from an explicit agreement. Do not re-add it.

    public static decimal CalculateMachineryCost(decimal fuelCost, decimal rentalCost)
    {
        var total = fuelCost + rentalCost;
        return decimal.Round(total, 2, MidpointRounding.AwayFromZero);
    }

    public static decimal CalculateTotalDayCost(decimal labour, decimal inputs, decimal machinery)
    {
        var total = labour + inputs + machinery;
        return decimal.Round(total, 2, MidpointRounding.AwayFromZero);
    }
}
