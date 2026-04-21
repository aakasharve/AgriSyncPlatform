using AgriSync.BuildingBlocks.Domain;
using AgriSync.SharedKernel.Contracts.Ids;

namespace ShramSafal.Domain.Compliance;

public sealed record ComplianceSignalRaisedEvent(
    Guid SignalId,
    FarmId FarmId,
    Guid PlotId,
    string RuleCode,
    ComplianceSeverity Severity,
    ComplianceSuggestedAction SuggestedAction,
    DateTime OccurredAtUtc) : IDomainEvent
{
    public Guid EventId { get; } = Guid.NewGuid();
    public DateTime OccurredOnUtc { get; } = OccurredAtUtc;
}
