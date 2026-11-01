using FluentAssertions;
using Xunit;

namespace AgriSync.ArchitectureTests;

public sealed class SyncPullRlsReadPathRules
{
    [Fact]
    public void Pull_sync_uses_farm_scoped_changed_since_queries_before_materializing_rows()
    {
        var solutionRoot = TestPathHelper.GetSolutionRoot();
        var handlerPath = Path.Combine(
            solutionRoot,
            "apps",
            "ShramSafal",
            "ShramSafal.Application",
            "UseCases",
            "Sync",
            "PullSyncChanges",
            "PullSyncChangesHandler.cs");

        var source = File.ReadAllText(handlerPath);

        var farmScopedReads = new[]
        {
            "GetFarmsChangedSinceAsync",
            "GetPlotsChangedSinceAsync",
            "GetCropCyclesChangedSinceAsync",
            "GetDailyLogsChangedSinceAsync",
            "GetAttachmentsChangedSinceAsync",
            "GetCostEntriesChangedSinceAsync",
            "GetFinanceCorrectionsChangedSinceAsync",
            "GetDayLedgersChangedSinceAsync",
            "GetPlannedActivitiesChangedSinceAsync"
        };

        // lane MU-3 — the pull reads each kind per group of farms (PullReadWindow: from the cursor, or
        // from the beginning for a farm whose access changed), so the call takes the group's farm ids
        // and cursor, `(ids, since, ct)`, instead of the whole pull's `(farmIds, sinceUtc, ct)`. Either
        // way the farm list reaches SQL; the farm-less overload `(sinceUtc, ct)` must never be used.
        foreach (var read in farmScopedReads)
        {
            System.Text.RegularExpressions.Regex.IsMatch(source, $@"{read}\((farmIds, sinceUtc|ids, since), ct\)")
                .Should().BeTrue(
                    $"sync pull must push farm scope into SQL before RLS evaluates per-row policies ({read})");
            source.Should().NotContain($"{read}(sinceUtc, ct)",
                $"the farm-less overload of {read} reads every farm's rows");
        }
    }

    /// <summary>
    /// §P0.2 — the audit ledger left this list, and it must not come back by the
    /// front door. <c>GetAuditEventsChangedSinceAsync(farmIds, ...)</c> used to be
    /// a required call here; it is now a FORBIDDEN one. Under user-scoped mode the
    /// interceptor sets only <c>agrisync.user_id</c>, so the tenant policy's farm
    /// equality never matched and every audit row the pull could return was a
    /// NULL-farm cross-tenant row. Re-adding the call re-opens that surface —
    /// scoping it by farm id would NOT close it, because the leak was never about
    /// the farm predicate.
    /// </summary>
    [Fact]
    public void Pull_sync_does_not_read_the_audit_ledger_at_all()
    {
        var solutionRoot = TestPathHelper.GetSolutionRoot();
        var handlerPath = Path.Combine(
            solutionRoot,
            "apps",
            "ShramSafal",
            "ShramSafal.Application",
            "UseCases",
            "Sync",
            "PullSyncChanges",
            "PullSyncChangesHandler.cs");

        var source = File.ReadAllText(handlerPath);

        source.Should().NotContain("repository.GetAuditEventsChangedSinceAsync",
            "§P0.2 — the sync pull must not read ssf.audit_events. Every row it could "
            + "return is a NULL-farm cross-tenant row (S3 keys for other farmers' voice "
            + "recordings, erasure subjects' GUIDs, PII-review staff notes). The response "
            + "field stays as an empty array for old APKs; the READ is gone.");
    }
}
