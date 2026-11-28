using ShramSafal.Domain.AI;

namespace ShramSafal.Infrastructure.AI;

/// <summary>
/// 28 Nov 2026 (founder's sorting-model decision for the pilot) — who SORTS the transcript, and who sorts it if the first
/// choice fails. Bound from <c>Ai:Structurer</c>. Which MODEL each provider uses stays that provider's own setting
/// (<c>Gemini:StructurerModelId</c>, <c>Sarvam:ChatModel</c>): see <c>docs/ai/MODEL-SELECTION.md</c>.
///
/// <para>
/// <b>Scope.</b> Only the sorting step: Marathi transcript text in, structured log JSON out. Speech-to-text is not
/// chosen here and is always Sarvam Saaras; Gemini is never handed a recording (it answers
/// <c>IAiProvider.CanHandle(voice) = false</c>, and <c>GeminiAiProvider.ParseVoiceAsync</c> refuses anything that is
/// not <c>text/*</c>).
/// </para>
///
/// <para>
/// <b>Wins over the database.</b> <c>ssf.ai_provider_configs.structurer_provider</c> (set to Sarvam by migration
/// <c>20261124090000</c>) still exists and is what the orchestrator reads when this section names no provider. When
/// <see cref="Provider"/> is set, it is the one that decides, so the pilot needs no migration and a rollback is a
/// settings change (<c>Ai__Structurer__Provider=Sarvam</c>) plus a restart. The admin page that edits the database
/// column is a post-pilot item and does not override this setting.
/// </para>
/// </summary>
public sealed class VoiceStructurerOptions
{
    public const string SectionName = "Ai:Structurer";

    /// <summary>The words that mean "no sorter" / "no backup" in <see cref="Fallback"/>.</summary>
    public const string None = "None";

    /// <summary><c>Gemini</c> or <c>Sarvam</c>. Empty = the database row decides.</summary>
    public string? Provider { get; set; }

    /// <summary>
    /// Who sorts the transcript once if <see cref="Provider"/> times out, answers 5xx, or still gives an unusable answer
    /// after its own retry. <c>Gemini</c> or <c>Sarvam</c>; <c>None</c> = no backup. Empty = no backup either (the
    /// behaviour before this setting existed); the shipped settings name <c>Sarvam</c>.
    /// </summary>
    public string? Fallback { get; set; }

    /// <summary>The sorting provider: this section's <see cref="Provider"/> when it names a known provider, else the database row's.</summary>
    public AiProviderType ResolveProvider(string? databaseRowProvider, AiProviderType defaultWhenUnknown) =>
        TryParse(Provider, out var configured)
            ? configured
            : TryParse(databaseRowProvider, out var fromRow) ? fromRow : defaultWhenUnknown;

    /// <summary>The backup sorter, or null when none is configured (or it would be the same provider as <paramref name="primary"/>).</summary>
    public AiProviderType? ResolveFallback(AiProviderType primary) =>
        TryParse(Fallback, out var configured) && configured != primary ? configured : null;

    private static bool TryParse(string? raw, out AiProviderType type)
    {
        type = default;
        return !string.IsNullOrWhiteSpace(raw) &&
               !string.Equals(raw.Trim(), None, StringComparison.OrdinalIgnoreCase) &&
               Enum.TryParse(raw.Trim(), ignoreCase: true, out type) &&
               Enum.IsDefined(type);
    }
}
