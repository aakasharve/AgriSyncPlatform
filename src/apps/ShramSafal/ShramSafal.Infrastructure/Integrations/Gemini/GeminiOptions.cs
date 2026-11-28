namespace ShramSafal.Infrastructure.Integrations.Gemini;

public sealed class GeminiOptions
{
    public const string SectionName = "Gemini";

    // The SORTING model (Marathi transcript text -> structured log JSON). 28 Nov 2026, founder's decision for the pilot:
    // gemini-3.5-flash-lite. Why, what it was compared with, and the rule for ever changing it:
    // docs/ai/MODEL-SELECTION.md. (Before this it was gemini-3.1-flash-lite, which the live app still runs.)
    public const string DefaultStructurerModelId = "gemini-3.5-flash-lite";
    public const string DefaultOcrModelId = "gemini-3.5-flash-lite";

    // No longer read: Gemini never receives a recording (founder's order 23 Nov 2026), so there is no voice-fallback model.
    // The value is kept only so the admin config endpoint and old settings files keep binding.
    public const string DefaultVoiceFallbackModelId = "gemini-3.5-flash-lite";
    public const string DefaultModelId = DefaultVoiceFallbackModelId;

    // gemini-3.5-flash-lite: 65,536 output tokens, 1M-token input (docs/ai/MODEL-SELECTION.md). The sorting call stays
    // inside both: the whole transcript goes in one call, and the answer cap below is half the model's.
    public const int StructurerMaxOutputTokensCeiling = 65_536;
    public const int DefaultStructurerMaxOutputTokens = 32_768;
    public const int DefaultStructurerTimeoutSeconds = 60;

    public string ApiKey { get; set; } = string.Empty;
    public string StructurerModelId { get; set; } = DefaultStructurerModelId;
    public string OcrModelId { get; set; } = DefaultOcrModelId;
    public string VoiceFallbackModelId { get; set; } = DefaultVoiceFallbackModelId;
    public decimal Temperature { get; set; } = 0.2m;

    /// <summary>Answer cap for bills and sale slips (photos). The sorting step uses <see cref="StructurerMaxOutputTokens"/>.</summary>
    public int MaxTokens { get; set; } = 4096;

    // PLR lane V-1 fix pass (orchestrator's call) — the voice fallback may get a long recording; 30 s was too short.
    public int TimeoutSeconds { get; set; } = 120;
    public string BaseUrl { get; set; } = "https://generativelanguage.googleapis.com/v1beta";

    /// <summary>
    /// The sorting call's answer cap (<c>maxOutputTokens</c>), thinking tokens included. 32,768 is half the model's 65,536
    /// and holds a note of about five minutes in ONE call; a longer one that is cut off is split in half by
    /// <c>ChunkedStructuring</c> (logged), never silently truncated. Values above
    /// <see cref="StructurerMaxOutputTokensCeiling"/> are clamped to it; 0 or less reads as the default.
    /// </summary>
    public int StructurerMaxOutputTokens { get; set; } = DefaultStructurerMaxOutputTokens;

    /// <summary>
    /// Send an enforced response schema (the skeleton: an object, a <c>dayOutcome</c> of the four known values, the row buckets
    /// as arrays of objects; rows stay open) with the sorting call, so the answer is valid JSON by construction. True in the
    /// pilot. False sends JSON mode only (<c>responseMimeType</c>), for the case the API rejects the schema. See
    /// <c>StructurerResponseSchema</c> and docs/ai/MODEL-SELECTION.md.
    /// </summary>
    public bool StructurerResponseSchema { get; set; } = true;

    /// <summary>
    /// Deadline of ONE sorting call. Shorter than <see cref="TimeoutSeconds"/> on purpose: when Gemini is slow or stuck, the
    /// farmer should reach the Sarvam backup within about a minute, not two. 0 or less reads as the default.
    /// </summary>
    public int StructurerTimeoutSeconds { get; set; } = DefaultStructurerTimeoutSeconds;

    /// <summary>
    /// Thinking tokens the sorting call may spend: 0 = thinking off (the pilot setting: sorting is extraction, not
    /// reasoning, and thinking tokens count against <see cref="StructurerMaxOutputTokens"/> and the bill). Negative =
    /// the field is not sent (the model's own default). Ignored when <see cref="StructurerThinkingLevel"/> is set.
    /// </summary>
    public int StructurerThinkingBudget { get; set; }

    /// <summary>
    /// Gemini 3 models take a thinking LEVEL (<c>minimal</c>, <c>low</c>, <c>medium</c>, <c>high</c>) instead of a token
    /// budget. When set, it is sent in place of <see cref="StructurerThinkingBudget"/>. Empty = send the budget.
    /// </summary>
    public string? StructurerThinkingLevel { get; set; }

    [Obsolete("Use StructurerModelId, OcrModelId, or VoiceFallbackModelId per operation.")]
    public string? ModelId { get; set; }

    [Obsolete("Use StructurerModelId, OcrModelId, or VoiceFallbackModelId per operation.")]
    public string? Model
    {
        get => ModelId;
        set => ModelId = value;
    }
}
