namespace ShramSafal.Domain.Finance;

public static class CostCalculator
{
    public static decimal CalculateLabourCost(int maleCount, int femaleCount, decimal maleRate, decimal femaleRate)
    {
        if (maleCount < 0 || femaleCount < 0)
        {
            throw new ArgumentException("Worker counts cannot be negative.");
        }

        var total = (maleCount * maleRate) + (femaleCount * femaleRate);
        return decimal.Round(total, 2, MidpointRounding.AwayFromZero);
    }

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
