namespace ShramSafal.Application.Contracts.Dtos;

public sealed record OpsVoiceTrendDto(
    IReadOnlyList<OpsVoiceDayDto> Days);

public sealed record OpsVoiceDayDto(
    DateOnly Date,
    int Invocations,
    int Failures,
    decimal SuccessRatePct,
    decimal AvgLatencyMs);
