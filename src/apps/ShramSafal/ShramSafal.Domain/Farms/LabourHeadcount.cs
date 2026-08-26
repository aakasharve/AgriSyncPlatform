namespace ShramSafal.Domain.Farms;

public static class LabourHeadcount
{
    /// count > 0 wins outright and the gender split is ignored — the parser emits
    /// count=5 AND femaleCount=5 for "५ बायका", so adding them double-counts.
    public static int Resolve(int? workerCount, int? maleCount, int? femaleCount)
        => workerCount is > 0 ? workerCount.Value : (maleCount ?? 0) + (femaleCount ?? 0);
}
