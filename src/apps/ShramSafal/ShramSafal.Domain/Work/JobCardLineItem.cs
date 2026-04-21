using AgriSync.BuildingBlocks.Money;

namespace ShramSafal.Domain.Work;

public sealed record JobCardLineItem(
    string ActivityType,      // e.g. "spray", "pruning" — same vocabulary as LogTask.ActivityType
    decimal ExpectedHours,
    Money RatePerHour,        // AgriSync.BuildingBlocks.Money
    string? Notes);
