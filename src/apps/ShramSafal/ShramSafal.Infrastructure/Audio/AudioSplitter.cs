using System.Buffers.Binary;
using System.Runtime.InteropServices;
using Microsoft.Extensions.Logging;
using ShramSafal.Application.Ports.External;

namespace ShramSafal.Infrastructure.Audio;

/// <summary>
/// PLR lane V-1 (register F67) — cuts a long recording into pieces Sarvam's speech-to-text REST call can take.
///
/// <para>
/// Sarvam's REST speech-to-text accepts at most 30 s of audio per request
/// (https://docs.sarvam.ai/api/speech-to-text/faq.md). Both server voice paths send the clip through
/// <c>SarvamSttClient</c>, so the split lives there and this class only decides WHERE to cut:
/// </para>
/// <list type="bullet">
///   <item>the clip is decoded once with the existing ffmpeg transcoder (<see cref="IAudioTranscoder"/>) to 16 kHz
///   mono 16-bit PCM;</item>
///   <item>up to <see cref="SplitAboveSeconds"/> it is NOT split — the caller sends the original bytes exactly as
///   before (also when the clip cannot be decoded: today's behaviour, unchanged);</item>
///   <item>longer, it is cut into <c>ceil(length / 22 s)</c> pieces of at most <see cref="MaxPieceSeconds"/>,
///   each cut at the QUIETEST point (200 ms smoothed frame energy) within 3 s of the even split;</item>
///   <item>the pieces are consecutive slices of the same PCM — no gap, no overlap — each wrapped as a WAV.</item>
/// </list>
/// The original audio blob is not touched (the retained voice clip is the uploaded bytes, kept by the caller).
/// </summary>
internal sealed class AudioSplitter
{
    public const int SampleRate = 16000;

    /// <summary>Up to this length a clip goes as it is (Sarvam's limit is 30 s; 2 s of headroom).</summary>
    public const double SplitAboveSeconds = 28;

    /// <summary>No piece is longer than this.</summary>
    public const double MaxPieceSeconds = 25;

    /// <summary>The even split aims at pieces of about this length, leaving room to move each cut to a pause.</summary>
    internal const double TargetPieceSeconds = 22;

    /// <summary>A cut may move this far either side of the even split to find the quietest point.</summary>
    internal const double SearchHalfWindowSeconds = 3;

    /// <summary>No piece is shorter than this (never a sliver Sarvam would hear as nothing).</summary>
    internal const double MinPieceSeconds = 5;

    /// <summary>Longest clip the server will split (the phone stops at 10 minutes; headroom for an old build).</summary>
    public const double MaxSplitSeconds = 15 * 60;

    /// <summary>20 ms analysis frames.</summary>
    internal const int FrameSamples = SampleRate / 50;

    /// <summary>The energy used to find a pause is smoothed over 10 frames (200 ms), so a cut never lands in the
    /// short closure inside a word.</summary>
    internal const int SmoothingFrames = 10;

    /// <summary>A piece whose loud frames stay below this share of the clip's loud frames is a pause, not speech.</summary>
    internal const double QuietRatio = 0.2;

    /// <summary>Absolute floor for "quiet" (about -55 dBFS on 16-bit audio).</summary>
    internal const double QuietFloorRms = 60;

    private readonly IAudioTranscoder _transcoder;
    private readonly ILogger<AudioSplitter> _logger;

    public AudioSplitter(IAudioTranscoder transcoder, ILogger<AudioSplitter> logger)
    {
        _transcoder = transcoder ?? throw new ArgumentNullException(nameof(transcoder));
        _logger = logger ?? throw new ArgumentNullException(nameof(logger));
    }

