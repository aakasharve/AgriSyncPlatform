namespace ShramSafal.Infrastructure.AI;

/// <summary>
/// PLR lane V-1 fix pass (review B005) — what a provider's failure means for the orchestrator, carried on the error
/// text (the canonical result has no other channel) so a deterministic failure is never run again at full cost:
/// <list type="bullet">
///   <item><see cref="InputRefused"/> — the INPUT was refused (a recording over the split limit). Never retried,
///   never handed to another provider, never counted against the provider's circuit breaker (it says nothing about
///   the provider's health).</item>
///   <item><see cref="NoRetry"/> — running this provider again would only repeat a failure that already had its own
///   retries (a speech-to-text piece that failed twice), and re-bill every piece of the recording.</item>
///   <item><see cref="NoFallback"/> — the fallback cannot answer this input either (a long recording: the multimodal
///   fallback's answer is cut off at its token limit — measured live 2026-10-31 on a 619 s clip).</item>
/// </list>
/// </summary>
internal static class AiErrorMarkers
{
    public const string InputRefused = "[input-refused]";
    public const string NoRetry = "[no-retry]";
    public const string NoFallback = "[no-fallback]";

    /// <summary>A recording of more than this many speech-to-text pieces (about 100 s) is too long for the
    /// multimodal fallback to answer.</summary>
    public const int FallbackMaxPieces = 4;

    public static bool Has(string? error, string marker) =>
        !string.IsNullOrEmpty(error) && error.Contains(marker, StringComparison.Ordinal);

    /// <summary>The error with the markers a split recording of <paramref name="pieces"/> pieces needs.</summary>
    public static string ForSplitRecording(string error, int pieces) =>
        pieces <= 1 ? error : $"{NoRetry} {(pieces > FallbackMaxPieces ? NoFallback + " " : string.Empty)}{error}";
}
