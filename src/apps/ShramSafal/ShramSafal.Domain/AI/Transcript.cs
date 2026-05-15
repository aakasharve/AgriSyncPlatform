namespace ShramSafal.Domain.AI;

/// <summary>
/// Warm-tier transcript for an AI job attempt. One row per attempt
/// (uniqueness enforced at the persistence layer on <see cref="AiJobAttemptId"/>).
/// Per DATA_PRINCIPLE_SPINE sub-phase 02.3.
/// </summary>
/// <remarks>
/// <para>
/// Phase 03 will add a per-token confidence scorer that populates
/// <see cref="PerTokenConfidenceJson"/> with real data — for now we stamp
/// an empty JSON array (<c>"[]"</c>) as the honest placeholder rather than
/// invent token-level scores no provider returns today.
/// </para>
/// <para>
/// Likewise <see cref="LanguageTag"/> is sourced from the inbound language
/// hint that the orchestrator was called with (today hardcoded to
/// <c>"mr-IN"</c> in <c>ParseVoiceInputHandler</c>). Phase 03 will swap to
/// detected-language once a provider surfaces it on
/// <see cref="VoiceParseCanonicalResult"/>.
/// </para>
/// </remarks>
public sealed class Transcript
{
    public Guid Id { get; private set; }
    public Guid AiJobId { get; private set; }
    public Guid AiJobAttemptId { get; private set; }
    public string Text { get; private set; } = string.Empty;
    public string LanguageTag { get; private set; } = "unknown";
    public string PerTokenConfidenceJson { get; private set; } = "[]";
    public DateTime ProducedAtUtc { get; private set; }

    private Transcript() { }

    public static Transcript Create(
        Guid aiJobId,
        Guid aiJobAttemptId,
        string? text,
        string? languageTag,
        string? perTokenConfidenceJson) =>
        new()
        {
            Id = Guid.NewGuid(),
            AiJobId = aiJobId,
            AiJobAttemptId = aiJobAttemptId,
            Text = text ?? string.Empty,
            LanguageTag = string.IsNullOrWhiteSpace(languageTag) ? "unknown" : languageTag,
            PerTokenConfidenceJson = string.IsNullOrWhiteSpace(perTokenConfidenceJson) ? "[]" : perTokenConfidenceJson,
            ProducedAtUtc = DateTime.UtcNow,
        };
}
