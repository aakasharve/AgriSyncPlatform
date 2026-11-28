namespace ShramSafal.Application.Ports.External;

/// <summary>
/// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (voice live words, founder 28 Nov 2026) — the words shown on the recording
/// screen WHILE he speaks. One short piece of his voice (a phrase, at most <see cref="Services.LiveWordsAudio.MaxSeconds"/> s, a
/// 16 kHz mono 16-bit WAV) goes in; the words Sarvam's speech-to-text heard in it come out.
///
/// <para><b>Display only (P9).</b> What comes back is never saved, never parsed and never written to the transcript ledger
/// (<c>ssf.transcript_history</c>): the saved transcript and the parse stay the batch path's own result. A failure here, or a refusal
/// because the server is busy, only means no words appear for that piece; recording and saving are untouched.</para>
///
/// <para><b>Sarvam's budget is shared.</b> The real transcription of his whole recording must never lose a place in line to a
/// live preview, so an implementation sheds live pieces first (<see cref="LiveWordsOutcome.Busy"/>), never retries one, and caps
/// how many it sends at once and per minute.</para>
/// </summary>
public interface ILiveWordsTranscriber
{
    /// <summary>The server's switch for this feature (<c>Sarvam:LiveWordsEnabled</c>): off = every piece is refused, the phone shows nothing.</summary>
    bool Enabled { get; }

    /// <param name="wav">A complete 16 kHz mono 16-bit PCM WAV (already checked by <see cref="Services.LiveWordsAudio"/>).</param>
    /// <param name="languageHint">BCP-47 hint; blank = the configured Sarvam language (mr-IN).</param>
    Task<LiveWordsResult> TranscribeAsync(byte[] wav, string? languageHint, CancellationToken ct);
}

public enum LiveWordsOutcome
{
    /// <summary>Words were heard.</summary>
    Words,

    /// <summary>The piece was heard and held no words (a pause, a cough). Not a failure.</summary>
    Quiet,

    /// <summary>Shed on purpose: too many live pieces in flight or this minute. Never retried; the phone simply waits for the next piece.</summary>
    Busy,

    /// <summary>The speech service did not answer (down, slow, key missing, refused). Display only: nothing is lost.</summary>
    Unavailable,
}

public sealed record LiveWordsResult(LiveWordsOutcome Outcome, string Text, int ElapsedMs)
{
    public static LiveWordsResult Of(LiveWordsOutcome outcome, int elapsedMs = 0) => new(outcome, string.Empty, elapsedMs);
}
