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
    AiProviderType? PattiProvider,
    // DATA_PRINCIPLE_SPINE sub-phase 04.3b — forensic provenance fields
    // sourced from the AuditContextMiddleware (HttpContext.AuditClaims())
    // and the X-App-Version header at the endpoint. UpdateProviderConfig
    // is an admin operation but still runs inside an HTTP request, so the
    // endpoint uses the normal httpContext.AuditClaims() path (not the
    // WorkerClaims() sentinel). Default sentinels keep direct-construction
    // unit tests green.
    string ClientAppVersion = "unknown",
    string AuditDeviceId = "unknown",
    string AuditIpHash = "sha256:unknown");
