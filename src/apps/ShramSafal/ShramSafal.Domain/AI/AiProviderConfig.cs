namespace ShramSafal.Domain.AI;

public sealed class AiProviderConfig
{
    private AiProviderConfig() { } // EF Core

    private AiProviderConfig(
        Guid id,
        AiProviderType defaultProvider,
        bool fallbackEnabled,
        bool isAiProcessingDisabled,
        int maxRetries,
        int circuitBreakerThreshold,
        int circuitBreakerResetSeconds,
        decimal voiceConfidenceThreshold,
        decimal receiptConfidenceThreshold,
        Guid modifiedByUserId,
        DateTime modifiedAtUtc)
    {
        Id = id;
        DefaultProvider = defaultProvider;
        FallbackEnabled = fallbackEnabled;
        IsAiProcessingDisabled = isAiProcessingDisabled;
        MaxRetries = maxRetries;
        CircuitBreakerThreshold = circuitBreakerThreshold;
        CircuitBreakerResetSeconds = circuitBreakerResetSeconds;
        VoiceConfidenceThreshold = voiceConfidenceThreshold;
        ReceiptConfidenceThreshold = receiptConfidenceThreshold;
        ModifiedByUserId = modifiedByUserId;
        ModifiedAtUtc = modifiedAtUtc;
    }

    public Guid Id { get; private set; }
    public AiProviderType DefaultProvider { get; private set; }
    public bool FallbackEnabled { get; private set; }
    public bool IsAiProcessingDisabled { get; private set; }
    public int MaxRetries { get; private set; }
    public int CircuitBreakerThreshold { get; private set; }
    public int CircuitBreakerResetSeconds { get; private set; }
    public decimal VoiceConfidenceThreshold { get; private set; }
    public decimal ReceiptConfidenceThreshold { get; private set; }
    public DateTime ModifiedAtUtc { get; private set; }
    public Guid ModifiedByUserId { get; private set; }

    public AiProviderType? VoiceProvider { get; private set; }
    public AiProviderType? ReceiptProvider { get; private set; }
    public AiProviderType? PattiProvider { get; private set; }

    public static AiProviderConfig CreateDefault()
    {
        var config = new AiProviderConfig(
            id: Guid.NewGuid(),
            defaultProvider: AiProviderType.Sarvam,
            fallbackEnabled: true,
            isAiProcessingDisabled: false,
            maxRetries: 1,
            circuitBreakerThreshold: 5,
            circuitBreakerResetSeconds: 60,
            voiceConfidenceThreshold: 0.60m,
            receiptConfidenceThreshold: 0.50m,
            modifiedByUserId: Guid.Empty,
            modifiedAtUtc: DateTime.UtcNow);

        config.VoiceProvider = AiProviderType.Sarvam;
        config.ReceiptProvider = AiProviderType.Gemini;
        config.PattiProvider = AiProviderType.Gemini;
        return config;
    }

    public AiProviderType GetProviderForOperation(AiOperationType operation)
    {
        return operation switch
        {
            AiOperationType.VoiceToStructuredLog when VoiceProvider.HasValue => VoiceProvider.Value,
            AiOperationType.ReceiptToExpenseItems when ReceiptProvider.HasValue => ReceiptProvider.Value,
            AiOperationType.PattiImageToSaleData when PattiProvider.HasValue => PattiProvider.Value,
            _ => DefaultProvider
        };
    }

    public void UpdateSettings(
        Guid modifiedByUserId,
        AiProviderType defaultProvider,
        bool fallbackEnabled,
        bool isAiProcessingDisabled,
        int maxRetries,
        int circuitBreakerThreshold,
        int circuitBreakerResetSeconds,
        decimal voiceConfidenceThreshold,
        decimal receiptConfidenceThreshold,
        AiProviderType? voiceProvider = null,
        AiProviderType? receiptProvider = null,
        AiProviderType? pattiProvider = null)
    {
        DefaultProvider = defaultProvider;
        FallbackEnabled = fallbackEnabled;
        IsAiProcessingDisabled = isAiProcessingDisabled;
        MaxRetries = Math.Max(0, maxRetries);
        CircuitBreakerThreshold = Math.Max(1, circuitBreakerThreshold);
        CircuitBreakerResetSeconds = Math.Max(10, circuitBreakerResetSeconds);
        VoiceConfidenceThreshold = Math.Clamp(voiceConfidenceThreshold, 0m, 1m);
        ReceiptConfidenceThreshold = Math.Clamp(receiptConfidenceThreshold, 0m, 1m);
        VoiceProvider = voiceProvider;
        ReceiptProvider = receiptProvider;
        PattiProvider = pattiProvider;
        ModifiedByUserId = modifiedByUserId;
        ModifiedAtUtc = DateTime.UtcNow;
    }
}
