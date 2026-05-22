namespace ShramSafal.Infrastructure.Integrations.Sarvam;

/// <summary>
/// Thrown by <see cref="SarvamStreamingSttClient.TranscribeStreamAsync"/>
/// when the inbound MIME type cannot be sent to the Sarvam WebSocket
/// endpoint directly. The Sarvam streaming API only accepts raw PCM
/// (pcm_s16le, pcm_l16, pcm_raw) or WAV at 8 kHz / 16 kHz.
///
/// Browser-side audio is normally <c>audio/webm;codecs=opus</c>; mobile
/// is typically <c>audio/mp4</c>. The orchestrator transcodes those to
/// PCM via <c>IAudioTranscoder</c> (SARVAM_PRIMARY_VOICE_PIPELINE
/// Task 2.3a) before handing the stream to this client. If the
/// transcoder layer is bypassed (e.g. a unit test or a misconfigured
/// caller) this exception fires as a fail-fast guard rather than letting
/// the WebSocket emit a cryptic provider error after the connection is
/// open.
/// </summary>
public sealed class SarvamAudioFormatUnsupportedException : InvalidOperationException
{
    public SarvamAudioFormatUnsupportedException(string mimeType)
        : base(BuildMessage(mimeType))
    {
        MimeType = mimeType;
    }

    public string MimeType { get; }

    private static string BuildMessage(string mimeType)
    {
        return $"Sarvam streaming STT cannot accept MIME type '{mimeType}'. " +
               "The WebSocket endpoint requires WAV or raw PCM " +
               "(pcm_s16le, pcm_l16, pcm_raw) at 8 kHz or 16 kHz. " +
               "Transcode upstream via IAudioTranscoder before streaming.";
    }
}
