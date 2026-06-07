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
            "GetPlannedActivitiesChangedSinceAsync(farmIds, sinceUtc, ct)",
            "GetAuditEventsChangedSinceAsync(farmIds, sinceUtc, ct)"
        };

        foreach (var call in requiredCalls)
        {
            source.Should().Contain(call,
                "sync pull must push farm scope into SQL before RLS evaluates per-row policies");
        }
    }
}
