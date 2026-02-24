namespace ShramSafal.Application.Contracts.Dtos;

public sealed record AiProviderConfigDto(
    Guid Id,
    string DefaultProvider,
    bool FallbackEnabled,
    bool IsAiProcessingDisabled,
    int MaxRetries,
    int CircuitBreakerThreshold,
    int CircuitBreakerResetSeconds,
    decimal VoiceConfidenceThreshold,
    decimal ReceiptConfidenceThreshold,
    string? VoiceProvider,
    string? ReceiptProvider,
    string? PattiProvider,
    DateTime ModifiedAtUtc,
    Guid ModifiedByUserId);

public sealed record ProviderStatsDto(
    int SuccessCount,
    int FailureCount);

public sealed record RecentAiJobDto(
    Guid Id,
    string OperationType,
    string Status,
    DateTime CreatedAtUtc,
    DateTime? CompletedAtUtc,
    IReadOnlyList<string> Providers);

public sealed record AiDashboardDto(
    AiProviderConfigDto Config,
    Dictionary<string, ProviderStatsDto> ProviderStats,
    Dictionary<string, int> Successes,
    Dictionary<string, int> Failures,
    DateTime SinceUtc,
    IReadOnlyList<RecentAiJobDto> RecentJobs);