    /// <summary>
    /// Decides how the clip goes to speech-to-text. <see cref="AudioSplit.Unsplit"/>: send the original bytes as
    /// today. <see cref="AudioSplit.TooLong"/>: longer than <see cref="MaxSplitSeconds"/>. Otherwise the pieces.
    /// </summary>
    public async Task<AudioSplit> SplitAsync(byte[] audio, string mimeType, CancellationToken ct)
    {
        ArgumentNullException.ThrowIfNull(audio);

        byte[] pcmBytes;
        try
        {
            pcmBytes = await DecodeAsync(audio, mimeType, ct).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (ct.IsCancellationRequested)
        {
            throw;
        }
        catch (ClipTooLongException)
        {
            return AudioSplit.TooLong;
        }
        catch (Exception ex)
        {
            // Not decodable here: the clip goes exactly as it did before this lane, and Sarvam answers for it.
            _logger.LogWarning(ex, "AudioSplitter: could not decode the clip (mime={Mime}); sending it unsplit.", mimeType);
            return AudioSplit.Unsplit;
        }

        var pcm = MemoryMarshal.Cast<byte, short>(pcmBytes.AsSpan(0, pcmBytes.Length & ~1));
        if (pcm.Length <= SplitAboveSeconds * SampleRate)
        {
            return AudioSplit.Unsplit;
        }

        var frameRms = FrameRms(pcm);
        var ranges = PlanPieces(pcm, SampleRate);
        var clipLoud = Percentile95(frameRms, 0, frameRms.Length);
        var pieces = new List<AudioPiece>(ranges.Count);
        for (var i = 0; i < ranges.Count; i++)
        {
            var (start, end) = ranges[i];
            var pieceLoud = Percentile95(frameRms, start / FrameSamples, (end + FrameSamples - 1) / FrameSamples);
            var quiet = pieceLoud <= Math.Max(QuietRatio * clipLoud, QuietFloorRms);
            pieces.Add(new AudioPiece(i, start, end, ToWav(pcm.Slice(start, end - start), SampleRate), quiet));
        }

        _logger.LogInformation(
            "AudioSplitter: {Seconds:0.0} s split into {Count} pieces ({Lengths}).",
            pcm.Length / (double)SampleRate,
            pieces.Count,
            string.Join(", ", pieces.Select(p => p.Seconds.ToString("0.0", System.Globalization.CultureInfo.InvariantCulture))));

        return new AudioSplit(pieces, pcm.Length);
    }

    /// <summary>
    /// Where to cut, as consecutive [start, end) sample ranges covering the whole clip. Pure: the rule a test reads.
    /// </summary>
    internal static IReadOnlyList<(int Start, int End)> PlanPieces(ReadOnlySpan<short> pcm, int sampleRate)
    {
        var total = pcm.Length;
        if (total <= SplitAboveSeconds * sampleRate)
        {
            return [(0, total)];
        }

        var maxPiece = (int)(MaxPieceSeconds * sampleRate);
        var minPiece = (int)(MinPieceSeconds * sampleRate);
        var halfWindow = (int)(SearchHalfWindowSeconds * sampleRate);
        var frame = sampleRate / 50;
        var count = (int)Math.Ceiling(total / (TargetPieceSeconds * sampleRate));

        var smoothed = SmoothedFrameEnergy(pcm, frame);
        var ranges = new List<(int, int)>(count);
        var previous = 0;
        for (var k = 1; k < count; k++)
        {
            var ideal = (int)((long)k * total / count);
            var low = Math.Max(Math.Max(ideal - halfWindow, previous + minPiece), total - ((count - k) * maxPiece));
            var high = Math.Min(Math.Min(ideal + halfWindow, previous + maxPiece), total - minPiece);
            if (high < low)
            {
                // Cannot happen with the constants above (pieces aim at 22 s, so each window keeps at least 3 s of
                // room); kept so a future constant change can never produce a piece over the limit.
                high = low = Math.Min(previous + maxPiece, total);
            }

            var cut = QuietestCut(smoothed, frame, low, high, ideal);
            ranges.Add((previous, cut));
            previous = cut;
        }

        ranges.Add((previous, total));
        return ranges;
    }

    /// <summary>The frame boundary in [low, high] with the least smoothed energy; a tie goes to the one nearest the
    /// even split.</summary>
    private static int QuietestCut(double[] smoothed, int frame, int low, int high, int ideal)
    {
        var best = Math.Clamp(ideal, low, high);
        var bestEnergy = double.MaxValue;
        var bestDistance = long.MaxValue;
        var firstFrame = (low + frame - 1) / frame;
        for (var f = firstFrame; (long)f * frame <= high && f < smoothed.Length; f++)
        {
            var position = f * frame;
            var energy = smoothed[f];
            var distance = Math.Abs((long)position - ideal);
            if (energy < bestEnergy || (energy == bestEnergy && distance < bestDistance))
            {
                best = position;
                bestEnergy = energy;
                bestDistance = distance;
            }
        }

        return best;
    }

    /// <summary>Sum of squares per 20 ms frame, smoothed over <see cref="SmoothingFrames"/> frames centred on each.</summary>
    private static double[] SmoothedFrameEnergy(ReadOnlySpan<short> pcm, int frame)
    {
        var frames = (pcm.Length + frame - 1) / frame;
        var energy = new double[frames];
        for (var f = 0; f < frames; f++)
        {
            var start = f * frame;
            var end = Math.Min(start + frame, pcm.Length);
            double sum = 0;
            for (var i = start; i < end; i++)
            {
                sum += (double)pcm[i] * pcm[i];
            }

            energy[f] = sum;
        }

        var prefix = new double[frames + 1];
        for (var f = 0; f < frames; f++)
        {
            prefix[f + 1] = prefix[f] + energy[f];
        }

        var smoothed = new double[frames];
        var half = SmoothingFrames / 2;
        for (var f = 0; f < frames; f++)
        {
            var from = Math.Max(0, f - half);
            var to = Math.Min(frames, f + half);
            smoothed[f] = prefix[to] - prefix[from];
        }

        return smoothed;
    }

    private static double[] FrameRms(ReadOnlySpan<short> pcm)
    {
        var frames = (pcm.Length + FrameSamples - 1) / FrameSamples;
        var rms = new double[frames];
        for (var f = 0; f < frames; f++)
        {
            var start = f * FrameSamples;
            var end = Math.Min(start + FrameSamples, pcm.Length);
            double sum = 0;
            for (var i = start; i < end; i++)
            {
                sum += (double)pcm[i] * pcm[i];
            }

            rms[f] = Math.Sqrt(sum / Math.Max(1, end - start));
        }

        return rms;
    }

    private static double Percentile95(double[] values, int from, int to)
    {
        from = Math.Clamp(from, 0, values.Length);
        to = Math.Clamp(to, from, values.Length);
        if (to <= from)
        {
            return 0;
        }

        var slice = values[from..to];
        Array.Sort(slice);
        return slice[(int)Math.Floor(0.95 * (slice.Length - 1))];
    }

    /// <summary>A 16-bit mono PCM WAV (44-byte header) around the samples.</summary>
    internal static byte[] ToWav(ReadOnlySpan<short> samples, int sampleRate)
    {
        var dataBytes = samples.Length * sizeof(short);
        var wav = new byte[44 + dataBytes];
        var span = wav.AsSpan();
        "RIFF"u8.CopyTo(span);
        BinaryPrimitives.WriteInt32LittleEndian(span[4..], 36 + dataBytes);
        "WAVE"u8.CopyTo(span[8..]);
        "fmt "u8.CopyTo(span[12..]);
        BinaryPrimitives.WriteInt32LittleEndian(span[16..], 16);
        BinaryPrimitives.WriteInt16LittleEndian(span[20..], 1); // PCM
        BinaryPrimitives.WriteInt16LittleEndian(span[22..], 1); // mono
        BinaryPrimitives.WriteInt32LittleEndian(span[24..], sampleRate);
        BinaryPrimitives.WriteInt32LittleEndian(span[28..], sampleRate * sizeof(short));
        BinaryPrimitives.WriteInt16LittleEndian(span[32..], sizeof(short));
        BinaryPrimitives.WriteInt16LittleEndian(span[34..], 16);
        "data"u8.CopyTo(span[36..]);
        BinaryPrimitives.WriteInt32LittleEndian(span[40..], dataBytes);
        if (BitConverter.IsLittleEndian)
        {
            MemoryMarshal.AsBytes(samples).CopyTo(span[44..]);
        }
        else
        {
            for (var i = 0; i < samples.Length; i++)
            {
                BinaryPrimitives.WriteInt16LittleEndian(span[(44 + (i * 2))..], samples[i]);
            }
        }

        return wav;
    }

    private async Task<byte[]> DecodeAsync(byte[] audio, string mimeType, CancellationToken ct)
    {
        var maxBytes = (long)(MaxSplitSeconds * SampleRate * sizeof(short));
        await using var source = new MemoryStream(audio, writable: false);
        await using var pcm = new MemoryStream();
        await foreach (var chunk in _transcoder.ToPcm16kMonoAsync(source, mimeType, SampleRate, ct).ConfigureAwait(false))
        {
            if (pcm.Length + chunk.Length > maxBytes)
            {
                throw new ClipTooLongException();
            }

            await pcm.WriteAsync(chunk, ct).ConfigureAwait(false);
        }

        return pcm.ToArray();
    }

    private sealed class ClipTooLongException : Exception
    {
    }
}

/// <summary>One piece of a split clip: samples [<see cref="StartSample"/>, <see cref="EndSample"/>) as a WAV.</summary>
/// <param name="IsQuiet">Its loud frames are far below the clip's: a pause. An empty transcript is then a pause
/// heard correctly, not a failure.</param>
internal sealed record AudioPiece(int Index, int StartSample, int EndSample, byte[] Wav, bool IsQuiet)
{
    public double Seconds => (EndSample - StartSample) / (double)AudioSplitter.SampleRate;
}

/// <summary>The splitter's answer: no split (send the original), too long, or the pieces in order.</summary>
internal sealed record AudioSplit(IReadOnlyList<AudioPiece> Pieces, int TotalSamples, bool IsTooLong = false)
{
    public static readonly AudioSplit Unsplit = new([], 0);
    public static readonly AudioSplit TooLong = new([], 0, IsTooLong: true);

    public bool IsSplit => Pieces.Count > 1;
}
