using System.Globalization;

namespace ShramSafal.Domain.AI;

/// <summary>
/// spec: voice-instant-phase-a-2026-11-23 (Task 0, server half) — how long each stage of one voice note took on the
/// server, in whole milliseconds, so the phone and the founder can see where the waiting is before anyone speeds
/// anything up (doctrine E6: measure the baseline first).
///
/// <para>
/// <b>Stages.</b> <see cref="S3Ms"/> is the raw-audio write to the cold tier (the PUT only; the index bookkeeping
/// that follows it is a database write and is not in this number), <see cref="SttMs"/> is speech-to-text,
/// <see cref="StructMs"/> is sorting the transcript into the day's parts, and <see cref="TotalMs"/> is the whole
/// two-stage call. The stages can overlap (the audio write runs beside speech-to-text), so they need not add up to
/// the total.
/// </para>
///
/// <para>
/// <b>Honesty.</b> A stage that did not run for this request (a repeated request answered from the stored job, or the
/// one-call path where the provider does speech-to-text and sorting inside one call) reads 0, never a guess, and
/// <see cref="Path"/> says which path ran so a 0 is never mistaken for "instant". No value is ever negative.
/// </para>
/// </summary>
public sealed record VoiceStageTimings(int S3Ms, int SttMs, int StructMs, int TotalMs, string Path)
{
    /// <summary>The path where raw-audio write, speech-to-text and sorting each ran and were timed.</summary>
    public const string TwoStagePath = "two-stage";

    /// <summary>The path where one provider call did speech-to-text and sorting together (not timed per stage).</summary>
    public const string OneCallPath = "one-call";

    /// <summary>The path where a repeated request was answered from the job already stored (no stage ran).</summary>
    public const string CachedPath = "cached";

    /// <summary>
    /// The value of the <c>Server-Timing</c> response header: <c>s3;dur=120, stt;dur=2400, struct;dur=3100,
    /// total;dur=5800</c>. Whole milliseconds, never negative, invariant culture.
    /// </summary>
    public string ToServerTimingHeader() =>
        string.Create(
            CultureInfo.InvariantCulture,
            $"s3;dur={NonNegative(S3Ms)}, stt;dur={NonNegative(SttMs)}, struct;dur={NonNegative(StructMs)}, total;dur={NonNegative(TotalMs)}");

    private static int NonNegative(int value) => value < 0 ? 0 : value;
}
