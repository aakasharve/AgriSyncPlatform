using ShramSafal.Domain.AI;

namespace ShramSafal.Application.UseCases.AI.UpdateProviderConfig;

public sealed record UpdateProviderConfigCommand(
    Guid ActorUserId,
    string ActorRole,
    AiProviderType? DefaultProvider,
    bool? FallbackEnabled,
    bool? IsAiProcessingDisabled,
    int? MaxRetries,
    int? CircuitBreakerThreshold,
    int? CircuitBreakerResetSeconds,
    decimal? VoiceConfidenceThreshold,
    decimal? ReceiptConfidenceThreshold,
    AiProviderType? VoiceProvider,
    AiProviderType? ReceiptProvider,
    AiProviderType? PattiProvider);
