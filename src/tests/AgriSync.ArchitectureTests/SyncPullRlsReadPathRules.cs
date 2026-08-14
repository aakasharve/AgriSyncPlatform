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

        var requiredCalls = new[]
        {
            "GetFarmsChangedSinceAsync(farmIds, sinceUtc, ct)",
            "GetPlotsChangedSinceAsync(farmIds, sinceUtc, ct)",
            "GetCropCyclesChangedSinceAsync(farmIds, sinceUtc, ct)",
            "GetDailyLogsChangedSinceAsync(farmIds, sinceUtc, ct)",
            "GetAttachmentsChangedSinceAsync(farmIds, sinceUtc, ct)",
            "GetCostEntriesChangedSinceAsync(farmIds, sinceUtc, ct)",
            "GetFinanceCorrectionsChangedSinceAsync(farmIds, sinceUtc, ct)",
            "GetDayLedgersChangedSinceAsync(farmIds, sinceUtc, ct)",
            "GetPlannedActivitiesChangedSinceAsync(farmIds, sinceUtc, ct)"
        };

        foreach (var call in requiredCalls)
        {
            source.Should().Contain(call,
                "sync pull must push farm scope into SQL before RLS evaluates per-row policies");
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
