namespace ShramSafal.Application.Ports.External;

/// <summary>
/// SARVAM_PRIMARY_VOICE_PIPELINE_2026-05-21 Task 2.3a — server-side audio
/// transcoder port. Browsers record voice as WebM/Opus (or mp4/m4a on iOS),
/// but Sarvam's streaming STT WebSocket accepts only raw PCM (s16le) or
/// PCM-wrapped WAV at a fixed sample rate. This port owns the
/// "decode-then-resample-to-mono" step so the
/// <see cref="ITranscriberProvider"/> adapter never has to inspect MIME
/// types or invoke ffmpeg directly.
///
/// <para>
/// Implementations stream output chunks as they decode so the orchestrator
/// can pipe transcoded PCM into the streaming transcriber without buffering
/// the whole file (a 2-minute clip is ~30 MB at 16 kHz s16le mono — too
/// large to hold twice). Each yielded <c>ReadOnlyMemory&lt;byte&gt;</c> is
/// raw s16le bytes aligned on 2-byte sample boundaries.
/// </para>
/// </summary>
public interface IAudioTranscoder
{
    /// <summary>
    /// Decode browser/mobile audio (WebM/Opus, mp4/m4a, ogg, mp3, etc.) to
    /// PCM s16le mono at <paramref name="targetSampleRateHz"/>. Streams
    /// chunks as they decode so callers can pipe to a downstream consumer
    /// without buffering the whole file.
    /// </summary>
    /// <param name="sourceAudio">
    /// Source audio bytes. Caller owns the stream; the transcoder reads
    /// it once and does not seek.
    /// </param>
    /// <param name="sourceMimeType">
    /// MIME type of the source (e.g. <c>audio/webm</c>, <c>audio/mp4</c>,
    /// <c>audio/ogg</c>). Used as a hint; ffmpeg auto-detects the actual
    /// container.
    /// </param>
    /// <param name="targetSampleRateHz">
    /// Sample rate of the output PCM stream. Defaults to 16 kHz to match
    /// Sarvam Saaras V3's default streaming codec.
    /// </param>
    /// <param name="ct">Cancellation token plumbed into ffmpeg's stdin/stdout I/O loops.</param>
    IAsyncEnumerable<ReadOnlyMemory<byte>> ToPcm16kMonoAsync(
        Stream sourceAudio,
        string sourceMimeType,
        int targetSampleRateHz = 16000,
        CancellationToken ct = default);
}
