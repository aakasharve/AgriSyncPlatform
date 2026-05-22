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

    // SARVAM_PRIMARY_VOICE_PIPELINE Task 1.2 — split voice pipeline into
    // transcriber (Sarvam Saaras V3) + structurer (Gemini 3.1 Flash-Lite)
    // tuple. `TranscriberMode` carries Sarvam STT mode ('codemix' |
    // 'verbatim' | 'translit' | ...; per `CAPABILITY_MATRIX.md`).
    // `TranslatorProvider` is reserved (currently NULL — English bundle is
    // produced inside the Gemini structurer per ADR-DS-014).
    public string TranscriberProvider { get; private set; } = "Gemini";
    public string? TranscriberMode { get; private set; }
    public string StructurerProvider { get; private set; } = "Gemini";
    public string? TranslatorProvider { get; private set; }

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

    /// <summary>
    /// SARVAM_PRIMARY_VOICE_PIPELINE Task 1.2 — set the voice-pipeline
    /// provider tuple: transcriber (e.g. Sarvam Saaras V3) +
    /// transcriber mode (e.g. <c>codemix</c>) + structurer (e.g. Gemini
    /// 3.1 Flash-Lite) + optional translator. Validates that the two
    /// required providers are non-empty; trims nullable fields and
    /// stores <c>null</c> for empty/whitespace strings; bumps
    /// <see cref="ModifiedAtUtc"/>.
    /// </summary>
    public void SetProviderTuple(
        string transcriberProvider,
        string? transcriberMode,
        string structurerProvider,
        string? translatorProvider)
    {
        if (string.IsNullOrWhiteSpace(transcriberProvider))
        {
            throw new ArgumentException(
                "Transcriber provider is required.",
                nameof(transcriberProvider));
        }

        if (string.IsNullOrWhiteSpace(structurerProvider))
        {
            throw new ArgumentException(
                "Structurer provider is required.",
                nameof(structurerProvider));
        }

        TranscriberProvider = transcriberProvider.Trim();
        TranscriberMode = string.IsNullOrWhiteSpace(transcriberMode)
            ? null
            : transcriberMode.Trim();
        StructurerProvider = structurerProvider.Trim();
        TranslatorProvider = string.IsNullOrWhiteSpace(translatorProvider)
            ? null
            : translatorProvider.Trim();
        ModifiedAtUtc = DateTime.UtcNow;
    }
}
