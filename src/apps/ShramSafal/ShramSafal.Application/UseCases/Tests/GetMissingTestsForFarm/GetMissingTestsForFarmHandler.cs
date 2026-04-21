using AgriSync.BuildingBlocks.Abstractions;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Tests;

namespace ShramSafal.Application.UseCases.Tests.GetMissingTestsForFarm;

/// <summary>
/// Handler for <see cref="GetMissingTestsForFarmQuery"/>. Pulls all Due and
/// Overdue test instances on the farm, filters those with
/// <c>PlannedDueDate &lt;= today</c>, and joins the protocol name.
/// </summary>
public sealed class GetMissingTestsForFarmHandler(
    ITestInstanceRepository testInstanceRepository,
    ITestProtocolRepository testProtocolRepository,
    IClock clock)
{
    private static readonly TestInstanceStatus[] MissingStatuses =
    [
        TestInstanceStatus.Due,
        TestInstanceStatus.Overdue
    ];

    public async Task<IReadOnlyList<MissingTestSummary>> HandleAsync(
        GetMissingTestsForFarmQuery query,
        CancellationToken ct = default)
    {
        if (query is null || query.FarmId.IsEmpty)
        {
            return Array.Empty<MissingTestSummary>();
        }

        var instances = await testInstanceRepository
            .GetByFarmIdAndStatusAsync(query.FarmId, MissingStatuses, ct);

        if (instances.Count == 0)
        {
            return Array.Empty<MissingTestSummary>();
        }

        var today = DateOnly.FromDateTime(clock.UtcNow);
        var due = instances
            .Where(i => i.PlannedDueDate <= today)
            .OrderBy(i => i.PlannedDueDate)
            .ToList();

        if (due.Count == 0)
        {
            return Array.Empty<MissingTestSummary>();
        }

        // Join protocol names (batch lookup by id — each call is cheap in the fake;
        // real infra will micro-optimise in Phase 3).
        var protocolNames = new Dictionary<Guid, string>();
        foreach (var protocolId in due.Select(i => i.TestProtocolId).Distinct())
        {
            var proto = await testProtocolRepository.GetByIdAsync(protocolId, ct);
            protocolNames[protocolId] = proto?.Name ?? string.Empty;
        }

        return due.Select(i => new MissingTestSummary(
                TestInstanceId: i.Id,
                PlotId: i.PlotId,
                CropCycleId: i.CropCycleId,
                StageName: i.StageName,
                TestProtocolName: protocolNames.TryGetValue(i.TestProtocolId, out var name) ? name : string.Empty,
                PlannedDueDate: i.PlannedDueDate,
                DaysOverdue: Math.Max(0, today.DayNumber - i.PlannedDueDate.DayNumber)))
            .ToList();
    }
}
