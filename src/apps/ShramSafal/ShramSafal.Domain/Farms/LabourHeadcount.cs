namespace ShramSafal.Domain.Farms;

public static class LabourHeadcount
{
    /// count > 0 wins outright and the gender split is ignored — the parser emits
    /// count=5 AND femaleCount=5 for "५ बायका", so adding them double-counts.
    ///
    /// <para>
    /// Task 6 (spec: 2026-08-28-labour-v2-release-1, P4) — <c>null</c> only when
    /// ALL THREE inputs are unstated: "we were not told", never a fabricated
    /// <c>0</c>. An explicitly stated <c>workerCount == 0</c> is a different,
    /// real fact ("he said nobody came") and still resolves the ordinary way
    /// (falling through to the — also unstated, hence 0-defaulted — split),
    /// exactly as before this task. Only the all-silent case changes.
    /// </para>
    public static int? Resolve(int? workerCount, int? maleCount, int? femaleCount)
    {
        if (workerCount is null && maleCount is null && femaleCount is null)
        {
            return null; // nobody told us anything — absence of evidence, not zero.
        }

        return workerCount is > 0 ? workerCount.Value : (maleCount ?? 0) + (femaleCount ?? 0);
    }
}
