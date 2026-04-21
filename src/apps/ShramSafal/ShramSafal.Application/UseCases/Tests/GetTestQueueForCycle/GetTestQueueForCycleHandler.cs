using ShramSafal.Application.Contracts.Dtos;
using ShramSafal.Application.Ports;
using ShramSafal.Domain.Tests;

namespace ShramSafal.Application.UseCases.Tests.GetTestQueueForCycle;

/// <summary>
/// Handler for <see cref="GetTestQueueForCycleQuery"/>. Loads all test
/// instances for the cycle, optionally filters out reported ones, orders by
/// <see cref="TestInstance.PlannedDueDate"/>, and enriches with protocol
/// names.
/// </summary>
public sealed class GetTestQueueForCycleHandler(
    ITestInstanceRepository testInstanceRepository,
    ITestProtocolRepository testProtocolRepository)
{
    public async Task<IReadOnlyList<TestInstanceDto>> HandleAsync(
        GetTestQueueForCycleQuery query,
        CancellationToken ct = default)
    {
        if (query is null || query.CropCycleId == Guid.Empty)
        {
            return Array.Empty<TestInstanceDto>();
        }

        var instances = await testInstanceRepository
            .GetByCropCycleIdAsync(query.CropCycleId, ct);

        if (instances.Count == 0)
        {
            return Array.Empty<TestInstanceDto>();
        }

        var filtered = query.IncludeReported
            ? instances
            : instances.Where(i => i.Status != TestInstanceStatus.Reported).ToList();

        if (filtered.Count == 0)
        {
            return Array.Empty<TestInstanceDto>();
        }

        var ordered = filtered.OrderBy(i => i.PlannedDueDate).ToList();

        var protocolNames = new Dictionary<Guid, string?>();
        foreach (var protocolId in ordered.Select(i => i.TestProtocolId).Distinct())
        {
            var proto = await testProtocolRepository.GetByIdAsync(protocolId, ct);
            protocolNames[protocolId] = proto?.Name;
        }

        return ordered
            .Select(i => TestInstanceDto.FromDomain(
                i,
                protocolNames.TryGetValue(i.TestProtocolId, out var name) ? name : null))
            .ToList();
    }
}
