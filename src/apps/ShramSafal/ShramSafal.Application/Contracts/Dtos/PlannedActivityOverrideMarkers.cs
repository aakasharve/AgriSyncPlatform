namespace ShramSafal.Application.Contracts.Dtos;

public sealed record PlannedActivityOverrideMarkers(
    bool IsLocallyAdded,
    bool IsLocallyChanged,
    string? OverrideReason,
    DateTime? OverriddenAtUtc,
    bool IsRemoved,
    string? RemovedReason);
