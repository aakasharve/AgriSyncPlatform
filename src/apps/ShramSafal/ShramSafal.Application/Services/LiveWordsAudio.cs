namespace ShramSafal.Application.Services;

/// <summary>
/// spec: plr-d10-schedule-mechanism-pilot-2026-11-22 (voice live words) — what the live-words route accepts: ONE complete
/// 16 kHz mono 16-bit PCM WAV of at most <see cref="MaxSeconds"/> seconds, exactly what the phone's recorder produces for a phrase.
/// Anything else is refused before any speech-to-text money is spent: the route is a preview, not a general upload door, so it
/// takes no other format (no ffmpeg, no guessing). Pure: reads the 44-byte header only.
/// </summary>
public static class LiveWordsAudio
{
    public const int SampleRate = 16_000;
    public const double MaxSeconds = 12.0;

    /// <summary>The smallest piece worth sending (0.3 s): shorter is noise and is refused.</summary>
    public const double MinSeconds = 0.3;

    private const int HeaderBytes = 44;
    private const int BytesPerSecond = SampleRate * 2;

    public const int MaxBytes = HeaderBytes + (int)(MaxSeconds * BytesPerSecond);

    /// <returns>null when the piece is acceptable; otherwise a short reason (English, for the log and the 400 body — never shown to him).</returns>
    public static string? Refusal(ReadOnlySpan<byte> wav)
    {
        if (wav.Length < HeaderBytes)
        {
            return "audio is not a WAV file";
        }

        if (!wav[..4].SequenceEqual("RIFF"u8) || !wav.Slice(8, 4).SequenceEqual("WAVE"u8) || !wav.Slice(12, 4).SequenceEqual("fmt "u8))
        {
            return "audio is not a WAV file";
        }

        // The canonical 44-byte layout the phone writes: fmt chunk of 16 bytes straight followed by the data chunk.
        if (BitConverter.ToInt32(wav.Slice(16, 4)) != 16 || !wav.Slice(36, 4).SequenceEqual("data"u8))
        {
            return "audio must be a plain 44-byte-header PCM WAV";
        }

        var format = BitConverter.ToInt16(wav.Slice(20, 2));
        var channels = BitConverter.ToInt16(wav.Slice(22, 2));
        var rate = BitConverter.ToInt32(wav.Slice(24, 4));
        var bits = BitConverter.ToInt16(wav.Slice(34, 2));
        if (format != 1 || channels != 1 || rate != SampleRate || bits != 16)
        {
            return "audio must be 16 kHz mono 16-bit PCM";
        }

        var dataBytes = BitConverter.ToInt32(wav.Slice(40, 4));
        if (dataBytes <= 0 || dataBytes != wav.Length - HeaderBytes)
        {
            return "audio length does not match its header";
        }

        var seconds = dataBytes / (double)BytesPerSecond;
        if (seconds < MinSeconds)
        {
            return "audio is too short";
        }

        if (seconds > MaxSeconds)
        {
            return $"audio is longer than {MaxSeconds:0} seconds";
        }

        return null;
    }
}
