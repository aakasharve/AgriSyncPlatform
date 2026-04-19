using AgriSync.SharedKernel.Contracts.Ids;

namespace AgriSync.BuildingBlocks.Analytics;

public sealed record AnalyticsEvent(
    Guid EventId,
    string EventType,
    DateTime OccurredAtUtc,
    UserId? ActorUserId,
    FarmId? FarmId,
    OwnerAccountId? OwnerAccountId,
    string ActorRole,
    string Trigger,
    DateTime? DeviceOccurredAtUtc,
    string SchemaVersion,
    string PropsJson);
