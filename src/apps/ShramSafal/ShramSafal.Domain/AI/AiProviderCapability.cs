namespace ShramSafal.Domain.AI;

/// <summary>
/// SARVAM_PRIMARY_VOICE_PIPELINE Task 1.2 — runtime authority for which
/// provider supports which AI operation, in which mode, at what cost,
/// with which streaming + SLA characteristics. Seeded from
/// <c>_COFOUNDER/Projects/AgriSync/Architecture/CAPABILITY_MATRIX.md</c>.
/// The <c>AiOrchestrator</c> and <see cref="AiProviderConfig"/> read this
/// table to decide routing; the matrix doc is the human-readable
/// reference, and this table is the machine-readable source.
/// </summary>
/// <remarks>
/// <para>
/// A capability row is uniquely identified by
/// <c>(Provider, Operation, Mode)</c>. <c>Mode</c> is nullable because
/// Gemini operations do not carry a mode while Sarvam STT does
/// (<c>codemix</c> | <c>verbatim</c> | <c>translit</c> | ...).
/// </para>
/// <para>
/// Cost fields (<see cref="CostPerUnitInr"/> + <see cref="CostUnit"/>)
/// and the latency SLA (<see cref="SlaTtftMs"/>) are nullable on
/// purpose. Per the supervisor's note in the
/// <c>SARVAM_PRIMARY_VOICE_PIPELINE</c> plan, seed values are ESTIMATE
/// only — the cost guardrail in Plan Task 2.7 reconciles them at
/// runtime from observed vendor billing.
/// </para>
/// </remarks>
public sealed class AiProviderCapability
{
    private AiProviderCapability() { } // EF Core

    private AiProviderCapability(
        Guid id,
        string provider,
        string operation,
        string? mode,
        bool supportsStreaming,
        int? maxAudioSeconds,
        decimal? costPerUnitInr,
        string? costUnit,
        int? slaTtftMs,
        bool isActive,
        DateTime createdAtUtc)
    {
        Id = id;
        Provider = provider;
        Operation = operation;
        Mode = mode;
        SupportsStreaming = supportsStreaming;
        MaxAudioSeconds = maxAudioSeconds;
        CostPerUnitInr = costPerUnitInr;
        CostUnit = costUnit;
        SlaTtftMs = slaTtftMs;
        IsActive = isActive;
        CreatedAtUtc = createdAtUtc;
        ModifiedAtUtc = createdAtUtc;
    }

    public Guid Id { get; private set; }

    /// <summary>
    /// Provider name (e.g. <c>Sarvam</c>, <c>Gemini</c>). Matches the
    /// string form of <see cref="AiProviderType"/> but stored as a
    /// free-form string so new providers can be registered without a
    /// code change.
    /// </summary>
    public string Provider { get; private set; } = string.Empty;

    /// <summary>
    /// Operation name (e.g. <c>VoiceToStructuredLog</c>,
    /// <c>ReceiptToExpenseItems</c>, <c>PattiImageToSaleData</c>,
    /// <c>VoiceTranscription</c>). Matches the string form of
    /// <see cref="AiOperationType"/> when applicable; new operations
    /// can be seeded without a code change.
    /// </summary>
    public string Operation { get; private set; } = string.Empty;

    /// <summary>
    /// Mode discriminator (<c>codemix</c> | <c>verbatim</c> |
    /// <c>transcribe</c> | <c>translit</c> | <c>translate</c>) — only
    /// used by Sarvam STT. Null for providers that have no mode.
    /// </summary>
    public string? Mode { get; private set; }

    public bool SupportsStreaming { get; private set; }
    public int? MaxAudioSeconds { get; private set; }
    public decimal? CostPerUnitInr { get; private set; }

    /// <summary>
    /// Unit basis for <see cref="CostPerUnitInr"/> (e.g.
    /// <c>per_hour_audio</c>, <c>per_million_input_tokens</c>,
    /// <c>per_million_audio_tokens</c>). Null when cost is undefined.
    /// </summary>
    public string? CostUnit { get; private set; }

    /// <summary>
    /// Latency SLA — vendor's published or measured time-to-first-token
    /// in milliseconds. Null when unknown.
    /// </summary>
    public int? SlaTtftMs { get; private set; }

    public bool IsActive { get; private set; }
    public DateTime CreatedAtUtc { get; private set; }
    public DateTime ModifiedAtUtc { get; private set; }

    /// <summary>
    /// Factory. Validates that <paramref name="provider"/> and
    /// <paramref name="operation"/> are non-empty; trims nullable
    /// fields and stores null for empty/whitespace; generates a new
    /// <see cref="Guid"/> if <paramref name="id"/> is
    /// <see cref="Guid.Empty"/>; stamps timestamps to
    /// <paramref name="createdAtUtc"/>.
    /// </summary>
    public static AiProviderCapability Create(
        Guid id,
        string provider,
        string operation,
        string? mode,
        bool supportsStreaming,
        int? maxAudioSeconds,
        decimal? costPerUnitInr,
        string? costUnit,
        int? slaTtftMs,
        bool isActive,
        DateTime createdAtUtc)
    {
        if (string.IsNullOrWhiteSpace(provider))
        {
            throw new ArgumentException("Provider is required.", nameof(provider));
        }

        if (string.IsNullOrWhiteSpace(operation))
        {
            throw new ArgumentException("Operation is required.", nameof(operation));
        }

        return new AiProviderCapability(
            id: id == Guid.Empty ? Guid.NewGuid() : id,
            provider: provider.Trim(),
            operation: operation.Trim(),
            mode: string.IsNullOrWhiteSpace(mode) ? null : mode.Trim(),
            supportsStreaming: supportsStreaming,
            maxAudioSeconds: maxAudioSeconds,
            costPerUnitInr: costPerUnitInr,
            costUnit: string.IsNullOrWhiteSpace(costUnit) ? null : costUnit.Trim(),
            slaTtftMs: slaTtftMs,
            isActive: isActive,
            createdAtUtc: createdAtUtc);
    }

    public void Deactivate()
    {
        IsActive = false;
        ModifiedAtUtc = DateTime.UtcNow;
    }

    public void Reactivate()
    {
        IsActive = true;
        ModifiedAtUtc = DateTime.UtcNow;
    }
}
